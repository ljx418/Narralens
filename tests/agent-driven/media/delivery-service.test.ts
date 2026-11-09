import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DeliveryService, type DeliveryRecord, type DeliveryRecordPort } from "../../../src/host/delivery/delivery-service.js";
import { PublishedPackageStore } from "../../../src/host/delivery/published-package-store.js";
import { buildDeliveryManifest } from "../../../src/host/delivery/manifest.js";
import { PACKAGE_FILES, PACKAGE_REF_IDS, type PackageIndex } from "../../../src/host/delivery/package-layout.js";
import { removeDirectory, renderSpec, sha256Of, temporaryDirectory } from "./support.js";

/**
 * The delivery read model.
 *
 * Module checks for the rule that a read never renders and never publishes: the
 * service has no renderer and no writer, and a read of a delivery that was recorded as
 * ready but whose package is not published is reported as the contradiction it is.
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

const MEDIA = "the film bytes";

async function publishPackage(store: PublishedPackageStore): Promise<void> {
  const staging = await store.createStaging("attempt1", "00000000-0000-4000-8000-000000000003");
  const mediaPath = join(staging, PACKAGE_FILES.media);
  await writeFile(mediaPath, MEDIA, "utf8");
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
      { id: PACKAGE_REF_IDS.media, file: PACKAGE_FILES.media, sha256: sha256Of(MEDIA), bytes: Buffer.byteLength(MEDIA) },
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
    media_ref: { id: PACKAGE_REF_IDS.media, version: 1, sha256: sha256Of(MEDIA) },
    ffprobe_ref: { id: PACKAGE_REF_IDS.ffprobe, version: 1, sha256: sha256Of("{}") },
    full_decode_ref: { id: PACKAGE_REF_IDS.fullDecode, version: 1, sha256: sha256Of("") },
    supplement_refs: [],
    qc: [{ id: "media_full_decode", status: "pass", reason: "the whole file decodes", evidence_ref: null }],
    published_at: "2026-11-09T10:00:00.000Z",
    download_ref: "dl_0123456789abcdef0123456789abcdef",
  });
  const manifestPath = join(staging, PACKAGE_FILES.manifest);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await store.publish({
    package_id: "pkg_0123456789abcdef0123456789abcdef",
    staging_dir: staging,
    files: [
      { name: PACKAGE_FILES.media, source_path: mediaPath },
      { name: PACKAGE_FILES.ffprobe, source_path: probePath },
      { name: PACKAGE_FILES.fullDecode, source_path: decodePath },
      { name: PACKAGE_FILES.index, source_path: indexPath },
    ],
    manifest_path: manifestPath,
    manifest,
  });
}

function recordOf(overrides: Partial<DeliveryRecord> = {}): DeliveryRecord {
  return {
    project_id: "proj_media_01",
    job_id: "job_media_01",
    snapshot_id: "snap_media_01",
    state: "ready",
    qc: "passed",
    artifact_ref: { id: PACKAGE_REF_IDS.media, version: 1, sha256: sha256Of(MEDIA) },
    download_ref: "dl_0123456789abcdef0123456789abcdef",
    manifest: buildDeliveryManifest({
      delivery_id: "d_0123456789abcdef0123456789abcdef",
      project_id: "proj_media_01",
      snapshot_id: "snap_media_01",
      source_digest: "a".repeat(64),
      render_spec: renderSpec(),
      render_config_digest: "c".repeat(64),
      attempt: 1,
      media_ref: { id: PACKAGE_REF_IDS.media, version: 1, sha256: sha256Of(MEDIA) },
      ffprobe_ref: { id: PACKAGE_REF_IDS.ffprobe, version: 1, sha256: sha256Of("{}") },
      full_decode_ref: { id: PACKAGE_REF_IDS.fullDecode, version: 1, sha256: sha256Of("") },
      supplement_refs: [],
      qc: [{ id: "media_full_decode", status: "pass", reason: "the whole file decodes", evidence_ref: null }],
      published_at: "2026-11-09T10:00:00.000Z",
      download_ref: "dl_0123456789abcdef0123456789abcdef",
    }),
    ...overrides,
  };
}

describe("reading a delivery", () => {
  it("projects the stored record onto the contract's DTO", async () => {
    const root = await directory("delivery-read");
    const packages = new PublishedPackageStore({ root });
    await publishPackage(packages);
    const records: DeliveryRecordPort = { async readDelivery() { return recordOf(); } };
    const service = new DeliveryService({ records, packages });

    const delivery = await service.read({ project_id: "proj_media_01", job_id: "job_media_01" });
    expect(delivery?.state).toBe("ready");
    expect(delivery?.qc).toBe("passed");
    expect(delivery?.manifest?.delivery_id).toBe("d_0123456789abcdef0123456789abcdef");
    expect(delivery?.download_ref).toBe("dl_0123456789abcdef0123456789abcdef");
  });

  it("answers null for a job that has no delivery", async () => {
    const root = await directory("delivery-none");
    const packages = new PublishedPackageStore({ root });
    const records: DeliveryRecordPort = { async readDelivery() { return null; } };
    const service = new DeliveryService({ records, packages });

    expect(await service.read({ project_id: "proj_media_01", job_id: "job_media_01" })).toBeNull();
  });

  it("does not answer for another project's job", async () => {
    const root = await directory("delivery-other");
    const packages = new PublishedPackageStore({ root });
    await publishPackage(packages);
    const records: DeliveryRecordPort = { async readDelivery() { return recordOf(); } };
    const service = new DeliveryService({ records, packages });

    expect(await service.read({ project_id: "proj_media_02", job_id: "job_media_01" })).toBeNull();
  });

  it("reports a delivery that was recorded as ready but has no package", async () => {
    const root = await directory("delivery-contradiction");
    const packages = new PublishedPackageStore({ root });
    await mkdir(packages.publishedDir, { recursive: true });
    const records: DeliveryRecordPort = { async readDelivery() { return recordOf(); } };
    const service = new DeliveryService({ records, packages });

    await expect(service.read({ project_id: "proj_media_01", job_id: "job_media_01" }))
      .rejects.toThrow(/not published/);
  });

  it("reads twice and answers the same thing", async () => {
    const root = await directory("delivery-twice");
    const packages = new PublishedPackageStore({ root });
    await publishPackage(packages);
    const records: DeliveryRecordPort = { async readDelivery() { return recordOf(); } };
    const service = new DeliveryService({ records, packages });

    const first = await service.read({ project_id: "proj_media_01", job_id: "job_media_01" });
    const second = await service.read({ project_id: "proj_media_01", job_id: "job_media_01" });
    expect(first?.manifest?.media_ref.sha256).toBe(second?.manifest?.media_ref.sha256);
  });
});
