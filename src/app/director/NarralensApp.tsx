import { useEffect, useMemo, useState } from "react";
import type { EditResponse, JobResponse, ProjectResponse, ProposalBundle, Selection } from "../../contracts/types.js";
import { HostApiClient, HostApiError } from "./api/HostApiClient.js";

const labels: Record<string, string> = { queued: "已排队", running: "正在生成并校验", cancel_requested: "正在请求取消", cancelled: "已取消", succeeded: "提案已就绪", failed: "生成失败", completed_after_cancel: "取消后仍完成" };

export function NarralensApp({ client }: { client?: HostApiClient }): React.JSX.Element {
  const api = useMemo(() => client ?? new HostApiClient(), [client]);
  const [project, setProject] = useState<ProjectResponse>();
  const [selection, setSelection] = useState<Selection>();
  const [intent, setIntent] = useState("改成三镜递进组接，保留原解说，不改变总时长。");
  const [preserve, setPreserve] = useState(["旁白", "总时长"]);
  const [job, setJob] = useState<JobResponse>();
  const [proposal, setProposal] = useState<ProposalBundle>();
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
    let active = true;
    let after = 0;
    const observe = async (): Promise<void> => {
      while (active) {
        try {
          const events = await api.events(job.job_id, after);
          for (const event of events) {
            after = Math.max(after, event.event_id);
            setJob((current) => current ? { ...current, state: event.type, updated_at: event.at, ...(event.proposal_id ? { proposal_id: event.proposal_id } : {}), ...(event.error ? { error: event.error } : {}) } : current);
            if ((event.type === "succeeded" || event.type === "completed_after_cancel") && event.proposal_id) { active = false; setProposal(await api.proposal(event.proposal_id)); }
            if (event.type === "failed") { active = false; if (event.error) setError(`${event.error.code} · ${event.error.message}`); }
            if (event.type === "cancelled") active = false;
          }
          if (events.length === 0) await new Promise((done) => window.setTimeout(done, 200));
        } catch (reason) { if (active) { showError(reason); await new Promise((done) => window.setTimeout(done, 500)); } }
      }
    };
    void observe();
    return () => { active = false; };
  }, [api, job]);
  const busy = job ? ["queued", "running", "cancel_requested"].includes(job.state) : false;
  const duration = selection && project ? `${((selection.end_frame_exclusive - selection.start_frame) / project.frame_rate).toFixed(1)} 秒` : "—";
  const toggle = (item: string): void => setPreserve((items) => items.includes(item) ? items.filter((value) => value !== item) : [...items, item]);
  const submit = async (): Promise<void> => {
    if (!project || !selection || !intent.trim()) return;
    setError(""); setProposal(undefined);
    try { setJob(await api.createProposal(project.project_id, { base_revision: project.revision, selection, intent: intent.trim(), preserve })); }
    catch (reason) { showError(reason); }
  };
  const applyFit = async (): Promise<void> => {
    if (!project || !selection) return;
    setError(""); setEditResult(undefined); setEditBusy(true);
    try {
      const value = await api.edit(project.project_id, { base_revision: project.revision,
        idempotency_key: `ui-${crypto.randomUUID()}`, selection, preserve: ["narration", "duration"],
        operations: [{ op: "set_visual_fit", shot_id: selection.shot_id, value: fitTarget }] });
      setEditResult(value);
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
      setProject(await api.project(project.project_id));
    } catch (reason) { showError(reason); }
    finally { setMediaBusy(false); }
  };
  function showError(reason: unknown): void { setError(reason instanceof HostApiError ? `${reason.code} · ${reason.message}` : "本地服务不可用，草稿仍保留"); }
  const frames = useMemo(() => proposal?.segments.reduce((sum, segment) => sum + segment.duration_frames, 0) ?? 0, [proposal]);

  return <div className="app-shell">
    <header className="topbar"><div className="brand"><span>叙</span><div>Narralens<small>AI 导演工作台</small></div></div><nav aria-label="工作阶段"><b>想法</b><b aria-current="page">精修</b><b>交付</b></nav><div className="theme" aria-label="主题">{["light", "dark", "system"].map((value) => <button key={value} aria-pressed={theme === value} onClick={() => setTheme(value)}>{value === "light" ? "浅" : value === "dark" ? "深" : "系统"}</button>)}</div></header>
    <main>
      <section className="project-head"><div><span className="eyebrow">REAL PROJECT · TRANSACTIONAL EDIT</span><h1>D1 / 30 秒真实工程</h1><p>revision {project?.revision ?? "—"} · {project?.frame_rate ?? "—"} fps · {project?.frame_count ?? "—"} 帧</p></div><a className="ghost" href={project?.preview.url} target="_blank" rel="noreferrer">打开 Hypit 预览 ↗</a></section>
      <div className="workspace">
        <aside className="shots"><div className="section-label">镜头选区</div>{project?.shots.map((shot, index) => <button key={shot.shot_id} className={selection?.shot_id === shot.shot_id ? "active" : ""} onClick={() => setSelection(shot)}><span>0{index + 1}</span><b>{shot.shot_id}</b><small>{shot.start_frame}—{shot.end_frame_exclusive} 帧</small></button>)}</aside>
        <section className="viewer" aria-label="真实项目预览入口"><div className="frame"><span>{selection?.shot_id ?? "正在读取工程"}</span><strong>{selection ? `[${selection.start_frame}, ${selection.end_frame_exclusive})` : "—"}</strong></div><div className="timeline"><i style={{ width: `${selection ? ((selection.end_frame_exclusive - selection.start_frame) / (project?.frame_count ?? 1)) * 100 : 0}%` }} /> <span>{duration} · 只读选区</span></div></section>
        <aside className="director"><div className="section-label">DIRECTOR PANE</div><h2>告诉 Agent 这一段怎么改</h2><p className="selection">{selection?.shot_id ?? "—"} · base revision r{project?.revision ?? "—"}</p><div className="preserve" aria-label="保留项">{["旁白", "总时长", "原画面"].map((item) => <button key={item} aria-pressed={preserve.includes(item)} onClick={() => toggle(item)}>锁 {item}</button>)}</div><label htmlFor="intent">导演意图</label><textarea id="intent" value={intent} onChange={(event) => setIntent(event.target.value)} disabled={busy} /><div className="actions"><button className="primary" onClick={() => void submit()} disabled={busy || !project || !selection || !intent.trim()}>{busy ? labels[job!.state] : "生成提案"}</button>{busy && <button className="ghost" onClick={() => void api.cancel(job!.job_id)}>取消</button>}</div><div role="status" aria-live="polite" className="status">{job && <><b>{labels[job.state]}</b><span>任务 {job.job_id.slice(0, 12)}…</span></>}{error && <strong className="error">{error}<small>{error.startsWith("PROVIDER_OVERLOADED") ? "服务端过载，请稍后手动重试。" : "草稿未丢失，可修正后重试。"}</small></strong>}</div></aside>
      </div>
      <section className="proposal-area"><div><span className="eyebrow">VALIDATED PROPOSAL</span><h2>{proposal?.summary ?? "等待一个与当前 revision 绑定的提案"}</h2></div>{proposal && <div className="proposal-card"><header><b>{proposal.proposal_id}</b><span>{proposal.renderable ? "可渲染" : "待素材化"}</span></header>{proposal.segments.map((segment) => <article key={segment.id}><i /><div><b>{segment.intent}</b><small>{segment.duration_frames} 帧 · {segment.asset_id ?? "素材待解析"}</small></div></article>)}<footer>覆盖 {frames} 帧 · 此阶段只展示，不写入 Source</footer></div>}</section>
      <section className="fit-workspace" aria-labelledby="fit-title"><div><span className="eyebrow">D3 · TYPED LOCAL EDIT</span><h2 id="fit-title">单镜头画面适配</h2><p>只修改所选 visual clip 的 fit；旁白、总时长与非目标镜头会在 Host 中复核。</p></div><div className="fit-card"><p><b>{selection?.shot_id ?? "—"}</b> · 当前 {selection ? project?.visual_fits?.[selection.shot_id] ?? "Studio 未连接" : "—"} → 目标 {fitTarget}</p><div className="fit-options" aria-label="目标画面适配">{(["contain", "cover"] as const).map((value) => <button key={value} aria-pressed={fitTarget === value} onClick={() => setFitTarget(value)}>{value}</button>)}</div><button className="primary" onClick={() => void applyFit()} disabled={!selection || !project?.visual_fits || project.locks?.visual || editBusy}>{project?.locks?.visual ? "画面已锁" : editBusy ? "正在事务写入" : "确认局部写入"}</button>{editResult && <p className="edit-success">{editResult.changed ? `已提交 r${editResult.new_revision}` : "无需修改"} · {editResult.transaction_id.slice(0, 16)}…</p>}</div></section>
      <section className="fit-workspace media-workspace" aria-labelledby="media-title"><div><span className="eyebrow">D4.0 · REGISTERED LOCAL ASSET</span><h2 id="media-title">单镜头素材替换</h2><p>只接受清单中已校验的本地 MP4。提交后保持所选镜头区间、旁白、总时长和其他镜头不变。</p></div><div className="fit-card media-card"><p><b>{selection?.shot_id ?? "—"}</b> · 当前素材 <code>{selection ? project?.visual_assets?.[selection.shot_id] ?? "Studio 未连接" : "—"}</code></p><div className="asset-options" role="radiogroup" aria-label="替代素材">{project?.available_visual_assets?.map((asset) => <button key={asset.asset_id} role="radio" aria-checked={mediaTarget === asset.asset_id} onClick={() => setMediaTarget(asset.asset_id)}><b>{asset.asset_id}</b><span>{asset.duration_frames} 帧 · {asset.source_label}</span><small>许可：{asset.license_label}</small></button>)}</div><div className="impact"><b>确认影响</b><span>仅 {selection?.shot_id ?? "所选镜头"} 的媒体绑定</span><small>保留：旁白 · 900 帧总时长 · 非目标镜头</small></div><button className="primary" onClick={() => void applyMedia()} disabled={!selection || !project?.visual_assets || !mediaTarget || project.locks?.visual || mediaBusy}>{project?.locks?.visual ? "画面已锁" : mediaBusy ? "正在校验并写入" : "确认替换素材"}</button>{mediaResult && <p className="edit-success">{mediaResult.changed ? `已提交 r${mediaResult.new_revision}` : "当前已是该素材"} · {mediaResult.transaction_id.slice(0, 16)}…</p>}</div></section>
    </main>
  </div>;
}
