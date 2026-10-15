// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";
import { NarralensApp } from "../../src/app/director/NarralensApp.js";
import { HostApiClient, HostApiError } from "../../src/app/director/api/HostApiClient.js";
import type { AssetImportMetadata, AssetImportResponse, AssetInventoryResponse, EditRequest, EditResponse, JobEvent, JobResponse, ProjectResponse, ProposalComparison, ProposalComparisonRequest } from "../../src/contracts/types.js";

const project: ProjectResponse = { project_id: "d1-30s", revision: 2, frame_rate: 30, frame_count: 900,
  shots: [{ shot_id: "shot-001", start_frame: 0, end_frame_exclusive: 300 }], preview: { kind: "hypit-studio", url: "http://127.0.0.1:4174/" },
  visual_assets: { "shot-001": "asset_visual_baseline" }, available_visual_assets: [
    { asset_id: "asset_visual_baseline", duration_frames: 300, source_label: "本地基线素材", license_label: "项目自生成" },
    { asset_id: "asset_visual_d4_alt", duration_frames: 300, source_label: "本地替代素材", license_label: "项目自生成" },
  ] };
const comparison: ProposalComparison = { schema_version: "1.0", kind: "narralens.proposal_comparison", comparison_id: "comparison_ui", project_id: "d1-30s", base_revision: 2,
  selection: project.shots[0]!, intent_sha256: "a".repeat(64), preserve: ["narration", "duration"], proposal_count: 3, created_at: new Date().toISOString(),
  generation_audit: { stdout_sha256: "b".repeat(64), model_names: ["test-model"], total_cost_usd: 0.02, duration_ms: 100, num_turns: 1, service_tier: "test" },
  proposals: [1, 2, 3].map((index) => ({ proposal_id: `proposal_ui_${index}`, title: index === 1 ? "递进三镜提案" : `备选提案 ${index}`,
    strategy: { kind: (["chronology", "contrast", "evidence-led"] as const)[index - 1]!, rationale: `方案 ${index} 理由` }, summary: `方案 ${index} 摘要`,
    segments: [{ segment_id: `s${index}`, duration_frames: 300, role: "anchor" as const, intent: `方案 ${index} 视觉意图`, asset_requirement_ids: [] }],
    assets_needed: [], source_refs: [], materialization_cost: { status: "unknown" as const, currency: null, amount: null }, requires_materialization: true as const, renderable: false as const })) };
const inventory: AssetInventoryResponse = {
  format: "narralens.asset-inventory@1.0", manifest_format: "narralens.asset-manifest@2", manifest_sha256: "c".repeat(64),
  assets: [
    { asset_id: "asset_visual_baseline", sha256: "a".repeat(64), media_type: "video/mp4", duration_frames: 300,
      source: { kind: "generated", label: "本地基线素材" }, license: { status: "cleared", label: "项目自生成", commercial_use: true },
      availability: "available", eligible: true, blocking_reasons: [] },
    { asset_id: "asset_restricted", sha256: "b".repeat(64), media_type: "video/mp4", duration_frames: 300,
      source: { kind: "licensed", label: "审片参考素材" }, license: { status: "restricted", label: "仅内部审片", commercial_use: false },
      availability: "available", eligible: false, blocking_reasons: ["LICENSE_NOT_CLEARED", "COMMERCIAL_USE_NOT_ALLOWED"] },
    { asset_id: "asset_unavailable", sha256: "f".repeat(64), media_type: "video/mp4", duration_frames: 300,
      source: { kind: "generated", label: "待恢复生成素材" }, license: { status: "unknown", label: "许可待确认", commercial_use: false },
      availability: "unavailable", eligible: false, blocking_reasons: ["LICENSE_NOT_CLEARED", "COMMERCIAL_USE_NOT_ALLOWED", "BYTES_UNAVAILABLE"] },
  ],
};

class FakeClient extends HostApiClient {
  request: ProposalComparisonRequest | undefined;
  constructor(private readonly fail = false) { super("http://unused"); }
  override async start(): Promise<void> {}
  override async project(): Promise<ProjectResponse> { return project; }
  override async assets(): Promise<AssetInventoryResponse> { return inventory; }
  override async createProposal(_id: string, _request: ProposalComparisonRequest): Promise<JobResponse> {
    this.request = _request;
    if (this.fail) throw new HostApiError(529, "PROVIDER_OVERLOADED", "Provider is overloaded");
    return { job_id: "job_ui", project_id: "d1-30s", state: "queued", created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  }
  override async events(_jobId: string, _after: number): Promise<JobEvent[]> { return [{ event_id: 1, job_id: "job_ui", type: "succeeded", comparison_id: "comparison_ui", at: new Date().toISOString() }]; }
  override async comparison(_id: string): Promise<ProposalComparison> { return comparison; }
}

class RaceClient extends FakeClient {
  createCount = 0;
  #resolveA: ((events: JobEvent[]) => void) | undefined;
  override async createProposal(_id: string, request: ProposalComparisonRequest): Promise<JobResponse> {
    this.request = request; this.createCount += 1; const now = new Date().toISOString();
    return { job_id: this.createCount === 1 ? "job_A" : "job_B", project_id: "d1-30s", state: "queued", created_at: now, updated_at: now };
  }
  override async events(jobId: string, _after: number): Promise<JobEvent[]> {
    if (jobId === "job_A") return await new Promise((resolveEvents) => { this.#resolveA = resolveEvents; });
    return [{ event_id: 1, job_id: "job_B", type: "succeeded", comparison_id: "comparison_B", at: new Date().toISOString() }];
  }
  override async cancel(): Promise<void> {
    this.#resolveA?.([{ event_id: 1, job_id: "job_A", type: "cancelled", at: new Date().toISOString() },
      { event_id: 2, job_id: "job_A", type: "completed_after_cancel", comparison_id: "comparison_A", at: new Date().toISOString() }]);
  }
  override async comparison(id: string): Promise<ProposalComparison> {
    return { ...comparison, comparison_id: id, proposals: comparison.proposals.map((item, index) => ({ ...item, title: `${id === "comparison_B" ? "B" : "A"}方案 ${index + 1}` })) };
  }
}

class PendingClient extends FakeClient {
  #resolveEvents: ((events: JobEvent[]) => void) | undefined;
  override async events(_jobId: string, _after: number): Promise<JobEvent[]> { return await new Promise((resolveEvents) => { this.#resolveEvents = resolveEvents; }); }
  override async cancel(): Promise<void> { this.#resolveEvents?.([{ event_id: 2, job_id: "job_ui", type: "cancelled", at: new Date().toISOString() }]); }
}

class MediaClient extends FakeClient {
  editRequest: EditRequest | undefined;
  override async edit(_id: string, request: EditRequest): Promise<EditResponse> {
    this.editRequest = request;
    return { transaction_id: "txn_media_ui", project_id: "d1-30s", previous_revision: 2, new_revision: 3,
      operation: request.operations[0], status: "committed", changed: true, source_sha256: "a".repeat(64), run_sha256: "b".repeat(64) };
  }
}

class AssetClient extends FakeClient {
  importedMetadata: AssetImportMetadata | undefined;
  importedFile: File | undefined;
  assetCalls = 0;
  override async assets(): Promise<AssetInventoryResponse> {
    this.assetCalls += 1;
    if (this.assetCalls === 1) return inventory;
    return { ...inventory, assets: [...inventory.assets, {
      asset_id: "asset_imported", sha256: "d".repeat(64), media_type: "video/mp4", duration_frames: 300,
      source: { kind: "owned", label: "我的实拍" }, license: { status: "cleared", label: "自有版权", commercial_use: true },
      availability: "available", eligible: true, blocking_reasons: [],
    }] };
  }
  override async importAsset(_id: string, file: File, value: AssetImportMetadata,
    options: { signal?: AbortSignal; onUploadComplete?: () => void } = {}): Promise<AssetImportResponse> {
    this.importedFile = file; this.importedMetadata = value; options.onUploadComplete?.();
    return { format: "narralens.asset-import-response@1.0", asset_id: "asset_imported",
      manifest_format: "narralens.asset-manifest@2", manifest_sha256: "e".repeat(64), created: true, migrated_from_v1: false };
  }
}

class CancellableAssetClient extends FakeClient {
  override async importAsset(_id: string, _file: File, _value: AssetImportMetadata,
    options: { signal?: AbortSignal; onUploadComplete?: () => void } = {}): Promise<AssetImportResponse> {
    return await new Promise((_resolve, reject) => options.signal?.addEventListener("abort",
      () => reject(new DOMException("cancelled", "AbortError")), { once: true }));
  }
}

afterEach(cleanup);

describe("D2 Director UI", () => {
  it("supports keyboard proposal flow and displays the validated bundle", async () => {
    const user = userEvent.setup();
    render(<NarralensApp client={new FakeClient()} />);
    expect(await screen.findByText(/900 帧/)).toBeTruthy();
    const submit = screen.getByRole("button", { name: "生成并比较提案" });
    submit.focus();
    await user.keyboard("{Enter}");
    expect((await screen.findAllByText("递进三镜提案", {}, { timeout: 1500 })).length).toBeGreaterThan(0);
    expect(screen.getByText(/仅比较，不写入 Source/)).toBeTruthy();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    await user.type(screen.getByLabelText("导演意图"), "补充");
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it("surfaces provider overload with a manual retry instruction", async () => {
    const user = userEvent.setup();
    render(<NarralensApp client={new FakeClient(true)} />);
    await screen.findByText(/900 帧/);
    await user.click(screen.getByRole("button", { name: "生成并比较提案" }));
    await waitFor(() => expect(screen.getByText(/PROVIDER_OVERLOADED/)).toBeTruthy());
    expect(screen.getByText(/稍后手动重试/)).toBeTruthy();
  });

  it("shows queued work and exposes a keyboard-operable cancel path", async () => {
    const user = userEvent.setup();
    render(<NarralensApp client={new PendingClient()} />);
    await screen.findByText(/900 帧/);
    await user.click(screen.getByRole("button", { name: "生成并比较提案" }));
    expect((await screen.findAllByText("已排队")).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(await screen.findByText("已取消")).toBeTruthy();
  });

  it("shows registered source and license details before a typed media replacement", async () => {
    const user = userEvent.setup();
    const client = new MediaClient();
    render(<NarralensApp client={client} />);
    expect(await screen.findByText(/本地替代素材/)).toBeTruthy();
    expect(screen.getAllByText(/许可：项目自生成/).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("radio", { name: /asset_visual_d4_alt/ }));
    await user.click(screen.getByRole("button", { name: "确认替换素材" }));
    expect(await screen.findByText(/已提交 r3/)).toBeTruthy();
    expect(client.editRequest?.operations[0]).toEqual({ op: "replace_visual_asset", shot_id: "shot-001", asset_id: "asset_visual_d4_alt" });
    expect(client.editRequest?.preserve).toEqual(["narration", "duration"]);
  });

  it("maps Chinese controls to the bounded D4.1 request without a fake visual preserve", async () => {
    const user = userEvent.setup(); const client = new FakeClient(); render(<NarralensApp client={client} />); await screen.findByText(/900 帧/);
    expect(screen.queryByRole("button", { name: /原画面/ })).toBeNull();
    await user.selectOptions(screen.getByLabelText("比较方案数"), "4"); await user.click(screen.getByRole("button", { name: "生成并比较提案" }));
    expect(client.request).toMatchObject({ proposal_count: 4, preserve: ["narration", "duration"] });
  });

  it("prevents a cancelled job's late completion from replacing the next generation", async () => {
    const user = userEvent.setup(); const client = new RaceClient(); render(<NarralensApp client={client} />); await screen.findByText(/900 帧/);
    await user.click(screen.getByRole("button", { name: "生成并比较提案" })); await user.click(await screen.findByRole("button", { name: "取消" }));
    await screen.findByText("已取消"); await user.click(screen.getByRole("button", { name: "生成并比较提案" }));
    expect((await screen.findAllByText("B方案 1", {}, { timeout: 1500 })).length).toBeGreaterThan(0); expect(screen.queryByText("A方案 1")).toBeNull();
  });

  it("imports a browser-selected MP4 with provenance and refreshes the public inventory", async () => {
    const user = userEvent.setup(); const client = new AssetClient(); render(<NarralensApp client={client} />);
    await screen.findByText("审片参考素材");
    expect(screen.getAllByText("合成/生成画面")).toHaveLength(2);
    expect(screen.getAllByText(/许可尚未清除；未声明可商业使用/)).toHaveLength(2);
    expect(screen.getByText("待恢复生成素材")).toBeTruthy();
    expect(screen.getByText("文件不可用")).toBeTruthy();
    expect(screen.getByText("许可待确认 · 未知")).toBeTruthy();
    expect(screen.getByText(/媒体文件不可用/)).toBeTruthy();
    expect(screen.getByRole("region", { name: "公开资产库存" })).toBeTruthy();
    const file = new File(["real-browser-bytes"], "camera-take.mp4", { type: "video/mp4" });
    await user.upload(screen.getByLabelText("本地 MP4 文件"), file);
    await user.type(screen.getByLabelText("来源标签"), "我的实拍");
    await user.type(screen.getByLabelText("许可标签"), "自有版权");
    await user.click(screen.getByRole("button", { name: "验证并登记资产" }));
    expect(await screen.findByText("资产已登记")).toBeTruthy();
    expect(screen.getByText("已登记，未进入时间轴。")).toBeTruthy();
    expect(screen.getByText("我的实拍")).toBeTruthy();
    expect(client.importedFile).toBe(file);
    expect(client.importedMetadata).toMatchObject({ source: { kind: "owned", label: "我的实拍" },
      license: { status: "cleared", label: "自有版权", commercial_use: true } });
  });

  it("focuses a repairable import error and supports cancelling the browser request", async () => {
    const user = userEvent.setup(); render(<NarralensApp client={new CancellableAssetClient()} />);
    await screen.findByText("全部登记资产");
    await user.click(screen.getByRole("button", { name: "验证并登记资产" }));
    const error = await screen.findByRole("alert");
    expect(error.textContent).toContain("请选择一个 MP4 文件");
    await waitFor(() => expect(document.activeElement).toBe(error));
    await user.upload(screen.getByLabelText("本地 MP4 文件"), new File(["bytes"], "take.mp4", { type: "video/mp4" }));
    await user.type(screen.getByLabelText("来源标签"), "待取消实拍");
    await user.type(screen.getByLabelText("许可标签"), "自有版权");
    await user.click(screen.getByRole("button", { name: "验证并登记资产" }));
    await user.click(await screen.findByRole("button", { name: "取消本次导入" }));
    expect(await screen.findByText(/已取消浏览器请求/)).toBeTruthy();
    expect((screen.getByLabelText("本地 MP4 文件") as HTMLInputElement).files?.[0]?.name).toBe("take.mp4");
  });

  it("has no critical or serious automated accessibility violations in the inventory state", async () => {
    render(<NarralensApp client={new FakeClient()} />);
    await screen.findByText("审片参考素材");
    const result = await axe.run(document.body, { resultTypes: ["violations"] });
    expect(result.violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious")).toEqual([]);
  });
});
