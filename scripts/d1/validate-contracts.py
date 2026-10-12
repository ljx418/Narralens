#!/usr/bin/env python3
"""Validate D1 contracts and the canonical documentation examples."""

from __future__ import annotations

import json
from pathlib import Path

import jsonschema


def main() -> int:
    root = Path(__file__).resolve().parents[2]
    schema = json.loads((root / "contracts/proposal-bundle.schema.json").read_text(encoding="utf-8"))
    example = json.loads((root / "docs/contracts/proposal-bundle.example.json").read_text(encoding="utf-8"))
    jsonschema.Draft202012Validator.check_schema(schema)
    jsonschema.validate(example, schema)

    selection = example["selection"]
    if selection["end_frame_exclusive"] <= selection["start_frame"]:
        raise ValueError("selection must be a non-empty [start_frame, end_frame_exclusive) range")
    duration = selection["end_frame_exclusive"] - selection["start_frame"]
    if sum(segment["duration_frames"] for segment in example["segments"]) != duration:
        raise ValueError("segment durations must exactly cover the selected frame range")
    if example["renderable"] and any(segment["asset_id"] is None for segment in example["segments"]):
        raise ValueError("renderable proposals cannot contain unresolved segment assets")

    print(json.dumps({
        "schema": "contracts/proposal-bundle.schema.json",
        "example": "docs/contracts/proposal-bundle.example.json",
        "valid": True,
        "selection_frames": duration,
        "segment_frames": sum(segment["duration_frames"] for segment in example["segments"]),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
