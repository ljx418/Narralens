import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { HypitEngineAdapter } from "../src/adapters/hypit/hypit-engine-adapter.js";
import { HypitReadAdapter } from "../src/adapters/hypit/hypit-read-adapter.js";
import { HypitWriteAdapter } from "../src/adapters/hypit/hypit-write-adapter.js";
import { ProjectCatalog } from "../src/host/projects/project-catalog.js";
import { computeSourceDigest } from "../src/host/engine/source-digest-v1.js";

/**
 * Reproductions of the two experiments the independent external review ran (B-02 and M-03).
 *
 * Each one asserts the CORRECTED behaviour, so a reviewer can re-run exactly these commands
 * and see the fix rather than take the claim on trust. Usage:
 *
 *   corepack pnpm exec tsx tools/m2.1-external-review-repro.mts hypit-visual-asset
 *   corepack pnpm exec tsx tools/m2.1-external-review-repro.mts symlink-alias
 */

const REPO = resolve(import.meta.dirname, "..");
const scenario = process.argv[2] ?? "";
const sha = async (path: string): Promise<string> =>
  createHash("sha256").update(await readFile(path)).digest("hex");

async function hypitVisualAsset(): Promise<Record<string, unknown>> {
  const dir = await mkdtemp(resolve(tmpdir(), "m21-repro-b02-"));
  try {
    await cp(resolve(REPO, "fixtures/d1-30s"), dir, { recursive: true });
    const catalog = new ProjectCatalog(new Map([["d1-30s", resolve(dir, "narralens.project.json")]]));
    const descriptor = await catalog.readDescriptor("d1-30s");
    const adapter = new HypitEngineAdapter({
      catalog, reader: new HypitReadAdapter(catalog), writer: new HypitWriteAdapter(catalog),
    });

    const manifestFile = resolve(dir, "narralens.assets.json");
    const manifestBefore = await sha(manifestFile);
    const before = await adapter.sourceDigestFor("d1-30s", descriptor);

    const visual = resolve(dir, "assets/generated/visual-10s.mp4");
    const visualBefore = await sha(visual);
    await writeFile(visual, Buffer.concat([await readFile(visual), Buffer.from([0x00])]));
    const visualAfter = await sha(visual);

    let outcome: Record<string, unknown>;
    try {
      const after = await adapter.sourceDigestFor("d1-30s", descriptor);
      outcome = { mode: "digested", digest_changed: after.source_digest !== before.source_digest,
        digest_before: before.source_digest, digest_after: after.source_digest };
    } catch (error) {
      const failure = error as { status?: number; code?: string; message?: string };
      outcome = { mode: "refused", status: failure.status, code: failure.code,
        message: String(failure.message ?? "") };
    }

    const report = {
      experiment: "external-review B-02 reproduction",
      question: "does appending one byte to a referenced visual asset, with the manifest untouched, change the digest?",
      manifest_unchanged: manifestBefore === (await sha(manifestFile)),
      referenced_visual_bytes_changed: visualBefore !== visualAfter,
      referenced_assets_in_closure: before.manifest.assets.map((asset) => asset.path),
      ...outcome,
      // The pre-fix behaviour was digest_equal=true with an unchanged manifest: the tamper
      // was invisible. The corrected behaviour is a refusal or a changed digest.
      passed: outcome.mode === "refused" ? true : (outcome as { digest_changed?: boolean }).digest_changed === true,
    };
    return report;
  } finally { await rm(dir, { recursive: true, force: true }); }
}

async function symlinkAlias(): Promise<Record<string, unknown>> {
  const dir = await mkdtemp(resolve(tmpdir(), "m21-repro-m03-"));
  try {
    const fixture = resolve(REPO, "tests/fixtures/m2.1/openfilm-project");
    await cp(fixture, dir, { recursive: true });
    await symlink(resolve(dir, "assets/tokens.css"), resolve(dir, "assets/alias.css"));
    await writeFile(resolve(dir, "assets/theme.css"), '@import "tokens.css";\n@import "alias.css";\n', "utf8");

    const result = await computeSourceDigest({
      root: dir, roots: ["film.html", "assets/narration.vtt", "assets/settings.json"],
      engine: "openfilm", engineUpstreamSha: "e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3",
    });
    const paths = result.manifest.files.map((file) => file.path);
    const occurrences = paths.filter((path) => path === "assets/tokens.css").length;
    return {
      experiment: "external-review M-03 reproduction",
      question: "does an internal symlink alias plus a direct reference produce one canonical manifest row?",
      manifest_paths: paths,
      canonical_occurrences: occurrences,
      unique: new Set(paths).size === paths.length,
      digest: result.source_digest,
      // The pre-fix behaviour was two identical `assets/tokens.css` rows.
      passed: occurrences === 1 && new Set(paths).size === paths.length,
    };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

const reports = scenario === "hypit-visual-asset" ? [await hypitVisualAsset()]
  : scenario === "symlink-alias" ? [await symlinkAlias()]
  : [await hypitVisualAsset(), await symlinkAlias()];

for (const report of reports) console.log(JSON.stringify(report, null, 2));
const failed = reports.filter((report) => report.passed !== true);
console.log(`scenarios=${reports.length} failed=${failed.length}`);
if (failed.length > 0) process.exitCode = 1;
