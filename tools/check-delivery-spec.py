#!/usr/bin/env python3
"""Metadata admission only. Never certifies business/runtime/review acceptance."""
import argparse
import hashlib
import json
from pathlib import Path
import tempfile


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def local(root, name):
    if not isinstance(name, str) or Path(name).is_absolute():
        raise ValueError("requires repository-relative path")
    p = (root / name).resolve()
    p.relative_to(root.resolve())
    return p


def check(root, packet):
    problems = []
    try:
        if packet.get("format") != "narralens.delivery-packet@1":
            problems.append("wrong format")
        if packet.get("status") != "READY_FOR_REVIEW":
            problems.append("packet is not READY_FOR_REVIEW")
        contract = packet["contract"]
        if digest(local(root, contract["path"])) != contract["sha256"]:
            problems.append("contract digest mismatch")
        sources = packet["source"]
        if not sources or len({x["path"] for x in sources}) != len(sources):
            problems.append("source inventory empty or duplicate")
        for row in sources:
            if digest(local(root, row["path"])) != row["sha256"]:
                problems.append("source digest mismatch: " + row["path"])
        required = packet["required_cases"]
        release_ref = packet["release"]
        release_path = local(root, release_ref["path"])
        if digest(release_path) != release_ref["sha256"]:
            problems.append("release digest mismatch")
        release = json.loads(release_path.read_text())
        if required != release.get("required_cases"):
            problems.append("required case inventory differs from authoritative release")
        if sources != release.get("source") or contract != release.get("contract"):
            problems.append("packet bindings differ from authoritative release")
        cases = packet["cases"]
        if not required or len(set(required)) != len(required):
            problems.append("required cases empty or duplicate")
        if len({x["id"] for x in cases}) != len(cases):
            problems.append("duplicate case")
        actual = {x["id"]: x for x in cases}
        if set(actual) != set(required):
            problems.append("case inventory does not equal required cases")
        for key in required:
            row = actual.get(key)
            if not row:
                continue
            if row.get("implementation") != "COMPLETE":
                problems.append(key + ": incomplete implementation")
            if not row.get("production_entry") or not row.get("test_name"):
                problems.append(key + ": missing production entry or test")
            if row.get("level") not in ("D0", "D1", "D2", "D3", "D4"):
                problems.append(key + ": unknown evidence level")
            capture = row.get("command_capture")
            if not capture:
                problems.append(key + ": no actual capture")
                continue
            base = local(root, capture)
            def read(suffix):
                return json.loads(Path(str(base) + suffix).read_text())
            result = read(".result.json")
            command = read(".cmd.json")
            inputs = read(".inputs.json")
            read(".claim.json")
            exit_code = int(Path(str(base) + ".exit").read_text())
            expected = row.get("expected_exit", 0)
            if type(expected) is not int or result["exit"] != exit_code or exit_code != expected:
                problems.append(key + ": exit mismatch")
            if result.get("source_changed") != [] or result.get("source_added") != []:
                problems.append(key + ": inputs changed while running")
            if digest(Path(str(base) + ".txt")) != result["log_sha256"]:
                problems.append(key + ": log digest mismatch")
            if not command.get("argv") or not command.get("cwd"):
                problems.append(key + ": missing actual command")
            for source in sources:
                if inputs.get(source["path"]) != source["sha256"]:
                    problems.append(key + ": capture uses stale source: " + source["path"])
            if expected != 0:
                artifact = row.get("expected_failure_artifact")
                if not artifact:
                    problems.append(key + ": nonzero exit alone is not expected-failure evidence")
                else:
                    proof = json.loads(local(root, artifact).read_text())
                    if proof.get("case_id") != key or proof.get("case_passed") is not True:
                        problems.append(key + ": expected-failure artifact does not match")
                    if proof.get("source") != sources:
                        problems.append(key + ": expected-failure source binding mismatch")
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
        problems.append("unreadable/incomplete metadata: " + type(error).__name__)
    return problems


def self_test():
    # Synthetic metadata only: positive and tamper cases exercise this exact checker.
    import copy
    with tempfile.TemporaryDirectory(prefix="narralens-process-") as tmp:
        root = Path(tmp)
        (root / "contract").write_text("contract")
        (root / "source").write_text("source")
        (root / "capture.txt").write_text("log")
        sources = [{"path": "source", "sha256": digest(root / "source")}]
        def write(name, data):
            (root / name).write_text(json.dumps(data))
        write("capture.claim.json", {})
        write("capture.cmd.json", {"argv": ["synthetic"], "cwd": str(root)})
        write("capture.inputs.json", {"source": sources[0]["sha256"]})
        result = {"exit": 0, "source_changed": [], "source_added": [], "log_sha256": digest(root / "capture.txt")}
        write("capture.result.json", result)
        (root / "capture.exit").write_text("0")
        packet = {"format": "narralens.delivery-packet@1", "status": "READY_FOR_REVIEW", "contract": {"path": "contract", "sha256": digest(root / "contract")}, "source": sources, "required_cases": ["case"], "cases": [{"id": "case", "implementation": "COMPLETE", "production_entry": "synthetic", "test_name": "synthetic", "level": "D0", "command_capture": "capture"}]}
        release = {"required_cases": packet["required_cases"], "source": sources, "contract": packet["contract"]}
        write("release.json", release)
        packet["release"] = {"path": "release.json", "sha256": digest(root / "release.json")}
        assert not check(root, packet)
        for field, value in [("implementation", "PARTIAL"), ("production_entry", ""), ("command_capture", "../escape"), ("expected_exit", 1)]:
            bad = copy.deepcopy(packet); bad["cases"][0][field] = value
            assert check(root, bad), field
        bad = copy.deepcopy(packet); bad["required_cases"].append("omitted")
        assert check(root, bad)
        bad = copy.deepcopy(packet); bad["required_cases"] = []; bad["cases"] = []
        assert check(root, bad), "cannot trim the release case inventory"
        bad = copy.deepcopy(packet); bad["required_cases"] = ["replacement"]; bad["cases"][0]["id"] = "replacement"
        assert check(root, bad), "cannot replace the authoritative case set"
        result["source_changed"] = ["source"]; write("capture.result.json", result)
        assert check(root, packet)
        result["source_changed"] = []; write("capture.result.json", result)
        (root / "capture.txt").write_text("tampered")
        assert check(root, packet)
    return {"scope": "SYNTHETIC_METADATA_ONLY", "positive_and_negative_checks": "passed", "business_acceptance": False}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--packet", type=Path)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        print(json.dumps(self_test()))
    elif args.packet:
        root = Path(__file__).resolve().parents[1]
        try:
            problems = check(root, json.loads(args.packet.read_text()))
        except (OSError, ValueError) as error:
            problems = ["packet unreadable: " + type(error).__name__]
        print(json.dumps({"status": "REJECTED" if problems else "METADATA_READY_FOR_REVIEW", "problems": problems, "business_acceptance": False}, ensure_ascii=False, indent=2))
        raise SystemExit(2 if problems else 0)
    else:
        parser.error("--packet or --self-test required")
