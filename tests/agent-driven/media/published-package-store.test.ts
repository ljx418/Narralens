import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PublishedPackageStore } from "../../../src/host/delivery/published-package-store.js";
import { buildDeliveryManifest } from "../../../src/host/delivery/manifest.js";
import { PACKAGE_FILES, PACKAGE_REF_IDS, type PackageIndex } from "../../../src/host/delivery/package-layout.js";
import { removeDirectory, renderSpec, sha256Of, temporaryDirectory } from "./support.js";

/**
 * The published package store.
 *
 * Module checks for the no-clobber rule (T20-C at the module level): one package per
 * key, nothing overwritten, an unfinished publication moved aside rather than deleted.
 * The concurrent case with two real processes is part of the real T20 acceptance and is
 * `NOT_RUN`.
 */

const dirs: string[] = [];

afterEach(async () => {
  while (dirs.length > 0) await removeDirectory(dirs.pop()!);
});

async function directory(label: string): Promise<string> {
  const path = await temporaryDirectory(label);
  dirs.push(path);
  return path;
}

async function stagePackage(store: PublishedPackageStore, label: string, mediaBytes: string): Promise<{
  staging: string;
  manifest: ReturnType<typeof buildDeliveryManifest>;
  files: Array<{ name: string; source_path: string }>;
}> {
  const staging = await store.createStaging(label, "00000000-0000-4000-8000-000000000001");
  const mediaPath = join(staging, PACKAGE_FILES.media);
  await writeFile(mediaPath, mediaBytes, "utf8");
  const probePath = join(staging, PACKAGE_FILES.ffprobe);
  await writeFile(probePath, "{}", "utf8");
  const decodePath = join(staging, PACKAGE_FILES.fullDecode);
  await writeFile(decodePath, "", "utf8");

  const index: PackageIndex = {
    kind: "narralens.delivery_package_index@1.0",
    delivery_id: "d_0123456789abcdef0123456789abcdef",
    project_id: "proj_media_01",
    snapshot_id: "snap_media_01",
    source_digest: "a".repeat(64),
    render_config_digest: "c".repeat(64),
    attempt: 1,
    download_ref: "dl_0123456789abcdef0123456789abcdef",
    files: [
      { id: PACKAGE_REF_IDS.media, file: PACKAGE_FILES.media, sha256: sha256Of(mediaBytes), bytes: Buffer.byteLength(mediaBytes) },
      { id: PACKAGE_REF_IDS.ffprobe, file: PACKAGE_FILES.ffprobe, sha256: sha256Of("{}"), bytes: 2 },
      { id: PACKAGE_REF_IDS.fullDecode, file: PACKAGE_FILES.fullDecode, sha256: sha256Of(""), bytes: 0 },
    ],
  };
  const indexPath = join(staging, PACKAGE_FILES.index);
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");

  const manifest = buildDeliveryManifest({
    delivery_id: "d_0123456789abcdef0123456789abcdef",
    project_id: "proj_media_01",
    snapshot_id: "snap_media_01",
    source_digest: "a".repeat(64),
    render_spec: renderSpec(),
    render_config_digest: "c".repeat(64),
    attempt: 1,
    media_ref: { id: PACKAGE_REF_IDS.media, version: 1, sha256: sha256Of(mediaBytes) },
    ffprobe_ref: { id: PACKAGE_REF_IDS.ffprobe, version: 1, sha256: sha256Of("{}") },
    full_decode_ref: { id: PACKAGE_REF_IDS.fullDecode, version: 1, sha256: sha256Of("") },
    supplement_refs: [],
    qc: [{ id: "media_full_decode", status: "pass", reason: "the whole file decodes", evidence_ref: null }],
    published_at: "2026-11-09T10:00:00.000Z",
    download_ref: "dl_0123456789abcdef0123456789abcdef",
  });
  const manifestPath = join(staging, PACKAGE_FILES.manifest);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return {
    staging,
    manifest,
    files: [
      { name: PACKAGE_FILES.media, source_path: mediaPath },
      { name: PACKAGE_FILES.ffprobe, source_path: probePath },
      { name: PACKAGE_FILES.fullDecode, source_path: decodePath },
      { name: PACKAGE_FILES.index, source_path: indexPath },
    ],
  };
}

describe("publishing a package", () => {
  it("publishes it and reads it back", async () => {
    const root = await directory("store-publish");
    const store = new PublishedPackageStore({ root });
    const staged = await stagePackage(store, "attempt1", "the film");

    const outcome = await store.publish({
      package_id: "pkg_0123456789abcdef0123456789abcdef",
      staging_dir: staged.staging,
      files: staged.files,
      manifest_path: join(staged.staging, PACKAGE_FILES.manifest),
      manifest: staged.manifest,
    });

    expect(outcome.status).toBe("published");
    expect(await store.isPublished("pkg_0123456789abcdef0123456789abcdef")).toBe(true);
    const readBack = await store.readManifest("pkg_0123456789abcdef0123456789abcdef");
    expect(readBack?.delivery_id).toBe(staged.manifest.delivery_id);
  });

  it("publishes into the same place twice and keeps the first package's bytes", async () => {
    const root = await directory("store-twice");
    const store = new PublishedPackageStore({ root });
    const first = await stagePackage(store, "attempt1", "the first film");
    const second = await stagePackage(store, "attempt2", "a different film");

    await store.publish({
      package_id: "pkg_0123456789abcdef0123456789abcdef",
      staging_dir: first.staging,
      files: first.files,
      manifest_path: join(first.staging, PACKAGE_FILES.manifest),
      manifest: first.manifest,
    });
    const secondOutcome = await store.publish({
      package_id: "pkg_0123456789abcdef0123456789abcdef",
      staging_dir: second.staging,
      files: second.files,
      manifest_path: join(second.staging, PACKAGE_FILES.manifest),
      manifest: second.manifest,
    });

    expect(secondOutcome.status).toBe("already_published");
    const publishedMedia = await readFile(
      join(store.directoryOf("pkg_0123456789abcdef0123456789abcdef"), PACKAGE_FILES.media),
      "utf8",
    );
    expect(publishedMedia).toBe("the first film");
  });

  it("lets exactly one of two concurrent attempts publish", async () => {
    const root = await directory("store-concurrent");
    const store = new PublishedPackageStore({ root });
    const first = await stagePackage(store, "attempt1", "the film");
    const second = await stagePackage(store, "attempt2", "the film");

    const publish = async (staged: typeof first) =>
      await store.publish({
        package_id: "pkg_0123456789abcdef0123456789abcdef",
        staging_dir: staged.staging,
        files: staged.files,
        manifest_path: join(staged.staging, PACKAGE_FILES.manifest),
        manifest: staged.manifest,
      });

    const outcomes = await Promise.all([publish(first), publish(second)]);

    const statuses = outcomes.map((outcome) => outcome.status).sort();
    expect(statuses).toEqual(["already_published", "published"]);
    const files = await readdir(store.directoryOf("pkg_0123456789abcdef0123456789abcdef"));
    expect(files.filter((name) => name === PACKAGE_FILES.manifest)).toHaveLength(1);
  });

  it("leaves a name that is taken by something this Host did not publish alone", async () => {
    const root = await directory("store-occupied");
    const store = new PublishedPackageStore({ root });
    await store.prepare();
    const occupied = store.directoryOf("pkg_0123456789abcdef0123456789abcdef");
    await mkdir(occupied, { recursive: true });
    await writeFile(join(occupied, PACKAGE_FILES.media), "half a package", "utf8");

    const staged = await stagePackage(store, "attempt1", "the film");
    await expect(store.publish({
      package_id: "pkg_0123456789abcdef0123456789abcdef",
      staging_dir: staged.staging,
      files: staged.files,
      manifest_path: join(staged.staging, PACKAGE_FILES.manifest),
      manifest: staged.manifest,
    })).rejects.toThrow(/not a published package/);

    const untouched = await readFile(join(occupied, PACKAGE_FILES.media), "utf8");
    expect(untouched).toBe("half a package");
  });

  it("refuses to publish a file that is not inside the staging directory", async () => {
    const root = await directory("store-escape");
    const store = new PublishedPackageStore({ root });
    const staged = await stagePackage(store, "attempt1", "the film");
    const outside = join(root, "outside.bin");
    await writeFile(outside, "not ours", "utf8");

    await expect(store.publish({
      package_id: "pkg_0123456789abcdef0123456789abcdef",
      staging_dir: staged.staging,
      files: [{ name: PACKAGE_FILES.media, source_path: outside }],
      manifest_path: join(staged.staging, PACKAGE_FILES.manifest),
      manifest: staged.manifest,
    })).rejects.toThrow();
  });
});
