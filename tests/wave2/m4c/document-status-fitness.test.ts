import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string): string => readFileSync(path, "utf8");

/** Prevent a later evidence sync from putting a closed route back into the planned/404 state. */
describe("M4C authority documents describe the mounted production routes", () => {
  it("keeps architecture, traceability and route inventory aligned with M4B/M4C", () => {
    const architecture = read("docs/03_Architecture.md");
    const traceability = read("docs/11_V1_Traceability.md");
    const routes = read("docs/migration/M1/route-inventory.md");

    expect(architecture).toContain("`POST /api/migration/v1/projects/:id/edits`：**M4B 已实现");
    expect(architecture).not.toContain("`POST /api/migration/v1/projects/:id/edits`：Wave 2 冻结、未实现");
    for (const route of ["history`", "history/restore`", "history/undo`", "history/redo`"]) {
      expect(routes).toContain(route);
    }
    expect(architecture).toContain("history/restore`");
    expect(architecture).toContain("history/undo` 与 `.../redo`");
    expect(traceability).toContain("M4B 第十轮独立外审 PASS");
    expect(traceability).toContain("M4C");
  });

  it("records the accepted D-05/D-06 reconciliation and transition boundary", () => {
    const adr6 = read("docs/migration/WAVE2/ADR-W2.0-006-m4c-history-restore.md");
    const adr7 = read("docs/migration/WAVE2/ADR-W2.0-007-m4c-contract-reconciliation.md");
    const gate = read("docs/migration/WAVE2/17_M4C_DEVELOPMENT_GATE.md");
    expect(adr6).toContain("ADR-W2.0-007-m4c-contract-reconciliation.md");
    expect(adr7).toContain("`required_locks` 是 `HistoryRestorePlanV1` canonical preimage 的字段");
    expect(adr7).toContain("HTTP 422 `UNSUPPORTED_EDIT`");
    expect(gate).toContain("transition 为 `NOT_APPLICABLE_APPROVED`");
  });
});
