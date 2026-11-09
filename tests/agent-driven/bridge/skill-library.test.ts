/**
 * The skill library must not drift from the façade.
 *
 * The library re-exports the production registry view, so this case is mostly a
 * guard against the library being edited into a second, hand-maintained list — the
 * failure mode where a skill tells an agent about a tool the façade does not
 * expose, or forgets one it does.
 */

import { describe, expect, it } from "vitest";
import {
  callableTools,
  describeTool,
  unexposedRoutes,
} from "../../../skills/narralens-lib/lib/agent-registry.js";
import { exposedToolNames, exposedToolRoutes } from "../../../src/mcp/index.js";

describe("skill library", () => {
  it("describes exactly the tools the façade exposes", () => {
    expect(callableTools().map((tool) => tool.name)).toEqual(exposedToolNames());
    expect(callableTools()).toHaveLength(24);
  });

  it("names the trusted-UI and native-bridge routes as not callable", () => {
    const unexposed = unexposedRoutes().map((route) => route.id).sort();
    expect(unexposed).toEqual([
      "change.approve",
      "editor.native.ack",
      "events.snapshot",
      "intake.confirm",
      "question.answer.ui",
      "review.decide",
      "workflow.run.authorize",
    ]);
    for (const route of unexposedRoutes()) {
      expect(route.reason.length).toBeGreaterThan(0);
    }
  });

  it("describes a tool from the registry rather than from prose", () => {
    const route = exposedToolRoutes().find((candidate) => candidate.tool === "narralens_context_read");
    expect(route).toBeDefined();
    expect(describeTool("narralens_context_read")).toContain(route?.id ?? "");
    expect(describeTool("narralens_not_a_tool")).toContain("not an exposed tool");
  });
});
