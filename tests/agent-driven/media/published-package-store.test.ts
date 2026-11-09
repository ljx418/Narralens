import { mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PublishedPackageStore, PublishedPackageError } from "../../../src/host/delivery/published-package-store.js";
import { buildDeliveryManifest } from "../../../src/host/delivery/manifest.js";
import { PACKAGE_FILES, PACKAGE_ROLES, packageRefId } from "../../../src/host/delivery/package-layout.js";
import { removeDirectory, renderSpec, sha256Of, temporaryDirectory } from "./support.js";

/**
 * The published package store.
 *
 * Module checks for the no-clobber rule (T20-C at the module level): one package per
 * key, nothing overwritten, the canonical path never touched by a loser, an unfinished
 * or malformed receipt failed closed. The concurrent case with two real processes is
 * part of the real T20 acceptance and is `NOT_RUN`.
 */

const dirs: string[] = [];
const PACKAGE_ID = "pkg_0123456789abcdef0123456789abcdef";
const DELIVERY_ID = "d_0123456789abcdef0123456789abcdef";

afterEach(async () => {
  while (dirs.length > 0) await removeDirectory(dirs.pop()!);
});

async function directory(label: string): Promise<string> {
  const path = await temporaryDirectory(label);
  dirs.push(path);
  return path;
}

function manifestFor(mediaBytes: string, attempt = 1) {
  return buildDeliveryManifest({
    delivery_id: DELIVERY_ID,
    project_id: "proj_media_01",
    snapshot_id: "snap_media_01",
    source_digest: "a".repeat(64),
    render_spec: renderSpec(),
    render_config_digest: "c".repeat(64),
    attempt,
    media_ref: { id: packageRefId(DELIVERY_ID, PACKAGE_ROLES.media), version: 1, sha256: sha256Of(mediaBytes) },
    ffprobe_ref: { id: packageRefId(DELIVERY_ID, PACKAGE_ROLES.ffprobe), version: 1, sha256: sha256Of("{}") },
    full_decode_ref: { id: packageRefId(DELIVERY_ID, PACKAGE_ROLES.fullDecode), version: 1, sha256: sha256Of("") },
    supplement_refs: [],
    qc: [{ id: "media_full_decode", status: "pass", reason: "the whole file decodes", evidence_ref: null }],
    published_at: "2026-11-09T10:00:00.000Z",
    download_ref: "dl_0123456789abcdef0123456789abcdef",
  });
}

async function stagePackage(
  store: PublishedPackageStore,
  label: string,
  mediaBytes: string,
): Promise<{ staging: string; manifest: ReturnType<typeof manifestFor>; files: Array<{ id: string; name: string; source_path: string }> }> {
  const staging = await store.createStaging(label, "00000000-0000-4000-8000-000000000001");
  const mediaPath = join(staging, PACKAGE_FILES.media);
  await writeFile(mediaPath, mediaBytes, "utf8");
  const probePath = join(staging, PACKAGE_FILES.ffprobe);
  await writeFile(probePath, "{}", "utf8");
  const decodePath = join(staging, PACKAGE_FILES.fullDecode);
  await writeFile(decodePath, "", "utf8");
  const manifest = manifestFor(mediaBytes);
  return {
    staging,
    manifest,
    files: [
      { id: packageRefId(DELIVERY_ID, PACKAGE_ROLES.media), name: PACKAGE_FILES.media, source_path: mediaPath },
      { id: packageRefId(DELIVERY_ID, PACKAGE_ROLES.ffprobe), name: PACKAGE_FILES.ffprobe, source_path: probePath },
      { id: packageRefId(DELIVERY_ID, PACKAGE_ROLES.fullDecode), name: PACKAGE_FILES.fullDecode, source_path: decodePath },
    ],
  };
}

describe("publishing a package", () => {
  it("rejects staging bytes changed after the manifest was approved", async () => {
    const root = await directory("store-prepublish-tamper");
    const store = new PublishedPackageStore({ root });
    const staged = await stagePackage(store, "attempt1", "the film");
    await writeFile(join(staged.staging, PACKAGE_FILES.media), "bad film");
    await expect(store.publish({
      package_id: PACKAGE_ID, staging_dir: staged.staging, files: staged.files,
      manifest: staged.manifest, published_at: staged.manifest.published_at,
    })).rejects.toThrow(/manifest/);
    expect(await store.readReceipt(PACKAGE_ID)).toBeNull();
  });
  it("publishes a receipt that names a complete object", async () => {
    const root = await directory("store-publish");
    const store = new PublishedPackageStore({ root });
    const staged = await stagePackage(store, "attempt1", "the film");

    const outcome = await store.publish({
      package_id: PACKAGE_ID,
      staging_dir: staged.staging,
      files: staged.files,
      manifest: staged.manifest,
      published_at: "2026-11-09T10:00:00.000Z",
    });

    expect(outcome.status).toBe("published");
    expect(await store.isPublished(PACKAGE_ID)).toBe(true);

    const receipt = await store.readReceipt(PACKAGE_ID);
    expect(receipt?.manifest.delivery_id).toBe(DELIVERY_ID);
    expect(receipt?.files).toHaveLength(3);

    // The object holds the files, and the receipt is the only thing at the canonical
    // path.
    const objectFiles = await readdir(join(root, "objects", outcome.object_id));
    expect(objectFiles.sort()).toEqual([PACKAGE_FILES.fullDecode, PACKAGE_FILES.ffprobe, PACKAGE_FILES.media].sort());
    const published = await readdir(join(root, "published"));
    expect(published).toEqual([PACKAGE_ID]);
  });

  it("publishes into the same place twice and keeps the first package's bytes", async () => {
    const root = await directory("store-twice");
    const store = new PublishedPackageStore({ root });
    const first = await stagePackage(store, "attempt1", "the first film");
    const second = await stagePackage(store, "attempt2", "a different film");

    await store.publish({
      package_id: PACKAGE_ID,
      staging_dir: first.staging,
      files: first.files,
      manifest: first.manifest,
      published_at: "2026-11-09T10:00:00.000Z",
    });
    const secondOutcome = await store.publish({
      package_id: PACKAGE_ID,
      staging_dir: second.staging,
      files: second.files,
      manifest: second.manifest,
      published_at: "2026-11-09T10:00:00.000Z",
    });

    expect(secondOutcome.status).toBe("already_published");
    // The loser removed only its own object, and it never touched the canonical path.
    const receipt = await store.readReceipt(PACKAGE_ID);
    expect(receipt?.object_id).toBeDefined();
    const objects = await readdir(join(root, "objects"));
    expect(objects).toEqual([receipt?.object_id]);
    const media = await readFile(join(root, "objects", receipt?.object_id ?? "", PACKAGE_FILES.media), "utf8");
    expect(media).toBe("the first film");
  });

  it("lets exactly one of two concurrent attempts publish, without the loser touching the winner", async () => {
    const root = await directory("store-concurrent");
    const store = new PublishedPackageStore({ root });
    const first = await stagePackage(store, "attempt1", "the film");
    const second = await stagePackage(store, "attempt2", "the film");

    const publish = async (staged: typeof first) =>
      await store.publish({
        package_id: PACKAGE_ID,
        staging_dir: staged.staging,
        files: staged.files,
        manifest: staged.manifest,
        published_at: "2026-11-09T10:00:00.000Z",
      });

    const outcomes = await Promise.all([publish(first), publish(second)]);

    const statuses = outcomes.map((outcome) => outcome.status).sort();
    expect(statuses).toEqual(["already_published", "published"]);
    // One object survives: the winner's. The loser's object was its own and was
    // removed; the canonical path was never replaced.
    const objects = await readdir(join(root, "objects"));
    expect(objects).toHaveLength(1);
    const published = await readdir(join(root, "published"));
    expect(published).toEqual([PACKAGE_ID]);
  });

  it("does not touch the canonical path when the loser arrives while the winner publishes", async () => {
    const root = await directory("store-barrier");
    let release: () => void = () => { throw new Error("barrier not initialized"); };
    const waiting = new Promise<void>((resolvePromise) => { release = resolvePromise; });
    let held = false;
    const store = new PublishedPackageStore({
      root,
      // The first publication is held exactly where it matters: between the complete
      // object and the receipt that publishes it.
      before_publish_link: async () => {
        if (held) return;
        held = true;
        await waiting;
      },
    });
    const first = await stagePackage(store, "attempt1", "the film");
    const second = await stagePackage(store, "attempt2", "the film");

    const publish = async (staged: typeof first) =>
      await store.publish({
        package_id: PACKAGE_ID,
        staging_dir: staged.staging,
        files: staged.files,
        manifest: staged.manifest,
        published_at: "2026-11-09T10:00:00.000Z",
      });

    const firstPublish = publish(first);
    // Let the first one reach the barrier, then let the second one through.
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    const secondOutcome = await publish(second);
    release();
    const firstOutcome = await firstPublish;

    expect(secondOutcome.status).toBe("published");
    expect(firstOutcome.status).toBe("already_published");
    // The canonical path holds the receipt of the attempt that published it, and the
    // attempt that lost removed only its own object.
    const receipt = await store.readReceipt(PACKAGE_ID);
    expect(receipt?.object_id).toBe(secondOutcome.object_id);
    const objects = await readdir(join(root, "objects"));
    expect(objects).toEqual([secondOutcome.object_id]);
  });

  it("keeps the package when the directory cannot be made durable after the receipt is linked", async () => {
    const root = await directory("store-post-link-sync");
    const store = new PublishedPackageStore({
      root,
      // The receipt is linked before the published directory is synced. A failure there
      // must not take the package away: the canonical receipt names it.
      sync_directory: async (path: string) => {
        if (path.endsWith("published")) throw new Error("the disk said no, after the link");
      },
    });
    const staged = await stagePackage(store, "attempt1", "the film");

    await expect(store.publish({
      package_id: PACKAGE_ID,
      staging_dir: staged.staging,
      files: staged.files,
      manifest: staged.manifest,
      published_at: "2026-11-09T10:00:00.000Z",
    })).rejects.toThrow(/the disk said no/);

    // The receipt is there and it is complete: the package exists.
    const receipt = await store.readReceipt(PACKAGE_ID);
    expect(receipt?.manifest.delivery_id).toBe(DELIVERY_ID);
    const verified = await store.verifyPackage(PACKAGE_ID);
    expect(verified?.object_id).toBe(receipt?.object_id);
    const media = await readFile(join(root, "objects", receipt?.object_id ?? "", PACKAGE_FILES.media), "utf8");
    expect(media).toBe("the film");
  });

  it("does not overwrite a package when a later attempt retries the same key", async () => {
    const root = await directory("store-retry");
    const store = new PublishedPackageStore({ root });
    const first = await stagePackage(store, "attempt1", "the first film");
    const second = await stagePackage(store, "attempt2", "a different film");

    await store.publish({
      package_id: PACKAGE_ID,
      staging_dir: first.staging,
      files: first.files,
      manifest: first.manifest,
      published_at: "2026-11-09T10:00:00.000Z",
    });
    const receiptBefore = await store.readReceipt(PACKAGE_ID);

    const retried = await store.publish({
      package_id: PACKAGE_ID,
      staging_dir: second.staging,
      files: second.files,
      manifest: second.manifest,
      published_at: "2026-11-09T10:00:00.000Z",
    });

    expect(retried.status).toBe("already_published");
    const receiptAfter = await store.readReceipt(PACKAGE_ID);
    expect(receiptAfter?.object_id).toBe(receiptBefore?.object_id);
    const media = await readFile(join(root, "objects", receiptAfter?.object_id ?? "", PACKAGE_FILES.media), "utf8");
    expect(media).toBe("the first film");
  });

  it("refuses an object directory that is already there, and leaves it alone", async () => {
    const root = await directory("store-object-taken");
    let identity = 0;
    const store = new PublishedPackageStore({
      root,
      // The same identity twice: the second attempt must find the directory taken and
      // must not take it over.
      object_identity: () => `obj_fixed_${identity++}`,
    });
    await store.prepare();
    const occupied = join(root, "objects", "obj_fixed_0");
    await mkdir(occupied, { recursive: true });
    await writeFile(join(occupied, "somebody-elses-file"), "not ours", "utf8");

    const staged = await stagePackage(store, "attempt1", "the film");
    await expect(store.publish({
      package_id: PACKAGE_ID,
      staging_dir: staged.staging,
      files: staged.files,
      manifest: staged.manifest,
      published_at: "2026-11-09T10:00:00.000Z",
    })).rejects.toThrow(/already exists/);

    // The directory that was there is untouched.
    expect(await readFile(join(occupied, "somebody-elses-file"), "utf8")).toBe("not ours");
    expect(await store.isPublished(PACKAGE_ID)).toBe(false);
  });

  it("refuses a staging directory that is already there", async () => {
    const root = await directory("store-staging-taken");
    const store = new PublishedPackageStore({ root });
    const first = await store.createStaging("attempt1", "the-same-identity");
    expect(first.endsWith("attempt1-the-same-identity")).toBe(true);
    await expect(store.createStaging("attempt1", "the-same-identity")).rejects.toThrow(/already exists/);
  });

  it("does not publish when a directory cannot be made durable", async () => {
    const root = await directory("store-sync-failure");
    const store = new PublishedPackageStore({
      root,
      sync_directory: async () => { throw new Error("the disk said no"); },
    });
    const staged = await stagePackage(store, "attempt1", "the film");

    await expect(store.publish({
      package_id: PACKAGE_ID,
      staging_dir: staged.staging,
      files: staged.files,
      manifest: staged.manifest,
      published_at: "2026-11-09T10:00:00.000Z",
    })).rejects.toThrow(/the disk said no/);

    // Nothing was published: the failure happened before the receipt was linked.
    expect(await store.isPublished(PACKAGE_ID)).toBe(false);
    expect(await readdir(join(root, "published"))).toEqual([]);
  });

  it("fails closed on a name that is taken by a malformed receipt, and leaves it alone", async () => {
    const root = await directory("store-malformed");
    const store = new PublishedPackageStore({ root });
    await store.prepare();
    const canonical = join(root, "published", PACKAGE_ID);
    await writeFile(canonical, "this is not a receipt", "utf8");

    const staged = await stagePackage(store, "attempt1", "the film");
    await expect(store.publish({
      package_id: PACKAGE_ID,
      staging_dir: staged.staging,
      files: staged.files,
      manifest: staged.manifest,
      published_at: "2026-11-09T10:00:00.000Z",
    })).rejects.toThrow(PublishedPackageError);

    expect(await readFile(canonical, "utf8")).toBe("this is not a receipt");
  });

  it("fails closed when the name is taken by a receipt of another delivery", async () => {
    const root = await directory("store-conflict");
    const store = new PublishedPackageStore({ root });
    const other = await stagePackage(store, "attempt-other", "another film's bytes");
    const otherManifest = buildDeliveryManifest({
      delivery_id: "d_ffffffffffffffffffffffffffffffff",
      project_id: "proj_media_02",
      snapshot_id: "snap_media_02",
      source_digest: "b".repeat(64),
      render_spec: renderSpec(),
      render_config_digest: "d".repeat(64),
      attempt: 1,
      media_ref: { id: packageRefId("d_ffffffffffffffffffffffffffffffff", PACKAGE_ROLES.media), version: 1, sha256: sha256Of("another film's bytes") },
      ffprobe_ref: { id: packageRefId("d_ffffffffffffffffffffffffffffffff", PACKAGE_ROLES.ffprobe), version: 1, sha256: sha256Of("{}") },
      full_decode_ref: { id: packageRefId("d_ffffffffffffffffffffffffffffffff", PACKAGE_ROLES.fullDecode), version: 1, sha256: sha256Of("") },
      supplement_refs: [],
      qc: [{ id: "media_full_decode", status: "pass", reason: "the whole file decodes", evidence_ref: null }],
      published_at: "2026-11-09T10:00:00.000Z",
      download_ref: "dl_ffffffffffffffffffffffffffffffff",
    });
    await store.publish({
      package_id: PACKAGE_ID,
      staging_dir: other.staging,
      files: other.files.map((file) => ({ ...file, id: file.id.replace(DELIVERY_ID, otherManifest.delivery_id) })),
      manifest: otherManifest,
      published_at: "2026-11-09T10:00:00.000Z",
    });

    const staged = await stagePackage(store, "attempt1", "the film");
    await expect(store.publish({
      package_id: PACKAGE_ID,
      staging_dir: staged.staging,
      files: staged.files,
      manifest: staged.manifest,
      published_at: "2026-11-09T10:00:00.000Z",
    })).rejects.toThrow(/another project/);

    const receipt = await store.readReceipt(PACKAGE_ID);
    expect(receipt?.project_id).toBe("proj_media_02");
  });

  it("refuses to publish a file that is not inside the staging directory", async () => {
    const root = await directory("store-escape");
    const store = new PublishedPackageStore({ root });
    const staged = await stagePackage(store, "attempt1", "the film");
    const outside = join(root, "outside.bin");
    await writeFile(outside, "not ours", "utf8");

    await expect(store.publish({
      package_id: PACKAGE_ID,
      staging_dir: staged.staging,
      files: [{ id: "x", name: PACKAGE_FILES.media, source_path: outside }],
      manifest: staged.manifest,
      published_at: "2026-11-09T10:00:00.000Z",
    })).rejects.toThrow(PublishedPackageError);
  });
});

describe("verifying a published package", () => {
  it("accepts a package that matches its receipt", async () => {
    const root = await directory("store-verify");
    const store = new PublishedPackageStore({ root });
    const staged = await stagePackage(store, "attempt1", "the film");
    await store.publish({
      package_id: PACKAGE_ID,
      staging_dir: staged.staging,
      files: staged.files,
      manifest: staged.manifest,
      published_at: "2026-11-09T10:00:00.000Z",
    });

    const verified = await store.verifyPackage(PACKAGE_ID);
    expect(verified?.object_id).toBeDefined();
  });

  it("notices a file that was changed after it was published", async () => {
    const root = await directory("store-tampered");
    const store = new PublishedPackageStore({ root });
    const staged = await stagePackage(store, "attempt1", "the film");
    await store.publish({
      package_id: PACKAGE_ID,
      staging_dir: staged.staging,
      files: staged.files,
      manifest: staged.manifest,
      published_at: "2026-11-09T10:00:00.000Z",
    });

    const receipt = await store.readReceipt(PACKAGE_ID);
    // Same byte length forces the digest check, rather than only the size check.
    await writeFile(join(root, "objects", receipt?.object_id ?? "", PACKAGE_FILES.media), "bad film", "utf8");
    await expect(store.verifyPackage(PACKAGE_ID)).rejects.toThrow(/digest/);
  });

  it("refuses a file that is a link rather than the file the receipt names", async () => {
    const root = await directory("store-link");
    const store = new PublishedPackageStore({ root });
    const staged = await stagePackage(store, "attempt1", "the film");
    await store.publish({
      package_id: PACKAGE_ID,
      staging_dir: staged.staging,
      files: staged.files,
      manifest: staged.manifest,
      published_at: "2026-11-09T10:00:00.000Z",
    });

    const receipt = await store.readReceipt(PACKAGE_ID);
    const mediaPath = join(root, "objects", receipt?.object_id ?? "", PACKAGE_FILES.media);
    const elsewhere = join(root, "elsewhere.mp4");
    await writeFile(elsewhere, "the film", "utf8");
    await rm(mediaPath);
    await symlink(elsewhere, mediaPath);
    await expect(store.verifyPackage(PACKAGE_ID)).rejects.toThrow(/missing/);
  });

  it("notices a file that is not there at all", async () => {
    const root = await directory("store-missing");
    const store = new PublishedPackageStore({ root });
    const staged = await stagePackage(store, "attempt1", "the film");
    await store.publish({
      package_id: PACKAGE_ID,
      staging_dir: staged.staging,
      files: staged.files,
      manifest: staged.manifest,
      published_at: "2026-11-09T10:00:00.000Z",
    });

    const receipt = await store.readReceipt(PACKAGE_ID);
    await rm(join(root, "objects", receipt?.object_id ?? "", PACKAGE_FILES.media), { force: true });
    await expect(store.verifyPackage(PACKAGE_ID)).rejects.toThrow(/missing/);
  });
});
