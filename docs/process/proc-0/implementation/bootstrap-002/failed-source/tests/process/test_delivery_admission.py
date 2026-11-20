#!/usr/bin/env python3
"""PROC-0 L1 direct tests for tools/run-delivery.py.

Standard library only.  No product code is imported, no real process is
started, no signal is sent and no network is used: every Popen, every /proc
read and every recorder file write is mocked.  The tests call the real runner
entry points and assert on their observable results; they never re-implement
the runner's own predicates.

Run with:
    python3.12 -I -S -B tests/process/test_delivery_admission.py
"""

import argparse
import contextlib
import hashlib
import importlib.util
import io
import json
import tempfile
import threading
import types
import unittest
from pathlib import Path
from unittest import mock

REPO_ROOT = Path(__file__).resolve().parents[2]
TOOL_PATH = REPO_ROOT / "tools" / "run-delivery.py"
HELPER_PATH = REPO_ROOT / "tests" / "process" / "fixtures" / "admission_helper.py"
HANDOFF_TEST_PATH = REPO_ROOT / "tests" / "process" / "test_delivery_handoff.py"

# PROC0-01..PROC0-16 -> (file, test name).  PROC0-14 and PROC0-15 are metadata
# cases and live in the handoff direct tests.
CASE_MAP = {
    "PROC0-01": ("test_delivery_admission.py", "test_proc0_01_unknown_command_and_bad_release_are_refused"),
    "PROC0-02": ("test_delivery_admission.py", "test_proc0_02_source_protected_and_recorder_drift_are_refused"),
    "PROC0-03": ("test_delivery_admission.py", "test_proc0_03_existing_capture_and_unsafe_basenames_are_refused"),
    "PROC0-04": ("test_delivery_admission.py", "test_proc0_04_a_second_client_finds_the_slot_busy"),
    "PROC0-05": ("test_delivery_admission.py", "test_proc0_05_the_write_lease_identity_is_enforced"),
    "PROC0-06": ("test_delivery_admission.py", "test_proc0_06_unknown_state_blocks_and_locks_are_never_removed"),
    "PROC0-07": ("test_delivery_admission.py", "test_proc0_07_status_never_claims_the_epoch_is_gone"),
    "PROC0-08": ("test_delivery_admission.py", "test_proc0_08_popen_failure_has_no_child"),
    "PROC0-09": ("test_delivery_admission.py", "test_proc0_09_cancel_only_records_a_request"),
    "PROC0-10": ("test_delivery_admission.py", "test_proc0_10_metadata_and_resource_state_are_separate"),
    "PROC0-11": ("test_delivery_admission.py", "test_proc0_11_source_drift_during_the_run_is_saved"),
    "PROC0-12": ("test_delivery_admission.py", "test_proc0_12_a_live_group_member_keeps_the_slot_unknown"),
    "PROC0-13": ("test_delivery_admission.py", "test_proc0_13_each_exit_is_bound_to_its_own_run"),
    "PROC0-14": ("test_delivery_handoff.py", "test_proc0_14_a_partial_or_trimmed_packet_is_refused"),
    "PROC0-15": ("test_delivery_handoff.py", "test_proc0_15_a_capture_from_another_case_is_refused"),
    "PROC0-16": ("test_delivery_admission.py", "test_proc0_16_a_capture_is_never_overwritten_and_rebind_is_exact"),
}

FAKE_IDENTITY = {
    "pid": 4242, "state": "S", "ppid": 1, "pgid": 4242, "sid": 4242, "start_ticks": 99,
}


def load_tool():
    """Load tools/run-delivery.py by path; isolated mode has no script dir on sys.path."""
    spec = importlib.util.spec_from_file_location("run_delivery_tool", TOOL_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


run_delivery = load_tool()


def sha256_of(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class FakeRecorder:
    """Simulates the original recorder: it writes the six original pieces."""

    def __init__(self, recorder_dir, recorded_source):
        self.recorder_dir = Path(recorder_dir)
        self.recorded_source = recorded_source
        self.calls = []
        self.wait_called = False
        self.inner_exit = 0
        self.outer_returncode = None
        self.wait_gate = None
        self.mutate = None
        self.exit_text = None
        self.claim_argv = None
        self.cmd_cwd = None
        self.inputs_extra = None
        self.log_text = "fake recorder log\n"

    def popen(self, argv, cwd=None, stdout=None, stderr=None, stdin=None, start_new_session=False):
        argv = list(argv)
        basename = argv[5]
        inner_argv = list(argv[6:])
        self.calls.append({
            "argv": argv, "cwd": cwd, "start_new_session": start_new_session,
        })
        base = self.recorder_dir / basename
        (self.recorder_dir / (basename + ".claim.json")).write_text(json.dumps({
            "runner_version": 3,
            "name": basename,
            "argv": inner_argv if self.claim_argv is None else self.claim_argv,
            "claimed_at": "2026-01-01T00:00:00+00:00",
        }))
        (self.recorder_dir / (basename + ".cmd.json")).write_text(json.dumps({
            "argv": inner_argv,
            "cwd": cwd if self.cmd_cwd is None else self.cmd_cwd,
            "started_at": "2026-01-01T00:00:00+00:00",
            "runner_version": 3,
            "git_head": "0" * 40,
        }))
        inputs = {row["path"]: row["sha256"] for row in self.recorded_source}
        if self.inputs_extra:
            inputs.update(self.inputs_extra)
        (self.recorder_dir / (basename + ".inputs.json")).write_text(json.dumps(inputs, indent=2))
        (self.recorder_dir / (basename + ".txt")).write_text(self.log_text)
        exit_value = self.exit_text if self.exit_text is not None else str(self.inner_exit)
        (self.recorder_dir / (basename + ".exit")).write_text(exit_value + "\n")
        (self.recorder_dir / (basename + ".result.json")).write_text(json.dumps({
            "exit": self.inner_exit,
            "source_changed": [],
            "source_added": [],
            "log_sha256": sha256_of(self.recorder_dir / (basename + ".txt")),
            "finished_at": "2026-01-01T00:00:01+00:00",
        }))
        if self.mutate is not None:
            self.mutate()

        def wait():
            self.wait_called = True
            if self.wait_gate is not None:
                self.wait_gate.wait(20)
            if self.outer_returncode is not None:
                return self.outer_returncode
            return self.inner_exit & 255

        return types.SimpleNamespace(pid=FAKE_IDENTITY["pid"], argv=argv, wait=wait)


class RunnerCase(unittest.TestCase):
    """A synthetic project root with a real release, real files and mocked IO."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="proc0-admission-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.project = self.root / "project"
        self.recorder_rel = ("docs/execution/A/implementation-20261111/integration/"
                             "e1-main-takeover/run-recorded.py")
        self.recorder_dir = self.project / Path(self.recorder_rel).parent
        self.recorder_dir.mkdir(parents=True, exist_ok=True)
        files = {
            "src/app.py": "# app\n",
            "contracts/contract.json": "{}\n",
            "tools/tool.py": "# tool\n",
            "tests/test_sample.py": "# test\n",
            "package.json": "{}\n",
            "pnpm-lock.yaml": "lock\n",
            "tsconfig.json": "{}\n",
            "vitest.config.ts": "export default {}\n",
            "CONTRACT.md": "# contract\n",
            "AGENTS.md": "# agents\n",
            self.recorder_rel: "# recorder\n",
        }
        for relative, text in files.items():
            path = self.project / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)
        self.recorded_source = [
            {"path": relative, "sha256": sha256_of(self.project / relative)}
            for relative in run_delivery.discover_recorded_source(self.project, self.recorder_rel)
        ]
        self.protected_inputs = [
            {"path": "AGENTS.md", "sha256": sha256_of(self.project / "AGENTS.md")}
        ]
        self.state_root = self.project / "var" / "process-admission"
        self.owner_task = "proc0-test-owner"
        self.release = self.make_release()
        self.release_path = self.root / "RELEASE.json"
        self.write_release()
        self.fake = FakeRecorder(self.recorder_dir, self.recorded_source)
        self.start_patches()

    # -- fixture helpers ---------------------------------------------------

    def make_release(self, **overrides):
        """A release whose slots bind every run to its own command, capture and run.

        L1_WRONG_COMMAND is deliberately mis-bound: it names the capture and the
        run of another command.  It must never lend its assertion.
        """
        failure_requirement = {
            "assertion": "TOOL_HELPER_EXPECTED_FAILURE",
            "cleanup_required": True,
        }
        release = {
            "format": "narralens.proc0-release@3",
            "release_id": "PROC0_TEST_RELEASE",
            "phase": "BOOTSTRAP_CODE",
            "owner_task": self.owner_task,
            "generation": 1,
            "project_root": str(self.project),
            "state_root": str(self.state_root),
            "contract": {
                "path": "CONTRACT.md",
                "sha256": sha256_of(self.project / "CONTRACT.md"),
            },
            "recorder": {
                "path": self.recorder_rel,
                "sha256": sha256_of(self.project / self.recorder_rel),
            },
            "recorded_source": self.recorded_source,
            "protected_inputs": self.protected_inputs,
            "commands": {
                "direct": {
                    "argv": ["/usr/bin/python3.12", "-I", "-S", "-B", "tests/test_sample.py"],
                    "cwd": str(self.project),
                    "runtime_class": "PURE_MOCK",
                    "expected_inner_exit": 0,
                    "allowed_phases": ["BOOTSTRAP_CODE"],
                },
                "direct-fail": {
                    "argv": ["/usr/bin/python3.12", "-I", "-S", "-B", "tests/test_sample.py",
                             "specified-fail"],
                    "cwd": str(self.project),
                    "runtime_class": "PURE_MOCK",
                    "expected_inner_exit": 1,
                    "allowed_phases": ["BOOTSTRAP_CODE"],
                },
            },
            "required_cases": ["PROC0-13"],
            "case_bindings": {
                "PROC0-13": {
                    "required_evidence": [
                        {
                            "slot_id": "L1_DIRECT_OK",
                            "approved_stage_release": "SELF",
                            "command_id": "direct",
                            "capture_basename": "capture-a",
                            "run_id": "run-a",
                            "level": "D1",
                            "expected_inner_exit": 0,
                            "expected_failure_requirement": None,
                        },
                        {
                            "slot_id": "L1_DIRECT_FAIL",
                            "approved_stage_release": "SELF",
                            "command_id": "direct-fail",
                            "capture_basename": "capture-b",
                            "run_id": "run-b",
                            "level": "D1",
                            "expected_inner_exit": 1,
                            "expected_failure_requirement": failure_requirement,
                        },
                        {
                            "slot_id": "L1_WRONG_COMMAND",
                            "approved_stage_release": "SELF",
                            "command_id": "direct-fail",
                            "capture_basename": "capture-c",
                            "run_id": "run-c",
                            "level": "D1",
                            "expected_inner_exit": 1,
                            "expected_failure_requirement": failure_requirement,
                        },
                    ],
                    "alternatives": [],
                }
            },
            "capture_allocations": [
                {
                    "basename": "capture-a",
                    "command_id": "direct",
                    "run_id": "run-a",
                    "phase": "BOOTSTRAP_CODE",
                    "case_ids": ["PROC0-13"],
                    "recorder_directory": str(self.recorder_dir),
                },
                {
                    "basename": "capture-b",
                    "command_id": "direct-fail",
                    "run_id": "run-b",
                    "phase": "BOOTSTRAP_CODE",
                    "case_ids": ["PROC0-13"],
                    "recorder_directory": str(self.recorder_dir),
                },
                {
                    "basename": "capture-c",
                    "command_id": "direct",
                    "run_id": "run-c",
                    "phase": "BOOTSTRAP_CODE",
                    "case_ids": ["PROC0-13"],
                    "recorder_directory": str(self.recorder_dir),
                },
                {
                    "basename": "capture-d",
                    "command_id": "direct-fail",
                    "run_id": "run-d",
                    "phase": "BOOTSTRAP_CODE",
                    "case_ids": ["PROC0-13"],
                    "recorder_directory": str(self.recorder_dir),
                },
            ],
        }
        release.update(overrides)
        return release

    def write_release(self, release=None):
        if release is not None:
            self.release = release
        self.release_path.write_text(json.dumps(self.release, indent=2, sort_keys=True))
        self.release_sha = sha256_of(self.release_path)

    def start_patches(self):
        self.patches = [
            mock.patch.object(run_delivery.subprocess, "Popen", self.fake.popen),
            mock.patch.object(run_delivery, "read_identity_after_session",
                              lambda pid, settle_seconds=2.0: (dict(FAKE_IDENTITY), None)),
            mock.patch.object(run_delivery, "read_boot_id", lambda: "0" * 32),
            mock.patch.object(run_delivery, "read_proc_identity", lambda pid: dict(FAKE_IDENTITY)),
            mock.patch.object(run_delivery, "scan_group_members",
                              lambda pgid, exclude_pids=(): ([], 0, 0)),
        ]
        for patcher in self.patches:
            patcher.start()
            self.addCleanup(patcher.stop)

    def cli(self, command, *extra, release_sha=None, owner_task=None):
        argv = [command] + list(extra) + [
            "--release", str(self.release_path),
            "--expected-release-sha256", release_sha or self.release_sha,
            "--owner-task", owner_task or self.owner_task,
        ]
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            code = run_delivery.main(argv)
        text = buffer.getvalue()
        try:
            payload = json.loads(text)
        except ValueError:
            payload = {"raw": text}
        return code, payload

    def run_args(self, command_id="direct", run_id="run-a"):
        """The argument set of the real runner entry point, without stdout games."""
        return argparse.Namespace(
            release=str(self.release_path),
            expected_release_sha256=self.release_sha,
            owner_task=self.owner_task,
            command_id=command_id,
            run_id=run_id,
        )

    def state(self):
        return run_delivery.read_state(self.state_root)

    def credential_of(self, payload):
        return json.loads(Path(payload["credential_path"]).read_text())

    # -- PROC0 cases --------------------------------------------------------

    def test_proc0_01_unknown_command_and_bad_release_are_refused(self):
        code, payload = self.cli("run", "--command-id", "not-a-command", "--run-id", "run-a")
        self.assertEqual(code, 2)
        self.assertEqual(payload["reason"], "UNKNOWN_COMMAND_ID")
        self.assertEqual(self.fake.calls, [])

        code, payload = self.cli("run", "--command-id", "direct", "--run-id", "run-a",
                                 release_sha="0" * 64)
        self.assertEqual(code, 2)
        self.assertEqual(payload["reason"], "RELEASE_SHA256_MISMATCH")
        self.assertEqual(self.fake.calls, [])

        broken = self.make_release()
        broken["commands"]["direct"]["argv"] = ["/usr/bin/python3.12", "", "-S"]
        self.write_release(broken)
        code, payload = self.cli("run", "--command-id", "direct", "--run-id", "run-a")
        self.assertEqual(code, 2)
        self.assertEqual(payload["reason"], "RELEASE_COMMAND_ARGV_INVALID")
        self.assertEqual(self.fake.calls, [])

        shell_like = self.make_release()
        shell_like["commands"]["direct"]["argv"] = ["/bin/sh", "-c", "echo hi"]
        self.write_release(shell_like)
        code, payload = self.cli("run", "--command-id", "direct", "--run-id", "run-a")
        self.assertEqual(code, 2)
        self.assertEqual(payload["reason"], "COMMAND_INTERPRETER_NOT_PINNED_PYTHON312")
        self.assertEqual(self.fake.calls, [])

    def test_proc0_02_source_protected_and_recorder_drift_are_refused(self):
        code, payload = self.cli("run", "--command-id", "direct", "--run-id", "run-a")
        self.assertEqual(code, 0)
        before = (self.state_root / "state.json").read_bytes()

        (self.project / "src" / "app.py").write_text("# tampered\n")
        code, payload = self.cli("run", "--command-id", "direct", "--run-id", "run-c")
        self.assertEqual(code, 2)
        self.assertEqual(payload["reason"], "PREFLIGHT_SOURCE_OR_PROTECTED_FAILURE")
        self.assertEqual((self.state_root / "state.json").read_bytes(), before)
        (self.project / "src" / "app.py").write_text("# app\n")

        (self.project / "AGENTS.md").write_text("# tampered\n")
        code, payload = self.cli("run", "--command-id", "direct", "--run-id", "run-c")
        self.assertEqual(code, 2)
        self.assertEqual(payload["reason"], "PREFLIGHT_SOURCE_OR_PROTECTED_FAILURE")
        (self.project / "AGENTS.md").write_text("# agents\n")

        (self.project / self.recorder_rel).write_text("# tampered recorder\n")
        code, payload = self.cli("run", "--command-id", "direct", "--run-id", "run-c")
        self.assertEqual(code, 2)
        self.assertEqual(payload["reason"], "PREFLIGHT_SOURCE_OR_PROTECTED_FAILURE")
        self.assertEqual(len(self.fake.calls), 1, "no process may start on a drifted pin")

    def test_proc0_03_existing_capture_and_unsafe_basenames_are_refused(self):
        (self.recorder_dir / "capture-a.exit").write_text("0\n")
        code, payload = self.cli("run", "--command-id", "direct", "--run-id", "run-a")
        self.assertEqual(code, 2)
        self.assertEqual(payload["reason"], "CAPTURE_ALREADY_EXISTS")
        self.assertEqual(self.fake.calls, [])

        for suffix in (".inputs.json", ".cmd.json", ".txt", ".exit", ".result.json", ".claim.json"):
            path = self.recorder_dir / ("capture-c" + suffix)
            if not path.exists():
                path.write_text("x\n")
            code, payload = self.cli("run", "--command-id", "direct", "--run-id", "run-c")
            self.assertEqual(code, 2, suffix)
            self.assertEqual(payload["reason"], "CAPTURE_ALREADY_EXISTS", suffix)
            path.unlink()
        self.assertEqual(self.fake.calls, [])

        for unsafe in ["../escape", "a/b", "with.dot", "with space", "uniçode", "."]:
            broken = self.make_release()
            broken["capture_allocations"][0]["basename"] = unsafe
            self.write_release(broken)
            code, payload = self.cli("run", "--command-id", "direct", "--run-id", "run-a")
            self.assertEqual(code, 2, unsafe)
            self.assertIn(payload["reason"], (
                "CAPTURE_BASENAME_INVALID", "CAPTURE_BASENAME_NOT_ASCII",
                "CAPTURE_BASENAME_EMPTY", "RELEASE_CAPTURE_ALLOCATION_FIELD_MISSING",
            ), unsafe)
        self.assertEqual(self.fake.calls, [])

    def test_proc0_04_a_second_client_finds_the_slot_busy(self):
        state = run_delivery.read_state(self.state_root) or run_delivery.initial_state()
        state["slot"] = {"run_id": "run-a", "phase": "RUNNING", "owner_task": self.owner_task}
        state["phase"] = "RUNNING"
        state["admission"] = "BLOCKED"
        state["blocked_reason"] = "RUN_IN_FLIGHT"
        run_delivery.commit_state(self.state_root, state, "seed-running")

        code, payload = self.cli("run", "--command-id", "direct", "--run-id", "run-a")
        self.assertEqual(code, 2)
        self.assertEqual(payload["reason"], "RUN_SLOT_BUSY")
        self.assertEqual(self.fake.calls, [], "a contended slot must not start a second process")

        lock = self.state_root / ".lock"
        lock.write_text("{\"pid\": 1}")
        code, payload = self.cli("run", "--command-id", "direct", "--run-id", "run-c")
        self.assertEqual(code, 2)
        self.assertEqual(payload["reason"], "LOCK_HELD_UNRECOGNISED")
        self.assertTrue(lock.exists(), "an unknown lock is never deleted")

    def test_proc0_05_the_write_lease_identity_is_enforced(self):
        code, payload = self.cli("begin-write")
        self.assertEqual(code, 0)
        nonce = payload["nonce"]

        code, payload = self.cli("run", "--command-id", "direct", "--run-id", "run-a")
        self.assertEqual(code, 2)
        self.assertEqual(payload["reason"], "WRITE_LEASE_HOLDS_NO_RUN")

        code, payload = self.cli("rebind")
        self.assertEqual(code, 2)
        self.assertEqual(payload["reason"], "WRITE_LEASE_OPEN_REBIND_REJECTED")

        code, payload = self.cli("begin-write")
        self.assertEqual(code, 2)
        self.assertEqual(payload["reason"], "WRITE_LEASE_ALREADY_HELD")

        code, payload = self.cli("end-write", "--nonce", "nonce-wrong", "--generation", "1")
        self.assertEqual(code, 2)
        self.assertEqual(payload["reason"], "WRITE_LEASE_NONCE_MISMATCH")

        code, payload = self.cli("end-write", "--nonce", nonce, "--generation", "7")
        self.assertEqual(code, 2)
        self.assertEqual(payload["reason"], "WRITE_LEASE_GENERATION_MISMATCH")

        code, payload = self.cli("end-write", "--nonce", nonce, "--generation", "1",
                                 owner_task="another-owner")
        self.assertEqual(code, 2)
        self.assertEqual(payload["reason"], "OWNER_TASK_MISMATCH")

        code, payload = self.cli("end-write", "--nonce", nonce, "--generation", "1")
        self.assertEqual(code, 0)
        self.assertEqual(payload["blocked_reason"], "STALE_PIN_AFTER_AUTHORIZED_SOURCE_CHANGE")
        state = self.state()
        self.assertIsNone(state["write_lease"])
        self.assertEqual(state["admission"], "BLOCKED")

    def test_proc0_06_unknown_state_blocks_and_locks_are_never_removed(self):
        state = run_delivery.read_state(self.state_root) or run_delivery.initial_state()
        state["slot"] = {"run_id": "run-a", "phase": "UNKNOWN", "owner_task": self.owner_task}
        state["phase"] = "UNKNOWN"
        state["admission"] = "BLOCKED"
        state["blocked_reason"] = "UNKNOWN_RESOURCE_HOLDS_RESPONSIBILITY"
        run_delivery.commit_state(self.state_root, state, "seed-unknown")

        code, payload = self.cli("run", "--command-id", "direct", "--run-id", "run-a")
        self.assertEqual(code, 2)
        self.assertEqual(payload["reason"], "UNKNOWN_RESOURCE_HOLDS_RESPONSIBILITY")
        self.assertEqual(self.fake.calls, [])

        code, payload = self.cli("rebind")
        self.assertEqual(code, 2)
        self.assertEqual(payload["reason"], "UNKNOWN_RESOURCE_HOLDS_RESPONSIBILITY")

        code, payload = self.cli("begin-write")
        self.assertEqual(code, 2)
        self.assertEqual(payload["reason"], "UNKNOWN_RESOURCE_HOLDS_RESPONSIBILITY")

        state = self.state()
        self.assertEqual(state["slot"]["phase"], "UNKNOWN")
        self.assertEqual(state["admission"], "BLOCKED")

    def test_proc0_07_status_never_claims_the_epoch_is_gone(self):
        slot = {
            "recorder_pid": 999999, "recorder_start_ticks": 5, "recorder_pgid": 999999,
            "recorder_sid": 999999, "boot_id": "0" * 32,
        }
        with mock.patch.object(run_delivery, "read_proc_identity", side_effect=OSError("gone")):
            observation = run_delivery.observe_epoch(slot)
        self.assertFalse(observation["pid_entry_readable"])
        self.assertIn("not evidence", observation["conclusion"])

        with mock.patch.object(run_delivery, "read_proc_identity",
                               return_value={"pid": 999999, "state": "S", "ppid": 1,
                                             "pgid": 1, "sid": 1, "start_ticks": 6}):
            observation = run_delivery.observe_epoch(slot)
        self.assertFalse(observation["start_ticks_match"])
        self.assertIn("neither liveness nor exit", observation["conclusion"])

    def test_proc0_08_popen_failure_has_no_child(self):
        with mock.patch.object(run_delivery.subprocess, "Popen",
                               side_effect=OSError("cannot exec")):
            code, payload = self.cli("run", "--command-id", "direct", "--run-id", "run-a")
        self.assertEqual(code, 2)
        self.assertEqual(payload["reason"], "POPEN_FAILED_NO_CHILD")
        state = self.state()
        self.assertEqual(state["slot"]["resource_status"], "NO_CHILD")
        self.assertEqual(state["admission"], "BLOCKED")

    def test_proc0_08_a_lost_epoch_after_the_child_was_returned_keeps_the_wait(self):
        real_commit = run_delivery.commit_state

        def failing_commit(state_root, new_state, action, detail=None):
            if action == "run-running":
                raise run_delivery.AdmissionError("JOURNAL_APPEND_FAILED_PENDING_AUDIT", {})
            return real_commit(state_root, new_state, action, detail)

        with mock.patch.object(run_delivery, "commit_state", failing_commit):
            code, payload = self.cli("run", "--command-id", "direct", "--run-id", "run-a")
        self.assertTrue(self.fake.wait_called, "the owner of a returned child must wait")
        self.assertEqual(payload["resource_status"], "UNKNOWN")
        self.assertFalse(payload["metadata_ok"])

    def test_proc0_09_cancel_only_records_a_request(self):
        gate = threading.Event()
        running_persisted = threading.Event()
        self.fake.wait_gate = gate
        real_commit = run_delivery.commit_state

        def commit_and_signal(state_root, new_state, action, detail=None):
            result = real_commit(state_root, new_state, action, detail)
            if action == "run-running":
                running_persisted.set()
            return result

        holder = {}

        def worker():
            # The real runner entry point is called directly here: no stdout is
            # redirected anywhere, so the two threads cannot interleave output.
            try:
                holder["result"] = run_delivery.command_run(self.run_args())
            except run_delivery.AdmissionError as error:
                holder["result"] = {"status": "REJECTED", "reason": error.reason}

        with mock.patch.object(run_delivery, "commit_state", commit_and_signal):
            thread = threading.Thread(target=worker, daemon=True)
            thread.start()
            try:
                self.assertTrue(running_persisted.wait(20),
                                "the run must reach a persisted RUNNING state")
                state = self.state()
                self.assertEqual(state["slot"]["phase"], "RUNNING")
                self.assertEqual(state["admission"], "BLOCKED")

                code, payload = self.cli("request-cancel", "--run-id", "run-a")
                self.assertEqual(code, 0)
                self.assertEqual(payload["result"], "CANCEL_REQUESTED")

                state = self.state()
                self.assertTrue(state["cancel_requested"], "the request is sticky")
                self.assertEqual(state["slot"]["phase"], "RUNNING",
                                 "a request must not release the in-flight slot")
                self.assertTrue(state["slot"]["cancel_requested"])

                code, payload = self.cli("run", "--command-id", "direct", "--run-id", "run-c")
                self.assertEqual(code, 2)
                self.assertEqual(payload["reason"], "RUN_SLOT_BUSY")
                self.assertEqual(len(self.fake.calls), 1,
                                 "a cancel request must not free the slot for another run")
            finally:
                gate.set()
                thread.join(20)
        self.assertFalse(thread.is_alive(), "the worker thread must be finished")

        result = holder["result"]
        self.assertTrue(result.get("cancel_requested"), "the terminal record keeps the request")
        self.assertEqual(result["resource_status"], "CLEAN")

        code, payload = self.cli("request-cancel", "--run-id", "run-a")
        self.assertEqual(code, 0)
        self.assertEqual(payload["result"], "ALREADY_TERMINAL")

    def test_proc0_10_metadata_and_resource_state_are_separate(self):
        self.fake.inner_exit = 7
        code, payload = self.cli("run", "--command-id", "direct", "--run-id", "run-a")
        self.assertEqual(code, 0)
        self.assertFalse(payload["metadata_ok"])
        self.assertEqual(payload["resource_status"], "CLEAN")
        self.assertEqual(payload["blocked_reason"], "TERMINAL_WITH_INVALID_METADATA")

    def test_proc0_10_the_inner_and_outer_exit_domains_stay_separate(self):
        release = self.make_release()
        release["commands"]["direct"]["expected_inner_exit"] = -15
        release["case_bindings"]["PROC0-13"]["required_evidence"][0]["expected_inner_exit"] = -15
        self.write_release(release)
        self.fake.inner_exit = -15
        self.fake.outer_returncode = 241
        code, payload = self.cli("run", "--command-id", "direct", "--run-id", "run-a")
        self.assertEqual(payload["inner_exit"], -15)
        self.assertEqual(payload["recorder_wait_returncode"], 241)
        self.assertTrue(payload["metadata_ok"])

    def test_proc0_10_a_recorder_killed_by_a_signal_is_never_decoded(self):
        self.fake.inner_exit = 0
        self.fake.outer_returncode = -15
        code, payload = self.cli("run", "--command-id", "direct", "--run-id", "run-a")
        self.assertFalse(payload["metadata_ok"])
        problems = [row.get("problem") for row in payload["metadata_problems"]]
        self.assertIn("recorder_terminated_by_signal", problems)

    def test_proc0_11_source_drift_during_the_run_is_saved(self):
        def mutate():
            (self.project / "src" / "app.py").write_text("# changed while the run was live\n")

        self.fake.mutate = mutate
        code, payload = self.cli("run", "--command-id", "direct", "--run-id", "run-a")
        self.assertFalse(payload["metadata_ok"])
        self.assertTrue(payload["source_drift"])
        self.assertEqual(payload["blocked_reason"], "TERMINAL_WITH_INVALID_METADATA")

    def test_proc0_12_a_live_group_member_keeps_the_slot_unknown(self):
        with mock.patch.object(run_delivery, "scan_group_members",
                               return_value=([{"pid": 555, "state": "S", "start_ticks": 3}], 0, 0)):
            code, payload = self.cli("run", "--command-id", "direct", "--run-id", "run-a")
        self.assertEqual(payload["resource_status"], "DIRTY")
        self.assertEqual(payload["admission"], "BLOCKED")
        self.assertEqual(payload["blocked_reason"], "UNKNOWN_RESOURCE_HOLDS_RESPONSIBILITY")

        code, payload = self.cli("run", "--command-id", "direct", "--run-id", "run-c")
        self.assertEqual(code, 2)
        self.assertEqual(payload["reason"], "UNKNOWN_RESOURCE_HOLDS_RESPONSIBILITY")
        self.assertEqual(len(self.fake.calls), 1, "an unknown slot must not start another process")

    def test_proc0_13_each_exit_is_bound_to_its_own_run(self):
        # The first authorised slot: the plain success run.
        code, payload = self.cli("run", "--command-id", "direct", "--run-id", "run-a")
        self.assertEqual(code, 0)
        self.assertTrue(payload["metadata_ok"])
        self.assertEqual(payload["inner_exit"], 0)
        self.assertEqual(payload["admission"], "READY")
        self.assertFalse(payload["business_acceptance"])

        # The second authorised slot is a slot of its own: its own command, its
        # own capture and its own run carry the specified failure.
        self.fake.inner_exit = 1
        code, payload = self.cli("run", "--command-id", "direct-fail", "--run-id", "run-b")
        self.assertEqual(code, 0)
        self.assertEqual(payload["inner_exit"], 1)
        self.assertTrue(payload["metadata_ok"])
        self.assertFalse(payload["business_acceptance"],
                         "a non-zero expected exit is never an automatic pass")

        credential = self.credential_of(payload)
        self.assertTrue(credential["case_qualified"])
        self.assertEqual(credential["case_id"], "PROC0-13")
        self.assertEqual(credential["command_id"], "direct-fail")
        self.assertEqual(credential["capture_basename"], "capture-b")
        self.assertEqual(credential["run_id"], "run-b")
        self.assertEqual(credential["assertion"], "TOOL_HELPER_EXPECTED_FAILURE")
        self.assertTrue(credential["cleanup"]["verified"])
        self.assertTrue(credential["case_passed"])

        sidecar = json.loads(Path(payload["sidecar_path"]).read_text())
        self.assertEqual(sidecar["command_id"], "direct-fail")
        self.assertEqual(sidecar["capture_basename"], "capture-b")
        self.assertEqual(sidecar["run_id"], "run-b")
        self.assertEqual(sidecar["recorder_wait_returncode"], 1)

    def test_proc0_13_a_slot_of_another_run_cannot_lend_its_assertion(self):
        self.fake.inner_exit = 1
        code, payload = self.cli("run", "--command-id", "direct-fail", "--run-id", "run-d")
        self.assertEqual(code, 0)
        credential = self.credential_of(payload)
        self.assertFalse(credential["case_qualified"])
        self.assertNotIn("assertion", credential)
        self.assertNotIn("case_id", credential)
        self.assertFalse(credential["case_passed"])
        self.assertEqual(credential["command_id"], "direct-fail")
        self.assertEqual(credential["capture_basename"], "capture-d")
        self.assertEqual(credential["run_id"], "run-d")
        # the physical observation stays truthful: a missing authorisation does
        # not turn a settled resource into an unknown one
        self.assertEqual(credential["resource_status"], "CLEAN")
        self.assertEqual(payload["resource_status"], "CLEAN")
        self.assertEqual(payload["admission"], "READY")

    def test_proc0_13_a_slot_of_another_command_cannot_lend_its_assertion(self):
        code, payload = self.cli("run", "--command-id", "direct", "--run-id", "run-c")
        self.assertEqual(code, 0)
        credential = self.credential_of(payload)
        self.assertFalse(credential["case_qualified"])
        self.assertNotIn("assertion", credential)
        self.assertNotIn("case_id", credential)
        self.assertFalse(credential["case_passed"])
        self.assertEqual(credential["command_id"], "direct")
        self.assertEqual(credential["capture_basename"], "capture-c")
        self.assertEqual(credential["resource_status"], "CLEAN")

    def test_proc0_16_a_capture_is_never_overwritten_and_rebind_is_exact(self):
        code, payload = self.cli("run", "--command-id", "direct", "--run-id", "run-a")
        self.assertEqual(code, 0)
        before = (self.recorder_dir / "capture-a.exit").read_bytes()

        code, payload = self.cli("run", "--command-id", "direct", "--run-id", "run-a")
        self.assertEqual(code, 2)
        self.assertEqual(payload["reason"], "CAPTURE_ALREADY_EXISTS")
        self.assertEqual((self.recorder_dir / "capture-a.exit").read_bytes(), before)

        second = self.make_release(release_id="PROC0_TEST_RELEASE_2", generation=2)
        self.write_release(second)
        code, payload = self.cli("rebind")
        self.assertEqual(code, 0)
        self.assertEqual(payload["admission"], "READY")
        state = self.state()
        self.assertEqual(state["release_id"], "PROC0_TEST_RELEASE_2")
        self.assertTrue(state["history"], "the old run result is never overwritten")
        self.assertEqual(state["history"][0]["capture_basename"], "capture-a")

    def test_proc0_16_a_pending_audit_blocks_new_executions(self):
        state = run_delivery.read_state(self.state_root) or run_delivery.initial_state()
        state["pending_audit"] = True
        run_delivery.atomic_write_bytes(
            run_delivery.state_path(self.state_root), run_delivery._encode_json(state))
        code, payload = self.cli("run", "--command-id", "direct", "--run-id", "run-a")
        self.assertEqual(code, 2)
        self.assertEqual(payload["reason"], "PENDING_AUDIT_NOT_CLEAR")
        self.assertEqual(self.fake.calls, [])

    def test_proc0_16_a_failed_state_replace_keeps_the_old_state(self):
        code, payload = self.cli("run", "--command-id", "direct", "--run-id", "run-a")
        self.assertEqual(code, 0)
        before = (self.state_root / "state.json").read_bytes()
        with mock.patch.object(run_delivery, "atomic_write_bytes",
                               side_effect=run_delivery.AdmissionError("STATE_REPLACE_FAILED", {})):
            code, payload = self.cli("begin-write")
        self.assertEqual(code, 2)
        self.assertEqual(payload["reason"], "STATE_REPLACE_FAILED_OLD_STATE_PRESERVED")
        self.assertEqual((self.state_root / "state.json").read_bytes(), before)

    def test_the_runner_declares_no_signal_fork_or_reaper_api(self):
        source = TOOL_PATH.read_text()
        for token in ("os.kill(", "os.killpg(", "os.fork(", "os.waitpid(",
                      "os.waitid(", "prctl", "import signal", "signal.signal("):
            self.assertNotIn(token, source, token)

    def test_all_sixteen_cases_have_a_direct_mapping(self):
        expected = ["PROC0-%02d" % index for index in range(1, 17)]
        self.assertEqual(sorted(CASE_MAP), expected)
        handoff = HANDOFF_TEST_PATH.read_text()
        for case_id, (file_name, test_name) in sorted(CASE_MAP.items()):
            if file_name == "test_delivery_admission.py":
                self.assertTrue(hasattr(self, test_name), case_id)
            else:
                self.assertIn("def " + test_name, handoff, case_id)


if __name__ == "__main__":
    unittest.main(verbosity=2)
