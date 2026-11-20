#!/usr/bin/env python3
"""PROC-0 delivery metadata admission checker.

Metadata admission only.  It never certifies business, runtime or review
acceptance, and it never turns a recorded exit code into a product verdict.

The only trust root is the external MAIN release path plus the SHA-256 that
MAIN expects for it.  A packet can never replace that root, and a packet can
never approve a historical stage release that the final MAIN release did not
approve.

Phase discipline (MAIN ruling): a BOOTSTRAP_CODE root only ever reports
CODE_CANDIDATE_FOR_REVIEW and only checks the L1 material of that root.
Only a FINAL_METADATA root may report the overall METADATA_READY_FOR_REVIEW.

Exit codes: 0 = admitted for review, 2 = rejected.
"""

import argparse
import hashlib
import json
import os
import tempfile
from pathlib import Path

RELEASE_FORMAT = "narralens.proc0-release@3"
PACKET_FORMAT = "narralens.delivery-packet@2"
CAPTURE_SUFFIXES = (".inputs.json", ".cmd.json", ".txt", ".exit", ".result.json", ".claim.json")
RECORDER_RUNNER_VERSION = 3
BOOTSTRAP_LAYERS = ("BOOTSTRAP", "L1_DIRECT")
TOOL_RUNTIME_LAYERS = ("TOOL_RUNTIME",)

# The packet status a root release phase demands, and the status the checker
# may report for it.  An L1 root never reports the overall ready state.
EXPECTED_PACKET_STATUS = {
    "BOOTSTRAP_CODE": "CODE_CANDIDATE_FOR_REVIEW",
    "TOOL_RUNTIME": "READY_FOR_REVIEW",
    "FINAL_METADATA": "READY_FOR_REVIEW",
}
OUTPUT_STATUS = {
    "BOOTSTRAP_CODE": "CODE_CANDIDATE_FOR_REVIEW",
    "TOOL_RUNTIME": "METADATA_READY_FOR_REVIEW",
    "FINAL_METADATA": "METADATA_READY_FOR_REVIEW",
}


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def load_json(path, what, problems):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        problems.append("%s unreadable: %s" % (what, type(error).__name__))
        return None


def resolve(root, declared):
    """Resolve a declared path; relative paths are bound to the project root."""
    if not isinstance(declared, str) or declared == "":
        return None
    candidate = Path(declared)
    if not candidate.is_absolute():
        candidate = Path(root) / candidate
    return candidate


def same_path(root, left, right):
    if not isinstance(left, str) or not isinstance(right, str):
        return False
    left_path = resolve(root, left)
    right_path = resolve(root, right)
    if left_path is None or right_path is None:
        return False
    try:
        return left_path.resolve() == right_path.resolve()
    except OSError:
        return False


def verify_inventory(root, rows, label, problems):
    """Every pinned path must exist with the pinned digest."""
    root = Path(root)
    for row in rows or []:
        if not isinstance(row, dict) or not isinstance(row.get("path"), str):
            problems.append("%s row is not a {path, sha256} object" % label)
            continue
        target = root / row["path"]
        if not target.is_file():
            problems.append("%s missing on disk: %s" % (label, row["path"]))
            continue
        if digest(target) != row.get("sha256"):
            problems.append("%s digest mismatch: %s" % (label, row["path"]))


def actual_rows(root, rows):
    """The real digests of a pinned set right now, for pre/post comparison."""
    root = Path(root)
    observed = []
    for row in rows or []:
        target = root / row["path"]
        observed.append({
            "path": row["path"],
            "sha256": digest(target) if target.is_file() else None,
        })
    return observed


def actual_capture_digests(capture_base):
    """The real digest of every original capture piece (None when absent)."""
    digests = {}
    for suffix in CAPTURE_SUFFIXES:
        path = Path(str(capture_base) + suffix)
        digests[suffix] = digest(path) if path.is_file() else None
    return digests


def approved_stage_entry(release, release_path, release_sha, alias):
    """Resolve the approved stage release of the trusted root release."""
    if alias == "SELF":
        return {
            "path": str(release_path),
            "sha256": release_sha,
            "phase": release.get("phase"),
            "recorded_source": release.get("recorded_source"),
            "protected_inputs": release.get("protected_inputs"),
        }
    approved = (release.get("approved_stage_releases") or {}).get(alias)
    if not isinstance(approved, dict):
        return None
    return approved


def check_stage_release(root, alias, evidence, release, release_path, release_sha, problems):
    """Verify the stage release named by the packet against the trusted root."""
    approved = approved_stage_entry(release, release_path, release_sha, alias)
    if approved is None:
        problems.append("REJECTED_UNAPPROVED_STAGE_RELEASE: alias %s is not approved" % alias)
        return None
    claimed = evidence.get("stage_release")
    if not isinstance(claimed, dict):
        problems.append("evidence %s has no stage_release block" % evidence.get("slot_id"))
        return None
    if claimed.get("sha256") != approved.get("sha256"):
        problems.append(
            "REJECTED_UNAPPROVED_STAGE_RELEASE: %s cites sha %s, approved %s"
            % (alias, claimed.get("sha256"), approved.get("sha256"))
        )
        return None
    if not same_path(root, claimed.get("path"), approved.get("path")):
        problems.append(
            "REJECTED_UNAPPROVED_STAGE_RELEASE: %s cites path %s, approved %s"
            % (alias, claimed.get("path"), approved.get("path"))
        )
        return None
    stage_path = resolve(root, approved.get("path"))
    if stage_path is None or not stage_path.is_file():
        problems.append("approved stage release file is missing: %s" % approved.get("path"))
        return None
    actual = digest(stage_path)
    if actual != approved.get("sha256"):
        problems.append("approved stage release digest mismatch: %s" % approved.get("path"))
        return None
    stage = load_json(stage_path, "stage release", problems)
    if not isinstance(stage, dict):
        return None
    if stage.get("phase") != approved.get("phase"):
        problems.append("approved stage release phase mismatch: %s" % approved.get("path"))
    if stage.get("recorded_source") != approved.get("recorded_source"):
        problems.append(
            "approved stage release recorded_source differs from the final ticket: %s"
            % approved.get("path")
        )
    if stage.get("protected_inputs") != approved.get("protected_inputs"):
        problems.append(
            "approved stage release protected_inputs differ from the final ticket: %s"
            % approved.get("path")
        )
    if stage.get("recorded_source") != release.get("recorded_source"):
        problems.append(
            "stage release source set differs from the final release: %s" % approved.get("path")
        )
    recorder = stage.get("recorder") or {}
    if isinstance(recorder.get("path"), str) and isinstance(recorder.get("sha256"), str):
        recorder_file = Path(root) / recorder["path"]
        if not recorder_file.is_file():
            problems.append("stage release recorder is missing: %s" % recorder["path"])
        elif digest(recorder_file) != recorder["sha256"]:
            problems.append("stage release recorder digest mismatch: %s" % recorder["path"])
    return stage


def check_sidecar(root, evidence, stage, stage_sha, problems):
    """The sidecar binds the real outer wait, the real pieces and the real cleanup."""
    slot_id = evidence.get("slot_id")
    sidecar_path = resolve(root, evidence.get("sidecar"))
    if sidecar_path is None or not sidecar_path.is_file():
        problems.append(
            "%s: sidecar is missing (%s)" % (slot_id, evidence.get("sidecar"))
        )
        return None
    sidecar = load_json(sidecar_path, "sidecar", problems)
    if not isinstance(sidecar, dict):
        return None
    if sidecar.get("run_id") != evidence.get("run_id"):
        problems.append("%s: sidecar run_id does not match the slot" % slot_id)
    if sidecar.get("command_id") != evidence.get("command_id"):
        problems.append("%s: sidecar command_id does not match the slot" % slot_id)
    if sidecar.get("capture_basename") != evidence.get("capture_basename"):
        problems.append("%s: sidecar capture does not match the slot" % slot_id)
    if sidecar.get("release_sha256") != stage_sha:
        problems.append("%s: sidecar is not bound to the stage release" % slot_id)
    layer = sidecar.get("evidence_layer")
    phase = stage.get("phase")
    if phase == "BOOTSTRAP_CODE":
        if layer not in BOOTSTRAP_LAYERS:
            problems.append(
                "%s: bootstrap slot needs a BOOTSTRAP sidecar, found %s" % (slot_id, layer)
            )
    elif phase == "TOOL_RUNTIME":
        if layer not in TOOL_RUNTIME_LAYERS:
            problems.append(
                "%s: tool runtime slot needs a TOOL_RUNTIME sidecar, found %s" % (slot_id, layer)
            )
    else:
        problems.append("%s: unsupported stage phase %s" % (slot_id, phase))
    level = evidence.get("level")
    if phase == "BOOTSTRAP_CODE" and level not in ("D0", "D1"):
        problems.append(
            "%s: bootstrap evidence must sit on a D0/D1 level, found %s" % (slot_id, level)
        )
    if phase == "TOOL_RUNTIME" and level != "TOOL_RUNTIME":
        problems.append(
            "%s: tool runtime evidence must sit on the TOOL_RUNTIME level, found %s" % (slot_id, level)
        )
    if sidecar.get("source_pre") != stage.get("recorded_source"):
        problems.append("%s: sidecar source pre values differ from the stage release" % slot_id)
    if sidecar.get("protected_pre") != stage.get("protected_inputs"):
        problems.append("%s: sidecar protected pre values differ from the stage release" % slot_id)
    if sidecar.get("source_post") != actual_rows(root, stage.get("recorded_source")):
        problems.append("%s: sidecar source post values are not the current files" % slot_id)
    if sidecar.get("protected_post") != actual_rows(root, stage.get("protected_inputs")):
        problems.append("%s: sidecar protected post values are not the current files" % slot_id)
    capture_base = resolve(root, evidence.get("command_capture"))
    if capture_base is not None:
        if sidecar.get("capture_digests") != actual_capture_digests(capture_base):
            problems.append(
                "%s: sidecar capture digests are not the six original pieces" % slot_id
            )
    if sidecar.get("resource_status") != "CLEAN":
        problems.append(
            "%s: sidecar resource status is %s, an unsettled resource holds the responsibility"
            % (slot_id, sidecar.get("resource_status"))
        )
    cleanup = sidecar.get("cleanup_source")
    if not isinstance(cleanup, dict):
        problems.append("%s: sidecar has no cleanup source" % slot_id)
    else:
        for field in ("kind", "pgid", "observed_members", "undeterminable_entries", "scanned_at"):
            if field not in cleanup:
                problems.append("%s: sidecar cleanup source lacks %s" % (slot_id, field))
        if cleanup.get("undeterminable_entries"):
            problems.append("%s: sidecar cleanup source could not determine the group" % slot_id)
        if cleanup.get("observed_members"):
            problems.append("%s: sidecar cleanup source still sees group members" % slot_id)
    outer = sidecar.get("recorder_wait_returncode")
    inner = sidecar.get("inner_exit")
    if not isinstance(outer, int) or isinstance(outer, bool):
        problems.append("%s: sidecar has no recorder wait return code" % slot_id)
    elif outer < 0:
        problems.append(
            "%s: the recorder itself was ended by a signal; the inner exit cannot be inferred"
            % slot_id
        )
    if not isinstance(inner, int) or isinstance(inner, bool):
        problems.append("%s: sidecar has no inner exit" % slot_id)
    elif isinstance(outer, int) and not isinstance(outer, bool) and outer >= 0:
        if outer != (inner & 255):
            problems.append(
                "%s: recorder outer exit %s does not encode inner exit %s" % (slot_id, outer, inner)
            )
    return sidecar


def check_failure_artifact(root, evidence, case_id, stage, problems):
    """A non-zero expectation needs a credential bound to this exact run."""
    slot_id = evidence.get("slot_id")
    artifact_path = resolve(root, evidence.get("expected_failure_artifact"))
    if artifact_path is None or not artifact_path.is_file():
        problems.append(
            "%s: a non-zero expectation needs an expected failure artifact" % slot_id
        )
        return
    artifact = load_json(artifact_path, "expected failure artifact", problems)
    if not isinstance(artifact, dict):
        return
    if artifact.get("case_id") != case_id:
        problems.append("%s: failure artifact is bound to another case" % slot_id)
    if artifact.get("capture_basename") != evidence.get("capture_basename"):
        problems.append("%s: failure artifact belongs to another capture" % slot_id)
    if artifact.get("run_id") != evidence.get("run_id"):
        problems.append("%s: failure artifact belongs to another run" % slot_id)
    if artifact.get("command_id") != evidence.get("command_id"):
        problems.append("%s: failure artifact belongs to another command" % slot_id)
    requirement = evidence.get("expected_failure_requirement") or {}
    assertion = requirement.get("assertion")
    if assertion and artifact.get("assertion") != assertion:
        problems.append("%s: failure artifact does not name the required assertion" % slot_id)
    if artifact.get("source") != stage.get("recorded_source"):
        problems.append("%s: failure artifact source binding mismatch" % slot_id)
    if artifact.get("protected") != stage.get("protected_inputs"):
        problems.append("%s: failure artifact protected binding mismatch" % slot_id)
    if artifact.get("source_post") != actual_rows(root, stage.get("recorded_source")):
        problems.append("%s: failure artifact source post values are not the current files" % slot_id)
    if artifact.get("protected_post") != actual_rows(root, stage.get("protected_inputs")):
        problems.append(
            "%s: failure artifact protected post values are not the current files" % slot_id
        )
    capture_base = resolve(root, evidence.get("command_capture"))
    if capture_base is not None:
        if artifact.get("capture_digests") != actual_capture_digests(capture_base):
            problems.append(
                "%s: failure artifact is not bound to the six original piece digests" % slot_id
            )
    sidecar_path = resolve(root, artifact.get("sidecar"))
    if sidecar_path is None or not sidecar_path.is_file():
        problems.append("%s: failure artifact does not reference a real sidecar" % slot_id)
    else:
        if artifact.get("sidecar_sha256") != digest(sidecar_path):
            problems.append("%s: failure artifact sidecar digest mismatch" % slot_id)
        sidecar = load_json(sidecar_path, "sidecar", problems)
        if isinstance(sidecar, dict):
            if sidecar.get("run_id") != evidence.get("run_id"):
                problems.append("%s: the cited sidecar belongs to another run" % slot_id)
            if sidecar.get("capture_basename") != evidence.get("capture_basename"):
                problems.append("%s: the cited sidecar belongs to another capture" % slot_id)
            if sidecar.get("resource_status") != "CLEAN":
                problems.append(
                    "%s: the cited sidecar still holds an unsettled resource" % slot_id
                )
    cleanup = artifact.get("cleanup")
    if not isinstance(cleanup, dict):
        problems.append("%s: failure artifact has no cleanup evidence" % slot_id)
    else:
        if cleanup.get("verified") is not True:
            problems.append("%s: failure artifact cleanup is not verified" % slot_id)
        source = cleanup.get("source")
        if not isinstance(source, dict):
            problems.append("%s: failure artifact cleanup has no source reference" % slot_id)
        else:
            if source.get("resource_status") != "CLEAN":
                problems.append("%s: failure artifact cleanup source is not settled" % slot_id)
            if source.get("observed_members"):
                problems.append("%s: failure artifact cleanup source still sees members" % slot_id)
    if artifact.get("resource_status") != "CLEAN":
        problems.append(
            "%s: failure artifact was produced while the resource state was unsettled" % slot_id
        )
    if artifact.get("inner_exit") != evidence.get("expected_inner_exit"):
        problems.append(
            "%s: failure artifact inner exit does not match the expected exit" % slot_id
        )
    if artifact.get("case_passed") is not True:
        problems.append(
            "%s: failure artifact does not report the asserted case as passed" % slot_id
        )
    if assertion:
        base = resolve(root, evidence.get("command_capture"))
        log = Path(str(base) + ".txt") if base is not None else None
        if log is not None and log.is_file():
            text = log.read_text(encoding="utf-8", errors="replace")
            if assertion not in text:
                problems.append(
                    "%s: the recorded log does not contain the required assertion" % slot_id
                )


def check_capture(root, evidence, stage, problems):
    """Verify the six original recorder pieces of this exact capture."""
    slot_id = evidence.get("slot_id")
    command_id = evidence.get("command_id")
    basename = evidence.get("capture_basename")
    commands = stage.get("commands") or {}
    command = commands.get(command_id)
    if not isinstance(command, dict):
        problems.append("%s: command %s is not part of the stage release" % (slot_id, command_id))
        return None
    expected_exit = command.get("expected_inner_exit")
    if expected_exit != evidence.get("expected_inner_exit"):
        problems.append(
            "%s: the slot exit %s does not match the command exit %s"
            % (slot_id, evidence.get("expected_inner_exit"), expected_exit)
        )
    allocations = [
        allocation for allocation in (stage.get("capture_allocations") or [])
        if allocation.get("basename") == basename
    ]
    if not allocations:
        problems.append("%s: capture %s is not allocated by the stage release" % (slot_id, basename))
        return None
    allocation = allocations[0]
    if allocation.get("command_id") != command_id:
        problems.append("%s: capture %s is allocated for another command" % (slot_id, basename))
    if allocation.get("run_id") != evidence.get("run_id"):
        problems.append("%s: capture %s is allocated for another run" % (slot_id, basename))
    capture_base = resolve(root, evidence.get("command_capture"))
    if capture_base is None:
        problems.append("%s: no capture path in the evidence" % slot_id)
        return None
    if capture_base.name != basename:
        problems.append("%s: capture path basename does not match the slot" % slot_id)
    recorder_path = (stage.get("recorder") or {}).get("path")
    recorder_dir = None
    if recorder_path:
        recorder_dir = (Path(root) / recorder_path).resolve().parent
    declared_dir = allocation.get("recorder_directory")
    if declared_dir:
        declared = resolve(root, declared_dir)
        if declared is not None and recorder_dir is not None and declared.resolve() != recorder_dir:
            problems.append(
                "%s: the capture allocation is not in the original recorder directory" % slot_id
            )
    if recorder_dir is not None and capture_base.resolve().parent != recorder_dir:
        problems.append("%s: the capture is not in the original recorder directory" % slot_id)
    paths = {suffix: Path(str(capture_base) + suffix) for suffix in CAPTURE_SUFFIXES}
    for suffix, path in sorted(paths.items()):
        if not path.exists():
            problems.append("%s: capture piece %s is missing" % (slot_id, suffix))
    if any(not path.exists() for path in paths.values()):
        return None
    claim = load_json(paths[".claim.json"], "claim", problems)
    command_record = load_json(paths[".cmd.json"], "cmd", problems)
    inputs = load_json(paths[".inputs.json"], "inputs", problems)
    result = load_json(paths[".result.json"], "result", problems)
    if not isinstance(claim, dict) or not isinstance(command_record, dict):
        return None
    if not isinstance(inputs, dict) or not isinstance(result, dict):
        return None
    if claim.get("runner_version") != RECORDER_RUNNER_VERSION:
        problems.append("%s: claim runner_version is not %d" % (slot_id, RECORDER_RUNNER_VERSION))
    if claim.get("name") != basename:
        problems.append("%s: claim name does not match the capture" % slot_id)
    if claim.get("argv") != command.get("argv"):
        problems.append("%s: claim argv does not match the approved command" % slot_id)
    if command_record.get("runner_version") != RECORDER_RUNNER_VERSION:
        problems.append("%s: cmd runner_version is not %d" % (slot_id, RECORDER_RUNNER_VERSION))
    if command_record.get("argv") != command.get("argv"):
        problems.append("%s: cmd argv does not match the approved command" % slot_id)
    if command_record.get("cwd") != command.get("cwd"):
        problems.append("%s: cmd cwd does not match the approved command" % slot_id)
    pinned = {row["path"]: row["sha256"] for row in (stage.get("recorded_source") or [])}
    extra = sorted(set(inputs) - set(pinned))
    missing = sorted(set(pinned) - set(inputs))
    if extra:
        problems.append("%s: capture inputs carry extra keys %s" % (slot_id, extra))
    if missing:
        problems.append("%s: capture inputs are missing keys %s" % (slot_id, missing))
    for path, sha in sorted(pinned.items()):
        if path in inputs and inputs.get(path) != sha:
            problems.append("%s: capture input %s is stale" % (slot_id, path))
    try:
        exit_code = int(paths[".exit"].read_text().strip())
    except (OSError, ValueError):
        problems.append("%s: capture exit file is unreadable" % slot_id)
        exit_code = None
    if exit_code is not None:
        if result.get("exit") != exit_code:
            problems.append("%s: capture exit and result disagree" % slot_id)
        if exit_code != evidence.get("expected_inner_exit"):
            problems.append(
                "%s: capture inner exit %s is not the expected %s"
                % (slot_id, exit_code, evidence.get("expected_inner_exit"))
            )
    if result.get("source_changed") not in ([], None):
        problems.append("%s: the capture observed changed inputs" % slot_id)
    if result.get("source_added") not in ([], None):
        problems.append("%s: the capture observed added inputs" % slot_id)
    if digest(paths[".txt"]) != result.get("log_sha256"):
        problems.append("%s: capture log digest mismatch" % slot_id)
    return result


def check_evidence(root, case_id, evidence, release, release_path, release_sha, problems):
    alias = evidence.get("approved_stage_release")
    stage = check_stage_release(root, alias, evidence, release, release_path, release_sha, problems)
    if stage is None:
        return
    if alias == "SELF":
        stage_path = Path(release_path)
    else:
        approved = (release.get("approved_stage_releases") or {}).get(alias) or {}
        stage_path = resolve(root, approved.get("path"))
    stage_sha = digest(stage_path) if stage_path is not None and stage_path.is_file() else None
    check_capture(root, evidence, stage, problems)
    check_sidecar(root, evidence, stage, stage_sha, problems)
    requirement = evidence.get("expected_failure_requirement")
    if evidence.get("expected_inner_exit") != 0 or requirement is not None:
        check_failure_artifact(root, evidence, case_id, stage, problems)


def slot_matches(slot, evidence):
    """An evidence entry satisfies a slot only when every binding field agrees."""
    for field in ("command_id", "capture_basename", "run_id", "level", "expected_inner_exit"):
        if slot.get(field) != evidence.get(field):
            return False
    return slot.get("expected_failure_requirement") == evidence.get("expected_failure_requirement")


def release_phase(release_path):
    """The phase of a root release, used for the phase specific status."""
    try:
        release = json.loads(Path(release_path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    phase = release.get("phase") if isinstance(release, dict) else None
    return phase if phase in OUTPUT_STATUS else None


def check(release_path, release_sha256, packet_path):
    """Full metadata admission.  Returns the list of problems (empty means ready)."""
    problems = []
    release_file = Path(release_path).resolve()
    if not release_file.is_file():
        return ["release file is missing: %s" % release_path]
    actual_sha = digest(release_file)
    if actual_sha != release_sha256:
        return ["RELEASE_SHA256_MISMATCH: expected %s, actual %s" % (release_sha256, actual_sha)]
    release = load_json(release_file, "release", problems)
    if not isinstance(release, dict):
        return problems or ["release is not a JSON object"]
    if release.get("format") != RELEASE_FORMAT:
        problems.append("unsupported release format: %s" % release.get("format"))
        return problems
    phase = release.get("phase")
    if phase not in EXPECTED_PACKET_STATUS:
        problems.append("unsupported release phase: %s" % phase)
        return problems
    root = release.get("project_root")
    if not isinstance(root, str) or not os.path.isabs(root):
        problems.append("release has no absolute project_root")
        return problems
    root = Path(root)
    if not root.is_dir():
        problems.append("release project_root does not exist")
        return problems

    packet = load_json(packet_path, "packet", problems)
    if not isinstance(packet, dict):
        return problems or ["packet is not a JSON object"]
    if packet.get("format") != PACKET_FORMAT:
        problems.append("unsupported packet format: %s" % packet.get("format"))
    expected_status = EXPECTED_PACKET_STATUS[phase]
    if packet.get("status") != expected_status:
        problems.append(
            "packet status is %s, the %s root requires %s"
            % (packet.get("status"), phase, expected_status)
        )
    packet_release = packet.get("release")
    if not isinstance(packet_release, dict):
        problems.append("packet has no release reference")
    else:
        if packet_release.get("sha256") != release_sha256:
            problems.append(
                "REJECTED_PACKET_RELEASE_REPLACED: packet cites %s, the external root is %s"
                % (packet_release.get("sha256"), release_sha256)
            )
        if not same_path(root, packet_release.get("path"), str(release_file)):
            problems.append(
                "REJECTED_PACKET_RELEASE_REPLACED: packet cites %s, the external root is %s"
                % (packet_release.get("path"), release_path)
            )
    if "contract" not in packet:
        problems.append("packet has no contract binding")
    elif packet.get("contract") != release.get("contract"):
        problems.append("packet contract binding differs from the release")
    release_contract = release.get("contract") or {}
    if isinstance(release_contract, dict) and release_contract.get("path"):
        contract_path = resolve(root, release_contract.get("path"))
        if contract_path is None or not contract_path.is_file():
            problems.append("release contract file is missing: %s" % release_contract.get("path"))
        elif digest(contract_path) != release_contract.get("sha256"):
            problems.append("release contract digest mismatch")
    if packet.get("source") != release.get("recorded_source"):
        problems.append("packet source inventory differs from the authoritative release")
    if packet.get("required_cases") != release.get("required_cases"):
        problems.append("packet required cases differ from the authoritative release")
    verify_inventory(root, release.get("recorded_source"), "recorded source", problems)
    verify_inventory(root, release.get("protected_inputs"), "protected input", problems)

    required = release.get("required_cases") or []
    cases = packet.get("cases")
    if not isinstance(cases, list):
        problems.append("packet has no case inventory")
        return problems
    by_id = {}
    for row in cases:
        if not isinstance(row, dict):
            problems.append("packet case is not an object")
            continue
        case_id = row.get("id")
        if case_id in by_id:
            problems.append("duplicate case in packet: %s" % case_id)
        by_id[case_id] = row
    if set(by_id) != set(required):
        problems.append("packet case inventory does not equal the required case set")
    bindings = release.get("case_bindings") or {}
    for case_id in required:
        row = by_id.get(case_id)
        if not isinstance(row, dict):
            continue
        if row.get("implementation") != "COMPLETE":
            problems.append("%s: incomplete implementation" % case_id)
        if not row.get("production_entry") or not row.get("test_name"):
            problems.append("%s: missing production entry or test name" % case_id)
        binding = bindings.get(case_id) or {}
        slots = binding.get("required_evidence") or []
        alternatives = binding.get("alternatives") or []
        evidence_rows = row.get("evidence")
        if not isinstance(evidence_rows, list):
            problems.append("%s: case has no evidence array" % case_id)
            continue
        used = set()
        for slot in slots:
            matches = [
                index for index, item in enumerate(evidence_rows)
                if index not in used and item.get("slot_id") == slot.get("slot_id")
            ]
            if not matches:
                problems.append(
                    "REJECTED_MISSING_REQUIRED_EVIDENCE: %s has no evidence for slot %s"
                    % (case_id, slot.get("slot_id"))
                )
                continue
            satisfied = False
            for index in matches:
                item = evidence_rows[index]
                if slot_matches(slot, item):
                    satisfied = True
                    used.add(index)
                    check_evidence(root, case_id, item, release, release_file, release_sha256,
                                   problems)
                    break
                for alternative in alternatives:
                    if not isinstance(alternative, dict):
                        continue
                    if alternative.get("slot_id") != slot.get("slot_id"):
                        continue
                    if slot_matches(alternative, item):
                        satisfied = True
                        used.add(index)
                        check_evidence(root, case_id, item, release, release_file, release_sha256,
                                       problems)
                        break
                if satisfied:
                    break
            if not satisfied:
                problems.append(
                    "REJECTED_SLOT_BINDING_MISMATCH: %s slot %s is bound to another capture, "
                    "command, run or exit" % (case_id, slot.get("slot_id"))
                )
        for index, item in enumerate(evidence_rows):
            if index not in used:
                problems.append(
                    "%s: evidence entry %s does not satisfy any required slot"
                    % (case_id, item.get("slot_id"))
                )
    return problems


# ---------------------------------------------------------------------------
# synthetic self test material
# ---------------------------------------------------------------------------

def _write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _write_json(path, payload):
    _write(path, json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))


def fixture_path(fixture, *keys):
    """Resolve a declared fixture path for file I/O.

    The fixture hands out plain strings on purpose: those are the JSON paths a
    packet carries.  Only the self test file I/O resolves them into real
    paths, so a Path object never leaks into a packet.
    """
    value = fixture
    for key in keys:
        value = value[key]
    candidate = Path(value)
    if not candidate.is_absolute():
        candidate = Path(fixture["root"]) / candidate
    return candidate

def build_synthetic_fixture(root):
    """Build a complete but synthetic project with real files on disk.

    It is static metadata only.  It proves the positive and the negative
    branches of this checker; it is not a grant and it is not a product test.
    The sidecar and the failure credential carry the real piece digests and
    the real pre/post values so that the checker can compare them again.
    """
    root = Path(root)
    project = root / "project"
    recorder_rel = ("docs/execution/A/implementation-20261111/integration/"
                    "e1-main-takeover/run-recorded.py")
    sources = {
        "src/example.py": "print('example')\n",
        "contracts/example.json": "{}\n",
        "tools/example.py": "# tool\n",
        "tests/example_test.py": "# test\n",
        "package.json": "{}\n",
        "pnpm-lock.yaml": "lockfileVersion: 1\n",
        "tsconfig.json": "{}\n",
        "vitest.config.ts": "export default {}\n",
        recorder_rel: "# recorder\n",
    }
    for relative, text in sources.items():
        _write(project / relative, text)
    _write(project / "AGENTS.md", "agents\n")
    _write(project / "CONTRACT.md", "contract\n")
    recorded = [
        {"path": relative, "sha256": digest(project / relative)}
        for relative in sorted(sources)
    ]
    protected = [{"path": "AGENTS.md", "sha256": digest(project / "AGENTS.md")}]
    contract = {"path": "CONTRACT.md", "sha256": digest(project / "CONTRACT.md")}
    recorder_sha = digest(project / recorder_rel)
    recorder_dir = (project / recorder_rel).parent

    command_direct = {
        "argv": ["/usr/bin/python3.12", "-I", "-S", "-B", "tests/example_test.py"],
        "cwd": str(project),
        "runtime_class": "PURE_MOCK",
        "expected_inner_exit": 0,
        "allowed_phases": ["BOOTSTRAP_CODE"],
    }
    command_helper0 = {
        "argv": ["/usr/bin/python3.12", "-I", "-S", "-B",
                 "tests/process/fixtures/admission_helper.py", "pass"],
        "cwd": str(project),
        "runtime_class": "FINITE_TOOL_HELPER",
        "expected_inner_exit": 0,
    }
    command_helper1 = {
        "argv": ["/usr/bin/python3.12", "-I", "-S", "-B",
                 "tests/process/fixtures/admission_helper.py", "specified-fail"],
        "cwd": str(project),
        "runtime_class": "FINITE_TOOL_HELPER",
        "expected_inner_exit": 1,
    }
    l1_allocations = [
        {"basename": "example-direct-001", "command_id": "direct", "run_id": "example-run-direct",
         "phase": "BOOTSTRAP_CODE", "case_ids": ["PROC0-13", "PROC0-01"],
         "recorder_directory": str(recorder_dir)},
        {"basename": "example-direct-002", "command_id": "direct", "run_id": "example-run-direct-2",
         "phase": "BOOTSTRAP_CODE", "case_ids": ["PROC0-01"],
         "recorder_directory": str(recorder_dir)},
    ]
    l3_allocations = [
        {"basename": "example-helper-pass-001", "command_id": "helper0",
         "run_id": "example-run-pass", "phase": "TOOL_RUNTIME", "case_ids": ["PROC0-13"],
         "recorder_directory": str(recorder_dir)},
        {"basename": "example-helper-fail-001", "command_id": "helper1",
         "run_id": "example-run-fail", "phase": "TOOL_RUNTIME", "case_ids": ["PROC0-13"],
         "recorder_directory": str(recorder_dir)},
        {"basename": "example-unused-reserve-002", "command_id": "helper0",
         "run_id": "example-run-reserve", "phase": "TOOL_RUNTIME", "case_ids": ["PROC0-13"],
         "recorder_directory": str(recorder_dir)},
    ]
    l1_slots = {
        "PROC0-13": [
            {"slot_id": "L1_DIRECT", "approved_stage_release": "L1", "command_id": "direct",
             "capture_basename": "example-direct-001", "run_id": "example-run-direct",
             "level": "D1", "expected_inner_exit": 0, "expected_failure_requirement": None},
        ],
        "PROC0-01": [
            {"slot_id": "L1_DIRECT", "approved_stage_release": "L1", "command_id": "direct",
             "capture_basename": "example-direct-002", "run_id": "example-run-direct-2",
             "level": "D1", "expected_inner_exit": 0, "expected_failure_requirement": None},
        ],
    }
    l1_release = {
        "format": RELEASE_FORMAT,
        "release_id": "EXAMPLE_L1",
        "phase": "BOOTSTRAP_CODE",
        "owner_task": "example-task",
        "generation": 1,
        "project_root": str(project),
        "state_root": str(project / "var" / "process-admission"),
        "contract": contract,
        "recorder": {"path": recorder_rel, "sha256": recorder_sha},
        "recorded_source": recorded,
        "protected_inputs": protected,
        "commands": {"direct": command_direct},
        "required_cases": ["PROC0-13", "PROC0-01"],
        "case_bindings": {
            "PROC0-13": {"required_evidence": l1_slots["PROC0-13"], "alternatives": []},
            "PROC0-01": {"required_evidence": l1_slots["PROC0-01"], "alternatives": []},
        },
        "capture_allocations": l1_allocations,
    }
    l3_release = {
        "format": RELEASE_FORMAT,
        "release_id": "EXAMPLE_L3",
        "phase": "TOOL_RUNTIME",
        "owner_task": "example-task",
        "generation": 1,
        "project_root": str(project),
        "state_root": str(project / "var" / "process-admission"),
        "contract": contract,
        "recorder": {"path": recorder_rel, "sha256": recorder_sha},
        "recorded_source": recorded,
        "protected_inputs": protected,
        "commands": {"helper0": command_helper0, "helper1": command_helper1},
        "required_cases": ["PROC0-13"],
        "case_bindings": {
            "PROC0-13": {
                "required_evidence": [
                    {"slot_id": "L3_SUCCESS", "command_id": "helper0",
                     "capture_basename": "example-helper-pass-001", "run_id": "example-run-pass",
                     "level": "TOOL_RUNTIME", "expected_inner_exit": 0,
                     "expected_failure_requirement": None},
                    {"slot_id": "L3_EXPECTED_FAILURE", "command_id": "helper1",
                     "capture_basename": "example-helper-fail-001", "run_id": "example-run-fail",
                     "level": "TOOL_RUNTIME", "expected_inner_exit": 1,
                     "expected_failure_requirement": {"assertion": "TOOL_HELPER_EXPECTED_FAILURE",
                                                       "cleanup_required": True}},
                ],
                "alternatives": [],
            },
        },
        "capture_allocations": l3_allocations,
    }
    l1_path = root / "L1_STAGE.json"
    l3_path = root / "L3_STAGE.json"
    _write_json(l1_path, l1_release)
    _write_json(l3_path, l3_release)

    final_release = {
        "format": RELEASE_FORMAT,
        "release_id": "EXAMPLE_FINAL",
        "phase": "FINAL_METADATA",
        "owner_task": "example-task",
        "generation": 1,
        "project_root": str(project),
        "state_root": str(project / "var" / "process-admission"),
        "contract": contract,
        "recorder": {"path": recorder_rel, "sha256": recorder_sha},
        "recorded_source": recorded,
        "protected_inputs": protected,
        "commands": {},
        "required_cases": ["PROC0-13", "PROC0-01"],
        "case_bindings": {
            "PROC0-13": {
                "required_evidence": [
                    {"slot_id": "L1_DIRECT", "approved_stage_release": "L1", "command_id": "direct",
                     "capture_basename": "example-direct-001", "run_id": "example-run-direct",
                     "level": "D1", "expected_inner_exit": 0, "expected_failure_requirement": None},
                    {"slot_id": "L3_SUCCESS", "approved_stage_release": "L3", "command_id": "helper0",
                     "capture_basename": "example-helper-pass-001", "run_id": "example-run-pass",
                     "level": "TOOL_RUNTIME", "expected_inner_exit": 0,
                     "expected_failure_requirement": None},
                    {"slot_id": "L3_EXPECTED_FAILURE", "approved_stage_release": "L3",
                     "command_id": "helper1", "capture_basename": "example-helper-fail-001",
                     "run_id": "example-run-fail", "level": "TOOL_RUNTIME", "expected_inner_exit": 1,
                     "expected_failure_requirement": {"assertion": "TOOL_HELPER_EXPECTED_FAILURE",
                                                       "cleanup_required": True}},
                ],
                "alternatives": [],
            },
            "PROC0-01": {
                "required_evidence": [
                    {"slot_id": "L1_DIRECT", "approved_stage_release": "L1", "command_id": "direct",
                     "capture_basename": "example-direct-002", "run_id": "example-run-direct-2",
                     "level": "D1", "expected_inner_exit": 0, "expected_failure_requirement": None},
                ],
                "alternatives": [],
            },
        },
        "capture_allocations": l1_allocations + l3_allocations,
        "approved_stage_releases": {
            "L1": {
                "path": str(l1_path),
                "sha256": digest(l1_path),
                "phase": "BOOTSTRAP_CODE",
                "recorded_source": recorded,
                "protected_inputs": protected,
            },
            "L3": {
                "path": str(l3_path),
                "sha256": digest(l3_path),
                "phase": "TOOL_RUNTIME",
                "recorded_source": recorded,
                "protected_inputs": protected,
            },
        },
    }
    final_path = root / "FINAL_STAGE.json"
    _write_json(final_path, final_release)

    def write_capture(basename, command, inner_exit, run_id, layer, stage_sha,
                      command_id, assertion=None, cleanup_verified=True,
                      log_text="log line\n", resource_status="CLEAN"):
        base = recorder_dir / basename
        _write(Path(str(base) + ".claim.json"), json.dumps({
            "runner_version": RECORDER_RUNNER_VERSION, "name": basename,
            "argv": command["argv"], "claimed_at": "2026-01-01T00:00:00+00:00"}))
        _write(Path(str(base) + ".cmd.json"), json.dumps({
            "argv": command["argv"], "cwd": command["cwd"],
            "started_at": "2026-01-01T00:00:00+00:00",
            "runner_version": RECORDER_RUNNER_VERSION, "git_head": "0" * 40}))
        _write(Path(str(base) + ".inputs.json"), json.dumps(
            {row["path"]: row["sha256"] for row in recorded}, indent=2))
        _write(Path(str(base) + ".txt"), log_text)
        _write(Path(str(base) + ".exit"), "%d\n" % inner_exit)
        log_sha = digest(Path(str(base) + ".txt"))
        _write(Path(str(base) + ".result.json"), json.dumps({
            "exit": inner_exit, "source_changed": [], "source_added": [],
            "log_sha256": log_sha, "finished_at": "2026-01-01T00:00:01+00:00"}))
        capture_digests = {}
        for suffix in CAPTURE_SUFFIXES:
            piece = Path(str(base) + suffix)
            capture_digests[suffix] = digest(piece) if piece.is_file() else None
        cleanup_source = {
            "kind": "owned_group_scan",
            "pgid": 4242,
            "boot_id": "0" * 32,
            "observed_members": [],
            "vanished_entries": 0,
            "undeterminable_entries": 0,
            "resource_status": resource_status,
            "waited_returncode": inner_exit & 255,
            "scanned_at": "2026-01-01T00:00:02+00:00",
        }
        sidecar = {
            "format": "narralens.proc0-run-sidecar@1",
            "evidence_layer": layer,
            "release_sha256": stage_sha,
            "release_id": "EXAMPLE",
            "release_phase": "BOOTSTRAP_CODE" if layer == "BOOTSTRAP" else "TOOL_RUNTIME",
            "run_id": run_id,
            "command_id": command_id,
            "capture_basename": basename,
            "capture_directory": str(recorder_dir),
            "owner_task": "example-task",
            "generation": 1,
            "capture_digests": capture_digests,
            "inner_exit": inner_exit,
            "recorder_wait_returncode": inner_exit & 255,
            "source_pre": recorded,
            "source_post": recorded,
            "protected_pre": protected,
            "protected_post": protected,
            "resource_status": resource_status,
            "cleanup_source": cleanup_source,
            "epoch": {
                "recorder_pid": 4242, "recorder_start_ticks": 1, "recorder_ppid": 1,
                "recorder_pgid": 4242, "recorder_sid": 4242, "boot_id": "0" * 32,
                "identity_inferred": False,
            },
            "identity_persist": {"persisted": True},
            "metadata_ok": True,
            "metadata_problems": [],
            "created_at": "2026-01-01T00:00:02+00:00",
        }
        sidecar_path = root / (basename + ".sidecar.json")
        _write_json(sidecar_path, sidecar)
        artifact_path = None
        if assertion is not None:
            artifact_path = root / (basename + ".failure.json")
            _write_json(artifact_path, {
                "format": "narralens.proc0-failure-credential@1",
                "case_id": "PROC0-13",
                "capture_basename": basename,
                "run_id": run_id,
                "command_id": command_id,
                "assertion": assertion,
                "expected_failure_requirement": {"assertion": assertion, "cleanup_required": True},
                "inner_exit": inner_exit,
                "expected_inner_exit": inner_exit,
                "recorder_wait_returncode": inner_exit & 255,
                "source": recorded,
                "source_post": recorded,
                "protected": protected,
                "protected_post": protected,
                "capture_digests": capture_digests,
                "sidecar": str(sidecar_path),
                "sidecar_sha256": digest(sidecar_path),
                "cleanup": {
                    "required": True,
                    "verified": cleanup_verified,
                    "source": cleanup_source,
                },
                "resource_status": resource_status,
                "problems": [],
                "source_drift": [],
                "case_passed": cleanup_verified,
                "created_at": "2026-01-01T00:00:02+00:00",
            })
        return {
            "slot_capture": str(base),
            "sidecar": str(sidecar_path),
            "artifact": str(artifact_path) if artifact_path else None,
        }

    l1_sha = digest(l1_path)
    l3_sha = digest(l3_path)
    direct_one = write_capture("example-direct-001", command_direct, 0, "example-run-direct",
                                "BOOTSTRAP", l1_sha, "direct")
    direct_two = write_capture("example-direct-002", command_direct, 0, "example-run-direct-2",
                                "BOOTSTRAP", l1_sha, "direct")
    helper_pass = write_capture("example-helper-pass-001", command_helper0, 0, "example-run-pass",
                                 "TOOL_RUNTIME", l3_sha, "helper0")
    helper_fail = write_capture(
        "example-helper-fail-001", command_helper1, 1, "example-run-fail", "TOOL_RUNTIME",
        l3_sha, "helper1", assertion="TOOL_HELPER_EXPECTED_FAILURE",
        log_text="TOOL_HELPER_EXPECTED_FAILURE\n")
    l1_block = {
        "path": str(l1_path), "sha256": l1_sha, "phase": "BOOTSTRAP_CODE",
        "recorded_source": recorded, "protected_inputs": protected,
    }
    l3_block = {
        "path": str(l3_path), "sha256": l3_sha, "phase": "TOOL_RUNTIME",
        "recorded_source": recorded, "protected_inputs": protected,
    }
    packet = {
        "format": PACKET_FORMAT,
        "status": "READY_FOR_REVIEW",
        "release": {"path": str(final_path), "sha256": digest(final_path)},
        "contract": contract,
        "source": recorded,
        "required_cases": ["PROC0-13", "PROC0-01"],
        "cases": [
            {
                "id": "PROC0-13",
                "implementation": "COMPLETE",
                "production_entry": "tools/run-delivery.py::run",
                "test_name": "synthetic example, not executed",
                "evidence": [
                    {
                        "slot_id": "L1_DIRECT", "approved_stage_release": "L1", "command_id": "direct",
                        "capture_basename": "example-direct-001", "run_id": "example-run-direct",
                        "level": "D1", "expected_inner_exit": 0, "expected_failure_requirement": None,
                        "stage_release": l1_block,
                        "command_capture": direct_one["slot_capture"],
                        "sidecar": direct_one["sidecar"],
                        "expected_failure_artifact": None,
                    },
                    {
                        "slot_id": "L3_SUCCESS", "approved_stage_release": "L3", "command_id": "helper0",
                        "capture_basename": "example-helper-pass-001", "run_id": "example-run-pass",
                        "level": "TOOL_RUNTIME", "expected_inner_exit": 0,
                        "expected_failure_requirement": None,
                        "stage_release": l3_block,
                        "command_capture": helper_pass["slot_capture"],
                        "sidecar": helper_pass["sidecar"],
                        "expected_failure_artifact": None,
                    },
                    {
                        "slot_id": "L3_EXPECTED_FAILURE", "approved_stage_release": "L3",
                        "command_id": "helper1", "capture_basename": "example-helper-fail-001",
                        "run_id": "example-run-fail", "level": "TOOL_RUNTIME", "expected_inner_exit": 1,
                        "expected_failure_requirement": {"assertion": "TOOL_HELPER_EXPECTED_FAILURE",
                                                          "cleanup_required": True},
                        "stage_release": l3_block,
                        "command_capture": helper_fail["slot_capture"],
                        "sidecar": helper_fail["sidecar"],
                        "expected_failure_artifact": helper_fail["artifact"],
                    },
                ],
            },
            {
                "id": "PROC0-01",
                "implementation": "COMPLETE",
                "production_entry": "tools/run-delivery.py::run",
                "test_name": "synthetic example, not executed",
                "evidence": [
                    {
                        "slot_id": "L1_DIRECT", "approved_stage_release": "L1", "command_id": "direct",
                        "capture_basename": "example-direct-002", "run_id": "example-run-direct-2",
                        "level": "D1", "expected_inner_exit": 0, "expected_failure_requirement": None,
                        "stage_release": l1_block,
                        "command_capture": direct_two["slot_capture"],
                        "sidecar": direct_two["sidecar"],
                        "expected_failure_artifact": None,
                    },
                ],
            },
        ],
    }
    packet_path = root / "PACKET.json"
    _write_json(packet_path, packet)

    l1_packet = {
        "format": PACKET_FORMAT,
        "status": "CODE_CANDIDATE_FOR_REVIEW",
        "release": {"path": str(l1_path), "sha256": l1_sha},
        "contract": contract,
        "source": recorded,
        "required_cases": ["PROC0-13", "PROC0-01"],
        "cases": [
            {
                "id": "PROC0-13",
                "implementation": "COMPLETE",
                "production_entry": "tools/run-delivery.py::run",
                "test_name": "synthetic example, not executed",
                "evidence": [
                    {
                        "slot_id": "L1_DIRECT", "approved_stage_release": "SELF",
                        "command_id": "direct", "capture_basename": "example-direct-001",
                        "run_id": "example-run-direct", "level": "D1", "expected_inner_exit": 0,
                        "expected_failure_requirement": None,
                        "stage_release": l1_block,
                        "command_capture": direct_one["slot_capture"],
                        "sidecar": direct_one["sidecar"],
                        "expected_failure_artifact": None,
                    },
                ],
            },
            {
                "id": "PROC0-01",
                "implementation": "COMPLETE",
                "production_entry": "tools/run-delivery.py::run",
                "test_name": "synthetic example, not executed",
                "evidence": [
                    {
                        "slot_id": "L1_DIRECT", "approved_stage_release": "SELF",
                        "command_id": "direct", "capture_basename": "example-direct-002",
                        "run_id": "example-run-direct-2", "level": "D1", "expected_inner_exit": 0,
                        "expected_failure_requirement": None,
                        "stage_release": l1_block,
                        "command_capture": direct_two["slot_capture"],
                        "sidecar": direct_two["sidecar"],
                        "expected_failure_artifact": None,
                    },
                ],
            },
        ],
    }
    l1_packet_path = root / "L1_PACKET.json"
    _write_json(l1_packet_path, l1_packet)

    return {
        "root": root,
        "project": project,
        "release_path": final_path,
        "release_sha": digest(final_path),
        "release": final_release,
        "packet_path": packet_path,
        "packet": packet,
        "l1_release_path": l1_path,
        "l1_release_sha": l1_sha,
        "l1_packet_path": l1_packet_path,
        "l1_packet": l1_packet,
        "recorded_source": recorded,
        "protected_inputs": protected,
        "recorder_dir": recorder_dir,
        "captures": {
            "example-direct-001": direct_one,
            "example-direct-002": direct_two,
            "example-helper-pass-001": helper_pass,
            "example-helper-fail-001": helper_fail,
        },
    }


def self_test():
    """Synthetic positive and negative metadata branches of this exact checker."""
    import copy
    results = {}
    with tempfile.TemporaryDirectory(prefix="narralens-proc0-checker-") as tmp:
        fixture = build_synthetic_fixture(Path(tmp))
        packet = fixture["packet"]
        packet_path = fixture["packet_path"]
        release_path = fixture["release_path"]
        release_sha = fixture["release_sha"]

        problems = check(release_path, release_sha, packet_path)
        if problems:
            raise AssertionError("complete packet must be admitted: %s" % problems)
        results["complete_packet_admitted"] = True

        problems = check(fixture["l1_release_path"], fixture["l1_release_sha"],
                         fixture["l1_packet_path"])
        if problems:
            raise AssertionError("the L1 packet must be admitted for its own level: %s" % problems)
        if release_phase(fixture["l1_release_path"]) != "BOOTSTRAP_CODE":
            raise AssertionError("the L1 root must stay on the L1 phase")
        results["l1_packet_admitted"] = True

        def snapshot():
            data = {}
            paths = list(fixture["recorder_dir"].glob("*"))
            paths += list(fixture["root"].glob("*.json"))
            for path in paths:
                if path.is_file():
                    data[path] = path.read_bytes()
            return data

        def restore(data):
            for path, blob in data.items():
                path.write_bytes(blob)

        def assert_positive_admitted(label):
            """The positives stay admissible around every negative: a negative
            that passes because an earlier negative left a broken state behind
            would be a false green.
            """
            admitted = check(release_path, release_sha, packet_path)
            if admitted:
                raise AssertionError("positive not admissible around %s: %s" % (label, admitted))
            l1 = check(fixture["l1_release_path"], fixture["l1_release_sha"], fixture["l1_packet_path"])
            if l1:
                raise AssertionError("L1 positive not admissible around %s: %s" % (label, l1))

        def reject(label, mutate, root=None, sha=None, target=None):
            assert_positive_admitted(label)
            broken = copy.deepcopy(packet)
            before = snapshot()
            try:
                mutate(broken)
                path = fixture["root"] / ("packet-%s.json" % label)
                _write_json(path, broken)
                found = check(root or release_path, sha or release_sha, target or path)
                if not found:
                    raise AssertionError("%s must be rejected" % label)
                results[label] = found[0]
            finally:
                restore(before)
            assert_positive_admitted(label)

        def drop_slot(slot_id):
            def mutate(broken):
                for case in broken["cases"]:
                    if case["id"] == "PROC0-13":
                        case["evidence"] = [row for row in case["evidence"]
                                            if row["slot_id"] != slot_id]
            return mutate

        reject("missing_l1_direct", drop_slot("L1_DIRECT"))
        reject("missing_l3_success", drop_slot("L3_SUCCESS"))
        reject("missing_l3_expected_failure", drop_slot("L3_EXPECTED_FAILURE"))

        def substitute_success(broken):
            for case in broken["cases"]:
                if case["id"] == "PROC0-13":
                    for row in case["evidence"]:
                        if row["slot_id"] == "L3_EXPECTED_FAILURE":
                            row["capture_basename"] = "example-helper-pass-001"
                            row["run_id"] = "example-run-pass"
                            row["command_id"] = "helper0"
                            row["expected_inner_exit"] = 0
                            row["expected_failure_requirement"] = None
                            row["command_capture"] = \
                                fixture["captures"]["example-helper-pass-001"]["slot_capture"]
                            row["sidecar"] = fixture["captures"]["example-helper-pass-001"]["sidecar"]
                            row["expected_failure_artifact"] = None
        reject("success_substitutes_failure", substitute_success)

        def unapproved_stage(broken):
            for case in broken["cases"]:
                if case["id"] == "PROC0-13":
                    for row in case["evidence"]:
                        if row["slot_id"] == "L3_SUCCESS":
                            row["stage_release"] = {
                                "path": str(fixture["root"] / "unauthorized-same-source-release.json"),
                                "sha256": "b" * 64,
                                "phase": "TOOL_RUNTIME",
                                "recorded_source": fixture["recorded_source"],
                                "protected_inputs": fixture["protected_inputs"],
                            }
        reject("unapproved_same_source_stage", unapproved_stage)

        def swap_captures(broken):
            by_case = {case["id"]: case for case in broken["cases"]}
            first = by_case["PROC0-13"]["evidence"][0]
            second = by_case["PROC0-01"]["evidence"][0]
            first["capture_basename"], second["capture_basename"] = (
                second["capture_basename"], first["capture_basename"])
            first["run_id"], second["run_id"] = second["run_id"], first["run_id"]
            first["command_capture"], second["command_capture"] = (
                second["command_capture"], first["command_capture"])
            first["sidecar"], second["sidecar"] = second["sidecar"], first["sidecar"]
        reject("swapped_case_captures", swap_captures)

        def extra_input_key(broken):
            path = fixture["recorder_dir"] / "example-direct-001.inputs.json"
            inputs = json.loads(path.read_text())
            inputs["extra/file.py"] = "0" * 64
            _write_json(path, inputs)
        reject("extra_capture_input_key", extra_input_key)

        def wrong_cwd(broken):
            path = fixture["recorder_dir"] / "example-direct-001.cmd.json"
            record = json.loads(path.read_text())
            record["cwd"] = "/somewhere/else"
            _write_json(path, record)
        reject("capture_cwd_mismatch", wrong_cwd)

        def tampered_exit(broken):
            path = fixture["recorder_dir"] / "example-direct-001.exit"
            _write(path, "3\n")
        reject("tampered_capture_exit", tampered_exit)

        def outer_mismatch(broken):
            path = fixture_path(fixture, "captures", "example-direct-001", "sidecar")
            sidecar = json.loads(path.read_text())
            sidecar["recorder_wait_returncode"] = 7
            _write_json(path, sidecar)
        reject("recorder_outer_mismatch", outer_mismatch)

        def trim_source(broken):
            broken["source"] = broken["source"][:-1]
        reject("trimmed_source_inventory", trim_source)

        def trim_cases(broken):
            broken["required_cases"] = ["PROC0-13"]
            broken["cases"] = [case for case in broken["cases"] if case["id"] == "PROC0-13"]
        reject("trimmed_case_inventory", trim_cases)

        def replace_release_reference(broken):
            broken["release"] = {"path": str(fixture["release_path"]), "sha256": "c" * 64}
        reject("replaced_release_reference", replace_release_reference)

        def foreign_failure_artifact(broken):
            for case in broken["cases"]:
                if case["id"] == "PROC0-13":
                    for row in case["evidence"]:
                        if row["slot_id"] == "L3_EXPECTED_FAILURE":
                            row["expected_failure_artifact"] = fixture["captures"][
                                "example-helper-pass-001"]["sidecar"]
        reject("foreign_failure_artifact", foreign_failure_artifact)

        def missing_assertion_in_log(broken):
            path = fixture["recorder_dir"] / "example-helper-fail-001.txt"
            _write(path, "nothing to see here\n")
        reject("assertion_missing_from_log", missing_assertion_in_log)

        def missing_contract(broken):
            broken.pop("contract", None)
        reject("missing_contract_binding", missing_contract)

        def l1_status_on_final_root(broken):
            broken["status"] = "CODE_CANDIDATE_FOR_REVIEW"
        reject("l1_status_on_final_root", l1_status_on_final_root)

        def missing_sidecar(broken):
            for case in broken["cases"]:
                if case["id"] == "PROC0-13":
                    for row in case["evidence"]:
                        if row["slot_id"] == "L1_DIRECT":
                            row["sidecar"] = str(fixture["root"] / "absent-sidecar.json")
        reject("missing_sidecar", missing_sidecar)

        def sidecar_digest_mismatch(broken):
            path = fixture_path(fixture, "captures", "example-direct-001", "sidecar")
            sidecar = json.loads(path.read_text())
            sidecar["capture_digests"][".exit"] = "0" * 64
            _write_json(path, sidecar)
        reject("sidecar_capture_digest_mismatch", sidecar_digest_mismatch)

        def sidecar_protected_post_mismatch(broken):
            path = fixture_path(fixture, "captures", "example-direct-001", "sidecar")
            sidecar = json.loads(path.read_text())
            sidecar["protected_post"][0]["sha256"] = "1" * 64
            _write_json(path, sidecar)
        reject("sidecar_protected_post_mismatch", sidecar_protected_post_mismatch)

        def sidecar_unsettled_resource(broken):
            path = fixture_path(fixture, "captures", "example-direct-001", "sidecar")
            sidecar = json.loads(path.read_text())
            sidecar["resource_status"] = "UNKNOWN"
            sidecar["cleanup_source"]["resource_status"] = "UNKNOWN"
            _write_json(path, sidecar)
        reject("sidecar_unsettled_resource", sidecar_unsettled_resource)

        def credential_claims_unknown_cleanup(broken):
            path = fixture_path(fixture, "captures", "example-helper-fail-001", "artifact")
            credential = json.loads(path.read_text())
            credential["resource_status"] = "UNKNOWN"
            credential["cleanup"]["source"]["resource_status"] = "UNKNOWN"
            credential["cleanup"]["verified"] = True
            credential["case_passed"] = True
            _write_json(path, credential)
        reject("credential_claims_unknown_cleanup", credential_claims_unknown_cleanup)

        def credential_without_cleanup_source(broken):
            path = fixture_path(fixture, "captures", "example-helper-fail-001", "artifact")
            credential = json.loads(path.read_text())
            credential["cleanup"].pop("source", None)
            _write_json(path, credential)
        reject("credential_without_cleanup_source", credential_without_cleanup_source)

        def credential_sidecar_digest_mismatch(broken):
            path = fixture_path(fixture, "captures", "example-helper-fail-001", "artifact")
            credential = json.loads(path.read_text())
            credential["sidecar_sha256"] = "2" * 64
            _write_json(path, credential)
        reject("credential_sidecar_digest_mismatch", credential_sidecar_digest_mismatch)

        if check(release_path, "0" * 64, packet_path):
            results["wrong_external_sha_rejected"] = True
        else:
            raise AssertionError("a wrong external release digest must be rejected")

        if check(fixture["root"] / "missing-release.json", release_sha, packet_path):
            results["missing_release_rejected"] = True
        else:
            raise AssertionError("a missing release file must be rejected")

    return {
        "scope": "SYNTHETIC_METADATA_ONLY",
        "negative_branches": sorted(results),
        "business_acceptance": False,
        "note": "metadata admission only; no product, runtime or review acceptance is implied",
    }


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="check-delivery-spec.py",
        description="PROC-0 metadata admission checker (never a business or runtime acceptance)",
    )
    parser.add_argument("--release", type=str)
    parser.add_argument("--expected-release-sha256", type=str)
    parser.add_argument("--packet", type=str)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args(argv)

    if args.self_test:
        try:
            print(json.dumps(self_test(), ensure_ascii=False, indent=2, sort_keys=True))
        except AssertionError as error:
            print(json.dumps({"scope": "SYNTHETIC_METADATA_ONLY", "status": "FAILED",
                              "detail": str(error), "business_acceptance": False},
                             ensure_ascii=False, indent=2, sort_keys=True))
            raise SystemExit(2)
        raise SystemExit(0)

    if not args.release or not args.expected_release_sha256 or not args.packet:
        parser.error(
            "--release, --expected-release-sha256 and --packet are required "
            "(only --self-test may run without the external MAIN trust root)"
        )

    try:
        problems = check(args.release, args.expected_release_sha256, args.packet)
    except (OSError, ValueError, TypeError, KeyError) as error:
        problems = ["unreadable/incomplete metadata: " + type(error).__name__]
    phase = release_phase(args.release)
    if problems:
        status = "REJECTED"
    else:
        status = OUTPUT_STATUS.get(phase, "REJECTED")
    print(json.dumps({
        "status": status,
        "release_phase": phase,
        "problems": problems,
        "business_acceptance": False,
        "note": "metadata readiness is only a review admission, never a product verdict",
    }, ensure_ascii=False, indent=2, sort_keys=True))
    raise SystemExit(2 if problems else 0)


if __name__ == "__main__":
    main()
