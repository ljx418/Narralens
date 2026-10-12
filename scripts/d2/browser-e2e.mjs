import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const endpoint = "http://127.0.0.1:9222/json";
let pages;
for (let attempt = 0; attempt < 30; attempt += 1) {
  try { pages = await (await fetch(endpoint)).json(); break; } catch { await new Promise((done) => setTimeout(done, 500)); }
}
const page = pages?.find((item) => item.type === "page" && item.url.startsWith("http://127.0.0.1:4173"));
if (!page) throw new Error("Narralens CDP page not found");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolveOpen, reject) => { socket.addEventListener("open", resolveOpen, { once: true }); socket.addEventListener("error", reject, { once: true }); });
let nextId = 1;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const value = JSON.parse(event.data);
  if (!value.id) return;
  const waiter = pending.get(value.id);
  if (waiter) { pending.delete(value.id); value.error ? waiter.reject(new Error(value.error.message)) : waiter.resolve(value.result); }
});
const call = (method, params = {}) => new Promise((resolveCall, reject) => {
  const id = nextId++;
  pending.set(id, { resolve: resolveCall, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
};

await call("Page.enable");
await evaluate(`new Promise((resolve) => {
  const ready = () => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent.includes('生成提案'));
    if (button && !button.disabled) { button.click(); resolve(true); } else setTimeout(ready, 200);
  };
  ready();
})`);
let state = "waiting";
let bodyText = "";
for (let attempt = 0; attempt < 220; attempt += 1) {
  await new Promise((done) => setTimeout(done, 1_000));
  bodyText = await evaluate("document.body.innerText");
  if (bodyText.includes("提案已就绪")) { state = "succeeded"; break; }
  if (bodyText.includes("生成失败") || bodyText.includes("PROVIDER_") || bodyText.includes("INVALID_PROPOSAL")) { state = "failed"; break; }
}
const layout = await evaluate(`({ width: document.documentElement.scrollWidth, viewport: innerWidth, height: document.documentElement.scrollHeight, title: document.title })`);
const capture = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
const evidenceRoot = resolve("docs/evidence/D2/artifacts");
await mkdir(evidenceRoot, { recursive: true });
await writeFile(resolve(evidenceRoot, "ui-real-runner-success.png"), Buffer.from(capture.data, "base64"));
const report = {
  executed_at: new Date().toISOString(), state, browser: "Google Chrome headless via CDP", action: "real click on 生成提案",
  observed: { project: bodyText.includes("900 帧"), selection: bodyText.includes("shot-001"), success: bodyText.includes("提案已就绪"), no_write_copy: bodyText.includes("此阶段只展示，不写入 Source") },
  layout,
};
await writeFile(resolve(evidenceRoot, "browser-e2e.json"), `${JSON.stringify(report, null, 2)}\n`);
socket.close();
process.stdout.write(`${JSON.stringify(report)}\n`);
if (state !== "succeeded" || layout.width > layout.viewport) process.exitCode = 1;
