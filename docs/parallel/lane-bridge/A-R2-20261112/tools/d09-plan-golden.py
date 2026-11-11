#!/usr/bin/env python3
"""The independent cross-check of the D09 prepared adoption plan digest.

This is a SECOND implementation of the same specification, written in a different
language and against the same frozen vectors, so that a mistake in the TypeScript
canonicalisation cannot hide behind the TypeScript canonicalisation.

The specification it implements:

  * the preimage is the restricted canonical JSON of
        {"domain": "narralens.prepared-adoption-plan@1", "version": 1, "facts": {...}}
  * restricted canonical JSON means: object keys sorted ascending by code unit, no
    whitespace, arrays in the order given, and only safe integers, booleans, null and
    strings as values;
  * the facts are the plan with `format` and `version` removed and every array
    sorted by its own explicit total order;
  * the digest is the SHA-256 of that preimage, lowercase hex.

It reads the frozen vectors from ../golden/d09-plan-vectors.json and, with --check,
fails when the computed preimage or digest differs from the frozen expectation.

Run it with:
    python3 docs/parallel/lane-bridge/A-R2-20261112/tools/d09-plan-golden.py --check
"""

import functools
import hashlib
import json
import os
import sys

DOMAIN = "narralens.prepared-adoption-plan@1"
VERSION = 1
HASH_CHARS = set("0123456789abcdef")

VECTORS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "golden", "d09-plan-vectors.json")


def canonical(value):
    """The restricted canonical JSON text of a value."""
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, int):
        if not (-(2 ** 53) + 1 <= value <= 2 ** 53 - 1):
            raise ValueError("CANONICAL_NON_INTEGER")
        return str(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list):
        return "[" + ",".join(canonical(item) for item in value) + "]"
    if isinstance(value, dict):
        parts = []
        for key in sorted(value.keys()):
            parts.append(json.dumps(key, ensure_ascii=False) + ":" + canonical(value[key]))
        return "{" + ",".join(parts) + "}"
    raise ValueError("CANONICAL_UNSUPPORTED_TYPE")


def by_path(left, right):
    return -1 if left["relative_path"] < right["relative_path"] else (1 if left["relative_path"] > right["relative_path"] else 0)


def by_ref(left, right):
    return -1 if left["ref_id"] < right["ref_id"] else (1 if left["ref_id"] > right["ref_id"] else 0)


def by_lock(left, right):
    return -1 if left["lock_id"] < right["lock_id"] else (1 if left["lock_id"] > right["lock_id"] else 0)


def by_range(left, right):
    if left["start_frame"] != right["start_frame"]:
        return left["start_frame"] - right["start_frame"]
    if left["end_frame_exclusive"] != right["end_frame_exclusive"]:
        return left["end_frame_exclusive"] - right["end_frame_exclusive"]
    return -1 if left["clip_id"] < right["clip_id"] else (1 if left["clip_id"] > right["clip_id"] else 0)


def facts_of(plan):
    """The facts of a plan, in the one order they are hashed in."""
    execution = plan["producer_execution"]
    return {
        "source_kind": plan["source_kind"],
        "project_id": plan["project_id"],
        "base_revision": plan["base_revision"],
        "base_source_digest": plan["base_source_digest"],
        "control_revision": plan["control_revision"],
        "selection_version": plan["selection_version"],
        "materialization_id": plan["materialization_id"],
        "prepared_fact_digest": plan["prepared_fact_digest"],
        "request_digest": plan["request_digest"],
        "producer_execution": {
            "run_id": execution["run_id"],
            "plan_version": execution["plan_version"],
            "step_id": execution["step_id"],
            "attempt": execution["attempt"],
            "input_digest": execution["input_digest"],
            "run_scope_digest": execution["run_scope_digest"],
            "authorization_id": execution["authorization_id"],
        },
        "target_source_digest": plan["target_source_digest"],
        "target_snapshot_id": plan["target_snapshot_id"],
        "roots": sorted(plan["roots"]),
        "files": sorted(
            [{"relative_path": f["relative_path"], "bytes": f["bytes"], "sha256": f["sha256"]} for f in plan["files"]],
            key=functools.cmp_to_key(by_path),
        ),
        "rights": sorted(
            [{"ref_id": r["ref_id"], "artifact_version": r["artifact_version"], "sha256": r["sha256"]} for r in plan["rights"]],
            key=functools.cmp_to_key(by_ref),
        ),
        "consumer": {
            "consumer_id": plan["consumer"]["consumer_id"],
            "project_id": plan["consumer"]["project_id"],
            "run_id": plan["consumer"]["run_id"],
            "graph_digest": plan["consumer"]["graph_digest"],
        },
        "native_plan": {
            "native_plan_sha256": plan["native_plan"]["native_plan_sha256"],
            "film_sha256": plan["native_plan"]["film_sha256"],
            "film_bytes": plan["native_plan"]["film_bytes"],
            "settings_digest": plan["native_plan"]["settings_digest"],
            "subtitle_style_digest": plan["native_plan"]["subtitle_style_digest"],
            "captions_digest": plan["native_plan"]["captions_digest"],
            "markers_digest": plan["native_plan"]["markers_digest"],
        },
        "frame_count": plan["frame_count"],
        "fps_numerator": plan["fps_numerator"],
        "fps_denominator": plan["fps_denominator"],
        "affected_ranges": sorted(
            [
                {"start_frame": r["start_frame"], "end_frame_exclusive": r["end_frame_exclusive"], "clip_id": r["clip_id"]}
                for r in plan["affected_ranges"]
            ],
            key=functools.cmp_to_key(by_range),
        ),
        "locks_checked": sorted(
            [
                {
                    "lock_id": l["lock_id"],
                    "lock_type": l["lock_type"],
                    "scope": l["scope"],
                    "target_id": l["target_id"],
                    "start_frame": l["start_frame"],
                    "end_frame_exclusive": l["end_frame_exclusive"],
                }
                for l in plan["locks_checked"]
            ],
            key=functools.cmp_to_key(by_lock),
        ),
        "engine_upstream_sha": plan["engine_upstream_sha"],
        "expires_at": plan["expires_at"],
    }


def preimage_of(plan):
    # The domain and the version are the ones the PLAN claims, not the constants of this
    # script: a plan that claims another version has to hash differently.
    return canonical({"domain": plan["format"], "version": plan["version"], "facts": facts_of(plan)})


def digest_of(plan):
    return hashlib.sha256(preimage_of(plan).encode("utf-8")).hexdigest()


def is_hash(value):
    return isinstance(value, str) and len(value) == 64 and set(value) <= HASH_CHARS


def validate(plan):
    """The refusal rules of the plan. Every failure is a rejection, never a repair."""
    if plan.get("format") != DOMAIN:
        raise ValueError("PLAN_DOMAIN")
    if plan.get("version") != VERSION:
        raise ValueError("PLAN_VERSION")
    if plan.get("source_kind") != "created_prepared_source":
        raise ValueError("PLAN_SOURCE_KIND")
    for field in ("base_source_digest", "prepared_fact_digest", "request_digest", "target_source_digest", "engine_upstream_sha"):
        if not is_hash(plan.get(field)):
            raise ValueError("PLAN_HASH:" + field)
    if plan["consumer"]["graph_digest"] is not None and not is_hash(plan["consumer"]["graph_digest"]):
        raise ValueError("PLAN_HASH:consumer.graph_digest")
    for field in ("base_revision", "control_revision", "selection_version", "frame_count", "fps_numerator", "fps_denominator"):
        value = plan.get(field)
        if not isinstance(value, int) or isinstance(value, bool) or not (-(2 ** 53) + 1 <= value <= 2 ** 53 - 1):
            raise ValueError("PLAN_INTEGER:" + field)
    if plan["fps_numerator"] < 1 or plan["fps_denominator"] < 1:
        raise ValueError("PLAN_FPS")
    if plan["consumer"]["project_id"] != plan["project_id"]:
        raise ValueError("PLAN_CONSUMER_PROJECT")
    files = plan["files"]
    paths = set()
    for entry in files:
        if not is_hash(entry["sha256"]):
            raise ValueError("PLAN_HASH:files")
        if not isinstance(entry["bytes"], int) or isinstance(entry["bytes"], bool) or entry["bytes"] < 0:
            raise ValueError("PLAN_INTEGER:files.bytes")
        if entry["relative_path"] in paths:
            raise ValueError("PLAN_DUPLICATE_FILE")
        paths.add(entry["relative_path"])
    roots = set(plan["roots"])
    if len(roots) != len(plan["roots"]):
        raise ValueError("PLAN_DUPLICATE_ROOT")
    for root in plan["roots"]:
        if root not in paths:
            raise ValueError("PLAN_ROOT_NOT_A_FILE")
    rights = set()
    for entry in plan["rights"]:
        if not is_hash(entry["sha256"]):
            raise ValueError("PLAN_HASH:rights")
        if entry["ref_id"] in rights:
            raise ValueError("PLAN_DUPLICATE_RIGHT")
        rights.add(entry["ref_id"])
    locks = set()
    for entry in plan["locks_checked"]:
        if entry["lock_id"] in locks:
            raise ValueError("PLAN_DUPLICATE_LOCK")
        locks.add(entry["lock_id"])
    ranges = set()
    for entry in plan["affected_ranges"]:
        if entry["end_frame_exclusive"] <= entry["start_frame"]:
            raise ValueError("PLAN_EMPTY_RANGE")
        if entry["end_frame_exclusive"] > plan["frame_count"]:
            raise ValueError("PLAN_RANGE_PAST_END")
        key = (entry["start_frame"], entry["end_frame_exclusive"], entry["clip_id"])
        if key in ranges:
            raise ValueError("PLAN_DUPLICATE_RANGE")
        ranges.add(key)
    return True


def main(argv):
    check = "--check" in argv
    with open(VECTORS, "r", encoding="utf-8") as handle:
        vectors = json.load(handle)
    failures = []
    for case in vectors["cases"]:
        name = case["name"]
        try:
            validate(case["plan"])
        except ValueError as error:
            if case.get("expect") == "rejected":
                continue
            failures.append("%s: unexpected rejection %s" % (name, error))
            continue
        if case.get("expect") == "rejected":
            failures.append("%s: was accepted and had to be rejected" % name)
            continue
        preimage = preimage_of(case["plan"])
        digest = digest_of(case["plan"])
        if preimage != case["preimage"]:
            failures.append("%s: the preimage differs from the frozen vector" % name)
        if digest != case["digest"]:
            failures.append("%s: the digest differs from the frozen vector" % name)
    if failures:
        for failure in failures:
            sys.stderr.write(failure + "\n")
        return 1
    if check:
        sys.stdout.write("d09-plan-golden: %d case(s) agree with the frozen vectors\n" % len(vectors["cases"]))
    else:
        for case in vectors["cases"]:
            if case.get("expect") == "rejected":
                continue
            sys.stdout.write(case["name"] + " " + digest_of(case["plan"]) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
