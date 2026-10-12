import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const endpoint = "http://127.0.0.1:9224/json";
let pages;
for (let attempt = 0; attempt < 80; attempt += 1) {
  try { pages = await (await fetch(endpoint)).json(); break; } catch { await new Promise((done) => setTimeout(done, 250)); }
}
const page = pages?.find((item) => item.type === "page" && item.url.startsWith("http://127.0.0.1:4173"));
if (!page) throw new Error("Narralens D4.0 CDP page not found");
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
const evaluate = async (expression) => {
  const result = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
};
const waitText = async (text) => {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    const body = await evaluate("document.body.innerText");
    if (body.includes(text)) return body;
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`UI text not reached: ${text}`);
};
const clickText = (selector, text) => evaluate(`(() => { const item=[...document.querySelectorAll(${JSON.stringify(selector)})].find((node)=>node.textContent.includes(${JSON.stringify(text)})); if(!item) throw new Error('missing control'); item.click(); })()`);

await call("Page.enable");
await waitText("单镜头素材替换");
await clickText(".shots button", "shot-002");
await waitText("shot-002 · 当前素材 asset_visual_baseline");
await clickText(".asset-options button", "asset_visual_d4_alt");
await clickText("button", "确认替换素材");
const alternateBody = await waitText("已提交 r3");
await waitText("shot-002 · 当前素材 asset_visual_d4_alt");
const alternateCapture = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
await clickText(".asset-options button", "asset_visual_baseline");
await clickText("button", "确认替换素材");
const restoredBody = await waitText("已提交 r4");
await waitText("shot-002 · 当前素材 asset_visual_baseline");
const restoredCapture = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
const layout = await evaluate(`({width:document.documentElement.scrollWidth,viewport:innerWidth,height:document.documentElement.scrollHeight})`);
const sourceHash = createHash("sha256").update(await readFile(resolve("fixtures/d1-30s/authors/main.svml"))).digest("hex");
const evidenceRoot = resolve("docs/evidence/D4.0/artifacts");
await mkdir(evidenceRoot, { recursive: true });
await writeFile(resolve(evidenceRoot, "ui-media-alternate.png"), Buffer.from(alternateCapture.data, "base64"));
await writeFile(resolve(evidenceRoot, "ui-media-restored.png"), Buffer.from(restoredCapture.data, "base64"));
const report = { format: "narralens.d40-browser-e2e@1", executed_at: new Date().toISOString(), browser: "Chrome headless via CDP",
  actions: ["选择 shot-002", "选择已登记替代素材", "确认 r3", "选择基线素材", "确认 r4"],
  observed: { alternate_committed: alternateBody.includes("已提交 r3"), restored_committed: restoredBody.includes("已提交 r4"),
    source_and_license_visible: restoredBody.includes("许可：项目自生成测试资产"), preserve_copy_visible: restoredBody.includes("保留：旁白 · 900 帧总时长 · 非目标镜头"),
    baseline_source_sha256: sourceHash }, layout };
await writeFile(resolve(evidenceRoot, "browser-media-e2e.json"), `${JSON.stringify(report, null, 2)}\n`);
socket.close();
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (layout.width > layout.viewport || sourceHash !== "ae4edebf3bf05bb178efd2b264f101b744998c7d3bad29aa1ad7a1dd37fcab3a") process.exitCode = 1;
