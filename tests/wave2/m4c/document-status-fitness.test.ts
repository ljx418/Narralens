import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string): string => readFileSync(path, "utf8");

const routeRow = (document: string, route: string): string => {
  const row = document
    .split("\n")
    .filter((line) => line.startsWith("|") && line.includes(`\`${route}\``))
    .at(-1);
  expect(row, `missing route inventory row for ${route}`).toBeDefined();
  return row!;
};

const stageRow = (document: string, stage: string): string => {
  const row = document
    .split("\n")
    .find((line) => line.startsWith(`| ${stage} |`));
  expect(row, `missing stage row for ${stage}`).toBeDefined();
  return row!;
};

/** Prevent a later evidence sync from putting a closed route back into the planned/404 state. */
describe("M4C authority documents describe the mounted production routes", () => {
  it("keeps architecture, traceability and route inventory aligned with M4B/M4C", () => {
    const architecture = read("docs/03_Architecture.md");
    const traceability = read("docs/11_V1_Traceability.md");
    const routes = read("docs/migration/M1/route-inventory.md");

    expect(architecture).toContain("`POST /api/migration/v1/projects/:id/edits`：**M4B 已实现");
    expect(architecture).not.toContain("`POST /api/migration/v1/projects/:id/edits`：Wave 2 冻结、未实现");
    for (const route of [
      "/api/migration/v1/projects/:id/edits",
      "/api/migration/v1/projects/:id/history",
      "/api/migration/v1/projects/:id/history/restore",
      "/api/migration/v1/projects/:id/history/undo",
      "/api/migration/v1/projects/:id/history/redo",
    ]) {
      const row = routeRow(routes, route);
      expect(row).toContain("**M4");
      expect(row).toContain("已实现");
      expect(row).not.toContain("404");
      expect(row).not.toContain("未注册");
    }
    expect(architecture).toContain("history/restore`");
    expect(architecture).toContain("history/undo` 与 `.../redo`");
    const wave2Row = stageRow(traceability, "M4A–M4C");
    expect(wave2Row).toContain("M4A、M4B、M4C 独立外审及 Wave 2 组合外审均 PASS");
    expect(wave2Row).toContain("WAVE2_EDITABLE_ADOPTION_READY");
    expect(traceability).toContain("Gate D4.2 仍未关闭");
  });

  it("records the accepted D-05/D-06 reconciliation and transition boundary", () => {
    const adr6 = read("docs/migration/WAVE2/ADR-W2.0-006-m4c-history-restore.md");
    const adr7 = read("docs/migration/WAVE2/ADR-W2.0-007-m4c-contract-reconciliation.md");
    const gate = read("docs/migration/WAVE2/17_M4C_DEVELOPMENT_GATE.md");
    expect(adr6).toContain("ADR-W2.0-007-m4c-contract-reconciliation.md");
    expect(adr7).toContain("`required_locks` 是 `HistoryRestorePlanV1` canonical preimage 的字段");
    expect(adr7).toMatch(/HTTP 422\s+`UNSUPPORTED_EDIT`/);
    expect(adr7).toContain("HTTP 422 `INVALID_REQUEST`");
    expect(gate).toContain("ADR-W2.0-007-m4c-contract-reconciliation.md");
    expect(gate).toContain("transition 为 `NOT_APPLICABLE_APPROVED`");
  });
});
