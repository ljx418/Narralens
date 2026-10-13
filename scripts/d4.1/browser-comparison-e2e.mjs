import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const endpoint = "http://127.0.0.1:9232/json";
let pages;
for (let attempt = 0; attempt < 120; attempt += 1) {
  try { pages = await (await fetch(endpoint)).json(); break; } catch { await new Promise((done) => setTimeout(done, 250)); }
}
const page = pages?.find((item) => item.type === "page" && item.url.startsWith("http://127.0.0.1:4173"));
if (!page) throw new Error("Narralens D4.1 CDP page not found");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((open, reject) => { socket.addEventListener("open", open, { once: true }); socket.addEventListener("error", reject, { once: true }); });
let nextId = 1;
const pending = new Map();
socket.addEventListener("message", (event) => { const value = JSON.parse(event.data); const waiter = pending.get(value.id); if (waiter) { pending.delete(value.id); value.error ? waiter.reject(new Error(value.error.message)) : waiter.resolve(value.result); } });
const call = (method, params = {}) => new Promise((resolveCall, reject) => { const id = nextId++; pending.set(id, { resolve: resolveCall, reject }); socket.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => { const result = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.text); return result.result.value; };
const waitFor = async (predicate, label, attempts = 520) => { for (let attempt = 0; attempt < attempts; attempt += 1) { const value = await evaluate(predicate); if (value) return value; await new Promise((done) => setTimeout(done, 250)); } throw new Error(`UI condition not reached: ${label}`); };

await call("Page.enable"); await call("Runtime.enable");
await waitFor("document.body.innerText.includes('生成并比较提案')", "application ready");
const before = await evaluate(`(async()=>{const s=await fetch('/api/session').then(r=>r.json());return fetch('/api/projects/d1-30s',{headers:{authorization:'Bearer '+s.token}}).then(r=>r.json())})()`);
await evaluate(`document.querySelector('button.primary').focus()`);
await call("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
await call("Input.dispatchKeyEvent", { type: "char", key: "Enter", code: "Enter", text: "\r", unmodifiedText: "\r", windowsVirtualKeyCode: 13 });
await call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
await waitFor("document.body.innerText.includes('提案已就绪') && document.querySelectorAll('[role=tab]').length===3", "three proposal tabs");
const firstTitle = await evaluate("document.querySelector('[role=tab][aria-selected=true] b').textContent");
await evaluate(`document.querySelectorAll('[role=tab]')[1].focus()`);
await call("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
await call("Input.dispatchKeyEvent", { type: "char", key: "Enter", code: "Enter", text: "\r", unmodifiedText: "\r", windowsVirtualKeyCode: 13 });
await call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
const secondSelected = await waitFor("document.querySelectorAll('[role=tab]')[1].getAttribute('aria-selected')==='true' && document.activeElement===document.querySelectorAll('[role=tab]')[1]", "keyboard proposal switch");
const body = await evaluate("document.body.innerText");
const after = await evaluate(`(async()=>{const s=await fetch('/api/session').then(r=>r.json());return fetch('/api/projects/d1-30s',{headers:{authorization:'Bearer '+s.token}}).then(r=>r.json())})()`);
const evidenceRoot = resolve("docs/evidence/D4.1/artifacts"); await mkdir(evidenceRoot, { recursive: true });
const axeSource = await readFile(resolve("node_modules/axe-core/axe.min.js"), "utf8");
await evaluate(axeSource);
const accessibility = await evaluate(`axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa']}}).then(r=>({version:axe.version,passes:r.passes.length,incomplete:r.incomplete.map(v=>v.id),violations:r.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,failureSummary:n.failureSummary}))}))}))`);
const viewports = [[360, 900], [768, 1000], [1440, 1000], [1920, 1080]];
const layouts = [];
for (const [width, height] of viewports) {
  await call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width <= 768 });
  const layout = await evaluate(`({viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight})`);
  const capture = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  await writeFile(resolve(evidenceRoot, `ui-comparison-${width}.png`), Buffer.from(capture.data, "base64"));
  layouts.push({ width, height, ...layout, no_horizontal_overflow: layout.scrollWidth <= layout.viewport });
}
await call("Emulation.setDeviceMetricsOverride", { width: 720, height: 500, deviceScaleFactor: 2, mobile: false });
const zoomLayout = await evaluate(`({viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight})`);
const zoomCapture = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
await writeFile(resolve(evidenceRoot, "ui-comparison-text-200.png"), Buffer.from(zoomCapture.data, "base64"));
const hashes = await Promise.all(["fixtures/d1-30s/authors/main.svml", "fixtures/d1-30s/runs/build.svrun", "fixtures/d1-30s/assets/generated/narration-30s.wav"].map(async (path) => createHash("sha256").update(await readFile(resolve(path))).digest("hex")));
const report = { format: "narralens.d41-browser-e2e@1", executed_at: new Date().toISOString(), browser: "Google Chrome Headless via CDP", provider_calls: 1, automatic_retries: 0,
  actions: ["键盘提交默认三方案", "等待真实 Runner", "键盘切换第二方案", "检查四视口", "检查 200% 文本"],
  observed: { three_tabs: (await evaluate("document.querySelectorAll('[role=tab]').length")) === 3, first_title: firstTitle, keyboard_second_selected: secondSelected,
    no_adopt_button: !body.includes("采用方案"), read_only_copy: body.includes("仅比较，不写入 Source；采用与素材化尚未开放"),
    real_cost_visible: /\$\d+\.\d{4} USD/.test(body), source_status_visible: body.includes("项目尚未提供事实来源"), revision_unchanged: before.revision === after.revision },
  layouts, accessibility, text_200_percent: { physical_width: 1440, css_viewport: 720, device_scale_factor: 2, ...zoomLayout, no_horizontal_overflow: zoomLayout.scrollWidth <= zoomLayout.viewport },
  project_hashes_after: { source_sha256: hashes[0], run_sha256: hashes[1], narration_sha256: hashes[2] } };
await writeFile(resolve(evidenceRoot, "browser-comparison-e2e.json"), `${JSON.stringify(report, null, 2)}\n`);
socket.close(); process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!Object.values(report.observed).every((value) => value !== false) || layouts.some((item) => !item.no_horizontal_overflow) || !report.text_200_percent.no_horizontal_overflow
  || accessibility.violations.some((item) => ["critical", "serious"].includes(item.impact))) process.exitCode = 1;
