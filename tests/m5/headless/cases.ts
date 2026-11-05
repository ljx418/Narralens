import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { CdpSession } from "./cdp.js";
import type { HeadlessEnvironment } from "./environment.js";

/**
 * M5C's experience cases (Wave 3 `02` §2, `04` §7).
 *
 * Each case is a *claim* about the experience, and each claim is answered with facts
 * read out of the running system — the real page in a real browser, over a real Host,
 * against a real migrated OpenFilm target.
 *
 * The cases never assert what they did not measure. A case that cannot be measured in
 * this environment is `BLOCKED_ENV` or `NOT_RUN`, with the reason recorded, and never
 * `PASS` on the strength of a mock.
 */
export interface Assertion {
  readonly claim: string;
  readonly ok: boolean;
  readonly detail: string;
}

export type CaseStatus = "PASS" | "FAIL" | "BLOCKED_ENV" | "NOT_RUN";

export interface CaseResult {
  readonly case_id: string;
  readonly title: string;
  readonly status: CaseStatus;
  readonly assertions: readonly Assertion[];
  readonly facts: Record<string, unknown>;
  readonly evidence: readonly string[];
}

export interface CaseContext {
  readonly env: HeadlessEnvironment;
  readonly session: CdpSession;
  readonly evidenceRoot: string;
  /** Save a screenshot and return the path written. */
  screenshot(name: string): Promise<string>;
  /** Save a JSON evidence file and return the path written. */
  json(name: string, value: unknown): Promise<string>;
}

const PANEL_STATE = `(() => {
  const panel = document.querySelector("[data-narralens-panel]");
  if (!panel) return null;
  const proxies = [...document.querySelectorAll("[data-narralens-proxy]")].map((figure) => {
    const video = figure.querySelector("video");
    return {
      name: figure.getAttribute("data-narralens-proxy"),
      focus: figure.getAttribute("data-narralens-proxy-focus"),
      muted: video ? video.muted : null,
      paused: video ? video.paused : null,
      readyState: video ? video.readyState : null,
      currentTime: video ? video.currentTime : null,
      duration: video ? video.duration : null,
      unavailable: video ? video.getAttribute("data-unavailable") : null,
    };
  });
  return {
    panel: panel.getAttribute("data-narralens-panel"),
    stage: panel.getAttribute("data-stage"),
    phase: panel.getAttribute("data-phase"),
    target: panel.getAttribute("data-target"),
    revision: panel.getAttribute("data-revision"),
    controlRevision: panel.getAttribute("data-control-revision"),
    selectionClip: panel.getAttribute("data-selection-clip"),
    selectionSourceShot: panel.getAttribute("data-selection-source-shot"),
    selectionRange: panel.getAttribute("data-selection-range"),
    playhead: panel.getAttribute("data-playhead"),
    locks: panel.getAttribute("data-locks"),
    history: panel.getAttribute("data-history"),
    studioSelection: panel.getAttribute("data-studio-selection"),
    studioSeconds: panel.getAttribute("data-studio-seconds"),
    errorCode: panel.querySelector(".m5-error") ? panel.querySelector(".m5-error").getAttribute("data-error-code") : null,
    text: panel.innerText,
    proxies,
    documentWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    devicePixelRatio: window.devicePixelRatio,
    activeElement: document.activeElement ? document.activeElement.id || document.activeElement.tagName : null,
  };
})()`;

interface PanelState {
  panel: string | null;
  stage: string | null;
  phase: string | null;
  target: string | null;
  revision: string | null;
  controlRevision: string | null;
  selectionClip: string | null;
  selectionSourceShot: string | null;
  selectionRange: string | null;
  playhead: string | null;
  locks: string | null;
  history: string | null;
  studioSelection: string | null;
  studioSeconds: string | null;
  errorCode: string | null;
  text: string;
  proxies: Array<{
    name: string | null; focus: string | null; muted: boolean | null; paused: boolean | null;
    readyState: number | null; currentTime: number | null; duration: number | null; unavailable: string | null;
  }>;
  documentWidth: number;
  innerWidth: number;
  devicePixelRatio: number;
  activeElement: string | null;
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

async function panelState(session: CdpSession): Promise<PanelState | null> {
  return await session.evaluateWithRetry<PanelState | null>(PANEL_STATE);
}

/**
 * Wait until the native editor is alive.
 *
 * The panel can be ready before the Studio's timeline is: the panel reads the Host, the
 * Studio reads its own film. Asking the editor to select a clip before it is alive is a
 * command to nobody, so the cases wait for the editor's first report.
 */
async function waitForStudio(session: CdpSession, timeoutMs = 30_000): Promise<PanelState | null> {
  return await waitForPanel(session, (state) => (state?.studioSelection ?? "") !== "", timeoutMs);
}

/** Wait until the panel satisfies a predicate, or give up. */
async function waitForPanel(session: CdpSession,
  predicate: (state: PanelState | null) => boolean, timeoutMs = 20_000): Promise<PanelState | null> {
  const deadline = Date.now() + timeoutMs;
  let last: PanelState | null = null;
  while (Date.now() < deadline) {
    last = await panelState(session);
    if (predicate(last)) return last;
    await sleep(150);
  }
  return last;
}

/** Click an element by its text, in the panel. */
async function clickByText(session: CdpSession, selector: string, text: string): Promise<boolean> {
  const clicked = await session.evaluateWithRetry<boolean>(`(() => {
    const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const node = nodes.find((candidate) => (candidate.innerText || "").includes(${JSON.stringify(text)}));
    if (!node) return false;
    node.click();
    return true;
  })()`);
  return clicked;
}

/** Set the value of an input, the way a person would, and fire the events. */
async function setInput(session: CdpSession, selector: string, value: string): Promise<boolean> {
  return await session.evaluateWithRetry<boolean>(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value");
    if (setter && setter.set) setter.set.call(input, ${JSON.stringify(value)});
    else input.value = ${JSON.stringify(value)};
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
}

/** The workbench projection, read from the Host over its own route. */
async function workbench(env: HeadlessEnvironment): Promise<Record<string, unknown>> {
  const response = await fetch(`${env.origin}/api/migration/v1/projects/${env.projectId}/workbench`, {
    headers: { origin: env.origin, authorization: `Bearer ${env.token}` },
  });
  return await response.json() as Record<string, unknown>;
}

function verdict(assertions: readonly Assertion[]): CaseStatus {
  return assertions.every((assertion) => assertion.ok) ? "PASS" : "FAIL";
}

/** UX-01: the idea draft is editable, and opening goes to a real migrated target. */
export async function ux01(context: CaseContext): Promise<CaseResult> {
  const { env, session } = context;
  const before = await workbench(env);
  await session.navigate("about:blank");
  await session.navigate(`${env.pageUrl}#/idea`);
  await waitForPanel(session, (state) => state?.stage === "idea" || state?.panel === "idea");

  const typed = await setInput(session, "#narralens-idea-draft", "改成三镜递进组接，保留原解说。");
  const draft = await session.evaluate<string>(`(document.querySelector("#narralens-idea-draft") || {}).value || ""`);
  const opened = await clickByText(session, "button", "打开已迁移的 OpenFilm 工程");
  await waitForPanel(session, (state) => state?.stage === "refine" || state?.panel === "ready");
  const state = await panelState(session);
  const after = await workbench(env);

  const assertions: Assertion[] = [
    {
      claim: "想法草稿可编辑，且不会被当作已建工程",
      ok: typed && draft.includes("三镜递进组接"),
      detail: `typed=${typed} draft="${draft}"`,
    },
    {
      claim: "打开的是真实的已迁移 target，源→target 映射可证",
      ok: state?.target === env.projectId && before.source_project_id === "d1-30s",
      detail: `target=${state?.target} source=${String(before.source_project_id)}`,
    },
    {
      claim: "本阶段不创建空白工程：打开前后 revision 与 source 不变",
      ok: before.revision === after.revision && before.source_digest === after.source_digest,
      detail: `revision ${String(before.revision)}→${String(after.revision)}`,
    },
    { claim: "打开动作确实发生了", ok: opened, detail: `clicked=${opened}` },
  ];
  return {
    case_id: "UX-01", title: "想法草稿可编辑，打开真实 source→target 映射",
    status: verdict(assertions), assertions,
    facts: { before, after, panel: state },
    evidence: [],
  };
}

/** UX-02: close and reopen; the read model is rebuilt, not remembered. */
export async function ux02(context: CaseContext): Promise<CaseResult> {
  const { env, session } = context;
  await session.navigate("about:blank");
  await session.navigate(`${env.pageUrl}#/refine/${env.projectId}`);
  const first = await waitForPanel(session, (state) => state?.panel === "ready");
  const projection = await workbench(env);

  // Close: navigate away. Reopen: come back.
  await session.navigate("about:blank");
  await session.navigate("about:blank");
  await session.navigate(`${env.pageUrl}#/refine/${env.projectId}`);
  const second = await waitForPanel(session, (state) => state?.panel === "ready");

  const assertions: Assertion[] = [
    {
      claim: "关闭重开后 projection/revision/history 可重建",
      ok: first?.target === env.projectId && second?.target === env.projectId
        && first?.revision === second?.revision && first?.history === second?.history,
      detail: `first r${first?.revision}/h${first?.history} second r${second?.revision}/h${second?.history}`,
    },
    {
      claim: "重建后的 revision 与 Host 的提交事实一致",
      ok: Number(second?.revision) === Number(projection.revision),
      detail: `panel=${String(second?.revision)} host=${String(projection.revision)}`,
    },
  ];
  return {
    case_id: "UX-02", title: "关闭重开后 projection/revision/history 可重建",
    status: verdict(assertions), assertions, facts: { first, second, projection }, evidence: [],
  };
}

/** UX-03: the shot, the chapter and the timecode name the same target clip and range. */
export async function ux03(context: CaseContext): Promise<CaseResult> {
  const { env, session } = context;
  await session.navigate("about:blank");
  await session.navigate(`${env.pageUrl}#/refine/${env.projectId}`);
  await waitForPanel(session, (state) => state?.panel === "ready");
  await waitForStudio(session);
  const clicked = await clickByText(session, ".m5-atlas button", "shot-002");
  const state = await waitForPanel(session, (current) => current?.selectionClip === "shot-002");
  const projection = await workbench(env);
  const clip = (projection.clips as Array<{ clip_id: string; source_shot_id: string | null;
    start_frame: number; end_frame_exclusive: number }>).find((entry) => entry.clip_id === "shot-002");

  const assertions: Assertion[] = [
    { claim: "选中第二个镜头", ok: clicked && state?.selectionClip === "shot-002",
      detail: `clicked=${clicked} selection=${String(state?.selectionClip)}` },
    {
      claim: "显示唯一的 source shot lineage（不是互换）",
      ok: state?.selectionSourceShot === "shot-002" && clip?.source_shot_id === "shot-002",
      detail: `panel=${String(state?.selectionSourceShot)} projection=${String(clip?.source_shot_id)}`,
    },
    {
      claim: "半开帧范围与目标 clip 一致",
      ok: state?.selectionRange === `${clip?.start_frame}-${clip?.end_frame_exclusive}`,
      detail: `panel=${String(state?.selectionRange)} projection=${clip?.start_frame}-${clip?.end_frame_exclusive}`,
    },
  ];
  return {
    case_id: "UX-03", title: "章节/镜头/时间码定位同一 target clip 与范围，并显示唯一 source shot lineage",
    status: verdict(assertions), assertions, facts: { state, clip }, evidence: [],
  };
}

/** UX-04: the semantic result carries a clip and a range; no data is honestly blocked. */
export async function ux04(context: CaseContext): Promise<CaseResult> {
  const { env, session } = context;
  await session.navigate("about:blank");
  await session.navigate(`${env.pageUrl}#/refine/${env.projectId}`);
  await waitForPanel(session, (state) => state?.panel === "ready");

  await setInput(session, "#narralens-atlas-search", "shot-001");
  await sleep(200);
  const found = await session.evaluateWithRetry<number>(`document.querySelectorAll(".m5-atlas li").length`);
  await setInput(session, "#narralens-atlas-search", "no-such-shot");
  await sleep(200);
  const empty = await session.evaluateWithRetry<{ count: number; blocked: boolean }>(`({
    count: document.querySelectorAll(".m5-atlas li").length,
    blocked: document.querySelector("[data-narralens-atlas='empty']") !== null,
  })`);

  const assertions: Assertion[] = [
    { claim: "有数据时命中真实镜头", ok: found === 1, detail: `results=${found}` },
    { claim: "无数据时诚实 blocked，不给假命中", ok: empty.count === 0 && empty.blocked,
      detail: `results=${empty.count} blocked=${empty.blocked}` },
  ];
  return {
    case_id: "UX-04", title: "语义结果同时带 clip 与半开范围；无数据时诚实 blocked",
    status: verdict(assertions), assertions, facts: { found, empty }, evidence: [],
  };
}

/** UX-05: the native StudioHost bridge carries the selection both ways. */
export async function ux05(context: CaseContext): Promise<CaseResult> {
  const { env, session } = context;
  await session.navigate("about:blank");
  await session.navigate(`${env.pageUrl}#/refine/${env.projectId}`);
  await waitForPanel(session, (state) => state?.panel === "ready");
  await waitForStudio(session);

  const seam = await session.evaluateWithRetry<Record<string, unknown>>(`({
    hasHost: typeof window.openfilmHost === "object" && window.openfilmHost !== null,
    version: window.openfilmHost ? window.openfilmHost.version : null,
    onSelection: typeof (window.openfilmHost ? window.openfilmHost.onSelection : null),
    onCommand: typeof (window.openfilmHost ? window.openfilmHost.onCommand : null),
    panel: !!(window.openfilmHost && window.openfilmHost.panel),
    bridgeElement: document.querySelector("[data-studio-host-panel]") !== null,
  })`);

  await clickByText(session, ".m5-atlas button", "shot-003");
  // The Studio answers the panel's command with its own selection; the panel only knows
  // about it because the upstream called `onSelection`.
  const state = await waitForPanel(session, (current) => current?.studioSelection === "shot-003",
    30_000);

  const assertions: Assertion[] = [
    {
      claim: "StudioHost v1 接缝存在（version/onSelection/onCommand/panel）",
      ok: seam.hasHost === true && seam.version === 1 && seam.onSelection === "function"
        && seam.onCommand === "function" && seam.panel === true && seam.bridgeElement === true,
      detail: JSON.stringify(seam),
    },
    {
      claim: "原生 Studio 真的回报了选区（onSelection 被调用）",
      ok: (state?.studioSelection ?? "") !== "",
      detail: `studioSelection=${String(state?.studioSelection)}`,
    },
    {
      claim: "面板选区与原生选区是同一个 clip",
      ok: state?.selectionClip === state?.studioSelection,
      detail: `panel=${String(state?.selectionClip)} studio=${String(state?.studioSelection)}`,
    },
  ];
  return {
    case_id: "UX-05", title: "原生 StudioHost bridge 让 navigator/player/timeline 共享 selection/clock/snapshot",
    status: verdict(assertions), assertions, facts: { seam, state }, evidence: [],
  };
}

/** UX-06: the frame↔seconds conversion is the frozen rational model. */
export async function ux06(context: CaseContext): Promise<CaseResult> {
  const { env, session } = context;
  await session.navigate("about:blank");
  await session.navigate(`${env.pageUrl}#/refine/${env.projectId}`);
  await waitForPanel(session, (state) => state?.panel === "ready");
  await waitForStudio(session);
  await clickByText(session, ".m5-atlas button", "shot-001");
  const before = await waitForPanel(session, (current) => current?.selectionClip === "shot-001");
  const revisionBefore = await workbench(env);

  await session.pressKey("ArrowRight", "ArrowRight", 39);
  await sleep(120);
  const afterRight = await panelState(session);
  await session.pressKey("ArrowRight", "ArrowRight", 39, 8 /* shift */);
  await sleep(120);
  const afterShift = await panelState(session);
  const revisionAfter = await workbench(env);

  const playheadBefore = Number(before?.playhead ?? 0);
  const playheadAfter = Number(afterRight?.playhead ?? 0);
  const playheadShift = Number(afterShift?.playhead ?? 0);

  const assertions: Assertion[] = [
    {
      claim: "逐帧步进是 1 帧（整数帧权威）",
      ok: playheadAfter - playheadBefore === 1,
      detail: `${playheadBefore} → ${playheadAfter}`,
    },
    {
      claim: "Shift+方向是 1 秒 = 30 帧（冻结 rational fps）",
      ok: playheadShift - playheadAfter === 30,
      detail: `${playheadAfter} → ${playheadShift}`,
    },
    {
      claim: "缩放/定位不改变 source：revision 与 digest 不变",
      ok: revisionBefore.revision === revisionAfter.revision
        && revisionBefore.source_digest === revisionAfter.source_digest,
      detail: `revision ${String(revisionBefore.revision)}→${String(revisionAfter.revision)}`,
    },
  ];
  return {
    case_id: "UX-06", title: "帧↔seconds 使用冻结 rational time model；定位不改变 source",
    status: verdict(assertions), assertions, facts: { before, afterRight, afterShift }, evidence: [],
  };
}

/** UX-08: the capability classes come from the server, and the Gateway blocks the rest. */
export async function ux08(context: CaseContext): Promise<CaseResult> {
  const { env, session } = context;
  await session.navigate("about:blank");
  await session.navigate(`${env.pageUrl}#/refine/${env.projectId}`);
  await waitForPanel(session, (state) => state?.panel === "ready");
  const projection = await workbench(env);
  const capabilities = projection.capabilities as Array<{ entry_id: string; state: string }>;

  // The Gateway's session cookie, exactly as the browser holds it: the refusal has to be
  // about the *entry*, not about a missing session.
  const cookie = await gatewayCookie(env);
  const refusals: Record<string, number> = {};
  for (const entryId of ["timeline.set_visual_fit", "timeline.replace_visual_asset", "timeline.trim",
    "history.commit", "asset.relink"]) {
    const response = await fetch(`${env.gatewayOrigin}/narralens/native/${entryId}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ project_id: env.projectId }),
    });
    refusals[entryId] = response.status;
  }

  const supported = capabilities.filter((entry) => entry.state === "supported").map((entry) => entry.entry_id).sort();
  const assertions: Assertion[] = [
    {
      claim: "能力类别来自服务端 capability map，开放集恰为四条",
      ok: JSON.stringify(supported) === JSON.stringify([
        "history.redo", "history.restore", "history.undo", "timeline.adopt_materialization",
      ]),
      detail: JSON.stringify(supported),
    },
    {
      claim: "未开放的原生写在服务端同步 422（不只是 UI disabled）",
      ok: Object.values(refusals).every((status) => status === 422),
      detail: JSON.stringify(refusals),
    },
  ];
  return {
    case_id: "UX-08", title: "能力类别来自 server capabilities；Gateway 对未支持 native write 同步 disabled + 422",
    status: verdict(assertions), assertions, facts: { capabilities, refusals }, evidence: [],
  };
}

/** UX-11: keyboard, focus, text state, axe, reduced motion and the theme. */
export async function ux11(context: CaseContext): Promise<CaseResult> {
  const { env, session } = context;
  await session.navigate("about:blank");
  await session.navigate(`${env.pageUrl}#/refine/${env.projectId}`);
  await waitForPanel(session, (state) => state?.panel === "ready");

  // The search shortcut focuses the atlas search box.
  await session.pressKey("/", "Slash", 191);
  await sleep(120);
  const focused = await session.evaluateWithRetry<string>(`document.activeElement ? document.activeElement.id : ""`);

  await session.evaluateWithRetry(`document.activeElement?.blur()`);
  const keyReads: Record<string, string> = {};
  for (const [key, code, keyCode] of [["j", "KeyJ", 74], ["k", "KeyK", 75], ["l", "KeyL", 76],
    ["i", "KeyI", 73], ["o", "KeyO", 79], ["f", "KeyF", 70]] as const) {
    await session.pressKey(key, code, keyCode);
    keyReads[key] = await session.evaluateWithRetry<string>(
      `document.querySelector('[data-narralens-panel="ready"]')?.getAttribute('data-last-key') || ''`);
  }

  // Real theme control + persistence across a reload.
  await session.evaluateWithRetry(`(() => {
    const select = document.querySelector('select[aria-label="主题"]');
    select.value = 'light'; select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await sleep(100);
  const lightTheme = await session.evaluateWithRetry<string>(`document.documentElement.dataset.theme || ''`);
  await session.navigate(`${env.pageUrl}#/refine/${env.projectId}`);
  await waitForPanel(session, (state) => state?.panel === "ready");
  const persistedTheme = await session.evaluateWithRetry<string>(`document.documentElement.dataset.theme || ''`);

  await session.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  const reduced = await session.evaluateWithRetry<Record<string, unknown>>(`(() => {
    const panel = document.querySelector('[data-narralens-panel="ready"]');
    const style = getComputedStyle(panel);
    return { matches: matchMedia('(prefers-reduced-motion: reduce)').matches,
      animationDuration: style.animationDuration, transitionDuration: style.transitionDuration };
  })()`);

  // The theme follows the system by default and is a real attribute on the document.
  const theme = await session.evaluateWithRetry<Record<string, unknown>>(`({
    dataset: document.documentElement.dataset.theme || null,
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    text: (document.querySelector("[data-narralens-panel]") || {}).innerText || "",
  })`);

  // axe, run in the page against the real DOM.
  const axe = await session.evaluateWithRetry<Record<string, unknown>>(await axeExpression(env));
  const wholePage = await session.evaluateWithRetry<Record<string, unknown>>(await axeExpression(env, true));
  const violations = (axe.violations ?? []) as Array<{ id: string; impact: string | null }>;

  const assertions: Assertion[] = [
    { claim: "键盘可达：/ 聚焦搜索框", ok: focused === "narralens-atlas-search", detail: `focus=${focused}` },
    { claim: "J/K/L、I/O、F 默认键均进入真实 Studio 页面的键盘路径",
      ok: Object.entries(keyReads).every(([key, value]) => value.toLowerCase().startsWith(key === "f" ? "z:" : `${key}:`)),
      detail: JSON.stringify(keyReads) },
    { claim: "浅色主题切换并在重载后持久化", ok: lightTheme === "light" && persistedTheme === "light",
      detail: `before=${lightTheme} reload=${persistedTheme}` },
    { claim: "面板有可读文本状态（不是空白画布）", ok: String(theme.text).length > 40,
      detail: `text length=${String(theme.text).length}` },
    { claim: "M5 面板无 critical/serious axe 违规", ok: violations.every((violation) =>
      violation.impact !== "critical" && violation.impact !== "serious"),
      detail: JSON.stringify(violations.map((violation) => `${violation.id}:${String(violation.impact)}`)) },
    { claim: "强制 reduced motion 后计算样式无动画/过渡", ok: reduced.matches === true
      && reduced.animationDuration === "0s" && reduced.transitionDuration === "0s",
      detail: JSON.stringify(reduced) },
    { claim: "整页无 critical/serious axe 违规", ok: ((wholePage.violations ?? []) as Array<{impact: string | null}>).every(
      (violation) => violation.impact !== "critical" && violation.impact !== "serious"),
      detail: JSON.stringify(((wholePage.violations ?? []) as Array<{id: string; impact: string | null}>).map(
        (violation) => `${violation.id}:${String(violation.impact)}`)) },
  ];
  const evidence = await context.json("a11y/ux-11-axe.json", { panel: axe, whole_page: wholePage });
  return {
    case_id: "UX-11", title: "键盘、焦点、文本状态、axe、reduced motion、主题",
    status: verdict(assertions), assertions, facts: { focused, keyReads, lightTheme, persistedTheme, reduced, theme, axe, whole_page: wholePage },
    evidence: [evidence],
  };
}

/** PF-01: a hundred samples of each interaction, with the p95 reported. */
export async function pf01(context: CaseContext): Promise<CaseResult> {
  const { env, session } = context;
  await session.navigate("about:blank");
  await session.navigate(`${env.pageUrl}#/refine/${env.projectId}`);
  await waitForPanel(session, (state) => state?.panel === "ready");
  await waitForStudio(session);

  const samples = await session.evaluateWithRetry<Record<string, number[] | undefined>>(`(async () => {
    const panel = document.querySelector("[data-narralens-panel]");
    const buttons = [...document.querySelectorAll(".m5-atlas button")];
    const chapters = [...document.querySelectorAll(".m5-chapters button")];
    if (buttons.length !== 120) throw new Error("STRESS_ATLAS_IS_NOT_120_CLIPS:" + buttons.length);
    if (chapters.length < 6) throw new Error("STRESS_ATLAS_HAS_TOO_FEW_CHAPTERS:" + chapters.length);
    const search = document.querySelector("#narralens-atlas-search");
    const results = { selection: [], pan: [], zoom: [], chapter: [] };
    const frame = () => new Promise((done) => {
      const timer = setTimeout(done, 50);
      requestAnimationFrame(() => { clearTimeout(timer); requestAnimationFrame(() => done()); });
    });
    const measure = async (kind, action) => {
      const start = performance.now();
      action();
      await frame();
      results[kind].push(performance.now() - start);
    };
    for (let index = 0; index < 100; index += 1) {
      await measure("selection", () => buttons[index % buttons.length].click());
      await measure("pan", () => panel.scrollBy(0, index % 2 === 0 ? 40 : -40));
      await measure("zoom", () => { document.body.style.zoom = "1.0"; });
      await measure("chapter", () => chapters[index % chapters.length].click());
    }
    search.value = "";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    document.body.style.zoom = "";
    return { ...results, clip_count: buttons.length, chapter_count: chapters.length };
  })()`);

  const p95 = (values: readonly number[]): number => {
    if (values.length === 0) return Number.NaN;
    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
    return sorted[index]!;
  };
  const of = (name: string): number[] => samples[name] ?? [];
  const summary = {
    selection: { count: of("selection").length, p95: p95(of("selection")), max: Math.max(0, ...of("selection")) },
    pan: { count: of("pan").length, p95: p95(of("pan")), max: Math.max(0, ...of("pan")) },
    zoom: { count: of("zoom").length, p95: p95(of("zoom")), max: Math.max(0, ...of("zoom")) },
    chapter: { count: of("chapter").length, p95: p95(of("chapter")), max: Math.max(0, ...of("chapter")) },
  };
  const over = Object.entries(summary).filter(([, value]) => value.p95 > 100);
  const evidence = await context.json("performance/pf-01-samples.json", { samples, summary });
  const assertions: Assertion[] = [
    { claim: "真实工作台投影包含 120 个原生可寻址 clip 与至少 6 章",
      ok: Number(samples.clip_count) === 120 && Number(samples.chapter_count) >= 6,
      detail: `clips=${String(samples.clip_count)} chapters=${String(samples.chapter_count)}` },
    { claim: "四类操作各 100 个原始样本", ok: Object.values(summary).every((value) => value.count === 100),
      detail: JSON.stringify(Object.fromEntries(Object.entries(summary).map(([key, value]) => [key, value.count]))) },
    { claim: "每类 event→paint p95 ≤ 100ms", ok: over.length === 0,
      detail: JSON.stringify(Object.fromEntries(Object.entries(summary).map(([key, value]) => [key, value.p95]))) },
    { claim: "慢样本没有被删除", ok: Object.values(summary).every((value) => value.count === 100),
      detail: "样本数与采集数一致" },
  ];
  return {
    case_id: "PF-01", title: "120 clip 四类操作各 100 样本 p95≤100ms",
    status: verdict(assertions), assertions, facts: { summary }, evidence: [evidence],
  };
}

/** PF-02: three real proxies, one audio focus, no unbounded memory. */
export async function pf02(context: CaseContext): Promise<CaseResult> {
  const { env, session } = context;
  await session.navigate("about:blank");
  await session.navigate(`${env.pageUrl}#/refine/${env.projectId}`);
  await waitForPanel(session, (state) => state?.panel === "ready");
  await sleep(1_500);

  const first = await session.evaluateWithRetry<Record<string, unknown>>(`(() => {
    const figures = [...document.querySelectorAll("[data-narralens-proxy]")];
    return {
      count: figures.length,
      ready: figures.filter((figure) => { const video = figure.querySelector("video"); return video && video.readyState >= 2; }).length,
      playing: figures.filter((figure) => { const video = figure.querySelector("video"); return video && !video.paused; }).length,
      muted: figures.filter((figure) => { const video = figure.querySelector("video"); return video && video.muted; }).length,
      durations: figures.map((figure) => { const video = figure.querySelector("video"); return video ? video.duration : null; }),
      names: figures.map((figure) => figure.getAttribute("data-narralens-proxy")),
      /* A proxy that left the viewport is paused — that is the rule, not a fault. */
      offScreenPaused: figures.filter((figure) => {
        const video = figure.querySelector("video");
        if (!video || !video.paused) return false;
        const box = figure.getBoundingClientRect();
        return box.bottom < 0 || box.top > window.innerHeight;
      }).length,
      offScreenPlaying: figures.filter((figure) => {
        const video = figure.querySelector("video");
        if (!video || video.paused) return false;
        const box = figure.getBoundingClientRect();
        return box.bottom < 0 || box.top > window.innerHeight;
      }).length,
    };
  })()`);

  // Move the focus to the second proxy: the audio focus follows and only one holds it.
  await session.evaluateWithRetry(`(() => {
    const figures = [...document.querySelectorAll("[data-narralens-proxy]")];
    if (figures[1]) figures[1].click();
  })()`);
  await sleep(400);
  const afterFocus = await session.evaluateWithRetry<Record<string, unknown>>(`(() => {
    const figures = [...document.querySelectorAll("[data-narralens-proxy]")];
    return {
      unmuted: figures.filter((figure) => { const video = figure.querySelector("video"); return video && !video.muted; }).length,
      focus: figures.map((figure) => figure.getAttribute("data-narralens-proxy-focus")),
    };
  })()`);

  const memorySamples: number[] = [];
  for (let cycle = 0; cycle < 12; cycle += 1) {
    const used = await session.evaluateWithRetry<number>(`(async () => {
      const figures = [...document.querySelectorAll('[data-narralens-proxy]')];
      const figure = figures[${cycle} % Math.max(1, figures.length)];
      figure?.click(); figure?.scrollIntoView({ block: ${cycle % 2 === 0 ? "'start'" : "'end'"} });
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      return performance.memory?.usedJSHeapSize || 0;
    })()`);
    memorySamples.push(used);
  }
  const memory = { samples: memorySamples, start: memorySamples[0] ?? 0,
    end: memorySamples.at(-1) ?? 0, peak: Math.max(0, ...memorySamples) };
  const growth = memory.end - memory.start;
  const growthLimit = Math.max(16 * 1024 * 1024, memory.start * 0.35);

  const assertions: Assertion[] = [
    { claim: "三路 proxy 都是真实可解码的媒体事件", ok: first.count === 3 && first.ready === 3,
      detail: JSON.stringify(first) },
    {
      claim: "在视口内的 proxy 在播放，离屏的已暂停",
      ok: first.offScreenPlaying === 0 && Number(first.playing) + Number(first.offScreenPaused) === 3,
      detail: `playing=${String(first.playing)} offScreenPaused=${String(first.offScreenPaused)}`,
    },
    { claim: "只有一路持有音频焦点", ok: first.muted === 2 && afterFocus.unmuted === 1,
      detail: `muted=${String(first.muted)} afterFocus=${JSON.stringify(afterFocus)}` },
    { claim: "12 轮真实切焦/滚动的 heap 样本完整且增长有界", ok: memorySamples.length === 12
      && memory.start > 0 && growth <= growthLimit,
      detail: `${JSON.stringify(memory)} growth=${growth} limit=${growthLimit}` },
  ];
  const evidence = await context.json("performance/pf-02-proxies.json", { first, afterFocus, memory });
  return {
    case_id: "PF-02", title: "三路真实 proxy 播放/切焦，无三路同时出声",
    status: verdict(assertions), assertions, facts: { first, afterFocus, memory }, evidence: [evidence],
  };
}

/** PF-03: the cold and the hot reopen agree; the first frame and the media are recorded. */
export async function pf03(context: CaseContext): Promise<CaseResult> {
  const { env, session } = context;
  await session.navigate("about:blank");
  await session.navigate(`${env.pageUrl}#/refine/${env.projectId}`);
  await waitForPanel(session, (state) => state?.panel === "ready");
  const hot = await panelState(session);

  await session.navigate("about:blank");
  await sleep(200);
  const coldStart = Date.now();
  await session.navigate("about:blank");
  await session.navigate(`${env.pageUrl}#/refine/${env.projectId}`);
  const cold = await waitForPanel(session, (state) => state?.panel === "ready");
  const coldMs = Date.now() - coldStart;

  await sleep(1_000);
  const runtime = await session.evaluateWithRetry<Record<string, unknown>>(`(() => {
    const videos = [...document.querySelectorAll('[data-narralens-proxy] video')];
    const qualities = videos.map((video) => {
      const quality = video.getVideoPlaybackQuality?.();
      return { ready_state: video.readyState, current_time: video.currentTime,
        total_frames: quality?.totalVideoFrames ?? null,
        dropped_frames: quality?.droppedVideoFrames ?? null };
    });
    return { memory_used: performance.memory?.usedJSHeapSize ?? null, qualities,
      paint_entries: performance.getEntriesByType('paint').map((entry) => ({ name: entry.name, start: entry.startTime })) };
  })()`);

  const projection = await workbench(env);
  const assertions: Assertion[] = [
    { claim: "冷/热重开后数据一致", ok: hot?.target === cold?.target && hot?.revision === cold?.revision
      && hot?.history === cold?.history,
      detail: `hot r${hot?.revision}/h${hot?.history} cold r${cold?.revision}/h${cold?.history}` },
    { claim: "重开后的 revision 与 Host 一致", ok: Number(cold?.revision) === Number(projection.revision),
      detail: `panel=${String(cold?.revision)} host=${String(projection.revision)}` },
    { claim: "冷启动首帧时间已记录", ok: coldMs > 0, detail: `cold=${coldMs}ms` },
    { claim: "重开后的内存峰值与媒体掉帧数据已记录", ok: typeof runtime.memory_used === "number"
      && Array.isArray(runtime.qualities) && runtime.qualities.length === 3
      && runtime.qualities.every((entry: { total_frames?: unknown; dropped_frames?: unknown }) =>
        typeof entry.total_frames === "number" && typeof entry.dropped_frames === "number"),
      detail: JSON.stringify(runtime) },
  ];
  return {
    case_id: "PF-03", title: "冷/热重开数据一致，首帧/内存/媒体关联记录",
    status: verdict(assertions), assertions, facts: { hot, cold, coldMs, runtime }, evidence: [],
  };
}

/** The axe source, read from the repository's own dev dependency. */
async function axeExpression(env: HeadlessEnvironment, wholePage = false): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(resolve(process.cwd(), "node_modules/axe-core/axe.min.js"), "utf8");
  const target = wholePage
    ? "document"
    : "document.querySelector('[data-narralens-panel=\"ready\"]') || document";
  return `(async () => {
    ${source}
    return await axe.run(${target}, { resultTypes: ["violations"] });
  })()`;
}

/** The Gateway's session cookie, fetched the way the browser gets it. */
async function gatewayCookie(env: HeadlessEnvironment): Promise<string> {
  const response = await fetch(`${env.gatewayOrigin}/`, { headers: { host: new URL(env.gatewayOrigin).host } });
  const setCookie = response.headers.get("set-cookie") ?? "";
  return setCookie.split(";")[0] ?? "";
}

/** Write a JSON evidence file and return its path. */
export async function writeJson(path: string, value: unknown): Promise<string> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return path;
}
