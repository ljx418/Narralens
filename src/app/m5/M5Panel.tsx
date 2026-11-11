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
  unavailableReason,
  type LocalAssetCandidate,
  type LocalAssetInventoryItem,
  type LocalAssetRegistrationRequest,
  type PreparedPreviewMediaFactsV1,
  type PreviewMediaDescriptorV1,
} from "../agent-workbench-client.js";
import { WorkflowTopBar } from "../observation/WorkflowTopBar.js";
import { CreativeReviewPanel } from "../observation/CreativeReviewPanel.js";
import { LocalAssetRegistrationPanel } from "../observation/LocalAssetRegistrationPanel.js";
import { NativeSyncIndicator } from "../observation/NativeSyncIndicator.js";
import { PreparedTextView } from "../observation/content-views.js";
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
  /**
   * The object URL of the verified bytes. It is revoked when the slot is left.
   *
   * It is `null` for a text or JSON product: those are shown as text, never as media.
   */
  readonly url: string | null;
  /** The decoded text of a text or JSON product. */
  readonly text: string | null;
  readonly label: string;
}

/**
 * The opaque token of a controlled media reference.
 *
 * The frozen `ReviewPart.download_ref` is a token, not a path and not a URL. An
 * arbitrary address is never turned into one by taking its tail: only the token itself
 * is followed, and only through this instance's own controlled route.
 */
const CONTROLLED_REF = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

/**
 * How far the native timeline may report and still be "the same place".
 *
 * The Studio reports a few times a second, and a report of the same value is not a user
 * action. A frame at thirty frames a second is a thirtieth of a second, so a smaller
 * difference than that is the same place.
 */
const NATIVE_EPSILON = 0.05;

/**
 * Why the local-asset read failed, told truthfully.
 *
 * An expired candidate or an expired cursor is its own case: the Host answered `410`,
 * and the operator has to refresh rather than retry.
 */
function localAssetFailure(reason: unknown): string {
  if (isExpired(reason)) {
    return "候选或游标已过期：请刷新候选与清单。";
  }
  return unavailableReason(reason);
}

/** Whether the Host said that the candidate or the cursor has expired. */
function isExpired(reason: unknown): boolean {
  return reason instanceof GatewayApiError && reason.status === 410;
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
 * The media facts each review part carries (CR-R1-001 §8).
 *
 * A preview is a video, the narration is audio, the subtitle track is text, and the
 * shot summary and the rights/quality report are JSON. A part whose media facts are of
 * another kind is a different product, and it is refused.
 */
const PART_MEDIA_KIND: Readonly<Record<ReviewPart["kind"], PreparedPreviewMediaFactsV1["kind"]>> = {
  preview: "video",
  narration: "audio",
  subtitles: "text",
  shot_summary: "json",
  rights_quality: "json",
};

/**
 * The content types each media kind may have.
 *
 * The list is closed: HTML is not one of them, and a script is never one of them.
 */
const ALLOWED_CONTENT_TYPE: Readonly<Record<PreparedPreviewMediaFactsV1["kind"], RegExp>> = {
  video: /^video\/[A-Za-z0-9.+-]+$/,
  audio: /^audio\/[A-Za-z0-9.+-]+$/,
  text: /^text\/(vtt|plain)$/,
  json: /^application\/(json|[A-Za-z0-9.+-]+\+json)$/,
};

/**
 * Why a prepared part may not be previewed, or `null` when it may.
 *
 * The order is the contract's: the identity of the package and the part first, then the
 * package's own digest, then the product's own digest and length, then the media facts,
 * and only then the comparison with the workbench's one clock. A missing fact is a
 * refusal, never a guess.
 *
 * `expectedPackageDigest` is the Host's own canonical digest of the package document,
 * taken from the artifact reference the context carries for that package. It is `null`
 * when the context does not carry it — and then the app fails closed rather than
 * pretending the digest is bound.
 */
function refusePreview(
  descriptor: PreviewMediaDescriptorV1,
  packageDocument: ReviewPackage,
  part: ReviewPart,
  clockFps: { readonly num: number; readonly den: number },
  expectedPackageDigest: string | null,
): string | null {
  if (descriptor.project_id !== packageDocument.project_id) return "这份描述属于另一工程。";
  if (descriptor.run_id !== packageDocument.run_id) return "这份描述属于另一次运行。";
  if (descriptor.package_id !== packageDocument.package_id) return "这份描述属于另一个内容包。";
  if (descriptor.package_version !== packageDocument.version) return "这份描述属于另一个版本的包。";
  // The descriptor carries the *complete* part it describes: its kind, its reference
  // and its download reference must be the ones of the package's own part.
  if (descriptor.part.kind !== part.kind) return "这份描述说的是另一类内容。";
  if (descriptor.part.artifact_ref.id !== part.artifact_ref.id
    || descriptor.part.artifact_ref.version !== part.artifact_ref.version
    || descriptor.part.artifact_ref.sha256 !== part.artifact_ref.sha256) {
    return "这份描述指向的是另一个产物。";
  }
  if (descriptor.part.download_ref !== part.download_ref) return "这份描述的下载引用与内容包不一致。";
  if (!/^[0-9a-f]{64}$/.test(descriptor.package_digest)) return "描述里没有内容包摘要。";
  if (expectedPackageDigest === null) {
    return "无法核对这份内容包的摘要：当前上下文没有它的产物引用，拒绝预览。";
  }
  if (descriptor.package_digest !== expectedPackageDigest) {
    return "这份描述的内容包摘要与当前内容包不符。";
  }
  if (!/^[0-9a-f]{64}$/.test(descriptor.receipt_digest)) return "描述里没有准备回执摘要。";
  if (!/^[0-9a-f]{64}$/.test(descriptor.sha256)) return "描述里没有产物摘要。";
  if (!Number.isSafeInteger(descriptor.bytes) || descriptor.bytes <= 0) return "描述里没有产物长度。";
  if (!CONTROLLED_REF.test(descriptor.object_id)) return "描述里没有受控产物编号。";
  const facts = descriptor.media_facts;
  // The part and its media facts must be of the same kind: a preview part that carries
  // audio facts is a different product.
  if (facts.kind !== PART_MEDIA_KIND[part.kind]) {
    return "这一部分的媒体事实与它在内容包里的种类不一致。";
  }
  if (!ALLOWED_CONTENT_TYPE[facts.kind].test(descriptor.content_type)) {
    return `描述里的产物类型（${descriptor.content_type}）不是这一类内容允许的类型。`;
  }
  if (descriptor.content_type.toLowerCase().includes("html")) {
    return "这一部分是 HTML 或脚本，已拒绝展示。";
  }
  // The timeline the product belongs to is the project's own clock: a product on a
  // different time base is not a product of this project.
  if (descriptor.timeline.fps.num !== clockFps.num || descriptor.timeline.fps.den !== clockFps.den) {
    return `这份描述的时间基帧率（${descriptor.timeline.fps.num}/${descriptor.timeline.fps.den}）与工作台时钟（${clockFps.num}/${clockFps.den}）不一致，已拒绝预览。`;
  }
  if (facts.kind === "video") {
    if (facts.fps.num !== descriptor.timeline.fps.num || facts.fps.den !== descriptor.timeline.fps.den) {
      return "产物的实际帧率与它自己的时间基不一致。";
    }
    if (facts.fps.num !== clockFps.num || facts.fps.den !== clockFps.den) {
      return `产物的实际帧率（${facts.fps.num}/${facts.fps.den}）与工作台时钟（${clockFps.num}/${clockFps.den}）不一致，已拒绝预览。`;
    }
    if (!Number.isSafeInteger(facts.frame_count) || facts.frame_count <= 0) return "描述里没有完整解码帧数。";
    if (facts.frame_count !== descriptor.timeline.frame_count) {
      return "产物的实际解码帧数与它自己的时间基长度不一致。";
    }
    return null;
  }
  if (facts.kind === "audio") {
    if (!Number.isSafeInteger(facts.sample_rate) || facts.sample_rate <= 0) return "描述里没有实际采样率。";
    if (!Number.isSafeInteger(facts.sample_count) || facts.sample_count <= 0) return "描述里没有实际样本数。";
    if (!Number.isSafeInteger(facts.channels) || facts.channels <= 0) return "描述里没有声道数。";
    // The audio must last as long as the timeline it belongs to: a narration that is
    // a different length than its own slot is a different product. The tolerance is
    // one *frame* of the project's clock, which is den/num seconds — not 1/num.
    const seconds = facts.sample_count / facts.sample_rate;
    const timelineSeconds = descriptor.timeline.frame_count * clockFps.den / clockFps.num;
    const frameSeconds = clockFps.den / clockFps.num;
    if (Math.abs(seconds - timelineSeconds) > frameSeconds) {
      return "音频的实际时长与它所在的时间基长度不一致。";
    }
    return null;
  }
  return null;
}

/**
 * The Host's canonical digest of the package document.
 *
 * The Host publishes a review package as an artifact whose content digest is the
 * canonical digest of the package document, and the artifact's own `Ref.sha256` is that
 * same digest. So the descriptor's `package_digest` is compared with the artifact
 * reference the current context carries for that package: the Host's own canonical
 * semantics, not a comparison this app invented.
 *
 * When the context does not carry that reference the app cannot verify the digest, and
 * it returns `null` — the caller then fails closed instead of claiming a binding it
 * does not have.
 */
function packageDigestOf(context: Context | null, packageId: string): string | null {
  if (context === null) return null;
  const reference = context.artifacts.find((artifact) => artifact.id === packageId);
  return reference === undefined ? null : reference.sha256;
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
  /**
   * The one clock.
   *
   * It is the panel's *and* the preview's clock: there is no second one. Its frame rate
   * is the project's own frame rate — the projection's — so a prepared product is
   * compared with the clock it will really be played on, and never with a guess.
   */
  const [clock, setClock] = useState(() => new PlaybackClock({ num: 30, den: 1 }));
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
  /** Whether the package on screen is no longer the one the Host would answer about. */
  const [reviewStale, setReviewStale] = useState(false);
  /** Why the observation surfaces show what they show. It is never empty. */
  const [observation, setObservation] = useState("");
  /**
   * Whether the last observation really succeeded.
   *
   * It is `unknown` until a read has actually answered, and it goes back to `unknown`
   * when a read fails: a panel that has lost the connection does not keep claiming it
   * is connected.
   */
  const [connection, setConnection] = useState<"connected" | "disconnected" | "unknown">("unknown");
  /** When the facts were last really observed, in ISO-8601. */
  const [observedAt, setObservedAt] = useState<string | null>(null);
  const [systemOpen, setSystemOpen] = useState(false);
  /** The one prepared-preview slot. There is never a second one. */
  const [preview, setPreview] = useState<PreparedPreview | null>(null);
  /** Whether the prepared media is playing right now. */
  const [previewPlaying, setPreviewPlaying] = useState(false);
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
  /** The last report of the native editor, in its own values. */
  const lastNativeReport = useRef<{ clipId: string | null; seconds: number | null } | null>(null);
  /** The native position the panel has really observed. There is no guess. */
  const nativeObservation = useRef<{ clipId: string | null; seconds: number } | null>(null);
  /** The position the panel asked the editor to stop at, while it confirms it. */
  const pendingNativeSeek = useRef<number | null>(null);
  /**
   * The generation of the prepared preview that is being opened.
   *
   * An answer that belongs to an older generation is dropped: a slow read must never
   * reopen a preview that has been left in the meantime.
   */
  const previewGeneration = useRef(0);
  /** The read that is in flight, so it can be aborted when the preview is left. */
  const previewAbort = useRef<AbortController | null>(null);
  /** The object URL of the preview, so it can be revoked without touching the state. */
  const previewUrl = useRef<string | null>(null);
  /** The timer that advances the one clock while the prepared media plays. */
  const previewTicker = useRef<number | null>(null);
  /** The generation of the review read that is in flight. */
  const reviewGeneration = useRef(0);
  /** The review read that is in flight, so it can be aborted. */
  const reviewAbort = useRef<AbortController | null>(null);
  /** Which package the recorded decision belongs to. */
  const reviewIdentity = useRef("");
  /** The number of the observation read that was issued last. */
  const observationSeq = useRef(0);
  /** Whether an observation read is still in flight. */
  const observationBusy = useRef(false);
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
  // The clock takes the project's own frame rate as soon as the projection says it,
  // and it keeps the frame it was on: the playhead never jumps because the rate
  // arrived.
  useEffect(() => {
    if (projection === undefined) return;
    if (clock.fps.num === projection.fps.num && clock.fps.den === projection.fps.den) return;
    const next = new PlaybackClock(projection.fps);
    next.seek(clock.frame);
    setClock(next);
  }, [clock, projection]);
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
      { call: (surface, operation, input, signal) => api.uiCall(surface, operation, input, signal) },
      target,
    );
  }, [api, target, uiProp]);

  // ── the one prepared-preview slot ────────────────────────────────────────────────────

  /**
   * Stop the clock that follows the prepared media.
   *
   * The media and the clock are one: when the media stops, the clock stops with it, and
   * the frame it was on is kept.
   */
  const stopPreviewClock = useCallback((): void => {
    if (previewTicker.current !== null) {
      window.clearInterval(previewTicker.current);
      previewTicker.current = null;
    }
    setPreviewPlaying(false);
  }, []);

  /**
   * Leave the preview.
   *
   * The read in flight is aborted, the media stops, the object URL is revoked, and the
   * clock is left where it was. Nothing here is done through a state update in an
   * unmount cleanup: the URL is released directly, so leaving the page releases it too.
   */
  const closePreview = useCallback((reason?: string): void => {
    reviewMode.current = false;
    pendingNativeSeek.current = null;
    previewAbort.current?.abort();
    previewAbort.current = null;
    previewGeneration.current += 1;
    stopPreviewClock();
    const element = previewSlot.current;
    if (element !== null && typeof element.pause === "function") element.pause();
    const url = previewUrl.current;
    previewUrl.current = null;
    if (url !== null) URL.revokeObjectURL(url);
    setPreview(null);
    if (reason !== undefined) setPreviewReason(reason);
  }, [stopPreviewClock]);

  /**
   * Stop the native editor where the panel has really observed it.
   *
   * The upstream Studio has no pause command: it has a seek, and a seek pauses. So the
   * panel uses that one — it does not invent a pause, and it does not send the editor
   * to a position the panel has not observed.
   *
   * The command is a *capability*: when this page has no native command entry at all,
   * the editor cannot be stopped, and the panel must not take the clock over. The
   * answer says whether the editor was really asked to stop.
   */
  const pauseNativeAt = useCallback((seconds: number): boolean => {
    const studio = (window as { narralensStudio?: { command?: (command: unknown) => void } }).narralensStudio;
    if (studio === undefined || typeof studio.command !== "function") return false;
    pendingNativeSeek.current = seconds;
    studio.command({ type: "seek", time: seconds });
    return true;
  }, []);

  /**
   * Play the prepared media.
   *
   * The element really plays — this is where the narration is heard — and the one
   * clock follows it. Nothing is ever started on its own: the media starts because the
   * operator asked for it.
   */
  const playPreview = useCallback((): void => {
    const element = previewSlot.current;
    if (element === null || preview === null) return;
    // The element starts on the clock's position, not on its own.
    const seconds = clock.seconds;
    if (Number.isFinite(seconds)) element.currentTime = seconds;
    setPreviewPlaying(true);
    const started = element.play();
    if (started !== undefined && typeof started.catch === "function") {
      started.catch(() => {
        stopPreviewClock();
        setPreviewReason("预览无法播放：浏览器拒绝了这次播放请求。");
      });
    }
  }, [clock, preview, stopPreviewClock]);

  /** Pause the prepared media. The clock stops on the frame it was on. */
  const pausePreview = useCallback((): void => {
    stopPreviewClock();
    const element = previewSlot.current;
    if (element !== null && typeof element.pause === "function") element.pause();
  }, [stopPreviewClock]);

  // The observation facts. They are read again and again over the *real* read
  // transport, on a bounded timer, and every answer is stamped with the time it was
  // observed. A read that fails does not blank the surfaces and does not pretend the
  // connection holds: it becomes `unknown`, and the next successful read restores it.
  const observationGeneration = useRef(0);
  /** Which review package was asked for last, so it is not asked for again and again. */
  const reviewRequestKey = useRef("");
  useEffect(() => {
    const generation = ++observationGeneration.current;
    // A new scope starts empty: the facts of another project or another run are not
    // carried over.
    setWorkflow(null);
    setContext(null);
    setHealth(null);
    setReview(null);
    setReviewDecision(null);
    setReviewStale(false);
    reviewRequestKey.current = "";
    reviewIdentity.current = "";
    setObservedAt(null);
    setConnection("unknown");
    if (uiClient === undefined) {
      setObservation("工作台观察入口未就绪：本次打开的工程没有独立的工作台界面授权。");
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const read = async (): Promise<void> => {
      // The reads are serialized: a poll never starts while the previous one is still
      // on its way, so an older poll cannot land after a newer one.
      if (observationBusy.current) return;
      observationBusy.current = true;
      const seq = ++observationSeq.current;
      try {
        const [workflowValue, contextValue, healthValue] = await Promise.all([
          uiClient.readWorkflow(controller.signal),
          uiClient.readContext(controller.signal),
          uiClient.readHealth(controller.signal),
        ]);
        if (cancelled || generation !== observationGeneration.current) return;
        // Only the read that was issued last may write the facts.
        if (seq !== observationSeq.current) return;
        setWorkflow(workflowValue);
        setContext(contextValue);
        setHealth(healthValue);
        setObservedAt(new Date().toISOString());
        setConnection("connected");
        setObservation("");
      } catch (reason) {
        if (cancelled || generation !== observationGeneration.current) return;
        if (seq !== observationSeq.current) return;
        // The last known facts stay on screen, but they are no longer current: the
        // connection is unknown and the reason is said. A package that cannot be
        // confirmed cannot be decided, and a prepared preview is stopped.
        setConnection("unknown");
        setObservation(unavailableReason(reason));
        setReviewStale(true);
        closePreview("观察已断开：准备预览已停止。");
      } finally {
        observationBusy.current = false;
      }
    };
    void read();
    const timer = setInterval(() => { void read(); }, 5_000);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [closePreview, uiClient]);

  /**
   * The review package is named by a real gate. It is never guessed.
   *
   * The read is fenced: it belongs to a generation, it is aborted when a newer one
   * starts, and the answer must still name the project, the run and the package that
   * were asked for. An answer from an older scope can therefore never land.
   */
  const readReviewPackage = useCallback(async (runId: string, packageId: string): Promise<void> => {
    if (uiClient === undefined) { setReview(null); setReviewStale(false); return; }
    const generation = ++reviewGeneration.current;
    reviewAbort.current?.abort();
    const controller = new AbortController();
    reviewAbort.current = controller;
    try {
      const document_ = await uiClient.readReview(runId, packageId, controller.signal);
      // A newer read has spoken: this answer is history.
      if (generation !== reviewGeneration.current) return;
      if (document_.project_id !== uiClient.projectId) return;
      if (document_.run_id !== runId || document_.package_id !== packageId) return;
      const identity = `${document_.run_id}@${document_.package_id}@${document_.version}`;
      // A decision belongs to the package it was made about. A different package, a
      // different version or a different run does not inherit it.
      if (reviewIdentity.current !== "" && reviewIdentity.current !== identity) {
        setReviewDecision(null);
      }
      reviewIdentity.current = identity;
      setReview(document_);
      setReviewStale(false);
    } catch {
      if (generation !== reviewGeneration.current) return;
      // The last known package stays on screen, but it is no longer current: it
      // cannot be decided until a read has really answered. The request key is
      // released, so the next observation reads the package again.
      reviewRequestKey.current = "";
      setReviewStale(true);
    }
  }, [uiClient]);

  useEffect(() => {
    if (uiClient === undefined || context === null) { setReview(null); return; }
    const run = context.active_run;
    if (run === null || run === undefined) { setReview(null); return; }
    // The *current* pending gate names the package under review. A gate that was
    // already decided keeps its package, but it is history: it is not what the
    // operator is being asked about now.
    const gate = run.gates.find((candidate) => candidate.state === "pending"
      && candidate.review_package_id !== null);
    if (gate?.review_package_id == null) { setReview(null); return; }
    // The key carries the versions the Host publishes, so an *updated* package of the
    // same id is read again instead of being suppressed by the previous request.
    const key = [
      run.run_id,
      gate.gate_id,
      gate.review_package_id,
      context.project_revision,
      context.workflow_revision,
      context.control_revision,
      context.selection_version,
    ].join("|");
    if (reviewRequestKey.current === key) return;
    reviewRequestKey.current = key;
    void readReviewPackage(run.run_id, gate.review_package_id);
  }, [context, readReviewPackage, uiClient]);

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
      // Exactly one audio focus: while the prepared preview holds it, the proxies are
      // muted and stopped.
      const holdsFocus = preview === null && index === focusedProxy;
      element.muted = !holdsFocus;
      if (preview === null) void element.play().catch(() => undefined);
      else element.pause();
    }
  }, [focusedProxy, preview, projection === undefined]);
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
      const clipId = detail.refs?.find((ref) => ref.kind === "clip")?.id ?? null;
      const seconds = typeof detail.time === "number" && Number.isFinite(detail.time)
        ? detail.time
        : null;
      // The panel's observation of the native timeline: the position it has really
      // seen. Without it there is nowhere to pause the editor, and 0 is not a guess
      // the panel is allowed to make.
      if (seconds !== null) nativeObservation.current = { clipId, seconds };
      if (!projection) return;
      // A report that names a *different* clip — or a *different* time inside the same
      // clip — means the native timeline really moved. A periodic report of the same
      // value is not a user action.
      const previous = lastNativeReport.current;
      const moved = previous !== null
        && (previous.clipId !== clipId
          || previous.seconds === null
          || seconds === null
          || Math.abs(previous.seconds - seconds) > NATIVE_EPSILON);
      if (reviewMode.current) {
        // In review mode the native report does not write the selection. A real move
        // stops the preview, and the clock is left where it was.
        const pending = pendingNativeSeek.current;
        if (pending !== null && seconds !== null && Math.abs(seconds - pending) <= NATIVE_EPSILON) {
          // The echo of the panel's own seek: the editor confirming where it stopped.
          pendingNativeSeek.current = null;
          lastNativeReport.current = { clipId, seconds };
          return;
        }
        lastNativeReport.current = { clipId, seconds };
        if (moved) closePreview("原生时间线已经移动：预览已停止，播放头留在原处。");
        return;
      }
      lastNativeReport.current = { clipId, seconds };
      // A preview that is still being read belongs to the position the editor was in.
      // When the editor really moves, that read is abandoned: it must not open a
      // preview of a place the operator has left.
      if (moved && previewAbort.current !== null) {
        closePreview("原生时间线已经移动：这一次预览读取已作废。");
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
    // Choosing a clip in review mode leaves the preview and goes back to editing: the
    // selection is really applied, not silently dropped.
    if (reviewMode.current) closePreview("已退出预览：回到原生时间线继续编辑。");
    // A preview that is still being read belongs to the old selection: the operator
    // has moved on, and the read is abandoned.
    else if (previewAbort.current !== null) closePreview("选区已经改变：这一次预览读取已作废。");
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

  /**
   * Open one prepared part.
   *
   * The order is the contract's: the descriptor first, then the identity and the
   * timeline checks, then the bytes, and only then the object URL. A refusal at any
   * step leaves the slot empty and says why.
   *
   * The whole read belongs to one generation: an answer that arrives after the preview
   * was left, switched or replaced is dropped, and it never reopens the slot.
   */
  const openPreparedPart = useCallback(async (part: ReviewPart): Promise<void> => {
    if (uiClient === undefined) { setPreviewReason("工作台观察入口未就绪，无法读取准备内容。"); return; }
    if (review === null) { setPreviewReason("当前没有待审阅的包。"); return; }
    // The editor is stopped where the panel has really observed it. Without an
    // observation there is nowhere to stop it, and the panel does not guess 0.
    if (nativeObservation.current === null) {
      setPreviewReason("尚未观测到原生时间线的位置：无法在正确位置暂停编辑区，这里不会猜测 0。");
      return;
    }
    const generation = ++previewGeneration.current;
    previewAbort.current?.abort();
    const controller = new AbortController();
    previewAbort.current = controller;
    setPreviewReason("");
    let descriptor: PreviewMediaDescriptorV1;
    try {
      descriptor = await uiClient.describePart({
        run_id: review.run_id,
        package_id: review.package_id,
        package_version: review.version,
        part_kind: part.kind,
        artifact_ref: part.artifact_ref,
      }, controller.signal);
    } catch (reason) {
      if (generation !== previewGeneration.current) return;
      setPreviewReason(`无法取得该部分的真实描述：${unavailableReason(reason)}`);
      return;
    }
    if (generation !== previewGeneration.current) return;
    const refusal = refusePreview(
      descriptor, review, part, clock.fps, packageDigestOf(context, review.package_id),
    );
    if (refusal !== null) { setPreviewReason(refusal); return; }
    const ref = part.download_ref;
    if (ref === null || !CONTROLLED_REF.test(ref)) {
      setPreviewReason("该部分没有可读取的受控媒体引用。");
      return;
    }
    let media: { readonly bytes: Uint8Array; readonly etag: string; readonly contentType: string };
    try {
      media = await api.reviewMedia(ref, controller.signal);
    } catch (reason) {
      if (generation !== previewGeneration.current) return;
      setPreviewReason(`读取预览失败：${unavailableReason(reason)}`);
      return;
    }
    if (generation !== previewGeneration.current) return;
    const digest = await sha256Hex(media.bytes);
    if (generation !== previewGeneration.current) return;
    if (digest !== descriptor.sha256 || media.bytes.byteLength !== descriptor.bytes) {
      setPreviewReason("读取到的字节与描述不符，已拒绝预览。");
      return;
    }
    if (media.etag !== `"${descriptor.sha256}"`) {
      setPreviewReason("媒体标识与描述不符，已拒绝预览。");
      return;
    }
    if (media.contentType !== descriptor.content_type) {
      setPreviewReason("读取到的内容类型与描述不符，已拒绝预览。");
      return;
    }
    // Everything the contract asks for has been checked. Now the editor stops — at the
    // position the panel has *just* observed, not at the position it had when the read
    // began: a reader that moved the timeline while the bytes were loading must not be
    // rewound.
    const observed = nativeObservation.current;
    if (observed === null) {
      setPreviewReason("原生时间线的位置已经丢失：无法在正确位置暂停编辑区，拒绝预览。");
      return;
    }
    if (!pauseNativeAt(observed.seconds)) {
      setPreviewReason("这个页面没有原生命令入口：无法暂停编辑区，拒绝接管时钟。");
      return;
    }
    // The one clock goes to the frame the editor was stopped at: the editor and the
    // prepared media are at the same place, and the panel reads one position.
    clock.seek(clock.frameFor(observed.seconds));
    const previousUrl = previewUrl.current;
    previewUrl.current = null;
    if (previousUrl !== null) URL.revokeObjectURL(previousUrl);
    if (descriptor.media_facts.kind === "text" || descriptor.media_facts.kind === "json") {
      const text = new TextDecoder("utf-8").decode(media.bytes);
      setPreview({ part, descriptor, url: null, text, label: PART_LABEL[part.kind] });
    } else {
      const url = URL.createObjectURL(new Blob([new Uint8Array(media.bytes).buffer as ArrayBuffer], {
        type: descriptor.content_type,
      }));
      previewUrl.current = url;
      setPreview({ part, descriptor, url, text: null, label: PART_LABEL[part.kind] });
    }
    // The read is over: nothing is in flight any more.
    previewAbort.current = null;
    reviewMode.current = true;
  }, [api, clock.fps, context, pauseNativeAt, review, uiClient]);

  // The slot's media element follows the one clock. While the media plays, the clock
  // is the authority and the element is corrected only when it drifts; while it is
  // parked, the element is paused and shows the clock's position exactly.
  useEffect(() => {
    const element = previewSlot.current;
    if (element === null || preview === null) return;
    if (!previewPlaying && typeof element.pause === "function") element.pause();
    const seconds = clock.seconds;
    const tolerance = previewPlaying ? 0.25 : 0.05;
    if (Number.isFinite(seconds) && Math.abs(element.currentTime - seconds) > tolerance) {
      element.currentTime = seconds;
    }
  }, [clock, frame, preview, previewPlaying]);

  // While the prepared media plays, the one clock advances. The media is the sound and
  // the picture; the clock is the panel's single position, and it is what every other
  // surface reads.
  useEffect(() => {
    if (!previewPlaying || preview === null) return;
    const frameMs = clock.fps.den * 1000 / clock.fps.num;
    const lastFrame = Math.max(0, preview.descriptor.timeline.frame_count - 1);
    let last = Date.now();
    const timer = window.setInterval(() => {
      const now = Date.now();
      const elapsed = now - last;
      if (elapsed <= 0) return;
      const frames = Math.floor(elapsed / frameMs);
      if (frames <= 0) return;
      last += frames * frameMs;
      const next = clock.frame + frames;
      if (next >= lastFrame) {
        clock.seek(lastFrame);
        stopPreviewClock();
        return;
      }
      clock.seek(next);
    }, Math.max(10, Math.round(frameMs / 2)));
    return () => { window.clearInterval(timer); };
  }, [clock, preview, previewPlaying, stopPreviewClock]);

  // Leaving the page releases the object URL, stops the media and aborts the read that
  // is in flight. No state is set here: an unmount must not cause a re-render of a
  // component that is already gone.
  useEffect(() => () => {
    previewAbort.current?.abort();
    previewAbort.current = null;
    previewGeneration.current += 1;
    if (previewTicker.current !== null) {
      window.clearInterval(previewTicker.current);
      previewTicker.current = null;
    }
    const element = previewSlot.current;
    if (element !== null && typeof element.pause === "function") element.pause();
    const url = previewUrl.current;
    previewUrl.current = null;
    if (url !== null) URL.revokeObjectURL(url);
  }, []);

  // A new scope invalidates a preview that is still being read: the read is aborted
  // and its answer can no longer open a slot.
  useEffect(() => () => {
    previewAbort.current?.abort();
    previewAbort.current = null;
    previewGeneration.current += 1;
  }, [target]);

  // The health sample is judged against the clock; the clock ticks so a stale sample
  // becomes unknown on its own.
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);

  // ── the local assets and the review decision ───────────────────────────────────────

  /** The project the candidates and the inventory on screen belong to. */
  const localAssetsProject = useRef("");
  /** The cursor of the candidate listing: the next page, when there is one. */
  const [candidatesCursor, setCandidatesCursor] = useState<string | null>(null);
  /** The cursor of the inventory: the next page, when there is one. */
  const [inventoryCursor, setInventoryCursor] = useState<string | null>(null);
  /** How many pages of candidates are on screen. */
  const [candidatesPages, setCandidatesPages] = useState(0);
  /** How many pages of inventory are on screen. */
  const [inventoryPages, setInventoryPages] = useState(0);
  /** The generation of the candidate listing that is on screen. */
  const sourceGeneration = useRef(0);
  /** The generation of the inventory that is on screen. */
  const inventoryGeneration = useRef(0);
  /** The request key of the last declaration, shown so an unknown result reconciles. */
  const [localAssetRequestKey, setLocalAssetRequestKey] = useState<string | null>(null);

  /**
   * Read one page of the controlled candidates.
   *
   * The cursor is the Host's own, and it belongs to the generation that asked for it:
   * a page that arrives after the listing was restarted is dropped, and the pages that
   * were read are never kept as if they were the whole listing.
   */
  const readSourcePage = useCallback(async (cursor: string | null, append: boolean): Promise<void> => {
    if (uiClient === undefined) { setLocalAssetError("工作台观察入口未就绪，无法读取素材清单。"); return; }
    const generation = ++sourceGeneration.current;
    try {
      const listing = await uiClient.readLocalSourceFiles(cursor === null ? {} : { cursor });
      if (generation !== sourceGeneration.current) return;
      setCandidates((current) => append ? [...current, ...listing.candidates] : listing.candidates);
      setCandidatesCursor(listing.cursor_next);
      setCandidatesPages((pages) => append ? pages + 1 : 1);
      setLocalAssetError(null);
    } catch (reason) {
      if (generation !== sourceGeneration.current) return;
      if (isExpired(reason)) {
        // The cursor is stale: the listing starts again at the first page.
        setCandidates([]);
        setCandidatesCursor(null);
        setCandidatesPages(0);
        sourceGeneration.current += 1;
        await readSourcePage(null, false);
        setLocalAssetError("候选已过期：已经回到第一页重新读取。");
        return;
      }
      setLocalAssetError(localAssetFailure(reason));
    }
  }, [uiClient]);

  /** Read one page of the registered assets. It has its own cursor and its own pages. */
  const readInventoryPage = useCallback(async (cursor: string | null, append: boolean): Promise<void> => {
    if (uiClient === undefined) { setLocalAssetError("工作台观察入口未就绪，无法读取素材清单。"); return; }
    const generation = ++inventoryGeneration.current;
    try {
      const inventory = await uiClient.readLocalAssets(cursor === null ? {} : { cursor });
      if (generation !== inventoryGeneration.current) return;
      setLocalInventory((current) => append ? [...current, ...inventory.items] : inventory.items);
      setInventoryCursor(inventory.cursor_next);
      setInventoryPages((pages) => append ? pages + 1 : 1);
      setLocalAssetError(null);
    } catch (reason) {
      if (generation !== inventoryGeneration.current) return;
      if (isExpired(reason)) {
        // The cursor is stale: the inventory starts again at the first page.
        setLocalInventory([]);
        setInventoryCursor(null);
        setInventoryPages(0);
        inventoryGeneration.current += 1;
        await readInventoryPage(null, false);
        setLocalAssetError("清单已过期：已经回到第一页重新读取。");
        return;
      }
      setLocalAssetError(localAssetFailure(reason));
    }
  }, [uiClient]);

  /** Read the first page of both listings. */
  const loadLocalAssets = useCallback(async (): Promise<void> => {
    if (uiClient === undefined) { setLocalAssetError("工作台观察入口未就绪，无法读取素材清单。"); return; }
    // Another project starts empty: the candidates and the assets of another project
    // are never shown under this one, and neither are their cursors.
    if (localAssetsProject.current !== uiClient.projectId) {
      localAssetsProject.current = uiClient.projectId;
      setCandidates([]);
      setLocalInventory([]);
      setCandidatesCursor(null);
      setInventoryCursor(null);
      setCandidatesPages(0);
      setInventoryPages(0);
      sourceGeneration.current += 1;
      inventoryGeneration.current += 1;
    }
    await Promise.all([readSourcePage(null, false), readInventoryPage(null, false)]);
  }, [readInventoryPage, readSourcePage, uiClient]);

  useEffect(() => { void loadLocalAssets(); }, [loadLocalAssets]);

  /** Ask for the next page of candidates. */
  const loadMoreCandidates = useCallback((): void => {
    if (candidatesCursor === null) return;
    void readSourcePage(candidatesCursor, true);
  }, [candidatesCursor, readSourcePage]);

  /** Ask for the next page of the registered assets. */
  const loadMoreInventory = useCallback((): void => {
    if (inventoryCursor === null) return;
    void readInventoryPage(inventoryCursor, true);
  }, [inventoryCursor, readInventoryPage]);

  /**
   * Register one declared local asset.
   *
   * The request key is bound to the declaration by the client, so the same declaration
   * always carries the same key and an unknown outcome is reconciled with that key
   * rather than with a new one. What matters here is that an unknown outcome is
   * reported as unknown and the inventory is re-read, rather than the declaration
   * being declared successful.
   */
  const registerLocalAsset = useCallback(async (request: LocalAssetRegistrationRequest): Promise<void> => {
    if (uiClient === undefined) { setLocalAssetError("工作台观察入口未就绪，无法登记素材。"); return; }
    setBusy("local-asset");
    setLocalAssetError(null);
    setLocalAssetNotice(null);
    try {
      const item = await uiClient.importLocalAsset(request);
      setLocalAssetRequestKey(uiClient.registrationKeyFor(request) ?? null);
      setLocalAssetNotice(`声明已登记：清单里有了 ${item.asset_id}。登记只是清单里的一条，不等于已采用或已交付。`);
      await loadLocalAssets();
    } catch (reason) {
      setLocalAssetRequestKey(uiClient.registrationKeyFor(request) ?? null);
      setLocalAssetError(localAssetFailure(reason));
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
      // The facts are read again: the decision changed the package's own state, and the
      // panel must show what the Host says now, not what it said before.
      try {
        const freshContext = await uiClient.readContext();
        setContext(freshContext);
        await readReviewPackage(review.run_id, review.package_id);
      } catch {
        // The periodic observation will read it again; nothing is claimed meanwhile.
      }
    } catch (reason) { fail(reason); }
    finally { setBusy(""); }
  }, [fail, readReviewPackage, review, uiClient]);

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
      <WorkflowTopBar
        workflow={workflow}
        connection={connection}
        {...(observedAt === null ? {} : { observedAt })}
      />
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
            {preview.url === null ? (
              <PreparedTextView
                contentType={preview.descriptor.content_type}
                text={preview.text ?? ""}
              />
            ) : (
              /* No `controls`: the browser's own transport would run a second clock.
                 The element is a projection of the one clock, and the panel's own
                 transport below is the only thing that moves it. */
              <video
                ref={previewSlot}
                src={preview.url}
                playsInline
                preload="auto"
                muted={false}
                onEnded={() => {
                  clock.seek(Math.max(0, preview.descriptor.timeline.frame_count - 1));
                  stopPreviewClock();
                }}
                onError={() => {
                  stopPreviewClock();
                  setPreviewReason("预览无法播放：媒体读取失败。");
                }}
                onPause={() => { stopPreviewClock(); }}
              />
            )}
            <figcaption>
              {preview.label} · {preview.descriptor.timeline.fps.num}/{preview.descriptor.timeline.fps.den} ·
              {" "}{preview.descriptor.media_facts.kind}
            </figcaption>
            {preview.url === null ? null : (
              <>
                <div className="nl-preview-transport">
                  <button
                    type="button"
                    data-nl-preview-play={previewPlaying ? "playing" : "paused"}
                    onClick={() => { if (previewPlaying) pausePreview(); else playPreview(); }}
                  >
                    {previewPlaying ? "暂停" : "播放"}
                  </button>
                  <label className="nl-preview-transport" htmlFor="nl-preview-frame">
                    预览位置（帧）
                    <input
                      id="nl-preview-frame"
                      type="range"
                      min={0}
                      max={Math.max(0, preview.descriptor.timeline.frame_count - 1)}
                      value={Math.min(frame, Math.max(0, preview.descriptor.timeline.frame_count - 1))}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        clock.seek(next);
                        setFrame(next);
                      }}
                    />
                  </label>
                  <span className="nl-muted">第 {frame} 帧</span>
                </div>
              </>
            )}
            <button type="button" onClick={() => closePreview()}>退出预览</button>
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
        busy={busy === "review"}
        stale={reviewStale}
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
      requestKey={localAssetRequestKey}
      candidatePages={candidatesPages}
      inventoryPages={inventoryPages}
      hasMoreCandidates={candidatesCursor !== null}
      hasMoreInventory={inventoryCursor !== null}
      onLoadMoreCandidates={loadMoreCandidates}
      onLoadMoreInventory={loadMoreInventory}
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
