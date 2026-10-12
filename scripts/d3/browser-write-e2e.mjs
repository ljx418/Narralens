import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const endpoint = "http://127.0.0.1:9223/json";
let pages;
for (let attempt = 0; attempt < 40; attempt += 1) {
  try { pages = await (await fetch(endpoint)).json(); break; } catch { await new Promise((done) => setTimeout(done, 250)); }
}
const page = pages?.find((item) => item.type === "page" && item.url.startsWith("http://127.0.0.1:4173"));
if (!page) throw new Error("Narralens D3 CDP page not found");
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
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const body = await evaluate("document.body.innerText");
    if (body.includes(text)) return body;
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error(`UI text not reached: ${text}`);
};

await call("Page.enable");
await waitText("当前 cover → 目标 contain");
await evaluate(`(() => { const shot=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('shot-002')); shot.click(); })()`);
await waitText("shot-002 · 当前 cover → 目标 contain");
await evaluate(`(() => { const button=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('确认局部写入')); button.click(); })()`);
const containBody = await waitText("已提交 r3");
const containCapture = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
await evaluate(`(() => { const cover=[...document.querySelectorAll('.fit-options button')].find(b=>b.textContent.trim()==='cover'); cover.click(); })()`);
await waitText("当前 contain → 目标 cover");
await evaluate(`(() => { const button=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('确认局部写入')); button.click(); })()`);
const finalBody = await waitText("已提交 r4");
const finalCapture = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
const layout = await evaluate(`({width:document.documentElement.scrollWidth,viewport:innerWidth,height:document.documentElement.scrollHeight})`);
const source = await readFile(resolve("fixtures/d1-30s/authors/main.svml"));
const sourceHash = createHash("sha256").update(source).digest("hex");
const evidenceRoot = resolve("docs/evidence/D3/artifacts");
await mkdir(evidenceRoot, { recursive: true });
await writeFile(resolve(evidenceRoot, "ui-contain-committed.png"), Buffer.from(containCapture.data, "base64"));
await writeFile(resolve(evidenceRoot, "ui-cover-restored.png"), Buffer.from(finalCapture.data, "base64"));
const report = {
  executed_at: new Date().toISOString(), browser: "Google Chrome headless via CDP",
  actions: ["选择 shot-002", "选择 contain", "确认局部写入", "观察 r3", "选择 cover", "确认恢复", "观察 r4"],
  observed: { contain_committed: containBody.includes("已提交 r3"), cover_committed: finalBody.includes("已提交 r4"),
    preserve_copy: finalBody.includes("旁白、总时长与非目标镜头会在 Host 中复核"), baseline_source_sha256: sourceHash },
  layout,
};
await writeFile(resolve(evidenceRoot, "browser-write-e2e.json"), `${JSON.stringify(report, null, 2)}\n`);
socket.close();
process.stdout.write(`${JSON.stringify(report)}\n`);
if (layout.width > layout.viewport || sourceHash !== "ae4edebf3bf05bb178efd2b264f101b744998c7d3bad29aa1ad7a1dd37fcab3a") process.exitCode = 1;
