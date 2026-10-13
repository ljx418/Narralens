import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const endpoint = "http://127.0.0.1:9233/json";
let pages;
for (let attempt = 0; attempt < 80; attempt += 1) { try { pages = await (await fetch(endpoint)).json(); break; } catch { await new Promise((done) => setTimeout(done, 250)); } }
const page = pages?.find((item) => item.type === "page" && item.url.startsWith("http://127.0.0.1:4173")); if (!page) throw new Error("Narralens accessibility page not found");
const socket = new WebSocket(page.webSocketDebuggerUrl); await new Promise((open, reject) => { socket.addEventListener("open", open, { once: true }); socket.addEventListener("error", reject, { once: true }); });
let nextId = 1; const pending = new Map(); socket.addEventListener("message", (event) => { const value = JSON.parse(event.data); const waiter = pending.get(value.id); if (waiter) { pending.delete(value.id); value.error ? waiter.reject(new Error(value.error.message)) : waiter.resolve(value.result); } });
const call = (method, params = {}) => new Promise((resolveCall, reject) => { const id = nextId++; pending.set(id, { resolve: resolveCall, reject }); socket.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => { const result = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.text); return result.result.value; };
for (let attempt = 0; attempt < 80 && !(await evaluate("document.body.innerText.includes('生成并比较提案')")); attempt += 1) await new Promise((done) => setTimeout(done, 250));
await evaluate(await readFile(resolve("node_modules/axe-core/axe.min.js"), "utf8"));
const audit = await evaluate(`axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa']}}).then(r=>({version:axe.version,passes:r.passes.length,violations:r.violations.map(v=>({id:v.id,impact:v.impact,targets:v.nodes.map(n=>n.target)})),incomplete:r.incomplete.map(v=>({id:v.id,impact:v.impact,targets:v.nodes.map(n=>n.target),reasons:v.nodes.map(n=>n.failureSummary)}))}))`);
const report = { format: "narralens.d41-accessibility-postfix@1", executed_at: new Date().toISOString(), audit,
  manual_contrast_review: { method: "WCAG relative luminance", foreground: "#edf2f7", minimum_required_normal_text: 4.5,
    gradient_lightest_background: { color: "#435465", ratio: 6.92, pass: true }, textarea_background: { color: "#151b23", ratio: 15.37, pass: true } },
  keyboard_evidence: "browser-comparison-e2e.json: keyboard submit and second-tab selection", result_ui_evidence: "browser-comparison-e2e.json: axe 4.10.3 found zero violations with real three-option content" };
await writeFile(resolve("docs/evidence/D4.1/artifacts/accessibility-postfix.json"), `${JSON.stringify(report, null, 2)}\n`); socket.close(); console.log(JSON.stringify(report, null, 2));
if (audit.violations.some((item) => ["critical", "serious"].includes(item.impact)) || audit.incomplete.some((item) => item.id === "aria-prohibited-attr")) process.exitCode = 1;
