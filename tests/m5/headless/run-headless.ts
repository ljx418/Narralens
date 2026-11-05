import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  pf01, pf02, pf03, ux01, ux02, ux03, ux04, ux05, ux06, ux08, ux11,
  type CaseContext, type CaseResult,
} from "./cases.js";
import { startBrowser, startEnvironment, writeEvidence, REPO, type HeadlessBrowser, type HeadlessEnvironment } from "./environment.js";
import { ux07, ux09, ux10 } from "./closed-loop.js";
import { recordWritePaths } from "./write-paths.js";
import { CdpSession } from "./cdp.js";
import { findChrome, makeProfile } from "./chrome.js";

/**
 * The M5C Headless runner (Wave 3 `04` §7, `02` §5).
 *
 * It starts the Host, the Studio, the Gateway, the browser and the fixtures; it drives
 * the experience cases in a real page; it writes the evidence; and it closes everything
 * it started — in a `finally`, so a failed case still leaves no window and no process
 * behind.
 *
 * The runner is honest by construction: a case that cannot be measured here is recorded
 * as `BLOCKED_ENV` or `NOT_RUN`, never as `PASS`.
 */
const EVIDENCE_ROOT = resolve(REPO, "docs/evidence/WAVE3/M5");
const RUN_ID = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
/**
 * Where the evidence lands.
 *
 * The capture script points this at the commit's own directory, so a capture is one
 * directory named after the commit it belongs to. A standalone run gets a timestamped
 * directory of its own, so nothing is ever overwritten.
 */
const CAPTURE_ROOT = process.env.NARRALENS_M5_EVIDENCE_ROOT
  ?? resolve(EVIDENCE_ROOT, "captures", RUN_ID);

const cases: Array<{ id: string; run: (context: CaseContext) => Promise<CaseResult> }> = [
  { id: "UX-01", run: ux01 },
  { id: "UX-02", run: ux02 },
  { id: "UX-03", run: ux03 },
  { id: "UX-04", run: ux04 },
  { id: "UX-05", run: ux05 },
  { id: "UX-06", run: ux06 },
  { id: "UX-07", run: ux07 },
  { id: "UX-09", run: ux09 },
  { id: "UX-10", run: ux10 },
  { id: "UX-08", run: ux08 },
  { id: "UX-11", run: ux11 },
  { id: "PF-01", run: pf01 },
  { id: "PF-02", run: pf02 },
  { id: "PF-03", run: pf03 },
];

const results: CaseResult[] = [];
let browser: Awaited<ReturnType<typeof startBrowser>> | undefined;

try {
  await mkdir(CAPTURE_ROOT, { recursive: true });
  browser = await startBrowser();
  const instrument = browser;
  await writeEvidence(CAPTURE_ROOT, "browser/environment.json", `${JSON.stringify({
    run_id: RUN_ID, captured_at: new Date().toISOString(), browser: instrument.chrome.browser,
    executable: instrument.chrome.executable, windows_executable: instrument.chrome.windows,
    cdp_endpoint: instrument.chrome.endpoint, profile_root: instrument.profileRoot,
    headless: true, muted: true,
  }, null, 2)}\n`);

  // A run may be limited to some cases, so a single case can be re-run while it is being
  // fixed. The default is every case.
  const only = (process.env.NARRALENS_M5_CASES ?? "")
    .split(",").map((name) => name.trim()).filter((name) => name !== "");
  const selected = cases.filter((candidate) => only.length === 0 || only.includes(candidate.id));

  for (const entry of selected) {
    process.stdout.write(`M5 headless: ${entry.id} …\n`);
    // **Every case gets its own Host, its own migration and its own Studio.**
    //
    // A case that adopts a materialization changes the target it runs on, and the next
    // case would then be measuring a different film. Sharing one Host between the cases
    // made the order of the run part of the measurement, which is exactly what an
    // experience gate must not be.
    const env = await startEnvironment({ stress120: entry.id === "PF-01" });
    const context: CaseContext = {
      env,
      session: instrument.session,
      evidenceRoot: CAPTURE_ROOT,
      screenshot: async (name: string): Promise<string> => {
        const data = await instrument.session.screenshot();
        const path = resolve(CAPTURE_ROOT, "screenshots", name);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, Buffer.from(data, "base64"));
        return path;
      },
      json: async (name: string, value: unknown): Promise<string> =>
        await writeEvidence(CAPTURE_ROOT, name, `${JSON.stringify(value, null, 2)}\n`),
    };

    // The environment facts: the browser, the profile, the zoom read-back and the media.
    await writeEvidence(CAPTURE_ROOT, `browser/${entry.id}.json`, `${JSON.stringify({
      run_id: RUN_ID,
      captured_at: new Date().toISOString(),
      case_id: entry.id,
      browser: instrument.chrome.browser,
      executable: instrument.chrome.executable,
      windows_executable: instrument.chrome.windows,
      cdp_endpoint: instrument.chrome.endpoint,
      profile_root: instrument.profileRoot,
      gateway_origin: env.gatewayOrigin,
      host_origin: env.origin,
      target_project_id: env.projectId,
      page_url: env.pageUrl,
    }, null, 2)}\n`);
    if (entry.id === selected[0]?.id) {
      await writeEvidence(CAPTURE_ROOT, "browser/environment.json", `${JSON.stringify({
        run_id: RUN_ID, captured_at: new Date().toISOString(), browser: instrument.chrome.browser,
        executable: instrument.chrome.executable, windows_executable: instrument.chrome.windows,
        cdp_endpoint: instrument.chrome.endpoint, profile_root: instrument.profileRoot,
        gateway_origin: env.gatewayOrigin, host_origin: env.origin,
        target_project_id: env.projectId, page_url: env.pageUrl, headless: true, muted: true,
      }, null, 2)}\n`);
      await writeEvidence(CAPTURE_ROOT, "media/fixtures.json", `${JSON.stringify(env.fixtures, null, 2)}\n`);
    }

    let result: CaseResult;
    try {
      result = await entry.run(context);
    } catch (error) {
      result = {
        case_id: entry.id, title: entry.id, status: "FAIL",
        assertions: [{
          claim: "该 case 可以被运行",
          ok: false,
          detail: error instanceof Error ? error.message : String(error),
        }],
        facts: {}, evidence: [],
      };
    }
    results.push(result);
    await writeEvidence(CAPTURE_ROOT, `cases/${result.case_id}.json`,
      `${JSON.stringify({ run_id: RUN_ID, captured_at: new Date().toISOString(), ...result }, null, 2)}\n`);
    // Capture while the successful environment is still live. A screenshot of the
    // post-close "Studio connection lost" state is evidence of teardown, not the case.
    try {
      const state = await instrument.session.evaluateWithRetry<string>(
        `document.querySelector('[data-narralens-panel]')?.getAttribute('data-narralens-panel') || ''`);
      if (state !== "ready") throw new Error(`SCREENSHOT_PANEL_NOT_READY:${state}`);
      await context.screenshot(`${result.case_id}.png`);
    } catch (error) {
      result = { ...result, status: "FAIL", assertions: [...result.assertions, {
        claim: "成功态截图在环境关闭前捕获", ok: false,
        detail: error instanceof Error ? error.message : String(error),
      }] };
      results[results.length - 1] = result;
      await writeEvidence(CAPTURE_ROOT, `cases/${result.case_id}.json`,
        `${JSON.stringify({ run_id: RUN_ID, captured_at: new Date().toISOString(), ...result }, null, 2)}\n`);
    } finally {
      await env.close();
    }
    process.stdout.write(`M5 headless: ${result.case_id} → ${result.status}\n`);
  }

  if (only.length === 0 || only.includes("UX-RESP")) {
    results.push(await recordResponsiveMatrix());
  }

  // The native 200% run.
  //
  // The zoom is the browser's own default zoom, written into an isolated profile by the
  // repository's existing D4.2.1 script, and read back from the page: the device pixel
  // ratio and the layout viewport. Nothing is faked with a device scale factor, a
  // shrunken viewport or a CSS transform.
  // The human gate is a case too: it is recorded as NOT_RUN, with the reason, so that a
  // reader sees it was *considered* and not simply forgotten.
  results.push({
    case_id: "UX-12", title: "人类一分钟定位/比较、十秒找到恢复、理解 impact 与错误",
    status: "NOT_RUN",
    assertions: [{
      claim: "项目负责人亲自走一遍并签署",
      ok: false,
      detail: "人工体验门：自动化不得代签。项目负责人尚未执行，UX-12 保持 HUMAN_NOT_RUN。",
    }],
    facts: { human_gate: "HUMAN_NOT_RUN" }, evidence: [],
  });

  // The write paths, before and after.
  try {
    const writeEnv = await startEnvironment();
    try { await recordWritePaths(writeEnv, CAPTURE_ROOT); }
    finally { await writeEnv.close(); }
  } catch (error) {
    results.push({
      case_id: "WP-01", title: "写路径前后差异记录", status: "FAIL",
      assertions: [{
        claim: "写路径的前后差异能够被记录",
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      }],
      facts: {}, evidence: [],
    });
  }

  try {
    await recordZoom(browser, results);
  } catch (error) {
    // The zoom run is its own case: a browser that will not start for it does not undo the
    // cases that passed, and it must not be silent either.
    results.push({
      case_id: "UX-200", title: "原生 200% 页面缩放读回（隔离 profile）", status: "BLOCKED_ENV",
      assertions: [{
        claim: "原生 200% 的隔离 profile 浏览器能够启动",
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      }],
      facts: {}, evidence: [],
    });
  }
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  process.stdout.write(`M5 headless: BLOCKED_ENV ${reason}\n`);
  await writeEvidence(CAPTURE_ROOT, "blocked-env.json", `${JSON.stringify({
    run_id: RUN_ID, captured_at: new Date().toISOString(),
    reason, stage: "M5_BLOCKED_ENV",
  }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  await browser?.close();
}

/**
 * The native 200% read-back.
 *
 * The zoom is the browser's own default zoom, written into an isolated profile by the
 * repository's existing D4.2.1 script, and read back from the page: the device pixel
 * ratio, the layout viewport and whether the page overflows horizontally.
 */
async function recordZoom(instrument: HeadlessBrowser, results: CaseResult[]): Promise<void> {
  void instrument;
  const env = await startEnvironment();
  // The zoom profile has to live where the browser can open it: a Windows program cannot
  // use a WSL path, so the base follows the executable.
  const zoomExecutable = await findChrome();
  const profileRoot = await makeProfile(zoomExecutable, "narralens-m5-zoom-");
  const zoomProfile = resolve(REPO, "tests/evidence/create-d421-headless-zoom-profile.mjs");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  await run(process.execPath, [zoomProfile], {
    env: { ...process.env, D421_PROFILE_ROOT: profileRoot, D421_ZOOM_FACTOR: "2" },
  });
  // The zoom run needs its *own* browser: the zoom lives in the profile, and the run's
  // profile is the 100% one.
  const zoomBrowser = await startBrowser({ profileRoot });
  const chrome = zoomBrowser.chrome;
  const session = zoomBrowser.session;
  // The 100% baseline, measured in a *plain* profile on the same page: the claim is that
  // the zoomed layout viewport is about half of the 100% one, and both numbers have to
  // come from the same page.
  const plainBrowser = await startBrowser();
  try {
    await session.navigate(`${env.pageUrl}#/refine/${env.projectId}`);
    await plainBrowser.session.navigate(`${env.pageUrl}#/refine/${env.projectId}`);
    await new Promise((done) => setTimeout(done, 3_000));
    const layout = await session.evaluateWithRetry<Record<string, unknown>>(`({
      device_pixel_ratio: window.devicePixelRatio,
      inner_width: window.innerWidth,
      inner_height: window.innerHeight,
      document_width: document.documentElement.scrollWidth,
      document_height: document.documentElement.scrollHeight,
      overflow_x: document.documentElement.scrollWidth > window.innerWidth + 1,
      zoom_level: Math.log(window.devicePixelRatio) / Math.log(1.2),
    })`);
    const baseline = await plainBrowser.session.evaluateWithRetry<Record<string, unknown>>(`({
      inner_width: window.innerWidth,
      inner_height: window.innerHeight,
      device_pixel_ratio: window.devicePixelRatio,
    })`);
    const zoomedWidth = Number(layout.inner_width);
    const baselineWidth = Number(baseline.inner_width);
    const ratio = baselineWidth > 0 ? zoomedWidth / baselineWidth : Number.NaN;
    await writeEvidence(CAPTURE_ROOT, "zoom/native-200.json", `${JSON.stringify({
      mechanism: "isolated Chrome profile native default zoom preference",
      preference: "partition.default_zoom_level.x",
      expected_factor: 2,
      layout,
      baseline,
      layout_to_baseline_ratio: ratio,
      note: "读回自页面本身：devicePixelRatio 与布局视口；没有使用 deviceScaleFactor、缩小 viewport 或 CSS transform。"
        + " 100% 基线由同一页面的另一个无缩放 profile 测得。",
    }, null, 2)}\n`);
    results.push({
      case_id: "UX-200", title: "原生 200% 页面缩放读回（隔离 profile）",
      status: Number(layout.device_pixel_ratio) === 2 && layout.overflow_x === false ? "PASS" : "FAIL",
      assertions: [{
        claim: "DPR=2 且无页面级横向溢出",
        ok: Number(layout.device_pixel_ratio) === 2 && layout.overflow_x === false,
        detail: JSON.stringify(layout),
      }, {
        claim: "布局视口约为 100% 的一半（原生缩放，不是缩小的 viewport）",
        ok: Math.abs(ratio - 0.5) < 0.12,
        detail: `zoomed=${zoomedWidth} baseline=${baselineWidth} ratio=${ratio}`,
      }],
      facts: { layout }, evidence: [],
    });
  } finally {
    await zoomBrowser.close();
    await plainBrowser.close();
    await env.close();
  }
}

/** Exercise the four contract viewports with four real headless browser processes. */
async function recordResponsiveMatrix(): Promise<CaseResult> {
  const env = await startEnvironment();
  const matrix = [
    { name: "desktop", width: 1440, height: 900 },
    { name: "compact", width: 1024, height: 768 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "narrow", width: 360, height: 800 },
  ];
  const facts: Array<Record<string, unknown>> = [];
  try {
    for (const viewport of matrix) {
      const candidate = await startBrowser(viewport);
      try {
        // Windows Chrome enforces a minimum outer window width. The responsive gate is
        // about CSS layout viewports (unlike UX-200's native browser zoom), so CDP sets
        // and then reads back the exact contract viewport.
        await candidate.session.call("Emulation.setDeviceMetricsOverride", {
          width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false,
        });
        await candidate.session.navigate(`${env.pageUrl}#/refine/${env.projectId}`);
        for (let attempt = 0; attempt < 120; attempt += 1) {
          const ready = await candidate.session.evaluateWithRetry<boolean>(
            `document.querySelector('[data-narralens-panel]')?.getAttribute('data-narralens-panel') === 'ready'`);
          if (ready) break;
          await new Promise((done) => setTimeout(done, 100));
        }
        const observed = await candidate.session.evaluateWithRetry<Record<string, unknown>>(`(() => {
          const panel = document.querySelector('[data-narralens-panel="ready"]');
          const panelHost = document.querySelector('#narralens-m5-panel');
          const search = document.querySelector('#narralens-atlas-search');
          const rect = panel?.getBoundingClientRect();
          return { inner_width: innerWidth, inner_height: innerHeight,
            document_width: document.documentElement.scrollWidth,
            overflow_x: document.documentElement.scrollWidth > innerWidth + 1,
            panel_ready: Boolean(panel), panel_width: rect?.width || 0, panel_height: rect?.height || 0,
            search_visible: Boolean(search && search.getBoundingClientRect().width > 0),
            narrow_notice: panelHost ? getComputedStyle(panelHost, '::before').content : 'none' };
        })()`);
        const png = await candidate.session.screenshot();
        const screenshot = resolve(CAPTURE_ROOT, "screenshots", `UX-RESP-${viewport.width}x${viewport.height}.png`);
        await mkdir(dirname(screenshot), { recursive: true });
        await writeFile(screenshot, Buffer.from(png, "base64"));
        facts.push({ ...viewport, ...observed, screenshot });
      } finally { await candidate.close(); }
    }
  } finally { await env.close(); }
  await writeEvidence(CAPTURE_ROOT, "responsive/viewports.json", `${JSON.stringify(facts, null, 2)}\n`);
  const assertions = [{
    claim: "1440/1024/768/360 四个真实视口均可用且无页面级横向溢出",
    ok: facts.length === 4 && facts.every((fact) => fact.panel_ready === true
      && fact.search_visible === true && fact.overflow_x === false),
    detail: JSON.stringify(facts.map((fact) => ({ width: fact.width, ready: fact.panel_ready,
      overflow_x: fact.overflow_x, panel_width: fact.panel_width }))),
  }, {
    claim: "360px 明示窄屏仅审阅/轻操作，不冒充原生精剪",
    ok: String(facts.find((fact) => fact.width === 360)?.narrow_notice ?? "").includes("窄屏审阅模式"),
    detail: String(facts.find((fact) => fact.width === 360)?.narrow_notice ?? ""),
  }];
  return { case_id: "UX-RESP", title: "四视口响应式与窄屏能力边界", status: verdict(assertions),
    assertions, facts: { matrix: facts }, evidence: ["responsive/viewports.json"] };
}

function verdict(assertions: readonly { ok: boolean }[]): "PASS" | "FAIL" {
  return assertions.every((assertion) => assertion.ok) ? "PASS" : "FAIL";
}

const summary = {
  captured_at: new Date().toISOString(),
  cases: results.map((result) => ({
    case_id: result.case_id, status: result.status, title: result.title,
    failed_assertions: result.assertions.filter((assertion) => !assertion.ok).map((assertion) => assertion.claim),
  })),
  passed: results.filter((result) => result.status === "PASS").length,
  failed: results.filter((result) => result.status === "FAIL").length,
  blocked: results.filter((result) => result.status === "BLOCKED_ENV").length,
  not_run: results.filter((result) => result.status === "NOT_RUN").length,
};
// Every status in the summary must have one canonical case file. Responsive, native
// zoom and the human gate are produced outside the ordinary per-environment loop, so
// writing all results here prevents the manifest/report from silently seeing a smaller
// case set than the summary.
for (const result of results) {
  await writeEvidence(CAPTURE_ROOT, `cases/${result.case_id}.json`,
    `${JSON.stringify({ run_id: RUN_ID, captured_at: new Date().toISOString(), ...result }, null, 2)}\n`);
}
await writeEvidence(CAPTURE_ROOT, "summary.json", `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (summary.failed > 0 || summary.blocked > 0) process.exitCode = 1;
