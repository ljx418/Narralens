import { describe, expect, it } from "vitest";
import {
  assertManifestMatches,
  buildDelivery,
  buildDeliveryManifest,
  DeliveryContractError,
  validateDeliveryManifest,
} from "../../../src/host/delivery/manifest.js";
import type { QCItem } from "../../../src/contracts/agent-driven-types.js";
import { renderSpec } from "./support.js";

/**
 * The delivery manifest and the delivery DTO.
 *
 * Module checks against the *frozen* runtime schema: the manifest is not a description
 * of the contract's manifest, it is the contract's manifest, and the schema is what
 * says so.
 */

const PASSING_QC: QCItem[] = [
  { id: "media_container", status: "pass", reason: "the container is mp4", evidence_ref: null },
  { id: "media_full_decode", status: "pass", reason: "the whole file decodes", evidence_ref: null },
];

function manifest() {
  return buildDeliveryManifest({
    delivery_id: "d_0123456789abcdef0123456789abcdef",
    project_id: "proj_media_01",
    snapshot_id: "snap_media_01",
    source_digest: "a".repeat(64),
    render_spec: renderSpec(),
    render_config_digest: "c".repeat(64),
    attempt: 3,
    media_ref: { id: "media", version: 1, sha256: "d".repeat(64) },
    ffprobe_ref: { id: "ffprobe", version: 1, sha256: "e".repeat(64) },
    full_decode_ref: { id: "full_decode", version: 1, sha256: "f".repeat(64) },
    supplement_refs: [{ id: "supplement_0", version: 1, sha256: "1".repeat(64) }],
    qc: PASSING_QC,
    published_at: "2026-11-09T10:00:00.000Z",
    download_ref: "dl_0123456789abcdef0123456789abcdef",
  });
}

describe("the delivery manifest", () => {
  it("is the contract's manifest", () => {
    const built = manifest();
    expect(built.delivery_id).toBe("d_0123456789abcdef0123456789abcdef");
    expect(() => validateDeliveryManifest(built)).not.toThrow();
    expect(built.qc).toHaveLength(2);
  });

  it("refuses a manifest with an unknown field", () => {
    const built = { ...manifest(), extra: "no" } as unknown;
    expect(() => validateDeliveryManifest(built)).toThrow(DeliveryContractError);
  });

  it("refuses a manifest whose id does not fit the contract's pattern", () => {
    const built = { ...manifest(), delivery_id: "not a delivery id" } as unknown;
    expect(() => validateDeliveryManifest(built)).toThrow(DeliveryContractError);
  });

  it("refuses a manifest whose digest is not a digest", () => {
    const built = { ...manifest(), source_digest: "not-a-digest" } as unknown;
    expect(() => validateDeliveryManifest(built)).toThrow(DeliveryContractError);
  });

  it("refuses a manifest that names another project, snapshot or attempt", () => {
    const built = manifest();
    const expected = {
      project_id: built.project_id,
      snapshot_id: built.snapshot_id,
      source_digest: built.source_digest,
      render_config_digest: built.render_config_digest,
      attempt: built.attempt,
    };
    expect(() => assertManifestMatches(built, expected)).not.toThrow();
    expect(() => assertManifestMatches(built, { ...expected, project_id: "other" })).toThrow(DeliveryContractError);
    expect(() => assertManifestMatches(built, { ...expected, snapshot_id: "other" })).toThrow(DeliveryContractError);
    expect(() => assertManifestMatches(built, { ...expected, attempt: 4 })).toThrow(DeliveryContractError);
    expect(() => assertManifestMatches(built, { ...expected, render_config_digest: "9".repeat(64) })).toThrow(DeliveryContractError);
  });

  it("refuses a manifest that carries a blocked check", () => {
    const built = buildDeliveryManifest({
      delivery_id: "d_0123456789abcdef0123456789abcdef",
      project_id: "proj_media_01",
      snapshot_id: "snap_media_01",
      source_digest: "a".repeat(64),
      render_spec: renderSpec(),
      render_config_digest: "c".repeat(64),
      attempt: 1,
      media_ref: { id: "media", version: 1, sha256: "d".repeat(64) },
      ffprobe_ref: { id: "ffprobe", version: 1, sha256: "e".repeat(64) },
      full_decode_ref: { id: "full_decode", version: 1, sha256: "f".repeat(64) },
      supplement_refs: [],
      qc: [...PASSING_QC, { id: "supplements", status: "block", reason: "a supplement was changed", evidence_ref: null }],
      published_at: "2026-11-09T10:00:00.000Z",
      download_ref: "dl_0123456789abcdef0123456789abcdef",
    });
    expect(() => assertManifestMatches(built, {
      project_id: built.project_id,
      snapshot_id: built.snapshot_id,
      source_digest: built.source_digest,
      render_config_digest: built.render_config_digest,
      attempt: built.attempt,
    })).toThrow(DeliveryContractError);
  });
});

describe("the delivery DTO", () => {
  it("accepts a ready delivery that carries everything it must", () => {
    const built = manifest();
    const delivery = buildDelivery({
      project_id: built.project_id,
      snapshot_id: built.snapshot_id,
      job_id: "job_media_01",
      state: "ready",
      artifact_ref: built.media_ref,
      qc: "passed",
      download_ref: built.download_ref,
      manifest: built,
    });
    expect(delivery.state).toBe("ready");
    expect(delivery.manifest?.delivery_id).toBe(built.delivery_id);
  });

  it("refuses a ready delivery without a manifest", () => {
    expect(() => buildDelivery({
      project_id: "proj_media_01",
      snapshot_id: "snap_media_01",
      job_id: "job_media_01",
      state: "ready",
      artifact_ref: { id: "media", version: 1, sha256: "d".repeat(64) },
      qc: "passed",
      download_ref: "dl_0123456789abcdef0123456789abcdef",
      manifest: null,
    })).toThrow(DeliveryContractError);
  });

  it("refuses a ready delivery whose quality control has not passed", () => {
    const built = manifest();
    expect(() => buildDelivery({
      project_id: built.project_id,
      snapshot_id: built.snapshot_id,
      job_id: "job_media_01",
      state: "ready",
      artifact_ref: built.media_ref,
      qc: "pending",
      download_ref: built.download_ref,
      manifest: built,
    })).toThrow(DeliveryContractError);
  });

  it("accepts a delivery that is still preparing", () => {
    const delivery = buildDelivery({
      project_id: "proj_media_01",
      snapshot_id: "snap_media_01",
      job_id: "job_media_01",
      state: "preparing",
      artifact_ref: null,
      qc: "pending",
      download_ref: null,
      manifest: null,
    });
    expect(delivery.state).toBe("preparing");
  });
});
