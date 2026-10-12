import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { NarralensHost } from "../../src/host/server.js";
import { RevisionStore } from "../../src/host/projects/revision-store.js";

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "../..");
const dbPath = resolve(root, "var/d3-real-e2e.sqlite");
const evidencePath = resolve(root, "docs/evidence/D3/artifacts/real-write-e2e.json");
const sourcePath = resolve(root, "fixtures/d1-30s/authors/main.svml");
const runPath = resolve(root, "fixtures/d1-30s/runs/build.svrun");
const narrationPath = resolve(root, "fixtures/d1-30s/assets/generated/narration-30s.wav");
let studio: ChildProcess | undefined;
let host: NarralensHost | undefined;

try {
  await mkdir(resolve(root, "var"), { recursive: true });
  await rm(dbPath, { force: true });
  await rm(`${dbPath}-shm`, { force: true });
  await rm(`${dbPath}-wal`, { force: true });
  const baseline = await hashes();
  const baselineSource = await readFile(sourcePath, "utf8");
  if (!/id="shot-2"[\s\S]*?fit="cover"/u.test(baselineSource)) throw new Error("D3 baseline is not shot-2 fit=cover");

  studio = startStudio();
  const firstSession = await waitForStudio();
  host = new NarralensHost({ revisionStore: new RevisionStore(dbPath) });
  const hostPort = await host.listen(0);
  let hostOrigin = `http://127.0.0.1:${hostPort}`;
  let token = await sessionToken(hostOrigin);
  const beforeProject = await api(hostOrigin, token, "/api/projects/d1-30s");
  assert(beforeProject.revision === 2 && beforeProject.visual_fits?.["shot-002"] === "cover", "initial project state mismatch");

  const containRequest = editRequest(2, "d3-real-contain", "contain");
  const contain = await api(hostOrigin, token, "/api/projects/d1-30s/edits", containRequest);
  assert(contain.changed === true && contain.previous_revision === 2 && contain.new_revision === 3, "contain transaction did not commit r2→r3");
  const containHashes = await hashes();
  assert(containHashes.run === baseline.run && containHashes.narration === baseline.narration && containHashes.source !== baseline.source, "contain invariants failed");
  const replay = await api(hostOrigin, token, "/api/projects/d1-30s/edits", containRequest);
  assert(replay.transaction_id === contain.transaction_id, "idempotent replay created another transaction");

  const stale = await apiError(hostOrigin, token, "/api/projects/d1-30s/edits", editRequest(2, "d3-real-stale", "cover"));
  assert(stale.status === 409 && stale.body.code === "REVISION_CONFLICT", "stale revision was not rejected");
  host.writes.setVisualLock("d1-30s", 2, true);
  const locked = await apiError(hostOrigin, token, "/api/projects/d1-30s/edits", editRequest(3, "d3-real-locked", "cover"));
  assert(locked.status === 423 && locked.body.code === "TARGET_LOCKED", "visual lock was not enforced");
  host.writes.setVisualLock("d1-30s", 2, false);

  await stopStudio(studio); studio = undefined;
  studio = startStudio();
  const reopenedSession = await waitForStudio();
  assert(readFit(reopenedSession, "shot-2") === "contain", "contain did not survive Studio restart");
  await host.close(); host = undefined;
  host = new NarralensHost({ revisionStore: new RevisionStore(dbPath) });
  hostOrigin = `http://127.0.0.1:${await host.listen(0)}`;
  token = await sessionToken(hostOrigin);
  const reopenedProject = await api(hostOrigin, token, "/api/projects/d1-30s");
  assert(reopenedProject.revision === 3 && reopenedProject.visual_fits?.["shot-002"] === "contain", "committed metadata did not survive Host restart");

  const cover = await api(hostOrigin, token, "/api/projects/d1-30s/edits", editRequest(3, "d3-real-cover", "cover"));
  assert(cover.changed === true && cover.previous_revision === 3 && cover.new_revision === 4, "cover transaction did not commit r3→r4");
  const finalHashes = await hashes();
  assert(finalHashes.source === baseline.source && finalHashes.run === baseline.run && finalHashes.narration === baseline.narration, "baseline hashes were not restored");
  const finalSession = await studioSession();
  assert(readFit(finalSession, "shot-2") === "cover", "final Studio fit is not cover");

  const check = await exec(resolve(root, "scripts/d1/hypit.sh"), ["check", runPath, "--json"], { cwd: root, maxBuffer: 4 * 1024 * 1024 });
  const plan = await exec(resolve(root, "scripts/d1/hypit.sh"), ["plan", runPath, "--json"], { cwd: root, maxBuffer: 8 * 1024 * 1024 });
  assert(JSON.parse(check.stdout).ok === true, "Hypit check failed");
  assert(JSON.parse(plan.stdout).format === "hypit.cli-plan@1", "Hypit plan failed");

  const evidence = {
    format: "narralens.d3-real-write-e2e@1", at: new Date().toISOString(), project_id: "d1-30s",
    baseline: { ...baseline, studio_revision: firstSession.revision, fit: readFit(firstSession, "shot-2") },
    contain: { response: contain, ...containHashes },
    idempotent_replay: { transaction_id: replay.transaction_id, repeated_mutation: false },
    guards: { stale, locked },
    reopen: { studio_revision: reopenedSession.revision, fit: readFit(reopenedSession, "shot-2"), host_revision: reopenedProject.revision },
    cover: { response: cover, ...finalHashes },
    final: { ...finalHashes, studio_revision: finalSession.revision, fit: readFit(finalSession, "shot-2"), baseline_restored: true },
    hypit: { check: "passed", plan: "passed" },
    invariants: { frame_count: 900, target_window: [300, 600], run_unchanged: true, narration_unchanged: true, final_source_restored: true },
  };
  await mkdir(resolve(evidencePath, ".."), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
} finally {
  if (host) await host.close().catch(() => undefined);
  if (studio) await stopStudio(studio).catch(() => undefined);
  await rm(dbPath, { force: true });
  await rm(`${dbPath}-shm`, { force: true });
  await rm(`${dbPath}-wal`, { force: true });
}

function startStudio(): ChildProcess {
  return spawn(resolve(root, "scripts/d1/hypit.sh"), ["studio", "--run", runPath, "--port", "4174"],
    { cwd: root, env: { ...process.env, CI: "1" }, stdio: ["ignore", "pipe", "pipe"] });
}

async function waitForStudio(): Promise<any> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { return await studioSession(); } catch { await new Promise((done) => setTimeout(done, 100)); }
  }
  throw new Error("Hypit Studio did not become ready");
}

async function studioSession(): Promise<any> {
  const response = await fetch("http://127.0.0.1:4174/__studio/session");
  if (!response.ok) throw new Error(`Studio session ${response.status}`);
  return response.json();
}

async function stopStudio(process: ChildProcess): Promise<void> {
  if (process.exitCode !== null) return;
  process.kill("SIGTERM");
  await Promise.race([new Promise<void>((done) => process.once("exit", () => done())), new Promise<void>((done) => setTimeout(done, 5_000))]);
  if (process.exitCode === null) process.kill("SIGKILL");
}

function readFit(snapshot: any, authoredId: string): unknown {
  const items = snapshot.tracks.flatMap((track: any) => track.items).filter((item: any) => item.authoredId === authoredId);
  return items[0]?.inspector.find((field: any) => String(field.id).endsWith(":inspector:fit"))?.value;
}

function editRequest(revision: number, key: string, value: "contain" | "cover"): Record<string, unknown> {
  return { base_revision: revision, idempotency_key: key,
    selection: { shot_id: "shot-002", start_frame: 300, end_frame_exclusive: 600 }, preserve: ["narration", "duration"],
    operations: [{ op: "set_visual_fit", shot_id: "shot-002", value }] };
}

async function sessionToken(origin: string): Promise<string> {
  const response = await fetch(`${origin}/api/session`, { headers: { origin } });
  return (await response.json() as { token: string }).token;
}

async function api(origin: string, token: string, path: string, body?: Record<string, unknown>): Promise<any> {
  const response = await fetch(`${origin}${path}`, { method: body ? "POST" : "GET",
    headers: { origin, authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const value = await response.json();
  if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(value)}`);
  return value;
}

async function apiError(origin: string, token: string, path: string, body: Record<string, unknown>): Promise<any> {
  const response = await fetch(`${origin}${path}`, { method: "POST", headers: { origin, authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

async function hashes(): Promise<{ source: string; run: string; narration: string }> {
  const [source, run, narration] = await Promise.all([readFile(sourcePath), readFile(runPath), readFile(narrationPath)]);
  return { source: digest(source), run: digest(run), narration: digest(narration) };
}

function digest(value: Buffer): string { return createHash("sha256").update(value).digest("hex"); }
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
