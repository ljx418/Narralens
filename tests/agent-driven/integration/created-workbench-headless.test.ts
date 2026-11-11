import { describe, expect, it } from "vitest";
import type { Context } from "../../../src/contracts/agent-driven-types.js";
import { createdProjectFixture } from "./helpers/created-project-fixture.js";

/**
 * The workbench and the native acknowledgement, against a real Host (A-R2).
 *
 * These cases start no browser and no Studio, but they do start a real Host with a
 * real created project, so they need MAIN's single slot. They are written to be run
 * under that grant; until then they are NOT_RUN.
 *
 * What they prove is the negative that matters most: a created project has no
 * native acknowledgement, the workbench claims none, and the durable table is
 * empty. A decision and a commit are not an acknowledgement, and nothing here
 * turns them into one.
 */

describe("the workbench of a created project", () => {
  it("claims no native load, because nothing was ever acknowledged", async () => {
    const f = await createdProjectFixture();
    try {
      const response = await f.request(`/api/agent/v1/projects/${f.projectId}/context`);
      expect(response.status).toBe(200);
      const context = await response.json() as Context;
      // The project really committed; that is a commit and nothing else.
      expect(context.project_revision).toBe(f.commit.revision);
      expect(context.snapshot_id).toBe(f.commit.snapshot_id);
      expect(context.source_digest).toBe(f.commit.source_digest);
      // No acknowledgement, and no claim of one.
      expect(context.native_ack).toBeNull();
      expect(context.native_sync).toBe("unknown");
      // No selection either: the editor was never observed.
      expect(context.current_selection).toBeNull();
      expect(context.selection_version).toBe(0);
    } finally {
      await f.close();
    }
  });

  it("keeps the durable acknowledgement table empty", async () => {
    const f = await createdProjectFixture();
    try {
      const rows = f.host.revisions.compose(db => db.prepare("SELECT count(*) AS n FROM cp_a0_native_ack").get() as { n: number });
      expect(Number(rows?.n ?? 0)).toBe(0);
    } finally {
      await f.close();
    }
  });

  it("refuses to read the context of another project for a foreign principal", async () => {
    const f = await createdProjectFixture();
    try {
      const response = await fetch(`${f.host.origin}/api/agent/v1/projects/${f.projectId}/context`, {
        headers: { Origin: f.host.origin, Authorization: "Bearer not-the-owner" },
      });
      // The Host refuses it; it does not answer with somebody else's project.
      expect(response.status).not.toBe(200);
      const text = await response.text();
      expect(text).not.toContain(f.projectId);
    } finally {
      await f.close();
    }
  });
});
