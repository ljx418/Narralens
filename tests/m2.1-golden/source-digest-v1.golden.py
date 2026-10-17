#!/usr/bin/env python3
"""Cross-language recomputation of the SourceDigestV1 canonical digest.

Reads `source-digest-v1.vectors.json` (or a single manifest JSON on stdin) and recomputes
`SHA256("narralens-source-v1\\n" + canonical(manifest))` using only the standard library.
It must agree with the TypeScript implementation byte for byte; a disagreement means one of
the two does not implement `docs/migration/M2/M2.1-development-and-acceptance-plan.md`
§5.4.1.

Run with `python3 -I tests/m2.1-golden/source-digest-v1.golden.py` (isolated mode: no
user site-packages, no cwd on sys.path).
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

DOMAIN = b"narralens-source-v1\n"


def canonical(value: object) -> str:
    """UTF-8 byte-order key sort, integers only, no whitespace."""
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
        items = sorted(value.items(), key=lambda pair: pair[0].encode("utf-8"))
        return "{" + ",".join(
            json.dumps(key, ensure_ascii=False) + ":" + canonical(item) for key, item in items
        ) + "}"
    raise TypeError(f"unsupported type in canonical json: {type(value).__name__}")


def source_digest(manifest: object) -> str:
    return hashlib.sha256(DOMAIN + canonical(manifest).encode("utf-8")).hexdigest()


def main(argv: list[str]) -> int:
    if len(argv) > 1:
        payload = json.loads(Path(argv[1]).read_text(encoding="utf-8"))
    else:
        payload = json.load(sys.stdin)

    failures = 0
    vectors = payload["vectors"] if isinstance(payload, dict) else []
    for vector in vectors:
        recomputed = source_digest(vector["manifest"])
        expected = vector["source_digest"]
        ok = recomputed == expected
        failures += 0 if ok else 1
        print(f"{'PASS' if ok else 'FAIL'} {vector['id']}: {recomputed} (expected {expected})")

    print(f"vectors={len(vectors)} failures={failures} ruleset=narralens-source-digest-v1.0")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
