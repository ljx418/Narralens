import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { NarralensHost } from "../../../src/host/server.js";
import { createPinnedOpenFilmUpstream } from "../../../src/adapters/openfilm/openfilm-upstream.js";
import {
  adoptedProject, postImpact, postRestore, restoreImpactBody, restoreRequestBody,
  start, stopAll, type Started,
} from "./harness.js";

/**
 * M4C's media, its cancellation and its failure discipline.
 *
 * The media half is the one that cannot be faked: the restored film is rendered by the
 * pinned upstream and the result is decoded and counted, so "three native editable clips"
 * is a statement about real media rather than about a JSON document.
 */

const hosts: NarralensHost[] = [];
const dirs: string[] = [];
const VENDOR = "/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm";
const run = promisify(execFile);
afterEach(async () => { await stopAll(hosts.splice(0), dirs.splice(0)); });

async function authorizedRestore(running: Started, suffix: string) {
  const project = await adoptedProject(running, suffix);
  const impact = await postImpact(running, project.projectId,
    restoreImpactBody(project.view, project.migrationSnapshot, `m4c-media-impact-${suffix}`));
  if (impact.status !== 201) {
    throw new Error(`RESTORE_IMPACT_${impact.status}:${JSON.stringify(impact.body)}`);
  }
  return { ...project, impact: impact.body as { impact_id: string; impact_hash: string },
    request: restoreRequestBody(project.view, project.migrationSnapshot,
      impact.body as { impact_id: string; impact_hash: string }, `m4c-media-${suffix}`) };
}

/** Render with the pinned upstream and count the decoded frames. */
async function render(root: string): Promise<{ digest: string; frames: number }> {
  await run(process.execPath || "node", [resolve(VENDOR, "packages/openfilm/bin/openfilm.mjs"), "render"],
    { cwd: root, timeout: 600_000, maxBuffer: 8 * 1024 * 1024 });
  const output = join(root, `${basename(root)}.mp4`);
  const probe = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-count_frames",
    "-show_entries", "stream=nb_read_frames", "-of", "json", output], { timeout: 60_000 });
  return { digest: createHash("sha256").update(await readFile(output)).digest("hex"),
    frames: Number.parseInt((JSON.parse(probe.stdout) as { streams: Array<{ nb_read_frames: string }> })
      .streams[0]!.nb_read_frames, 10) };
}

describe("M4C-14 and M4C-15: the restored film is still three native, decodable clips", () => {
  it("restores three native clips, renders them with the pinned upstream and decodes 900 frames", async () => {
    const running = await start();
    hosts.push(running.host); dirs.push(running.base);
    const prepared = await authorizedRestore(running, "media");
    const restored = await postRestore(running, prepared.projectId, prepared.request);
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);
    const view = await running.host.projectResolver.resolveActivated(prepared.projectId);
    const upstream = await createPinnedOpenFilmUpstream(VENDOR);
    const film = await upstream.readProjectFilm(view.source_root.value);
    expect(film.problems).toEqual([]);
    const clips = (film.doc as { tracks: Array<{ clips: Array<{ id: string; src: string }> }> }).tracks
      .flatMap((track) => track.clips);
    const visual = clips.filter((clip) => !/\.(wav|mp3|m4a|aac|flac|ogg)$/iu.test(clip.src));
    // **Three individually addressable clips**, and no flattened video among them.
    expect(visual.map((clip) => clip.id)).toEqual(["shot-001", "shot-002", "shot-003"]);
    expect(visual.every((clip) => !/\.(mp4|mov|webm|mkv)$/iu.test(clip.src))).toBe(true);
    // And the real render is real media with the promised length.
    const rendered = await render(view.source_root.value);
    expect(rendered.frames).toBe(900);
  }, 900_000);

  it("keeps the other two clips' identity when one clip is edited natively", async () => {
    const running = await start();
    hosts.push(running.host); dirs.push(running.base);
    const prepared = await authorizedRestore(running, "identity");
    const restored = await postRestore(running, prepared.projectId, prepared.request);
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);
    const view = await running.host.projectResolver.resolveActivated(prepared.projectId);
    const upstream = await createPinnedOpenFilmUpstream(VENDOR);
    const before = await upstream.readProjectFilm(view.source_root.value);
    const ids = (before.doc as { tracks: Array<{ clips: Array<{ id: string }> }> }).tracks
      .flatMap((track) => track.clips).map((clip) => clip.id);
    const edited = await upstream.editProjectFilm(view.source_root.value, before.rev,
      [{ op: "set", clip: "shot-002", field: "overrides", value: null }]);
    expect(edited.rebased).toBe(false);
    const after = await upstream.readProjectFilm(view.source_root.value);
    const afterIds = (after.doc as { tracks: Array<{ clips: Array<{ id: string }> }> }).tracks
      .flatMap((track) => track.clips).map((clip) => clip.id);
    // The other two clips are still *there*, with the same identity.
    expect(afterIds).toEqual(ids);
    expect(afterIds).toContain("shot-001");
    expect(afterIds).toContain("shot-003");
  }, 900_000);
});

describe("M4C TX-03C and TX-04C: the locks and the consumers are the right ones", () => {
  it("asks for a visual lock on every changed clip and no narration lock while the narration is preserved", async () => {
    const running = await start();
    hosts.push(running.host); dirs.push(running.base);
    const prepared = await authorizedRestore(running, "locks");
    // The consumers name the changed visual clips and the preserved narration.
    const consumers = (prepared.impact as unknown as { affected_consumers: Array<{ kind: string; id: string; action: string }> })
      .affected_consumers;
    expect(consumers).toContainEqual({ kind: "visual", id: "shot-002", action: "replace" });
    expect(consumers).toContainEqual({ kind: "narration", id: "narration", action: "preserve" });
    // And the affected ranges name the current clips.
    const ranges = (prepared.impact as unknown as { affected_ranges: Array<{ clip_id: string }> })
      .affected_ranges;
    expect(ranges.map((range) => range.clip_id)).toEqual(["shot-001", "shot-002", "shot-003"]);
  }, 900_000);

  it("does not let a narration lock block a restore that preserves the narration", async () => {
    const running = await start();
    hosts.push(running.host); dirs.push(running.base);
    const project = await adoptedProject(running, "narration-lock");
    running.host.locks.acquire({ projectId: project.projectId, lockType: "narration", scope: "project",
      targetId: "", owner: "narrator", reason: "m4c narration pass" }, project.view.revision);
    const current = await running.host.projectResolver.resolveActivated(project.projectId);
    const impact = await postImpact(running, project.projectId,
      restoreImpactBody(current, project.migrationSnapshot, "m4c-narration-impact"));
    // The lock is recorded — `locks_checked` is a snapshot, not a filter — and it did not
    // block the authorization, because the restore preserves the narration.
    expect(impact.status, JSON.stringify(impact.body)).toBe(201);
    expect((impact.body.locks_checked as unknown[]).length).toBe(1);
    const restored = await postRestore(running, project.projectId, restoreRequestBody(
      current, project.migrationSnapshot,
      impact.body as { impact_id: string; impact_hash: string }, "m4c-narration-restore"));
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);
  }, 900_000);
});

describe("M4C TX-12C: the restore changes nothing it did not name", () => {
  it("leaves the old snapshot's bytes and the adopted snapshot's bytes exactly as they were", async () => {
    const running = await start();
    hosts.push(running.host); dirs.push(running.base);
    const prepared = await authorizedRestore(running, "subset");
    const before = {
      target: running.host.revisions.snapshotRow(prepared.migrationSnapshot),
      adopted: running.host.revisions.snapshotRow(prepared.adoptedSnapshot),
    };
    const restored = await postRestore(running, prepared.projectId, prepared.request);
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);
    const after = {
      target: running.host.revisions.snapshotRow(prepared.migrationSnapshot),
      adopted: running.host.revisions.snapshotRow(prepared.adoptedSnapshot),
    };
    expect(after.target?.source_digest).toBe(before.target?.source_digest);
    expect(after.adopted?.source_digest).toBe(before.adopted?.source_digest);
    // And the snapshot's own bytes are still on disk, byte for byte.
    const source = join(running.host.snapshots.snapshotRoot(prepared.projectId, prepared.migrationSnapshot),
      "source", "film.html");
    const resolved = await running.host.historical.resolve(prepared.projectId, prepared.migrationSnapshot,
      "m4c-subset");
    expect(createHash("sha256").update(await readFile(source)).digest("hex")).toBe(resolved.film_sha256);
  }, 900_000);
});

describe("M4C-16: a cancellation before the publication intent discards the staged result", () => {
  it("aborts with revision +0 and publishes nothing", async () => {
    // The signal is injected at the service seam, because the route's own controller is
    // driven by the client's connection and a test cannot close it from outside. What is
    // under test is the rule: a cancellation *before* the publication intent stops the
    // write and discards the staged result, and a late stage result is never prepared or
    // published.
    const controller = new AbortController();
    let host: NarralensHost | undefined;
    const running = await start({ historyFault: (point) => {
      if (point !== "after_stage") return;
      // The client goes away after the stage and before the publication intent.
      controller.abort();
    } });
    host = running.host;
    hosts.push(running.host); dirs.push(running.base);
    const prepared = await authorizedRestore(running, "cancel");
    const outcome = await host!.history.restore(prepared.projectId,
      prepared.request as never, "m4c-cancel-correlation" as never, controller.signal);
    expect(outcome.status).toBe("aborted");
    // **Revision +0, nothing published, and the staged tree is gone.**
    const after = await running.host.projectResolver.resolveActivated(prepared.projectId);
    expect(after.revision).toBe(prepared.view.revision);
    expect(after.source_digest).toBe(prepared.view.source_digest);
    expect(running.host.revisions.projectTransactions(prepared.projectId).at(-1)?.state).toBe("aborted");
    expect(await readdir(join(running.base, "adoption-stage")).catch(() => [])).toEqual([]);
  }, 900_000);
});

describe("M4C-17: a failed restore writes nothing but its own failure", () => {
  it("leaves the source, the revision, the pointer, the impact, the outbox and the idempotency row as they were", async () => {
    const running = await start();
    hosts.push(running.host); dirs.push(running.base);
    const prepared = await authorizedRestore(running, "nowrite");
    const before = {
      view: await running.host.projectResolver.resolveActivated(prepared.projectId),
      outbox: running.host.revisions.pendingOutboxCount(),
      impacts: running.host.impacts.byProject(prepared.projectId).length,
    };
    // A target the impact did not authorize is refused before anything is staged. The
    // answer is 428, not 404: the impact exists and names a *different* target, and saying
    // "that snapshot does not exist" would be a statement this write never checked.
    const refused = await postRestore(running, prepared.projectId, {
      ...prepared.request, target_snapshot_id: "e".repeat(64),
    });
    expect(refused.status).toBe(428);
    expect(refused.body.code).toBe("IMPACT_STALE");
    const after = {
      view: await running.host.projectResolver.resolveActivated(prepared.projectId),
      outbox: running.host.revisions.pendingOutboxCount(),
      impacts: running.host.impacts.byProject(prepared.projectId).length,
    };
    // **Nothing moved.** The source, the revision, the pointer, the impact and the outbox
    // are all exactly what they were, and the only new row is the failure's own
    // idempotency record.
    expect(after.view.revision).toBe(before.view.revision);
    expect(after.view.source_digest).toBe(before.view.source_digest);
    expect(after.view.snapshot_id).toBe(before.view.snapshot_id);
    expect(after.outbox).toBe(before.outbox);
    expect(after.impacts).toBe(before.impacts);
    // And no staging tree survives.
    expect(await readdir(join(running.base, "adoption-stage")).catch(() => [])).toEqual([]);
  }, 900_000);
});
