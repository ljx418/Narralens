import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalJson, computeSourceDigest, extractReferences, SOURCE_DIGEST_DOMAIN } from "../../src/host/engine/source-digest-v1.js";
import type { SourceDigestManifest } from "../../src/contracts/engine-types.js";

/** AC-006 / EN-04: the digest must cover the whole referenced closure, deterministically. */

const fixtureRoot = resolve("tests/fixtures/m2.1/openfilm-project");
const OPENFILM_SHA = "e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3";
const ROOTS = ["film.html", "assets/narration.vtt", "assets/settings.json"];
const temporaries: string[] = [];

afterEach(async () => { await Promise.all(temporaries.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

async function copyFixture(): Promise<string> {
  const target = await mkdtemp(resolve(tmpdir(), "narralens-m21-digest-"));
  temporaries.push(target);
  await cp(fixtureRoot, target, { recursive: true });
  return target;
}

function digestOf(manifest: SourceDigestManifest): string {
  return createHash("sha256").update(SOURCE_DIGEST_DOMAIN).update(canonicalJson(manifest)).digest("hex");
}

describe("SourceDigestV1 closure", () => {
  it("EN-04 covers the entry, every scene, css, subtitle, settings, font and referenced asset", async () => {
    const result = await computeSourceDigest({ root: fixtureRoot, roots: ROOTS, engine: "openfilm", engineUpstreamSha: OPENFILM_SHA,
      declaredAssets: [{ path: "assets/narration.m4a", asset_id: "asset_narration_m21" }] });
    const files = result.manifest.files.map((file) => `${file.role}:${file.path}`);
    expect(files).toEqual([
      "font:assets/font.woff2",
      "subtitle:assets/narration.vtt",
      "settings:assets/settings.json",
      "css:assets/theme.css",
      "css:assets/tokens.css",
      "entry:film.html",
      "scene:scenes/shot-01.html",
      "scene:scenes/shot-02.html",
      "scene:scenes/shot-03.html",
    ]);
    expect(result.manifest.assets.map((asset) => asset.path)).toEqual(["assets/narration.m4a", "assets/poster.png"]);
    expect(result.manifest.assets[0]!.asset_id).toBe("asset_narration_m21");
    expect(result.source_digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.source_digest).toBe(digestOf(result.manifest));
  });

  it("EN-04 gives the same digest whatever order the Host declares the roots in", async () => {
    const forward = await computeSourceDigest({ root: fixtureRoot, roots: ROOTS, engine: "openfilm", engineUpstreamSha: OPENFILM_SHA });
    expect(forward.source_digest).toBe(digestOf(forward.manifest));
    expect(forward.manifest.files.find((file) => file.role === "entry")?.path).toBe("film.html");

    // Permuting the roots that are not the declared entry must not move the result.
    const reordered = await computeSourceDigest({
      root: fixtureRoot, roots: ["film.html", "assets/settings.json", "assets/narration.vtt"],
      engine: "openfilm", engineUpstreamSha: OPENFILM_SHA,
    });
    expect(reordered.source_digest).toBe(forward.source_digest);

    // Traversal order must never decide which root is the entry: `assets/...` sorts before
    // `film.html`, so sorting alone would have promoted the subtitle file to `entry`.
    const sortedFirst = await computeSourceDigest({ root: fixtureRoot, roots: ["film.html", "assets/narration.vtt"],
      engine: "openfilm", engineUpstreamSha: OPENFILM_SHA });
    expect(sortedFirst.manifest.files.find((file) => file.role === "entry")?.path).toBe("film.html");
    expect(sortedFirst.manifest.files.some((file) => file.path === "assets/settings.json")).toBe(false);

    // A root whose extension has no role fails closed instead of being classified loosely.
    await expect(computeSourceDigest({ root: fixtureRoot, roots: ["README.md"], engine: "openfilm", engineUpstreamSha: OPENFILM_SHA }))
      .rejects.toMatchObject({ details: { source_error: "SOURCE_REFERENCE_UNRESOLVED" } });
  });

  it("EN-04 changes the digest when a scene, subtitle, setting, font or referenced asset changes", async () => {
    const base = await computeSourceDigest({ root: fixtureRoot, roots: ROOTS, engine: "openfilm", engineUpstreamSha: OPENFILM_SHA });
    for (const [file, replacement] of [
      ["scenes/shot-02.html", "<!doctype html><html><body><div class=\"t\">镜头二（改）</div></body></html>"],
      ["assets/narration.vtt", "WEBVTT\n\n00:00:00.000 --> 00:00:09.900\n第一镜（改）\n"],
      ["assets/settings.json", "{ \"profile\": \"changed\" }"],
      ["assets/font.woff2", "NFIXTURE-FONT-BYTES-CHANGED"],
      ["assets/poster.png", "NFIXTURE-PNG-BYTES-CHANGED"],
      ["assets/theme.css", "@import \"tokens.css\";\nbody{color:#fff}\n"],
    ] as const) {
      const root = await copyFixture();
      await writeFile(resolve(root, file), replacement, "utf8");
      const changed = await computeSourceDigest({ root, roots: ROOTS, engine: "openfilm", engineUpstreamSha: OPENFILM_SHA });
      expect(changed.source_digest, `${file} must change the digest`).not.toBe(base.source_digest);
    }
  });

  it("EN-04 resolves an OpenFilm time fragment to the same closure entry", async () => {
    const baseline = await computeSourceDigest({ root: fixtureRoot, roots: ROOTS, engine: "openfilm", engineUpstreamSha: OPENFILM_SHA });
    const stripped = await copyFixture();
    await writeFile(resolve(stripped, "film.html"),
      (await readFile(resolve(stripped, "film.html"), "utf8")).replace('src="scenes/shot-01.html#t=0,10"', 'src="scenes/shot-01.html"'), "utf8");
    const without = await computeSourceDigest({ root: stripped, roots: ROOTS, engine: "openfilm", engineUpstreamSha: OPENFILM_SHA });
    // The fragment decides nothing about closure membership: the same files, roles and
    // content digests are reached. Only film.html's own bytes differ, so the entry digest
    // changes — which is correct, because film.html really did change.
    const membership = (result: typeof baseline) => result.manifest.files
      .filter((file) => file.path !== "film.html").map((file) => `${file.role}:${file.path}:${file.sha256}`);
    expect(membership(without)).toEqual(membership(baseline));
    expect(without.source_digest).not.toBe(baseline.source_digest);
  });

  it("EN-04 counts a cycle once and refuses a reference that does not resolve", async () => {
    const root = await copyFixture();
    await writeFile(resolve(root, "assets/theme.css"), '@import "tokens.css";\n@import "cycles.css";\n', "utf8");
    await writeFile(resolve(root, "assets/cycles.css"), '@import "theme.css";\n@import "tokens.css";\n', "utf8");
    const cyclic = await computeSourceDigest({ root, roots: ROOTS, engine: "openfilm", engineUpstreamSha: OPENFILM_SHA });
    expect(cyclic.manifest.files.filter((file) => file.path === "assets/tokens.css")).toHaveLength(1);
    expect(cyclic.manifest.files.filter((file) => file.path === "assets/cycles.css")).toHaveLength(1);

    const broken = await copyFixture();
    await writeFile(resolve(broken, "assets/theme.css"), '@import "missing.css";\n', "utf8");
    await expect(computeSourceDigest({ root: broken, roots: ROOTS, engine: "openfilm", engineUpstreamSha: OPENFILM_SHA }))
      .rejects.toMatchObject({ details: { source_error: "SOURCE_REFERENCE_UNRESOLVED" } });
  });

  it("AC-006 refuses absolute paths, traversal, symlink escape, query strings and unknown roles", async () => {
    const root = await copyFixture();
    await writeFile(resolve(root, "assets/theme.css"), '@import "/etc/passwd";\n', "utf8");
    await expect(computeSourceDigest({ root, roots: ROOTS, engine: "openfilm", engineUpstreamSha: OPENFILM_SHA }))
      .rejects.toMatchObject({ details: { source_error: "SOURCE_PATH_ESCAPE" } });

    const traversal = await copyFixture();
    await writeFile(resolve(traversal, "assets/theme.css"), '@import "../../outside.css";\n', "utf8");
    await expect(computeSourceDigest({ root: traversal, roots: ROOTS, engine: "openfilm", engineUpstreamSha: OPENFILM_SHA }))
      .rejects.toMatchObject({ details: { source_error: "SOURCE_PATH_ESCAPE" } });

    const escaping = await copyFixture();
    const outside = await mkdtemp(resolve(tmpdir(), "narralens-m21-outside-"));
    temporaries.push(outside);
    await writeFile(resolve(outside, "outside.css"), ".outside{}\n", "utf8");
    await symlink(resolve(outside, "outside.css"), resolve(escaping, "assets/escape.css"));
    await writeFile(resolve(escaping, "assets/theme.css"), '@import "escape.css";\n', "utf8");
    await expect(computeSourceDigest({ root: escaping, roots: ROOTS, engine: "openfilm", engineUpstreamSha: OPENFILM_SHA }))
      .rejects.toMatchObject({ details: { source_error: "SOURCE_PATH_ESCAPE" } });

    const query = await copyFixture();
    await writeFile(resolve(query, "assets/theme.css"), '@import "tokens.css?v=2";\n', "utf8");
    await expect(computeSourceDigest({ root: query, roots: ROOTS, engine: "openfilm", engineUpstreamSha: OPENFILM_SHA }))
      .rejects.toMatchObject({ details: { source_error: "SOURCE_REFERENCE_UNSUPPORTED" } });

    const unknown = await copyFixture();
    await writeFile(resolve(unknown, "assets/theme.css"), '@import "notes.md";\n', "utf8");
    await expect(computeSourceDigest({ root: unknown, roots: ROOTS, engine: "openfilm", engineUpstreamSha: OPENFILM_SHA }))
      .rejects.toMatchObject({ details: { source_error: "SOURCE_FILE_ROLE_UNKNOWN" } });
  });

  it("counts external references without following them and without letting them reach the digest", async () => {
    const root = await copyFixture();
    await writeFile(resolve(root, "assets/theme.css"), '@import "https://example.test/remote.css";\n@import "tokens.css";\n', "utf8");
    const result = await computeSourceDigest({ root, roots: ROOTS, engine: "openfilm", engineUpstreamSha: OPENFILM_SHA });
    expect(result.external_reference_count).toBe(1);
    expect(result.manifest.files.some((file) => file.path.includes("remote.css"))).toBe(false);
  });
});

describe("SourceDigestV1 reference extraction", () => {
  it("extracts only the pinned attribute set and never a form action or data attribute", () => {
    const html = '<html><head><link href="a.css"><style>@import "b.css";</style></head>'
      + '<body><img src="c.png"><form action="d.html"></form><div data-src="e.html" style="background:url(f.jpg)"></div></body></html>';
    expect(extractReferences("html", html)).toEqual(["a.css", "c.png", "f.jpg"]);
  });

  it("extracts quoted and unquoted url() from css and ignores settings and font leaves", () => {
    expect(extractReferences("css", '@import "a.css";\n.a{background:url(b.png)}\n.c{background:url("c.png")}\n.d{background:url(\'d.png\')}'))
      .toEqual(["a.css", "b.png", "c.png", "d.png"]);
    expect(extractReferences("settings", '{"asset": "x.png"}')).toEqual([]);
    expect(extractReferences("font", "url(x.woff2)")).toEqual([]);
  });

  it("extracts only cue URI lines from a WebVTT body, not the header or a bare path", () => {
    const withHeaderUri = "WEBVTT\nURI: header-must-not-count.css\n\n00:00:00.000 --> 00:00:01.000\nhello\n";
    expect(extractReferences("subtitle", withHeaderUri)).toEqual([]);
    const barePath = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nhello\nassets/first.css\n";
    expect(extractReferences("subtitle", barePath)).toEqual([]);
    const cueUri = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nURI: assets/first.css\nhello\n";
    expect(extractReferences("subtitle", cueUri)).toEqual(["assets/first.css"]);
  });
});

describe("SourceDigestV1 canonical form", () => {
  it("sorts object keys by UTF-8 byte order and refuses floats", () => {
    expect(canonicalJson({ b: 1, a: 2, é: 3, A: 4 })).toBe('{"A":4,"a":2,"b":1,"é":3}');
    expect(() => canonicalJson({ value: 1.5 })).toThrow(/CANONICAL_NON_INTEGER/u);
    expect(() => canonicalJson({ value: Number.NaN })).toThrow(/CANONICAL_NON_INTEGER/u);
  });

  it("matches every committed golden vector", async () => {
    const vectors = JSON.parse(await readFile(resolve("tests/m2.1-golden/source-digest-v1.vectors.json"), "utf8")) as {
      vectors: Array<{ id: string; manifest: SourceDigestManifest; source_digest: string }>;
    };
    expect(vectors.vectors.length).toBeGreaterThanOrEqual(10);
    for (const vector of vectors.vectors) {
      expect(digestOf(vector.manifest), vector.id).toBe(vector.source_digest);
    }
  });
});
