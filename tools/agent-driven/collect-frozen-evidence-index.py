"""Hash immutable ticket evidence; never infer execution or PID history from prose.

Uses git objects only. Does not read CLI config, environment, media or working files.
The output proves bytes at the named commit, not the truth of the file's narrative.
"""
import argparse
import datetime
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess


def collect(repo, commit, prefix):
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("a complete lowercase Git commit is required")
    path = PurePosixPath(prefix)
    if path.is_absolute() or ".." in path.parts or not prefix.startswith("docs/parallel/lane-"):
        raise ValueError("only a relative lane evidence prefix is allowed")
    git = ["git", "-C", str(repo)]
    kind = subprocess.check_output(git + ["cat-file", "-t", commit], text=True).strip()
    if kind != "commit":
        raise ValueError("the frozen object must be a commit")
    raw = subprocess.check_output(git + ["ls-tree", "-r", "-z", commit, "--", prefix])
    rows = []
    for entry in raw.split(b"\0"):
        if not entry:
            continue
        header, name = entry.split(b"\t", 1)
        mode, object_kind, oid = header.decode("ascii").split()
        if object_kind != "blob" or mode not in ("100644", "100755"):
            raise ValueError("evidence must contain regular tracked files only")
        data = subprocess.check_output(git + ["cat-file", "blob", oid])
        rows.append({"path": name.decode("utf-8"), "git_blob": oid,
                     "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
    if not rows:
        raise ValueError("the frozen evidence prefix contains no files")
    return {"format": "narralens.frozen-evidence-index@1", "commit": commit,
            "prefix": prefix, "computed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "files": sorted(rows, key=lambda row: row["path"]),
            "claim_limit": "Immutable byte identity only; no execution, PID ownership, isolation, gate, review or human acceptance is inferred."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--prefix", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = collect(args.repo, args.commit, args.prefix)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), "commit": args.commit, "files": len(result["files"])}))
