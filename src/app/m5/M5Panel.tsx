import type {NativeWorkbenchProjection} from '../../contracts/created-workbench.js';
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComparisonReplayResponseV1, WorkbenchProjectionV1 } from "../../contracts/wave3-types.js";
import type { ImpactSpecV1 } from "../../contracts/wave2-types.js";
import type {
  Context,
  HealthRead,
  ReviewDecision,
  ReviewPackage,
  ReviewPart,
  Workflow,
} from "../../contracts/agent-driven-types.js";
import { GatewayApiClient, GatewayApiError, sha256Hex } from "./GatewayApiClient.js";
import { PlaybackClock, SelectionStore, WorkbenchStore, type SelectionContext } from "./stores.js";
import { SelectionCoordinator, clipOf } from "./SelectionCoordinator.js";
import {
  AgentWorkbenchClient,
  readCandidates,
  readInventoryItems,
  unavailableReason,
  type LocalAssetCandidate,
  type LocalAssetInventoryItem,
  type LocalAssetRegistrationRequest,
  type PreviewMediaDescriptorV1,
} from "../agent-workbench-client.js";
import { WorkflowTopBar } from "../observation/WorkflowTopBar.js";
import { CreativeReviewPanel } from "../observation/CreativeReviewPanel.js";
import { LocalAssetRegistrationPanel } from "../observation/LocalAssetRegistrationPanel.js";
import { NativeSyncIndicator } from "../observation/NativeSyncIndicator.js";
import { SystemControlPanel } from "../system/SystemControlPanel.js";
// The observation and system surfaces are mounted in the panel, so their styles travel
// with the panel's own bundle.
import "../observation/observation.css";
import "../system/system.css";

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
  /**
   * The workbench observation client.
   *
   * When it is absent — or when the Host has no producer for what it asks for — the
   * observation surfaces say so and show nothing. They never show a plausible stand-in.
   */
  readonly ui?: AgentWorkbenchClient;
}

/** The state of the one prepared-preview slot. */
interface PreparedPreview {
  readonly part: ReviewPart;
  readonly descriptor: PreviewMediaDescriptorV1;
  /** The object URL of the verified bytes. It is revoked when the slot is left. */
  readonly url: string;
  readonly label: string;
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

/**
 * The three proxy streams the panel previews.
 *
 * They are the M5C fixtures, served by the Gateway from the fixture directory. The panel
 * names them; it never invents a picture to stand in for a video.
 */
const PROXY_MEDIA = ["proxy-a.mp4", "proxy-b.mp4", "proxy-c.mp4"] as const;

/** The creative names of the five review parts. */
const PART_LABEL: Readonly<Record<ReviewPart["kind"], string>> = {
  preview: "画面",
  narration: "旁白",
  subtitles: "字幕",
  shot_summary: "镜头摘要",
  rights_quality: "来源与质量",
};

/**
 * Why a prepared part may not be previewed, or `null` when it may.
 *
 * The order is the contract's: the identity of the package and the part first, then the
 * product's own digest and length, then the media facts, and only then the comparison
 * with the workbench's one clock. A missing fact is a refusal, never a guess.
 */
function refusePreview(
  descriptor: PreviewMediaDescriptorV1,
  packageDocument: ReviewPackage,
  part: ReviewPart,
  clockFps: { readonly num: number; readonly den: number },
): string | null {
  if (descriptor.project_id !== packageDocument.project_id) return "这份描述属于另一工程。";
  if (descriptor.run_id !== packageDocument.run_id) return "这份描述属于另一次运行。";
  if (descriptor.package_id !== packageDocument.package_id) return "这份描述属于另一个内容包。";
  if (descriptor.package_version !== packageDocument.version) return "这份描述属于另一个版本的包。";
  if (descriptor.part.artifact_ref.id !== part.artifact_ref.id
    || descriptor.part.artifact_ref.version !== part.artifact_ref.version
    || descriptor.part.artifact_ref.sha256 !== part.artifact_ref.sha256) {
    return "这份描述指向的是另一个产物。";
  }
  if (!/^[0-9a-f]{64}$/.test(descriptor.sha256)) return "描述里没有产物摘要。";
  if (!Number.isSafeInteger(descriptor.bytes) || descriptor.bytes <= 0) return "描述里没有产物长度。";
  const facts = descriptor.media_facts;
  if (facts.kind === "video") {
    if (facts.fps.num !== descriptor.timeline.fps.num || facts.fps.den !== descriptor.timeline.fps.den) {
      return "产物的实际帧率与它自己的时间基不一致。";
    }
    if (facts.fps.num !== clockFps.num || facts.fps.den !== clockFps.den) {
      return `产物的实际帧率（${facts.fps.num}/${facts.fps.den}）与工作台时钟（${clockFps.num}/${clockFps.den}）不一致，已拒绝预览。`;
    }
    if (!Number.isSafeInteger(facts.frame_count) || facts.frame_count <= 0) return "描述里没有完整解码帧数。";
    return null;
  }
  if (facts.kind === "audio") {
    if (!Number.isSafeInteger(facts.sample_rate) || facts.sample_rate <= 0) return "描述里没有实际采样率。";
    if (!Number.isSafeInteger(facts.sample_count) || facts.sample_count <= 0) return "描述里没有实际样本数。";
    if (!Number.isSafeInteger(facts.channels) || facts.channels <= 0) return "描述里没有声道数。";
    return null;
  }
  if (part.kind === "preview" || part.kind === "narration") return "这一部分没有真实的媒体事实，不能预览。";
  return null;
}

/**
 * The opaque reference of the controlled media, or `null`.
 *
 * The media alias addresses an object by an opaque id; a relative path, a `file:` URL
 * or a foreign address is not one, and is not turned into one.
 */
function mediaRefOf(downloadRef: string | null): string | null {
  if (downloadRef === null) return null;
  const tail = downloadRef.slice(downloadRef.lastIndexOf("/") + 1);
  return /^[A-Za-z0-9_-]{1,200}$/.test(tail) ? tail : null;
}

const PHASE_LABELS: Record<string, string> = {  proposal_only: "仅有已录制提案",
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

/**
 * The stage router (Wave 3 `01` §5, `04` §5).
 *
 * The M5 URL is `#/idea` and `#/refine/:target_project_id`. The hash lives on the
 * Studio's own page, so the *panel* routes inside it: the native editor stays behind
 * either stage, and the panel is the Narralens side of the page.
 *
 * The idea stage is a draft and an opening action. It never creates a blank project —
 * that is M6/M7's work — and it never pretends the draft is a project.
 */
export type M5Stage = "idea" | "refine" | "delivery-preview";

export function stageFromHash(hash: string): { stage: M5Stage; target: string } {
  const value = hash.replace(/^#\/?/u, "");
  if (value.startsWith("refine/")) return { stage: "refine", target: value.slice("refine/".length) };
  if (value.startsWith("delivery-preview/")) {
    return { stage: "delivery-preview", target: value.slice("delivery-preview/".length) };
  }
  return { stage: "idea", target: "" };
}

/** Read the stage from the hash, and follow it when it changes. */
export function useStage(): { stage: M5Stage; target: string } {
  const read = (): { stage: M5Stage; target: string } => {
    const controlled=(window as {narralensNativeTransport?:{projectId?:string}}).narralensNativeTransport;
    if(controlled?.projectId)return {stage:'refine',target:controlled.projectId};
    return stageFromHash(window.location.hash);
  };
  const [value, setValue] = useState(read);
  useEffect(() => {
    const onHash = (): void => setValue(read());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return value;
}

export function M5Panel({ client, targetProjectId, ui: uiProp }: M5PanelProps): React.JSX.Element {
  const api = useMemo(() => client ?? new GatewayApiClient(), [client]);
  const stage = useStage();
  const target = useMemo(() => {
    if (targetProjectId !== undefined && targetProjectId !== "") return targetProjectId;
    if (stage.stage === "refine" && stage.target !== "") return stage.target;
    const fromBridge = (window as { narralensTarget?: string }).narralensTarget;
    if (fromBridge !== undefined && fromBridge !== "") return fromBridge;
    return new URLSearchParams(window.location.search).get("target") ?? "";
  }, [stage.stage, stage.target, targetProjectId]);

  const [projection, setProjection] = useState<NativeWorkbenchProjection>();
  const [blocked, setBlocked] = useState<string>("");
  const [replay, setReplay] = useState<ComparisonReplayResponseV1>();
  const [materialization, setMaterialization] = useState<{
    materialization_id?: string; state?: string; [key: string]: unknown;
  }>({});
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
  /** What the native Studio last reported, in its own words. */
  const [studioSelection, setStudioSelection] = useState<{ clipId: string; seconds: number } | null>(null);
  /** Which proxy holds the audio focus. Exactly one does. */
  const [focusedProxy, setFocusedProxy] = useState(0);
  /** The restore intent the undo or the redo produced. It is an intent, not a change. */
  const [restoreIntent, setRestoreIntent] = useState<{ target_snapshot_id: string } | null>(null);
  /** The last key the panel handled. It is published so the page's state can be read. */
  const [lastKey, setLastKey] = useState("");
  // ── the workbench observation surfaces ──────────────────────────────────────────────
  /** The real workflow, when the Host produced one. */
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [context, setContext] = useState<Context | null>(null);
  const [health, setHealth] = useState<HealthRead | null>(null);
  const [review, setReview] = useState<ReviewPackage | null>(null);
  const [reviewDecision, setReviewDecision] = useState<ReviewDecision | null>(null);
  /** Why the observation surfaces show what they show. It is never empty. */
  const [observation, setObservation] = useState("");
  const [systemOpen, setSystemOpen] = useState(false);
  /** The one prepared-preview slot. There is never a second one. */
  const [preview, setPreview] = useState<PreparedPreview | null>(null);
  /** The reason a preview was refused, in the operator's words. */
  const [previewReason, setPreviewReason] = useState("");
  /** The clock the health panel judges staleness against. */
  const [nowMs, setNowMs] = useState(() => Date.now());
  /** The controlled local-asset candidates and the registered inventory. */
  const [candidates, setCandidates] = useState<readonly LocalAssetCandidate[]>([]);
  const [localInventory, setLocalInventory] = useState<readonly LocalAssetInventoryItem[]>([]);
  const [localAssetError, setLocalAssetError] = useState<string | null>(null);
  const [localAssetNotice, setLocalAssetNotice] = useState<string | null>(null);
  const previewSlot = useRef<HTMLVideoElement | null>(null);
  /** Whether the panel is in review mode: the native editor is not driven. */
  const reviewMode = useRef(false);
  /** The last clip the native editor reported, so a real change can be seen. */
  const lastNativeClip = useRef<string | null>(null);
  const [theme, setTheme] = useState<"system" | "dark" | "light">(() => {
    const saved = window.localStorage.getItem("narralens.m5.theme");
    return saved === "dark" || saved === "light" ? saved : "system";
  });
  const proxyRefs = useRef<(HTMLVideoElement | null)[]>([]);
  /**
   * The clip the panel has asked the native editor to select.
   *
   * The Studio reports its selection a few times a second, and until it has processed the
   * command its report still names the *old* clip. Overwriting the panel's selection with
   * that report would make the panel's own click a no-op. So the panel waits for the
   * editor to confirm — and gives up after two seconds, because a clip the editor does not
   * have must not freeze the panel.
   */
  const pendingClip = useRef<{ clipId: string; until: number } | null>(null);

  useEffect(() => selectionStore.subscribe((value) => setSelection(value)), [selectionStore]);
  useEffect(() => uiStore.subscribe((value) => setUi(value)), [uiStore]);
  useEffect(() => clock.onFrame((value) => setFrame(value)), [clock]);
  useEffect(() => {
    window.localStorage.setItem("narralens.m5.theme", theme);
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }, [theme]);

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

  /**
   * The observation client.
   *
   * It speaks the closed UI RPC over the Gateway with the independent UI proof. When
   * this tab has no UI credential — a native-only entry — the calls fail, and the
   * surfaces say that instead of showing something plausible.
   */
  const uiClient = useMemo<AgentWorkbenchClient | undefined>(() => {
    if (uiProp !== undefined) return uiProp;
    if (target === "") return undefined;
    return new AgentWorkbenchClient(
      { call: (surface, operation, input) => api.uiCall(surface, operation, input) },
      target,
    );
  }, [api, target, uiProp]);

  // The observation facts. Each read settles on its own: one missing producer does not
  // blank the others.
  useEffect(() => {
    if (uiClient === undefined) {
      setObservation("工作台观察入口未就绪：本次打开的工程没有独立的工作台界面授权。");
      return;
    }
    let cancelled = false;
    const settle = async <T,>(read: () => Promise<T>, apply: (value: T) => void): Promise<void> => {
      try { const value = await read(); if (!cancelled) apply(value); }
      catch (reason) { if (!cancelled) setObservation(unavailableReason(reason)); }
    };
    void settle(() => uiClient.readWorkflow(), setWorkflow);
    void settle(() => uiClient.readContext(), setContext);
    void settle(() => uiClient.readHealth(), setHealth);
    return () => { cancelled = true; };
  }, [uiClient]);

  // The review package is named by a real gate. It is never guessed.
  useEffect(() => {
    if (uiClient === undefined || context === null) return;
    const run = context.active_run;
    const gate = run?.gates.find((candidate) => candidate.review_package_id !== null);
    if (run === null || run === undefined || gate?.review_package_id == null) { setReview(null); return; }
    let cancelled = false;
    void uiClient.readReview(run.run_id, gate.review_package_id)
      .then((document_) => { if (!cancelled) setReview(document_); })
      .catch(() => { if (!cancelled) setReview(null); });
    return () => { cancelled = true; };
  }, [context, uiClient]);

  // The three proxies: all of them play, one of them has the audio, and one that leaves
  // the viewport is paused. The observer is the browser's own, so "off screen" means what
  // it means to the page.
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const element = entry.target as HTMLVideoElement;
        if (entry.isIntersecting) { void element.play().catch(() => undefined); }
        else element.pause();
      }
    }, { threshold: 0.01 });
    for (const element of proxyRefs.current) {
      if (element !== null && element !== undefined) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [projection === undefined]);
  useEffect(() => {
    for (const [index, element] of proxyRefs.current.entries()) {
      if (element === null || element === undefined) continue;
      element.muted = index !== focusedProxy;
      void element.play().catch(() => undefined);
    }
  }, [focusedProxy, projection === undefined]);
  useEffect(() => {
    if (target === "") return;
    void api.inventory(target)
      .then((value) => { setInventory(value.assets); uiStore.patch({ error: null }); })
      .catch((reason) => { fail(reason); });
  }, [api, fail, target, uiStore]);

  // The materialization's own status. The page shows the real state and never a made-up
  // percentage, and the impact button only opens once the worker has really finished.
  useEffect(() => {
    const id = materialization.materialization_id;
    if (id === undefined || projection === undefined) return;
    let cancelled = false;
    const poll = async (): Promise<void> => {
      for (;;) {
        const status = await api.materialization(id, projection.project_id).catch(() => undefined);
        if (cancelled || status === undefined) return;
        setMaterialization((current) => ({ ...current, ...status }));
        const state = String(status.state ?? "");
        if (["ready_for_adoption", "failed", "cancelled", "attention"].includes(state)) return;
        await new Promise((done) => setTimeout(done, 1_000));
      }
    };
    void poll();
    return () => { cancelled = true; };
  }, [materialization.materialization_id, projection, api]);

  // The native Studio's selection, in frames. The conversion happens at the boundary.
  useEffect(() => {
    const onSelection = (event: Event): void => {
      const detail = (event as CustomEvent<StudioSelectionEvent>).detail;
      if (!projection) return;
      const clipId = detail.refs?.find((ref) => ref.kind === "clip")?.id ?? null;
      if (reviewMode.current) {
        // In review mode the native report does not write the selection. A report that
        // names a *different* clip means the native timeline really moved: the preview
        // stops there, and the clock is left where it was.
        if (clipId !== null && clipId !== "" && clipId !== lastNativeClip.current) {
          lastNativeClip.current = clipId;
          closePreview();
        }
        return;
      }
      lastNativeClip.current = clipId ?? null;
      const range = detail.range;
      const fps = projection.fps;
      const toFrame = (seconds: number | undefined): number =>
        seconds === undefined ? 0 : Math.max(0, Math.floor(seconds * fps.num / fps.den));
      const pending = pendingClip.current;
      if (pending !== null) {
        if (pending.clipId === clipId) pendingClip.current = null;
        else if (Date.now() < pending.until) {
          // The editor has not confirmed yet: its report still names the previous clip.
          setStudioSelection({ clipId: clipId ?? "", seconds: detail.time ?? 0 });
          return;
        } else pendingClip.current = null;
      }
      const next = coordinator.selectFromStudio(projection, {
        clipId: clipId ?? "",
        startFrame: toFrame(range?.start ?? detail.time),
        endFrameExclusive: toFrame(range?.end ?? detail.time),
      });
      setStudioSelection({ clipId: clipId ?? "", seconds: detail.time ?? 0 });
      // The Studio's report sets the *base* when the clip changes. It does not move the
      // panel's clock on every report: the Studio reports a few times a second, and a
      // clock that is overwritten that often is not a clock the operator can step.
      if (next !== null && next.clip_id !== coordinator.current?.clip_id) {
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
      setLastKey(`${event.key}:${event.shiftKey ? "shift" : "plain"}`);
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
        if (!projection) return;
        event.preventDefault();
        // The clock is the authority for the playhead; the selection follows it out of
        // the clip it was in. One frame per press, one second (thirty frames) with Shift.
        const step = event.shiftKey ? projection.fps.num : 1;
        const last = Math.max(0, projection.frame_count - 1);
        const next = Math.max(0, Math.min(last, clock.frame + (event.key === "ArrowLeft" ? -step : step)));
        clock.seek(next);
        setFrame(next);
        const clip = projection.clips.find((candidate) =>
          next >= candidate.start_frame && next < candidate.end_frame_exclusive);
        if (!reviewMode.current && clip !== undefined && clip.clip_id !== coordinator.current?.clip_id) {
          coordinator.selectClip(projection, clip.clip_id, {
            start_frame: next, end_frame_exclusive: next + 1,
          });
        }
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        // The browser's undo is for the *draft*; a committed change goes through the
        // history intent, impact and confirmation.
        event.preventDefault();
        return;
      }
      if (event.key.toLowerCase() === "f" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        // Pinned OpenFilm names timeline fit as Shift+Z. M5's approved shortcut is F,
        // so the bridge translates it without creating a second timeline command.
        event.preventDefault();
        window.dispatchEvent(new KeyboardEvent("keydown", {
          key: "Z", code: "KeyZ", shiftKey: true, bubbles: true, cancelable: true,
        }));
      }
    };
    // The capture phase, on purpose: the Studio binds the arrow keys for its own
    // playhead and stops their propagation, so a bubble-phase listener on `window`
    // would never hear them.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [clock, coordinator, projection]);

  const selectClip = useCallback((clipId: string): void => {
    if (!projection) return;
    // In review mode the native editor is not driven: the preview owns the clock, and
    // the author's selection stays where it was.
    if (reviewMode.current) return;
    const next = coordinator.selectClip(projection, clipId);
    if (next === null) return;
    clock.seek(next.range.start_frame);
    setFrame(next.range.start_frame);
    // The native timeline follows: the Studio is told what to select, and the panel waits
    // for the editor to confirm before it believes the editor's next report.
    pendingClip.current = { clipId, until: Date.now() + 3_000 };
    const studio = (window as { narralensStudio?: { command: (command: unknown) => void } }).narralensStudio;
    if (studio === undefined) return;
    // The editor may still be loading its timeline, so the panel asks again until the
    // editor confirms. Three asks, 600ms apart: an editor that never confirms is an
    // editor that does not have the clip, and the panel must not wait forever.
    let attempt = 0;
    const ask = (): void => {
      studio.command({ type: "select-clip", id: clipId, seek: true });
      attempt += 1;
      if (attempt >= 3) return;
      window.setTimeout(() => {
        if (pendingClip.current?.clipId === clipId) ask();
      }, 600);
    };
    ask();
  }, [clock, coordinator, projection]);

  // ── the one prepared-preview slot ────────────────────────────────────────────────────

  /** Leave the preview. The object URL is released and the clock is left where it was. */
  const closePreview = useCallback((): void => {
    reviewMode.current = false;
    setPreview((current) => {
      if (current !== null) URL.revokeObjectURL(current.url);
      return null;
    });
  }, []);

  /**
   * Open one prepared part.
   *
   * The order is the contract's: the descriptor first, then the identity and the
   * timeline checks, then the bytes, and only then the object URL. A refusal at any
   * step leaves the slot empty and says why.
   */
  const openPreparedPart = useCallback(async (part: ReviewPart): Promise<void> => {
    if (uiClient === undefined) { setPreviewReason("工作台观察入口未就绪，无法读取准备内容。"); return; }
    if (review === null) { setPreviewReason("当前没有待审阅的包。"); return; }
    setPreviewReason("");
    let descriptor: PreviewMediaDescriptorV1;
    try {
      descriptor = await uiClient.describePart({
        run_id: review.run_id,
        package_id: review.package_id,
        package_version: review.version,
        part_kind: part.kind,
        artifact_ref: part.artifact_ref,
      });
    } catch (reason) {
      setPreviewReason(`无法取得该部分的真实描述：${unavailableReason(reason)}`);
      return;
    }
    const refusal = refusePreview(descriptor, review, part, clock.fps);
    if (refusal !== null) { setPreviewReason(refusal); return; }
    const ref = mediaRefOf(part.download_ref);
    if (ref === null) { setPreviewReason("该部分没有可读取的受控媒体地址。"); return; }
    try {
      const media = await api.reviewMedia(ref);
      const digest = await sha256Hex(media.bytes);
      if (digest !== descriptor.sha256 || media.bytes.byteLength !== descriptor.bytes) {
        setPreviewReason("读取到的字节与描述不符，已拒绝预览。");
        return;
      }
      if (media.etag !== `"${descriptor.sha256}"`) {
        setPreviewReason("媒体标识与描述不符，已拒绝预览。");
        return;
      }
      const url = URL.createObjectURL(new Blob([new Uint8Array(media.bytes).buffer as ArrayBuffer], { type: descriptor.content_type }));
      setPreview((current) => {
        if (current !== null) URL.revokeObjectURL(current.url);
        return { part, descriptor, url, label: PART_LABEL[part.kind] };
      });
      reviewMode.current = true;
    } catch (reason) {
      setPreviewReason(`读取预览失败：${unavailableReason(reason)}`);
    }
  }, [api, clock.fps, review, uiClient]);

  // The slot's media element follows the one clock. It is never played automatically.
  useEffect(() => {
    const element = previewSlot.current;
    if (element === null || preview === null) return;
    const seconds = clock.seconds;
    if (Number.isFinite(seconds) && Math.abs(element.currentTime - seconds) > 0.05) {
      element.currentTime = seconds;
    }
  }, [clock, frame, preview]);

  // Leaving the page releases the object URL.
  useEffect(() => () => {
    setPreview((current) => {
      if (current !== null) URL.revokeObjectURL(current.url);
      return null;
    });
  }, []);

  // The health sample is judged against the clock; the clock ticks so a stale sample
  // becomes unknown on its own.
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);

  // ── the local assets and the review decision ───────────────────────────────────────

  /** Re-read the controlled candidates and the registered inventory. */
  const loadLocalAssets = useCallback(async (): Promise<void> => {
    if (uiClient === undefined) { setLocalAssetError("工作台观察入口未就绪，无法读取素材清单。"); return; }
    try {
      const [sourceFiles, assets] = await Promise.all([uiClient.readLocalSourceFiles(), uiClient.readLocalAssets()]);
      setCandidates(readCandidates(sourceFiles));
      setLocalInventory(readInventoryItems(assets));
      setLocalAssetError(null);
    } catch (reason) {
      setLocalAssetError(unavailableReason(reason));
    }
  }, [uiClient]);

  useEffect(() => { void loadLocalAssets(); }, [loadLocalAssets]);

  /**
   * Register one declared local asset.
   *
   * The request key is the Host's business; what matters here is that an unknown
   * outcome is reported as unknown and the inventory is re-read, rather than the
   * declaration being declared successful.
   */
  const registerLocalAsset = useCallback(async (request: LocalAssetRegistrationRequest): Promise<void> => {
    if (uiClient === undefined) { setLocalAssetError("工作台观察入口未就绪，无法登记素材。"); return; }
    setBusy("local-asset");
    setLocalAssetError(null);
    setLocalAssetNotice(null);
    try {
      await uiClient.importLocalAsset(request);
      setLocalAssetNotice("声明已提交：登记是否成功以清单为准。结果未知时保留同一次请求键，先对账。");
      await loadLocalAssets();
    } catch (reason) {
      setLocalAssetError(unavailableReason(reason));
    } finally { setBusy(""); }
  }, [loadLocalAssets, uiClient]);

  /**
   * Record one decision about the package under review.
   *
   * The same package and the same choice keep the same request key, so an unknown
   * result is reconciled with the same key instead of being re-sent under a new one.
   */
  const decisionKeys = useRef(new Map<string, string>());
  const decideReview = useCallback(async (
    choice: "accept" | "changes_requested" | "reject" | "accept_and_adopt",
  ): Promise<void> => {
    if (uiClient === undefined || review === null) return;
    const slot = `${review.package_id}@${review.version}:${choice}`;
    const idempotency_key = decisionKeys.current.get(slot) ?? `m5-${crypto.randomUUID()}`;
    decisionKeys.current.set(slot, idempotency_key);
    setBusy("review");
    try {
      const decision = await uiClient.decideReview({
        meta: { idempotency_key, correlation_id: crypto.randomUUID() },
        package: review,
        choice,
      });
      setReviewDecision(decision);
    } catch (reason) { fail(reason); }
    finally { setBusy(""); }
  }, [fail, review, uiClient]);

  /**
   * What is known about the adoption.
   *
   * A recorded decision that asked for adoption leaves the adoption *pending*: the
   * commit and the native acknowledgement are separate facts, and neither is produced
   * on this path in R1.
   */
  const adoption = reviewDecision === null ? null : {
    state: (reviewDecision.choice === "accept_and_adopt" ? "requested" : "not_requested") as
      "requested" | "not_requested",
    reason: reviewDecision.choice === "accept_and_adopt"
      ? "决定已登记；实际提交与原生确认尚未取得，采用保持待完成。"
      : "这次决定没有请求采用。",
  };

  // The recorded comparison the page replays. It is named by the operator, and it is
  // always an *existing* D4.1 recording: M5 never calls a provider.
  const [sourceComparisonId, setSourceComparisonId] = useState("");

  const runReplay = useCallback(async (): Promise<void> => {
    if (!projection) return;
    setBusy("replay");
    try {
      const response = await api.replay(projection.project_id, {
        format: "narralens.comparison-replay-request@1.0",
        source_comparison_id: sourceComparisonId,
        // The page states the target's own revision: the recording's baseline is checked by
        // the Host against the migration plan, so the operator does not have to know it.
        base_revision: projection.revision,
        idempotency_key: `${stickyKey}-replay`,
      });
      setReplay(response);
      uiStore.patch({ phase: "proposal_only", error: null });
    } catch (reason) { fail(reason); }
    finally { setBusy(""); }
  }, [api, fail, projection, sourceComparisonId, stickyKey, uiStore]);

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
      // The page refreshes *before* it says so: "已采用" must mean the projection the
      // operator is looking at is the one the write produced.
      await load();
      uiStore.patch({ phase: "adopted", error: null });
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
      setRestoreIntent({ target_snapshot_id: intent.target_snapshot_id });
    } catch (reason) { fail(reason); }
    finally { setBusy(""); }
  }, [api, fail, projection, uiStore]);

  const runRestoreImpact = useCallback(async (): Promise<void> => {
    if (!projection || restoreIntent === null) return;
    setBusy("restore-impact");
    try {
      const spec = await api.impact(projection.project_id, {
        format: "narralens.impact-request@1.0",
        base_revision: projection.revision,
        expected_source_digest: projection.source_digest,
        control_revision: projection.control_revision,
        intent: { op: "restore_snapshot", target_snapshot_id: restoreIntent.target_snapshot_id },
        idempotency_key: `${stickyKey}-restore-impact`,
      });
      setImpact(spec);
      uiStore.patch({ phase: "approval_required", error: null });
    } catch (reason) { fail(reason); }
    finally { setBusy(""); }
  }, [api, fail, projection, restoreIntent, stickyKey, uiStore]);

  const runRestore = useCallback(async (): Promise<void> => {
    if (!projection || restoreIntent === null || impact === undefined) return;
    setBusy("restore");
    try {
      await api.nativeWrite("history.restore", projection.project_id, {
        format: "narralens.restore-request@1.0",
        base_revision: projection.revision,
        expected_source_digest: projection.source_digest,
        control_revision: projection.control_revision,
        target_snapshot_id: restoreIntent.target_snapshot_id,
        impact_id: impact.impact_id,
        impact_hash: impact.impact_hash,
        approval: { confirmed: true },
        idempotency_key: `${stickyKey}-restore`,
      });
      await load();
      uiStore.patch({ phase: "adopted", error: null });
      setRestoreIntent(null);
      setImpact(undefined);
    } catch (reason) { fail(reason); }
    finally { setBusy(""); }
  }, [api, fail, impact, load, projection, restoreIntent, stickyKey, uiStore]);

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
  const pageClips = projection === undefined ? [] : projection.clips.filter((clip) => clip.kind === "page");
  const chapters = pageClips.length < 20 ? [] : Array.from(
    { length: Math.ceil(pageClips.length / 20) }, (_, index) => ({
      id: `chapter-${index + 1}`, title: `第 ${index + 1} 章`, first: pageClips[index * 20],
    }));
  const atlasClips = pageClips.filter((clip) => {
    const query = ui.atlasQuery.trim().toLowerCase();
    if (query === "") return true;
    return clip.clip_id.toLowerCase().includes(query)
      || (clip.source_shot_id ?? "").toLowerCase().includes(query)
      || (clip.source_label ?? "").toLowerCase().includes(query);
  });

  if (blocked !== "") {
    return <div className="m5-panel" data-narralens-panel="blocked">
      <h2>Narralens</h2>
      <p role="alert" className="m5-error">{blocked}</p>
    </div>;
  }
  if (stage.stage === "idea") {
    return <div className="m5-panel" data-narralens-panel="idea" data-stage="idea">
      <header className="m5-head">
        <h2>想法草稿</h2>
        <p className="m5-facts"><span>本阶段不创建空白工程</span></p>
      </header>
      <section className="m5-section">
        <label htmlFor="narralens-idea-draft">草稿（仅保存在本机，不会被当作已建工程）</label>
        <textarea id="narralens-idea-draft" rows={6} value={ui.intent}
          placeholder="写下你的导演意图…"
          onChange={(event) => uiStore.patch({ intent: event.target.value })} />
        <p className="m5-fineprint">草稿不会伪装成已生成的工程；空白工程的创建属于 M6/M7。</p>
        <button type="button" className="m5-primary" disabled={target === ""}
          onClick={() => { window.location.hash = `#/refine/${encodeURIComponent(target)}`; }}>
          打开已迁移的 OpenFilm 工程
        </button>
        {target === "" ? <p className="m5-fineprint">这个页面没有指向任何已迁移工程。</p> : null}
      </section>
    </div>;
  }
  if (stage.stage === "delivery-preview") {
    return <div className="m5-panel" data-narralens-panel="delivery-preview" data-stage="delivery-preview">
      <header className="m5-head"><h2>交付预览</h2></header>
      <section className="m5-section">
        <p>交付导出尚未开放：M5 只做同页精修与受控采用，不做渲染、标题、封面或 preflight。</p>
        <p className="m5-fineprint">这一页不会提供假的导出按钮。</p>
      </section>
    </div>;
  }
  if (projection === undefined) {
    return <div className="m5-panel" data-narralens-panel="loading"><h2>Narralens</h2><p>正在读取工作台…</p></div>;
  }

  return <div className="m5-panel" data-narralens-panel="ready" data-stage="refine" data-phase={projection.format==='narralens.created-workbench@1.0'?'not_started':ui.phase}
    data-target={projection.project_id} data-revision={projection.revision}
    data-control-revision={projection.control_revision}
    data-selection-clip={selection?.clip_id ?? ""}
    data-selection-source-shot={selection?.source_shot_id ?? ""}
    data-selection-range={selection === null
      ? "" : `${selection.range.start_frame}-${selection.range.end_frame_exclusive}`}
    data-playhead={frame}
    data-locks={projection.active_locks.length}
    data-inventory={inventory.length}
    data-last-key={lastKey}
    data-history={projection.history.length}
    data-studio-selection={studioSelection === null ? "" : studioSelection.clipId}
    data-studio-seconds={studioSelection === null ? "" : String(studioSelection.seconds)}>
    {workflow === null ? null : (
      <WorkflowTopBar workflow={workflow} connection="connected" />
    )}
    {observation === "" ? null : (
      <p className="nl-muted" data-nl-observation="unavailable" role="status">{observation}</p>
    )}

    <section className="m5-section" aria-labelledby="m5-system-title">
      <h3 id="m5-system-title">系统</h3>
      <button type="button" aria-expanded={systemOpen} onClick={() => setSystemOpen(!systemOpen)}>
        {systemOpen ? "收起系统面板" : "打开系统面板（可继续剪辑）"}
      </button>
      <SystemControlPanel
        health={health}
        nowMs={nowMs}
        open={systemOpen}
        onClose={() => setSystemOpen(false)}
      />
      <NativeSyncIndicator context={context} />
    </section>

    {projection.format === "narralens.created-workbench@1.0" ? (
      <section className="m5-section" aria-labelledby="m5-preview-title">
        <h3 id="m5-preview-title">准备预览</h3>
        <p className="nl-muted">准备预览，尚未采用：预览只占用下面这一个槽位，不接管原生时间线。</p>
        {preview === null ? null : (
          <figure data-nl-prepared-preview={preview.part.kind}>
            <video ref={previewSlot} src={preview.url} controls playsInline preload="auto" />
            <figcaption>
              {preview.label} · {preview.descriptor.timeline.fps.num}/{preview.descriptor.timeline.fps.den} ·
              {" "}{preview.descriptor.media_facts.kind}
            </figcaption>
            <button type="button" onClick={closePreview}>退出预览</button>
          </figure>
        )}
        {previewReason === "" ? null : (
          <p className="nl-muted" role="status" data-nl-preview-reason="true">{previewReason}</p>
        )}
      </section>
    ) : null}

    {review === null ? null : (
      <CreativeReviewPanel
        package={review}
        decision={reviewDecision}
        adoption={adoption}
        onOpenPart={(part) => void openPreparedPart(part)}
        onAccept={() => void decideReview("accept")}
        onRequestChanges={() => void decideReview("changes_requested")}
        onReject={() => void decideReview("reject")}
        onAcceptAndAdopt={() => void decideReview("accept_and_adopt")}
      />
    )}

    <LocalAssetRegistrationPanel
      projectId={projection.project_id}
      candidates={candidates}
      inventory={localInventory}
      busy={busy === "local-asset"}
      error={busy === "local-asset" ? null : localAssetError}
      notice={localAssetNotice}
      onRegister={registerLocalAsset}
      onRefresh={() => void loadLocalAssets()}
    />

    <header className="m5-head">
      <h2>Narralens 导演面板</h2>
      <label className="m5-theme">主题
        <select aria-label="主题" value={theme}
          onChange={(event) => setTheme(event.target.value as "system" | "dark" | "light")}>
          <option value="system">跟随系统</option><option value="dark">深色</option><option value="light">浅色</option>
        </select>
      </label>
      <p className="m5-facts">
        <span>target {projection.project_id}</span>
        <span>{projection.format==='narralens.created-workbench@1.0'?'新建工程':`source ${projection.source_project_id}`}</span>
        <span>r{projection.revision} · c{projection.control_revision}</span>
        <span>{projection.frame_count} 帧 · 旁白 {projection.narration === "present" ? "有" : projection.narration === "absent" ? "无" : "未知"}</span>
      </p>
      <p className="m5-phase" role="status" aria-live="polite">{projection.format==='narralens.created-workbench@1.0'?'尚未开始制作；原生版本待确认':PHASE_LABELS[ui.phase] ?? ui.phase}</p>
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
        value={ui.atlasQuery}
        onChange={(event) => uiStore.patch({ atlasQuery: event.target.value })} />
      {chapters.length > 0 ? <nav className="m5-chapters" aria-label="章节导航">
        {chapters.map((chapter) => <button type="button" key={chapter.id}
          data-chapter-id={chapter.id}
          onClick={() => { if (chapter.first !== undefined) selectClip(chapter.first.clip_id); }}>
          {chapter.title}
        </button>)}
      </nav> : null}
      <ul className="m5-atlas">
        {atlasClips.map((clip) => (
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
      {atlasClips.length === 0
        ? <p className="m5-fineprint" data-narralens-atlas="empty">没有匹配的镜头：这里不显示任何推测的结果。</p>
        : null}
      <p className="m5-selection">
        当前选区：{selection === null ? "—" : `${selection.clip_id} [${selection.range.start_frame}, ${selection.range.end_frame_exclusive})`}
        {" · "}播放头 {frame} 帧
        {selectedClip === undefined ? "" : ` · ${selectedClip.kind}`}
      </p>
    </section>

    {projection.format==='narralens.workbench@1.0'&&<><section className="m5-section" aria-labelledby="m5-proxy-title">
      <h3 id="m5-proxy-title">三路真实 proxy</h3>
      <p className="m5-fineprint">三路同时播放，只有一路持有音频焦点；离开视口的一路会暂停。</p>
      <div className="m5-proxies">
        {PROXY_MEDIA.map((name, index) => (
          <figure key={name} data-narralens-proxy={name}
            data-narralens-proxy-focus={index === focusedProxy ? "true" : "false"}
            onClick={() => setFocusedProxy(index)}>
            <video ref={(element) => { proxyRefs.current[index] = element; }}
              src={`/narralens/media/${name}`} muted={index !== focusedProxy}
              preload="auto" playsInline loop
              onError={(event) => { event.currentTarget.setAttribute("data-unavailable", "true"); }} />
            <figcaption>{name}</figcaption>
          </figure>
        ))}
      </div>
    </section>

    <section className="m5-section" aria-labelledby="m5-director-title">
      <h3 id="m5-director-title">比较与采用</h3>
      <label htmlFor="m5-source-comparison">已录制的 D4.1 提案</label>
      <input id="m5-source-comparison" value={sourceComparisonId}
        placeholder="comparison_…"
        onChange={(event) => setSourceComparisonId(event.target.value)} />
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

    </>}

    <section className="m5-section" aria-labelledby="m5-locks-title">
      <h3 id="m5-locks-title">锁</h3>
      <ul className="m5-locks">
        {projection.active_locks.map((lock) => (
          <li key={lock.lock_id}>
            <b>{lock.lock_type} · {lock.scope}</b>
            <span>{lock.owner_label} · {lock.reason_code}</span>
            <small>{lock.start_frame}—{lock.end_frame_exclusive} 帧 · c{lock.control_revision}</small>
            <button type="button" disabled={projection.format!=='narralens.workbench@1.0'} onClick={() => void releaseLock(lock.lock_id)}>显式释放</button>
          </li>
        ))}
      </ul>
      <button type="button" disabled={busy !== ""||projection.format!=='narralens.workbench@1.0'} onClick={() => void createLock()}>
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
        <button type="button" disabled={busy !== ""||projection.format!=='narralens.workbench@1.0'} onClick={() => void runIntent("undo")}>
          {busy === "undo" ? "正在生成恢复意图…" : "准备撤回"}
        </button>
        <button type="button" disabled={busy !== ""||projection.format!=='narralens.workbench@1.0'} onClick={() => void runIntent("redo")}>
          {busy === "redo" ? "正在生成恢复意图…" : "准备重做"}
        </button>
      </div>
      {restoreIntent !== null && (
        <div className="m5-impact" data-narralens-restore-intent={restoreIntent.target_snapshot_id}>
          <b>已生成恢复意图</b>
          <span>目标快照 {restoreIntent.target_snapshot_id.slice(0, 12)}…</span>
          <small>意图不是撤回：仍需计算影响并再次确认。</small>
          <button type="button" disabled={busy !== ""} onClick={() => void runRestoreImpact()}>
            {busy === "restore-impact" ? "正在计算恢复影响…" : "计算恢复影响"}
          </button>
          <button type="button" className="m5-primary" disabled={busy !== "" || impact === undefined}
            onClick={() => void runRestore()}>
            {busy === "restore" ? "正在恢复…" : "确认恢复"}
          </button>
        </div>
      )}
      <p className="m5-fineprint">撤回与重做只生成恢复意图，仍需计算影响并再次确认。</p>
    </section>
  </div>;
}
