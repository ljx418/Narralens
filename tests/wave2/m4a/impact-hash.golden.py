"""
An independent implementation of `narralens-impact-v1` (M4A-H01).

Written from ADR-W2.0-004 §4 rather than from `src/host/impact/impact-canonical.ts`, and
deliberately not sharing any code with it — that is the point. A hash whose only witness is
the function that produced it proves the function is deterministic, not that it is *correct*.

Two properties are implemented here from the specification's own words:

  impact_hash = SHA256("narralens-impact-v1\\n" + canonical(spec without impact_hash))

  canonical: object keys in UTF-8 byte order, arrays in the semantic order the ADR names
  (range by start/end/clip_id, consumer by kind/id/action, lock by lock_id), integers only,
  no whitespace.

Run as `python3 -I tests/wave2/m4a/impact-hash.golden.py tests/wave2/m4a/impact-hash.vectors.json`.
It prints one line per vector and exits non-zero on the first disagreement.
"""

import functools
import hashlib
import json
import sys


def canonical(value):
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list):
        return "[" + ",".join(canonical(item) for item in value) + "]"
    if isinstance(value, dict):
        pairs = sorted(value.items(), key=lambda kv: kv[0].encode("utf-8"))
        return "{" + ",".join(
            json.dumps(key, ensure_ascii=False) + ":" + canonical(item) for key, item in pairs
        ) + "}"
    raise TypeError("CANONICAL_UNSUPPORTED_TYPE:" + type(value).__name__)


def compare_ranges(left, right):
    return (left["start_frame"] - right["start_frame"]
            or left["end_frame_exclusive"] - right["end_frame_exclusive"]
            or (left["clip_id"].encode("utf-8") > right["clip_id"].encode("utf-8"))
            - (left["clip_id"].encode("utf-8") < right["clip_id"].encode("utf-8")))


def compare_consumers(left, right):
    for field in ("kind", "id", "action"):
        a, b = left[field].encode("utf-8"), right[field].encode("utf-8")
        if a != b:
            return (a > b) - (a < b)
    return 0


def compare_locks(left, right):
    a, b = left["lock_id"].encode("utf-8"), right["lock_id"].encode("utf-8")
    return (a > b) - (a < b)


def sort_arrays(spec):
    return {
        **spec,
        # `cmp_to_key` rather than a tuple key: the comparators below are transcribed from
        # the specification's ordering rules, including the UTF-8 byte comparison that
        # `localeCompare` does not give. A tuple key would be a different algorithm.
        "affected_ranges": sorted(spec["affected_ranges"], key=functools.cmp_to_key(compare_ranges)),
        "affected_consumers": sorted(spec["affected_consumers"], key=functools.cmp_to_key(compare_consumers)),
        "locks_checked": sorted(spec["locks_checked"], key=functools.cmp_to_key(compare_locks)),
        "approvals_required": sorted(spec["approvals_required"], key=lambda s: s.encode("utf-8")),
    }


def impact_hash(spec):
    body = {key: value for key, value in spec.items() if key != "impact_hash"}
    preimage = "narralens-impact-v1\n" + canonical(sort_arrays(body))
    return hashlib.sha256(preimage.encode("utf-8")).hexdigest(), preimage


def main(argv):
    if len(argv) != 2:
        print("usage: impact-hash.golden.py <vectors.json>", file=sys.stderr)
        return 2
    with open(argv[1], "r", encoding="utf-8") as handle:
        document = json.load(handle)

    failures = 0
    for vector in document["vectors"]:
        computed, preimage = impact_hash(vector["spec"])
        if computed != vector["impact_hash"]:
            failures += 1
            print("MISMATCH %s expected=%s computed=%s" % (vector["name"], vector["impact_hash"], computed))
        if "preimage" in vector and preimage != vector["preimage"]:
            failures += 1
            print("PREIMAGE_MISMATCH %s" % vector["name"])
        print("OK %s %s" % (vector["name"], computed))
    print("vectors=%d failures=%d" % (len(document["vectors"]), failures))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
