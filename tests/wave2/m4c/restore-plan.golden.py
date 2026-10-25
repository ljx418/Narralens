#!/usr/bin/env python3
"""The independent implementation of the M4C restore-plan canonical rules.

`tests/wave2/m4c/restore-plan.vectors.json` is frozen evidence: the TypeScript produced it
once, it is committed, and this program recomputes every vector's preimage and hash from
the *specification* rather than from the TypeScript. The TypeScript proving it is
deterministic is not the claim; a second implementation agreeing with the frozen bytes is.

The rules, transcribed from `docs/migration/WAVE2/ADR-W2.0-006-m4c-history-restore.md`
§D-03 and `17_M4C_DEVELOPMENT_GATE.md` §3.3:

  canonical JSON: object keys in UTF-8 byte order, arrays in the semantic order the
  specification names (range by start/clip_id, consumer by kind/id/action, lock by
  lock_type/scope/target/range, roots lexicographic, subtitles by subtitle_id/path),
  integers only, no whitespace.

  hash domain: "narralens-history-restore-plan-v1\\n"

Run as `python3 -I tests/wave2/m4c/restore-plan.golden.py tests/wave2/m4c/restore-plan.vectors.json`.
It prints one line per vector and exits non-zero on the first disagreement.
"""

import functools
import hashlib
import json
import sys


def canonical(value):
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list):
        return "[" + ",".join(canonical(item) for item in value) + "]"
    if isinstance(value, dict):
        # UTF-8 byte order, not locale order and not code-point order for the astral
        # planes. `str` comparison is code-point order, which differs from byte order for
        # anything above the BMP, so the key is encoded first.
        items = sorted(value.items(), key=lambda pair: pair[0].encode("utf-8"))
        return "{" + ",".join(
            json.dumps(key, ensure_ascii=False) + ":" + canonical(item) for key, item in items) + "}"
    raise TypeError("CANONICAL_UNSUPPORTED_TYPE:%s" % type(value).__name__)


def by_bytes(value):
    return value.encode("utf-8")


def compare_ranges(left, right):
    return (left["start_frame"] - right["start_frame"]
            or (by_bytes(left["clip_id"]) > by_bytes(right["clip_id"]))
            - (by_bytes(left["clip_id"]) < by_bytes(right["clip_id"])))


def compare_subtitles(left, right):
    left_key = (by_bytes(left["subtitle_id"]), by_bytes(left["path"]))
    right_key = (by_bytes(right["subtitle_id"]), by_bytes(right["path"]))
    return (left_key > right_key) - (left_key < right_key)


def compare_consumers(left, right):
    left_key = (by_bytes(left["kind"]), by_bytes(left["id"]), by_bytes(left["action"]))
    right_key = (by_bytes(right["kind"]), by_bytes(right["id"]), by_bytes(right["action"]))
    return (left_key > right_key) - (left_key < right_key)


def compare_locks(left, right):
    left_key = (by_bytes(left["lock_type"]), by_bytes(left["scope"]),
                by_bytes(left["target_id"]), left["start_frame"], left["end_frame_exclusive"])
    right_key = (by_bytes(right["lock_type"]), by_bytes(right["scope"]),
                 by_bytes(right["target_id"]), right["start_frame"], right["end_frame_exclusive"])
    return (left_key > right_key) - (left_key < right_key)


def sort_plan(plan):
    """The canonical order of every array that enters the hash."""
    ordered = dict(plan)
    ordered["affected_ranges"] = sorted(plan["affected_ranges"], key=functools.cmp_to_key(compare_ranges))
    ordered["affected_consumers"] = sorted(plan["affected_consumers"], key=functools.cmp_to_key(compare_consumers))
    ordered["required_locks"] = sorted(plan["required_locks"], key=functools.cmp_to_key(compare_locks))
    ordered["target_roots"] = sorted(plan["target_roots"], key=by_bytes)
    ordered["target_subtitles"] = sorted(plan["target_subtitles"], key=functools.cmp_to_key(compare_subtitles))
    return ordered


DOMAIN = "narralens-history-restore-plan-v1\n"


def plan_preimage(plan):
    return DOMAIN + canonical(sort_plan(plan))


def plan_hash(plan):
    return hashlib.sha256(plan_preimage(plan).encode("utf-8")).hexdigest()


def main(argv):
    if len(argv) != 2:
        sys.stderr.write("usage: restore-plan.golden.py <vectors.json>\n")
        return 2
    with open(argv[1], "r", encoding="utf-8") as handle:
        document = json.load(handle)
    if document.get("domain") != "narralens-history-restore-plan-v1\\n":
        sys.stderr.write("DOMAIN_MISMATCH:%s\n" % document.get("domain"))
        return 1
    failures = 0
    for vector in document["vectors"]:
        preimage = plan_preimage(vector["plan"])
        digest = plan_hash(vector["plan"])
        if preimage != vector["preimage"]:
            sys.stderr.write("PREIMAGE_MISMATCH:%s\n" % vector["name"])
            failures += 1
            continue
        if digest != vector["plan_sha256"]:
            sys.stderr.write("HASH_MISMATCH:%s\n" % vector["name"])
            failures += 1
            continue
        print("%s %s" % (vector["name"], digest))
    if failures:
        sys.stderr.write("%d vector(s) disagreed\n" % failures)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
