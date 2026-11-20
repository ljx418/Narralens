#!/usr/bin/env python3
"""PROC-0 L1 direct tests for the metadata checker and the producer chain.

Standard library only.  The tests build a complete synthetic project with real
files on disk and drive the real checker entry point.  They never re-implement
the checker's own predicates: every negative branch must be refused by the
checker itself.

The chain tests close the producer gap: the real runner writes the original
capture pieces, the sidecar and the failure credential (the recorder itself is
mocked, nothing is really executed), and the real checker must accept exactly
that material and refuse it as soon as one piece no longer matches.

Run with:
    python3.12 -I -S -B tests/process/test_delivery_handoff.py
"""

import argparse
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

REPO_ROOT = Path(__file__).resolve().parents[2]
CHECKER_PATH = REPO_ROOT / "tools" / "check-delivery-spec.py"
RUNNER_PATH = REPO_ROOT / "tools" / "run-delivery.py"
HELPER_PATH = REPO_ROOT / "tests" / "process" / "fixtures" / "admission_helper.py"


def load_tool(path, name):
    """Load a tool by path; isolated mode has no script dir on sys.path."""
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


checker = load_tool(CHECKER_PATH, "check_delivery_spec_tool")
runner = load_tool(RUNNER_PATH, "run_delivery_tool")


def sha256_of(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class HandoffCase(unittest.TestCase):
    """A synthetic metadata handoff with real files on disk."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="proc0-handoff-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.fixture = checker.build_synthetic_fixture(self.root)
        self.release_path = self.fixture["release_path"]
        self.release_sha = self.fixture["release_sha"]
        self.packet = self.fixture["packet"]
        self.packet_path = self.fixture["packet_path"]

    def write_packet(self, packet, name):
        path = self.root / name
        path.write_text(json.dumps(packet, ensure_ascii=False, indent=2, sort_keys=True))
        return path

    def check_packet(self, packet, name):
        return checker.check(self.release_path, self.release_sha, self.write_packet(packet, name))

    def test_the_complete_packet_is_admitted_for_review(self):
        problems = checker.check(self.release_path, self.release_sha, self.packet_path)
        self.assertEqual(problems, [])

    def test_an_l1_root_only_ever_reports_the_l1_level(self):
        problems = checker.check(self.fixture["l1_release_path"], self.fixture["l1_release_sha"],
                                 self.fixture["l1_packet_path"])
        self.assertEqual(problems, [])
        self.assertEqual(checker.release_phase(self.fixture["l1_release_path"]), "BOOTSTRAP_CODE")
        self.assertEqual(checker.OUTPUT_STATUS["BOOTSTRAP_CODE"], "CODE_CANDIDATE_FOR_REVIEW")
        self.assertEqual(checker.OUTPUT_STATUS["FINAL_METADATA"], "METADATA_READY_FOR_REVIEW")

    def test_the_cli_never_runs_without_the_external_trust_root(self):
        with self.assertRaises(SystemExit) as raised:
            with contextlib.redirect_stdout(io.StringIO()):
                checker.main(["--packet", str(self.packet_path)])
        self.assertEqual(raised.exception.code, 2)

    def test_a_ready_packet_exits_zero_and_never_claims_business_acceptance(self):
        buffer = io.StringIO()
        with self.assertRaises(SystemExit) as raised:
            with contextlib.redirect_stdout(buffer):
                checker.main([
                    "--release", str(self.release_path),
                    "--expected-release-sha256", self.release_sha,
                    "--packet", str(self.packet_path),
                ])
        self.assertEqual(raised.exception.code, 0)
        payload = json.loads(buffer.getvalue())
        self.assertEqual(payload["status"], "METADATA_READY_FOR_REVIEW")
        self.assertFalse(payload["business_acceptance"])

    def test_an_l1_packet_never_reports_the_overall_ready_state(self):
        buffer = io.StringIO()
        with self.assertRaises(SystemExit) as raised:
            with contextlib.redirect_stdout(buffer):
                checker.main([
                    "--release", str(self.fixture["l1_release_path"]),
                    "--expected-release-sha256", self.fixture["l1_release_sha"],
                    "--packet", str(self.fixture["l1_packet_path"]),
                ])
        self.assertEqual(raised.exception.code, 0)
        payload = json.loads(buffer.getvalue())
        self.assertEqual(payload["status"], "CODE_CANDIDATE_FOR_REVIEW")
        self.assertNotEqual(payload["status"], "METADATA_READY_FOR_REVIEW")

    def test_proc0_14_a_partial_or_trimmed_packet_is_refused(self):
        partial = copy.deepcopy(self.packet)
        partial["status"] = "PARTIAL"
        self.assertTrue(self.check_packet(partial, "partial.json"))

        trimmed_cases = copy.deepcopy(self.packet)
        trimmed_cases["required_cases"] = ["PROC0-13"]
        trimmed_cases["cases"] = [case for case in trimmed_cases["cases"]
                                   if case["id"] == "PROC0-13"]
        self.assertTrue(self.check_packet(trimmed_cases, "trimmed-cases.json"))

        trimmed_source = copy.deepcopy(self.packet)
        trimmed_source["source"] = trimmed_source["source"][:-1]
        self.assertTrue(self.check_packet(trimmed_source, "trimmed-source.json"))

        replaced = copy.deepcopy(self.packet)
        replaced["release"] = {"path": str(self.release_path), "sha256": "c" * 64}
        self.assertTrue(self.check_packet(replaced, "replaced-release.json"))

        old_format = copy.deepcopy(self.packet)
        old_format["format"] = "narralens.delivery-packet@1"
        self.assertTrue(self.check_packet(old_format, "old-format.json"))

        self.assertTrue(checker.check(self.release_path, "0" * 64, self.packet_path))

        for slot_id in ("L1_DIRECT", "L3_SUCCESS", "L3_EXPECTED_FAILURE"):
            missing = copy.deepcopy(self.packet)
            for case in missing["cases"]:
                if case["id"] == "PROC0-13":
                    case["evidence"] = [row for row in case["evidence"]
                                        if row["slot_id"] != slot_id]
            self.assertTrue(self.check_packet(missing, "missing-%s.json" % slot_id))

    def test_proc0_14_an_unapproved_same_source_stage_release_is_refused(self):
        broken = copy.deepcopy(self.packet)
        for case in broken["cases"]:
            if case["id"] == "PROC0-13":
                for row in case["evidence"]:
                    if row["slot_id"] == "L3_SUCCESS":
                        row["stage_release"] = {
                            "path": str(self.root / "unauthorized-same-source-release.json"),
                            "sha256": "b" * 64,
                            "phase": "TOOL_RUNTIME",
                            "recorded_source": self.fixture["recorded_source"],
                            "protected_inputs": self.fixture["protected_inputs"],
                        }
        problems = self.check_packet(broken, "unapproved-stage.json")
        self.assertTrue(problems)
        self.assertTrue(any("UNAPPROVED_STAGE_RELEASE" in problem for problem in problems))

    def test_proc0_14_a_missing_contract_binding_is_refused(self):
        missing = copy.deepcopy(self.packet)
        missing.pop("contract", None)
        problems = self.check_packet(missing, "missing-contract.json")
        self.assertTrue(problems)
        self.assertTrue(any("contract" in problem for problem in problems))

    def test_proc0_15_a_capture_from_another_case_is_refused(self):
        swapped = copy.deepcopy(self.packet)
        by_case = {case["id"]: case for case in swapped["cases"]}
        first = by_case["PROC0-13"]["evidence"][0]
        second = by_case["PROC0-01"]["evidence"][0]
        first["capture_basename"], second["capture_basename"] = (
            second["capture_basename"], first["capture_basename"])
        first["run_id"], second["run_id"] = second["run_id"], first["run_id"]
        first["command_capture"], second["command_capture"] = (
            second["command_capture"], first["command_capture"])
        first["sidecar"], second["sidecar"] = second["sidecar"], first["sidecar"]
        problems = self.check_packet(swapped, "swapped.json")
        self.assertTrue(problems)
        self.assertTrue(any("SLOT_BINDING_MISMATCH" in problem for problem in problems))

    def test_proc0_15_a_capture_whose_recorded_cwd_does_not_match_is_refused(self):
        capture = self.fixture["captures"]["example-direct-001"]["slot_capture"]
        path = Path(str(capture) + ".cmd.json")
        original = path.read_bytes()
        record = json.loads(original.decode("utf-8"))
        record["cwd"] = "/somewhere/else"
        path.write_text(json.dumps(record))
        try:
            problems = checker.check(self.release_path, self.release_sha, self.packet_path)
            self.assertTrue(problems)
            self.assertTrue(any("cwd" in problem for problem in problems))
        finally:
            path.write_bytes(original)

    def test_proc0_15_a_shared_suite_that_main_explicitly_allowed_is_accepted(self):
        release = copy.deepcopy(self.fixture["release"])
        slot = release["case_bindings"]["PROC0-01"]["required_evidence"][0]
        slot["capture_basename"] = "example-direct-001"
        slot["run_id"] = "example-run-direct"
        release_path = self.root / "FINAL_SHARED.json"
        release_path.write_text(json.dumps(release, ensure_ascii=False, indent=2, sort_keys=True))
        release_sha = checker.digest(release_path)

        packet = copy.deepcopy(self.packet)
        packet["release"] = {"path": str(release_path), "sha256": release_sha}
        for case in packet["cases"]:
            if case["id"] == "PROC0-01":
                evidence = case["evidence"][0]
                evidence["capture_basename"] = "example-direct-001"
                evidence["run_id"] = "example-run-direct"
                evidence["command_capture"] = \
                    self.fixture["captures"]["example-direct-001"]["slot_capture"]
                evidence["sidecar"] = self.fixture["captures"]["example-direct-001"]["sidecar"]
        problems = checker.check(release_path, release_sha,
                                 self.write_packet(packet, "shared-suite.json"))
        self.assertEqual(problems, [])

    def test_an_unused_reserved_capture_needs_no_evidence(self):
        self.assertIn("example-unused-reserve-002",
                      [allocation["basename"]
                       for allocation in self.fixture["release"]["capture_allocations"]])
        problems = checker.check(self.release_path, self.release_sha, self.packet_path)
        self.assertEqual(problems, [])


class ChainRecorder:
    """Writes the six original pieces the way the original recorder does."""

    def __init__(self, recorder_dir, recorded_source, inner_exit=0, log_text="chain log\n"):
        self.recorder_dir = Path(recorder_dir)
        self.recorded_source = recorded_source
        self.inner_exit = inner_exit
        self.log_text = log_text
        self.calls = []
        self.wait_called = False

    def popen(self, argv, cwd=None, stdout=None, stderr=None, stdin=None, start_new_session=False):
        argv = list(argv)
        basename = argv[5]
        inner_argv = list(argv[6:])
        self.calls.append(list(argv))
        base = self.recorder_dir / basename
        (self.recorder_dir / (basename + ".claim.json")).write_text(json.dumps({
            "runner_version": 3, "name": basename, "argv": inner_argv,
            "claimed_at": "2026-01-01T00:00:00+00:00"}))
        (self.recorder_dir / (basename + ".cmd.json")).write_text(json.dumps({
            "argv": inner_argv, "cwd": cwd, "started_at": "2026-01-01T00:00:00+00:00",
            "runner_version": 3, "git_head": "0" * 40}))
        (self.recorder_dir / (basename + ".inputs.json")).write_text(json.dumps(
            {row["path"]: row["sha256"] for row in self.recorded_source}, indent=2))
        (self.recorder_dir / (basename + ".txt")).write_text(self.log_text)
        (self.recorder_dir / (basename + ".exit")).write_text("%d\n" % self.inner_exit)
        (self.recorder_dir / (basename + ".result.json")).write_text(json.dumps({
            "exit": self.inner_exit, "source_changed": [], "source_added": [],
            "log_sha256": sha256_of(self.recorder_dir / (basename + ".txt")),
            "finished_at": "2026-01-01T00:00:01+00:00"}))

        def wait():
            self.wait_called = True
            return self.inner_exit & 255

        return types.SimpleNamespace(pid=4242, argv=argv, wait=wait)


class ChainCase(unittest.TestCase):
    """The real runner output must be readable by the real checker."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="proc0-chain-")
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
            for relative in runner.discover_recorded_source(self.project, self.recorder_rel)
        ]
        self.protected_inputs = [
            {"path": "AGENTS.md", "sha256": sha256_of(self.project / "AGENTS.md")}
        ]
        self.contract = {"path": "CONTRACT.md",
                         "sha256": sha256_of(self.project / "CONTRACT.md")}
        self.state_root = self.project / "var" / "process-admission"
        self.owner_task = "chain-owner"
        self.fake = ChainRecorder(self.recorder_dir, self.recorded_source)
        self.patches = [
            mock.patch.object(runner.subprocess, "Popen", self.fake.popen),
            mock.patch.object(runner, "read_identity_after_session",
                              lambda pid, settle_seconds=2.0: (
                                  {"pid": 4242, "state": "S", "ppid": 1, "pgid": 4242,
                                   "sid": 4242, "start_ticks": 7}, None)),
            mock.patch.object(runner, "read_boot_id", lambda: "0" * 32),
            mock.patch.object(runner, "read_proc_identity",
                              lambda pid: {"pid": 4242, "state": "S", "ppid": 1, "pgid": 4242,
                                           "sid": 4242, "start_ticks": 7}),
            mock.patch.object(runner, "scan_group_members",
                              lambda pgid, exclude_pids=(): ([], 0, 0)),
        ]
        for patcher in self.patches:
            patcher.start()
            self.addCleanup(patcher.stop)

    def make_l1_release(self, expected_inner_exit=0, failure=False):
        slot = {
            "slot_id": "L1_DIRECT",
            "approved_stage_release": "L1",
            "command_id": "direct",
            "capture_basename": "chain-001",
            "run_id": "chain-run-1",
            "level": "D1",
            "expected_inner_exit": expected_inner_exit,
            "expected_failure_requirement": (
                {"assertion": "TOOL_HELPER_EXPECTED_FAILURE", "cleanup_required": True}
                if failure else None),
        }
        release = {
            "format": "narralens.proc0-release@3",
            "release_id": "CHAIN_L1",
            "phase": "BOOTSTRAP_CODE",
            "owner_task": self.owner_task,
            "generation": 1,
            "project_root": str(self.project),
            "state_root": str(self.state_root),
            "contract": self.contract,
            "recorder": {"path": self.recorder_rel,
                         "sha256": sha256_of(self.project / self.recorder_rel)},
            "recorded_source": self.recorded_source,
            "protected_inputs": self.protected_inputs,
            "commands": {
                "direct": {
                    "argv": ["/usr/bin/python3.12", "-I", "-S", "-B", "tests/test_sample.py"],
                    "cwd": str(self.project),
                    "runtime_class": "PURE_MOCK",
                    "expected_inner_exit": expected_inner_exit,
                    "allowed_phases": ["BOOTSTRAP_CODE"],
                }
            },
            "required_cases": ["PROC0-01"],
            "case_bindings": {"PROC0-01": {"required_evidence": [slot], "alternatives": []}},
            "capture_allocations": [
                {
                    "basename": "chain-001",
                    "command_id": "direct",
                    "run_id": "chain-run-1",
                    "phase": "BOOTSTRAP_CODE",
                    "case_ids": ["PROC0-01"],
                    "recorder_directory": str(self.recorder_dir),
                }
            ],
        }
        path = self.root / "L1_CHAIN.json"
        path.write_text(json.dumps(release, ensure_ascii=False, indent=2, sort_keys=True))
        return path, sha256_of(path), slot

    def run_chain(self, expected_inner_exit=0, failure=False):
        self.fake.inner_exit = expected_inner_exit
        self.fake.log_text = "TOOL_HELPER_EXPECTED_FAILURE\n" if failure else "chain log\n"
        l1_path, l1_sha, slot = self.make_l1_release(expected_inner_exit, failure)
        args = argparse.Namespace(
            release=str(l1_path),
            expected_release_sha256=l1_sha,
            owner_task=self.owner_task,
            command_id="direct",
            run_id="chain-run-1",
        )
        payload = runner.command_run(args)
        return l1_path, l1_sha, slot, payload

    def build_final(self, l1_path, l1_sha, slot, payload, with_artifact=False):
        final = {
            "format": "narralens.proc0-release@3",
            "release_id": "CHAIN_FINAL",
            "phase": "FINAL_METADATA",
            "owner_task": self.owner_task,
            "generation": 1,
            "project_root": str(self.project),
            "state_root": str(self.state_root),
            "contract": self.contract,
            "recorder": {"path": self.recorder_rel,
                         "sha256": sha256_of(self.project / self.recorder_rel)},
            "recorded_source": self.recorded_source,
            "protected_inputs": self.protected_inputs,
            "commands": {},
            "required_cases": ["PROC0-01"],
            "case_bindings": {"PROC0-01": {"required_evidence": [slot], "alternatives": []}},
            "capture_allocations": [
                {
                    "basename": "chain-001",
                    "command_id": "direct",
                    "run_id": "chain-run-1",
                    "phase": "BOOTSTRAP_CODE",
                    "case_ids": ["PROC0-01"],
                    "recorder_directory": str(self.recorder_dir),
                }
            ],
            "approved_stage_releases": {
                "L1": {
                    "path": str(l1_path),
                    "sha256": l1_sha,
                    "phase": "BOOTSTRAP_CODE",
                    "recorded_source": self.recorded_source,
                    "protected_inputs": self.protected_inputs,
                }
            },
        }
        final_path = self.root / "FINAL_CHAIN.json"
        final_path.write_text(json.dumps(final, ensure_ascii=False, indent=2, sort_keys=True))
        capture_base = self.recorder_dir / "chain-001"
        evidence = {
            "slot_id": "L1_DIRECT",
            "approved_stage_release": "L1",
            "command_id": "direct",
            "capture_basename": "chain-001",
            "run_id": "chain-run-1",
            "level": "D1",
            "expected_inner_exit": slot["expected_inner_exit"],
            "expected_failure_requirement": slot["expected_failure_requirement"],
            "stage_release": {
                "path": str(l1_path),
                "sha256": l1_sha,
                "phase": "BOOTSTRAP_CODE",
                "recorded_source": self.recorded_source,
                "protected_inputs": self.protected_inputs,
            },
            "command_capture": str(capture_base),
            "sidecar": payload["sidecar_path"],
            "expected_failure_artifact": payload["credential_path"] if with_artifact else None,
        }
        packet = {
            "format": "narralens.delivery-packet@2",
            "status": "READY_FOR_REVIEW",
            "release": {"path": str(final_path), "sha256": sha256_of(final_path)},
            "contract": self.contract,
            "source": self.recorded_source,
            "required_cases": ["PROC0-01"],
            "cases": [
                {
                    "id": "PROC0-01",
                    "implementation": "COMPLETE",
                    "production_entry": "tools/run-delivery.py::run",
                    "test_name": "chain direct test, not executed",
                    "evidence": [evidence],
                }
            ],
        }
        packet_path = self.root / "PACKET_CHAIN.json"
        packet_path.write_text(json.dumps(packet, ensure_ascii=False, indent=2, sort_keys=True))
        return final_path, sha256_of(final_path), packet_path

    def test_the_real_runner_output_is_accepted_by_the_real_checker(self):
        l1_path, l1_sha, slot, payload = self.run_chain()
        self.assertTrue(payload["metadata_ok"])
        self.assertEqual(payload["resource_status"], "CLEAN")
        final_path, final_sha, packet_path = self.build_final(l1_path, l1_sha, slot, payload)
        problems = checker.check(final_path, final_sha, packet_path)
        self.assertEqual(problems, [])

    def test_the_expected_failure_chain_carries_its_credential(self):
        l1_path, l1_sha, slot, payload = self.run_chain(expected_inner_exit=1, failure=True)
        self.assertEqual(payload["inner_exit"], 1)
        self.assertTrue(payload["metadata_ok"])
        credential = json.loads(Path(payload["credential_path"]).read_text())
        self.assertEqual(credential["case_id"], "PROC0-01")
        self.assertEqual(credential["run_id"], "chain-run-1")
        self.assertEqual(credential["assertion"], "TOOL_HELPER_EXPECTED_FAILURE")
        self.assertTrue(credential["cleanup"]["verified"])
        self.assertTrue(credential["case_passed"])
        self.assertEqual(credential["sidecar_sha256"], sha256_of(payload["sidecar_path"]))
        final_path, final_sha, packet_path = self.build_final(
            l1_path, l1_sha, slot, payload, with_artifact=True)
        problems = checker.check(final_path, final_sha, packet_path)
        self.assertEqual(problems, [])

    def test_a_missing_sidecar_is_refused_by_the_real_checker(self):
        l1_path, l1_sha, slot, payload = self.run_chain()
        final_path, final_sha, packet_path = self.build_final(l1_path, l1_sha, slot, payload)
        Path(payload["sidecar_path"]).unlink()
        problems = checker.check(final_path, final_sha, packet_path)
        self.assertTrue(problems)
        self.assertTrue(any("sidecar is missing" in problem for problem in problems))

    def test_a_tampered_capture_piece_is_refused_by_the_real_checker(self):
        l1_path, l1_sha, slot, payload = self.run_chain()
        final_path, final_sha, packet_path = self.build_final(l1_path, l1_sha, slot, payload)
        exit_file = self.recorder_dir / "chain-001.exit"
        exit_file.write_text("7\n")
        problems = checker.check(final_path, final_sha, packet_path)
        self.assertTrue(problems)
        self.assertTrue(any("capture digests" in problem or "exit" in problem
                            for problem in problems))

    def test_an_unsettled_resource_never_yields_a_verified_credential(self):
        with mock.patch.object(runner, "scan_group_members",
                               return_value=([{"pid": 555, "state": "S", "start_ticks": 3}], 0, 0)):
            l1_path, l1_sha, slot, payload = self.run_chain(expected_inner_exit=1, failure=True)
        self.assertEqual(payload["resource_status"], "DIRTY")
        credential = json.loads(Path(payload["credential_path"]).read_text())
        self.assertFalse(credential["cleanup"]["verified"])
        self.assertFalse(credential["case_passed"])
        final_path, final_sha, packet_path = self.build_final(
            l1_path, l1_sha, slot, payload, with_artifact=True)
        problems = checker.check(final_path, final_sha, packet_path)
        self.assertTrue(problems)

    def test_an_after_return_identity_read_error_keeps_the_wait(self):
        with mock.patch.object(runner, "read_identity_after_session",
                               side_effect=OSError("proc entry vanished")):
            l1_path, l1_sha, slot, payload = self.run_chain()
        self.assertTrue(self.fake.wait_called, "the owner of a returned child must wait")
        sidecar = json.loads(Path(payload["sidecar_path"]).read_text())
        self.assertTrue(sidecar["epoch"]["identity_inferred"])
        self.assertEqual(sidecar["epoch"]["recorder_pid"], 4242)

    def test_a_raw_write_error_keeps_the_wait_and_the_responsibility(self):
        real_commit = runner.commit_state

        def failing_commit(state_root, new_state, action, detail=None):
            if action == "run-running":
                raise OSError("raw write failure")
            return real_commit(state_root, new_state, action, detail)

        with mock.patch.object(runner, "commit_state", failing_commit):
            l1_path, l1_sha, slot, payload = self.run_chain()
        self.assertTrue(self.fake.wait_called, "the owner of a returned child must wait")
        self.assertFalse(payload["identity_persist"]["persisted"])
        self.assertEqual(payload["resource_status"], "UNKNOWN")
        self.assertEqual(payload["admission"], "BLOCKED")

    def test_an_undeterminable_group_is_never_signed_clean(self):
        with mock.patch.object(runner, "scan_group_members", return_value=([], 0, 2)):
            l1_path, l1_sha, slot, payload = self.run_chain()
        self.assertEqual(payload["resource_status"], "UNKNOWN")
        self.assertEqual(payload["undeterminable_proc_entries"], 2)
        self.assertEqual(payload["admission"], "BLOCKED")
        self.assertEqual(payload["blocked_reason"], "UNKNOWN_RESOURCE_HOLDS_RESPONSIBILITY")

    def test_a_vanished_entry_is_only_an_observation_limit(self):
        with mock.patch.object(runner, "scan_group_members", return_value=([], 3, 0)):
            l1_path, l1_sha, slot, payload = self.run_chain()
        self.assertEqual(payload["resource_status"], "CLEAN")
        self.assertEqual(payload["vanished_proc_entries"], 3)
        self.assertEqual(payload["admission"], "READY")

    def test_the_finite_helper_exposes_a_bounded_owned_file_barrier(self):
        helper = load_tool(HELPER_PATH, "admission_helper_tool")
        self.assertIn("barrier", helper.MODES)
        with self.assertRaises(ValueError):
            helper.resolve_barrier_root("/tmp/outside-the-var-area")
        root = helper.resolve_barrier_root(str(self.state_root / "selftest"))
        self.assertTrue(root.endswith("selftest"))
        self.assertFalse((self.state_root / "selftest").exists(),
                         "the barrier is never executed during L1")


if __name__ == "__main__":
    unittest.main(verbosity=2)
