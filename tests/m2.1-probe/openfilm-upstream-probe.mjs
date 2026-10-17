import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createPinnedOpenFilmUpstream, openFilmAvailability } from "../../src/adapters/openfilm/openfilm-upstream.js";
import { OpenFilmEngineAdapter } from "../../src/adapters/openfilm/openfilm-engine-adapter.js";
import { computeSourceDigest } from "../../src/host/engine/source-digest-v1.js";
import { absoluteServerPath } from "../../src/host/engine/isolated-root.js";

/**
 * Real upstream probe for M2.1 (evidence kind `real_upstream_probe`).
 *
 * Runs the PRODUCTION adapter modules against the real, pinned OpenFilm checkout rather
 * than a mock. It must be executed from the isolated M1B worktree, which is the only place
 * `vendor/openfilm` exists at the pinned full SHA:
 *
 *   corepack pnpm exec tsx <repo>/tests/m2.1-probe/openfilm-upstream-probe.mjs \
 *     <vendor-openfilm-root> <openfilm-project-dir> <output-json>
 *
 * The project is copied to a temporary directory first; the source it came from is never
 * written to, and the copy is removed on the way out.
 */

const [vendorRoot, projectSource, outputPath] = process.argv.slice(2);
assert.ok(vendorRoot && projectSource && outputPath, "usage: probe <vendorRoot> <projectDir> <outputJson>");

const checks = [];
function record(id, assertion, detail) { checks.push({ id, assertion, status: "PASS", detail }); }

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const availability = await openFilmAvailability(resolve(vendorRoot));
assert.equal(availability.available, true, `pinned upstream unavailable: ${availability.reason}`);
assert.equal(availability.observed_sha, "e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3");
assert.ok(availability.checked.includes("packages/openfilm/studio/server/film.mjs"),
  `the seam module digest must be verified, checked=${availability.checked.join(",")}`);
assert.ok(availability.checked.includes("package.json") && availability.checked.includes("LICENSE"));
record("PIN-01", "OpenFilm checkout is at the pinned SHA and every loaded file matches its digest",
  { observed_sha: availability.observed_sha, checked: availability.checked });

const upstream = await createPinnedOpenFilmUpstream(resolve(vendorRoot));
assert.equal(typeof upstream.readProjectFilm, "function");
assert.equal(typeof upstream.editProjectFilm, "function");
assert.equal(typeof upstream.revOf, "function");
record("PIN-02", "the three M1B-verified seam exports load from the pinned upstream", { module: "packages/openfilm/studio/server/film.mjs" });

const isolated = await mkdtemp(join(tmpdir(), "narralens-m21-openfilm-"));
const project = join(isolated, "project");
const stageRoot = await mkdtemp(join(isolated, "stage-"));
await cp(resolve(projectSource), project, { recursive: true });

const sourceBytesBefore = await readFile(join(project, "film.html"));
const sourceShaBefore = sha256(sourceBytesBefore);

const layout = {
  root: project,
  roots: ["film.html", "assets/narration.vtt"],
  declaredAssets: [{ path: "assets/narration.wav", asset_id: "asset_narration_m1b" }],
  subtitles: [{ subtitle_id: "narration", path: "assets/narration.vtt" }],
};
const adapter = new OpenFilmEngineAdapter(upstream);
adapter.registerLayout("probe-openfilm", layout);

const ctx = { correlationId: "m21-openfilm-probe", projectId: "probe-openfilm", signal: AbortSignal.timeout(20_000) };

// ── 1. inspect: a real three-clip projection read through the pinned upstream ──────────
const firstDigest = await computeSourceDigest({ root: project, roots: layout.roots, engine: "openfilm",
  engineUpstreamSha: "e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3", declaredAssets: layout.declaredAssets });
const projection = await adapter.inspect(
  { project_id: "probe-openfilm", engine: "openfilm", source_digest: firstDigest.source_digest }, ctx);

assert.deepEqual(projection.problems, []);
assert.equal(projection.engine, "openfilm");
assert.deepEqual(projection.fps, { num: 30, den: 1 });
const pictureClips = projection.clips.filter((clip) => clip.kind === "page");
assert.deepEqual(pictureClips.map((clip) => clip.clip_id), ["shot-01", "shot-02", "shot-03"]);
assert.deepEqual(pictureClips.map((clip) => clip.frame_range), [
  { start_frame: 0, end_frame_exclusive: 300 },
  { start_frame: 300, end_frame_exclusive: 600 },
  { start_frame: 600, end_frame_exclusive: 900 },
]);
const narration = projection.clips.filter((clip) => clip.kind === "sound");
assert.deepEqual(narration.map((clip) => clip.clip_id), ["narration"]);
assert.equal(projection.frame_count, 900);
assert.equal(projection.tracks.length, 2);
assert.equal(projection.source_digest, firstDigest.source_digest);
assert.equal(projection.subtitles.length, 1);
assert.equal(projection.subtitles[0].source_ref, "assets/narration.vtt");
assert.ok(projection.asset_references.some((asset) => asset.path === "assets/narration.wav" && asset.asset_id === "asset_narration_m1b"));
record("OF-01", "inspect reads three native page clips, one narration sound clip, 30/1 and 900 frames from the real film",
  { frame_count: projection.frame_count, tracks: projection.tracks.length,
    clips: projection.clips.map((clip) => [clip.clip_id, clip.kind, clip.frame_range]) });

// ── 2. capabilities: no OpenFilm operation is translated or unverified in M2.1 ────────
const capabilities = await adapter.capabilities({ project_id: "probe-openfilm", engine: "openfilm", source_digest: firstDigest.source_digest }, ctx);
// M-01: the map is complete, and no OpenFilm write is reported as supported.
const reported = Object.entries(capabilities.entries);
assert.ok(reported.length > 0, "the OpenFilm capability map must not be empty");
for (const [operation, entry] of reported) {
  assert.notEqual(entry.state, "supported", `${operation} must not be supported on OpenFilm in M2.1`);
  assert.notEqual(entry.state, "unverified", `${operation} must not be unverified`);
}
for (const operation of ["timeline.set_visual_fit", "timeline.replace_visual_asset"]) {
  assert.equal(capabilities.entries[operation].state, "blocked", operation);
}
assert.equal(capabilities.fps_verified, true);
assert.deepEqual(capabilities.fps, { num: 30, den: 1 });
record("OF-02", "capabilities is complete and reports no supported or unverified OpenFilm write",
  { operations: reported.length, writes: ["timeline.set_visual_fit", "timeline.replace_visual_asset"] });

// ── 3. plan: no OpenFilm write path exists in M2.1 ───────────────────────────────────
const commandCtx = { ...ctx, idempotencyKey: "m21-openfilm-probe", baseRevision: 0,
  expectedSourceDigest: firstDigest.source_digest, controlRevision: 0,
  isolatedRoot: absoluteServerPath(stageRoot) };
const planRefusal = await adapter.plan({ project_id: "probe-openfilm", engine: "openfilm", source_digest: firstDigest.source_digest },
  { op: "set_visual_fit", shot_id: "shot-01", value: "contain" }, commandCtx)
  .then(() => null, (error) => error);
assert.ok(planRefusal, "plan must refuse");
assert.equal(planRefusal.status, 422);
assert.equal(planRefusal.code, "UNSUPPORTED_EDIT");
record("OF-03", "plan refuses every OpenFilm write instead of inventing an operation",
  { status: planRefusal.status, code: planRefusal.code });

// ── 4. AC-004/AC-005: an out-of-band change is refused before the upstream is touched ──
await writeFile(join(project, "film.html"),
  sourceBytesBefore.toString("utf8").replace('id="shot-01"', 'id="shot-01" data-external="1"'), "utf8");
const sourceShaAfterExternal = sha256(await readFile(join(project, "film.html")));
assert.notEqual(sourceShaAfterExternal, sourceShaBefore);

const stalePlan = { engine: "openfilm", base_source_digest: firstDigest.source_digest, base_revision: 0,
  edit: { op: "set_visual_fit", shot_id: "shot-01", value: "contain" },
  ops: [{ op: "set", clip: "shot-01", field: "overrides", value: [{ at: ".t", text: "外部修改" }] }] };
const stageRefusal = await adapter.stage(stalePlan, absoluteServerPath(stageRoot), commandCtx)
  .then(() => null, (error) => error);
assert.ok(stageRefusal, "stage must refuse a stale base");
assert.equal(stageRefusal.status, 409);
assert.equal(stageRefusal.code, "SOURCE_CHANGED");
assert.equal(sha256(await readFile(join(project, "film.html"))), sourceShaAfterExternal,
  "the refusal must not have written anything");
record("OF-04", "a stale base is refused with 409 before the upstream mutator runs and bytes are unchanged",
  { status: stageRefusal.status, code: stageRefusal.code, film_sha256_before: sourceShaAfterExternal,
    film_sha256_after: sha256(await readFile(join(project, "film.html"))) });

// ── 5. AC-006: the real project's closure includes film, scenes, subtitle and audio ───
const afterChange = await computeSourceDigest({ root: project, roots: layout.roots, engine: "openfilm",
  engineUpstreamSha: "e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3", declaredAssets: layout.declaredAssets });
assert.notEqual(afterChange.source_digest, firstDigest.source_digest);
const roles = afterChange.manifest.files.map((file) => `${file.role}:${file.path}`);
assert.ok(roles.includes("entry:film.html"), roles.join(","));
assert.ok(roles.includes("scene:scenes/shot-01.html"), roles.join(","));
assert.ok(roles.includes("subtitle:assets/narration.vtt"), roles.join(","));
assert.ok(afterChange.manifest.assets.some((asset) => asset.path === "assets/narration.wav"), "audio asset must be in the closure");
record("OF-05", "the real project's digest closure covers entry, scenes, subtitle and referenced audio",
  { roles, assets: afterChange.manifest.assets.map((asset) => asset.path), digest_before: firstDigest.source_digest, digest_after: afterChange.source_digest });

// ── 6. M-05: what the upstream actually does, and what the adapter does about it ───────
// Two different facts are proved here and are recorded as two different kinds of evidence.
//   (a) real_upstream: the pinned upstream really does rebase a stale base. Asserted, not assumed.
//   (b) real_e2e:      the adapter refuses that same scenario on the real upstream, and the
//                     author source bytes are exactly as the external edit left them.
//   (c) adapter_contract: a rebased:true result is converted to 409. This one needs a stub,
//                     because a rebased result cannot be produced through the real adapter
//                     once (b) refuses to let the mutator run at all.
{
  const baseFilm = join(project, "film.html");
  const digestBeforeRebase = await computeSourceDigest({ root: project, roots: layout.roots,
    engine: "openfilm", engineUpstreamSha: "e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3",
    declaredAssets: layout.declaredAssets });

  // A stale base: read the rev, then let the source move underneath it.
  const staleBase = await upstream.readProjectFilm(project);
  await writeFile(baseFilm,
    (await readFile(baseFilm, "utf8")).replace('<section data-track="picture">',
      '<section data-track="picture" data-external="1">'), "utf8");
  const bytesAfterExternalEdit = sha256(await readFile(baseFilm));

  const nativeRebased = await upstream.editProjectFilm(project, staleBase.rev,
    [{ op: "set", clip: "shot-03", field: "at", value: 21 }]);
  // The oracle the previous version of this probe was missing.
  assert.equal(nativeRebased.rebased, true,
    "the pinned upstream is expected to rebase a stale base; if this fails the upstream changed");
  assert.notEqual(nativeRebased.rev, staleBase.rev);
  // Step (a) deliberately drove a real upstream write into the isolated copy; everything
  // after this point must leave those bytes exactly as they are.
  const authorBytesBeforeAdapter = sha256(await readFile(baseFilm));
  assert.notEqual(authorBytesBeforeAdapter, bytesAfterExternalEdit,
    "the deliberate upstream rebase should have modified the isolated author source");
  record("OF-06a", "the real pinned upstream rebases a stale base", {
    evidence_kind: "real_upstream",
    base_rev: staleBase.rev,
    result_rev: nativeRebased.rev,
    rebased: nativeRebased.rebased,
  });

  // (b) The same scenario through the production adapter, on the real upstream.
  const realPlan = { engine: "openfilm", base_source_digest: digestBeforeRebase.source_digest, base_revision: 0,
    edit: { op: "set_visual_fit", shot_id: "shot-01", value: "contain" },
    ops: [{ op: "set", clip: "shot-01", field: "at", value: 1 }] };
  const realStageRoot = await mkdtemp(join(stageRoot, "stale-"));
  const realRefusal = await adapter.stage(realPlan, absoluteServerPath(realStageRoot), commandCtx)
    .then(() => null, (error) => error);
  assert.ok(realRefusal, "the adapter must refuse the stale base");
  assert.equal(realRefusal.status, 409);
  assert.equal(realRefusal.code, "SOURCE_CHANGED");
  assert.equal(sha256(await readFile(baseFilm)), authorBytesBeforeAdapter,
    "the adapter must not have written to the author source");
  assert.notEqual(authorBytesBeforeAdapter, bytesAfterExternalEdit);
  assert.deepEqual(await readdir(realStageRoot), [], "the refusal must leave no staging behind");
  record("OF-06b", "the adapter refuses the same stale base on the real upstream and leaves author bytes untouched",
    { evidence_kind: "real_e2e", status: realRefusal.status, code: realRefusal.code,
      film_sha256: authorBytesBeforeAdapter });

  // (c) Converting a rebased result into a refusal needs a stub: with (b) in place the real
  // mutator is never reached, so this is an adapter contract, recorded as such.
  const rebasedAdapter = new OpenFilmEngineAdapter({
    revOf: upstream.revOf,
    readProjectFilm: upstream.readProjectFilm,
    editProjectFilm: async (root, base, ops) => {
      const result = await upstream.editProjectFilm(root, base, ops);
      return { ...result, rebased: true };
    },
  });
  rebasedAdapter.registerLayout("probe-openfilm", layout);
  const rebasedPlan = { engine: "openfilm", base_source_digest: digestBeforeRebase.source_digest, base_revision: 0,
    edit: { op: "set_visual_fit", shot_id: "shot-01", value: "contain" },
    ops: [{ op: "set", clip: "shot-01", field: "at", value: 2 }] };
  const rebasedStageRoot = await mkdtemp(join(stageRoot, "rebased-"));
  const rebasedRefusal = await rebasedAdapter.stage(rebasedPlan, absoluteServerPath(rebasedStageRoot), commandCtx)
    .then(() => null, (error) => error);
  assert.ok(rebasedRefusal, "a rebased upstream result must be refused");
  assert.equal(rebasedRefusal.status, 409);
  assert.equal(rebasedRefusal.code, "SOURCE_CHANGED");
  record("OF-06c", "an upstream rebased:true result is converted to 409 and never adopted",
    { evidence_kind: "adapter_contract", status: rebasedRefusal.status, code: rebasedRefusal.code });
}

// ── 7. M-04: a tampered copy of the pinned checkout must be refused ────────────────────
// An isolated COPY of the real checkout is tampered with; the original is never touched.
// This is the negative half of M-04 and runs against the real loader, not a stub.
{
  const tampered = await mkdtemp(join(tmpdir(), "narralens-m21-tamper-"));
  try {
    await cp(resolve(vendorRoot), resolve(tampered, "openfilm"), { recursive: true, filter: () => true });
    const tamperRoot = resolve(tampered, "openfilm");
    const modulePath = resolve(tamperRoot, "packages/openfilm/studio/server/film.mjs");
    await writeFile(modulePath, `${await readFile(modulePath, "utf8")}\\n// tampered by the M2.1 negative probe\\n`, "utf8");

    const tamperAvailability = await openFilmAvailability(tamperRoot);
    assert.equal(tamperAvailability.available, false, "a tampered seam module must not be loadable");
    assert.match(tamperAvailability.reason, /digest mismatch|not intact|modifications/u);

    const refusal = await createPinnedOpenFilmUpstream(tamperRoot)
      .then(() => null, (error) => error);
    assert.ok(refusal, "loading a tampered checkout must refuse");
    assert.equal(refusal.status, 503);
    assert.equal(refusal.code, "ENGINE_UNAVAILABLE");
    record("PIN-03", "a tampered seam module at the pinned SHA is refused with ENGINE_UNAVAILABLE",
      { reason: tamperAvailability.reason, mismatch: tamperAvailability.mismatched });

    // The real, untouched checkout is still loadable after the tamper experiment.
    const after = await openFilmAvailability(resolve(vendorRoot));
    assert.equal(after.available, true, "the original pinned checkout must remain loadable");
    record("PIN-04", "the original pinned checkout is unaffected by the tamper experiment",
      { observed_sha: after.observed_sha });
  } finally {
    await rm(tampered, { recursive: true, force: true });
  }
}

await rm(isolated, { recursive: true, force: true });

const report = {
  format: "narralens.m21-openfilm-probe@1.0",
  evidence_kind: "real_upstream_probe",
  generated_at: new Date().toISOString(),
  upstream: { repository: "https://github.com/openfilm/openfilm.git", full_sha: availability.observed_sha,
    package: "openfilm@0.1.7", license: "MIT" },
  production_modules_exercised: [
    "src/adapters/openfilm/openfilm-upstream.ts",
    "src/adapters/openfilm/openfilm-engine-adapter.ts",
    "src/host/engine/source-digest-v1.ts",
    "src/host/engine/engine-port.ts",
  ],
  project_source_sha256: sourceShaBefore,
  checks,
  failures: 0,
  status: "PASS",
  limitations: [
    "Runs headless and silent; no window is opened and no audio device is used.",
    "Headed and human-experience validation are NOT_RUN for M2.1.",
    "This probe exercises the production adapter against the real pinned upstream. It is not a production integration: vendor/openfilm is not a registered submodule of the main worktree.",
  ],
};

await (await import("node:fs/promises")).writeFile(resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: report.status, checks: checks.map((check) => check.id) }, null, 2));
