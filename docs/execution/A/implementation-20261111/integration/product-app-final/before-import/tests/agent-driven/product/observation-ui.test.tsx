// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type {
  Context,
  HealthRead,
  ReviewPackage,
  ServiceHealth,
  Workflow,
} from "../../../src/contracts/agent-driven-types.js";
import { WorkflowTopBar } from "../../../src/app/observation/WorkflowTopBar.js";
import { CreativeReviewPanel } from "../../../src/app/observation/CreativeReviewPanel.js";
import { nativeSyncState } from "../../../src/app/observation/content-views.js";
import { SystemControlPanel } from "../../../src/app/system/SystemControlPanel.js";

/**
 * The DOM is cleaned between the cases.
 *
 * Without it the panels of the earlier cases stay in the document and every query finds
 * two elements, which is how six cases failed for a reason that had nothing to do with
 * the behaviour they were checking.
 */
afterEach(() => {
  cleanup();
});

const WORKFLOW: Workflow = {
  project_id: "project-1",
  workflow_revision: 4,
  nodes: [
    {
      node_id: "sample",
      state: "waiting_user",
      reason: "waiting_for_decision",
      input_refs: [{ id: "in-1", version: 2, sha256: "a".repeat(64) }],
      output_refs: [{ id: "out-1", version: 1, sha256: "b".repeat(64) }],
      job_id: "job-7",
      attempt: 2,
      dependencies: ["definition"],
      allowed_actions: ["clip_prepare"],
    },
    {
      node_id: "first_chapter",
      state: "pending",
      reason: "not_started",
      input_refs: [],
      output_refs: [],
      job_id: null,
      attempt: 0,
      dependencies: ["sample"],
      allowed_actions: ["clip_prepare"],
    },
  ],
  next_actions: ["review_package"],
};

const PACKAGE: ReviewPackage = {
  project_id: "project-1",
  run_id: "run-1",
  plan_version: 1,
  package_id: "package-1",
  version: 1,
  kind: "chapter_pack",
  chapter_id: "chapter-1",
  input_digest: "a".repeat(64),
  output_digest: "b".repeat(64),
  quality_digest: "c".repeat(64),
  parts: [
    { kind: "preview", artifact_ref: { id: "video", version: 1, sha256: "d".repeat(64) }, download_ref: null },
    { kind: "narration", artifact_ref: { id: "audio", version: 1, sha256: "e".repeat(64) }, download_ref: null },
    { kind: "subtitles", artifact_ref: { id: "subs", version: 1, sha256: "f".repeat(64) }, download_ref: null },
  ],
  source_shot_ids: ["shot-1"],
  selection_reason: "章节候选",
  allowed_choices: ["accept", "changes_requested", "reject"],
  impact: null,
  reuse_of_package_id: null,
  review_url: "/workbench/projects/project-1/reviews/package-1",
  state: "pending",
};

const SAMPLED_AT = new Date(1794000000000).toISOString();
const EXPIRES_AT = new Date(1794000015000).toISOString();

function service(overrides: Partial<ServiceHealth>): ServiceHealth {
  return {
    service_id: "media-worker",
    state: "ready",
    ownership: "owned",
    sampled_at: SAMPLED_AT,
    expires_at: EXPIRES_AT,
    reason: "",
    metrics: [],
    ...overrides,
  };
}

describe("the R4 workflow bar", () => {
  it("starts collapsed and shows a stage summary", () => {
    render(<WorkflowTopBar workflow={WORKFLOW} />);
    const toggle = screen.getByRole("button", { name: "工作流" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("等你决定：样片")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the stages horizontally with their creative names", () => {
    render(<WorkflowTopBar workflow={WORKFLOW} />);
    fireEvent.click(screen.getByRole("button", { name: "工作流" }));
    expect(screen.getByRole("button", { name: /工作流/ }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: /样片/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /首章/ })).toBeTruthy();
    // The internal identifiers stay in the detail, not in the rail.
    expect(screen.queryByText("first_chapter")).toBeNull();
  });

  it("shows the real attempt, input and output of a node", () => {
    render(<WorkflowTopBar workflow={WORKFLOW} />);
    fireEvent.click(screen.getByRole("button", { name: "工作流" }));
    fireEvent.click(screen.getByRole("button", { name: /样片/ }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("内部标识");
    expect(dialog.textContent).toContain("sample");
    expect(dialog.textContent).toContain("2");
    expect(dialog.textContent).toContain("job-7");
    expect(dialog.textContent).toContain("in-1@2");
    expect(dialog.textContent).toContain("out-1@1");
  });

  it("closes the dialog with Escape and returns the focus to the stage", () => {
    render(<WorkflowTopBar workflow={WORKFLOW} />);
    fireEvent.click(screen.getByRole("button", { name: "工作流" }));
    const trigger = screen.getByRole("button", { name: /样片/ });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("has no control effect when the dialog is closed", () => {
    const onLocate = vi.fn();
    render(<WorkflowTopBar workflow={WORKFLOW} onLocate={onLocate} />);
    fireEvent.click(screen.getByRole("button", { name: "工作流" }));
    fireEvent.click(screen.getByRole("button", { name: /样片/ }));
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onLocate).not.toHaveBeenCalled();
  });

  it("says when the connection is broken instead of pretending the state is current", () => {
    render(<WorkflowTopBar workflow={WORKFLOW} connection="disconnected" />);
    expect(screen.getByText("连接中断 · 保留最后已知状态")).toBeTruthy();
    expect(screen.getByText("连接已断开，结果尚未确认。")).toBeTruthy();
  });
});

describe("the creative review panel", () => {
  it("separates closing from deciding", () => {
    const onAccept = vi.fn();
    const onClose = vi.fn();
    render(<CreativeReviewPanel package={PACKAGE} onAccept={onAccept} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "关闭审阅" }));
    expect(onClose).toHaveBeenCalled();
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("shows the chapter bundle as one package and offers only the allowed choices", () => {
    render(<CreativeReviewPanel package={PACKAGE} onAccept={vi.fn()} onReject={vi.fn()} />);
    expect(screen.getByText("音画字幕同包")).toBeTruthy();
    expect(screen.getByText("画面")).toBeTruthy();
    expect(screen.getByText("旁白")).toBeTruthy();
    expect(screen.getByText("字幕")).toBeTruthy();
    const adopt = screen.getByRole("button", { name: "确认并采用" }) as HTMLButtonElement;
    expect(adopt.disabled).toBe(true);
  });

  it("asks the host to open a part instead of playing it itself", () => {
    const onOpenPart = vi.fn();
    render(<CreativeReviewPanel package={PACKAGE} onOpenPart={onOpenPart} />);
    fireEvent.click(screen.getAllByRole("button", { name: "在工作台中查看" })[0] as HTMLElement);
    expect(onOpenPart).toHaveBeenCalled();
    // The panel has no player and no timeline of its own.
    expect(document.querySelector("video")).toBeNull();
    expect(document.querySelector("timeline")).toBeNull();
  });

  it("presents the cover as its own review", () => {
    render(
      <CreativeReviewPanel
        package={{ ...PACKAGE, kind: "cover", chapter_id: null, parts: [PACKAGE.parts[0]!] }}
        onAccept={vi.fn()}
      />,
    );
    expect(screen.getByText("独立封面")).toBeTruthy();
    expect(screen.getByText("封面内容")).toBeTruthy();
  });
});

describe("the system control panel", () => {
  const health: HealthRead = {
    services: [
      service({}),
      service({ service_id: "shared-comfy", ownership: "shared" }),
    ],
    sample_interval_ms: 5000,
    stale_after_ms: 15000,
  };

  it("renders a non-modal aside without a backdrop", () => {
    const { container } = render(
      <SystemControlPanel health={health} nowMs={1794000000000} open onClose={vi.fn()} />,
    );
    expect(container.querySelector(".nl-dialog-backdrop")).toBeNull();
    expect(screen.getByRole("complementary", { name: /系统控制/ })).toBeTruthy();
  });

  it("closes on Escape without taking the focus when it opens", () => {
    const onClose = vi.fn();
    render(
      <SystemControlPanel health={health} nowMs={1794000000000} open onClose={onClose} />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("shows a stale sample as unknown", () => {
    render(
      <SystemControlPanel health={health} nowMs={1794000000000 + 60000} open onClose={vi.fn()} />,
    );
    expect(screen.getAllByText(/未知/).length).toBeGreaterThan(0);
  });

  it("shows a sample from the future or an unreadable one as unknown", () => {
    render(
      <SystemControlPanel
        health={{
          ...health,
          services: [
            service({ sampled_at: new Date(1794000000000 + 60000).toISOString() }),
            service({ service_id: "broken", sampled_at: "not-a-date" }),
          ],
        }}
        nowMs={1794000000000}
        open
        onClose={vi.fn()}
      />,
    );
    expect(screen.getAllByText(/未知/).length).toBeGreaterThan(0);
  });

  it("tells the truth about a metric that has no value", () => {
    render(
      <SystemControlPanel
        health={{
          ...health,
          services: [
            service({
              metrics: [
                {
                  value: null,
                  unit: "bytes",
                  source: "unavailable",
                  observed_at: SAMPLED_AT,
                },
              ],
            }),
          ],
        }}
        nowMs={1794000000000}
        open
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("未知（未采集）")).toBeTruthy();
  });

  it("offers no control for a shared service and no model mutation at all", () => {
    render(
      <SystemControlPanel
        health={health}
        nowMs={1794000000000}
        open
        onClose={vi.fn()}
        actions={{ onCheckService: vi.fn(), onCheckDependencies: vi.fn() }}
      />,
    );
    const buttons = screen.getAllByRole("button").map((button) => button.textContent);
    expect(buttons).not.toContain("按需加载");
    expect(buttons).not.toContain("预热");
    expect(buttons).not.toContain("卸载");
    expect(buttons.filter((label) => label === "检查就绪状态")).toHaveLength(1);
  });
});

describe("the native sync indicator", () => {
  const base: Context = {
    project_id: "project-1",
    origin: "created",
    project_revision: 3,
    control_revision: 1,
    snapshot_id: "snapshot-3",
    source_digest: "a".repeat(64),
    workflow_revision: 2,
    selection_version: 1,
    current_selection: null,
    active_jobs: [],
    artifacts: [],
    capabilities: [],
    next_actions: [],
    active_run: null,
    native_ack: null,
    native_sync: "pending",
  };

  const ack = {
    project_id: "project-1",
    bridge_session_id: "session-1",
    instance_generation: 1,
    loaded_project_revision: 3,
    loaded_snapshot_id: "snapshot-3",
    source_digest: "a".repeat(64),
    selection_version: 1,
    observed_at: new Date(1794000000000).toISOString(),
  };

  it("does not claim the editor is loaded before the acknowledgement arrives", () => {
    expect(nativeSyncState(base).state).toBe("pending");
  });

  it("does not claim the editor is loaded when the acknowledgement is from another revision", () => {
    const state = nativeSyncState({
      ...base,
      native_sync: "loaded",
      native_ack: { ...ack, loaded_project_revision: 2 },
    });
    expect(state.state).toBe("unknown");
  });

  it("does not claim the editor is loaded when the selection does not match", () => {
    const state = nativeSyncState({
      ...base,
      native_sync: "loaded",
      native_ack: { ...ack, selection_version: 9 },
    });
    expect(state.state).toBe("unknown");
  });

  it("does not claim the editor is loaded when the caller only says so", () => {
    const state = nativeSyncState({ ...base, native_sync: "loaded", native_ack: null });
    expect(state.state).toBe("unknown");
  });

  it("rejects another project's acknowledgement with otherwise matching values", () => {
    expect(nativeSyncState({ ...base, native_sync: "loaded", native_ack: { ...ack, project_id: "other-project" } }).state).toBe("unknown");
  });

  it("claims the editor is loaded only when the acknowledgement matches", () => {
    const state = nativeSyncState({ ...base, native_sync: "loaded", native_ack: ack });
    expect(state.state).toBe("loaded");
  });
});
