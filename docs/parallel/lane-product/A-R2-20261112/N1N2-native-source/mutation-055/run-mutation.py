#!/usr/bin/env python3
"""055 mutation control: back up, inject ONE precise mutation, run the recorder, restore byte for byte.

This script NEVER changes anything permanently. It:

  1. takes the full original bytes of the ONE target file and keeps them as a backup;
  2. checks that the mutation anchor matches EXACTLY ONCE - if it does not, it stops
     without touching the file, because a guess is not a mutation;
  3. writes the mutant file, and keeps the exact patch and both digests;
  4. runs the ORIGINAL run-recorded.py with the capture name it is given, so the mutant
     run is recorded like any other run (real argv, real exit, real raw log);
  5. in a `finally`, restores the file BYTE FOR BYTE from the backup - never with git
     checkout/reset/restore - and proves the restored bytes are the original bytes;
  6. writes a receipt with every one of those facts.

Usage: run-mutation.py <lf03|pf03> <capture-name> <argv...>
"""

import datetime
import difflib
import hashlib
import json
import os
import shutil
import subprocess
import sys

ROOT = "/mnt/c/workspace/videoworkline/Narralens-agents/main-integration"
CONTROL = os.path.join(ROOT, "docs/parallel/lane-product/A-R2-20261112/N1N2-native-source/mutation-055")
RECORDER = os.path.join(ROOT, "docs/execution/A/implementation-20261111/integration/e1-main-takeover/run-recorded.py")

MUTATIONS = {
    # LF03: the old strict identity refusal. A published blob whose change time moved
    # is legitimately proved again from the same descriptor, so refusing it because the
    # whole fingerprint differs is exactly the regression this gate must detect.
    "lf03": {
        "target": "src/host/agent-driven/local-asset-registry.ts",
        "anchor": "            const after = await handle.stat({ bigint: true });\n",
        "mutate": "insert",
        "text": "            // MUTATION-055-LF03 (temporary): the OLD strict identity refusal.\n"
                "            if (published && fingerprint(before) !== fingerprint(after))\n"
                "                throw conflict();\n",
        "expectation": "the legitimate published blob (same content, only the change time of its inode moved) is refused",
    },
    # PF03: the genuine release failure of the AFTER (POST) tree is dropped from the
    # cleanup ledger, while the release itself still happens.
    "pf03": {
        "target": "src/host/agent-driven/created-native-workspace.ts",
        "anchor": "  if(after)try{await after.release();}catch(error){cleanupFailures.push(error);}\n",
        "mutate": "replace",
        "text": "  if(after)try{await after.release();}catch(error){/* MUTATION-055-PF03: the genuine cause of the after tree is dropped */}\n",
        "expectation": "the genuine release failure of the after (POST) tree is missing from the cleanup causes",
    },
}


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main() -> int:
    if len(sys.argv) < 4:
        print("USAGE: run-mutation.py <lf03|pf03> <capture> <argv...>", file=sys.stderr)
        return 2
    mutation_id, capture = sys.argv[1], sys.argv[2]
    argv = sys.argv[3:]
    spec = MUTATIONS.get(mutation_id)
    if spec is None:
        print("UNKNOWN_MUTATION:" + mutation_id, file=sys.stderr)
        return 2
    target = os.path.join(ROOT, spec["target"])
    original = open(target, "rb").read()
    original_sha = digest(original)
    os.makedirs(CONTROL, exist_ok=True)
    backup = os.path.join(CONTROL, f"backup-{mutation_id}-{original_sha}.txt")
    if not os.path.exists(backup):
        shutil.copyfile(target, backup)
    receipt = {
        "format": "narralens.mutation-055-receipt@1",
        "mutation": mutation_id,
        "capture": capture,
        "target": spec["target"],
        "expectation": spec["expectation"],
        "original_sha256": original_sha,
        "original_bytes": len(original),
        "backup": backup,
        "backup_sha256": digest(open(backup, "rb").read()),
        "argv": argv,
        "started_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "restore": {},
        "recorder_exit": None,
        "status": "started",
    }
    exit_code = 9
    try:
        text = original.decode("utf-8")
        anchor = spec["anchor"]
        count = text.count(anchor)
        receipt["anchor_occurrences"] = count
        if count != 1:
            # The anchor is not unique: the mutation is not applied and NOTHING is changed.
            receipt["status"] = "ANCHOR_NOT_UNIQUE"
            print("ANCHOR_NOT_UNIQUE:%d" % count, file=sys.stderr)
            return 3
        if spec["mutate"] == "insert":
            mutant_text = text.replace(anchor, anchor + spec["text"])
        else:
            mutant_text = text.replace(anchor, spec["text"])
        mutant = mutant_text.encode("utf-8")
        mutant_sha = digest(mutant)
        patch = "".join(difflib.unified_diff(
            original.decode("utf-8").splitlines(keepends=True),
            mutant_text.splitlines(keepends=True),
            fromfile=f"a/{spec['target']}", tofile=f"b/{spec['target']}"))
        patch_path = os.path.join(CONTROL, f"patch-{mutation_id}-{capture}.diff")
        with open(patch_path, "w", encoding="utf-8") as handle:
            handle.write(patch)
        receipt["mutant_sha256"] = mutant_sha
        receipt["mutant_bytes"] = len(mutant)
        receipt["patch"] = patch_path
        receipt["patch_sha256"] = digest(patch.encode("utf-8"))
        with open(target, "wb") as handle:
            handle.write(mutant)
        receipt["status"] = "mutant_applied"
        # The mutant run is an ordinary recorded run of the ORIGINAL recorder.
        finished = subprocess.run([sys.executable, RECORDER, capture] + argv, cwd=ROOT)
        receipt["recorder_exit"] = finished.returncode
        receipt["status"] = "mutant_run_done"
        exit_code = finished.returncode
    finally:
        # The file is restored BYTE FOR BYTE, whatever happened above.
        shutil.copyfile(backup, target)
        restored = open(target, "rb").read()
        receipt["restore"] = {
            "method": "byte for byte copy of the backup file; no git checkout, reset or restore",
            "restored_sha256": digest(restored),
            "bytes": len(restored),
            "identical_to_original": restored == original,
        }
        receipt["finished_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        if not receipt["restore"]["identical_to_original"]:
            receipt["status"] = "RESTORE_FAILED"
            exit_code = 9
        with open(os.path.join(CONTROL, f"receipt-{mutation_id}-{capture}.json"), "w", encoding="utf-8") as handle:
            json.dump(receipt, handle, indent=2)
    print(json.dumps(receipt, indent=2))
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
