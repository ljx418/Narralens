import { writeFile } from "node:fs/promises";

const endpoint = process.env.D421_CDP_ENDPOINT ?? "http://127.0.0.1:9245/json";
const origin = process.env.D421_ORIGIN ?? "http://127.0.0.1:4174";
const outputPath = process.env.D421_SNAPSHOT_PATH;
if (!outputPath) throw new Error("D421_SNAPSHOT_PATH is required");

const pages = await (await fetch(endpoint)).json();
const page = pages.find((item) => item.type === "page" && item.url.startsWith(origin));
if (!page) throw new Error("Narralens CDP page not found");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((open, reject) => {
  socket.addEventListener("open", open, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let nextId = 1;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const value = JSON.parse(event.data);
  const waiter = pending.get(value.id);
  if (!waiter) return;
  pending.delete(value.id);
  value.error ? waiter.reject(new Error(value.error.message)) : waiter.resolve(value.result);
});
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
let evaluated;
for (let attempt = 0; attempt < 80; attempt += 1) {
  evaluated = await call("Runtime.evaluate", { returnByValue: true, expression: `({
  url: location.href,
  title: document.title,
  device_pixel_ratio: devicePixelRatio,
  viewport_width: innerWidth,
  viewport_height: innerHeight,
  outer_width: outerWidth,
  outer_height: outerHeight,
  document_width: document.documentElement.scrollWidth,
  document_height: document.documentElement.scrollHeight,
  visual_viewport_scale: visualViewport?.scale ?? null,
  native_zoom_marker: document.documentElement.dataset.d421NativeZoom ?? null,
  native_zoom_error: document.documentElement.dataset.d421NativeZoomError ?? null
})` });
  if (evaluated.result.value.url.startsWith(origin) && evaluated.result.value.title) break;
  await new Promise((done) => setTimeout(done, 250));
}
if (!evaluated?.result.value.url.startsWith(origin)) throw new Error(`Narralens page did not load: ${evaluated?.result.value.url}`);
const version = await call("Browser.getVersion");
const report = { captured_at: new Date().toISOString(), browser: version.product, ...evaluated.result.value };
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
socket.close();
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
