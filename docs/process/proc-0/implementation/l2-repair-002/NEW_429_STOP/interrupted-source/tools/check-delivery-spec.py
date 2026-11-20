#!/usr/bin/env python3
"""PROC-0 delivery metadata admission checker.

Metadata admission only.  It never certifies business, runtime or review
acceptance, and it never turns a recorded exit code into a product verdict.

The only trust root is the external MAIN release path plus the SHA-256 that
MAIN expects for it.  A packet can never replace that root, and a packet can
never approve a historical stage release that the final MAIN release did not
approve.

Every artefact location is derived from the approved stage, its allocation and
the fixed naming of the artefact root before any content is read.  A location
that does not match is refused without reading it.

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
PROJECT_ARTEFACT_DIRNAME = ("var", "process-admission")
AUTHORITY_DIRNAME = "authority"
JOURNAL_FILENAME = "journal.jsonl"
BOOTSTRAP_DIRNAME = "bootstrap"
SIDECARS_DIRNAME = "sidecars"
CREDENTIALS_DIRNAME = "credentials"
RECEIPTS_DIRNAME = "receipts"
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


def canonical_within(base, candidate):
    """True when candidate really stays inside base (a symlink escape fails)."""
    try:
        base_real = Path(base).resolve()
        candidate_real = Path(candidate).resolve()
    except OSError:
        return False
    try:
        candidate_real.relative_to(base_real)
    except ValueError:
        return False
    return True


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


def is_safe_basename(name):
    """Non empty ASCII [A-Za-z0-9_-], the only shape a run or capture id may take."""
    if not isinstance(name, str) or name == "":
        return False
    if not all(ord(ch) < 128 for ch in name):
        return False
    return all(ch.isalnum() or ch in "-_" for ch in name)


def project_artefact_root(project_root):
    return Path(project_root).joinpath(*PROJECT_ARTEFACT_DIRNAME)


def authority_root(project_root):
    """The one admission authority of a project; a ticket never moves it."""
    return project_artefact_root(project_root) / AUTHORITY_DIRNAME


def derive_journal_path(project_root):
    return authority_root(project_root) / JOURNAL_FILENAME


def stage_artefact_root(stage):
    return Path(stage["state_root"])


def derive_capture_paths(project_root, stage, allocation):
    """The only location of the original capture pieces."""
    recorder = (Path(project_root) / stage["recorder"]["path"]).resolve().parent
    return recorder, recorder / allocation["basename"]


def derive_sidecar_path(stage, run_id):
    """The only location of the run sidecar of this stage."""
    root = stage_artefact_root(stage)
    if stage.get("phase") == "BOOTSTRAP_CODE":
        return root / BOOTSTRAP_DIRNAME / (run_id + ".json")
    return root / SIDECARS_DIRNAME / (run_id + ".json")


def derive_credential_path(stage, run_id):
    return stage_artefact_root(stage) / CREDENTIALS_DIRNAME / (run_id + ".json")


def derive_receipt_path(stage, run_id):
    return stage_artefact_root(stage) / RECEIPTS_DIRNAME / (run_id + ".json")


def actual_capture_digests(capture_base):
    """The real digest of every original capture piece (None when absent)."""
    digests = {}
    for suffix in CAPTURE_SUFFIXES:
        path = Path(str(capture_base) + suffix)
        digests[suffix] = digest(path) if path.is_file() else None
    return digests


def actual_rows(root, rows):
    """The real digests of a pinned set right now, for pre/post comparison."""
    root = Path(root)
    observed = []
    for row in rows or []:
        path = Path(row["path"])
        if not path.is_absolute():
            path = root / path
        observed.append({
            "path": row["path"],
            "sha256": digest(path) if path.is_file() else None,
        })
    return observed


def verify_inventory(root, rows, label, problems):
    """Every pinned path must exist with the pinned digest."""
    root = Path(root)
    for row in rows or []:
        if not isinstance(row, dict) or not isinstance(row.get("path"), str):
            problems.append("%s row is not a {path, sha256} object" % label)
            continue
        path = Path(row["path"])
        if not path.is_absolute():
            path = root / path
        if not path.is_file():
            problems.append("%s missing on disk: %s" % (label, row["path"]))
            continue
        if digest(path) != row.get("sha256"):
            problems.append("%s digest mismatch: %s" % (label, row["path"]))


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


def read_journal_events(project_root):
    """The committed events of the one authority journal."""
    path = derive_journal_path(project_root)
    events = []
    if not path.exists():
        return events
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                events.append(json.loads(line))
            except ValueError:
                continue
    except OSError:
        return events
    return events


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
    if digest(stage_path) != approved.get("sha256"):
        problems.append("approved stage release digest mismatch: %s" % approved.get("path"))
        return None
    stage = load_json(stage_path, "stage release", problems)
    if not isinstance(stage, dict):
        problems.append("stage release is not a JSON object: %s" % approved.get("path"))
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
    state_root = stage.get("state_root")
    if not isinstance(state_root, str) or not os.path.isabs(state_root):
        problems.append("stage release has no absolute artefact root")
    elif not canonical_within(project_artefact_root(root), state_root):
        problems.append(
            "stage release artefact root is outside the project artefact area: %s" % state_root
        )
    if not isinstance(stage.get("commands"), dict) or not stage["commands"]:
        problems.append("stage release has no commands")
    if not isinstance(stage.get("capture_allocations"), list):
        problems.append("stage release has no capture allocations")
    return stage


def check_slot_chain(case_id, evidence, slot, stage, problems):
    """The slot must agree with the stage allocation on every binding field."""
    slot_id = evidence.get("slot_id")
    if slot.get("approved_stage_release") != evidence.get("approved_stage_release"):
        problems.append("%s: the slot names another stage alias" % slot_id)
    if not is_safe_basename(evidence.get("capture_basename")):
        problems.append("%s: the capture basename is not a safe name" % slot_id)
    if not is_safe_basename(evidence.get("run_id")):
        problems.append("%s: the run id is not a safe name" % slot_id)
    allocations = [
        allocation for allocation in (stage.get("capture_allocations") or [])
        if allocation.get("basename") == evidence.get("capture_basename")
    ]
    if not allocations:
        problems.append(
            "%s: capture %s is not allocated by the stage release"
            % (slot_id, evidence.get("capture_basename"))
        )
        return None
    allocation = allocations[0]
    if allocation.get("command_id") != evidence.get("command_id"):
        problems.append("%s: the allocation belongs to another command" % slot_id)
    if allocation.get("run_id") != evidence.get("run_id"):
        problems.append("%s: the allocation belongs to another run" % slot_id)
    if case_id not in (allocation.get("case_ids") or []):
        problems.append("%s: the allocation does not cover this case" % slot_id)
    if allocation.get("phase") and allocation["phase"] != stage.get("phase"):
        problems.append("%s: the allocation belongs to another phase" % slot_id)
    return allocation


def _epoch_value(epoch, *names):
    for name in names:
        if epoch.get(name) is not None:
            return epoch[name]
    return None


def check_sidecar(root, evidence, stage, stage_sha, problems):
    """The sidecar is read only at its derived location and must close the chain."""
    slot_id = evidence.get("slot_id")
    expected_path = derive_sidecar_path(stage, evidence.get("run_id"))
    declared = evidence.get("sidecar")
    if not isinstance(declared, str) or declared == "":
        problems.append("%s: no sidecar path in the evidence" % slot_id)
        return None
    if not same_path(root, declared, str(expected_path)):
        problems.append(
            "%s: the sidecar path is not the derived location %s" % (slot_id, expected_path)
        )
        return None
    if not canonical_within(stage_artefact_root(stage), expected_path):
        problems.append("%s: the sidecar path escapes the artefact root" % slot_id)
        return None
    if not expected_path.is_file():
        problems.append("%s: sidecar is missing (%s)" % (slot_id, expected_path))
        return None
    sidecar = load_json(expected_path, "sidecar", problems)
    if not isinstance(sidecar, dict):
        problems.append("%s: the sidecar is not a JSON object" % slot_id)
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
        if evidence.get("level") not in ("D0", "D1"):
            problems.append(
                "%s: bootstrap evidence must sit on a D0/D1 level, found %s"
                % (slot_id, evidence.get("level"))
            )
    elif phase == "TOOL_RUNTIME":
        if layer not in TOOL_RUNTIME_LAYERS:
            problems.append(
                "%s: tool runtime slot needs a TOOL_RUNTIME sidecar, found %s" % (slot_id, layer)
            )
        if evidence.get("level") != "TOOL_RUNTIME":
            problems.append(
                "%s: tool runtime evidence must sit on the TOOL_RUNTIME level, found %s"
                % (slot_id, evidence.get("level"))
            )
    else:
        problems.append("%s: unsupported stage phase %s" % (slot_id, phase))
    if sidecar.get("source_pre") != stage.get("recorded_source"):
        problems.append("%s: sidecar source pre values differ from the stage release" % slot_id)
    if sidecar.get("protected_pre") != stage.get("protected_inputs"):
        problems.append("%s: sidecar protected pre values differ from the stage release" % slot_id)
    if sidecar.get("source_post") != actual_rows(root, stage.get("recorded_source")):
        problems.append("%s: sidecar source post values are not the current files" % slot_id)
    if sidecar.get("protected_post") != actual_rows(root, stage.get("protected_inputs")):
        problems.append("%s: sidecar protected post values are not the current files" % slot_id)
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
    epoch = sidecar.get("recorder_epoch")
    if not isinstance(epoch, dict):
        epoch = sidecar.get("epoch")
    if not isinstance(epoch, dict):
        problems.append("%s: the sidecar carries no recorder epoch" % slot_id)
    else:
        if epoch.get("identity_verified") is False:
            problems.append("%s: the recorder epoch is not verified" % slot_id)
        for label, names in (("pid", ("pid",)), ("start_ticks", ("start_ticks",)),
                             ("session", ("session", "sid")), ("group", ("group", "pgid"))):
            if _epoch_value(epoch, *names) in (None, ""):
                problems.append("%s: the recorder epoch lacks %s" % (slot_id, label))
    if sidecar.get("boot_id") in (None, "") and _epoch_value(epoch or {}, "boot_id") in (None, ""):
        problems.append("%s: the sidecar carries no boot identity" % slot_id)
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
                "%s: recorder outer exit %s does not encode inner exit %s"
                % (slot_id, outer, inner)
            )
    return sidecar


def check_capture(root, evidence, stage, allocation, problems):
    """The six original recorder pieces, read only at the derived location."""
    slot_id = evidence.get("slot_id")
    if allocation is None:
        return None
    recorder_dir, capture_base = derive_capture_paths(root, stage, allocation)
    declared = evidence.get("command_capture")
    if not isinstance(declared, str) or declared == "":
        problems.append("%s: no capture path in the evidence" % slot_id)
        return None
    if not same_path(root, declared, str(capture_base)):
        problems.append(
            "%s: the capture path is not the derived location %s" % (slot_id, capture_base)
        )
        return None
    if not canonical_within(recorder_dir, capture_base):
        problems.append("%s: the capture path escapes the recorder directory" % slot_id)
        return None
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
    if not isinstance(claim, dict):
        problems.append("%s: the capture claim is not a JSON object" % slot_id)
        claim = {}
    if not isinstance(command_record, dict):
        problems.append("%s: the capture cmd is not a JSON object" % slot_id)
        command_record = {}
    if not isinstance(inputs, dict):
        problems.append("%s: the capture inputs are not a JSON object" % slot_id)
        inputs = {}
    if not isinstance(result, dict):
        problems.append("%s: the capture result is not a JSON object" % slot_id)
        result = {}
    command = (stage.get("commands") or {}).get(evidence.get("command_id"))
    if not isinstance(command, dict):
        problems.append(
            "%s: command %s is not part of the stage release"
            % (slot_id, evidence.get("command_id"))
        )
        return None
    if command.get("expected_inner_exit") != evidence.get("expected_inner_exit"):
        problems.append(
            "%s: the slot exit %s does not match the command exit %s"
            % (slot_id, evidence.get("expected_inner_exit"), command.get("expected_inner_exit"))
        )
    if claim.get("runner_version") != RECORDER_RUNNER_VERSION:
        problems.append("%s: claim runner_version is not %d" % (slot_id, RECORDER_RUNNER_VERSION))
    if claim.get("name") != evidence.get("capture_basename"):
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
    result["inner_exit_actual"] = exit_code
    return result


def check_failure_artifact(root, case_id, evidence, stage, capture_result, sidecar, problems):
    """A non-zero expectation needs a credential bound to this exact run."""
    slot_id = evidence.get("slot_id")
    expected_path = derive_credential_path(stage, evidence.get("run_id"))
    declared = evidence.get("expected_failure_artifact")
    if not isinstance(declared, str) or declared == "":
        problems.append("%s: a non-zero expectation needs an expected failure artifact" % slot_id)
        return None
    if not same_path(root, declared, str(expected_path)):
        problems.append(
            "%s: the failure artifact path is not the derived location %s"
            % (slot_id, expected_path)
        )
        return None
    if not canonical_within(stage_artefact_root(stage), expected_path):
        problems.append("%s: the failure artifact path escapes the artefact root" % slot_id)
        return None
    if not expected_path.is_file():
        problems.append("%s: the expected failure artifact is missing" % slot_id)
        return None
    artifact = load_json(expected_path, "expected failure artifact", problems)
    if not isinstance(artifact, dict):
        problems.append("%s: the failure artifact is not a JSON object" % slot_id)
        return None
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
    allocation = None
    for candidate in (stage.get("capture_allocations") or []):
        if candidate.get("basename") == evidence.get("capture_basename"):
            allocation = candidate
            break
    if allocation is not None:
        _recorder_dir, capture_base = derive_capture_paths(root, stage, allocation)
        if artifact.get("capture_digests") != actual_capture_digests(capture_base):
            problems.append(
                "%s: failure artifact is not bound to the six original piece digests" % slot_id
            )
    expected_sidecar = derive_sidecar_path(stage, evidence.get("run_id"))
    if not same_path(root, artifact.get("sidecar"), str(expected_sidecar)):
        problems.append("%s: failure artifact does not reference the verified sidecar" % slot_id)
    elif expected_sidecar.is_file():
        if artifact.get("sidecar_sha256") != digest(expected_sidecar):
            problems.append("%s: failure artifact sidecar digest mismatch" % slot_id)
    if sidecar is not None:
        cleanup = artifact.get("cleanup")
        if not isinstance(cleanup, dict):
            problems.append("%s: failure artifact has no cleanup evidence" % slot_id)
        else:
            if cleanup.get("verified") is not True:
                problems.append("%s: failure artifact cleanup is not verified" % slot_id)
            source = cleanup.get("source")
            if not isinstance(source, dict):
                problems.append("%s: failure artifact cleanup has no source reference" % slot_id)
            elif source.get("resource_status") != "CLEAN":
                problems.append("%s: failure artifact cleanup source is not settled" % slot_id)
            elif source.get("observed_members"):
                problems.append("%s: failure artifact cleanup source still sees members" % slot_id)
            elif sidecar is not None:
                observed = sidecar.get("cleanup_source") or {}
                for field in ("kind", "pgid", "observed_members", "undeterminable_entries",
                              "resource_status"):
                    if source.get(field) != observed.get(field):
                        problems.append(
                            "%s: the failure artifact cleanup source differs from the sidecar"
                            % slot_id
                        )
                        break
    if artifact.get("resource_status") != "CLEAN":
        problems.append(
            "%s: failure artifact was produced while the resource state was unsettled" % slot_id
        )
    if artifact.get("inner_exit") != evidence.get("expected_inner_exit"):
        problems.append(
            "%s: failure artifact inner exit does not match the expected exit" % slot_id
        )
    if isinstance(capture_result, dict):
        actual_inner = capture_result.get("inner_exit_actual")
        if actual_inner is not None and artifact.get("inner_exit") != actual_inner:
            problems.append(
                "%s: failure artifact inner exit does not match the original capture" % slot_id
            )
    if artifact.get("case_passed") is not True:
        problems.append(
            "%s: failure artifact does not report the asserted case as passed" % slot_id
        )
    if assertion:
        if artifact.get("assertion_reached") is not True:
            problems.append(
                "%s: failure artifact does not show the assertion was reached" % slot_id
            )
        base = None
        for candidate in (stage.get("capture_allocations") or []):
            if candidate.get("basename") == evidence.get("capture_basename"):
                _recorder_dir, base = derive_capture_paths(root, stage, candidate)
                break
        if base is not None:
            log_path = Path(str(base) + ".txt")
            if log_path.is_file():
                text = log_path.read_text(encoding="utf-8", errors="replace")
                if assertion not in text:
                    problems.append(
                        "%s: the recorded log does not contain the required assertion" % slot_id
                    )
    return artifact


def check_terminal_receipt(root, evidence, stage, capture_result, sidecar, problems):
    """The runtime terminal receipt must be bound to a committed authority event."""
    slot_id = evidence.get("slot_id")
    if stage.get("phase") != "TOOL_RUNTIME":
        return None
    expected_path = derive_receipt_path(stage, evidence.get("run_id"))
    if not expected_path.is_file():
        problems.append("%s: the terminal receipt is missing (%s)" % (slot_id, expected_path))
        return None
    receipt = load_json(expected_path, "terminal receipt", problems)
    if not isinstance(receipt, dict):
        problems.append("%s: the terminal receipt is not a JSON object" % slot_id)
        return None
    if receipt.get("run_id") != evidence.get("run_id"):
        problems.append("%s: the receipt belongs to another run" % slot_id)
    if receipt.get("command_id") != evidence.get("command_id"):
        problems.append("%s: the receipt belongs to another command" % slot_id)
    if receipt.get("capture_basename") != evidence.get("capture_basename"):
        problems.append("%s: the receipt belongs to another capture" % slot_id)
    event = None
    for candidate in read_journal_events(root):
        if isinstance(candidate, dict) and candidate.get("event_id") == receipt.get("event_id"):
            event = candidate
            break
    if event is None:
        problems.append("%s: the receipt names no committed authority event" % slot_id)
        return receipt
    if event.get("action") != "run-terminal":
        problems.append("%s: the receipt names an event of another kind" % slot_id)
    if event.get("sequence") != receipt.get("sequence"):
        problems.append("%s: the receipt sequence does not match the committed event" % slot_id)
    detail = event.get("detail") or {}
    if detail.get("capture_digests") != receipt.get("capture_digests"):
        problems.append("%s: the receipt digests differ from the committed event" % slot_id)
    if sidecar is not None:
        if receipt.get("recorder_wait_returncode") != sidecar.get("recorder_wait_returncode"):
            problems.append("%s: the receipt wait differs from the sidecar" % slot_id)
        if receipt.get("inner_exit") != sidecar.get("inner_exit"):
            problems.append("%s: the receipt inner exit differs from the sidecar" % slot_id)
    if isinstance(capture_result, dict):
        actual_inner = capture_result.get("inner_exit_actual")
        if actual_inner is not None and receipt.get("inner_exit") != actual_inner:
            problems.append("%s: the receipt inner exit differs from the original capture" % slot_id)
    if receipt.get("resource_status") != "CLEAN":
        problems.append("%s: the receipt was written for an unsettled resource" % slot_id)
    return receipt


def check_evidence(root, case_id, evidence, slot, release, release_path, release_sha, problems):
    """One evidence entry against its slot and its stage."""
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
    allocation = check_slot_chain(case_id, evidence, slot, stage, problems)
    capture_result = check_capture(root, evidence, stage, allocation, problems)
    sidecar = check_sidecar(root, evidence, stage, stage_sha, problems)
    check_terminal_receipt(root, evidence, stage, capture_result, sidecar, problems)
    requirement = evidence.get("expected_failure_requirement")
    if evidence.get("expected_inner_exit") != 0 or requirement is not None:
        check_failure_artifact(root, case_id, evidence, stage, capture_result, sidecar, problems)


def slot_matches(slot, evidence):
    """An evidence entry satisfies a slot only when every binding field agrees."""
    if "approved_stage_release" in slot:
        if slot["approved_stage_release"] != evidence.get("approved_stage_release"):
            return False
    for field in ("command_id", "capture_basename", "run_id", "level", "expected_inner_exit"):
        if slot.get(field) != evidence.get(field):
            return False
    return slot.get("expected_failure_requirement") == evidence.get("expected_failure_requirement")


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
        if not slots:
            problems.append("%s: the case has no required evidence slot" % case_id)
            continue
        evidence_rows = row.get("evidence")
        if not isinstance(evidence_rows, list) or not evidence_rows:
            problems.append("%s: case has no evidence array" % case_id)
            continue
        used = set()
        for slot in slots:
            if not isinstance(slot, dict):
                problems.append("%s: a required evidence slot is not an object" % case_id)
                continue
            matches = [
                index for index, item in enumerate(evidence_rows)
                if index not in used and isinstance(item, dict)
                and item.get("slot_id") == slot.get("slot_id")
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
                candidate = slot
                if not slot_matches(slot, item):
                    candidate = None
                    for alternative in alternatives:
                        if (isinstance(alternative, dict)
                                and alternative.get("slot_id") == slot.get("slot_id")
                                and slot_matches(alternative, item)):
                            candidate = alternative
                            break
                    if candidate is None:
                        continue
                satisfied = True
                used.add(index)
                check_evidence(root, case_id, item, candidate, release, release_file,
                               release_sha256, problems)
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
                    % (case_id, item.get("slot_id") if isinstance(item, dict) else None)
                )
    return problems


def _write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _write_json(path, payload):
    _write(path, json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))


def build_synthetic_fixture(root):
    """A complete synthetic project with real files, real captures and receipts.

    It is static metadata only: it proves the positive and the negative branches
    of this checker, it is not a grant and it is not a product test.
    """
    root = Path(root)
    project = root / "project"
    recorder_rel = ("docs/execution/A/implementation-20261111/integration/"
                    "e1-main-takeover/run-recorded.py")
    files = {
        "src/example.py": "print('example')\n",
        "contracts/example.json": "{}\n",
        "tools/example.py": "# tool\n",
        "tests/example_test.py": "# test\n",
        "package.json": "{}\n",
        "pnpm-lock.yaml": "lockfileVersion: 1\n",
        "tsconfig.json": "{}\n",
        "vitest.config.ts": "export default {}\n",
        "CONTRACT.md": "# contract\n",
        "AGENTS.md": "agents\n",
        recorder_rel: "# recorder\n",
    }
    for relative, text in files.items():
        _write(project / relative, text)
    recorded = [
        {"path": relative, "sha256": digest(project / relative)}
        for relative in sorted(files)
        if relative != "AGENTS.md" and relative != "CONTRACT.md"
    ]
    protected = [{"path": "AGENTS.md", "sha256": digest(project / "AGENTS.md")}]
    contract = {"path": "CONTRACT.md", "sha256": digest(project / "CONTRACT.md")}
    recorder_sha = digest(project / recorder_rel)
    recorder_dir = (project / recorder_rel).parent
    l1_root = project / "var" / "process-admission" / "proc0-l1-fixture"
    l3_root = project / "var" / "process-admission" / "proc0-l3-fixture"
    authority = project / "var" / "process-admission" / "authority"
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
        "allowed_phases": ["TOOL_RUNTIME"],
    }
    command_helper1 = {
        "argv": ["/usr/bin/python3.12", "-I", "-S", "-B",
                 "tests/process/fixtures/admission_helper.py", "specified-fail"],
        "cwd": str(project),
        "runtime_class": "FINITE_TOOL_HELPER",
        "expected_inner_exit": 1,
        "allowed_phases": ["TOOL_RUNTIME"],
    }
    l1_allocations = [
        {"basename": "example-direct-001", "command_id": "direct", "run_id": "example-run-direct",
         "phase": "BOOTSTRAP_CODE", "case_ids": ["PROC0-13"],
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
    l1_slot = {
        "slot_id": "L1_DIRECT", "approved_stage_release": "SELF", "command_id": "direct",
        "capture_basename": "example-direct-001", "run_id": "example-run-direct",
        "level": "D1", "expected_inner_exit": 0, "expected_failure_requirement": None,
    }
    l1_release = {
        "format": RELEASE_FORMAT, "release_id": "EXAMPLE_L1", "phase": "BOOTSTRAP_CODE",
        "owner_task": "example-task", "generation": 1, "project_root": str(project),
        "state_root": str(l1_root), "contract": contract,
        "recorder": {"path": recorder_rel, "sha256": recorder_sha},
        "recorded_source": recorded, "protected_inputs": protected,
        "commands": {"direct": command_direct},
        "required_cases": ["PROC0-13"],
        "case_bindings": {"PROC0-13": {"required_evidence": [l1_slot], "alternatives": []}},
        "capture_allocations": l1_allocations,
    }
    l3_slots = [
        {"slot_id": "L3_SUCCESS", "approved_stage_release": "SELF", "command_id": "helper0",
         "capture_basename": "example-helper-pass-001", "run_id": "example-run-pass",
         "level": "TOOL_RUNTIME", "expected_inner_exit": 0, "expected_failure_requirement": None},
        {"slot_id": "L3_EXPECTED_FAILURE", "approved_stage_release": "SELF",
         "command_id": "helper1", "capture_basename": "example-helper-fail-001",
         "run_id": "example-run-fail", "level": "TOOL_RUNTIME", "expected_inner_exit": 1,
         "expected_failure_requirement": {"assertion": "TOOL_HELPER_EXPECTED_FAILURE",
                                           "cleanup_required": True}},
    ]
    l3_release = {
        "format": RELEASE_FORMAT, "release_id": "EXAMPLE_L3", "phase": "TOOL_RUNTIME",
        "owner_task": "example-task", "generation": 1, "project_root": str(project),
        "state_root": str(l3_root), "contract": contract,
        "recorder": {"path": recorder_rel, "sha256": recorder_sha},
        "recorded_source": recorded, "protected_inputs": protected,
        "commands": {"helper0": command_helper0, "helper1": command_helper1},
        "required_cases": ["PROC0-13"],
        "case_bindings": {"PROC0-13": {"required_evidence": l3_slots, "alternatives": []}},
        "capture_allocations": l3_allocations,
    }
    final_slots = [
        {"slot_id": "L1_DIRECT", "approved_stage_release": "L1", "command_id": "direct",
         "capture_basename": "example-direct-001", "run_id": "example-run-direct",
         "level": "D1", "expected_inner_exit": 0, "expected_failure_requirement": None},
        {"slot_id": "L3_SUCCESS", "approved_stage_release": "L3", "command_id": "helper0",
         "capture_basename": "example-helper-pass-001", "run_id": "example-run-pass",
         "level": "TOOL_RUNTIME", "expected_inner_exit": 0, "expected_failure_requirement": None},
    ]
    final_slots.append(
        {"slot_id": "L3_EXPECTED_FAILURE", "approved_stage_release": "L3",
         "command_id": "helper1", "capture_basename": "example-helper-fail-001",
         "run_id": "example-run-fail", "level": "TOOL_RUNTIME", "expected_inner_exit": 1,
         "expected_failure_requirement": {"assertion": "TOOL_HELPER_EXPECTED_FAILURE",
                                           "cleanup_required": True}})
    final_release = {
        "format": RELEASE_FORMAT, "release_id": "EXAMPLE_FINAL", "phase": "FINAL_METADATA",
        "owner_task": "example-task", "generation": 1, "project_root": str(project),
        "state_root": str(project / "var" / "process-admission" / "proc0-final-fixture"),
        "contract": contract,
        "recorder": {"path": recorder_rel, "sha256": recorder_sha},
        "recorded_source": recorded, "protected_inputs": protected,
        "commands": {},
        "required_cases": ["PROC0-13"],
        "case_bindings": {"PROC0-13": {"required_evidence": final_slots, "alternatives": []}},
        "capture_allocations": l1_allocations + l3_allocations,
    }
    l1_path = root / "L1_STAGE.json"
    l3_path = root / "L3_STAGE.json"
    _write_json(l1_path, l1_release)
    _write_json(l3_path, l3_release)
    final_release["approved_stage_releases"] = {
        "L1": {"path": str(l1_path), "sha256": digest(l1_path), "phase": "BOOTSTRAP_CODE",
               "recorded_source": recorded, "protected_inputs": protected},
        "L3": {"path": str(l3_path), "sha256": digest(l3_path), "phase": "TOOL_RUNTIME",
               "recorded_source": recorded, "protected_inputs": protected},
    }
    final_path = root / "FINAL_STAGE.json"
    _write_json(final_path, final_release)

    def write_capture(basename, command, inner_exit, log_text="log line\n"):
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
        digests = {}
        for suffix in CAPTURE_SUFFIXES:
            piece = Path(str(base) + suffix)
            digests[suffix] = digest(piece) if piece.is_file() else None
        return digests

    def write_sidecar(stage_root, layer, basename, command_id, inner_exit, run_id, digests,
                      stage_sha, cleanup_kind):
        cleanup_source = {
            "kind": cleanup_kind, "pgid": 4242, "boot_id": "0" * 32,
            "observed_members": [], "vanished_entries": 0, "undeterminable_entries": 0,
            "resource_status": "CLEAN", "waited_returncode": inner_exit & 255,
            "scanned_at": "2026-01-01T00:00:02+00:00",
        }
        epoch = {"pid": 4242, "state": "S", "ppid": 1, "pgid": 4242, "sid": 4242,
                 "start_ticks": 1, "boot_id": "0" * 32, "identity_verified": True}
        sidecar = {
            "format": "narralens.proc0-run-sidecar@1", "evidence_layer": layer,
            "release_sha256": stage_sha, "release_id": "EXAMPLE",
            "release_phase": "BOOTSTRAP_CODE" if layer == "BOOTSTRAP" else "TOOL_RUNTIME",
            "run_id": run_id, "command_id": command_id, "capture_basename": basename,
            "capture_directory": str(recorder_dir), "owner_task": "example-task",
            "generation": 1, "capture_digests": digests, "inner_exit": inner_exit,
            "recorder_wait_returncode": inner_exit & 255,
            "source_pre": recorded, "source_post": recorded,
            "protected_pre": protected, "protected_post": protected,
            "resource_status": "CLEAN", "cleanup_source": cleanup_source,
            "epoch": epoch, "recorder_epoch": epoch,
            "wrapper_epoch": {"pid": 1, "start_ticks": 1, "boot_id": "0" * 32, "complete": True},
            "metadata_ok": True, "metadata_problems": [],
            "created_at": "2026-01-01T00:00:02+00:00",
        }
        folder = "bootstrap" if layer == "BOOTSTRAP" else "sidecars"
        path = stage_root / folder / (run_id + ".json")
        _write_json(path, sidecar)
        return path

    def write_runtime_extras(stage_root, run_id, command_id, basename, digests, sidecar_path,
                              inner_exit, event_id, sequence, assertion=None):
        cleanup_source = {
            "kind": "owned_group_scan", "pgid": 4242, "boot_id": "0" * 32,
            "observed_members": [], "vanished_entries": 0, "undeterminable_entries": 0,
            "resource_status": "CLEAN", "waited_returncode": inner_exit & 255,
            "identity_verified": True, "scanned_at": "2026-01-01T00:00:02+00:00",
        }
        credential = {
            "format": "narralens.proc0-failure-credential@1",
            "command_id": command_id, "capture_basename": basename, "run_id": run_id,
            "case_ids": ["PROC0-13"], "case_qualified": True,
            "qualified_cases": ["PROC0-13"], "inner_exit": inner_exit,
            "expected_inner_exit": inner_exit, "recorder_wait_returncode": inner_exit & 255,
            "source": recorded, "source_post": recorded,
            "protected": protected, "protected_post": protected,
            "capture_digests": digests, "sidecar": str(sidecar_path),
            "sidecar_sha256": digest(sidecar_path), "assertion_reached": True,
            "cleanup": {"required": True, "verified": True, "source": cleanup_source},
            "resource_status": "CLEAN", "problems": [], "source_drift": [],
            "case_passed": True, "created_at": "2026-01-01T00:00:02+00:00",
        }
        if assertion is not None:
            credential["case_id"] = "PROC0-13"
            credential["assertion"] = assertion
            credential["expected_failure_requirement"] = {
                "assertion": assertion, "cleanup_required": True}
        credential_path = stage_root / "credentials" / (run_id + ".json")
        _write_json(credential_path, credential)
        receipt = {
            "format": "narralens.proc0-terminal-receipt@1", "run_id": run_id,
            "command_id": command_id, "capture_basename": basename,
            "event_id": event_id, "sequence": sequence, "release_sha256": stage_sha,
            "capture_digests": digests, "sidecar": str(sidecar_path),
            "sidecar_sha256": digest(sidecar_path), "credential": str(credential_path),
            "credential_sha256": digest(credential_path), "inner_exit": inner_exit,
            "recorder_wait_returncode": inner_exit & 255, "resource_status": "CLEAN",
            "recorder_epoch": {"pid": 4242, "start_ticks": 1, "session": 4242, "group": 4242,
                               "boot_id": "0" * 32, "identity_verified": True},
            "created_at": "2026-01-01T00:00:03+00:00",
        }
        receipt_path = stage_root / "receipts" / (run_id + ".json")
        _write_json(receipt_path, receipt)
        event = {
            "event_id": event_id, "sequence": sequence, "at": "2026-01-01T00:00:03+00:00",
            "action": "run-terminal",
            "detail": {
                "run_id": run_id, "inner_exit": inner_exit,
                "recorder_wait_returncode": inner_exit & 255,
                "capture_digests": digests, "sidecar": str(sidecar_path),
                "sidecar_sha256": digest(sidecar_path),
                "credential": str(credential_path),
                "credential_sha256": digest(credential_path),
                "resource_status": "CLEAN",
            },
        }
        authority.mkdir(parents=True, exist_ok=True)
        with open(authority / JOURNAL_FILENAME, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(event, ensure_ascii=False, sort_keys=True) + "\n")
        return credential_path, receipt_path

    direct_digests = write_capture("example-direct-001", command_direct, 0)
    helper_pass_digests = write_capture("example-helper-pass-001", command_helper0, 0)
    helper_fail_digests = write_capture(
        "example-helper-fail-001", command_helper1, 1,
        log_text="TOOL_HELPER_EXPECTED_FAILURE\n")
    direct_sidecar = write_sidecar(
        l1_root, "BOOTSTRAP", "example-direct-001", "direct", 0, "example-run-direct",
        direct_digests, digest(l1_path), "MAIN_bootstrap_wait_and_owned_group_observation")
    pass_sidecar = write_sidecar(
        l3_root, "TOOL_RUNTIME", "example-helper-pass-001", "helper0", 0, "example-run-pass",
        helper_pass_digests, digest(l3_path), "owned_group_scan")
    fail_sidecar = write_sidecar(
        l3_root, "TOOL_RUNTIME", "example-helper-fail-001", "helper1", 1, "example-run-fail",
        helper_fail_digests, digest(l3_path), "owned_group_scan")
    pass_credential, pass_receipt = write_runtime_extras(
        l3_root, "example-run-pass", "helper0", "example-helper-pass-001", helper_pass_digests,
        pass_sidecar, 0, "evt-example-pass", 11)
    fail_credential, fail_receipt = write_runtime_extras(
        l3_root, "example-run-fail", "helper1", "example-helper-fail-001", helper_fail_digests,
        fail_sidecar, 1, "evt-example-fail", 12,
        assertion="TOOL_HELPER_EXPECTED_FAILURE")
    l1_block = {
        "path": str(l1_path), "sha256": digest(l1_path), "phase": "BOOTSTRAP_CODE",
        "recorded_source": recorded, "protected_inputs": protected,
    }
    l3_block = {
        "path": str(l3_path), "sha256": digest(l3_path), "phase": "TOOL_RUNTIME",
        "recorded_source": recorded, "protected_inputs": protected,
    }
    packet = {
        "format": PACKET_FORMAT,
        "status": "READY_FOR_REVIEW",
        "release": {"path": str(final_path), "sha256": digest(final_path)},
        "contract": contract,
        "source": recorded,
        "required_cases": ["PROC0-13"],
        "cases": [
            {
                "id": "PROC0-13",
                "implementation": "COMPLETE",
                "production_entry": "tools/run-delivery.py::run",
                "test_name": "synthetic example, not executed",
                "evidence": [
                    {
                        "slot_id": "L1_DIRECT", "approved_stage_release": "L1",
                        "command_id": "direct", "capture_basename": "example-direct-001",
                        "run_id": "example-run-direct", "level": "D1",
                        "expected_inner_exit": 0, "expected_failure_requirement": None,
                        "stage_release": l1_block,
                        "command_capture": str(recorder_dir / "example-direct-001"),
                        "sidecar": str(direct_sidecar),
                        "expected_failure_artifact": None,
                    },
                ],
            },
        ],
    }
    packet["cases"][0]["evidence"].append({
        "slot_id": "L3_SUCCESS", "approved_stage_release": "L3", "command_id": "helper0",
        "capture_basename": "example-helper-pass-001", "run_id": "example-run-pass",
        "level": "TOOL_RUNTIME", "expected_inner_exit": 0,
        "expected_failure_requirement": None,
        "stage_release": l3_block,
        "command_capture": str(recorder_dir / "example-helper-pass-001"),
        "sidecar": str(pass_sidecar),
        "expected_failure_artifact": None,
    })
    packet["cases"][0]["evidence"].append({
        "slot_id": "L3_EXPECTED_FAILURE", "approved_stage_release": "L3", "command_id": "helper1",
        "capture_basename": "example-helper-fail-001", "run_id": "example-run-fail",
        "level": "TOOL_RUNTIME", "expected_inner_exit": 1,
        "expected_failure_requirement": {"assertion": "TOOL_HELPER_EXPECTED_FAILURE",
                                          "cleanup_required": True},
        "stage_release": l3_block,
        "command_capture": str(recorder_dir / "example-helper-fail-001"),
        "sidecar": str(fail_sidecar),
        "expected_failure_artifact": str(fail_credential),
    })
    packet_path = root / "PACKET.json"
    _write_json(packet_path, packet)
    return {
        "root": root,
        "project": project,
        "release_path": final_path,
        "release_sha": digest(final_path),
        "release": final_release,
        "packet_path": packet_path,
        "packet": packet,
        "l1_release_path": l1_path,
        "l1_release_sha": digest(l1_path),
        "l3_release_path": l3_path,
        "l3_release_sha": digest(l3_path),
        "recorded_source": recorded,
        "protected_inputs": protected,
        "recorder_dir": recorder_dir,
        "l1_root": l1_root,
        "l3_root": l3_root,
        "authority": authority,
        "captures": {
            "example-direct-001": {"digests": direct_digests, "sidecar": str(direct_sidecar)},
            "example-helper-pass-001": {"digests": helper_pass_digests,
                                        "sidecar": str(pass_sidecar),
                                        "credential": str(pass_credential),
                                        "receipt": str(pass_receipt)},
            "example-helper-fail-001": {"digests": helper_fail_digests,
                                        "sidecar": str(fail_sidecar),
                                        "credential": str(fail_credential),
                                        "receipt": str(fail_receipt)},
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

        def snapshot():
            data = {}
            paths = list(fixture["recorder_dir"].glob("*"))
            paths += list(fixture["root"].glob("*.json"))
            paths += list(fixture["authority"].glob("*"))
            paths += [p for p in fixture["l1_root"].rglob("*") if p.is_file()]
            paths += [p for p in fixture["l3_root"].rglob("*") if p.is_file()]
            for path in paths:
                if path.is_file():
                    data[path] = path.read_bytes()
            return data

        def restore(data):
            for path, blob in data.items():
                path.write_bytes(blob)

        def reject(label, mutate, expect=None):
            before = snapshot()
            try:
                broken = copy.deepcopy(packet)
                mutate(broken, fixture)
                path = fixture["root"] / ("packet-%s.json" % label)
                _write_json(path, broken)
                found = check(release_path, release_sha, path)
            finally:
                restore(before)
            if not found:
                raise AssertionError("%s must be rejected" % label)
            if expect and not any(expect in problem for problem in found):
                raise AssertionError("%s must be refused for %s, got %s" % (label, expect, found))
            results[label] = found[0]
            if check(release_path, release_sha, packet_path):
                raise AssertionError("the positive packet must stay admissible after %s" % label)

        def drop_slot(slot_id):
            def mutate(broken, _fixture):
                for case in broken["cases"]:
                    if case["id"] == "PROC0-13":
                        case["evidence"] = [row for row in case["evidence"]
                                            if row["slot_id"] != slot_id]
            return mutate

        reject("missing_l1_direct", drop_slot("L1_DIRECT"), "REJECTED_MISSING_REQUIRED_EVIDENCE")
        reject("missing_l3_success", drop_slot("L3_SUCCESS"), "REJECTED_MISSING_REQUIRED_EVIDENCE")
        reject("missing_l3_expected_failure", drop_slot("L3_EXPECTED_FAILURE"),
               "REJECTED_MISSING_REQUIRED_EVIDENCE")

        def empty_evidence(broken, _fixture):
            for case in broken["cases"]:
                case["evidence"] = []
        reject("empty_evidence", empty_evidence, "no evidence array")

        def partial_status(broken, _fixture):
            broken["status"] = "PARTIAL"
        reject("partial_status", partial_status, "packet status is")

        def replace_release(broken, _fixture):
            broken["release"] = {"path": str(fixture["release_path"]), "sha256": "c" * 64}
        reject("replaced_release_reference", replace_release, "REJECTED_PACKET_RELEASE_REPLACED")

        def missing_contract(broken, _fixture):
            broken.pop("contract", None)
        reject("missing_contract_binding", missing_contract, "no contract binding")

        def trimmed_source(broken, _fixture):
            broken["source"] = broken["source"][:-1]
        reject("trimmed_source_inventory", trimmed_source, "source inventory differs")

        def trimmed_cases(broken, _fixture):
            broken["required_cases"] = []
        reject("trimmed_case_inventory", trimmed_cases, "required cases differ")

        def swap_alias(broken, _fixture):
            for case in broken["cases"]:
                for row in case["evidence"]:
                    if row["slot_id"] == "L1_DIRECT":
                        row["approved_stage_release"] = "L3"
        reject("stage_alias_swapped", swap_alias, "SLOT_BINDING_MISMATCH")

        def unapproved_stage(broken, fixture):
            for case in broken["cases"]:
                for row in case["evidence"]:
                    if row["slot_id"] == "L3_SUCCESS":
                        row["stage_release"] = {
                            "path": str(fixture["root"] / "unauthorized-same-source-release.json"),
                            "sha256": "b" * 64, "phase": "TOOL_RUNTIME",
                            "recorded_source": fixture["recorded_source"],
                            "protected_inputs": fixture["protected_inputs"]}
        reject("unapproved_same_source_stage", unapproved_stage, "UNAPPROVED_STAGE_RELEASE")

        def wrong_level(broken, _fixture):
            for case in broken["cases"]:
                for row in case["evidence"]:
                    if row["slot_id"] == "L3_SUCCESS":
                        row["level"] = "D1"
        reject("wrong_evidence_level", wrong_level, "SLOT_BINDING_MISMATCH")

        def wrong_capture(broken, fixture):
            for case in broken["cases"]:
                for row in case["evidence"]:
                    if row["slot_id"] == "L1_DIRECT":
                        row["capture_basename"] = "example-helper-pass-001"
                        row["run_id"] = "example-run-pass"
                        row["command_id"] = "helper0"
                        row["command_capture"] = str(
                            fixture["recorder_dir"] / "example-helper-pass-001")
        reject("capture_from_another_case", wrong_capture, "SLOT_BINDING_MISMATCH")

        def external_sidecar(broken, fixture):
            sentinel = fixture["root"] / "sentinel-sidecar.json"
            sentinel.write_text(json.dumps({"secret": "sentinel"}))
            for case in broken["cases"]:
                for row in case["evidence"]:
                    if row["slot_id"] == "L1_DIRECT":
                        row["sidecar"] = str(sentinel)
        reject("external_sidecar_path", external_sidecar, "not the derived location")

        def external_capture(broken, fixture):
            sentinel = fixture["root"] / "sentinel-capture"
            sentinel.write_text("sentinel")
            for case in broken["cases"]:
                for row in case["evidence"]:
                    if row["slot_id"] == "L1_DIRECT":
                        row["command_capture"] = str(sentinel)
        reject("external_capture_path", external_capture, "not the derived location")

        def credential_sidecar_elsewhere(broken, fixture):
            for case in broken["cases"]:
                for row in case["evidence"]:
                    if row["slot_id"] == "L3_EXPECTED_FAILURE":
                        row["expected_failure_artifact"] = str(
                            fixture["captures"]["example-helper-pass-001"]["credential"])
        reject("credential_references_another_credential", credential_sidecar_elsewhere,
               "not the derived location")

        def sidecar_is_a_list(broken, fixture):
            path = Path(fixture["captures"]["example-direct-001"]["sidecar"])
            path.write_text("[]")
        reject("sidecar_is_not_an_object", sidecar_is_a_list, "not a JSON object")

        def credential_is_a_list(broken, fixture):
            path = Path(fixture["captures"]["example-helper-fail-001"]["credential"])
            path.write_text("[]")
        reject("credential_is_not_an_object", credential_is_a_list, "not a JSON object")

        def sidecar_inner_differs(broken, fixture):
            path = Path(fixture["captures"]["example-direct-001"]["sidecar"])
            sidecar = json.loads(path.read_text())
            sidecar["inner_exit"] = 5
            sidecar["recorder_wait_returncode"] = 5
            path.write_text(json.dumps(sidecar, indent=2, sort_keys=True))
        reject("sidecar_inner_differs_from_originals", sidecar_inner_differs, "sidecar")

        def assertion_not_in_log(broken, fixture):
            log = fixture["recorder_dir"] / "example-helper-fail-001.txt"
            log.write_text("nothing here\n")
            result = fixture["recorder_dir"] / "example-helper-fail-001.result.json"
            payload = json.loads(result.read_text())
            payload["log_sha256"] = digest(log)
            result.write_text(json.dumps(payload, indent=2, sort_keys=True))
        reject("assertion_not_reached_in_log", assertion_not_in_log,
               "does not contain the required assertion")

        def receipt_missing(broken, fixture):
            Path(fixture["captures"]["example-helper-pass-001"]["receipt"]).unlink()
        reject("terminal_receipt_missing", receipt_missing, "terminal receipt is missing")

        def receipt_event_unknown(broken, fixture):
            path = Path(fixture["captures"]["example-helper-pass-001"]["receipt"])
            receipt = json.loads(path.read_text())
            receipt["event_id"] = "evt-not-committed"
            path.write_text(json.dumps(receipt, indent=2, sort_keys=True))
        reject("receipt_names_an_uncommitted_event", receipt_event_unknown,
               "no committed authority event")

        def credential_cleanup_differs(broken, fixture):
            path = Path(fixture["captures"]["example-helper-fail-001"]["credential"])
            credential = json.loads(path.read_text())
            credential["cleanup"]["source"]["pgid"] = 999
            path.write_text(json.dumps(credential, indent=2, sort_keys=True))
        reject("credential_cleanup_source_differs", credential_cleanup_differs,
               "cleanup source differs from the sidecar")

        if check(release_path, "0" * 64, packet_path):
            results["wrong_external_sha_rejected"] = True
        else:
            raise AssertionError("a wrong external release digest must be rejected")

    return {
        "scope": "SYNTHETIC_METADATA_ONLY",
        "negative_branches": sorted(results),
        "business_acceptance": False,
        "note": "metadata admission only; no product, runtime or review acceptance is implied",
    }


def release_phase(release_path):
    """The phase of a root release, used for the phase specific status."""
    try:
        release = json.loads(Path(release_path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    phase = release.get("phase") if isinstance(release, dict) else None
    return phase if phase in OUTPUT_STATUS else None


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
