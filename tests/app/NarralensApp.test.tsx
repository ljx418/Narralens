// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { NarralensApp } from "../../src/app/director/NarralensApp.js";
import { HostApiClient, HostApiError } from "../../src/app/director/api/HostApiClient.js";
import type { EditRequest, EditResponse, JobEvent, JobResponse, ProjectResponse, ProposalBundle, ProposalRequest } from "../../src/contracts/types.js";

const project: ProjectResponse = { project_id: "d1-30s", revision: 2, frame_rate: 30, frame_count: 900,
  shots: [{ shot_id: "shot-001", start_frame: 0, end_frame_exclusive: 300 }], preview: { kind: "hypit-studio", url: "http://127.0.0.1:4174/" },
  visual_assets: { "shot-001": "asset_visual_baseline" }, available_visual_assets: [
    { asset_id: "asset_visual_baseline", duration_frames: 300, source_label: "本地基线素材", license_label: "项目自生成" },
    { asset_id: "asset_visual_d4_alt", duration_frames: 300, source_label: "本地替代素材", license_label: "项目自生成" },
  ] };
const proposal: ProposalBundle = { schema_version: "1.0", kind: "narralens.proposal_bundle", project_id: "d1-30s", proposal_id: "proposal_ui", base_revision: 2,
  selection: project.shots[0]!, preserve: ["旁白", "总时长"], summary: "递进三镜提案",
  segments: [{ id: "s1", duration_frames: 300, intent: "递进组接", asset_id: null }], assets_needed: [], source_refs: [],
  cost: { status: "unknown", currency: null, amount: null }, requires_materialization: true, renderable: false };

class FakeClient extends HostApiClient {
  constructor(private readonly fail = false) { super("http://unused"); }
  override async start(): Promise<void> {}
  override async project(): Promise<ProjectResponse> { return project; }
  override async createProposal(_id: string, _request: ProposalRequest): Promise<JobResponse> {
    if (this.fail) throw new HostApiError(529, "PROVIDER_OVERLOADED", "Provider is overloaded");
    return { job_id: "job_ui", project_id: "d1-30s", state: "queued", created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  }
  override async events(): Promise<JobEvent[]> { return [{ event_id: 1, job_id: "job_ui", type: "succeeded", proposal_id: "proposal_ui", at: new Date().toISOString() }]; }
  override async proposal(): Promise<ProposalBundle> { return proposal; }
}

class PendingClient extends FakeClient {
  #resolveEvents: ((events: JobEvent[]) => void) | undefined;
  override async events(): Promise<JobEvent[]> { return await new Promise((resolveEvents) => { this.#resolveEvents = resolveEvents; }); }
  override async cancel(): Promise<void> { this.#resolveEvents?.([{ event_id: 2, job_id: "job_ui", type: "cancelled", at: new Date().toISOString() }]); }
}

class MediaClient extends FakeClient {
  request: EditRequest | undefined;
  override async edit(_id: string, request: EditRequest): Promise<EditResponse> {
    this.request = request;
    return { transaction_id: "txn_media_ui", project_id: "d1-30s", previous_revision: 2, new_revision: 3,
      operation: request.operations[0], status: "committed", changed: true, source_sha256: "a".repeat(64), run_sha256: "b".repeat(64) };
  }
}

afterEach(cleanup);

describe("D2 Director UI", () => {
  it("supports keyboard proposal flow and displays the validated bundle", async () => {
    const user = userEvent.setup();
    render(<NarralensApp client={new FakeClient()} />);
    expect(await screen.findByText(/900 帧/)).toBeTruthy();
    const submit = screen.getByRole("button", { name: "生成提案" });
    submit.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByText("递进三镜提案", {}, { timeout: 1500 })).toBeTruthy();
    expect(screen.getByText(/此阶段只展示，不写入 Source/)).toBeTruthy();
  });

  it("surfaces provider overload with a manual retry instruction", async () => {
    const user = userEvent.setup();
    render(<NarralensApp client={new FakeClient(true)} />);
    await screen.findByText(/900 帧/);
    await user.click(screen.getByRole("button", { name: "生成提案" }));
    await waitFor(() => expect(screen.getByText(/PROVIDER_OVERLOADED/)).toBeTruthy());
    expect(screen.getByText(/稍后手动重试/)).toBeTruthy();
  });

  it("shows queued work and exposes a keyboard-operable cancel path", async () => {
    const user = userEvent.setup();
    render(<NarralensApp client={new PendingClient()} />);
    await screen.findByText(/900 帧/);
    await user.click(screen.getByRole("button", { name: "生成提案" }));
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
    expect(client.request?.operations[0]).toEqual({ op: "replace_visual_asset", shot_id: "shot-001", asset_id: "asset_visual_d4_alt" });
    expect(client.request?.preserve).toEqual(["narration", "duration"]);
  });
});
