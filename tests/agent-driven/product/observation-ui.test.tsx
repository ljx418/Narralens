// @vitest-environment happy-dom
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
import { PreparedTextView } from "../../../src/app/observation/content-views.js";
import { nativeSyncState as nativeSyncStateFromItsOwnModule } from "../../../src/app/observation/NativeSyncIndicator.js";
import { SystemControlPanel } from "../../../src/app/system/SystemControlPanel.js";
import { AgentWorkbenchClient } from "../../../src/app/agent-workbench-client.js";
import { GatewayApiError, type GatewayApiClient } from "../../../src/app/m5/GatewayApiClient.js";
import { M5Panel } from "../../../src/app/m5/M5Panel.js";

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

describe("the review panel's fact separation", () => {
  const decision = {
    decision_id: "decision-1",
    project_id: "project-1",
    run_id: "run-1",
    package_id: "package-1",
    package_version: 1,
    input_digest: PACKAGE.input_digest,
    output_digest: PACKAGE.output_digest,
    quality_digest: PACKAGE.quality_digest,
    choice: "accept_and_adopt" as const,
    principal_id: "operator",
    channel: "trusted_ui" as const,
    recorded_at: "2026-11-11T00:00:00.000Z",
    approval: null,
  };

  it("shows a recorded decision as a decision, and never as an adoption", () => {
    render(<CreativeReviewPanel package={PACKAGE} decision={decision} />);
    expect(screen.getByText(/决定已登记/)).toBeTruthy();
    expect(screen.getByText(/决定已登记/).textContent).toContain("decision-1");
    expect(document.body.textContent).not.toContain("已采用");
  });

  it("keeps the adoption pending when the decision asked for it", () => {
    render(
      <CreativeReviewPanel
        package={PACKAGE}
        decision={decision}
        adoption={{ state: "requested", reason: "决定已登记；实际提交与原生确认尚未取得。" }}
      />,
    );
    expect(screen.getByText(/采用待完成/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("已采用");
  });

  it("shows the real lineage when the package reuses an earlier one", () => {
    render(<CreativeReviewPanel package={{ ...PACKAGE, reuse_of_package_id: "package-0" }} />);
    const lineage = document.querySelector("[data-nl-review-reuse='package-0']");
    expect(lineage).not.toBeNull();
    expect(lineage!.textContent).toContain("package-0");
  });

  it("follows a download only when it is this instance's own controlled reference", () => {
    const withDownload = {
      ...PACKAGE,
      parts: [{ ...PACKAGE.parts[0]!, download_ref: "object-1" }],
    };
    const { unmount } = render(
      <CreativeReviewPanel package={withDownload} controlledMediaBase="/narralens/api/ui/review-media/" />,
    );
    const link = screen.getByRole("link", { name: "下载" }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/narralens/api/ui/review-media/object-1");
    unmount();

    render(<CreativeReviewPanel package={withDownload} />);
    expect(screen.queryByRole("link", { name: "下载" })).toBeNull();
    expect(screen.getByText(/不是本实例的受控引用/)).toBeTruthy();
  });

  it("never turns an address into a reference by taking its tail", () => {
    const withForeignRef = {
      ...PACKAGE,
      parts: [{ ...PACKAGE.parts[0]!, download_ref: "https://elsewhere.example/object-1" }],
    };
    render(
      <CreativeReviewPanel package={withForeignRef} controlledMediaBase="/narralens/api/ui/review-media/" />,
    );
    expect(screen.queryByRole("link", { name: "下载" })).toBeNull();
    expect(screen.getByText(/不是本实例的受控引用/)).toBeTruthy();
  });

  it("disables the decisions while one is in flight", () => {
    render(<CreativeReviewPanel package={PACKAGE} busy onAccept={vi.fn()} onReject={vi.fn()} />);
    expect((screen.getByRole("button", { name: "接受" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "拒绝" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables the decisions when the package is no longer the current one", () => {
    render(<CreativeReviewPanel package={PACKAGE} stale onAccept={vi.fn()} onReject={vi.fn()} />);
    expect((screen.getByRole("button", { name: "接受" }) as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector("[data-nl-review-stale='true']")).not.toBeNull();
  });

  it("disables the decisions of a package the Host has already decided", () => {
    render(
      <CreativeReviewPanel
        package={{ ...PACKAGE, state: "accepted" }}
        onAccept={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect((screen.getByRole("button", { name: "接受" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the five parts of one package together", () => {
    render(
      <CreativeReviewPanel
        package={{
          ...PACKAGE,
          parts: [
            PACKAGE.parts[0]!,
            PACKAGE.parts[1]!,
            PACKAGE.parts[2]!,
            { kind: "shot_summary", artifact_ref: { id: "shots", version: 1, sha256: "d".repeat(64) }, download_ref: null },
            { kind: "rights_quality", artifact_ref: { id: "rights", version: 1, sha256: "e".repeat(64) }, download_ref: null },
          ],
        }}
      />,
    );
    for (const label of ["画面", "旁白", "字幕", "镜头摘要", "来源与质量"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it("calls the prepared content a preparation, never a delivery", () => {
    render(<CreativeReviewPanel package={PACKAGE} />);
    expect(screen.getByText(/准备内容，尚未采用/)).toBeTruthy();
  });
});

describe("the native sync indicator module", () => {
  it("has one implementation, reachable from both paths", () => {
    expect(nativeSyncStateFromItsOwnModule).toBe(nativeSyncState);
    expect(nativeSyncStateFromItsOwnModule(null).state).toBe("unknown");
  });
});

describe("a prepared text product", () => {
  it("shows a subtitle track as text and never as markup", () => {
    render(<PreparedTextView contentType="text/vtt" text={"WEBVTT\n\n00:00.000 --> 00:01.000\n你好"} />);
    const pre = document.querySelector("[data-nl-prepared-text='text']");
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toContain("WEBVTT");
    // No media element and no injected markup.
    expect(document.querySelector("video")).toBeNull();
    expect(document.querySelector("script")).toBeNull();
  });

  it("refuses a product that claims to be HTML", () => {
    render(<PreparedTextView contentType="text/html" text="<script>alert(1)</script>" />);
    expect(document.querySelector("[data-nl-prepared-text='refused']")).not.toBeNull();
    expect(document.body.innerHTML).not.toContain("<script>");
  });

  it("shows a JSON product as formatted text", () => {
    render(<PreparedTextView contentType="application/json" text='{"a":1}' />);
    expect(document.querySelector("[data-nl-prepared-text='json']")!.textContent).toContain('"a": 1');
  });
});

/* -------------------------------------------------------------------------------------- */
/* The M5 panel, mounted: the observation and the one prepared-preview slot                    */
/* -------------------------------------------------------------------------------------- */

const MEDIA_BYTES = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const MEDIA_SHA = createHash("sha256").update(Buffer.from(MEDIA_BYTES)).digest("hex");

const MEDIA_PART = {
  kind: "preview" as const,
  artifact_ref: { id: "video", version: 1, sha256: "d".repeat(64) },
  download_ref: "object-video",
};

const MEDIA_PACKAGE: ReviewPackage = {
  ...PACKAGE,
  parts: [
    MEDIA_PART,
    { kind: "narration", artifact_ref: { id: "audio", version: 1, sha256: "e".repeat(64) }, download_ref: null },
    { kind: "subtitles", artifact_ref: { id: "subs", version: 1, sha256: "f".repeat(64) }, download_ref: null },
    { kind: "shot_summary", artifact_ref: { id: "shots", version: 1, sha256: "1".repeat(64) }, download_ref: null },
    { kind: "rights_quality", artifact_ref: { id: "rights", version: 1, sha256: "2".repeat(64) }, download_ref: null },
  ],
};

const DESCRIPTOR = {
  format: "narralens.review-media-descriptor@1",
  project_id: "project-1",
  run_id: "run-1",
  package_id: "package-1",
  package_version: 1,
  package_digest: "6".repeat(64),
  part: MEDIA_PART,
  receipt_digest: "7".repeat(64),
  object_id: "object-video",
  content_type: "video/mp4",
  bytes: MEDIA_BYTES.byteLength,
  sha256: MEDIA_SHA,
  timeline: { fps: { num: 30, den: 1 }, frame_count: 900 },
  media_facts: { kind: "video", fps: { num: 30, den: 1 }, frame_count: 900 },
};

const PROJECTION = {
  format: "narralens.created-workbench@1.0",
  project_id: "project-1",
  source_project_id: null,
  migration_id: null,
  origin: "created",
  native_sync: "unknown",
  revision: 3,
  control_revision: 1,
  source_digest: "a".repeat(64),
  active_snapshot_id: "b".repeat(64),
  fps: { num: 30, den: 1 },
  frame_count: 900,
  engine: "openfilm",
  engine_upstream_sha: "c".repeat(40),
  tracks: [{ track_id: "track-1", index: 0, clip_ids: ["clip-1"] }],
  clips: [{
    clip_id: "clip-1", track_id: "track-1", kind: "page", start_frame: 0,
    end_frame_exclusive: 900, source_shot_id: "shot-1", source_label: "第一页",
  }],
  history: [],
  active_locks: [],
  capabilities: [],
  preview: null,
  narration: "unknown",
};

const RUN = {
  project_id: "project-1",
  run_id: "run-1",
  plan_version: 1,
  workflow: {
    template_id: "local-short-film",
    template_version: 1,
    execution_digest: "b70615d5ad4246caac7d0e770022429de5826831b222447e4be7637e4a07ca32",
    stage_ids: ["definition", "sample", "first_chapter", "chapters", "cover", "delivery"],
    capability_ids: ["clip.prepare", "snapshot.render", "qc.inspect", "delivery.package"],
    status: "published",
    composition: "fixed_a",
  },
  scope: {
    project_id: "project-1",
    run_id: "run-1",
    plan_version: 1,
    template_id: "local-short-film",
    template_version: 1,
    execution_digest: "b70615d5ad4246caac7d0e770022429de5826831b222447e4be7637e4a07ca32",
    input_digest: "e".repeat(64),
    content_type: "short_film",
    style_ref: { id: "style-1", version: 1, sha256: "f".repeat(64) },
    capability_fingerprint: "1".repeat(64),
    allowed_actions: ["clip.prepare"],
    allow_paid: false,
    allow_external_write: false,
    allow_runtime_mutation: false,
  },
  scope_digest: "2".repeat(64),
  authorization: null,
  state: "running",
  gates: [
    {
      gate_id: "gate-sample",
      kind: "sample",
      state: "accepted",
      chapter_id: null,
      review_package_id: "package-old",
      decision_id: "decision-old",
      input_digest: "3".repeat(64),
      output_digest: "4".repeat(64),
      reuse_of_gate_id: null,
      reason: "已决定的历史阶段",
    },
    {
      gate_id: "gate-chapter",
      kind: "chapter_pack",
      state: "pending",
      chapter_id: "chapter-1",
      review_package_id: "package-1",
      decision_id: null,
      input_digest: "5".repeat(64),
      output_digest: null,
      reuse_of_gate_id: null,
      reason: "等待操作者决定",
    },
  ],
  checkpoint_id: null,
  observed_at: "2026-11-11T00:00:00.000Z",
  next_actions: [],
};

const CONTEXT_WITH_RUN: Context = {
  project_id: "project-1",
  origin: "created",
  project_revision: 3,
  control_revision: 1,
  snapshot_id: "snapshot-3",
  source_digest: "9".repeat(64),
  workflow_revision: 4,
  selection_version: 2,
  current_selection: null,
  active_jobs: [],
  artifacts: [],
  capabilities: [],
  next_actions: ["review_package"],
  active_run: RUN as never,
  native_ack: null,
  native_sync: "unknown",
};

const LISTING = {
  format: "narralens.local-source-files@1",
  project_id: "project-1",
  items: [{
    candidate_id: "cand-1",
    display_name: "麦克风录音 A",
    kind: "audio",
    bytes: 2048,
    expires_at: "2026-11-11T12:15:00.000Z",
  }],
  cursor_next: null,
};

const INVENTORY = {
  format: "narralens.asset-inventory@1",
  project_id: "project-1",
  items: [],
  cursor_next: null,
};

const DEFAULT_ANSWERS: Record<string, unknown> = {
  "agent.v1/workflow.read": WORKFLOW,
  "agent.v1/context.read": CONTEXT_WITH_RUN,
  "agent.v1/health.read": { services: [], sample_interval_ms: 5000, stale_after_ms: 15000 },
  "agent.v1/review.read": MEDIA_PACKAGE,
  "local-assets.v1/local-source-files.read": LISTING,
  "local-assets.v1/local-assets.read.ui": INVENTORY,
  "workbench.v1/review.part.describe": DESCRIPTOR,
};

interface GatewayStub {
  workbench: () => Promise<unknown>;
  inventory: () => Promise<unknown>;
  reviewMedia: (ref: string, signal?: AbortSignal) => Promise<unknown>;
  uiCall: (surface: string, operation: string, input: unknown, signal?: AbortSignal) => Promise<unknown>;
}

function gatewayStub(overrides: Partial<GatewayStub> = {}): GatewayApiClient {
  const stub: GatewayStub = {
    workbench: async () => PROJECTION,
    inventory: async () => ({ assets: [] }),
    reviewMedia: async () => ({
      bytes: MEDIA_BYTES, etag: `"${MEDIA_SHA}"`, contentType: "video/mp4",
    }),
    uiCall: async (surface, operation) => {
      const key = `${surface}/${operation}`;
      const answer = DEFAULT_ANSWERS[key];
      if (answer === undefined) {
        throw new GatewayApiError(503, "CAPABILITY_UNAVAILABLE", "该能力当前不可用，未伪造可用。");
      }
      return answer;
    },
    ...overrides,
  };
  return stub as unknown as GatewayApiClient;
}

/** The Studio's own report of where it is. */
function reportNative(clipId: string, seconds: number): void {
  fireEvent(window, new CustomEvent("narralens:studio-selection", {
    detail: { refs: [{ kind: "clip", id: clipId }], time: seconds, range: { start: seconds, end: seconds + 1 } },
  }));
}

const studioCommands: unknown[] = [];

beforeEach(() => {
  studioCommands.length = 0;
  (window as unknown as { narralensStudio?: unknown }).narralensStudio = {
    command: (command: unknown) => { studioCommands.push(command); },
  };
  window.location.hash = "#/refine/project-1";
});

afterEach(() => {
  delete (window as unknown as { narralensStudio?: unknown }).narralensStudio;
});

function mountPanel(client: GatewayApiClient = gatewayStub()) {
  return render(<M5Panel client={client} targetProjectId="project-1" />);
}

describe("the M5 panel, mounted", () => {
  it("shows the workflow only after a read has really answered, and says when it failed", async () => {
    const failing = gatewayStub({
      uiCall: async () => { throw new GatewayApiError(503, "CAPABILITY_UNAVAILABLE", "观察入口未就绪。"); },
    });
    mountPanel(failing);
    await waitFor(() => {
      expect(document.querySelector("[data-nl-observation='unavailable']")).not.toBeNull();
    });
    // No workflow bar, no "connected" claim: the read never answered.
    expect(screen.queryByLabelText("当前工作流")).toBeNull();
  });

  it("shows the workflow with the time it was observed", async () => {
    mountPanel();
    await waitFor(() => { expect(document.querySelector(".nl-topbar")).not.toBeNull(); });
    expect(screen.getByText(/最近观察：/)).toBeTruthy();
  });

  it("does not let a late answer of the previous scope land on the new one", async () => {
    let resolveOld: ((value: unknown) => void) | null = null;
    const client = gatewayStub({
      uiCall: async (surface, operation, input) => {
        const project = (input as { project_id?: string } | null)?.project_id;
        if (operation === "workflow.read" && project === "project-1") {
          return await new Promise((resolve) => { resolveOld = resolve; });
        }
        if (operation === "workflow.read") {
          throw new GatewayApiError(503, "CAPABILITY_UNAVAILABLE", "另一个工程的观察不可用。");
        }
        throw new GatewayApiError(503, "CAPABILITY_UNAVAILABLE", "观察入口未就绪。");
      },
    });
    const view = mountPanel(client);
    await act(async () => { await Promise.resolve(); });
    view.rerender(<M5Panel client={client} targetProjectId="project-2" />);
    await waitFor(() => {
      expect(document.querySelector("[data-nl-observation='unavailable']")).not.toBeNull();
    });
    // The old scope's answer arrives late: it must not be shown.
    await act(async () => {
      resolveOld?.(WORKFLOW);
      await Promise.resolve();
    });
    expect(document.querySelector(".nl-topbar")).toBeNull();
    expect(document.querySelector("[data-nl-observation='unavailable']")).not.toBeNull();
  });

  it("refuses to preview a part before the native timeline has been observed", async () => {
    mountPanel();
    const open = (await screen.findAllByRole("button", { name: "在工作台中查看" }))[0]!;
    fireEvent.click(open);
    expect(await screen.findByText(/尚未观测到原生时间线的位置/)).toBeTruthy();
    expect(studioCommands).toHaveLength(0);
  });

  it("stops the editor at the observed frame with the upstream's own seek, and shows the media", async () => {
    mountPanel();
    const open = (await screen.findAllByRole("button", { name: "在工作台中查看" }))[0]!;
    reportNative("clip-1", 12.5);
    fireEvent.click(open);
    await waitFor(() => {
      expect(document.querySelector("[data-nl-prepared-preview='preview']")).not.toBeNull();
    });
    // The upstream has no pause command: its seek pauses, and that is what is used.
    expect(studioCommands).toContainEqual({ type: "seek", time: 12.5 });
    // The element carries no browser transport: it would run a second clock.
    expect(document.querySelector("[data-nl-prepared-preview='preview'] video")!.hasAttribute("controls")).toBe(false);
  });

  it("keeps the preview when the editor reports the same place, and stops it when it really moves", async () => {
    mountPanel();
    const open = (await screen.findAllByRole("button", { name: "在工作台中查看" }))[0]!;
    reportNative("clip-1", 12.5);
    fireEvent.click(open);
    await waitFor(() => {
      expect(document.querySelector("[data-nl-prepared-preview='preview']")).not.toBeNull();
    });
    // A periodic report of the same value is not a user action.
    reportNative("clip-1", 12.5);
    expect(document.querySelector("[data-nl-prepared-preview='preview']")).not.toBeNull();
    // A seek inside the *same* clip is a real move: the preview stops.
    reportNative("clip-1", 20);
    await waitFor(() => {
      expect(document.querySelector("[data-nl-prepared-preview='preview']")).toBeNull();
    });
    expect(screen.getByText(/原生时间线已经移动/)).toBeTruthy();
  });

  it("never reopens the preview from an answer that arrives after the preview was left", async () => {
    let resolveDescribe: ((value: unknown) => void) | null = null;
    const client = gatewayStub({
      uiCall: async (surface, operation) => {
        const key = `${surface}/${operation}`;
        if (key === "workbench.v1/review.part.describe") {
          return await new Promise((resolve) => { resolveDescribe = resolve; });
        }
        const answer = DEFAULT_ANSWERS[key];
        if (answer === undefined) {
          throw new GatewayApiError(503, "CAPABILITY_UNAVAILABLE", "该能力当前不可用，未伪造可用。");
        }
        return answer;
      },
    });
    mountPanel(client);
    const open = (await screen.findAllByRole("button", { name: "在工作台中查看" }))[0]!;
    reportNative("clip-1", 12.5);
    fireEvent.click(open);
    // The editor really moves while the description is still on its way.
    reportNative("clip-1", 30);
    await act(async () => {
      resolveDescribe?.(DESCRIPTOR);
      await Promise.resolve();
    });
    expect(document.querySelector("[data-nl-prepared-preview='preview']")).toBeNull();
  });

  it("releases the object URL when the preview is left and when the panel goes away", async () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const view = mountPanel();
    const open = (await screen.findAllByRole("button", { name: "在工作台中查看" }))[0]!;
    reportNative("clip-1", 12.5);
    fireEvent.click(open);
    await waitFor(() => {
      expect(document.querySelector("[data-nl-prepared-preview='preview']")).not.toBeNull();
    });
    revoke.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "退出预览" }));
    expect(revoke).toHaveBeenCalled();
    expect(document.querySelector("[data-nl-prepared-preview='preview']")).toBeNull();
    view.unmount();
    revoke.mockRestore();
  });

  it("takes the package of the current pending gate, not of the first gate that has one", async () => {
    let asked: string | null = null;
    const client = gatewayStub({
      uiCall: async (surface, operation, input) => {
        const key = `${surface}/${operation}`;
        if (key === "agent.v1/review.read") {
          asked = (input as { package_id: string }).package_id;
          return MEDIA_PACKAGE;
        }
        const answer = DEFAULT_ANSWERS[key];
        if (answer === undefined) {
          throw new GatewayApiError(503, "CAPABILITY_UNAVAILABLE", "该能力当前不可用，未伪造可用。");
        }
        return answer;
      },
    });
    mountPanel(client);
    await screen.findAllByRole("button", { name: "在工作台中查看" });
    expect(asked).toBe("package-1");
  });
});
