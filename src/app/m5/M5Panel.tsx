import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComparisonReplayResponseV1, WorkbenchProjectionV1 } from "../../contracts/wave3-types.js";
import type { ImpactSpecV1 } from "../../contracts/wave2-types.js";
import { GatewayApiClient, GatewayApiError } from "./GatewayApiClient.js";
import { PlaybackClock, SelectionStore, WorkbenchStore, type SelectionContext } from "./stores.js";
import { SelectionCoordinator, clipOf } from "./SelectionCoordinator.js";

/**
 * The M5 panel (Wave 3 `01` §5–§6, `04` §1).
 *
 * It is the DirectorPane, the LockControls, the InspectorHistoryDrawer, the
 * MaterializationStatus and the ImpactReview, drawn in one column on the right of the
 * Studio's own page. The native timeline, the player and the inspector stay the
 * Studio's: this panel never draws a frame×track grid, and the only timeline is the
 * native one.
 *
 * Every state word in `01` §6 has a rendering here, and every error code has a *next
 * step* the operator can take. A failure never throws away the draft, and a permanent
 * condition never offers a button that pretends to repair it.
 */
export interface M5PanelProps {
  readonly client?: GatewayApiClient;
  readonly targetProjectId?: string;
}

/** The next step for each error the Host can answer with. */
export function nextStepFor(code: string): string {
  switch (code) {
    case "REVISION_CONFLICT":
    case "SOURCE_CHANGED":
      return "基线已变化：草稿仍在，请重新加载并重新计算影响。";
    case "UNSUPPORTED_EDIT":
    case "MISSING_ASSET":
    case "INVALID_MEDIA":
      return "当前条件不满足，暂不可采用；草稿仍在。";
    case "TARGET_LOCKED":
      return "存在锁：请先查看锁的类型与原因，再显式释放属于本机的锁。";
    case "IMPACT_REQUIRED":
    case "IMPACT_STALE":
      return "影响已过期或缺失：请重新计算影响并再次确认。";
    case "HOST_RESOURCE_EXHAUSTED":
    case "ENGINE_UNAVAILABLE":
      return "服务暂时不可用：草稿仍在，可手动重试。";
    case "PROJECT_ATTENTION_REQUIRED":
      return "工程需要人工处理：这是终态，没有可自行修复的入口。";
    case "IDEMPOTENCY_KEY_CONFLICT":
      return "同一请求键已用于其他内容：请显式新建一次请求。";
    default:
      return "草稿仍在，可修正后重试。";
  }
}

const PHASE_LABELS: Record<string, string> = {
  proposal_only: "仅有已录制提案",
  bindings_required: "需要素材绑定",
  materializing: "正在素材化",
  preview_ready: "预览已就绪",
  approval_required: "等待确认",
  ready_for_adoption: "可以采用",
  adopted: "已采用",
  stale: "基线已变化",
  failed: "失败",
  cancelled: "已取消",
  attention: "需要工程处理",
};

/** The shape of the recorded comparison the panel draws. */
interface RecordedComparison {
  readonly comparison_id: string;
  readonly project_id: string;
  readonly proposals: ReadonlyArray<{
    readonly proposal_id: string;
    readonly title: string;
    readonly summary: string;
    readonly segments: ReadonlyArray<{
      readonly segment_id: string; readonly role: string; readonly duration_frames: number;
    }>;
  }>;
}

/** The Studio's selection, in the shape the panel needs. */
interface StudioSelectionEvent {
  projectId?: string;
  time?: number;
  refs?: Array<{ kind: string; id?: string | null; start?: number; end?: number }>;
  range?: { start: number; end: number } | null;
}

export function M5Panel({ client, targetProjectId }: M5PanelProps): React.JSX.Element {
  const api = useMemo(() => client ?? new GatewayApiClient(), [client]);
  const target = useMemo(() => targetProjectId
    ?? (window as { narralensTarget?: string }).narralensTarget
    ?? new URLSearchParams(window.location.search).get("target") ?? "", [targetProjectId]);

  const [projection, setProjection] = useState<WorkbenchProjectionV1>();
  const [blocked, setBlocked] = useState<string>("");
  const [replay, setReplay] = useState<ComparisonReplayResponseV1>();
  const [materialization, setMaterialization] = useState<Record<string, unknown>>({});
  const [impact, setImpact] = useState<ImpactSpecV1>();
  const [inventory, setInventory] = useState<ReadonlyArray<{
    asset_id: string; duration_frames: number; source_label: string; eligible: boolean;
  }>>([]);
  const [busy, setBusy] = useState("");
  const [stickyKey, setStickyKey] = useState(() => `m5-${crypto.randomUUID()}`);

  const selectionStore = useMemo(() => new SelectionStore(), []);
  const uiStore = useMemo(() => new WorkbenchStore(), []);
  const clock = useMemo(() => new PlaybackClock({ num: 30, den: 1 }), []);
  const coordinator = useMemo(() => new SelectionCoordinator(selectionStore), [selectionStore]);

  const [selection, setSelection] = useState<SelectionContext | null>(null);
  const [ui, setUi] = useState(uiStore.value);
  const [frame, setFrame] = useState(0);

  useEffect(() => selectionStore.subscribe((value) => setSelection(value)), [selectionStore]);
  useEffect(() => uiStore.subscribe((value) => setUi(value)), [uiStore]);
  useEffect(() => clock.onFrame((value) => setFrame(value)), [clock]);

  const fail = useCallback((reason: unknown): void => {
    const error = reason instanceof GatewayApiError ? reason : undefined;
    uiStore.patch({
      error: {
        code: error?.code ?? "UNKNOWN",
        message: error?.message ?? "本地服务不可用，草稿仍保留",
        next: nextStepFor(error?.code ?? "UNKNOWN"),
      },
      phase: error?.code === "PROJECT_ATTENTION_REQUIRED" ? "attention" : "failed",
    });
  }, [uiStore]);

  /** Load the workbench: the read model the whole panel draws from. */
  const load = useCallback(async (): Promise<void> => {
    if (target === "") { setBlocked("页面没有指定 target 项目。"); return; }
    try {
      const value = await api.workbench(target);
      setProjection(value);
      setBlocked("");
      uiStore.patch({ error: null });
      // A revision change relocates the selection or asks the operator to choose again.
      if (!coordinator.relocate(value)) {
        uiStore.patch({ phase: "stale", error: {
          code: "SELECTION_STALE",
          message: "选区所在的镜头已不存在，请重新选择。",
          next: "在上方镜头列表中重新选择一个镜头。",
        } });
      }
    } catch (reason) {
      const error = reason instanceof GatewayApiError ? reason : undefined;
      setBlocked(error?.message ?? "无法读取工作台投影。");
    }
  }, [api, coordinator, target, uiStore]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    void api.inventory(target).then((value) => setInventory(value.assets)).catch(() => undefined);
  }, [api, target]);

  // The native Studio's selection, in frames. The conversion happens at the boundary.
  useEffect(() => {
    const onSelection = (event: Event): void => {
      const detail = (event as CustomEvent<StudioSelectionEvent>).detail;
      if (!projection) return;
      const clipId = detail.refs?.find((ref) => ref.kind === "clip")?.id ?? null;
      const range = detail.range;
      const fps = projection.fps;
      const toFrame = (seconds: number | undefined): number =>
        seconds === undefined ? 0 : Math.max(0, Math.floor(seconds * fps.num / fps.den));
      const next = coordinator.selectFromStudio(projection, {
        clipId: clipId ?? "",
        startFrame: toFrame(range?.start ?? detail.time),
        endFrameExclusive: toFrame(range?.end ?? detail.time),
      });
      if (next !== null) {
        clock.seek(next.range.start_frame);
        setFrame(next.range.start_frame);
      }
    };
    window.addEventListener("narralens:studio-selection", onSelection);
    return () => window.removeEventListener("narralens:studio-selection", onSelection);
  }, [clock, coordinator, projection]);

  // The keyboard: the panel's own shortcuts, and the ones the Studio leaves alone.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target_ = event.target as HTMLElement | null;
      if (target_ && ["INPUT", "TEXTAREA", "SELECT"].includes(target_.tagName)) return;
      if (event.key === "/") {
        event.preventDefault();
        document.getElementById("narralens-atlas-search")?.focus();
        return;
      }
      if (event.key === "Escape") {
        const open = document.querySelector<HTMLElement>("[data-narralens-dialog='open']");
        if (open !== null) {
          const focusId = open.dataset.focusReturn;
          open.removeAttribute("data-narralens-dialog");
          open.hidden = true;
          if (focusId !== undefined) document.getElementById(focusId)?.focus();
        }
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        if (!selection) return;
        event.preventDefault();
        const step = event.shiftKey ? projection?.fps.num ?? 30 : 1;
        const next = selection.range.start_frame + (event.key === "ArrowLeft" ? -step : step);
        clock.seek(next);
        setFrame(next);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        // The browser's undo is for the *draft*; a committed change goes through the
        // history intent, impact and confirmation.
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clock, projection, selection]);

  const selectClip = useCallback((clipId: string): void => {
    if (!projection) return;
    const next = coordinator.selectClip(projection, clipId);
    if (next === null) return;
    clock.seek(next.range.start_frame);
    setFrame(next.range.start_frame);
    // The native timeline follows: the Studio is told what to select.
    const studio = (window as { narralensStudio?: { command: (command: unknown) => void } }).narralensStudio;
    studio?.command({ type: "select-clip", id: clipId, seek: true });
  }, [clock, coordinator, projection]);

  // The recorded comparison the page replays. It is named by the operator, and it is
  // always an *existing* D4.1 recording: M5 never calls a provider.
  const [sourceComparisonId, setSourceComparisonId] = useState("");
  const [sourceComparisonBaseRevision, setSourceComparisonBaseRevision] = useState(1);

  const runReplay = useCallback(async (): Promise<void> => {
    if (!projection) return;
    setBusy("replay");
    try {
      const response = await api.replay(projection.project_id, {
        format: "narralens.comparison-replay-request@1.0",
        source_comparison_id: sourceComparisonId,
        base_revision: sourceComparisonBaseRevision,
        idempotency_key: `${stickyKey}-replay`,
      });
      setReplay(response);
      uiStore.patch({ phase: "proposal_only", error: null });
    } catch (reason) { fail(reason); }
    finally { setBusy(""); }
  }, [api, fail, projection, sourceComparisonBaseRevision, sourceComparisonId, stickyKey, uiStore]);

  const runMaterialize = useCallback(async (): Promise<void> => {
    if (!projection || !replay) return;
    const comparison = replay.comparison as RecordedComparison;
    const proposal = comparison.proposals[0];
    if (proposal === undefined) return;
    setBusy("materialize");
    try {
      const bindings = proposal.segments.map((segment, index) => {
        const asset = inventory[index % Math.max(1, inventory.length)];
        return {
          segment_id: segment.segment_id,
          asset_id: asset?.asset_id ?? "",
          source_start_frame: 0,
          source_end_frame_exclusive: segment.duration_frames,
        };
      });
      const created = await api.materialize(projection.project_id, {
        comparison_id: replay.comparison_id,
        proposal_id: proposal.proposal_id,
        base_revision: projection.revision,
        expected_source_digest: projection.source_digest,
        control_revision: projection.control_revision,
        segment_bindings: bindings,
        idempotency_key: `${stickyKey}-materialize`,
      });
      setMaterialization(created);
      uiStore.patch({ phase: "materializing", error: null });
    } catch (reason) { fail(reason); }
    finally { setBusy(""); }
  }, [api, fail, inventory, projection, replay, stickyKey, uiStore]);

  const runImpact = useCallback(async (): Promise<void> => {
    if (!projection || !materialization.materialization_id) return;
    setBusy("impact");
    try {
      const spec = await api.impact(projection.project_id, {
        format: "narralens.impact-request@1.0",
        base_revision: projection.revision,
        expected_source_digest: projection.source_digest,
        control_revision: projection.control_revision,
        intent: { op: "adopt_materialization", materialization_id: materialization.materialization_id },
        idempotency_key: `${stickyKey}-impact`,
      });
      setImpact(spec);
      uiStore.patch({ phase: "approval_required", error: null });
    } catch (reason) { fail(reason); }
    finally { setBusy(""); }
  }, [api, fail, materialization.materialization_id, projection, stickyKey, uiStore]);

  const runAdopt = useCallback(async (): Promise<void> => {
    if (!projection || !impact || !materialization.materialization_id) return;
    setBusy("adopt");
    try {
      await api.nativeWrite("timeline.adopt_materialization", projection.project_id, {
        format: "narralens.adopt-request@1.0",
        base_revision: projection.revision,
        expected_source_digest: projection.source_digest,
        control_revision: projection.control_revision,
        materialization_id: materialization.materialization_id,
        impact_id: impact.impact_id,
        impact_hash: impact.impact_hash,
        approval: { confirmed: true },
        idempotency_key: `${stickyKey}-adopt`,
      });
      uiStore.patch({ phase: "adopted", error: null });
      await load();
    } catch (reason) { fail(reason); }
    finally { setBusy(""); }
  }, [api, fail, impact, load, materialization.materialization_id, projection, stickyKey, uiStore]);

  const runIntent = useCallback(async (op: "undo" | "redo"): Promise<void> => {
    if (!projection) return;
    setBusy(op);
    try {
      const intent = op === "undo" ? await api.undo(projection.project_id) : await api.redo(projection.project_id);
      // An intent is not a change: the page says "准备撤回/重做", and the operator still
      // has to see the impact and confirm it.
      uiStore.patch({ phase: "approval_required", error: null });
      setImpact(undefined);
      setMaterialization((current) => ({ ...current, pending_intent: intent }));
    } catch (reason) { fail(reason); }
    finally { setBusy(""); }
  }, [api, fail, projection, uiStore]);

  const createLock = useCallback(async (): Promise<void> => {
    if (!projection) return;
    setBusy("lock");
    try {
      await api.createLock(projection.project_id, {
        format: "narralens.lock-request@1.0",
        base_control_revision: projection.control_revision,
        lock_type: "visual", scope: "project", target_id: null,
        start_frame: 0, end_frame_exclusive: projection.frame_count,
        reason_code: "preserve_visual",
        idempotency_key: `${stickyKey}-lock`,
      });
      await load();
    } catch (reason) { fail(reason); }
    finally { setBusy(""); }
  }, [api, fail, load, projection, stickyKey, uiStore]);

  const releaseLock = useCallback(async (lockId: string): Promise<void> => {
    if (!projection) return;
    setBusy("lock");
    try {
      await api.releaseLock(projection.project_id, lockId, projection.control_revision,
        `${stickyKey}-release-${lockId}`);
      await load();
    } catch (reason) { fail(reason); }
    finally { setBusy(""); }
  }, [api, fail, load, projection, stickyKey, uiStore]);

  const selectedClip = projection === undefined ? undefined : clipOf(projection, selection);
  const proposals = replay === undefined ? [] : (replay.comparison as RecordedComparison).proposals;

  if (blocked !== "") {
    return <div className="m5-panel" data-narralens-panel="blocked">
      <h2>Narralens</h2>
      <p role="alert" className="m5-error">{blocked}</p>
    </div>;
  }
  if (projection === undefined) {
    return <div className="m5-panel" data-narralens-panel="loading"><h2>Narralens</h2><p>正在读取工作台…</p></div>;
  }

  return <div className="m5-panel" data-narralens-panel="ready" data-phase={ui.phase}>
    <header className="m5-head">
      <h2>Narralens 导演面板</h2>
      <p className="m5-facts">
        <span>target {projection.project_id}</span>
        <span>source {projection.source_project_id}</span>
        <span>r{projection.revision} · c{projection.control_revision}</span>
        <span>{projection.frame_count} 帧 · 旁白 {projection.narration === "present" ? "有" : projection.narration === "absent" ? "无" : "未知"}</span>
      </p>
      <p className="m5-phase" role="status" aria-live="polite">{PHASE_LABELS[ui.phase] ?? ui.phase}</p>
    </header>

    {ui.error !== null && <div className="m5-error" role="alert" data-error-code={ui.error.code}>
      <b>{ui.error.code}</b>
      <span>{ui.error.message}</span>
      <small>{ui.error.next}</small>
      {ui.error.code === "HOST_RESOURCE_EXHAUSTED" || ui.error.code === "INTERNAL_ERROR" ? (
        <button type="button" onClick={() => { setStickyKey(`m5-${crypto.randomUUID()}`); uiStore.patch({ error: null }); }}>
          新建一次请求
        </button>
      ) : null}
    </div>}

    <section className="m5-section" aria-labelledby="m5-atlas-title">
      <h3 id="m5-atlas-title">镜头与章节</h3>
      <input id="narralens-atlas-search" type="search" placeholder="搜索镜头（按 / 聚焦）"
        aria-label="搜索镜头"
        onChange={(event) => uiStore.patch({ intent: event.target.value })} />
      <ul className="m5-atlas">
        {projection.clips.filter((clip) => clip.kind === "page").map((clip) => (
          <li key={clip.clip_id}>
            <button type="button" aria-pressed={selection?.clip_id === clip.clip_id}
              onClick={() => selectClip(clip.clip_id)}>
              <b>{clip.clip_id}</b>
              <span>{clip.source_shot_id === null ? "无源镜头" : `源 ${clip.source_shot_id}`}</span>
              <small>{clip.start_frame}—{clip.end_frame_exclusive} 帧</small>
            </button>
          </li>
        ))}
      </ul>
      <p className="m5-selection">
        当前选区：{selection === null ? "—" : `${selection.clip_id} [${selection.range.start_frame}, ${selection.range.end_frame_exclusive})`}
        {" · "}播放头 {frame} 帧
        {selectedClip === undefined ? "" : ` · ${selectedClip.kind}`}
      </p>
    </section>

    <section className="m5-section" aria-labelledby="m5-director-title">
      <h3 id="m5-director-title">比较与采用</h3>
      <label htmlFor="m5-source-comparison">已录制的 D4.1 提案</label>
      <input id="m5-source-comparison" value={sourceComparisonId}
        placeholder="comparison_…"
        onChange={(event) => setSourceComparisonId(event.target.value)} />
      <label htmlFor="m5-source-revision">提案基线 revision</label>
      <input id="m5-source-revision" type="number" value={sourceComparisonBaseRevision}
        onChange={(event) => setSourceComparisonBaseRevision(Number(event.target.value))} />
      <button type="button" className="m5-primary" disabled={busy !== "" || sourceComparisonId === ""}
        onClick={() => void runReplay()}>
        {busy === "replay" ? "正在复制已录制提案…" : "复制已录制提案到本工程"}
      </button>
      {replay !== undefined && (
        <div className="m5-proposals" role="tablist" aria-label="候选方案">
          <p className="m5-recorded">已录制提案（原始生成审计）· 来源 {replay.lineage.source_comparison_id}</p>
          {proposals.map((proposal) => (
            <article key={proposal.proposal_id} className="m5-proposal">
              <b>{proposal.title}</b>
              <p>{proposal.summary}</p>
              <small>{proposal.segments.length} 段 · {proposal.segments.map((segment) => segment.role).join(" → ")}</small>
            </article>
          ))}
        </div>
      )}
      <button type="button" disabled={busy !== "" || replay === undefined}
        onClick={() => void runMaterialize()}>
        {busy === "materialize" ? "正在素材化…" : "素材化"}
      </button>
      {materialization.materialization_id !== undefined && (
        <p className="m5-facts" data-materialization={String(materialization.materialization_id)}>
          素材化 {String(materialization.materialization_id)} · {String(materialization.state ?? "queued")}
        </p>
      )}
      <button type="button" className="m5-primary"
        disabled={busy !== "" || materialization.materialization_id === undefined}
        onClick={() => void runImpact()}>
        {busy === "impact" ? "正在计算影响…" : "计算影响"}
      </button>
      {impact !== undefined && (
        <div className="m5-impact" data-impact-id={impact.impact_id}>
          <b>影响</b>
          <span>锁 {impact.locks_checked.length} · 受影响片段 {impact.affected_ranges.length}</span>
          <small>影响 {impact.impact_id.slice(0, 12)}…</small>
        </div>
      )}
      <button type="button" className="m5-primary"
        disabled={busy !== "" || impact === undefined}
        onClick={() => void runAdopt()}>
        {busy === "adopt" ? "正在受控采用…" : "确认采用"}
      </button>
    </section>

    <section className="m5-section" aria-labelledby="m5-locks-title">
      <h3 id="m5-locks-title">锁</h3>
      <ul className="m5-locks">
        {projection.active_locks.map((lock) => (
          <li key={lock.lock_id}>
            <b>{lock.lock_type} · {lock.scope}</b>
            <span>{lock.owner_label} · {lock.reason_code}</span>
            <small>{lock.start_frame}—{lock.end_frame_exclusive} 帧 · c{lock.control_revision}</small>
            <button type="button" onClick={() => void releaseLock(lock.lock_id)}>显式释放</button>
          </li>
        ))}
      </ul>
      <button type="button" disabled={busy !== ""} onClick={() => void createLock()}>
        {busy === "lock" ? "正在加锁…" : "加项目级画面锁"}
      </button>
    </section>

    <section className="m5-section" aria-labelledby="m5-history-title">
      <h3 id="m5-history-title">历史</h3>
      <ul className="m5-history">
        {projection.history.map((entry) => (
          <li key={`${entry.revision}-${entry.transaction_id}`}>
            <b>r{entry.revision} · {entry.kind}</b>
            <small>{entry.snapshot_id.slice(0, 12)}…</small>
          </li>
        ))}
      </ul>
      <div className="m5-history-actions">
        <button type="button" disabled={busy !== ""} onClick={() => void runIntent("undo")}>
          {busy === "undo" ? "正在生成恢复意图…" : "准备撤回"}
        </button>
        <button type="button" disabled={busy !== ""} onClick={() => void runIntent("redo")}>
          {busy === "redo" ? "正在生成恢复意图…" : "准备重做"}
        </button>
      </div>
      <p className="m5-fineprint">撤回与重做只生成恢复意图，仍需计算影响并再次确认。</p>
    </section>
  </div>;
}
