"""MAIN's one-ticket L1 observer; calls the unchanged recorder, not the new runner.

No product imports, signal, timeout, retries or descendant reaper. Only the three
commands in the separately pinned bootstrap release can be observed. This file
is validation instrumentation, not the PROC-0 implementation or a runtime grant.
"""
import datetime
import errno
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def rows(root, declared):
    result = []
    for item in declared:
        path = Path(item["path"])
        path = path if path.is_absolute() else root / path
        result.append({"path": item["path"], "sha256": sha(path) if path.is_file() else None})
    return result


def identity(pid):
    text = (Path("/proc") / str(pid) / "stat").read_text()
    fields = text[text.rfind(")") + 2:].split()
    return {"pid": pid, "state": fields[0], "ppid": int(fields[1]),
            "pgid": int(fields[2]), "sid": int(fields[3]), "start_ticks": int(fields[19])}


def main():
    release_path, expected_sha, command_id = sys.argv[1:]
    assert sha(release_path) == expected_sha, "RELEASE_DIGEST_MISMATCH"
    release = json.loads(Path(release_path).read_text())
    assert release["phase"] == "BOOTSTRAP_CODE" and release["product_runtime_release"] is False
    assert command_id in ("B1", "B2", "B3")
    root = Path(release["project_root"])
    assert Path.cwd().resolve() == root.resolve(), "WRONG_CWD"
    allocation = next(x for x in release["capture_allocations"] if x["command_id"] == command_id)
    command = release["commands"][command_id]
    basename = allocation["basename"]
    assert basename and all(c in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_" for c in basename)
    recorder = root / release["recorder"]["path"]
    assert sha(recorder) == release["recorder"]["sha256"]
    suffixes = (".claim.json", ".inputs.json", ".cmd.json", ".txt", ".exit", ".result.json")
    base = recorder.parent / basename
    assert not any(Path(str(base) + s).exists() for s in suffixes), "CAPTURE_ALREADY_EXISTS"
    source_pre = rows(root, release["recorded_source"])
    protected_pre = rows(root, release["protected_inputs"])
    assert source_pre == release["recorded_source"] and protected_pre == release["protected_inputs"], "STALE_PIN"
    state_root = Path(release["state_root"]) / "bootstrap"
    state_root.mkdir(parents=True, exist_ok=True)
    sidecar_path = state_root / (allocation["run_id"] + ".json")
    assert not sidecar_path.exists(), "SIDECAR_ALREADY_EXISTS"
    boot_id = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
    with (state_root / (allocation["run_id"] + ".owner-claim.json")).open("x") as f:
        json.dump({"release_sha256": expected_sha, "command_id": command_id,
                   "run_id": allocation["run_id"], "observer_pid": os.getpid(),
                   "created_at": now()}, f)
    child = subprocess.Popen(["/usr/bin/python3.12", "-I", "-S", "-B", str(recorder), basename,
                              *command["argv"]], cwd=root, start_new_session=True)
    # Do not perform fallible persistence before keeping the same child's wait.
    epoch, identity_error = None, None
    try:
        epoch = identity(child.pid)
    except Exception as error:
        identity_error = type(error).__name__
    outer = child.wait()
    observed, vanished, unknown = [], 0, 0
    for entry in Path("/proc").iterdir():
        if not entry.name.isdecimal():
            continue
        try:
            info = identity(int(entry.name))
        except OSError as error:
            if error.errno in (errno.ENOENT, errno.ESRCH):
                vanished += 1
            else:
                unknown += 1
            continue
        except (ValueError, IndexError):
            unknown += 1
            continue
        if info["pgid"] == child.pid:
            observed.append(info)
    resource_status = "UNKNOWN" if unknown or epoch is None else "DIRTY" if observed else "CLEAN"
    capture_digests = {s: sha(Path(str(base) + s)) for s in suffixes if Path(str(base) + s).is_file()}
    result_path = Path(str(base) + ".result.json")
    result = json.loads(result_path.read_text()) if result_path.is_file() else {}
    inner = result.get("exit")
    originals_agree = False
    if len(capture_digests) == 6:
        cmd = json.loads(Path(str(base) + ".cmd.json").read_text())
        claim = json.loads(Path(str(base) + ".claim.json").read_text())
        inputs = json.loads(Path(str(base) + ".inputs.json").read_text())
        originals_agree = (int(Path(str(base) + ".exit").read_text()) == inner
                           and cmd.get("argv") == command["argv"] and cmd.get("runner_version") == 3
                           and Path(cmd["cwd"]).resolve() == root.resolve()
                           and claim.get("name") == basename and claim.get("argv") == command["argv"]
                           and claim.get("runner_version") == 3
                           and inputs == {r["path"]: r["sha256"] for r in source_pre}
                           and result.get("log_sha256") == capture_digests[".txt"])
    source_post, protected_post = rows(root, release["recorded_source"]), rows(root, release["protected_inputs"])
    metadata_ok = (type(inner) is int and inner == command["expected_inner_exit"] and outer >= 0
                   and outer == (inner & 255) and originals_agree
                   and epoch is not None and epoch["pgid"] == child.pid and epoch["sid"] == child.pid
                   and result.get("source_changed") == [] and result.get("source_added") == []
                   and source_pre == source_post and protected_pre == protected_post
                   and resource_status == "CLEAN")
    output = {"format": "narralens.proc0-bootstrap-observation@1", "evidence_layer": "BOOTSTRAP",
              "release_sha256": expected_sha, "run_id": allocation["run_id"], "command_id": command_id,
              "capture_basename": basename, "source": source_pre, "protected": protected_pre,
              "source_pre": source_pre, "source_post": source_post, "protected_pre": protected_pre,
              "protected_post": protected_post, "capture_digests": capture_digests,
              "inner_exit": inner, "recorder_wait_returncode": outer, "epoch": epoch,
              "boot_id": boot_id, "identity_error": identity_error, "resource_status": resource_status, "metadata_ok": metadata_ok,
              "cleanup_source": {"kind": "MAIN_bootstrap_wait_and_owned_group_observation", "pgid": child.pid,
                                 "observed_members": observed, "vanished_entries": vanished,
                                 "undeterminable_entries": unknown, "waited_returncode": outer,
                                 "scanned_at": now()},
              "scope_limit": "L1 pure test recorder only; not a full fork transcript or product acceptance"}
    with sidecar_path.open("x") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(json.dumps({"command_id": command_id, "sidecar": str(sidecar_path), "inner_exit": inner,
                      "recorder_wait_returncode": outer, "resource_status": resource_status,
                      "metadata_ok": metadata_ok}))
    return 0 if metadata_ok else 2


if __name__ == "__main__":
    raise SystemExit(main())
