import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { computeSourceDigest, canonicalJson, SOURCE_DIGEST_DOMAIN } from "../../src/host/engine/source-digest-v1.js";
import type { SourceDigestManifest } from "../../src/contracts/engine-types.js";

/**
 * Regenerate `source-digest-v1.vectors.json`.
 *
 * Run with `corepack pnpm test:m2.1:golden-vectors`. The committed JSON is what both the
 * TypeScript test and the Python cross-language re-computation read, so regenerating it is
 * an explicit, reviewable act and never a side effect of running the suite.
 */

const fixtureRoot = resolve("tests/fixtures/m2.1/openfilm-project");
const OPENFILM_SHA = "e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3";
const HYPIT_SHA = "6fdd8c0f02c17b9970aee6deb4550a70e9d57acf";

function digestOf(manifest: SourceDigestManifest): string {
  return createHash("sha256").update(SOURCE_DIGEST_DOMAIN).update(canonicalJson(manifest)).digest("hex");
}

const fixture = await computeSourceDigest({
  root: fixtureRoot,
  roots: ["film.html", "assets/narration.vtt", "assets/settings.json"],
  engine: "openfilm",
  engineUpstreamSha: OPENFILM_SHA,
  declaredAssets: [{ path: "assets/narration.m4a", asset_id: "asset_narration_m21" }],
});
const base = fixture.manifest;

function shuffle<T>(items: readonly T[], seed: number): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = (index * 7 + seed * 13) % (index + 1);
    const other = Number.isNaN(swap) ? 0 : swap;
    [copy[index], copy[other]] = [copy[other]!, copy[index]!];
  }
  return copy;
}

const vectors: Array<{ id: string; note: string; manifest: unknown; source_digest: string }> = [
  { id: "V01-fixture-closure", note: "Full closure of the M2.1 OpenFilm fixture", manifest: base, source_digest: digestOf(base) },
  { id: "V02-key-order", note: "Object keys reordered; the digest must not change", manifest: { engine_upstream_sha: base.engine_upstream_sha, files: base.files, assets: base.assets, engine: base.engine, format: base.format }, source_digest: digestOf(base) },
  { id: "V03-files-array-order", note: "files[] order is part of the manifest: sorting happens before canonical, not inside it, so a reordered array digests differently", manifest: { ...base, files: shuffle(base.files, 3) }, source_digest: digestOf({ ...base, files: shuffle(base.files, 3) }) },
  { id: "V04-assets-array-order", note: "assets[] reordered; semantic order is preserved so the digest MUST change", manifest: { ...base, assets: [...base.assets].reverse() }, source_digest: digestOf({ ...base, assets: [...base.assets].reverse() }) },
  { id: "V05-file-bytes", note: "One referenced file's content digest changes", manifest: { ...base, files: base.files.map((file) => file.path === "film.html" ? { ...file, sha256: "0".repeat(64) } : file) }, source_digest: digestOf({ ...base, files: base.files.map((file) => file.path === "film.html" ? { ...file, sha256: "0".repeat(64) } : file) }) },
  { id: "V06-closure-extended", note: "An extra referenced file joins the closure", manifest: { ...base, files: [...base.files, { path: "assets/extra.css", role: "css", sha256: "1".repeat(64), size: 12 }] }, source_digest: digestOf({ ...base, files: [...base.files, { path: "assets/extra.css", role: "css", sha256: "1".repeat(64), size: 12 }] }) },
  { id: "V07-upstream-sha", note: "The pinned upstream commit changes", manifest: { ...base, engine_upstream_sha: HYPIT_SHA }, source_digest: digestOf({ ...base, engine_upstream_sha: HYPIT_SHA }) },
  { id: "V08-role-change", note: "A file's role changes; the closure is the same bytes but not the same manifest", manifest: { ...base, files: base.files.map((file) => file.path === "scenes/shot-01.html" ? { ...file, role: "html" } : file) }, source_digest: digestOf({ ...base, files: base.files.map((file) => file.path === "scenes/shot-01.html" ? { ...file, role: "html" } : file) }) },
  { id: "V09-empty-closure", note: "An empty but well-formed closure still has a stable digest", manifest: { format: "narralens.source-digest-manifest@1.0", engine: "hypit", engine_upstream_sha: HYPIT_SHA, files: [], assets: [] }, source_digest: digestOf({ format: "narralens.source-digest-manifest@1.0", engine: "hypit", engine_upstream_sha: HYPIT_SHA, files: [], assets: [] }) },
  { id: "V10-format-change", note: "The manifest format identifier is part of the digested content", manifest: { ...base, format: "narralens.source-digest-manifest@2.0" as unknown as typeof base.format },
    source_digest: digestOf({ ...base, format: "narralens.source-digest-manifest@2.0" as unknown as typeof base.format }) },
];

const payload = {
  format: "narralens.source-digest-vectors@1.0",
  domain_prefix: "narralens-source-v1\\n",
  algorithm: "SHA256(domain_prefix || canonical_json(manifest))",
  fixture_root: "tests/fixtures/m2.1/openfilm-project",
  vector_count: vectors.length,
  vectors,
};

await writeFile(resolve("tests/m2.1-golden/source-digest-v1.vectors.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
const check = JSON.parse(await readFile(resolve("tests/m2.1-golden/source-digest-v1.vectors.json"), "utf8")) as { vectors: unknown[] };
console.log(`wrote ${check.vectors.length} vectors`);
