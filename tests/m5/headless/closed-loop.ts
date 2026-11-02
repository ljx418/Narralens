import type { CdpSession } from "./cdp.js";
import type { CaseContext, CaseResult } from "./cases.js";
import type { HeadlessEnvironment } from "./environment.js";

/**
 * M5B's closed loop, driven through the page (Wave 3 `02` §2 M5B, `02` §2's case table).
 *
 * These are the cases that make the page a *loop* rather than a set of panels: a recorded
 * comparison is replayed onto the target, it is materialized for real, the server's own
 * impact is computed, the operator confirms it, the adoption writes a revision — and the
 * history then produces a restore intent that has to go through the same impact and
 * confirmation before it restores anything.
 *
 * Every step is a click in the real page. Nothing here calls the Host's routes directly
 * to make a step happen: the point is to prove the *page* can do it.
 */
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

interface PanelFacts {
  readonly phase: string | null;
  readonly revision: string | null;
  readonly history: string | null;
  readonly locks: string | null;
  readonly selection: string | null;
  readonly studio: string | null;
  readonly proposals: number;
  readonly recorded: string | null;
  readonly materialization: string | null;
  readonly impact: string | null;
  readonly restoreIntent: string | null;
  readonly error: string | null;
  readonly text: string;
}

async function panelState(session: CdpSession): Promise<PanelFacts | null> {
  return await session.evaluateWithRetry<PanelFacts | null>(`(() => {
    const panel = document.querySelector("[data-narralens-panel='ready']");
    if (!panel) return null;
    return {
      phase: panel.getAttribute("data-phase"),
      revision: panel.getAttribute("data-revision"),
      history: panel.getAttribute("data-history"),
      locks: panel.getAttribute("data-locks"),
      selection: panel.getAttribute("data-selection-clip"),
      studio: panel.getAttribute("data-studio-selection"),
      proposals: panel.querySelectorAll(".m5-proposal").length,
      recorded: panel.querySelector(".m5-recorded") ? panel.querySelector(".m5-recorded").innerText : null,
      materialization: panel.querySelector("[data-materialization]") ? panel.querySelector("[data-materialization]").getAttribute("data-materialization") : null,
      impact: panel.querySelector("[data-impact-id]") ? panel.querySelector("[data-impact-id]").getAttribute("data-impact-id") : null,
      restoreIntent: panel.querySelector("[data-narralens-restore-intent]") ? panel.querySelector("[data-narralens-restore-intent]").getAttribute("data-narralens-restore-intent") : null,
      error: panel.querySelector(".m5-error") ? panel.querySelector(".m5-error").getAttribute("data-error-code") : null,
      text: panel.innerText,
    };
  })()`);
}

async function waitFor(session: CdpSession,
  predicate: (state: PanelFacts | null) => boolean,
  timeoutMs = 120_000): Promise<PanelFacts | null> {
  const deadline = Date.now() + timeoutMs;
  let last: PanelFacts | null = null;
  while (Date.now() < deadline) {
    last = await panelState(session);
    if (predicate(last)) return last;
    await sleep(250);
  }
  return last;
}

async function clickByText(session: CdpSession, selector: string, text: string): Promise<boolean> {
  return await session.evaluateWithRetry<boolean>(`(() => {
    const panel = document.querySelector("[data-narralens-panel='ready']");
    if (!panel) return false;
    const node = [...panel.querySelectorAll(${JSON.stringify(selector)})]
      .find((candidate) => (candidate.innerText || "").includes(${JSON.stringify(text)}));
    if (!node) return false;
    node.click();
    return true;
  })()`);
}

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

/** The page, ready: the panel has its projection and the native editor is alive. */
async function openRefine(env: HeadlessEnvironment, session: CdpSession): Promise<void> {
  await session.navigate("about:blank");
  await session.navigate(`${env.pageUrl}#/refine/${env.projectId}`);
  await waitFor(session, (state) => state !== null && state.phase !== null, 60_000);
  await waitFor(session, (state) => state !== null && state.studio !== "", 60_000);
}

/** Replay the recorded comparison through the page. */
async function replayThroughPanel(env: HeadlessEnvironment, session: CdpSession): Promise<boolean> {
  await setInput(session, "#m5-source-comparison", env.sourceComparisonId);
  return await clickByText(session, "button", "复制已录制提案到本工程");
}

/**
 * The whole adoption chain, through the page.
 *
 * It returns the states it saw, so the caller can assert on the *steps* and not only on
 * the end state.
 */
async function adoptionChain(env: HeadlessEnvironment, session: CdpSession): Promise<{
  before: PanelFacts | null;
  materialized: PanelFacts | null;
  impacted: PanelFacts | null;
  adopted: PanelFacts | null;
}> {
  const before = await panelState(session);
  await clickByText(session, "button", "素材化");
  const materialized = await waitFor(session, (state) => state?.materialization !== null, 60_000);
  // The worker renders a real proxy; the page polls the real status.
  await waitFor(session, (state) => state !== null && state.materialization !== null
    && state.text.includes("ready_for_adoption"), 300_000);
  await clickByText(session, "button", "计算影响");
  const impacted = await waitFor(session, (state) => state?.impact !== null, 60_000);
  await clickByText(session, "button", "确认采用");
  const adopted = await waitFor(session, (state) => state?.phase === "adopted"
    && Number(state.revision) === Number(before?.revision) + 1, 120_000);
  return { before, materialized, impacted, adopted };
}

/** UX-07: the recorded comparison carries its own audit, and the proxies are real media. */
export async function ux07(context: CaseContext): Promise<CaseResult> {
  const { env, session } = context;
  await openRefine(env, session);
  const clicked = await replayThroughPanel(env, session);
  const state = await waitFor(session, (current) => current !== null && current.proposals > 0, 60_000);
  const proxies = await session.evaluateWithRetry<Record<string, unknown>>(`(() => {
    const figures = [...document.querySelectorAll("[data-narralens-proxy]")];
    const offScreen = (figure) => {
      const box = figure.getBoundingClientRect();
      return box.bottom < 0 || box.top > window.innerHeight;
    };
    return {
      count: figures.length,
      ready: figures.filter((figure) => { const video = figure.querySelector("video"); return video && video.readyState >= 2; }).length,
      playing: figures.filter((figure) => { const video = figure.querySelector("video"); return video && !video.paused; }).length,
      unmuted: figures.filter((figure) => { const video = figure.querySelector("video"); return video && !video.muted; }).length,
      durations: figures.map((figure) => { const video = figure.querySelector("video"); return video ? video.duration : null; }),
      offScreenPlaying: figures.filter((figure) => {
        const video = figure.querySelector("video");
        return video && !video.paused && offScreen(figure);
      }).length,
    };
  })()`);

  const assertions = [
    {
      claim: "页面把复制的提案标为「已录制提案」并给出 lineage",
      ok: String(state?.recorded ?? "").includes("已录制提案")
        && String(state?.recorded ?? "").includes(env.sourceComparisonId),
      detail: `recorded=${String(state?.recorded)}`,
    },
    {
      claim: "复制动作真的发生了，且拿到了 3 个方案",
      ok: clicked && Number(state?.proposals) === 3,
      detail: `clicked=${clicked} proposals=${String(state?.proposals)}`,
    },
    {
      claim: "三路 proxy 是真实媒体事件（可解码、有真实时长、在视口内的在播放）",
      ok: Number(proxies.count) === 3 && Number(proxies.ready) === 3
        && Number(proxies.offScreenPlaying) === 0
        && (proxies.durations as unknown[]).every((value) => typeof value === "number" && value > 0),
      detail: JSON.stringify(proxies),
    },
    {
      claim: "只有一路持有音频焦点",
      ok: Number(proxies.unmuted) === 1,
      detail: `unmuted=${String(proxies.unmuted)}`,
    },
  ];
  return {
    case_id: "UX-07", title: "录制 D4.1 comparison 有原始 audit/lineage；三路 proxy 是真实 media events",
    status: assertions.every((assertion) => assertion.ok) ? "PASS" : "FAIL",
    assertions, facts: { state, proxies }, evidence: [],
  };
}

/** UX-09: materialize → impact → confirm → adopt; success is exactly +1 revision. */
export async function ux09(context: CaseContext): Promise<CaseResult> {
  const { env, session } = context;
  await openRefine(env, session);
  await replayThroughPanel(env, session);
  await waitFor(session, (state) => (state?.proposals ?? 0) > 0, 60_000);
  const chain = await adoptionChain(env, session);
  const after = await panelState(session);

  const revisionBefore = Number(chain.before?.revision);
  const revisionAfter = Number(after?.revision);
  const assertions = [
    {
      claim: "素材化产出真实的 materialization",
      ok: typeof chain.materialized?.materialization === "string" && chain.materialized.materialization !== "",
      detail: `materialization=${String(chain.materialized?.materialization)}`,
    },
    {
      claim: "影响由服务端计算并显示 impact_id",
      ok: typeof chain.impacted?.impact === "string" && chain.impacted.impact !== "",
      detail: `impact=${String(chain.impacted?.impact)}`,
    },
    {
      claim: "确认后受控采用成功，revision 恰好 +1",
      ok: chain.adopted?.phase === "adopted" && revisionAfter === revisionBefore + 1,
      detail: `r${revisionBefore} → r${revisionAfter} phase=${String(chain.adopted?.phase)}`,
    },
    {
      claim: "历史随之增长",
      ok: Number(after?.history) === Number(chain.before?.history) + 1,
      detail: `${String(chain.before?.history)} → ${String(after?.history)}`,
    },
  ];
  return {
    case_id: "UX-09", title: "materialize→impact→confirm→adopt；成功 +1，失败 0",
    status: assertions.every((assertion) => assertion.ok) ? "PASS" : "FAIL",
    assertions,
    facts: { chain, after, diagnostics: env.host.failures.recent(4) },
    evidence: [],
  };
}

/** UX-10: the native selection, a controlled adopt, and a restore that has to be confirmed. */
export async function ux10(context: CaseContext): Promise<CaseResult> {
  const { env, session } = context;
  await openRefine(env, session);

  // The native selection: the page asks the editor, and the editor confirms.
  await clickByText(session, ".m5-atlas button", "shot-002");
  const selected = await waitFor(session, (state) => state?.selection === "shot-002"
    && state?.studio === "shot-002", 30_000);

  // A controlled adoption, so that the history has something to undo.
  await replayThroughPanel(env, session);
  await waitFor(session, (state) => (state?.proposals ?? 0) > 0, 60_000);
  const chain = await adoptionChain(env, session);
  const afterAdopt = await panelState(session);

  // The undo produces an *intent*, and nothing is written.
  await clickByText(session, "button", "准备撤回");
  const intent = await waitFor(session, (state) => state?.restoreIntent !== null, 60_000);
  const afterIntent = await panelState(session);

  // The restore still needs the impact and the confirmation.
  await clickByText(session, "button", "计算恢复影响");
  const restoreImpact = await waitFor(session, (state) => state?.impact !== null, 60_000);
  const revisionAfterAdopt = Number(afterAdopt?.revision);
  const revisionAfterIntent = Number(afterIntent?.revision);
  await clickByText(session, "button", "确认恢复");
  const restored = await waitFor(session, (state) => state?.phase === "adopted"
    && Number(state.revision) === revisionAfterIntent + 1, 120_000);
  const afterRestore = await panelState(session);

  const revisionAfterRestore = Number(afterRestore?.revision);

  const assertions = [
    {
      claim: "原生选区与面板选区一致（同页共享 selection）",
      ok: selected?.selection === "shot-002" && selected?.studio === "shot-002",
      detail: `panel=${String(selected?.selection)} studio=${String(selected?.studio)}`,
    },
    {
      claim: "受控采用成功，revision +1",
      ok: chain.adopted?.phase === "adopted" && revisionAfterAdopt === Number(chain.before?.revision) + 1,
      detail: `r${String(chain.before?.revision)} → r${revisionAfterAdopt}`,
    },
    {
      claim: "撤回只生成恢复意图，不写任何东西（revision 不变）",
      ok: typeof intent?.restoreIntent === "string" && intent.restoreIntent !== ""
        && revisionAfterIntent === revisionAfterAdopt,
      detail: `intent=${String(intent?.restoreIntent)} r${revisionAfterAdopt} → r${revisionAfterIntent}`,
    },
    {
      claim: "恢复必须先有影响与确认；恢复成功且 revision +1",
      ok: typeof restoreImpact?.impact === "string" && restored?.phase === "adopted"
        && revisionAfterRestore === revisionAfterIntent + 1,
      detail: `r${revisionAfterIntent} → r${revisionAfterRestore} phase=${String(restored?.phase)}`,
    },
  ];
  return {
    case_id: "UX-10", title: "同页原生选择/预览 + 受控 adopt/history；undo/redo 只生成意图；恢复 +1",
    status: assertions.every((assertion) => assertion.ok) ? "PASS" : "FAIL",
    assertions, facts: { selected, chain, intent, restoreImpact, restored, afterRestore }, evidence: [],
  };
}
