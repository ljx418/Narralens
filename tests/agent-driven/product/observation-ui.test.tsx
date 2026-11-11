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
import { CreativeReviewPanel, reviewAdoptionState } from "../../../src/app/observation/CreativeReviewPanel.js";
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
  // The Host publishes the review package as an artifact, and the artifact's own
  // `sha256` is the canonical digest of the package document: this is what the
  // descriptor's `package_digest` is compared with.
  artifacts: [{ id: "package-1", version: 1, sha256: DESCRIPTOR.package_digest }],
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

/* -------------------------------------------------------------------------------------- */
/* Round two: the preview really plays, the fences hold, and the media facts are checked      */
/* -------------------------------------------------------------------------------------- */

const RUN_2 = {
  ...RUN,
  run_id: "run-2",
  gates: [{
    ...RUN.gates[1]!,
    gate_id: "gate-chapter-2",
    review_package_id: "package-2",
  }],
};

const PACKAGE_2: ReviewPackage = { ...MEDIA_PACKAGE, run_id: "run-2", package_id: "package-2" };
const PACKAGE_VERSION_2: ReviewPackage = { ...MEDIA_PACKAGE, version: 2 };

const CONTEXT_RUN_2: Context = {
  ...CONTEXT_WITH_RUN,
  workflow_revision: 5,
  artifacts: [{ id: "package-2", version: 1, sha256: DESCRIPTOR.package_digest }],
  active_run: RUN_2 as never,
};

const CONTEXT_WITHOUT_ARTIFACTS: Context = { ...CONTEXT_WITH_RUN, artifacts: [] };

/** Flush the pending promise chain without waiting for a timer. */
async function flush(times = 12): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

/** The panel, with a descriptor of the test's own choosing. */
function mountWithDescriptor(descriptor: unknown, context: Context = CONTEXT_WITH_RUN) {
  const client = gatewayStub({
    uiCall: async (surface, operation) => {
      const key = `${surface}/${operation}`;
      if (key === "workbench.v1/review.part.describe") return descriptor;
      if (key === "agent.v1/context.read") return context;
      const answer = DEFAULT_ANSWERS[key];
      if (answer === undefined) {
        throw new GatewayApiError(503, "CAPABILITY_UNAVAILABLE", "该能力当前不可用，未伪造可用。");
      }
      return answer;
    },
  });
  return mountPanel(client);
}

/** The package that is on screen right now. */
function shownPackage(): { readonly id: string | null; readonly version: string | null } {
  const section = document.querySelector("[data-nl-review-package]");
  return {
    id: section?.getAttribute("data-nl-review-package") ?? null,
    version: section?.getAttribute("data-nl-review-package-version") ?? null,
  };
}

describe("the prepared preview, playing", () => {
  it("plays the media for real and advances the one clock with it", async () => {
    const play = vi.spyOn(window.HTMLMediaElement.prototype, "play");
    try {
      mountPanel();
      const open = (await screen.findAllByRole("button", { name: "在工作台中查看" }))[0]!;
      reportNative("clip-1", 12.5);
      fireEvent.click(open);
      await waitFor(() => {
        expect(document.querySelector("[data-nl-prepared-preview='preview']")).not.toBeNull();
      });
      const element = document.querySelector("[data-nl-prepared-preview='preview'] video") as HTMLVideoElement;
      const before = Number(document.querySelector("[data-playhead]")!.getAttribute("data-playhead"));
      // The editor was stopped at the frame it had really observed, and the one clock
      // is at that same frame.
      expect(before).toBe(375);

      fireEvent.click(screen.getByRole("button", { name: "播放" }));
      // The element really plays: this is where the narration is heard.
      expect(play).toHaveBeenCalled();
      expect(element.paused).toBe(false);

      // And the one clock advances with it.
      await waitFor(() => {
        const after = Number(document.querySelector("[data-playhead]")!.getAttribute("data-playhead"));
        expect(after).toBeGreaterThan(before);
      });

      // The operator stops it again, and the clock keeps the frame it was on.
      const stopped = Number(document.querySelector("[data-playhead]")!.getAttribute("data-playhead"));
      fireEvent.click(screen.getByRole("button", { name: "暂停" }));
      expect(element.paused).toBe(true);
      expect(Number(document.querySelector("[data-playhead]")!.getAttribute("data-playhead"))).toBe(stopped);
    } finally {
      play.mockRestore();
    }
  });

  it("never plays the native editor on its own", async () => {
    mountPanel();
    const open = (await screen.findAllByRole("button", { name: "在工作台中查看" }))[0]!;
    reportNative("clip-1", 12.5);
    fireEvent.click(open);
    await waitFor(() => {
      expect(document.querySelector("[data-nl-prepared-preview='preview']")).not.toBeNull();
    });
    // The only command the editor was given is the seek that pauses it.
    expect(studioCommands).toEqual([{ type: "seek", time: 12.5 }]);
  });

  it("refuses the preview when this page has no native command entry", async () => {
    delete (window as unknown as { narralensStudio?: unknown }).narralensStudio;
    mountPanel();
    const open = (await screen.findAllByRole("button", { name: "在工作台中查看" }))[0]!;
    reportNative("clip-1", 12.5);
    fireEvent.click(open);
    expect(await screen.findByText(/没有原生命令入口/)).toBeTruthy();
    expect(document.querySelector("[data-nl-prepared-preview='preview']")).toBeNull();
  });

  it("abandons a preview that was being read when the operator moved the editor, and never rewinds it", async () => {
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
    // The operator moves the editor while the description is still on its way.
    reportNative("clip-1", 30);
    await act(async () => {
      resolveDescribe?.(DESCRIPTOR);
      await Promise.resolve();
    });
    expect(document.querySelector("[data-nl-prepared-preview='preview']")).toBeNull();
    // The editor was not rewound to the position the read began at.
    expect(studioCommands).not.toContainEqual({ type: "seek", time: 12.5 });
  });
});

describe("the review read, fenced", () => {
  it("does not let the late answer of a previous run land on the new run", async () => {
    vi.useFakeTimers();
    try {
      let currentContext: Context = CONTEXT_WITH_RUN;
      let resolveOld: ((value: unknown) => void) | null = null;
      const asked: string[] = [];
      const client = gatewayStub({
        uiCall: async (surface, operation, input) => {
          const key = `${surface}/${operation}`;
          if (key === "agent.v1/context.read") return currentContext;
          if (key === "agent.v1/review.read") {
            const packageId = (input as { package_id: string }).package_id;
            asked.push(packageId);
            if (packageId === "package-1") {
              return await new Promise((resolve) => { resolveOld = resolve; });
            }
            return PACKAGE_2;
          }
          const answer = DEFAULT_ANSWERS[key];
          if (answer === undefined) {
            throw new GatewayApiError(503, "CAPABILITY_UNAVAILABLE", "该能力当前不可用，未伪造可用。");
          }
          return answer;
        },
      });
      mountPanel(client);
      await flush();
      expect(asked).toContain("package-1");

      // The next observation names another run: its package is read.
      currentContext = CONTEXT_RUN_2;
      await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
      await flush();
      expect(asked).toContain("package-2");
      expect(shownPackage().id).toBe("package-2");

      // The late answer of the previous run arrives: it must not land.
      await act(async () => {
        resolveOld?.(MEDIA_PACKAGE);
        await Promise.resolve();
      });
      await flush();
      expect(shownPackage().id).toBe("package-2");
    } finally {
      vi.useRealTimers();
    }
  });

  it("never starts a second observation while the first one is still on its way", async () => {
    vi.useFakeTimers();
    try {
      let resolveWorkflow: ((value: unknown) => void) | null = null;
      let workflowReads = 0;
      const client = gatewayStub({
        uiCall: async (surface, operation) => {
          const key = `${surface}/${operation}`;
          if (key === "agent.v1/workflow.read") {
            workflowReads += 1;
            if (workflowReads === 1) {
              return await new Promise((resolve) => { resolveWorkflow = resolve; });
            }
            return WORKFLOW;
          }
          const answer = DEFAULT_ANSWERS[key];
          if (answer === undefined) {
            throw new GatewayApiError(503, "CAPABILITY_UNAVAILABLE", "该能力当前不可用，未伪造可用。");
          }
          return answer;
        },
      });
      mountPanel(client);
      await flush();
      expect(workflowReads).toBe(1);
      // Polls that arrive while the first read is on its way do not start a second one.
      await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
      await flush();
      expect(workflowReads).toBe(1);
      // The first read answers, and the next poll reads again.
      await act(async () => {
        resolveWorkflow?.(WORKFLOW);
        await Promise.resolve();
      });
      await flush();
      await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
      await flush();
      expect(workflowReads).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads an updated package of the same id again instead of suppressing it", async () => {
    vi.useFakeTimers();
    try {
      let currentContext: Context = CONTEXT_WITH_RUN;
      const asked: string[] = [];
      const client = gatewayStub({
        uiCall: async (surface, operation, input) => {
          const key = `${surface}/${operation}`;
          if (key === "agent.v1/context.read") return currentContext;
          if (key === "agent.v1/review.read") {
            asked.push((input as { package_id: string }).package_id);
            return asked.length === 1 ? MEDIA_PACKAGE : PACKAGE_VERSION_2;
          }
          const answer = DEFAULT_ANSWERS[key];
          if (answer === undefined) {
            throw new GatewayApiError(503, "CAPABILITY_UNAVAILABLE", "该能力当前不可用，未伪造可用。");
          }
          return answer;
        },
      });
      mountPanel(client);
      await flush();
      expect(asked).toEqual(["package-1"]);
      expect(shownPackage().version).toBe("1");

      // The workflow moved on: the same package was published again.
      currentContext = { ...CONTEXT_WITH_RUN, workflow_revision: 5 };
      await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
      await flush();
      expect(asked).toEqual(["package-1", "package-1"]);
      expect(shownPackage().version).toBe("2");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not keep the recorded decision when another run's package arrives", async () => {
    vi.useFakeTimers();
    try {
      let currentContext: Context = CONTEXT_WITH_RUN;
      const client = gatewayStub({
        uiCall: async (surface, operation, input) => {
          const key = `${surface}/${operation}`;
          if (key === "agent.v1/context.read") return currentContext;
          if (key === "agent.v1/review.read") {
            const packageId = (input as { package_id: string }).package_id;
            return packageId === "package-1" ? MEDIA_PACKAGE : PACKAGE_2;
          }
          if (key === "agent.v1/review.decide") {
            return {
              decision_id: "decision-1",
              project_id: "project-1",
              run_id: "run-1",
              package_id: "package-1",
              package_version: 1,
              input_digest: MEDIA_PACKAGE.input_digest,
              output_digest: MEDIA_PACKAGE.output_digest,
              quality_digest: MEDIA_PACKAGE.quality_digest,
              choice: "accept",
              principal_id: "operator",
              channel: "trusted_ui",
              recorded_at: "2026-11-11T00:00:00.000Z",
              approval: null,
            };
          }
          const answer = DEFAULT_ANSWERS[key];
          if (answer === undefined) {
            throw new GatewayApiError(503, "CAPABILITY_UNAVAILABLE", "该能力当前不可用，未伪造可用。");
          }
          return answer;
        },
      });
      mountPanel(client);
      await flush();
      fireEvent.click(screen.getByRole("button", { name: "接受" }));
      await flush();
      expect(document.body.textContent).toContain("决定已登记");

      // The run changes: the decision belonged to the previous run's package.
      currentContext = CONTEXT_RUN_2;
      await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
      await flush();
      expect(shownPackage().id).toBe("package-2");
      expect(document.body.textContent).not.toContain("决定已登记");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the prepared media, checked", () => {
  it("refuses a descriptor whose time base is not the clock's", async () => {
    mountWithDescriptor({
      ...DESCRIPTOR,
      timeline: { fps: { num: 25, den: 1 }, frame_count: 900 },
      media_facts: { kind: "video", fps: { num: 25, den: 1 }, frame_count: 900 },
    });
    const open = (await screen.findAllByRole("button", { name: "在工作台中查看" }))[0]!;
    reportNative("clip-1", 12.5);
    fireEvent.click(open);
    expect(await screen.findByText(/时间基帧率/)).toBeTruthy();
    expect(document.querySelector("[data-nl-prepared-preview='preview']")).toBeNull();
  });

  it("refuses a part whose media facts are of another kind", async () => {
    mountWithDescriptor({
      ...DESCRIPTOR,
      content_type: "audio/wav",
      media_facts: { kind: "audio", sample_rate: 48000, sample_count: 48000, channels: 1 },
    });
    const open = (await screen.findAllByRole("button", { name: "在工作台中查看" }))[0]!;
    reportNative("clip-1", 12.5);
    fireEvent.click(open);
    expect(await screen.findByText(/媒体事实与它在内容包里的种类不一致/)).toBeTruthy();
    expect(document.querySelector("[data-nl-prepared-preview='preview']")).toBeNull();
  });

  it("refuses a content type that this kind does not allow", async () => {
    mountWithDescriptor({ ...DESCRIPTOR, content_type: "application/json" });
    const open = (await screen.findAllByRole("button", { name: "在工作台中查看" }))[0]!;
    reportNative("clip-1", 12.5);
    fireEvent.click(open);
    expect(await screen.findByText(/不是这一类内容允许的类型/)).toBeTruthy();
    expect(document.querySelector("[data-nl-prepared-preview='preview']")).toBeNull();
  });

  it("fails closed when the context does not carry the package's artifact reference", async () => {
    mountWithDescriptor(DESCRIPTOR, CONTEXT_WITHOUT_ARTIFACTS);
    const open = (await screen.findAllByRole("button", { name: "在工作台中查看" }))[0]!;
    reportNative("clip-1", 12.5);
    fireEvent.click(open);
    expect(await screen.findByText(/当前上下文没有它的产物引用/)).toBeTruthy();
    expect(document.querySelector("[data-nl-prepared-preview='preview']")).toBeNull();
  });

  it("refuses a descriptor whose package digest is not the package's own", async () => {
    mountWithDescriptor({ ...DESCRIPTOR, package_digest: "0".repeat(64) });
    const open = (await screen.findAllByRole("button", { name: "在工作台中查看" }))[0]!;
    reportNative("clip-1", 12.5);
    fireEvent.click(open);
    expect(await screen.findByText(/内容包摘要与当前内容包不符/)).toBeTruthy();
    expect(document.querySelector("[data-nl-prepared-preview='preview']")).toBeNull();
  });
});

describe("the controlled listings, page by page", () => {
  it("reads the next page with the Host's own cursor and says what is still missing", async () => {
    const asked: Array<string | undefined> = [];
    const client = gatewayStub({
      uiCall: async (surface, operation, input) => {
        const key = `${surface}/${operation}`;
        if (key === "local-assets.v1/local-source-files.read") {
          const cursor = (input as { cursor?: string }).cursor;
          asked.push(cursor);
          return cursor === undefined
            ? { ...LISTING, cursor_next: "cursor-2" }
            : { ...LISTING, items: [{ ...LISTING.items[0]!, candidate_id: "cand-2", display_name: "屏幕录制 B" }], cursor_next: null };
        }
        const answer = DEFAULT_ANSWERS[key];
        if (answer === undefined) {
          throw new GatewayApiError(503, "CAPABILITY_UNAVAILABLE", "该能力当前不可用，未伪造可用。");
        }
        return answer;
      },
    });
    mountPanel(client);
    await waitFor(() => { expect(asked).toHaveLength(1); });
    // The first page says that it is not the whole listing.
    expect(screen.getByText(/当前只显示 Host 返回的第 1 页：还有更多候选没有显示/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "加载更多候选" }));
    await waitFor(() => { expect(asked).toEqual([undefined, "cursor-2"]); });
    await waitFor(() => {
      expect(screen.getByRole("radio", { name: /屏幕录制 B/ })).toBeTruthy();
    });
    // The whole listing is on screen now, and it says so.
    expect(screen.queryByText(/还有更多候选没有显示/)).toBeNull();
  });

  it("starts again at the first page when the cursor has expired", async () => {
    const asked: Array<string | undefined> = [];
    const client = gatewayStub({
      uiCall: async (surface, operation, input) => {
        const key = `${surface}/${operation}`;
        if (key === "local-assets.v1/local-source-files.read") {
          const cursor = (input as { cursor?: string }).cursor;
          asked.push(cursor);
          if (cursor !== undefined) {
            throw new GatewayApiError(410, "CURSOR_EXPIRED", "游标已过期。");
          }
          return { ...LISTING, cursor_next: "cursor-2" };
        }
        const answer = DEFAULT_ANSWERS[key];
        if (answer === undefined) {
          throw new GatewayApiError(503, "CAPABILITY_UNAVAILABLE", "该能力当前不可用，未伪造可用。");
        }
        return answer;
      },
    });
    mountPanel(client);
    await waitFor(() => { expect(asked).toHaveLength(1); });
    fireEvent.click(screen.getByRole("button", { name: "加载更多候选" }));
    // The stale cursor is refused, and the listing starts again at the first page.
    await waitFor(() => { expect(asked).toEqual([undefined, "cursor-2", undefined]); });
    expect(screen.getByRole("alert").textContent).toContain("已过期");
  });
});

describe("the controlled listings, at the edges", () => {
  it("starts the inventory again at the first page when its cursor has expired", async () => {
    const asked: Array<string | undefined> = [];
    const client = gatewayStub({
      uiCall: async (surface, operation, input) => {
        const key = `${surface}/${operation}`;
        if (key === "local-assets.v1/local-assets.read.ui") {
          const cursor = (input as { cursor?: string }).cursor;
          asked.push(cursor);
          if (cursor !== undefined) {
            throw new GatewayApiError(410, "CURSOR_EXPIRED", "游标已过期。");
          }
          return { ...INVENTORY, cursor_next: "cursor-2" };
        }
        const answer = DEFAULT_ANSWERS[key];
        if (answer === undefined) {
          throw new GatewayApiError(503, "CAPABILITY_UNAVAILABLE", "该能力当前不可用，未伪造可用。");
        }
        return answer;
      },
    });
    mountPanel(client);
    await waitFor(() => { expect(asked).toHaveLength(1); });
    fireEvent.click(screen.getByRole("button", { name: "加载更多已登记素材" }));
    await waitFor(() => { expect(asked).toEqual([undefined, "cursor-2", undefined]); });
    expect(screen.getByRole("alert").textContent).toContain("已过期");
  });

  it("discards the cursors and the pages when the project changes", async () => {
    const asked: Array<{ project: string; cursor?: string | undefined }> = [];
    const client = gatewayStub({
      uiCall: async (surface, operation, input) => {
        const key = `${surface}/${operation}`;
        if (key === "local-assets.v1/local-source-files.read") {
          const request = input as { project_id: string; cursor?: string };
          asked.push({ project: request.project_id, cursor: request.cursor });
          return request.project_id === "project-1"
            ? { ...LISTING, cursor_next: "cursor-2" }
            : { ...LISTING, project_id: "project-2", items: [], cursor_next: null };
        }
        const answer = DEFAULT_ANSWERS[key];
        if (answer === undefined) {
          throw new GatewayApiError(503, "CAPABILITY_UNAVAILABLE", "该能力当前不可用，未伪造可用。");
        }
        return answer;
      },
    });
    const view = mountPanel(client);
    await waitFor(() => { expect(asked.length).toBeGreaterThan(0); });
    expect(asked[0]!.project).toBe("project-1");

    view.rerender(<M5Panel client={client} targetProjectId="project-2" />);
    await waitFor(() => {
      expect(asked.some((entry) => entry.project === "project-2")).toBe(true);
    });
    // The other project's cursor was not carried over.
    expect(asked.filter((entry) => entry.project === "project-2")
      .every((entry) => entry.cursor === undefined)).toBe(true);
  });

  it("does not let a late page of the previous project land on the new one", async () => {
    let resolveOld: ((value: unknown) => void) | null = null;
    const client = gatewayStub({
      uiCall: async (surface, operation, input) => {
        const key = `${surface}/${operation}`;
        if (key === "local-assets.v1/local-source-files.read") {
          const request = input as { project_id: string; cursor?: string };
          if (request.project_id === "project-1" && request.cursor !== undefined) {
            return await new Promise((resolve) => { resolveOld = resolve; });
          }
          return request.project_id === "project-1"
            ? { ...LISTING, cursor_next: "cursor-2" }
            : { ...LISTING, project_id: "project-2", items: [], cursor_next: null };
        }
        const answer = DEFAULT_ANSWERS[key];
        if (answer === undefined) {
          throw new GatewayApiError(503, "CAPABILITY_UNAVAILABLE", "该能力当前不可用，未伪造可用。");
        }
        return answer;
      },
    });
    const view = mountPanel(client);
    await waitFor(() => {
      expect(screen.getByRole("radio", { name: /麦克风录音 A/ })).toBeTruthy();
    });
    // The second page of the first project is on its way…
    fireEvent.click(screen.getByRole("button", { name: "加载更多候选" }));
    // …and the project changes while it is.
    view.rerender(<M5Panel client={client} targetProjectId="project-2" />);
    await waitFor(() => {
      expect(screen.queryByRole("radio", { name: /麦克风录音 A/ })).toBeNull();
    });
    // The late page arrives: it must not land on the new project.
    await act(async () => {
      resolveOld?.({ ...LISTING, items: [{ ...LISTING.items[0]!, candidate_id: "cand-old" }], cursor_next: null });
      await Promise.resolve();
    });
    expect(screen.queryByRole("radio", { name: /麦克风录音 A/ })).toBeNull();
    expect(screen.queryByRole("radio", { name: /cand-old/ })).toBeNull();
  });
});

/**
 * The four facts stay apart: the decision, the adoption, the commit and the native
 * acknowledgement.
 *
 * These cases are pure: no Host, no listener, no browser, no fixture.
 */
describe("the review adoption state", () => {
  const digest = "a".repeat(64);
  const otherDigest = "b".repeat(64);
  const decisionOf = (choice: string, id = "dec-1") => ({
    decision_id: id,
    project_id: "project-1",
    run_id: "run-1",
    package_id: "pkg-1",
    package_version: 1,
    input_digest: digest,
    output_digest: digest,
    quality_digest: digest,
    choice,
    principal_id: "principal-1",
    channel: "trusted_ui",
    recorded_at: "2026-11-12T00:00:00.000Z",
    approval: null,
  }) as never;
  const facts = (revision: number, snapshot = "snap-1", source = digest) => ({
    project_revision: revision, snapshot_id: snapshot, source_digest: source,
  });

  it("says that nothing was requested when there is no decision", () => {
    expect(reviewAdoptionState({ decision: null, atDecision: null, current: null }).state).toBe("not_requested");
  });

  it("says that nothing was requested when the decision did not ask for an adoption", () => {
    const state = reviewAdoptionState({
      decision: decisionOf("accept"),
      atDecision: facts(3),
      current: facts(3),
    });
    expect(state.state).toBe("not_requested");
  });

  it("keeps the adoption pending while the project's own revision has not moved", () => {
    const state = reviewAdoptionState({
      decision: decisionOf("accept_and_adopt"),
      atDecision: facts(3),
      current: facts(3),
    });
    expect(state.state).toBe("requested");
  });

  it("does not credit this adoption with a commit that moved the revision for another reason", () => {
    // The revision advanced by one, but nothing binds that commit to this decision: an
    // unrelated native edit, another adoption, or anything else that commits.
    const state = reviewAdoptionState({
      decision: decisionOf("accept_and_adopt"),
      atDecision: facts(3),
      current: facts(4, "snap-2", otherDigest),
    });
    expect(state.state).toBe("requested");
    expect(state.reason).toContain("没有与这次决定绑定的提交记录");
  });

  it("does not credit this adoption with a commit that is bound to another decision", () => {
    const state = reviewAdoptionState({
      decision: decisionOf("accept_and_adopt"),
      atDecision: facts(3),
      current: facts(4, "snap-2", otherDigest),
      committed: {
        decision: decisionOf("accept_and_adopt", "dec-other"),
        project_revision: 4,
        snapshot_id: "snap-2",
        source_digest: otherDigest,
      },
    });
    expect(state.state).toBe("unknown");
    expect(state.reason).toContain("另一个决定");
  });

  it("does not credit this adoption with a commit that names the wrong target", () => {
    // The commit is bound to this decision, but it is not the project's current source.
    const state = reviewAdoptionState({
      decision: decisionOf("accept_and_adopt"),
      atDecision: facts(3),
      current: facts(4, "snap-2", otherDigest),
      committed: {
        decision: decisionOf("accept_and_adopt"),
        project_revision: 4,
        snapshot_id: "snap-other",
        source_digest: otherDigest,
      },
    });
    expect(state.state).toBe("unknown");
    expect(state.reason).toContain("快照或内容摘要");
  });

  it("registers the adoption when a commit is bound to this decision and is the current one", () => {
    const state = reviewAdoptionState({
      decision: decisionOf("accept_and_adopt"),
      atDecision: facts(3),
      current: facts(4, "snap-2", otherDigest),
      committed: {
        decision: decisionOf("accept_and_adopt"),
        project_revision: 4,
        snapshot_id: "snap-2",
        source_digest: otherDigest,
      },
    });
    expect(state.state).toBe("registered");
  });

  it("says unknown rather than guessing when the facts cannot be lined up", () => {
    expect(reviewAdoptionState({
      decision: decisionOf("accept_and_adopt"),
      atDecision: null,
      current: facts(4),
    }).state).toBe("unknown");
    expect(reviewAdoptionState({
      decision: decisionOf("accept_and_adopt"),
      atDecision: facts(3),
      current: null,
    }).state).toBe("unknown");
  });

  it("never claims a native load from the adoption", () => {
    const state = reviewAdoptionState({
      decision: decisionOf("accept_and_adopt"),
      atDecision: facts(3),
      current: facts(4, "snap-2", otherDigest),
      committed: {
        decision: decisionOf("accept_and_adopt"),
        project_revision: 4,
        snapshot_id: "snap-2",
        source_digest: otherDigest,
      },
    });
    expect(state.reason).toContain("提交与原生确认仍是两件事");
  });
});
