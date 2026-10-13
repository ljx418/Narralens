import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ProposalComparisonAdapter, proposalStructureSignature } from "../../src/adapters/openmontage/proposal-comparison-adapter.js";
import { ControlledAgentRunner } from "../../src/adapters/openmontage/controlled-agent-runner.js";
import type { ProposalComparison } from "../../src/contracts/types.js";
import { NarralensHost } from "../../src/host/server.js";
import { RevisionStore } from "../../src/host/projects/revision-store.js";

const root = resolve(import.meta.dirname, "../..");
const fixture = resolve(root, "fixtures/d1-30s");
const dbPath = resolve(root, "var/d41-real-e2e.sqlite");
const comparisonRoot = resolve(root, "var/d41-real-comparisons");
const evidencePath = resolve(root, "docs/evidence/D4.1/artifacts/real-comparison-e2e.json");
const sourcePath = resolve(fixture, "authors/main.svml");
const runPath = resolve(fixture, "runs/build.svrun");
const narrationPath = resolve(fixture, "assets/generated/narration-30s.wav");
let host: NarralensHost | undefined;
let report: Record<string, unknown> = {};

try {
  await mkdir(resolve(root, "var"), { recursive: true });
  for (const path of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) await rm(path, { force: true });
  await rm(comparisonRoot, { recursive: true, force: true });
  const beforeHashes = await hashes();
  host = new NarralensHost({ revisionStore: new RevisionStore(dbPath), comparisons: new ProposalComparisonAdapter(comparisonRoot),
    runner: new ControlledAgentRunner({ cwd: root }) });
  const origin = `http://127.0.0.1:${await host.listen(0)}`;
  const token = (await (await fetch(`${origin}/api/session`, { headers: { origin } })).json() as { token: string }).token;
  const headers = { origin, authorization: `Bearer ${token}` };
  const project = await json(`${origin}/api/projects/d1-30s`, headers) as { revision: number; shots: Array<{ shot_id: string; start_frame: number; end_frame_exclusive: number }> };
  const before = { ...beforeHashes, revision: project.revision };
  const request = { base_revision: project.revision, selection: project.shots[0], proposal_count: 3,
    intent: "为同一段落提供三种确实不同的讲述路径：一案按时间递进，一案形成对照，一案以证据为中心；保留旁白与总时长。",
    preserve: ["narration", "duration"] };
  const createdResponse = await fetch(`${origin}/api/projects/d1-30s/proposals`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(request) });
  const created = await createdResponse.json() as { job_id?: string; code?: string };
  assert(createdResponse.status === 202 && created.job_id, `CREATE_FAILED_${createdResponse.status}_${created.code ?? "UNKNOWN"}`);
  let job: { state: string; comparison_id?: string; error?: { code?: string; message?: string } } = { state: "queued" };
  for (let attempt = 0; attempt < 240; attempt += 1) {
    await new Promise((done) => setTimeout(done, 1_000));
    job = await json(`${origin}/api/jobs/${created.job_id}`, headers) as typeof job;
    if (["succeeded", "failed", "cancelled", "completed_after_cancel"].includes(job.state)) break;
  }
  let comparison: ProposalComparison | undefined;
  if (job.comparison_id) comparison = await json(`${origin}/api/proposal-comparisons/${job.comparison_id}`, headers) as ProposalComparison;
  const afterProject = await json(`${origin}/api/projects/d1-30s`, headers) as { revision: number };
  const after = { ...(await hashes()), revision: afterProject.revision };
  const invariants = { source_unchanged: before.source_sha256 === after.source_sha256, run_unchanged: before.run_sha256 === after.run_sha256,
    narration_unchanged: before.narration_sha256 === after.narration_sha256, revision_unchanged: before.revision === after.revision,
    write_actor_execute_count: host.diagnostics.write_actor_execute_count };
  report = { format: "narralens.d41-real-comparison-e2e@1", executed_at: new Date().toISOString(), cli_version: "Claude Code CLI 2.1.205",
    invocation_policy: { calls: 1, automatic_retries: 0, local_budget_limit: null, local_call_limit: null, safe_mode: true, permission_mode: "plan", tools: [] },
    request: { project_id: "d1-30s", base_revision: request.base_revision, selection: request.selection, proposal_count: request.proposal_count,
      preserve: request.preserve, intent_sha256: createHash("sha256").update(request.intent).digest("hex") }, job,
    comparison: comparison ? { comparison_id: comparison.comparison_id, proposal_count: comparison.proposal_count, generation_audit: comparison.generation_audit,
      options: comparison.proposals.map((proposal) => ({ proposal_id: proposal.proposal_id, title: proposal.title, strategy: proposal.strategy.kind,
        signature: proposalStructureSignature({ ...proposal, option_key: proposal.proposal_id }), source_ref_count: proposal.source_refs.length,
        asset_requirement_count: proposal.assets_needed.length, materialization_cost: proposal.materialization_cost })) } : null,
    before, after, invariants, no_fake_success: job.state === "succeeded" };
  assert(job.state === "succeeded" && comparison, `JOB_${job.state}_${job.error?.code ?? "NO_RESULT"}`);
  assert(comparison.proposals.length === 3, "COMPARISON_COUNT_MISMATCH");
  assert(Object.values(invariants).every((value) => value === true || value === 0), "NOWRITE_INVARIANT_FAILED");
} catch (error) {
  report = { ...report, failure: error instanceof Error ? error.message : String(error), no_fake_success: true };
  process.exitCode = 1;
} finally {
  if (host) await host.close().catch(() => undefined);
  await mkdir(resolve(evidencePath, ".."), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  for (const path of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) await rm(path, { force: true });
  await rm(comparisonRoot, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify({ state: (report.job as { state?: string } | undefined)?.state ?? "failed", evidence: "docs/evidence/D4.1/artifacts/real-comparison-e2e.json" })}\n`);
}

async function hashes(): Promise<{ source_sha256: string; run_sha256: string; narration_sha256: string }> {
  const [source, run, narration] = await Promise.all([sourcePath, runPath, narrationPath].map(async (path) => createHash("sha256").update(await readFile(path)).digest("hex")));
  return { source_sha256: source, run_sha256: run, narration_sha256: narration };
}
async function json(url: string, headers: Record<string, string>): Promise<unknown> {
  const response = await fetch(url, { headers }); const value = await response.json();
  if (!response.ok) throw new Error(`HTTP_${response.status}_${(value as { code?: string }).code ?? "UNKNOWN"}`); return value;
}
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
