import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const endpoint = process.env.D421_CDP_ENDPOINT ?? "http://127.0.0.1:9244/json";
const origin = process.env.D421_ORIGIN ?? "http://127.0.0.1:4174";
const uploadPath = process.env.D421_UPLOAD_PATH;
const fixtureRoot = process.env.D421_FIXTURE_ROOT;
const evidenceVariant = process.env.D421_EVIDENCE_VARIANT ?? "browser-import";
const expectedZoomFactor = Number.parseFloat(process.env.D421_EXPECTED_ZOOM_FACTOR ?? "1");
const zoomBaselinePath = process.env.D421_ZOOM_BASELINE_PATH;
const zoomPreferencesPath = process.env.D421_ZOOM_PREFERENCES_PATH;
if (!uploadPath || !fixtureRoot) throw new Error("D421_UPLOAD_PATH and D421_FIXTURE_ROOT are required");
if (!Number.isFinite(expectedZoomFactor) || expectedZoomFactor < 1) throw new Error("D421_EXPECTED_ZOOM_FACTOR must be >= 1");
const delay = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));
const manifestPath = join(fixtureRoot, "narralens.assets.json");
const databasePath = join(fixtureRoot, ".narralens/browser-evidence.sqlite");
const authored = ["authors/main.svml", "runs/build.svrun", "assets/generated/narration-30s.wav"];
const before = { manifest_sha256: await fileHash(manifestPath), authored_sha256: await fileHashes(fixtureRoot, authored) };

let pages;
for (let attempt = 0; attempt < 80; attempt += 1) {
  try { pages = await (await fetch(endpoint)).json(); break; } catch { await delay(250); }
}
const page = pages?.find((item) => item.type === "page" && item.url.startsWith(origin));
if (!page) throw new Error("Narralens D4.2.1 CDP page not found");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((open, reject) => { socket.addEventListener("open", open, { once: true }); socket.addEventListener("error", reject, { once: true }); });
let nextId = 1;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const value = JSON.parse(event.data);
  const waiter = pending.get(value.id);
  if (waiter) { pending.delete(value.id); value.error ? waiter.reject(new Error(value.error.message)) : waiter.resolve(value.result); }
});
const call = (method, params = {}) => new Promise((resolveCall, reject) => {
  const id = nextId++; pending.set(id, { resolve: resolveCall, reject }); socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression, returnByValue = true) => {
  const result = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return returnByValue ? result.result.value : result.result;
};
const focusFact = () => evaluate(`(() => { const e=document.activeElement; return {tag:e?.tagName,id:e?.id||null,type:e?.getAttribute?.('type')||null,text:(e?.textContent||'').trim().slice(0,40)}; })()`);
const key = async (value, code = value, modifiers = 0) => {
  const windowsVirtualKeyCode = value === "Tab" ? 9 : value === "Enter" ? 13 : undefined;
  await call("Input.dispatchKeyEvent", { type: value === "Enter" ? "rawKeyDown" : "keyDown", key: value, code, modifiers, windowsVirtualKeyCode });
  if (value === "Enter") await call("Input.dispatchKeyEvent", { type: "char", key: value, code, modifiers,
    windowsVirtualKeyCode, text: "\r", unmodifiedText: "\r" });
  await call("Input.dispatchKeyEvent", { type: "keyUp", key: value, code, modifiers, windowsVirtualKeyCode });
};
const keyboard = [];

await call("Page.enable");
await call("DOM.enable");
await call("Page.reload", { ignoreCache: true });
await waitFor(async () => (await evaluate("document.body.innerText")).includes("本地资产库存"));
const fileObject = await evaluate("document.querySelector('#asset-file')", false);
await call("DOM.setFileInputFiles", { files: [uploadPath], objectId: fileObject.objectId });
await evaluate("document.querySelector('#asset-file').focus()");
keyboard.push({ action: "CDP setFileInputFiles 后聚焦文件控件", focus: await focusFact() });
for (const expected of ["source-kind", "license-status", "source-label"]) {
  await key("Tab"); keyboard.push({ action: "Tab", focus: await focusFact() });
  if ((await focusFact()).id !== expected) throw new Error(`Keyboard focus did not reach ${expected}`);
}
await call("Input.insertText", { text: "浏览器键盘验收素材" });
keyboard.push({ action: "键盘输入来源标签", focus: await focusFact() });
await key("Tab"); keyboard.push({ action: "Tab", focus: await focusFact() });
if ((await focusFact()).id !== "license-label") throw new Error("Keyboard focus did not reach license-label");
await call("Input.insertText", { text: "自有商业使用许可" });
keyboard.push({ action: "键盘输入许可标签", focus: await focusFact() });
for (let attempt = 0; attempt < 4; attempt += 1) {
  await key("Tab"); keyboard.push({ action: "Tab", focus: await focusFact() });
  if ((await focusFact()).tag === "BUTTON") break;
}
const submitFocus = await focusFact();
if (submitFocus.tag !== "BUTTON" || !submitFocus.text.includes("验证并登记资产")) throw new Error("Keyboard focus did not reach submit");
await key("Enter"); keyboard.push({ action: "Enter 提交", focus: await focusFact() });
const body = await waitFor(async () => {
  const text = await evaluate("document.body.innerText");
  return text.includes("资产已登记") && text.includes("浏览器键盘验收素材") ? text : false;
}, 60_000);

const browserFacts = await evaluate(`(async()=>{
  const session=await (await fetch('/api/session')).json();
  const headers={authorization:'Bearer '+session.token};
  const project=await (await fetch('/api/projects/d1-30s',{headers})).json();
  const inventory=await (await fetch('/api/projects/d1-30s/assets',{headers})).json();
  return {revision:project.revision,inventory:{manifest_format:inventory.manifest_format,manifest_sha256:inventory.manifest_sha256,
    assets:inventory.assets.map(a=>({asset_id:a.asset_id,duration_frames:a.duration_frames,source:a.source,license:a.license,
      availability:a.availability,eligible:a.eligible,blocking_reasons:a.blocking_reasons}))}};
})()`);
await evaluate(await readFile(resolve("node_modules/axe-core/axe.min.js"), "utf8"));
const axe = await evaluate(`axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa']}}).then(r=>({version:axe.version,
  violations:r.violations.map(v=>({id:v.id,impact:v.impact,targets:v.nodes.map(n=>n.target)})),
  incomplete:r.incomplete.map(v=>({id:v.id,impact:v.impact,targets:v.nodes.map(n=>n.target)}))}))`);
const manualContrast = await evaluate(`(() => {
  const parse = value => { const match=value.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/); return match ? match.slice(1,4).map(Number) : null; };
  const luminance = rgb => { const values=rgb.map(value=>{ const channel=value/255; return channel<=0.04045?channel/12.92:((channel+0.055)/1.055)**2.4; }); return 0.2126*values[0]+0.7152*values[1]+0.0722*values[2]; };
  const ratio = (a,b) => { const first=luminance(a),second=luminance(b); return (Math.max(first,second)+0.05)/(Math.min(first,second)+0.05); };
  return ['.frame > span','.frame > strong','#intent'].map(selector=>{ const element=document.querySelector(selector); if(!element)return {selector,pass:false,error:'element-not-found'}; const style=getComputedStyle(element); const foreground=parse(style.color); const background=parse(style.backgroundColor); const size=Number.parseFloat(style.fontSize); const weight=Number.parseInt(style.fontWeight,10)||400; const large=size>=24||(size>=18.66&&weight>=700); const minimum=large?3:4.5; const measured=foreground&&background?ratio(foreground,background):0; return {selector,foreground:style.color,background:style.backgroundColor,font_size_px:size,font_weight:weight,minimum,ratio:Number(measured.toFixed(2)),pass:measured>=minimum}; });
})()`);
const layout = await evaluate(`({viewport_width:innerWidth,document_width:document.documentElement.scrollWidth,
  viewport_height:innerHeight,document_height:document.documentElement.scrollHeight,device_pixel_ratio:devicePixelRatio,
  outer_width:outerWidth,outer_height:outerHeight,visual_viewport_scale:visualViewport?.scale??null,
  core:{form:document.querySelector('.asset-import')?.getBoundingClientRect().toJSON(),inventory:document.querySelector('.inventory')?.getBoundingClientRect().toJSON(),
    file:document.querySelector('#asset-file')?.getBoundingClientRect().toJSON(),submit:document.querySelector('.import-actions button')?.getBoundingClientRect().toJSON()},
  clipped_controls:Array.from(document.querySelectorAll('.asset-library input,.asset-library select,.asset-library button,.asset-library label,.asset-library h2,.asset-library h3'))
    .filter(e=>e.scrollWidth>e.clientWidth+1||e.scrollHeight>e.clientHeight+1).map(e=>({tag:e.tagName,id:e.id||null,text:(e.textContent||'').trim().slice(0,80),client:[e.clientWidth,e.clientHeight],scroll:[e.scrollWidth,e.scrollHeight]}))})`);
const capture = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const journalDb = new DatabaseSync(databasePath, { readOnly: true });
const journal = journalDb.prepare("SELECT state,response_status,asset_id,bytes_sha,error_code FROM asset_import_journal ORDER BY created_at DESC LIMIT 1").get();
const state = journalDb.prepare("SELECT revision,attention FROM project_state WHERE project_id='d1-30s'").get();
journalDb.close();
const after = { manifest_sha256: await fileHash(manifestPath), authored_sha256: await fileHashes(fixtureRoot, authored) };
const imported = browserFacts.inventory.assets.find((asset) => asset.source.label === "浏览器键盘验收素材");
const zoomBaseline = zoomBaselinePath ? JSON.parse(await readFile(zoomBaselinePath, "utf8")) : null;
const zoomPreferences = zoomPreferencesPath ? JSON.parse(await readFile(zoomPreferencesPath, "utf8")) : null;
const zoomPreferenceLevel = zoomPreferences?.partition?.default_zoom_level?.x;
const observedZoomFactor = zoomBaseline ? layout.device_pixel_ratio / zoomBaseline.device_pixel_ratio : 1;
const zoom = { expected_factor: expectedZoomFactor, observed_factor_from_dpr: Number(observedZoomFactor.toFixed(2)), baseline: zoomBaseline,
  outer_css_metrics_unchanged: zoomBaseline ? layout.outer_width === zoomBaseline.outer_width && layout.outer_height === zoomBaseline.outer_height : null,
  configuration: expectedZoomFactor > 1 ? { mechanism: "isolated Chrome profile native default zoom preference", preference: "partition.default_zoom_level.x",
    zoom_level: zoomPreferenceLevel, factor_from_preference: typeof zoomPreferenceLevel === "number" ? Number((1.2 ** zoomPreferenceLevel).toFixed(2)) : null } : null,
  note: "The 100% and 200% Headless runs use the same outer window dimensions; native zoom is established by the isolated Chrome preference plus the DPR and CSS viewport ratios." };
const incompleteAdjudicated = axe.incomplete.map((item) => ({ ...item,
  adjudication: item.id === "color-contrast" && manualContrast.every((check) => check.pass)
    ? "manual-computed-contrast-pass" : "unresolved" }));
const unresolvedIncomplete = incompleteAdjudicated.filter((item) => item.adjudication === "unresolved");
const failures = [];
if (!imported) failures.push("imported asset missing from inventory");
if (!body.includes("已登记，未进入时间轴。")) failures.push("truthful success copy missing");
if (!manifest.assets.some((asset) => asset.asset_id === imported?.asset_id)) failures.push("manifest entry missing");
if (browserFacts.revision !== 2 || Number(state?.revision) !== 2) failures.push("project revision changed");
if (Number(state?.attention) !== 0) failures.push("project entered attention");
if (journal?.state !== "committed" || journal?.response_status !== 201) failures.push("journal did not commit with HTTP 201");
if (JSON.stringify(before.authored_sha256) !== JSON.stringify(after.authored_sha256)) failures.push("authored facts changed");
if (body.includes("media/")) failures.push("private project path visible");
if (layout.document_width > layout.viewport_width) failures.push("horizontal overflow");
if (layout.clipped_controls.length) failures.push("core asset controls contain clipped text");
const coreSeparated = layout.core.form && layout.core.inventory && (layout.core.form.right <= layout.core.inventory.left
  || layout.core.inventory.right <= layout.core.form.left || layout.core.form.bottom <= layout.core.inventory.top
  || layout.core.inventory.bottom <= layout.core.form.top);
if (!layout.core.form || !layout.core.inventory || layout.core.form.width <= 0 || layout.core.inventory.width <= 0
  || !coreSeparated || layout.core.form.right > layout.viewport_width || layout.core.inventory.right > layout.viewport_width) failures.push("core asset layout overlaps or leaves the viewport");
if (expectedZoomFactor > 1 && !zoomBaseline) failures.push("native zoom baseline missing");
if (expectedZoomFactor > 1 && (!zoomPreferences || zoom.configuration?.factor_from_preference !== expectedZoomFactor)) failures.push("native Chrome zoom preference missing or incorrect");
if (Math.abs(observedZoomFactor - expectedZoomFactor) > 0.05) failures.push("observed browser zoom factor does not match expectation");
if (axe.violations.length) failures.push(`axe violations: ${axe.violations.map((item) => item.id).join(", ")}`);
if (unresolvedIncomplete.length) failures.push(`unresolved axe incomplete: ${unresolvedIncomplete.map((item) => item.id).join(", ")}`);
if (manualContrast.some((check) => !check.pass)) failures.push("manual contrast check failed");
const report = {
  format: "narralens.d421-browser-import-evidence@1", executed_at: new Date().toISOString(),
  status: failures.length ? "failed" : "passed", failures,
  browser: process.env.D421_BROWSER_DESCRIPTION ?? "Google Chrome headless via CDP",
  interaction: "file injected through CDP; remaining form path is Tab/text/Enter keyboard input",
  keyboard, observed: { success_copy: body.includes("已登记，未进入时间轴。"), imported, manifest_format: manifest.format,
    manifest_entry_present: manifest.assets.some((asset) => asset.asset_id === imported?.asset_id), project_revision: browserFacts.revision,
    database_state: state, journal, authored_byte_exact_unchanged: JSON.stringify(before.authored_sha256) === JSON.stringify(after.authored_sha256),
    manifest_changed: before.manifest_sha256 !== after.manifest_sha256, project_path_visible: body.includes("media/") },
  layout, zoom, axe: { ...axe, incomplete_adjudicated: incompleteAdjudicated }, manual_checks: { color_contrast: manualContrast },
  claim_limits: ["File chooser bytes were supplied with CDP setFileInputFiles because headless Chrome has no OS file dialog.",
    expectedZoomFactor === 1 ? "This artifact proves 100% browser interaction only; 200% Chrome page zoom is recorded separately."
      : `This artifact proves the keyboard import path at native Headless Chrome ${Math.round(expectedZoomFactor * 100)}% page zoom configured in an isolated profile and independently read back through preference, DPR and viewport ratios.`,
    "No screen-reader compatibility claim is made by this artifact."],
};
const evidenceRoot = resolve("docs/evidence/D4.2/D4.2.1");
const evidenceStem = `d421-${evidenceVariant}`;
const canonicalScreenshot = evidenceVariant === "browser-import" ? "browser-import-success.png" : `${evidenceStem}.png`;
const attemptId = report.executed_at.replaceAll(":", "-").replaceAll(".", "-");
await mkdir(join(evidenceRoot, "artifacts/attempts"), { recursive: true });
await mkdir(join(evidenceRoot, "screenshots/attempts"), { recursive: true });
await writeFile(join(evidenceRoot, `screenshots/attempts/${evidenceStem}-${attemptId}.png`), Buffer.from(capture.data, "base64"));
await writeFile(join(evidenceRoot, `artifacts/attempts/${evidenceStem}-${attemptId}.json`), `${JSON.stringify(report, null, 2)}\n`);
if (!failures.length) {
  await writeFile(join(evidenceRoot, `screenshots/${canonicalScreenshot}`), Buffer.from(capture.data, "base64"));
  await writeFile(join(evidenceRoot, `artifacts/${evidenceStem}.json`), `${JSON.stringify(report, null, 2)}\n`);
}
socket.close();
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (failures.length) process.exitCode = 1;

async function waitFor(predicate, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { const value = await predicate(); if (value) return value; await delay(250); }
  throw new Error("Browser evidence timeout");
}
async function fileHash(path) { return createHash("sha256").update(await readFile(path)).digest("hex"); }
async function fileHashes(root, files) { return Object.fromEntries(await Promise.all(files.map(async (file) => [file, await fileHash(join(root, file))]))); }
