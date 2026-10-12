import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NarralensHost } from "../../src/host/server.js";
import { ControlledAgentRunner, type RunnerAudit } from "../../src/adapters/openmontage/controlled-agent-runner.js";

const evidenceRoot = resolve("docs/evidence/D2/artifacts");
const sourcePath = resolve("fixtures/d1-30s/authors/main.svml");
const runPath = resolve("fixtures/d1-30s/runs/build.svrun");
const hash = async (path: string): Promise<string> => createHash("sha256").update(await readFile(path)).digest("hex");
const before = { source_sha256: await hash(sourcePath), run_sha256: await hash(runPath) };
const runnerAudits: RunnerAudit[] = [];
const host = new NarralensHost({ runner: new ControlledAgentRunner({ cwd: resolve("."), onAudit: (audit) => runnerAudits.push(audit) }) });
let report: Record<string, unknown> = {};

try {
  const port = await host.listen(0);
  const origin = `http://127.0.0.1:${port}`;
  const sessionResponse = await fetch(`${origin}/api/session`, { headers: { origin } });
  const session = await sessionResponse.json() as { token: string };
  const headers = { origin, authorization: `Bearer ${session.token}` };
  const project = await (await fetch(`${origin}/api/projects/d1-30s`, { headers })).json() as { revision: number; shots: Array<{ shot_id: string; start_frame: number; end_frame_exclusive: number }> };
  const request = {
    base_revision: project.revision,
    selection: project.shots[0],
    intent: "将这一段设计为三个递进镜头：先交代全貌，再展示传导关系，最后落到细节；保留旁白和总时长。",
    preserve: ["旁白", "总时长"],
  };
  const createdResponse = await fetch(`${origin}/api/projects/d1-30s/proposals`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(request) });
  const created = await createdResponse.json() as { job_id?: string; code?: string; message?: string };
  if (createdResponse.status !== 202 || !created.job_id) throw new Error(`CREATE_FAILED ${createdResponse.status} ${created.code ?? ""}`);
  let job: { state: string; proposal_id?: string; error?: unknown } = { state: "queued" };
  for (let attempt = 0; attempt < 240; attempt += 1) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
    job = await (await fetch(`${origin}/api/jobs/${created.job_id}`, { headers })).json() as typeof job;
    if (["succeeded", "failed", "cancelled", "completed_after_cancel"].includes(job.state)) break;
  }
  const eventsText = await (await fetch(`${origin}/api/jobs/${created.job_id}/events?after=0`, { headers })).text();
  const events = eventsText.split("\n\n").map((block) => block.split("\n").find((line) => line.startsWith("data: "))?.slice(6)).filter((line): line is string => Boolean(line)).map((line) => JSON.parse(line));
  const proposal = job.proposal_id ? await (await fetch(`${origin}/api/proposals/${job.proposal_id}`, { headers })).json() : undefined;
  const after = { source_sha256: await hash(sourcePath), run_sha256: await hash(runPath) };
  report = {
    executed_at: new Date().toISOString(),
    cli: "Claude Code CLI 2.1.205",
    invocation_policy: { shell: false, tools: [], permission_mode: "plan", safe_mode: true, automatic_retries: 0, local_budget_limit: null, local_call_limit: null },
    outbound_fields: ["project.project_id", "project.revision", "project.frame_rate", "project.frame_count", "request.base_revision", "request.selection", "request.intent", "request.preserve", "fixed_context"],
    request,
    job,
    events,
    runner_audit: runnerAudits,
    proposal,
    no_write: { before, after, unchanged: before.source_sha256 === after.source_sha256 && before.run_sha256 === after.run_sha256 },
  };
  if (job.state !== "succeeded" || !proposal || !(report.no_write as { unchanged: boolean }).unchanged) process.exitCode = 1;
} catch (error) {
  report = { executed_at: new Date().toISOString(), failure: error instanceof Error ? error.message : String(error), no_fake_success: true };
  process.exitCode = 1;
} finally {
  await host.close();
  await mkdir(evidenceRoot, { recursive: true });
  await writeFile(resolve(evidenceRoot, "real-runner-e2e.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ state: (report.job as { state?: string } | undefined)?.state ?? "failed", evidence: "docs/evidence/D2/artifacts/real-runner-e2e.json" })}\n`);
}
