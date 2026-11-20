#!/usr/bin/env python3
"""PROC-0 delivery admission runner (Python standard library only).

Cooperative admission gate for the delivery pipeline.  It enforces the
MAIN-issued release pins, keeps exactly one authoritative state file per
project, uses one short transaction lock and gives every started recorder
exactly one owner.

This tool is NOT an OS isolation boundary.  It does not police arbitrary shell
usage by a same-user agent, it never sends signals to product or recorder
processes, it never reaps processes it did not start and it never claims a
complete fork history.

Contract: docs/process/proc-0/CONTRACT.md (rev4) in the canonical MAIN package.
"""

import argparse
import datetime
import hashlib
import json
import os
import re
import secrets
import subprocess
import sys
import time
from pathlib import Path

RELEASE_FORMAT = "narralens.proc0-release@3"
STATE_FORMAT = "narralens.proc0-state@1"
SIDECAR_FORMAT = "narralens.proc0-run-sidecar@1"
CREDENTIAL_FORMAT = "narralens.proc0-failure-credential@1"
RECEIPT_FORMAT = "narralens.proc0-terminal-receipt@1"

# The outer recorder interpreter is fixed here and, where the release pins it,
# by the protected binary digest.  It is never derived from the inner command.
OUTER_INTERPRETER = "/usr/bin/python3.12"

# One admission authority per real project.  The ticket state_root is only the
# artefact root of that ticket; it can never become a second authority.
PROJECT_ARTEFACT_DIRNAME = "process-admission"
AUTHORITY_DIRNAME = "authority"
STATE_FILENAME = "state.json"
JOURNAL_FILENAME = "journal.jsonl"
LOCK_FILENAME = "lock"
BOOTSTRAP_DIRNAME = "bootstrap"
SIDECARS_DIRNAME = "sidecars"
CREDENTIALS_DIRNAME = "credentials"
RECEIPTS_DIRNAME = "receipts"
LOGS_DIRNAME = "logs"

CAPTURE_SUFFIXES = (".inputs.json", ".cmd.json", ".txt", ".exit", ".result.json", ".claim.json")
BASENAME_RE = re.compile(r"^[A-Za-z0-9_-]+$")
RECORDER_RUNNER_VERSION = 3
HISTORY_LIMIT = 50
SESSION_SETTLE_SECONDS = 2.0

STATE_PHASES = ("IDLE", "WRITING", "STARTING", "RUNNING", "TERMINAL", "UNKNOWN")
STATE_ADMISSIONS = ("READY", "BLOCKED")
REQUIRED_STATE_FIELDS = {
    "format": str,
    "sequence": int,
    "event_id": (str, type(None)),
    "generation": int,
    "bound_release_sha256": (str, type(None)),
    "bound_owner_task": (str, type(None)),
    "phase": str,
    "admission": str,
    "blocked_reason": (str, type(None)),
    "cancel_requested": bool,
    "pending_audit": bool,
    "pending_event": (dict, type(None)),
    "write_lease": (dict, type(None)),
    "slot": (dict, type(None)),
    "history": list,
}

EXIT_OK = 0
EXIT_REJECTED = 2
EXIT_INTERNAL = 3


class AdmissionError(Exception):
    """A refusal that must never be silently downgraded to a pass."""

    def __init__(self, reason, detail=None):
        super().__init__(reason)
        self.reason = reason
        self.detail = detail if isinstance(detail, dict) else {"info": str(detail)}


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def sha256_file(path):
    path = Path(path)
    try:
        return sha256_bytes(path.read_bytes())
    except OSError as error:
        raise AdmissionError("FILE_UNREADABLE", {"path": str(path), "errno": error.errno})


def read_json_file(path, what):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except OSError as error:
        raise AdmissionError(what + "_UNREADABLE", {"path": str(path), "errno": error.errno})
    except ValueError as error:
        raise AdmissionError(what + "_UNPARSABLE", {"path": str(path), "detail": str(error)})


def _require(condition, reason, detail=None):
    if not condition:
        raise AdmissionError(reason, detail)


def is_repo_relative(name):
    return (
        isinstance(name, str)
        and name != ""
        and not Path(name).is_absolute()
        and ".." not in Path(name).parts
    )


def is_safe_basename(name):
    return (
        isinstance(name, str)
        and name != ""
        and all(ord(ch) < 128 for ch in name)
        and BASENAME_RE.match(name) is not None
    )


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


# ---------------------------------------------------------------------------
# release handling
# ---------------------------------------------------------------------------

def load_release(release_path, expected_sha256):
    """Load the MAIN release.  The external path + digest is the only trust root."""
    _require(expected_sha256, "EXPECTED_RELEASE_SHA256_REQUIRED")
    path = Path(release_path)
    _require(path.is_file(), "RELEASE_FILE_MISSING", {"path": str(path)})
    actual = sha256_file(path)
    _require(
        actual == expected_sha256,
        "RELEASE_SHA256_MISMATCH",
        {"expected": expected_sha256, "actual": actual, "path": str(path)},
    )
    release = read_json_file(path, "RELEASE")
    _require(isinstance(release, dict), "RELEASE_NOT_OBJECT")
    return release, actual


def validate_release(release):
    _require(release.get("format") == RELEASE_FORMAT, "RELEASE_FORMAT_UNSUPPORTED",
             {"format": release.get("format")})
    phase = release.get("phase")
    _require(phase in ("BOOTSTRAP_CODE", "TOOL_RUNTIME", "FINAL_METADATA"),
             "RELEASE_PHASE_UNKNOWN", {"phase": phase})
    _require(isinstance(release.get("release_id"), str) and release["release_id"],
             "RELEASE_ID_MISSING")
    _require(isinstance(release.get("owner_task"), str) and release["owner_task"],
             "RELEASE_OWNER_TASK_MISSING")
    generation = release.get("generation")
    _require(isinstance(generation, int) and not isinstance(generation, bool) and generation >= 0,
             "RELEASE_GENERATION_INVALID", {"generation": generation})
    project_root = release.get("project_root")
    _require(isinstance(project_root, str) and os.path.isabs(project_root),
             "RELEASE_PROJECT_ROOT_INVALID")
    root = Path(project_root)
    _require(root.is_dir(), "RELEASE_PROJECT_ROOT_MISSING", {"project_root": project_root})
    artefact_root = release.get("state_root")
    _require(isinstance(artefact_root, str) and os.path.isabs(artefact_root),
             "RELEASE_STATE_ROOT_INVALID")
    expected_prefix = root / PROJECT_ARTEFACT_DIRNAME
    _require(canonical_within(expected_prefix, artefact_root),
             "RELEASE_STATE_ROOT_OUTSIDE_PROJECT_ARTEFACTS",
             {"state_root": artefact_root, "allowed_prefix": str(expected_prefix)})
    recorder = release.get("recorder")
    _require(isinstance(recorder, dict), "RELEASE_RECORDER_MISSING")
    _require(is_repo_relative(recorder.get("path")), "RELEASE_RECORDER_PATH_INVALID")
    _require(isinstance(recorder.get("sha256"), str) and len(recorder["sha256"]) == 64,
             "RELEASE_RECORDER_SHA_INVALID")

    # recorded_source stays inside the repository; protected_inputs may also be
    # the exact absolute pins MAIN lists (the fixed Python, the MAIN observer).
    recorded = release.get("recorded_source")
    _require(isinstance(recorded, list), "RELEASE_RECORDED_SOURCE_MISSING")
    _seen = set()
    for row in recorded:
        _require(isinstance(row, dict), "RELEASE_RECORDED_SOURCE_ROW_INVALID")
        _require(is_repo_relative(row.get("path")), "RELEASE_RECORDED_SOURCE_PATH_INVALID",
                 {"path": row.get("path")})
        _require(isinstance(row.get("sha256"), str) and len(row["sha256"]) == 64,
                 "RELEASE_RECORDED_SOURCE_SHA_INVALID")
        _require(row["path"] not in _seen, "RELEASE_RECORDED_SOURCE_DUPLICATE",
                 {"path": row["path"]})
        _seen.add(row["path"])
    protected = release.get("protected_inputs")
    _require(isinstance(protected, list), "RELEASE_PROTECTED_INPUTS_MISSING")
    _seen = set()
    for row in protected:
        _require(isinstance(row, dict), "RELEASE_PROTECTED_INPUT_ROW_INVALID")
        path = row.get("path")
        _require(isinstance(path, str) and path != "", "RELEASE_PROTECTED_INPUT_PATH_INVALID")
        _require(is_repo_relative(path) or os.path.isabs(path),
                 "RELEASE_PROTECTED_INPUT_PATH_INVALID", {"path": path})
        _require(isinstance(row.get("sha256"), str) and len(row["sha256"]) == 64,
                 "RELEASE_PROTECTED_INPUT_SHA_INVALID")
        _require(path not in _seen, "RELEASE_PROTECTED_INPUT_DUPLICATE", {"path": path})
        _seen.add(path)

    commands = release.get("commands")
    _require(isinstance(commands, dict) and commands, "RELEASE_COMMANDS_MISSING")
    for command_id, command in commands.items():
        _require(isinstance(command, dict), "RELEASE_COMMAND_INVALID", {"command_id": command_id})
        argv = command.get("argv")
        _require(isinstance(argv, list) and argv, "RELEASE_COMMAND_ARGV_INVALID",
                 {"command_id": command_id})
        for part in argv:
            _require(isinstance(part, str) and part != "", "RELEASE_COMMAND_ARGV_INVALID",
                     {"command_id": command_id})
        _require(isinstance(command.get("cwd"), str) and command["cwd"],
                 "RELEASE_COMMAND_CWD_INVALID", {"command_id": command_id})
        _require(isinstance(command.get("runtime_class"), str) and command["runtime_class"],
                 "RELEASE_COMMAND_RUNTIME_CLASS_INVALID", {"command_id": command_id})
        exit_code = command.get("expected_inner_exit")
        _require(isinstance(exit_code, int) and not isinstance(exit_code, bool),
                 "RELEASE_COMMAND_EXPECTED_EXIT_INVALID", {"command_id": command_id})
        phases = command.get("allowed_phases")
        if phases is not None:
            _require(isinstance(phases, list) and phases, "RELEASE_COMMAND_PHASES_INVALID",
                     {"command_id": command_id})

    required = release.get("required_cases")
    _require(isinstance(required, list) and required, "RELEASE_REQUIRED_CASES_MISSING")
    _require(len(set(required)) == len(required), "RELEASE_REQUIRED_CASES_DUPLICATE")
    bindings = release.get("case_bindings")
    _require(isinstance(bindings, dict), "RELEASE_CASE_BINDINGS_MISSING")
    for case_id in required:
        _require(case_id in bindings, "RELEASE_CASE_BINDING_MISSING", {"case_id": case_id})
        binding = bindings[case_id]
        _require(isinstance(binding, dict), "RELEASE_CASE_BINDING_INVALID", {"case_id": case_id})
        slots = binding.get("required_evidence")
        _require(isinstance(slots, list) and slots, "RELEASE_CASE_SLOTS_MISSING",
                 {"case_id": case_id})
        slot_ids = set()
        for slot in slots:
            _require(isinstance(slot, dict), "RELEASE_CASE_SLOT_INVALID", {"case_id": case_id})
            for field in ("slot_id", "command_id", "capture_basename", "run_id", "level"):
                _require(isinstance(slot.get(field), str) and slot[field],
                         "RELEASE_CASE_SLOT_FIELD_MISSING",
                         {"case_id": case_id, "field": field})
            _require(slot["slot_id"] not in slot_ids, "RELEASE_CASE_SLOT_DUPLICATE",
                     {"case_id": case_id, "slot_id": slot["slot_id"]})
            slot_ids.add(slot["slot_id"])
            exit_code = slot.get("expected_inner_exit")
            _require(isinstance(exit_code, int) and not isinstance(exit_code, bool),
                     "RELEASE_CASE_SLOT_EXIT_INVALID",
                     {"case_id": case_id, "slot_id": slot["slot_id"]})
        alternatives = binding.get("alternatives", [])
        _require(isinstance(alternatives, list), "RELEASE_CASE_ALTERNATIVES_INVALID",
                 {"case_id": case_id})

    allocations = release.get("capture_allocations")
    _require(isinstance(allocations, list), "RELEASE_CAPTURE_ALLOCATIONS_MISSING")
    basenames = set()
    run_ids = set()
    for allocation in allocations:
        _require(isinstance(allocation, dict), "RELEASE_CAPTURE_ALLOCATION_INVALID")
        for field in ("basename", "command_id", "run_id"):
            _require(isinstance(allocation.get(field), str) and allocation[field],
                     "RELEASE_CAPTURE_ALLOCATION_FIELD_MISSING", {"field": field})
        _require(is_safe_basename(allocation["basename"]),
                 "RELEASE_CAPTURE_ALLOCATION_BASENAME_INVALID",
                 {"basename": allocation["basename"]})
        _require(is_safe_basename(allocation["run_id"]),
                 "RELEASE_CAPTURE_ALLOCATION_RUN_ID_INVALID",
                 {"run_id": allocation["run_id"]})
        _require(allocation["basename"] not in basenames,
                 "RELEASE_CAPTURE_ALLOCATION_BASENAME_DUPLICATE",
                 {"basename": allocation["basename"]})
        _require(allocation["run_id"] not in run_ids,
                 "RELEASE_CAPTURE_ALLOCATION_RUN_ID_DUPLICATE",
                 {"run_id": allocation["run_id"]})
        basenames.add(allocation["basename"])
        run_ids.add(allocation["run_id"])
        case_ids = allocation.get("case_ids")
        _require(isinstance(case_ids, list) and case_ids, "RELEASE_CAPTURE_ALLOCATION_CASES_MISSING",
                 {"basename": allocation["basename"]})
    contract = release.get("contract")
    _require(isinstance(contract, dict), "RELEASE_CONTRACT_MISSING")
    _require(isinstance(contract.get("sha256"), str) and len(contract["sha256"]) == 64,
             "RELEASE_CONTRACT_SHA_INVALID")
    if release.get("phase") == "FINAL_METADATA":
        approved = release.get("approved_stage_releases")
        _require(isinstance(approved, dict) and approved,
                 "RELEASE_APPROVED_STAGE_RELEASES_MISSING")
        for alias, entry in approved.items():
            _require(isinstance(entry, dict), "RELEASE_APPROVED_STAGE_INVALID", {"alias": alias})
            for field in ("path", "sha256", "phase"):
                _require(isinstance(entry.get(field), str) and entry[field],
                         "RELEASE_APPROVED_STAGE_FIELD_MISSING", {"alias": alias, "field": field})
    return release


def project_artefact_root(project_root):
    return Path(project_root) / PROJECT_ARTEFACT_DIRNAME


def authority_root(project_root):
    """The one admission authority of this project, fixed by the project root."""
    return project_artefact_root(project_root) / AUTHORITY_DIRNAME


# ---------------------------------------------------------------------------
# authority state
# ---------------------------------------------------------------------------

def validate_state(state):
    """The authority state schema.  A damaged state is never silently reset."""
    problems = []
    if not isinstance(state, dict):
        return ["state is not an object"]
    for field, kind in REQUIRED_STATE_FIELDS.items():
        if field not in state:
            problems.append("missing field: " + field)
            continue
        value = state[field]
        if kind is int:
            if not isinstance(value, int) or isinstance(value, bool):
                problems.append("bad type: " + field)
        elif not isinstance(value, kind):
            problems.append("bad type: " + field)
    if isinstance(state.get("phase"), str) and state["phase"] not in STATE_PHASES:
        problems.append("unknown phase")
    if isinstance(state.get("admission"), str) and state["admission"] not in STATE_ADMISSIONS:
        problems.append("unknown admission")
    return problems


def initial_state():
    return {
        "format": STATE_FORMAT,
        "sequence": 0,
        "event_id": None,
        "generation": 0,
        "bound_release_sha256": None,
        "bound_owner_task": None,
        "phase": "IDLE",
        "admission": "READY",
        "blocked_reason": None,
        "cancel_requested": False,
        "pending_audit": False,
        "pending_event": None,
        "write_lease": None,
        "slot": None,
        "history": [],
    }


def read_authority_state(authority):
    """Read the authority state; a damaged or incomplete state is refused."""
    path = Path(authority) / STATE_FILENAME
    if not path.exists():
        return None
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as error:
        raise AdmissionError("STATE_UNREADABLE", {"path": str(path), "errno": error.errno})
    if raw.strip() == "":
        raise AdmissionError("STATE_EMPTY_REFUSED", {"path": str(path)})
    try:
        state = json.loads(raw)
    except ValueError as error:
        raise AdmissionError("STATE_UNPARSABLE", {"path": str(path), "detail": str(error)})
    problems = validate_state(state)
    if problems:
        raise AdmissionError("STATE_SCHEMA_INVALID", {"path": str(path), "problems": problems})
    return state


def read_state_sequence(authority):
    """A cheap read of the current sequence for the preflight race check."""
    path = Path(authority) / STATE_FILENAME
    if not path.exists():
        return None
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(state, dict):
        return None
    sequence = state.get("sequence")
    return sequence if isinstance(sequence, int) and not isinstance(sequence, bool) else None


class AuthorityLock:
    """The short transaction lock of the one authority.  Never held across a wait."""

    def __init__(self, authority):
        self.path = Path(authority) / LOCK_FILENAME
        self.fd = None

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        try:
            self.fd = os.open(str(self.path), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except FileExistsError:
            raise AdmissionError("LOCK_HELD_UNRECOGNISED", {"lock": str(self.path)})
        except OSError as error:
            raise AdmissionError("LOCK_UNAVAILABLE", {"lock": str(self.path), "errno": error.errno})
        try:
            os.write(self.fd, json.dumps({"pid": os.getpid(), "at": now_iso()}).encode("utf-8"))
            os.fsync(self.fd)
        except OSError:
            pass
        return self

    def __exit__(self, exc_type, exc, tb):
        if self.fd is not None:
            try:
                os.close(self.fd)
            except OSError:
                pass
            self.fd = None
        try:
            os.unlink(str(self.path))
        except OSError:
            pass
        return False


def _fsync_dir(path):
    try:
        fd = os.open(str(path), os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(fd)
    except OSError:
        pass
    finally:
        os.close(fd)


def atomic_write_bytes(path, data):
    """Write to a unique temp file in the same directory, then atomic replace."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.parent / (".%s.tmp-%d-%s" % (path.name, os.getpid(), secrets.token_hex(6)))
    try:
        with open(tmp, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(str(tmp), str(path))
    except OSError as error:
        try:
            os.unlink(str(tmp))
        except OSError:
            pass
        raise AdmissionError("STATE_REPLACE_FAILED", {"path": str(path), "errno": error.errno})
    _fsync_dir(path.parent)


def _encode_json(payload):
    return json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True).encode("utf-8")


def commit_event(authority, new_state, action, detail=None):
    """One authority transaction.

    The schema, the slot identity and an outstanding pending_audit are checked
    first; an old pending event is never cleared by a new one.  The write order
    is state(pending_audit=true) -> journal -> state(pending_audit=false).
    """
    authority = Path(authority)
    authority.mkdir(parents=True, exist_ok=True)
    existing = read_authority_state(authority)
    if existing is not None:
        if existing.get("pending_audit"):
            raise AdmissionError("PENDING_AUDIT_NOT_CLEARED", {
                "event_id": existing.get("event_id"),
                "pending_event": existing.get("pending_event"),
            })
        if existing.get("slot") is not None and new_state.get("slot") is not None:
            if (existing["slot"].get("run_id") != new_state["slot"].get("run_id")
                    or existing["slot"].get("generation") != new_state["slot"].get("generation")):
                raise AdmissionError("SLOT_IDENTITY_MISMATCH", {
                    "authoritative_run_id": existing["slot"].get("run_id"),
                    "given_run_id": new_state["slot"].get("run_id"),
                })
    base = dict(new_state)
    sequence = int(base.get("sequence") or 0) + 1
    event_id = "evt-" + secrets.token_hex(8)
    base["format"] = STATE_FORMAT
    base["sequence"] = sequence
    base["event_id"] = event_id
    base["updated_at"] = now_iso()
    problems = validate_state(base)
    if problems:
        raise AdmissionError("STATE_SCHEMA_INVALID", {"problems": problems})

    staged = dict(base)
    staged["pending_audit"] = True
    staged["pending_event"] = {"event_id": event_id, "action": action, "at": base["updated_at"]}
    try:
        atomic_write_bytes(Path(authority) / STATE_FILENAME, _encode_json(staged))
    except AdmissionError as error:
        raise AdmissionError("STATE_REPLACE_FAILED_OLD_STATE_PRESERVED",
                             {"action": action, "cause": error.detail})

    record = {
        "event_id": event_id,
        "sequence": sequence,
        "at": base["updated_at"],
        "action": action,
        "detail": detail if isinstance(detail, dict) else {},
    }
    try:
        with open(Path(authority) / JOURNAL_FILENAME, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
    except OSError as error:
        raise AdmissionError("JOURNAL_APPEND_FAILED_PENDING_AUDIT",
                             {"action": action, "errno": error.errno, "event_id": event_id})

    final = dict(base)
    final["pending_audit"] = False
    final["pending_event"] = None
    try:
        atomic_write_bytes(Path(authority) / STATE_FILENAME, _encode_json(final))
    except AdmissionError as error:
        raise AdmissionError("STATE_FINALIZE_FAILED_PENDING_AUDIT",
                             {"action": action, "cause": error.detail, "event_id": event_id})
    return final, event_id, sequence


def read_journal(authority):
    """The authority journal, read as a list of committed events."""
    path = Path(authority) / JOURNAL_FILENAME
    if not path.exists():
        return []
    events = []
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


def require_binding(state, release, release_sha256, allow_initial=False):
    """A normal entry must match the release this authority is bound to."""
    bound = state.get("bound_release_sha256")
    if bound is None:
        if not allow_initial:
            raise AdmissionError("RELEASE_NOT_BOUND_TO_AUTHORITY", {})
        return
    if bound != release_sha256:
        raise AdmissionError("RELEASE_NOT_BOUND_TO_AUTHORITY",
                             {"bound": bound, "given": release_sha256})
    if state.get("bound_owner_task") != release["owner_task"]:
        raise AdmissionError("OWNER_TASK_MISMATCH",
                             {"bound": state.get("bound_owner_task"),
                              "given": release["owner_task"]})
    if state.get("generation") != release["generation"]:
        raise AdmissionError("GENERATION_MISMATCH",
                             {"bound": state.get("generation"),
                              "given": release["generation"]})


def slot_is_active(state):
    slot = (state or {}).get("slot")
    return bool(slot) and slot.get("phase") in ("STARTING", "RUNNING", "UNKNOWN")


def slot_is_unknown(state):
    slot = (state or {}).get("slot")
    return bool(slot) and slot.get("phase") == "UNKNOWN"


# ---------------------------------------------------------------------------
# source / protected verification
# ---------------------------------------------------------------------------

def discover_recorded_source(root, recorder_rel):
    """Reproduce the original recorder discovery scope exactly."""
    root = Path(root)
    found = set()
    for prefix in ("src", "contracts", "tests", "tools",
                   "docs/parallel/lane-bridge/A-R2-20261112"):
        base = root / prefix
        if not base.is_dir():
            continue
        for candidate in base.rglob("*"):
            if candidate.is_file() and candidate.suffix in {
                ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json",
                ".py", ".html", ".css", ".sql", ".sh",
            }:
                found.add(str(candidate.relative_to(root)))
    for name in ("package.json", "pnpm-lock.yaml", "tsconfig.json", "vitest.config.ts"):
        if (root / name).is_file():
            found.add(name)
    found.add(recorder_rel)
    return sorted(found)


def verify_recorded_source(root, release):
    problems = []
    root = Path(root)
    for row in release["recorded_source"]:
        target = root / row["path"]
        if not target.is_file():
            problems.append({"path": row["path"], "problem": "missing"})
            continue
        actual = sha256_file(target)
        if actual != row["sha256"]:
            problems.append({"path": row["path"], "problem": "digest_mismatch",
                             "expected": row["sha256"], "actual": actual})
    return problems


def verify_source_scope(root, release):
    root = Path(root)
    discovered = set(discover_recorded_source(root, release["recorder"]["path"]))
    pinned = {row["path"] for row in release["recorded_source"]}
    problems = []
    if pinned - discovered:
        problems.append({"problem": "pinned_source_not_discovered",
                         "paths": sorted(pinned - discovered)})
    if discovered - pinned:
        problems.append({"problem": "unpinned_source_discovered",
                         "paths": sorted(discovered - pinned)})
    return problems


def resolve_protected_path(root, declared):
    """A protected input may be repository relative or an exact absolute pin."""
    candidate = Path(declared)
    if not candidate.is_absolute():
        candidate = Path(root) / candidate
    return candidate


def verify_protected(root, release):
    problems = []
    root = Path(root)
    for row in release.get("protected_inputs", []):
        target = resolve_protected_path(root, row["path"])
        if not target.is_file():
            problems.append({"path": row["path"], "problem": "missing"})
            continue
        actual = sha256_file(target)
        if actual != row["sha256"]:
            problems.append({"path": row["path"], "problem": "digest_mismatch",
                             "expected": row["sha256"], "actual": actual})
    return problems


def verify_recorder(root, release):
    target = Path(root) / release["recorder"]["path"]
    if not target.is_file():
        return [{"path": release["recorder"]["path"], "problem": "missing"}]
    actual = sha256_file(target)
    if actual != release["recorder"]["sha256"]:
        return [{"path": release["recorder"]["path"], "problem": "digest_mismatch",
                 "expected": release["recorder"]["sha256"], "actual": actual}]
    return []


def digest_rows(root, release, key):
    """The actual digests of a pinned set, for the pre/post observation."""
    root = Path(root)
    observed = []
    for row in release.get(key, []):
        target = resolve_protected_path(root, row["path"])
        observed.append({
            "path": row["path"],
            "sha256": sha256_file(target) if target.is_file() else None,
        })
    return observed


# ---------------------------------------------------------------------------
# /proc observation (read-only, no signals, no kill, no fork)
# ---------------------------------------------------------------------------

def read_proc_identity(pid):
    raw = Path("/proc/%d/stat" % int(pid)).read_text()
    close = raw.rfind(")")
    if close < 0:
        raise ValueError("unparsable /proc stat")
    rest = raw[close + 2:].split()
    if len(rest) < 20:
        raise ValueError("short /proc stat")
    return {
        "pid": int(pid),
        "state": rest[0],
        "ppid": int(rest[1]),
        "pgid": int(rest[2]),
        "sid": int(rest[3]),
        "start_ticks": int(rest[19]),
    }


def read_boot_id():
    return Path("/proc/sys/kernel/random/boot_id").read_text().strip()


def read_wrapper_epoch():
    """The wrapper's own complete identity.  Without it nothing may be scheduled."""
    epoch = {
        "pid": os.getpid(),
        "start_ticks": None,
        "boot_id": None,
        "ppid": None,
        "session": None,
        "group": None,
    }
    missing = []
    try:
        boot = read_boot_id()
    except (OSError, ValueError):
        boot = None
    if not isinstance(boot, str) or not boot.strip():
        missing.append("boot_id")
    else:
        epoch["boot_id"] = boot
    try:
        identity = read_proc_identity(os.getpid())
    except (OSError, ValueError):
        identity = None
    if not isinstance(identity, dict) or identity.get("pid") != os.getpid():
        missing.append("identity")
    else:
        epoch["start_ticks"] = identity.get("start_ticks")
        epoch["ppid"] = identity.get("ppid")
        epoch["session"] = identity.get("sid")
        epoch["group"] = identity.get("pgid")
        for field in ("start_ticks", "ppid", "session", "group"):
            if not isinstance(epoch[field], int):
                missing.append(field)
    epoch["missing"] = missing
    epoch["complete"] = not missing
    return epoch, missing


def read_identity_after_session(pid, settle_seconds=SESSION_SETTLE_SECONDS):
    """Read the identity of a child that was started in its own session."""
    deadline = time.monotonic() + settle_seconds
    identity = None
    error = None
    while True:
        try:
            identity = read_proc_identity(pid)
            error = None
        except (OSError, ValueError) as failure:
            identity = None
            error = {"detail": type(failure).__name__}
        if identity and identity["sid"] == pid and identity["pgid"] == pid:
            return identity, None
        if time.monotonic() >= deadline:
            return identity, error or {"detail": "session_not_settled"}
        time.sleep(0.02)


def read_recorder_epoch(pid, wrapper_epoch):
    """The recorder epoch, verified against the chain this tool created.

    The identity is recorded separately from the verification: a child whose
    epoch cannot be confirmed is still waited for, but it never yields CLEAN.
    The return contract is (epoch, verified, problems).
    """
    epoch = {"pid": int(pid), "start_ticks": None, "boot_id": None, "ppid": None,
             "session": None, "group": None, "identity_verified": False, "missing": []}
    problems = []
    identity, error = read_identity_after_session(pid)
    if not isinstance(identity, dict) or identity.get("pid") != int(pid):
        epoch["missing"].append("identity")
        epoch["identity_error"] = error
        problems.append({"problem": "identity_is_not_the_started_child", "detail": error})
        return epoch, False, problems
    epoch["start_ticks"] = identity.get("start_ticks")
    epoch["ppid"] = identity.get("ppid")
    epoch["session"] = identity.get("sid")
    epoch["group"] = identity.get("pgid")
    try:
        boot = read_boot_id()
    except (OSError, ValueError):
        boot = None
    if isinstance(boot, str) and boot.strip():
        epoch["boot_id"] = boot
    else:
        epoch["missing"].append("boot_id")
        problems.append({"problem": "boot_id_unavailable"})
    wrapper_pid = (wrapper_epoch or {}).get("pid")
    if wrapper_pid is not None and identity.get("ppid") != wrapper_pid:
        epoch["missing"].append("ppid_mismatch")
        problems.append({"problem": "ppid_is_not_the_wrapper"})
    if identity.get("sid") != int(pid) or identity.get("pgid") != int(pid):
        epoch["missing"].append("session_mismatch")
        problems.append({"problem": "session_or_group_is_not_its_own"})
    wrapper_boot = (wrapper_epoch or {}).get("boot_id")
    if wrapper_boot and epoch.get("boot_id") != wrapper_boot:
        epoch["missing"].append("boot_mismatch")
        problems.append({"problem": "boot_id_differs_from_the_wrapper"})
    for field in ("start_ticks", "ppid", "session", "group"):
        if not isinstance(epoch.get(field), int):
            epoch["missing"].append(field)
            problems.append({"problem": "incomplete_epoch_field", "field": field})
    epoch["identity_verified"] = not epoch["missing"]
    return epoch, epoch["identity_verified"], problems

def scan_group_members(pgid, exclude_pids=()):
    """Observe the members of the group this runner created.

    Returns (members, vanished_entries, undeterminable_entries).  An entry that
    disappeared (ENOENT/ESRCH) is an observation limit only.  An entry that
    could not be read for any other reason means the group membership cannot be
    determined and the caller must stay UNKNOWN.
    """
    members = []
    vanished = 0
    undeterminable = 0
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        pid = int(entry.name)
        if pid in exclude_pids:
            continue
        try:
            identity = read_proc_identity(pid)
        except (FileNotFoundError, ProcessLookupError):
            vanished += 1
            continue
        except (PermissionError, OSError, ValueError):
            undeterminable += 1
            continue
        if identity["pgid"] == pgid:
            members.append({
                "pid": pid,
                "state": identity["state"],
                "start_ticks": identity["start_ticks"],
            })
    members.sort(key=lambda row: row["pid"])
    return members, vanished, undeterminable


def observe_epoch(slot):
    """Read-only observation of the recorded epoch.  Never proof by PID alone."""
    observation = {
        "recorded_pid": (slot or {}).get("recorder_pid"),
        "recorded_start_ticks": (slot or {}).get("recorder_start_ticks"),
        "recorded_pgid": (slot or {}).get("recorder_pgid"),
        "recorded_sid": (slot or {}).get("recorder_sid"),
        "boot_id": (slot or {}).get("boot_id"),
        "conclusion": "no recorded epoch",
    }
    if not slot or slot.get("recorder_pid") is None:
        return observation
    pid = slot["recorder_pid"]
    try:
        identity = read_proc_identity(pid)
    except (OSError, ValueError) as error:
        observation["pid_entry_readable"] = False
        observation["detail"] = type(error).__name__
        observation["conclusion"] = (
            "proc entry unreadable; this is not evidence that the process exited"
        )
        return observation
    observation["pid_entry_readable"] = True
    observation["current_state"] = identity["state"]
    observation["current_start_ticks"] = identity["start_ticks"]
    observation["start_ticks_match"] = identity["start_ticks"] == slot.get("recorder_start_ticks")
    observation["conclusion"] = (
        "epoch observed through /proc; PID presence alone proves neither liveness nor exit"
    )
    return observation


# ---------------------------------------------------------------------------
# capture helpers
# ---------------------------------------------------------------------------

def capture_paths(directory, basename):
    directory = Path(directory)
    return {suffix: directory / (basename + suffix) for suffix in CAPTURE_SUFFIXES}


def capture_digests(directory, basename):
    """The real digest of every original capture piece (None when absent)."""
    digests = {}
    for suffix, path in capture_paths(directory, basename).items():
        digests[suffix] = sha256_file(path) if path.is_file() else None
    return digests


def find_allocation(release, command_id, run_id):
    matches = [
        allocation for allocation in release["capture_allocations"]
        if allocation["command_id"] == command_id and allocation["run_id"] == run_id
    ]
    if not matches:
        raise AdmissionError("CAPTURE_ALLOCATION_NOT_FOUND",
                             {"command_id": command_id, "run_id": run_id})
    if len(matches) > 1:
        raise AdmissionError("CAPTURE_ALLOCATION_AMBIGUOUS",
                             {"command_id": command_id, "run_id": run_id})
    return matches[0]


def recorder_directory_for(release, allocation, project_root):
    """The six piece capture set may only be added to the original recorder directory."""
    recorder_dir = (Path(project_root) / release["recorder"]["path"]).resolve().parent
    declared = allocation.get("recorder_directory")
    if declared:
        declared_path = Path(declared)
        if not declared_path.is_absolute():
            declared_path = Path(project_root) / declared_path
        if declared_path.resolve() != recorder_dir:
            raise AdmissionError("CAPTURE_DIRECTORY_NOT_RECORDER_DIRECTORY",
                                 {"declared": str(declared_path.resolve()),
                                  "recorder_directory": str(recorder_dir)})
    return recorder_dir


def assert_capture_absent(directory, basename):
    paths = capture_paths(directory, basename)
    existing = sorted(suffix for suffix, path in paths.items() if path.exists())
    if existing:
        raise AdmissionError("CAPTURE_ALREADY_EXISTS",
                             {"basename": basename, "directory": str(directory),
                              "existing_suffixes": existing})
    return paths


def evaluate_capture(directory, basename, release, command, expected_inner_exit):
    """Check the six original recorder pieces.  Missing pieces are never recreated."""
    directory = Path(directory)
    paths = capture_paths(directory, basename)
    problems = []
    details = {}
    for suffix, path in sorted(paths.items()):
        if not path.exists():
            problems.append({"problem": "capture_piece_missing", "suffix": suffix, "path": str(path)})
    if problems:
        return False, problems, details

    claim = read_json_file(paths[".claim.json"], "CAPTURE_CLAIM")
    command_record = read_json_file(paths[".cmd.json"], "CAPTURE_CMD")
    inputs = read_json_file(paths[".inputs.json"], "CAPTURE_INPUTS")
    result = read_json_file(paths[".result.json"], "CAPTURE_RESULT")
    try:
        exit_code = int(paths[".exit"].read_text().strip())
    except (OSError, ValueError):
        problems.append({"problem": "capture_exit_unreadable"})
        exit_code = None

    if not isinstance(claim, dict):
        problems.append({"problem": "capture_claim_not_object"})
    elif claim.get("runner_version") != RECORDER_RUNNER_VERSION:
        problems.append({"problem": "claim_runner_version_mismatch"})
    if isinstance(claim, dict):
        if claim.get("name") != basename:
            problems.append({"problem": "claim_name_mismatch"})
        if claim.get("argv") != list(command["argv"]):
            problems.append({"problem": "claim_argv_mismatch"})
    if not isinstance(command_record, dict):
        problems.append({"problem": "capture_cmd_not_object"})
    else:
        if command_record.get("runner_version") != RECORDER_RUNNER_VERSION:
            problems.append({"problem": "cmd_runner_version_mismatch"})
        if command_record.get("argv") != list(command["argv"]):
            problems.append({"problem": "cmd_argv_mismatch"})
        if command_record.get("cwd") != command["cwd"]:
            problems.append({"problem": "cmd_cwd_mismatch"})
    if not isinstance(inputs, dict):
        problems.append({"problem": "inputs_not_object"})
        inputs = {}
    if not isinstance(result, dict):
        problems.append({"problem": "result_not_object"})
        result = {}
    pinned = {row["path"]: row["sha256"] for row in release["recorded_source"]}
    input_keys = set(inputs)
    if input_keys != set(pinned):
        problems.append({
            "problem": "inputs_key_set_mismatch",
            "extra": sorted(input_keys - set(pinned)),
            "missing": sorted(set(pinned) - input_keys),
        })
    else:
        for path, sha in sorted(pinned.items()):
            if inputs.get(path) != sha:
                problems.append({"problem": "input_digest_mismatch", "path": path})
    if exit_code is not None:
        if result.get("exit") != exit_code:
            problems.append({"problem": "exit_result_mismatch"})
        if exit_code != expected_inner_exit:
            problems.append({
                "problem": "inner_exit_mismatch",
                "expected": expected_inner_exit,
                "actual": exit_code,
            })
    if result.get("source_changed") not in ([], None):
        problems.append({"problem": "source_changed_not_empty"})
    if result.get("source_added") not in ([], None):
        problems.append({"problem": "source_added_not_empty"})
    actual_log_sha = sha256_file(paths[".txt"])
    if result.get("log_sha256") != actual_log_sha:
        problems.append({"problem": "log_digest_mismatch"})
    details = {
        "inner_exit": exit_code,
        "log_sha256": actual_log_sha,
        "log_text": paths[".txt"].read_text(encoding="utf-8", errors="replace"),
        "claim_name": claim.get("name") if isinstance(claim, dict) else None,
    }
    return (not problems), problems, details


def expected_outer_for_inner(inner_exit):
    """POSIX encoding of a normally completed recorder that exits with inner & 255."""
    return inner_exit & 255


# ---------------------------------------------------------------------------
# authorised slot qualification
# ---------------------------------------------------------------------------

def qualify_slots(release, allocation, command_id):
    """The authorised slots of this exact run.

    A slot qualifies only when the same case, the same command, the same
    capture and the same run agree, and the slot belongs to a stage this
    release approves.  A slot of another case, command, capture or run can
    never lend its assertion, and there is no "command OR capture" fallback.
    """
    qualified = []
    for case_id in allocation.get("case_ids") or []:
        binding = release.get("case_bindings", {}).get(case_id)
        if not isinstance(binding, dict):
            continue
        for slot in binding.get("required_evidence", []):
            if not isinstance(slot, dict):
                continue
            if slot.get("command_id") != command_id:
                continue
            if slot.get("capture_basename") != allocation.get("basename"):
                continue
            if slot.get("run_id") != allocation.get("run_id"):
                continue
            stage = slot.get("approved_stage_release", "SELF")
            if stage != "SELF":
                approved = (release.get("approved_stage_releases") or {}).get(stage)
                if not isinstance(approved, dict):
                    continue
            qualified.append((case_id, slot))
    return qualified


# ---------------------------------------------------------------------------
# commands
# ---------------------------------------------------------------------------

def _require_release_identity(release, owner_task):
    _require(isinstance(owner_task, str) and owner_task, "OWNER_TASK_REQUIRED")
    _require(release["owner_task"] == owner_task, "OWNER_TASK_MISMATCH",
             {"release_owner_task": release["owner_task"], "cli_owner_task": owner_task})


class OwnedChild:
    """A started child with exactly one wait, owned by whoever started it."""

    def __init__(self, child):
        self.child = child
        self.waited = False
        self.returncode = None

    def wait(self):
        if not self.waited:
            self.waited = True
            self.returncode = self.child.wait()
        return self.returncode


def command_status(args):
    """Read-only status: the saved epoch plus the live /proc observation."""
    payload = {"command": "status"}
    if not args.release:
        raise AdmissionError("STATUS_NEEDS_RELEASE")
    release, release_sha = load_release(args.release, args.expected_release_sha256)
    validate_release(release)
    project_root = Path(release["project_root"])
    authority = authority_root(project_root)
    state = read_authority_state(authority)
    payload["release"] = {
        "path": str(args.release),
        "sha256": release_sha,
        "release_id": release["release_id"],
        "phase": release["phase"],
    }
    payload["authority"] = str(authority)
    payload["state"] = state
    payload["observation"] = observe_epoch((state or {}).get("slot"))
    payload["admission"] = (state or {}).get("admission", "UNKNOWN")
    payload["bound_release_sha256"] = (state or {}).get("bound_release_sha256")
    payload["business_acceptance"] = False
    payload["note"] = (
        "status is read-only; it never rebinds and never repairs a pending event"
    )
    return payload


def command_begin_write(args):
    release, release_sha = load_release(args.release, args.expected_release_sha256)
    validate_release(release)
    _require_release_identity(release, args.owner_task)
    project_root = Path(release["project_root"])
    authority = authority_root(project_root)
    with AuthorityLock(authority):
        state = read_authority_state(authority)
        if state is None:
            state = initial_state()
        require_binding(state, release, release_sha, allow_initial=True)
        if state.get("pending_audit"):
            raise AdmissionError("PENDING_AUDIT_NOT_CLEARED",
                                 {"event_id": state.get("event_id")})
        if slot_is_unknown(state):
            raise AdmissionError("UNKNOWN_RESOURCE_HOLDS_RESPONSIBILITY", {"slot": state.get("slot")})
        if slot_is_active(state):
            raise AdmissionError("ACTIVE_RUN_BLOCKS_WRITE",
                                 {"slot_phase": state["slot"].get("phase")})
        if state.get("write_lease"):
            raise AdmissionError("WRITE_LEASE_ALREADY_HELD", {"lease": state["write_lease"]})
        lease = {
            "owner_task": args.owner_task,
            "nonce": "nonce-" + secrets.token_hex(12),
            "generation": release["generation"],
            "release_sha256": release_sha,
            "release_id": release["release_id"],
            "started_at": now_iso(),
        }
        state = dict(state)
        state["bound_release_sha256"] = release_sha
        state["bound_owner_task"] = release["owner_task"]
        state["generation"] = release["generation"]
        state["write_lease"] = lease
        state["phase"] = "WRITING"
        state["admission"] = "BLOCKED"
        state["blocked_reason"] = "WRITE_LEASE_HELD"
        state, _event_id, _sequence = commit_event(authority, state, "begin-write",
                                                  {"owner_task": args.owner_task})
    return {
        "command": "begin-write",
        "write_lease": lease,
        "nonce": lease["nonce"],
        "generation": lease["generation"],
        "authority": str(authority),
        "note": "logical write permission only; this is not an OS write barrier and not liveness proof",
    }


def _diff_against_pin(project_root, release):
    project_root = Path(project_root)
    changed = []
    removed = []
    post_hashes = {}
    for row in release["recorded_source"]:
        target = project_root / row["path"]
        if not target.is_file():
            removed.append(row["path"])
            continue
        actual = sha256_file(target)
        post_hashes[row["path"]] = actual
        if actual != row["sha256"]:
            changed.append(row["path"])
    pinned = {row["path"] for row in release["recorded_source"]}
    discovered = set(discover_recorded_source(project_root, release["recorder"]["path"]))
    added = sorted(discovered - pinned)
    for path in added:
        target = project_root / path
        if target.is_file():
            post_hashes[path] = sha256_file(target)
    return changed, removed, added, post_hashes


def command_end_write(args):
    release, release_sha = load_release(args.release, args.expected_release_sha256)
    validate_release(release)
    _require_release_identity(release, args.owner_task)
    project_root = Path(release["project_root"])
    authority = authority_root(project_root)
    with AuthorityLock(authority):
        state = read_authority_state(authority)
        if state is None:
            raise AdmissionError("NO_WRITE_LEASE", {})
        require_binding(state, release, release_sha)
        lease = state.get("write_lease")
        if not lease:
            raise AdmissionError("NO_WRITE_LEASE", {})
        if lease.get("owner_task") != args.owner_task:
            raise AdmissionError("WRITE_LEASE_OWNER_MISMATCH",
                                 {"lease_owner": lease.get("owner_task")})
        if lease.get("nonce") != args.nonce:
            raise AdmissionError("WRITE_LEASE_NONCE_MISMATCH", {})
        if int(lease.get("generation")) != int(args.generation):
            raise AdmissionError("WRITE_LEASE_GENERATION_MISMATCH",
                                 {"lease_generation": lease.get("generation")})
        if lease.get("release_sha256") != release_sha:
            raise AdmissionError("WRITE_LEASE_RELEASE_MISMATCH",
                                 {"lease_release": lease.get("release_sha256"),
                                  "given": release_sha})
        protected_problems = verify_protected(project_root, release)
        if protected_problems:
            state = dict(state)
            state["admission"] = "BLOCKED"
            state["blocked_reason"] = "PROTECTED_INPUT_VIOLATION"
            lease = dict(lease)
            lease["violation"] = protected_problems
            state["write_lease"] = lease
            try:
                commit_event(authority, state, "end-write-violation",
                             {"problems": protected_problems})
            except AdmissionError:
                pass
            raise AdmissionError("PROTECTED_INPUT_VIOLATION", {"problems": protected_problems})
        changed, removed, added, post_hashes = _diff_against_pin(project_root, release)
        state = dict(state)
        state["write_lease"] = None
        state["phase"] = "TERMINAL"
        state["admission"] = "BLOCKED"
        state["blocked_reason"] = "STALE_PIN_AFTER_AUTHORIZED_SOURCE_CHANGE"
        state["last_write_diff"] = {
            "changed": changed,
            "removed": removed,
            "added": added,
            "post_hashes": post_hashes,
        }
        state, _event_id, _sequence = commit_event(authority, state, "end-write",
                                                  {"changed": changed, "removed": removed,
                                                   "added": added})
    return {
        "command": "end-write",
        "closed": True,
        "changed": changed,
        "removed": removed,
        "added": added,
        "admission": "BLOCKED",
        "blocked_reason": "STALE_PIN_AFTER_AUTHORIZED_SOURCE_CHANGE",
        "note": "the tool never re-approves the modified source; only an explicit new release may rebind it",
    }


def command_request_cancel(args):
    release, release_sha = load_release(args.release, args.expected_release_sha256)
    validate_release(release)
    _require_release_identity(release, args.owner_task)
    project_root = Path(release["project_root"])
    authority = authority_root(project_root)
    with AuthorityLock(authority):
        state = read_authority_state(authority)
        if state is None:
            raise AdmissionError("RUN_NOT_FOUND", {"run_id": args.run_id})
        require_binding(state, release, release_sha)
        slot = state.get("slot")
        if not slot or slot.get("run_id") != args.run_id:
            raise AdmissionError("RUN_NOT_FOUND", {"run_id": args.run_id})
        if slot.get("owner_task") != args.owner_task:
            raise AdmissionError("RUN_OWNER_MISMATCH", {"run_id": args.run_id})
        if slot.get("phase") in ("TERMINAL", "UNKNOWN"):
            state = dict(state)
            state["cancel_requested"] = True
            state, _event_id, _sequence = commit_event(
                authority, state, "request-cancel-already-terminal", {"run_id": args.run_id})
            return {
                "command": "request-cancel",
                "result": "ALREADY_TERMINAL",
                "cancel_requested": True,
                "run_id": args.run_id,
                "note": "a late request never retracts an observed terminal fact",
            }
        state = dict(state)
        state["cancel_requested"] = True
        slot = dict(slot)
        slot["cancel_requested"] = True
        state["slot"] = slot
        state, _event_id, _sequence = commit_event(authority, state, "request-cancel",
                                                  {"run_id": args.run_id})
    return {
        "command": "request-cancel",
        "result": "CANCEL_REQUESTED",
        "cancel_requested": True,
        "run_id": args.run_id,
        "note": "a recorded request only; no signal is sent and the slot is not released",
    }


def command_rebind(args):
    release, release_sha = load_release(args.release, args.expected_release_sha256)
    validate_release(release)
    _require_release_identity(release, args.owner_task)
    project_root = Path(release["project_root"])
    authority = authority_root(project_root)
    with AuthorityLock(authority):
        state = read_authority_state(authority)
        if state is None:
            state = initial_state()
        if state.get("pending_audit"):
            raise AdmissionError("PENDING_AUDIT_NOT_CLEARED",
                                 {"event_id": state.get("event_id")})
        if state.get("write_lease"):
            raise AdmissionError("WRITE_LEASE_OPEN_REBIND_REJECTED", {"lease": state["write_lease"]})
        if slot_is_unknown(state):
            raise AdmissionError("UNKNOWN_RESOURCE_HOLDS_RESPONSIBILITY", {"slot": state.get("slot")})
        if slot_is_active(state):
            raise AdmissionError("ACTIVE_RUN_BLOCKS_REBIND",
                                 {"slot_phase": state["slot"].get("phase")})
        bound = state.get("bound_release_sha256")
        if bound == release_sha:
            raise AdmissionError("REBIND_NOT_A_NEW_RELEASE", {"release_sha256": release_sha})
        if release["generation"] <= int(state.get("generation") or 0):
            raise AdmissionError("REBIND_GENERATION_NOT_NEWER",
                                 {"bound_generation": state.get("generation"),
                                  "given": release["generation"]})
        previous = {
            "release_sha256": bound,
            "release_id": state.get("release_id"),
            "blocked_reason": state.get("blocked_reason"),
            "generation": state.get("generation"),
        }
        problems = (verify_recorded_source(project_root, release)
                    + verify_source_scope(project_root, release)
                    + verify_protected(project_root, release)
                    + verify_recorder(project_root, release))
        state = dict(state)
        state["bound_release_sha256"] = release_sha
        state["bound_owner_task"] = release["owner_task"]
        state["release_id"] = release["release_id"]
        state["generation"] = release["generation"]
        state["rebind_history"] = (state.get("rebind_history") or [])[-9:] + [previous]
        if problems:
            state["admission"] = "BLOCKED"
            state["blocked_reason"] = "REBOUND_SOURCE_STILL_DRIFTED"
            state["rebind_problems"] = problems
        else:
            state["admission"] = "READY"
            state["blocked_reason"] = None
            state["rebind_problems"] = []
        state, _event_id, _sequence = commit_event(
            authority, state, "rebind", {"new_release_sha256": release_sha, "problems": problems})
    return {
        "command": "rebind",
        "release_sha256": release_sha,
        "release_id": release["release_id"],
        "generation": release["generation"],
        "admission": state["admission"],
        "blocked_reason": state.get("blocked_reason"),
        "problems": problems,
        "authority": str(authority),
        "note": "old evidence is preserved; unknown resources are never cleared by a rebind",
    }


def _write_sidecar(artefact_root, release, release_sha, command_id, slot, allocation,
                   inner_exit, outer, digests, source_pre, source_post,
                   protected_pre, protected_post, resource_status, cleanup_source,
                   metadata_ok, metadata_problems, wrapper_epoch, recorder_epoch):
    """The run sidecar: real pre/post values, real piece digests, real wait."""
    directory = Path(artefact_root) / SIDECARS_DIRNAME
    directory.mkdir(parents=True, exist_ok=True)
    payload = {
        "format": SIDECAR_FORMAT,
        "evidence_layer": "BOOTSTRAP" if release.get("phase") == "BOOTSTRAP_CODE" else "TOOL_RUNTIME",
        "release_sha256": release_sha,
        "release_id": release.get("release_id"),
        "release_phase": release.get("phase"),
        "run_id": slot.get("run_id"),
        "command_id": command_id,
        "capture_basename": allocation.get("basename"),
        "capture_directory": slot.get("capture_directory"),
        "owner_task": slot.get("owner_task"),
        "generation": slot.get("generation"),
        "recorder_argv": slot.get("recorder_argv"),
        "inner_argv": slot.get("inner_argv"),
        "cwd": slot.get("cwd"),
        "capture_digests": digests,
        "inner_exit": inner_exit,
        "recorder_wait_returncode": outer,
        "source_pre": source_pre,
        "source_post": source_post,
        "protected_pre": protected_pre,
        "protected_post": protected_post,
        "resource_status": resource_status,
        "cleanup_source": cleanup_source,
        "wrapper_epoch": wrapper_epoch,
        "recorder_epoch": recorder_epoch,
        "metadata_ok": bool(metadata_ok),
        "metadata_problems": metadata_problems,
        "created_at": now_iso(),
    }
    path = directory / (str(slot.get("run_id")) + ".json")
    atomic_write_bytes(path, _encode_json(payload))
    return path


def _write_credential(artefact_root, release, release_sha, command_id, slot, command,
                       allocation, inner_exit, outer, problems, drift, live_members,
                       resource_status, cleanup_source, sidecar_path, source_pre,
                       source_post, protected_pre, protected_post, digests, log_text):
    """Bind an observed result to this exact run, capture, source set and cleanup.

    The case qualification comes from the authorised slot of this exact
    command, capture and run, and the specified assertion must actually appear
    in the recorded log.  Without that the credential states no case and signs
    no case_passed; the physical observation stays exactly as observed.
    """
    directory = Path(artefact_root) / CREDENTIALS_DIRNAME
    directory.mkdir(parents=True, exist_ok=True)
    run_id = slot.get("run_id")
    case_ids = list(allocation.get("case_ids") or [])
    qualified = qualify_slots(release, allocation, command_id)
    requirements = []
    for _case_id, qualified_slot in qualified:
        requirements.append(json.dumps(qualified_slot.get("expected_failure_requirement"),
                                       sort_keys=True))
    ambiguous = len(set(requirements)) > 1
    expected_failure = None
    assertion = None
    qualified_cases = []
    if qualified and not ambiguous:
        expected_failure = qualified[0][1].get("expected_failure_requirement")
        assertion = (expected_failure or {}).get("assertion")
        qualified_cases = [case_id for case_id, _slot in qualified]
    assertion_reached = bool(assertion and assertion in (log_text or ""))
    sidecar_sha = None
    if sidecar_path is not None and Path(sidecar_path).is_file():
        sidecar_sha = sha256_file(sidecar_path)
    cleanup_verified = bool(resource_status == "CLEAN" and not live_members)
    case_qualified = bool(qualified_cases and not ambiguous and cleanup_verified
                          and not problems and not drift
                          and (assertion is None or assertion_reached))
    credential = {
        "format": CREDENTIAL_FORMAT,
        "command_id": command_id,
        "capture_basename": allocation.get("basename"),
        "run_id": run_id,
        "case_ids": case_ids,
        "case_qualified": case_qualified,
        "qualified_cases": qualified_cases,
        "inner_exit": inner_exit,
        "expected_inner_exit": command.get("expected_inner_exit"),
        "recorder_wait_returncode": outer,
        "source": source_pre,
        "source_post": source_post,
        "protected": protected_pre,
        "protected_post": protected_post,
        "capture_digests": digests,
        "sidecar": str(sidecar_path) if sidecar_path else None,
        "sidecar_sha256": sidecar_sha,
        "assertion_reached": assertion_reached,
        "cleanup": {
            "required": bool((expected_failure or {}).get("cleanup_required")),
            "verified": cleanup_verified,
            "source": cleanup_source,
        },
        "resource_status": resource_status,
        "problems": problems,
        "source_drift": drift,
        "case_passed": case_qualified,
        "created_at": now_iso(),
    }
    if qualified_cases:
        credential["case_id"] = qualified_cases[0]
        credential["assertion"] = assertion
        credential["expected_failure_requirement"] = expected_failure
    path = directory / (str(run_id) + ".json")
    atomic_write_bytes(path, _encode_json(payload=credential))
    return path


def _write_receipt(artefact_root, run_id, command_id, capture_basename, event_id, sequence,
                   release_sha, digests, sidecar_path, sidecar_sha, credential_path,
                   credential_sha, inner_exit, outer, resource_status, recorder_epoch):
    """The per run terminal receipt, bound to the committed authority event."""
    directory = Path(artefact_root) / RECEIPTS_DIRNAME
    directory.mkdir(parents=True, exist_ok=True)
    payload = {
        "format": RECEIPT_FORMAT,
        "run_id": run_id,
        "command_id": command_id,
        "capture_basename": capture_basename,
        "event_id": event_id,
        "sequence": sequence,
        "release_sha256": release_sha,
        "capture_digests": digests,
        "sidecar": str(sidecar_path) if sidecar_path else None,
        "sidecar_sha256": sidecar_sha,
        "credential": str(credential_path) if credential_path else None,
        "credential_sha256": credential_sha,
        "inner_exit": inner_exit,
        "recorder_wait_returncode": outer,
        "resource_status": resource_status,
        "recorder_epoch": recorder_epoch,
        "created_at": now_iso(),
    }
    path = directory / (str(run_id) + ".json")
    atomic_write_bytes(path, _encode_json(payload))
    return path


def command_run(args):
    """One admitted command, one recorder, one owner, one real wait."""
    release, release_sha = load_release(args.release, args.expected_release_sha256)
    validate_release(release)
    _require_release_identity(release, args.owner_task)
    project_root = Path(release["project_root"])
    artefact_root = Path(release["state_root"])
    authority = authority_root(project_root)
    command_id = args.command_id
    _require(command_id in release["commands"], "UNKNOWN_COMMAND_ID", {"command_id": command_id})
    command = release["commands"][command_id]
    allowed_phases = command.get("allowed_phases")
    if allowed_phases and release["phase"] not in allowed_phases:
        raise AdmissionError("COMMAND_PHASE_NOT_ALLOWED",
                             {"command_id": command_id, "phase": release["phase"],
                              "allowed_phases": allowed_phases})
    allocation = find_allocation(release, command_id, args.run_id)
    basename = allocation["basename"]
    recorder_dir = recorder_directory_for(release, allocation, project_root)

    # The wrapper epoch must be complete before anything is scheduled.
    wrapper_epoch, wrapper_missing = read_wrapper_epoch()
    if wrapper_missing:
        raise AdmissionError("WRAPPER_EPOCH_INCOMPLETE_NO_SPAWN",
                             {"missing": wrapper_missing})

    # The expensive hashing happens outside the lock; the sequence is checked
    # again inside the authority transaction.
    preflight_sequence = read_state_sequence(authority)
    source_problems = verify_recorded_source(project_root, release)
    scope_problems = verify_source_scope(project_root, release)
    protected_problems = verify_protected(project_root, release)
    recorder_problems = verify_recorder(project_root, release)
    if source_problems or scope_problems or protected_problems or recorder_problems:
        raise AdmissionError("PREFLIGHT_SOURCE_OR_PROTECTED_FAILURE", {
            "source": source_problems,
            "scope": scope_problems,
            "protected": protected_problems,
            "recorder": recorder_problems,
        })

    argv = list(command["argv"])
    cwd = command["cwd"]
    if not os.path.isabs(cwd):
        raise AdmissionError("COMMAND_CWD_NOT_ABSOLUTE", {"cwd": cwd})
    if Path(cwd).resolve() != project_root.resolve():
        raise AdmissionError("COMMAND_CWD_NOT_PROJECT_ROOT",
                             {"cwd": cwd, "project_root": str(project_root)})
    recorder_abs = (project_root / release["recorder"]["path"]).resolve()
    recorder_argv = [OUTER_INTERPRETER, "-I", "-S", "-B", str(recorder_abs), basename] + argv
    run_id = allocation["run_id"]

    # The final validation and the unique STARTING reservation happen together
    # in the one authority transaction.
    with AuthorityLock(authority):
        state = read_authority_state(authority)
        if state is None:
            state = initial_state()
        require_binding(state, release, release_sha, allow_initial=True)
        if state.get("pending_audit"):
            raise AdmissionError("PENDING_AUDIT_NOT_CLEARED",
                                 {"event_id": state.get("event_id")})
        if state.get("admission") == "BLOCKED":
            raise AdmissionError("ADMISSION_BLOCKED", {"reason": state.get("blocked_reason")})
        if slot_is_unknown(state):
            raise AdmissionError("UNKNOWN_RESOURCE_HOLDS_RESPONSIBILITY", {"slot": state.get("slot")})
        if slot_is_active(state):
            raise AdmissionError("RUN_SLOT_BUSY",
                                 {"slot_phase": state["slot"].get("phase"),
                                  "run_id": state["slot"].get("run_id")})
        if state.get("write_lease"):
            raise AdmissionError("WRITE_LEASE_HOLDS_NO_RUN", {"lease": state["write_lease"]})
        current_sequence = state.get("sequence")
        if preflight_sequence is not None and current_sequence != preflight_sequence:
            raise AdmissionError("STATE_CHANGED_DURING_PREFLIGHT",
                                 {"preflight_sequence": preflight_sequence,
                                  "current_sequence": current_sequence})
        if state.get("generation") != release["generation"]:
            raise AdmissionError("GENERATION_MISMATCH",
                                 {"bound": state.get("generation"),
                                  "given": release["generation"]})
        # The capture occupancy is checked again inside the transaction.
        assert_capture_absent(recorder_dir, basename)
        slot = {
            "run_id": run_id,
            "command_id": command_id,
            "capture_basename": basename,
            "capture_directory": str(recorder_dir),
            "recorder_argv": recorder_argv,
            "inner_argv": argv,
            "cwd": cwd,
            "owner_task": args.owner_task,
            "generation": release["generation"],
            "release_sha256": release_sha,
            "expected_inner_exit": command["expected_inner_exit"],
            "phase": "STARTING",
            "started_at": now_iso(),
            "cancel_requested": False,
            "wrapper_epoch": wrapper_epoch,
            "recorder_pid": None,
            "recorder_start_ticks": None,
            "recorder_ppid": None,
            "recorder_pgid": None,
            "recorder_sid": None,
            "recorder_epoch_verified": False,
            "boot_id": wrapper_epoch.get("boot_id"),
            "identity_error": None,
            "recorder_wait_returncode": None,
            "inner_exit": None,
            "resource_status": "UNKNOWN",
            "metadata_ok": None,
            "terminal_at": None,
        }
        state = dict(state)
        state["bound_release_sha256"] = release_sha
        state["bound_owner_task"] = release["owner_task"]
        state["generation"] = release["generation"]
        state["slot"] = slot
        state["phase"] = "STARTING"
        state["admission"] = "BLOCKED"
        state["blocked_reason"] = "RUN_IN_FLIGHT"
        state["cancel_requested"] = False
        state, _event_id, _sequence = commit_event(
            authority, state, "run-starting",
            {"run_id": run_id, "command_id": command_id, "basename": basename})

    # The lock is released here: the wait below never holds it.
    source_pre = [dict(row) for row in release["recorded_source"]]
    protected_pre = [dict(row) for row in release.get("protected_inputs", [])]
    owned = None
    outer = None
    startup_error = None
    log_path = Path(artefact_root) / LOGS_DIRNAME / (run_id + ".recorder.log")
    try:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_handle = open(log_path, "wb")
        try:
            try:
                child = subprocess.Popen(
                    recorder_argv,
                    cwd=cwd,
                    stdout=log_handle,
                    stderr=subprocess.STDOUT,
                    stdin=subprocess.DEVNULL,
                    start_new_session=True,
                )
            except OSError as error:
                # The child was never created: this is the only NO CHILD case.
                startup_error = AdmissionError("POPEN_FAILED_NO_CHILD", {"errno": error.errno})
                child = None
            if child is not None:
                owned = OwnedChild(child)
        finally:
            try:
                log_handle.close()
            except OSError as error:
                if owned is None:
                    startup_error = AdmissionError("LOG_CLOSE_FAILED_NO_CHILD", {"errno": error.errno})
                # A close failure after the child exists must never skip the wait.
    except OSError as error:
        startup_error = AdmissionError("LOG_OPEN_FAILED_NO_CHILD", {"errno": error.errno})

    if owned is None:
        with AuthorityLock(authority):
            state = read_authority_state(authority) or initial_state()
            slot = dict(state.get("slot") or {})
            slot["phase"] = "TERMINAL"
            slot["terminal_at"] = now_iso()
            slot["resource_status"] = "NO_CHILD"
            slot["metadata_ok"] = False
            slot["startup_error"] = startup_error.reason if startup_error else "UNKNOWN"
            state["slot"] = slot
            state["phase"] = "TERMINAL"
            state["admission"] = "BLOCKED"
            state["blocked_reason"] = "POPEN_FAILED_NO_CHILD"
            try:
                commit_event(authority, state, "run-no-child", {"run_id": run_id})
            except AdmissionError:
                pass
        raise startup_error or AdmissionError("POPEN_FAILED_NO_CHILD", {})

    # From here on the returned child belongs to this owner, forever.
    recorder_epoch = {"pid": owned.child.pid, "identity_verified": False, "missing": []}
    identity_error = None
    persist_error = None
    outer = None
    try:
        try:
            recorder_epoch, verified, identity_problems = read_recorder_epoch(
                owned.child.pid, wrapper_epoch)
        except OSError as error:
            verified = False
            identity_problems = [{"problem": "identity_read_failed",
                                  "detail": type(error).__name__}]
            recorder_epoch = {"pid": owned.child.pid, "identity_verified": False,
                              "missing": ["identity"],
                              "identity_error": {"detail": type(error).__name__}}
        try:
            with AuthorityLock(authority):
                state = read_authority_state(authority) or initial_state()
                slot = dict(state.get("slot") or {})
                slot["phase"] = "RUNNING"
                slot["recorder_pid"] = owned.child.pid
                slot["recorder_epoch_verified"] = bool(verified)
                slot["recorder_epoch"] = recorder_epoch
                slot["identity_error"] = identity_error
                if recorder_epoch.get("start_ticks") is not None:
                    slot["recorder_start_ticks"] = recorder_epoch.get("start_ticks")
                    slot["recorder_ppid"] = recorder_epoch.get("ppid")
                    slot["recorder_pgid"] = recorder_epoch.get("group")
                    slot["recorder_sid"] = recorder_epoch.get("session")
                slot["boot_id"] = recorder_epoch.get("boot_id") or wrapper_epoch.get("boot_id")
                state["slot"] = slot
                state["phase"] = "RUNNING"
                state["admission"] = "BLOCKED"
                state["blocked_reason"] = "RUN_IN_FLIGHT"
                commit_event(authority, state, "run-running",
                             {"run_id": run_id, "recorder_pid": owned.child.pid,
                              "identity_verified": bool(verified)})
        except AdmissionError as error:
            persist_error = {"reason": error.reason, "detail": error.detail}
    finally:
        # The same owner waits for this child exactly once, whatever happened.
        outer = owned.wait()

    metadata_ok, metadata_problems, metadata_details = evaluate_capture(
        recorder_dir, basename, release, command, command["expected_inner_exit"])
    if outer is None or outer < 0:
        metadata_ok = False
        metadata_problems = metadata_problems + [{"problem": "recorder_terminated_by_signal",
                                                  "outer": outer}]
    else:
        inner = metadata_details.get("inner_exit")
        if inner is not None and outer != expected_outer_for_inner(inner):
            metadata_ok = False
            metadata_problems = metadata_problems + [{
                "problem": "recorder_outer_encoding_mismatch",
                "outer": outer,
                "inner": inner,
                "expected_outer": expected_outer_for_inner(inner),
            }]

    post_source = verify_recorded_source(project_root, release)
    post_scope = verify_source_scope(project_root, release)
    post_protected = verify_protected(project_root, release)
    drift = []
    for problem in post_source:
        drift.append({"kind": "recorded_source", "detail": problem})
    for problem in post_scope:
        drift.append({"kind": "source_scope", "detail": problem})
    for problem in post_protected:
        drift.append({"kind": "protected", "detail": problem})
    if drift:
        metadata_ok = False
        metadata_problems = metadata_problems + [{"problem": "source_drift_during_run",
                                                  "drift": drift}]

    resource_status = "UNKNOWN"
    live_members = []
    vanished_entries = 0
    undeterminable_entries = 0
    observed_pgid = recorder_epoch.get("group") or owned.child.pid
    if not recorder_epoch.get("identity_verified"):
        # An unverified epoch never yields a clean resource state.
        resource_status = "UNKNOWN"
        metadata_problems = metadata_problems + [{
            "problem": "recorder_epoch_not_verified",
            "detail": recorder_epoch.get("missing") or recorder_epoch.get("identity_error"),
        }]
    else:
        try:
            live_members, vanished_entries, undeterminable_entries = scan_group_members(
                observed_pgid, exclude_pids=(os.getpid(),))
            if live_members:
                resource_status = "DIRTY"
            elif undeterminable_entries:
                resource_status = "UNKNOWN"
            else:
                resource_status = "CLEAN"
        except OSError:
            resource_status = "UNKNOWN"
    if resource_status != "CLEAN":
        metadata_ok = False
        metadata_problems = metadata_problems + [{"problem": "resource_group_not_clean",
                                                  "resource_status": resource_status,
                                                  "live_group_members": live_members}]

    source_post = digest_rows(project_root, release, "recorded_source")
    protected_post = digest_rows(project_root, release, "protected_inputs")
    digests = capture_digests(recorder_dir, basename)
    cleanup_source = {
        "kind": "owned_group_scan",
        "pgid": observed_pgid,
        "boot_id": wrapper_epoch.get("boot_id"),
        "observed_members": live_members,
        "vanished_entries": vanished_entries,
        "undeterminable_entries": undeterminable_entries,
        "resource_status": resource_status,
        "waited_returncode": outer,
        "identity_verified": bool(recorder_epoch.get("identity_verified")),
        "scanned_at": now_iso(),
    }

    sidecar_path = None
    sidecar_error = None
    try:
        sidecar_path = _write_sidecar(
            artefact_root, release, release_sha, command_id, slot, allocation,
            metadata_details.get("inner_exit"), outer, digests, source_pre, source_post,
            protected_pre, protected_post, resource_status, cleanup_source,
            metadata_ok, metadata_problems, wrapper_epoch, recorder_epoch)
    except (AdmissionError, OSError) as error:
        sidecar_error = {"reason": getattr(error, "reason", type(error).__name__),
                         "detail": getattr(error, "detail", str(error))}

    credential_path = None
    credential_error = None
    try:
        credential_path = _write_credential(
            artefact_root, release, release_sha, command_id, slot, command, allocation,
            metadata_details.get("inner_exit"), outer, metadata_problems, drift, live_members,
            resource_status, cleanup_source, sidecar_path, source_pre, source_post,
            protected_pre, protected_post, digests, metadata_details.get("log_text", ""))
    except (AdmissionError, OSError) as error:
        credential_error = {"reason": getattr(error, "reason", type(error).__name__),
                             "detail": getattr(error, "detail", str(error))}

    terminal_error = None
    event_id = None
    sequence = None
    try:
        with AuthorityLock(authority):
            state = read_authority_state(authority) or initial_state()
            slot = dict(state.get("slot") or {})
            slot["phase"] = "TERMINAL" if resource_status == "CLEAN" else "UNKNOWN"
            slot["terminal_at"] = now_iso()
            slot["recorder_wait_returncode"] = outer
            slot["inner_exit"] = metadata_details.get("inner_exit")
            slot["resource_status"] = resource_status
            slot["live_group_members"] = live_members
            slot["vanished_proc_entries"] = vanished_entries
            slot["undeterminable_proc_entries"] = undeterminable_entries
            slot["metadata_ok"] = bool(metadata_ok)
            slot["metadata_problems"] = metadata_problems
            slot["source_drift"] = drift
            slot["capture_digests"] = digests
            slot["source_post"] = source_post
            slot["protected_post"] = protected_post
            slot["sidecar_path"] = str(sidecar_path) if sidecar_path else None
            slot["credential_path"] = str(credential_path) if credential_path else None
            slot["cancel_requested"] = bool(state.get("cancel_requested"))
            slot["case_ids"] = allocation.get("case_ids", [])
            slot["identity_persist"] = persist_error
            state["slot"] = slot
            history = list(state.get("history") or [])
            history.append({
                "run_id": slot.get("run_id"),
                "command_id": slot.get("command_id"),
                "capture_basename": slot.get("capture_basename"),
                "inner_exit": slot.get("inner_exit"),
                "recorder_wait_returncode": outer,
                "resource_status": resource_status,
                "metadata_ok": bool(metadata_ok),
                "cancel_requested": slot.get("cancel_requested"),
                "terminal_at": slot.get("terminal_at"),
            })
            state["history"] = history[-HISTORY_LIMIT:]
            state["phase"] = slot["phase"]
            if resource_status != "CLEAN":
                state["admission"] = "BLOCKED"
                state["blocked_reason"] = "UNKNOWN_RESOURCE_HOLDS_RESPONSIBILITY"
            elif not metadata_ok:
                state["admission"] = "BLOCKED"
                state["blocked_reason"] = "TERMINAL_WITH_INVALID_METADATA"
            elif sidecar_path is None or credential_error is not None:
                state["admission"] = "BLOCKED"
                state["blocked_reason"] = "EVIDENCE_ARTEFACT_NOT_PERSISTED"
            else:
                state["admission"] = "READY"
                state["blocked_reason"] = None
            state, event_id, sequence = commit_event(
                authority, state, "run-terminal",
                {"run_id": slot.get("run_id"), "inner_exit": slot.get("inner_exit"),
                 "outer": outer, "metadata_ok": bool(metadata_ok),
                 "resource_status": resource_status,
                 "capture_digests": digests,
                 "sidecar": str(sidecar_path) if sidecar_path else None,
                 "sidecar_sha256": sha256_file(sidecar_path) if sidecar_path else None,
                 "credential": str(credential_path) if credential_path else None,
                 "credential_sha256": sha256_file(credential_path) if credential_path else None})
    except AdmissionError as error:
        terminal_error = {"reason": error.reason, "detail": error.detail}

    receipt_path = None
    receipt_error = None
    if event_id is not None:
        try:
            receipt_path = _write_receipt(
                artefact_root, run_id, command_id, basename, event_id, sequence, release_sha,
                digests, sidecar_path,
                sha256_file(sidecar_path) if sidecar_path else None,
                credential_path,
                sha256_file(credential_path) if credential_path else None,
                metadata_details.get("inner_exit"), outer, resource_status, recorder_epoch)
        except (AdmissionError, OSError) as error:
            receipt_error = {"reason": getattr(error, "reason", type(error).__name__),
                             "detail": getattr(error, "detail", str(error))}

    admitted = bool(
        state.get("admission") == "READY"
        and event_id is not None
        and receipt_path is not None
        and sidecar_path is not None
        and terminal_error is None
    )
    return {
        "command": "run",
        "run_id": run_id,
        "command_id": command_id,
        "capture_basename": basename,
        "capture_directory": str(recorder_dir),
        "inner_exit": metadata_details.get("inner_exit"),
        "recorder_wait_returncode": outer,
        "metadata_ok": bool(metadata_ok),
        "metadata_problems": metadata_problems,
        "resource_status": resource_status,
        "recorder_epoch_verified": bool(recorder_epoch.get("identity_verified")),
        "live_group_members": live_members,
        "vanished_proc_entries": vanished_entries,
        "undeterminable_proc_entries": undeterminable_entries,
        "source_drift": drift,
        "capture_digests": digests,
        "sidecar_path": str(sidecar_path) if sidecar_path else None,
        "sidecar_error": sidecar_error,
        "credential_path": str(credential_path) if credential_path else None,
        "credential_error": credential_error,
        "terminal_event_id": event_id,
        "terminal_sequence": sequence,
        "terminal_persist_error": terminal_error,
        "receipt_path": str(receipt_path) if receipt_path else None,
        "receipt_error": receipt_error,
        "identity_persist_error": persist_error,
        "cancel_requested": bool((state.get("slot") or {}).get("cancel_requested")),
        "admission": state.get("admission"),
        "blocked_reason": state.get("blocked_reason"),
        "admitted": admitted,
        "authority": str(authority),
        "artefact_root": str(artefact_root),
        "business_acceptance": False,
        "note": "a recorded exit code is a result, not a proof that the resources are settled",
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_parser():
    parser = argparse.ArgumentParser(
        prog="run-delivery.py",
        description="PROC-0 cooperative delivery admission runner (not an OS isolation boundary)",
    )
    sub = parser.add_subparsers(dest="command")

    def common(target):
        target.add_argument("--release", required=True, help="path of the MAIN release file")
        target.add_argument("--expected-release-sha256", required=True,
                            help="SHA-256 MAIN expects for the release file")
        target.add_argument("--owner-task", required=True, help="owner task id of the calling lane")

    status = sub.add_parser("status", help="read-only status of the saved epoch")
    common(status)

    begin = sub.add_parser("begin-write", help="take the logical write lease")
    common(begin)

    end = sub.add_parser("end-write", help="close the logical write lease of the same owner")
    common(end)
    end.add_argument("--nonce", required=True)
    end.add_argument("--generation", required=True, type=int)

    run = sub.add_parser("run", help="run exactly one admitted command through the original recorder")
    common(run)
    run.add_argument("--command-id", required=True)
    run.add_argument("--run-id", required=True)

    cancel = sub.add_parser("request-cancel", help="record a cancellation request (no signal is sent)")
    common(cancel)
    cancel.add_argument("--run-id", required=True)

    rebind = sub.add_parser("rebind", help="bind a new MAIN release")
    common(rebind)
    return parser


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(list(sys.argv[1:] if argv is None else argv))
    if not args.command:
        parser.error("a subcommand is required")
    handlers = {
        "status": command_status,
        "begin-write": command_begin_write,
        "end-write": command_end_write,
        "run": command_run,
        "request-cancel": command_request_cancel,
        "rebind": command_rebind,
    }
    try:
        payload = handlers[args.command](args)
    except AdmissionError as error:
        payload = {
            "command": args.command,
            "status": "REJECTED",
            "reason": error.reason,
            "detail": error.detail,
            "business_acceptance": False,
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))
        return EXIT_REJECTED
    except (OSError, ValueError, KeyError, TypeError) as error:
        payload = {
            "command": args.command,
            "status": "ERROR",
            "reason": "UNEXPECTED_" + type(error).__name__,
            "detail": {"message": str(error)},
            "business_acceptance": False,
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))
        return EXIT_INTERNAL
    payload.setdefault("status", "OK")
    if args.command == "run" and not payload.get("admitted", True):
        payload["status"] = "NOT_ADMITTED"
    print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))
    if args.command == "run" and not payload.get("admitted", True):
        return EXIT_REJECTED
    return EXIT_OK


if __name__ == "__main__":
    raise SystemExit(main())
