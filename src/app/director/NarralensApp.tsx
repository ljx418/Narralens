import { useEffect, useMemo, useRef, useState } from "react";
import type { EditResponse, JobResponse, ProjectResponse, ProposalComparison, Selection } from "../../contracts/types.js";
import { AssetLibrary } from "./AssetLibrary.js";
import { HostApiClient, HostApiError } from "./api/HostApiClient.js";

const labels: Record<string, string> = { queued: "已排队", running: "正在生成并校验", cancel_requested: "正在请求取消", cancelled: "已取消", succeeded: "提案已就绪", failed: "生成失败", completed_after_cancel: "取消后仍完成" };

export function NarralensApp({ client }: { client?: HostApiClient }): React.JSX.Element {
  const api = useMemo(() => client ?? new HostApiClient(), [client]);
  const [project, setProject] = useState<ProjectResponse>();
  const [selection, setSelection] = useState<Selection>();
  const [intent, setIntent] = useState("改成三镜递进组接，保留原解说，不改变总时长。");
  const [preserve, setPreserve] = useState<Array<"narration" | "duration">>(["narration", "duration"]);
  const [proposalCount, setProposalCount] = useState(3);
  const [job, setJob] = useState<JobResponse>();
  const [comparison, setComparison] = useState<ProposalComparison>();
  const [selectedProposalId, setSelectedProposalId] = useState("");
  const generationRef = useRef(0);
  const [error, setError] = useState("");
  const [fitTarget, setFitTarget] = useState<"contain" | "cover">("contain");
  const [editBusy, setEditBusy] = useState(false);
  const [editResult, setEditResult] = useState<EditResponse>();
  const [mediaTarget, setMediaTarget] = useState("");
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaResult, setMediaResult] = useState<EditResponse>();
  const [theme, setTheme] = useState(localStorage.getItem("narralens-theme") ?? "dark");
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem("narralens-theme", theme); }, [theme]);
  useEffect(() => { void api.start().then(() => api.project("d1-30s")).then((value) => { setProject(value); setSelection(value.shots[0]); }).catch(showError); }, [api]);
  useEffect(() => {
    if (!project || !selection) return;
    const current = project.visual_assets?.[selection.shot_id];
    const target = project.available_visual_assets?.find((asset) => asset.asset_id !== current)?.asset_id
      ?? project.available_visual_assets?.[0]?.asset_id ?? "";
    setMediaTarget(target);
  }, [project, selection]);
  useEffect(() => {
    if (!job || ["succeeded", "failed", "cancelled", "completed_after_cancel"].includes(job.state)) return;
    const capturedJobId = job.job_id;
    const generation = generationRef.current;
    let active = true;
    let after = 0;
    const observe = async (): Promise<void> => {
      while (active) {
        try {
          const events = await api.events(capturedJobId, after);
          for (const event of events) {
            if (!active || generation !== generationRef.current || event.job_id !== capturedJobId) return;
            after = Math.max(after, event.event_id);
            setJob((current) => current?.job_id === capturedJobId ? { ...current, state: event.type, updated_at: event.at, ...(event.comparison_id ? { comparison_id: event.comparison_id } : {}), ...(event.error ? { error: event.error } : {}) } : current);
            if ((event.type === "succeeded" || event.type === "completed_after_cancel") && event.comparison_id) {
              let value: ProposalComparison;
              try { value = await api.comparison(event.comparison_id); }
              catch (reason) { if (active && generation === generationRef.current) { active = false; showError(reason); } return; }
              if (!active || generation !== generationRef.current || event.job_id !== capturedJobId) return;
              active = false; setComparison(value); setSelectedProposalId(value.proposals[0]?.proposal_id ?? "");
            }
            if (event.type === "failed") { active = false; if (event.error) setError(`${event.error.code} · ${event.error.message}`); }
            if (event.type === "cancelled") active = false;
          }
          if (events.length === 0) await new Promise((done) => window.setTimeout(done, 200));
        } catch (reason) { if (active) { showError(reason); await new Promise((done) => window.setTimeout(done, 500)); } }
      }
    };
    void observe();
    return () => { active = false; if (generationRef.current === generation) generationRef.current += 1; };
  }, [api, job?.job_id]);
  const busy = job ? ["queued", "running", "cancel_requested"].includes(job.state) : false;
  const duration = selection && project ? `${((selection.end_frame_exclusive - selection.start_frame) / project.frame_rate).toFixed(1)} 秒` : "—";
  const invalidateComparison = (): void => {
    generationRef.current += 1; setJob(undefined); setComparison(undefined); setSelectedProposalId(""); setError("");
  };
  const chooseSelection = (value: Selection): void => { if (busy) return; invalidateComparison(); setSelection(value); };
  const toggle = (item: "narration" | "duration"): void => {
    if (busy) return; invalidateComparison(); setPreserve((items) => items.includes(item) ? items.filter((value) => value !== item) : [...items, item]);
  };
  const submit = async (): Promise<void> => {
    if (!project || !selection || !intent.trim()) return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setError(""); setComparison(undefined); setSelectedProposalId("");
    try {
      const value = await api.createProposal(project.project_id, { base_revision: project.revision, selection, intent: intent.trim(), preserve, proposal_count: proposalCount });
      if (generation === generationRef.current) setJob(value);
    }
    catch (reason) { if (generation === generationRef.current) showError(reason); }
  };
  const applyFit = async (): Promise<void> => {
    if (!project || !selection) return;
    setError(""); setEditResult(undefined); setEditBusy(true);
    try {
      const value = await api.edit(project.project_id, { base_revision: project.revision,
        idempotency_key: `ui-${crypto.randomUUID()}`, selection, preserve: ["narration", "duration"],
        operations: [{ op: "set_visual_fit", shot_id: selection.shot_id, value: fitTarget }] });
      setEditResult(value);
      invalidateComparison();
      setProject(await api.project(project.project_id));
    } catch (reason) { showError(reason); }
    finally { setEditBusy(false); }
  };
  const applyMedia = async (): Promise<void> => {
    if (!project || !selection || !mediaTarget) return;
    setError(""); setMediaResult(undefined); setMediaBusy(true);
    try {
      const value = await api.edit(project.project_id, { base_revision: project.revision,
        idempotency_key: `ui-media-${crypto.randomUUID()}`, selection, preserve: ["narration", "duration"],
        operations: [{ op: "replace_visual_asset", shot_id: selection.shot_id, asset_id: mediaTarget }] });
      setMediaResult(value);
      invalidateComparison();
      setProject(await api.project(project.project_id));
    } catch (reason) { showError(reason); }
    finally { setMediaBusy(false); }
  };
  function showError(reason: unknown): void { setError(reason instanceof HostApiError ? `${reason.code} · ${reason.message}` : "本地服务不可用，草稿仍保留"); }
  const selectedProposal = comparison?.proposals.find((proposal) => proposal.proposal_id === selectedProposalId) ?? comparison?.proposals[0];
  const frames = useMemo(() => selectedProposal?.segments.reduce((sum, segment) => sum + segment.duration_frames, 0) ?? 0, [selectedProposal]);

  return <div className="app-shell">
    <header className="topbar"><div className="brand"><span>叙</span><div>Narralens<small>AI 导演工作台</small></div></div><nav aria-label="工作阶段"><b>想法</b><b aria-current="page">精修</b><b>交付</b></nav><div className="theme" role="group" aria-label="主题">{["light", "dark", "system"].map((value) => <button key={value} aria-pressed={theme === value} onClick={() => setTheme(value)}>{value === "light" ? "浅" : value === "dark" ? "深" : "系统"}</button>)}</div></header>
    <main>
      <section className="project-head"><div><span className="eyebrow">REAL PROJECT · TRANSACTIONAL EDIT</span><h1>D1 / 30 秒真实工程</h1><p>revision {project?.revision ?? "—"} · {project?.frame_rate ?? "—"} fps · {project?.frame_count ?? "—"} 帧</p></div><a className="ghost" href={project?.preview.url} target="_blank" rel="noreferrer">打开 Hypit 预览 ↗</a></section>
      <div className="workspace">
        <aside className="shots"><div className="section-label">镜头选区</div>{project?.shots.map((shot, index) => <button key={shot.shot_id} className={selection?.shot_id === shot.shot_id ? "active" : ""} disabled={busy} onClick={() => chooseSelection(shot)}><span>0{index + 1}</span><b>{shot.shot_id}</b><small>{shot.start_frame}—{shot.end_frame_exclusive} 帧</small></button>)}</aside>
        <section className="viewer" aria-label="真实项目预览入口"><div className="frame"><span>{selection?.shot_id ?? "正在读取工程"}</span><strong>{selection ? `[${selection.start_frame}, ${selection.end_frame_exclusive})` : "—"}</strong></div><div className="timeline"><i style={{ width: `${selection ? ((selection.end_frame_exclusive - selection.start_frame) / (project?.frame_count ?? 1)) * 100 : 0}%` }} /> <span>{duration} · 只读选区</span></div></section>
        <aside className="director"><div className="section-label">DIRECTOR PANE · READ ONLY</div><h2>比较多种讲述路径</h2><p className="selection">{selection?.shot_id ?? "—"} · base revision r{project?.revision ?? "—"}</p><div className="preserve" role="group" aria-label="保留项">{([{ key: "narration", label: "旁白" }, { key: "duration", label: "总时长" }] as const).map((item) => <button key={item.key} aria-pressed={preserve.includes(item.key)} disabled={busy} onClick={() => toggle(item.key)}>保留{item.label}</button>)}</div><p className="visual-lock">画面锁：{project?.locks?.visual ? "已锁定" : "未锁定"} · 仍可比较，采用时会重新检查</p><label htmlFor="proposal-count">比较方案数</label><select id="proposal-count" value={proposalCount} onChange={(event) => { invalidateComparison(); setProposalCount(Number(event.target.value)); }} disabled={busy}>{[3, 4, 5, 6].map((count) => <option key={count} value={count}>{count} 个方案</option>)}</select><label htmlFor="intent">导演意图</label><textarea id="intent" value={intent} onChange={(event) => { invalidateComparison(); setIntent(event.target.value); }} disabled={busy} /><div className="actions"><button className="primary" onClick={() => void submit()} disabled={busy || !project || !selection || !intent.trim()}>{busy ? labels[job!.state] : "生成并比较提案"}</button>{busy && <button className="ghost" onClick={() => void api.cancel(job!.job_id)}>取消</button>}</div><div role="status" aria-live="polite" className="status">{job && <><b>{labels[job.state]}</b><span>任务 {job.job_id.slice(0, 12)}…</span></>}{error && <strong className="error">{error}<small>{error.startsWith("PROVIDER_OVERLOADED") ? "服务端过载，请稍后手动重试。" : "草稿未丢失，可修正后重试。"}</small></strong>}</div></aside>
      </div>
      <section className="proposal-area comparison-area"><div><span className="eyebrow">D4.1 · VALIDATED COMPARISON</span><h2>{selectedProposal?.title ?? "等待与当前 revision 绑定的多方案比较"}</h2><p>D4.1 仅比较，不写入 Source；采用与素材化尚未开放。</p>{comparison && <div className="audit"><b>真实生成审计</b><span>{comparison.generation_audit.total_cost_usd === null ? "费用未知" : `$${comparison.generation_audit.total_cost_usd.toFixed(4)} USD`} · {comparison.generation_audit.model_names.join("、") || "模型未报告"}</span><small>项目尚未提供事实来源</small></div>}</div>{comparison && selectedProposal && <div className="comparison"><div className="proposal-tabs" role="tablist" aria-label="候选方案">{comparison.proposals.map((proposal, index) => <button key={proposal.proposal_id} role="tab" aria-selected={proposal.proposal_id === selectedProposal.proposal_id} aria-controls="proposal-detail" onClick={() => setSelectedProposalId(proposal.proposal_id)}><b>{index + 1}. {proposal.title}</b><span>{proposal.strategy.kind} · {proposal.segments.length} 段</span></button>)}</div><div id="proposal-detail" role="tabpanel" className="proposal-card"><header><div><b>{selectedProposal.title}</b><small>{selectedProposal.strategy.rationale}</small></div><span>待素材化</span></header><p className="proposal-summary">{selectedProposal.summary}</p>{selectedProposal.segments.map((segment) => <article key={segment.segment_id}><i /><div><b>{segment.role} · {segment.intent}</b><small>{segment.duration_frames} 帧 · {segment.asset_requirement_ids.length ? `${segment.asset_requirement_ids.length} 项素材需求` : "未绑定素材需求"}</small></div></article>)}<div className="comparison-facts"><span>结构：{selectedProposal.segments.length} 段 / {selectedProposal.segments.map((segment) => segment.role).join(" → ")}</span><span>素材需求：{selectedProposal.assets_needed.length} · 来源引用：{selectedProposal.source_refs.length}</span><span>素材化费用：未知 · 许可状态：待审批</span></div><footer>覆盖 {frames} 帧 · comparison {comparison.comparison_id.slice(0, 20)}…</footer></div></div>}</section>
      <section className="fit-workspace" aria-labelledby="fit-title"><div><span className="eyebrow">D3 · TYPED LOCAL EDIT</span><h2 id="fit-title">单镜头画面适配</h2><p>只修改所选 visual clip 的 fit；旁白、总时长与非目标镜头会在 Host 中复核。</p></div><div className="fit-card"><p><b>{selection?.shot_id ?? "—"}</b> · 当前 {selection ? project?.visual_fits?.[selection.shot_id] ?? "Studio 未连接" : "—"} → 目标 {fitTarget}</p><div className="fit-options" role="group" aria-label="目标画面适配">{(["contain", "cover"] as const).map((value) => <button key={value} aria-pressed={fitTarget === value} onClick={() => setFitTarget(value)}>{value}</button>)}</div><button className="primary" onClick={() => void applyFit()} disabled={!selection || !project?.visual_fits || project.locks?.visual || editBusy}>{project?.locks?.visual ? "画面已锁" : editBusy ? "正在事务写入" : "确认局部写入"}</button>{editResult && <p className="edit-success">{editResult.changed ? `已提交 r${editResult.new_revision}` : "无需修改"} · {editResult.transaction_id.slice(0, 16)}…</p>}</div></section>
      <section className="fit-workspace media-workspace" aria-labelledby="media-title"><div><span className="eyebrow">D4.0 · REGISTERED LOCAL ASSET</span><h2 id="media-title">单镜头素材替换</h2><p>只接受清单中已校验的本地 MP4。提交后保持所选镜头区间、旁白、总时长和其他镜头不变。</p></div><div className="fit-card media-card"><p><b>{selection?.shot_id ?? "—"}</b> · 当前素材 <code>{selection ? project?.visual_assets?.[selection.shot_id] ?? "Studio 未连接" : "—"}</code></p><div className="asset-options" role="radiogroup" aria-label="替代素材">{project?.available_visual_assets?.map((asset) => <button key={asset.asset_id} role="radio" aria-checked={mediaTarget === asset.asset_id} onClick={() => setMediaTarget(asset.asset_id)}><b>{asset.asset_id}</b><span>{asset.duration_frames} 帧 · {asset.source_label}</span><small>许可：{asset.license_label}</small></button>)}</div><div className="impact"><b>确认影响</b><span>仅 {selection?.shot_id ?? "所选镜头"} 的媒体绑定</span><small>保留：旁白 · 900 帧总时长 · 非目标镜头</small></div><button className="primary" onClick={() => void applyMedia()} disabled={!selection || !project?.visual_assets || !mediaTarget || project.locks?.visual || mediaBusy}>{project?.locks?.visual ? "画面已锁" : mediaBusy ? "正在校验并写入" : "确认替换素材"}</button>{mediaResult && <p className="edit-success">{mediaResult.changed ? `已提交 r${mediaResult.new_revision}` : "当前已是该素材"} · {mediaResult.transaction_id.slice(0, 16)}…</p>}</div></section>
      {project && <AssetLibrary api={api} projectId={project.project_id}
        onInventoryChanged={async () => setProject(await api.project(project.project_id))} />}
    </main>
  </div>;
}
