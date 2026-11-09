import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DeliveryService, type DeliveryRecord, type DeliveryRecordPort } from "../../../src/host/delivery/delivery-service.js";
import { PublishedPackageStore } from "../../../src/host/delivery/published-package-store.js";
import { buildDeliveryManifest } from "../../../src/host/delivery/manifest.js";
import { PACKAGE_FILES, PACKAGE_ROLES, packageRefId } from "../../../src/host/delivery/package-layout.js";
import { removeDirectory, renderSpec, sha256Of, temporaryDirectory } from "./support.js";

/**
 * The delivery read model.
 *
 * Module checks for the rule that a read never renders and never publishes, and for
 * the rule that bytes are served only when MAIN's durable record says the delivery is
 * ready and describes exactly the package that was published.
 */

const dirs: string[] = [];
const MEDIA = "the film bytes";
const DELIVERY_ID = "d_0123456789abcdef0123456789abcdef";
const PACKAGE_ID = "pkg_0123456789abcdef0123456789abcdef";
const DOWNLOAD_REF = "dl_0123456789abcdef0123456789abcdef";

afterEach(async () => {
  while (dirs.length > 0) await removeDirectory(dirs.pop()!);
});

async function directory(label: string): Promise<string> {
  const path = await temporaryDirectory(label);
  dirs.push(path);
  return path;
}

function manifestOf() {
  return buildDeliveryManifest({
    delivery_id: DELIVERY_ID,
    project_id: "proj_media_01",
    snapshot_id: "snap_media_01",
    source_digest: "a".repeat(64),
    render_spec: renderSpec(),
    render_config_digest: "c".repeat(64),
    attempt: 1,
    media_ref: { id: packageRefId(DELIVERY_ID, PACKAGE_ROLES.media), version: 1, sha256: sha256Of(MEDIA) },
    ffprobe_ref: { id: packageRefId(DELIVERY_ID, PACKAGE_ROLES.ffprobe), version: 1, sha256: sha256Of("{}") },
    full_decode_ref: { id: packageRefId(DELIVERY_ID, PACKAGE_ROLES.fullDecode), version: 1, sha256: sha256Of("") },
    supplement_refs: [],
    qc: [{ id: "media_full_decode", status: "pass", reason: "the whole file decodes", evidence_ref: null }],
    published_at: "2026-11-09T10:00:00.000Z",
    download_ref: DOWNLOAD_REF,
  });
}

async function publishPackage(store: PublishedPackageStore): Promise<void> {
  const staging = await store.createStaging("attempt1", "00000000-0000-4000-8000-000000000003");
  const mediaPath = join(staging, PACKAGE_FILES.media);
  await writeFile(mediaPath, MEDIA, "utf8");
  const probePath = join(staging, PACKAGE_FILES.ffprobe);
  await writeFile(probePath, "{}", "utf8");
  const decodePath = join(staging, PACKAGE_FILES.fullDecode);
  await writeFile(decodePath, "", "utf8");
  await store.publish({
    package_id: PACKAGE_ID,
    staging_dir: staging,
    object_id: "obj_one",
    files: [
      { id: packageRefId(DELIVERY_ID, PACKAGE_ROLES.media), name: PACKAGE_FILES.media, source_path: mediaPath },
      { id: packageRefId(DELIVERY_ID, PACKAGE_ROLES.ffprobe), name: PACKAGE_FILES.ffprobe, source_path: probePath },
      { id: packageRefId(DELIVERY_ID, PACKAGE_ROLES.fullDecode), name: PACKAGE_FILES.fullDecode, source_path: decodePath },
    ],
    manifest: manifestOf(),
    published_at: "2026-11-09T10:00:00.000Z",
  });
}

function recordOf(overrides: Partial<DeliveryRecord> = {}): DeliveryRecord {
  return {
    project_id: "proj_media_01",
    job_id: "job_media_01",
    snapshot_id: "snap_media_01",
    state: "ready",
    qc: "passed",
    artifact_ref: { id: packageRefId(DELIVERY_ID, PACKAGE_ROLES.media), version: 1, sha256: sha256Of(MEDIA) },
    download_ref: DOWNLOAD_REF,
    manifest: manifestOf(),
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
    expect(delivery?.manifest?.delivery_id).toBe(DELIVERY_ID);
    expect(delivery?.download_ref).toBe(DOWNLOAD_REF);
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
    await packages.prepare();
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

describe("downloading a delivery", () => {
  it("serves the bytes of a delivery MAIN says is ready", async () => {
    const root = await directory("download-ready");
    const packages = new PublishedPackageStore({ root });
    await publishPackage(packages);
    const records: DeliveryRecordPort = { async readDelivery() { return recordOf(); } };
    const service = new DeliveryService({ records, packages });

    const response = await service.download({
      project_id: "proj_media_01",
      job_id: "job_media_01",
      download_ref: DOWNLOAD_REF,
      range_header: undefined,
    });
    expect(response?.status).toBe(200);
    await response?.close();
  });

  it("serves nothing when MAIN has not recorded the delivery as ready", async () => {
    const root = await directory("download-not-ready");
    const packages = new PublishedPackageStore({ root });
    await publishPackage(packages);
    const records: DeliveryRecordPort = {
      async readDelivery() { return recordOf({ state: "preparing", qc: "pending", manifest: null, download_ref: null, artifact_ref: null }); },
    };
    const service = new DeliveryService({ records, packages });

    expect(await service.download({
      project_id: "proj_media_01",
      job_id: "job_media_01",
      download_ref: DOWNLOAD_REF,
      range_header: undefined,
    })).toBeNull();
  });

  it("serves nothing when the record describes another delivery", async () => {
    const root = await directory("download-mismatch");
    const packages = new PublishedPackageStore({ root });
    await publishPackage(packages);
    const other = manifestOf();
    const records: DeliveryRecordPort = {
      async readDelivery() { return recordOf({ manifest: { ...other, attempt: 2 } }); },
    };
    const service = new DeliveryService({ records, packages });

    expect(await service.download({
      project_id: "proj_media_01",
      job_id: "job_media_01",
      download_ref: DOWNLOAD_REF,
      range_header: undefined,
    })).toBeNull();
  });

  it("serves nothing when there is no record at all", async () => {
    const root = await directory("download-no-record");
    const packages = new PublishedPackageStore({ root });
    await publishPackage(packages);
    const records: DeliveryRecordPort = { async readDelivery() { return null; } };
    const service = new DeliveryService({ records, packages });

    expect(await service.download({
      project_id: "proj_media_01",
      job_id: "job_media_01",
      download_ref: DOWNLOAD_REF,
      range_header: undefined,
    })).toBeNull();
  });
});
