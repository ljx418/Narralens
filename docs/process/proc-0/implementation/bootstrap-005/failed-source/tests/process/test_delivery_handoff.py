#!/usr/bin/env python3
"""PROC-0 L1 direct tests for the metadata checker and the producer chain.

Standard library only.  The tests build a complete synthetic project with real
files on disk and drive the real checker and the real runner.  They never
re-implement the checker's own predicates: every negative branch must be
refused by the checker itself.

The chain tests close the producer gap: the real runner writes the original
capture pieces, the sidecar, the failure credential and the terminal receipt
(the recorder itself is mocked, nothing is really executed), and the real
checker must accept exactly that material and refuse it as soon as one piece no
longer matches.

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
import os
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

    def test_proc0_14_a_partial_or_trimmed_packet_is_refused(self):
        partial = copy.deepcopy(self.packet)
        partial["status"] = "PARTIAL"
        self.assertTrue(self.check_packet(partial, "partial.json"))

        trimmed_cases = copy.deepcopy(self.packet)
        trimmed_cases["required_cases"] = []
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
                            "sha256": "b" * 64, "phase": "TOOL_RUNTIME",
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
        second = by_case["PROC0-13"]["evidence"][1]
        first["capture_basename"], second["capture_basename"] = (
            second["capture_basename"], first["capture_basename"])
        first["run_id"], second["run_id"] = second["run_id"], first["run_id"]
        first["command_capture"], second["command_capture"] = (
            second["command_capture"], first["command_capture"])
        first["sidecar"], second["sidecar"] = second["sidecar"], first["sidecar"]
        problems = self.check_packet(swapped, "swapped.json")
        self.assertTrue(problems)
        self.assertTrue(any("SLOT_BINDING_MISMATCH" in problem for problem in problems))

    def test_an_artefact_outside_the_derived_location_is_never_read(self):
        sentinel = self.root / "sentinel.json"
        sentinel.write_text(json.dumps({"marker": "sentinel-marker"}))
        packet = copy.deepcopy(self.packet)
        for case in packet["cases"]:
            for row in case["evidence"]:
                if row["slot_id"] == "L1_DIRECT":
                    row["sidecar"] = str(sentinel)
        packet_path = self.write_packet(packet, "packet-external.json")
        reads = []
        real_read_text = Path.read_text
        real_read_bytes = Path.read_bytes

        def tracking_read_text(self, *args, **kwargs):
            reads.append(str(self))
            return real_read_text(self, *args, **kwargs)

        def tracking_read_bytes(self, *args, **kwargs):
            reads.append(str(self))
            return real_read_bytes(self, *args, **kwargs)

        with mock.patch.object(Path, "read_text", tracking_read_text), \
                mock.patch.object(Path, "read_bytes", tracking_read_bytes):
            problems = checker.check(self.release_path, self.release_sha, packet_path)
        self.assertTrue(problems)
        self.assertFalse(any(str(sentinel) in path for path in reads),
                         "an artefact outside the derived location must never be read")
        self.assertNotIn("sentinel-marker", json.dumps(problems))

    def test_the_real_checker_self_test_completes_with_its_established_negatives(self):
        """The real self test must run to the end.

        Nothing is caught here: an AttributeError inside the self test has to
        fail this test instead of being swallowed as a pass.
        """
        result = checker.self_test()
        self.assertEqual(result["scope"], "SYNTHETIC_METADATA_ONLY")
        self.assertFalse(result["business_acceptance"])
        branches = result["negative_branches"]
        for label in (
            "complete_packet_admitted", "missing_l1_direct", "missing_l3_success",
            "missing_l3_expected_failure", "empty_evidence", "partial_status",
            "replaced_release_reference", "missing_contract_binding",
            "trimmed_source_inventory", "trimmed_case_inventory", "stage_alias_swapped",
            "unapproved_same_source_stage", "wrong_evidence_level",
            "capture_from_another_case", "external_sidecar_path", "external_capture_path",
            "credential_references_another_credential", "sidecar_is_not_an_object",
            "credential_is_not_an_object", "sidecar_inner_differs_from_originals",
            "assertion_not_reached_in_log", "terminal_receipt_missing",
            "receipt_names_an_uncommitted_event", "credential_cleanup_source_differs",
            "wrong_external_sha_rejected",
        ):
            self.assertIn(label, branches, label)

    def test_the_helper_barrier_validation_is_bounded(self):
        helper = load_tool(HELPER_PATH, "admission_helper_tool")
        self.assertIn("barrier", helper.MODES)
        with self.assertRaises(ValueError):
            helper.resolve_barrier_root("/tmp/outside-the-selftest-area")
        with self.assertRaises(ValueError):
            helper.resolve_barrier_root("relative/path")
        root = helper.resolve_barrier_root(
            "/tmp/project/var/process-admission/selftest/run-001")
        self.assertTrue(root.endswith("run-001"))
        for bad in ("nan", "inf", "-inf", "0", "-1"):
            with self.assertRaises(ValueError):
                helper.validate_barrier_hold(bad)
        self.assertEqual(helper.validate_barrier_hold("2.5"), 2.5)
        with self.assertRaises(ValueError):
            helper.validate_barrier_markers(root, "name with space")
        self.assertFalse((Path("/tmp/project/var/process-admission/selftest")).exists(),
                         "the barrier is never executed during L1")


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
        self.artefact_root = self.project / "var" / "process-admission" / "ticket-l3"
        self.owner_task = "chain-owner"
        self.fake = ChainRecorder(self.recorder_dir, self.recorded_source)
        self.patches = [
            mock.patch.object(runner.subprocess, "Popen", self.fake.popen),
            mock.patch.object(runner, "read_identity_after_session",
                              lambda pid, settle_seconds=2.0: (self.child_identity(), None)),
            mock.patch.object(runner, "read_boot_id", lambda: "0" * 32),
            mock.patch.object(runner, "read_proc_identity", self.identity_for),
            mock.patch.object(runner, "scan_group_members",
                              lambda pgid, exclude_pids=(): ([], 0, 0)),
        ]
        for patcher in self.patches:
            patcher.start()
            self.addCleanup(patcher.stop)

    def child_identity(self):
        """The identity of the mocked child, with this wrapper as its parent."""
        return {"pid": 4242, "state": "S", "ppid": os.getpid(), "pgid": 4242,
                "sid": 4242, "start_ticks": 7}

    def identity_for(self, pid):
        """The wrapper tuple and the child tuple are different real facts."""
        if pid == os.getpid():
            return {"pid": os.getpid(), "state": "S", "ppid": 1, "pgid": os.getpid(),
                    "sid": os.getpid(), "start_ticks": 3}
        return self.child_identity()

    def make_stage_release(self):
        helper0 = {
            "argv": ["/usr/bin/python3.12", "-I", "-S", "-B",
                     "tests/process/fixtures/admission_helper.py", "pass"],
            "cwd": str(self.project),
            "runtime_class": "FINITE_TOOL_HELPER",
            "expected_inner_exit": 0,
            "allowed_phases": ["TOOL_RUNTIME"],
        }
        helper1 = {
            "argv": ["/usr/bin/python3.12", "-I", "-S", "-B",
                     "tests/process/fixtures/admission_helper.py", "specified-fail"],
            "cwd": str(self.project),
            "runtime_class": "FINITE_TOOL_HELPER",
            "expected_inner_exit": 1,
            "allowed_phases": ["TOOL_RUNTIME"],
        }
        slots = [
            {"slot_id": "L3_SUCCESS", "approved_stage_release": "SELF", "command_id": "helper0",
             "capture_basename": "chain-pass-001", "run_id": "chain-run-pass",
             "level": "TOOL_RUNTIME", "expected_inner_exit": 0,
             "expected_failure_requirement": None},
            {"slot_id": "L3_EXPECTED_FAILURE", "approved_stage_release": "SELF",
             "command_id": "helper1", "capture_basename": "chain-fail-001",
             "run_id": "chain-run-fail", "level": "TOOL_RUNTIME", "expected_inner_exit": 1,
             "expected_failure_requirement": {"assertion": "TOOL_HELPER_EXPECTED_FAILURE",
                                               "cleanup_required": True}},
        ]
        release = {
            "format": "narralens.proc0-release@3", "release_id": "CHAIN_L3",
            "phase": "TOOL_RUNTIME", "owner_task": self.owner_task, "generation": 1,
            "project_root": str(self.project), "state_root": str(self.artefact_root),
            "contract": self.contract,
            "recorder": {"path": self.recorder_rel,
                         "sha256": sha256_of(self.project / self.recorder_rel)},
            "recorded_source": self.recorded_source,
            "protected_inputs": self.protected_inputs,
            "commands": {"helper0": helper0, "helper1": helper1},
            "required_cases": ["PROC0-13"],
            "case_bindings": {"PROC0-13": {"required_evidence": slots, "alternatives": []}},
            "capture_allocations": [
                {"basename": "chain-pass-001", "command_id": "helper0",
                 "run_id": "chain-run-pass", "phase": "TOOL_RUNTIME", "case_ids": ["PROC0-13"],
                 "recorder_directory": str(self.recorder_dir)},
                {"basename": "chain-fail-001", "command_id": "helper1",
                 "run_id": "chain-run-fail", "phase": "TOOL_RUNTIME", "case_ids": ["PROC0-13"],
                 "recorder_directory": str(self.recorder_dir)},
            ],
        }
        path = self.root / "L3_CHAIN.json"
        path.write_text(json.dumps(release, ensure_ascii=False, indent=2, sort_keys=True))
        return path, sha256_of(path), release

    def run_chain(self, command_id, run_id, inner_exit, log_text):
        self.fake.inner_exit = inner_exit
        self.fake.log_text = log_text
        stage_path, stage_sha, _release = self.make_stage_release()
        args = argparse.Namespace(
            release=str(stage_path), expected_release_sha256=stage_sha,
            owner_task=self.owner_task, command_id=command_id, run_id=run_id)
        payload = runner.command_run(args)
        return stage_path, stage_sha, payload

    def build_final(self, stage_path, stage_sha, payloads):
        final = {
            "format": "narralens.proc0-release@3", "release_id": "CHAIN_FINAL",
            "phase": "FINAL_METADATA", "owner_task": self.owner_task, "generation": 2,
            "project_root": str(self.project),
            "state_root": str(self.project / "var" / "process-admission" / "ticket-final"),
            "contract": self.contract,
            "recorder": {"path": self.recorder_rel,
                         "sha256": sha256_of(self.project / self.recorder_rel)},
            "recorded_source": self.recorded_source,
            "protected_inputs": self.protected_inputs,
            "commands": {},
            "required_cases": ["PROC0-13"],
            "case_bindings": {"PROC0-13": {"required_evidence": [
                {"slot_id": "L3_SUCCESS", "approved_stage_release": "L3",
                 "command_id": "helper0", "capture_basename": "chain-pass-001",
                 "run_id": "chain-run-pass", "level": "TOOL_RUNTIME",
                 "expected_inner_exit": 0, "expected_failure_requirement": None},
                {"slot_id": "L3_EXPECTED_FAILURE", "approved_stage_release": "L3",
                 "command_id": "helper1", "capture_basename": "chain-fail-001",
                 "run_id": "chain-run-fail", "level": "TOOL_RUNTIME", "expected_inner_exit": 1,
                 "expected_failure_requirement": {"assertion": "TOOL_HELPER_EXPECTED_FAILURE",
                                                   "cleanup_required": True}},
            ], "alternatives": []}},
            "capture_allocations": [],
            "approved_stage_releases": {
                "L3": {"path": str(stage_path), "sha256": stage_sha, "phase": "TOOL_RUNTIME",
                       "recorded_source": self.recorded_source,
                       "protected_inputs": self.protected_inputs},
            },
        }
        final_path = self.root / "FINAL_CHAIN.json"
        final_path.write_text(json.dumps(final, ensure_ascii=False, indent=2, sort_keys=True))
        evidence = []
        for payload, slot_id, command_id, run_id, basename, artifact in payloads:
            evidence.append({
                "slot_id": slot_id, "approved_stage_release": "L3", "command_id": command_id,
                "capture_basename": basename, "run_id": run_id, "level": "TOOL_RUNTIME",
                "expected_inner_exit": payload["inner_exit"],
                "expected_failure_requirement": (
                    {"assertion": "TOOL_HELPER_EXPECTED_FAILURE", "cleanup_required": True}
                    if artifact else None),
                "stage_release": {
                    "path": str(stage_path), "sha256": stage_sha, "phase": "TOOL_RUNTIME",
                    "recorded_source": self.recorded_source,
                    "protected_inputs": self.protected_inputs},
                "command_capture": str(self.recorder_dir / basename),
                "sidecar": payload["sidecar_path"],
                "expected_failure_artifact": payload["credential_path"] if artifact else None,
            })
        packet = {
            "format": "narralens.delivery-packet@2", "status": "READY_FOR_REVIEW",
            "release": {"path": str(final_path), "sha256": sha256_of(final_path)},
            "contract": self.contract, "source": self.recorded_source,
            "required_cases": ["PROC0-13"],
            "cases": [{"id": "PROC0-13", "implementation": "COMPLETE",
                       "production_entry": "tools/run-delivery.py::run",
                       "test_name": "chain direct test, not executed",
                       "evidence": evidence}],
        }
        packet_path = self.root / "PACKET_CHAIN.json"
        packet_path.write_text(json.dumps(packet, ensure_ascii=False, indent=2, sort_keys=True))
        return final_path, sha256_of(final_path), packet_path

    def test_the_real_runner_output_is_accepted_by_the_real_checker(self):
        _stage_path, stage_sha, pass_payload = self.run_chain(
            "helper0", "chain-run-pass", 0, "ADMISSION_HELPER_PASS\n")
        _stage_path, stage_sha, fail_payload = self.run_chain(
            "helper1", "chain-run-fail", 1, "TOOL_HELPER_EXPECTED_FAILURE\n")
        self.assertTrue(pass_payload["metadata_ok"])
        self.assertTrue(fail_payload["metadata_ok"])
        final_path, final_sha, packet_path = self.build_final(
            _stage_path, stage_sha,
            [(pass_payload, "L3_SUCCESS", "helper0", "chain-run-pass", "chain-pass-001", False),
             (fail_payload, "L3_EXPECTED_FAILURE", "helper1", "chain-run-fail", "chain-fail-001",
              True)])
        problems = checker.check(final_path, final_sha, packet_path)
        self.assertEqual(problems, [])

    def test_a_run_without_an_exact_slot_match_is_refused_by_the_real_checker(self):
        stage_path, stage_sha, payload = self.run_chain(
            "helper1", "chain-run-fail", 1, "TOOL_HELPER_EXPECTED_FAILURE\n")
        credential = json.loads(Path(payload["credential_path"]).read_text())
        self.assertTrue(credential["case_qualified"])
        final_path, final_sha, packet_path = self.build_final(
            stage_path, stage_sha,
            [(payload, "L3_EXPECTED_FAILURE", "helper1", "chain-run-fail", "chain-fail-001", True)])
        # the packet claims another run than the one that produced the artefacts
        packet = json.loads(packet_path.read_text())
        for row in packet["cases"][0]["evidence"]:
            row["run_id"] = "chain-other-run"
        packet_path.write_text(json.dumps(packet, ensure_ascii=False, indent=2, sort_keys=True))
        problems = checker.check(final_path, final_sha, packet_path)
        self.assertTrue(problems)

    def test_a_tampered_capture_piece_is_refused_by_the_real_checker(self):
        stage_path, stage_sha, payload = self.run_chain(
            "helper0", "chain-run-pass", 0, "ADMISSION_HELPER_PASS\n")
        final_path, final_sha, packet_path = self.build_final(
            stage_path, stage_sha,
            [(payload, "L3_SUCCESS", "helper0", "chain-run-pass", "chain-pass-001", False)])
        (self.recorder_dir / "chain-pass-001.exit").write_text("7\n")
        problems = checker.check(final_path, final_sha, packet_path)
        self.assertTrue(problems)

    def test_an_unsettled_resource_never_yields_a_verified_credential(self):
        with mock.patch.object(runner, "scan_group_members",
                               return_value=([{"pid": 555, "state": "S", "start_ticks": 3}], 0, 0)):
            stage_path, stage_sha, payload = self.run_chain(
                "helper1", "chain-run-fail", 1, "TOOL_HELPER_EXPECTED_FAILURE\n")
        self.assertEqual(payload["resource_status"], "DIRTY")
        credential = json.loads(Path(payload["credential_path"]).read_text())
        self.assertFalse(credential["cleanup"]["verified"])
        self.assertFalse(credential["case_passed"])
        final_path, final_sha, packet_path = self.build_final(
            stage_path, stage_sha,
            [(payload, "L3_EXPECTED_FAILURE", "helper1", "chain-run-fail", "chain-fail-001", True)])
        problems = checker.check(final_path, final_sha, packet_path)
        self.assertTrue(problems)

    def test_an_after_return_identity_read_error_keeps_the_wait(self):
        with mock.patch.object(runner, "read_identity_after_session",
                               side_effect=OSError("proc entry vanished")):
            _stage_path, _stage_sha, payload = self.run_chain(
                "helper0", "chain-run-pass", 0, "ADMISSION_HELPER_PASS\n")
        self.assertTrue(self.fake.wait_called, "the owner of a returned child must wait")
        self.assertEqual(payload["resource_status"], "UNKNOWN")
        self.assertEqual(payload["admission"], "BLOCKED")

    def test_a_raw_write_error_keeps_the_wait_and_the_responsibility(self):
        real_commit = runner.commit_event

        def failing_commit(authority, new_state, action, detail=None):
            if action == "run-running":
                raise OSError("raw write failure")
            return real_commit(authority, new_state, action, detail)

        with mock.patch.object(runner, "commit_event", failing_commit):
            _stage_path, _stage_sha, payload = self.run_chain(
                "helper0", "chain-run-pass", 0, "ADMISSION_HELPER_PASS\n")
        self.assertTrue(self.fake.wait_called, "the owner of a returned child must wait")
        self.assertFalse(payload["identity_persist"]["persisted"])
        self.assertEqual(payload["resource_status"], "UNKNOWN")
        self.assertEqual(payload["admission"], "BLOCKED")


if __name__ == "__main__":
    unittest.main(verbosity=2)
