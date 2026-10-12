#!/usr/bin/env python3
"""Probe the pinned OpenMontage contracts without invoking paid providers."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections import Counter
from pathlib import Path

import jsonschema


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[2]
    upstream = root / "vendor" / "OpenMontage"
    sys.path.insert(0, str(upstream))
    upstream_commit = subprocess.run(
        ["git", "-C", str(upstream), "rev-parse", "HEAD"],
        check=True, capture_output=True, text=True,
    ).stdout.strip()

    from lib.pipeline_loader import get_required_tools, get_stage_order, list_pipelines, load_pipeline
    from tools.tool_registry import ToolRegistry

    pipelines = {}
    for name in sorted(list_pipelines()):
        manifest = load_pipeline(name)
        pipelines[name] = {
            "stages": get_stage_order(manifest, include_sub_stages=True),
            "required_tools": sorted(get_required_tools(manifest)),
        }

    schema_dir = upstream / "schemas" / "artifacts"
    schemas = []
    for path in sorted(schema_dir.glob("*.schema.json")):
        schema = json.loads(path.read_text(encoding="utf-8"))
        jsonschema.Draft202012Validator.check_schema(schema)
        schemas.append(path.name)

    registry = ToolRegistry()
    discovered = sorted(registry.discover())
    tools = []
    status_counts: Counter[str] = Counter()
    for name in sorted(registry.list_all()):
        tool = registry.get(name)
        assert tool is not None
        status = tool.get_status()
        status_value = getattr(status, "value", str(status))
        status_counts[status_value] += 1
        tools.append({
            "name": name,
            "status": status_value,
            "tier": getattr(tool.tier, "value", str(tool.tier)),
            "stability": getattr(tool.stability, "value", str(tool.stability)),
            "capability": tool.capability,
            "provider": tool.provider,
        })

    proposal_schema = json.loads((schema_dir / "proposal_packet.schema.json").read_text(encoding="utf-8"))
    result = {
        "probe": "narralens.d1.openmontage@1",
        "upstream_commit": upstream_commit,
        "pipeline_count": len(pipelines),
        "pipelines": pipelines,
        "artifact_schemas": schemas,
        "proposal_packet_required": proposal_schema.get("required", []),
        "registry": {
            "discovered_count": len(discovered),
            "registered_count": len(tools),
            "status_counts": dict(sorted(status_counts.items())),
            "tools": tools,
        },
        "safety": "Discovery only; no provider operation was invoked.",
    }
    output = root / args.output
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(output.relative_to(root)),
        "pipelines": len(pipelines),
        "schemas": len(schemas),
        "tools": len(tools),
        "status_counts": dict(sorted(status_counts.items())),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
