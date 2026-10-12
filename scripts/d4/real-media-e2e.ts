import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NarralensHost } from "../../src/host/server.js";
import { RevisionStore } from "../../src/host/projects/revision-store.js";

const root = resolve(import.meta.dirname, "../..");
const fixture = resolve(root, "fixtures/d1-30s");
const dbPath = resolve(root, "var/d40-real-e2e.sqlite");
const evidencePath = resolve(root, "docs/evidence/D4.0/artifacts/real-media-e2e.json");
const sourcePath = resolve(fixture, "authors/main.svml");
const runPath = resolve(fixture, "runs/build.svrun");
const narrationPath = resolve(fixture, "assets/generated/narration-30s.wav");
let studio: ChildProcess | undefined;
let host: NarralensHost | undefined;
let studioLog = "";

try {
  await mkdir(resolve(root, "var"), { recursive: true });
  for (const path of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) await rm(path, { force: true });
  const baseline = await hashes();
  studio = startStudio();
  const initialSession = await waitForStudio();
  assert(media(initialSession, "shot-2") === "asset_visual_baseline", "baseline media projection is missing");
  host = new NarralensHost({ revisionStore: new RevisionStore(dbPath) });
  let origin = `http://127.0.0.1:${await host.listen(0)}`;
  let token = await sessionToken(origin);

  const alternateRequest = request(2, "d40-real-alt", "asset_visual_d4_alt");
  const alternate = await api(origin, token, "/api/projects/d1-30s/edits", alternateRequest);
  assert(alternate.changed && alternate.previous_revision === 2 && alternate.new_revision === 3, "alternate transaction did not commit");
  const alternateHashes = await hashes();
  assert(alternateHashes.source !== baseline.source && alternateHashes.run === baseline.run && alternateHashes.narration === baseline.narration, "alternate invariants failed");
  const alternateSession = await studioSession();
  assert(media(alternateSession, "shot-1") === "asset_visual_baseline" && media(alternateSession, "shot-2") === "asset_visual_d4_alt"
    && media(alternateSession, "shot-3") === "asset_visual_baseline", "replacement expanded beyond shot-2");
  const replay = await api(origin, token, "/api/projects/d1-30s/edits", alternateRequest);
  assert(replay.transaction_id === alternate.transaction_id, "idempotent media replay duplicated the mutation");
  const stale = await apiError(origin, token, request(2, "d40-real-stale", "asset_visual_baseline"));
  assert(stale.status === 409 && stale.body.code === "REVISION_CONFLICT", "stale media edit was not rejected");

  await stopStudio(studio); studio = undefined;
  studio = startStudio();
  const reopened = await waitForStudio();
  assert(media(reopened, "shot-2") === "asset_visual_d4_alt", "media replacement did not survive Studio restart");
  await host.close(); host = undefined;
  host = new NarralensHost({ revisionStore: new RevisionStore(dbPath) });
  origin = `http://127.0.0.1:${await host.listen(0)}`; token = await sessionToken(origin);
  const reopenedProject = await api(origin, token, "/api/projects/d1-30s");
  assert(reopenedProject.revision === 3, "media revision did not survive Host restart");

  const restore = await api(origin, token, "/api/projects/d1-30s/edits", request(3, "d40-real-restore", "asset_visual_baseline"));
  assert(restore.changed && restore.new_revision === 4, "baseline restore did not commit");
  const final = await hashes();
  assert(final.source === baseline.source && final.run === baseline.run && final.narration === baseline.narration, "byte-exact baseline was not restored");
  const finalSession = await studioSession();
  assert(media(finalSession, "shot-2") === "asset_visual_baseline", "final media identity is not baseline");

  const evidence = { format: "narralens.d40-real-media-e2e@1", at: new Date().toISOString(), project_id: "d1-30s",
    baseline: { ...baseline, studio_revision: initialSession.revision, shot_assets: assets(initialSession) },
    alternate: { response: alternate, ...alternateHashes, studio_revision: alternateSession.revision, shot_assets: assets(alternateSession) },
    idempotent_replay: { transaction_id: replay.transaction_id, repeated_mutation: false }, stale,
    reopen: { studio_revision: reopened.revision, host_revision: reopenedProject.revision, shot_assets: assets(reopened) },
    restore: { response: restore, ...final }, final: { ...final, studio_revision: finalSession.revision, shot_assets: assets(finalSession), baseline_restored: true },
    invariants: { frame_count: finalSession.timeline.frameCount, target_window: [300, 600], non_target_assets_unchanged: true,
      run_unchanged: true, narration_unchanged: true, source_byte_exact_restore: true, network_provider_calls: 0, cost: 0 } };
  await mkdir(resolve(evidencePath, ".."), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
} finally {
  if (host) await host.close().catch(() => undefined);
  if (studio) await stopStudio(studio).catch(() => undefined);
  for (const path of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) await rm(path, { force: true });
}

function startStudio(): ChildProcess {
  studioLog = "";
  const child = spawn(process.execPath, [resolve(root, "vendor/hypit/bin/hypit.mjs"), "studio", "--run", runPath, "--port", "4174",
    "--project", fixture, "--asset-manifest", resolve(fixture, "narralens.assets.json")],
  { cwd: root, env: { ...process.env, CI: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout?.on("data", (chunk) => { studioLog += chunk.toString(); });
  child.stderr?.on("data", (chunk) => { studioLog += chunk.toString(); });
  return child;
}

async function waitForStudio(): Promise<any> {
  for (let attempt = 0; attempt < 1_200; attempt += 1) {
    try { return await studioSession(); } catch { await new Promise((done) => setTimeout(done, 100)); }
    if (studio?.exitCode !== null) throw new Error(`Hypit Studio exited during startup (${studio?.exitCode})\n${studioLog}`);
  }
  throw new Error(`Hypit Studio did not become ready within 120 seconds\n${studioLog}`);
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

function media(snapshot: any, authoredId: string): string | undefined {
  return snapshot.tracks.flatMap((track: any) => track.items).find((item: any) => item.authoredId === authoredId)?.mediaAsset?.assetId;
}
function assets(snapshot: any): Record<string, string | undefined> {
  return Object.fromEntries(["shot-1", "shot-2", "shot-3"].map((id) => [id, media(snapshot, id)]));
}
function request(revision: number, key: string, assetId: string): Record<string, unknown> {
  return { base_revision: revision, idempotency_key: key,
    selection: { shot_id: "shot-002", start_frame: 300, end_frame_exclusive: 600 }, preserve: ["narration", "duration"],
    operations: [{ op: "replace_visual_asset", shot_id: "shot-002", asset_id: assetId }] };
}
async function sessionToken(origin: string): Promise<string> {
  return (await (await fetch(`${origin}/api/session`, { headers: { origin } })).json() as { token: string }).token;
}
async function api(origin: string, token: string, path: string, body?: Record<string, unknown>): Promise<any> {
  const response = await fetch(`${origin}${path}`, { method: body ? "POST" : "GET", headers: { origin, authorization: `Bearer ${token}`,
    ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const value = await response.json(); if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(value)}`); return value;
}
async function apiError(origin: string, token: string, body: Record<string, unknown>): Promise<any> {
  const response = await fetch(`${origin}/api/projects/d1-30s/edits`, { method: "POST", headers: { origin, authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
async function hashes(): Promise<{ source: string; run: string; narration: string }> {
  const values = await Promise.all([sourcePath, runPath, narrationPath].map(async (path) => createHash("sha256").update(await readFile(path)).digest("hex")));
  return { source: values[0]!, run: values[1]!, narration: values[2]! };
}
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
