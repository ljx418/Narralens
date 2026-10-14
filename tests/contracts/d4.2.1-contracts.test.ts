import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contractIds, validatorFor } from "../../src/contracts/validator.js";

const sha = "a".repeat(64);
const license = { status: "cleared", label: "自有素材", commercial_use: true } as const;
const v1Asset = {
  asset_id: "asset_original", project_path: "media/original.mp4", sha256: sha,
  media_type: "video/mp4", kind: "video", duration_frames: 30,
  source: { kind: "owned", label: "本地素材" }, license,
} as const;

describe("D4.2.1 runtime contracts", () => {
  it("registers exactly the four stage contracts and keeps later-stage contracts absent", () => {
    expect(validatorFor(contractIds.assetImportMetadata)).toBeTypeOf("function");
    expect(validatorFor(contractIds.assetManifest)).toBeTypeOf("function");
    expect(validatorFor(contractIds.assetImportResponse)).toBeTypeOf("function");
    expect(validatorFor(contractIds.assetInventoryResponse)).toBeTypeOf("function");
    expect(Object.keys(contractIds)).not.toContain("materializeRequest");
    expect(Object.keys(contractIds)).not.toContain("materializedProposal");
    expect(Object.keys(contractIds)).not.toContain("adoptMaterializedProposal");
  });

  it("pins the four runtime schema bytes reviewed for this implementation step", () => {
    const expected = {
      "asset-import-metadata.schema.json": "0b1b8f0edb4845f93ac8f166b90076d29bcf165c48449bda0103df15523f77d0",
      "asset-manifest.schema.json": "97fe0b86fcd02a035348f38081a1673318f61e2ae1a4b378993ab8d80c769a21",
      "asset-import-response.schema.json": "155df604c849a7644aa91d2a9a1edd99927cbe0a67fb8ba8bb9de37564d9f949",
      "asset-inventory-response.schema.json": "90232b3b18022ccbaa9256c24d55cbc5d43d558e391b6dbd5ce0385201bbc728",
    } as const;
    for (const [file, digest] of Object.entries(expected)) {
      const bytes = readFileSync(new URL(`../../contracts/${file}`, import.meta.url));
      expect(createHash("sha256").update(bytes).digest("hex"), file).toBe(digest);
    }
  });

  it("accepts strict import metadata and rejects derived, non-http URI, cleared non-commercial, and extras", () => {
    const validate = validatorFor(contractIds.assetImportMetadata);
    const valid = { idempotency_key: "import:test:001", source: { kind: "owned", label: "自有素材", uri: "https://example.test/source" }, license };
    expect(validate(valid)).toBe(true);
    expect(validate({ ...valid, source: { kind: "derived", label: "派生", lineage: [sha] } })).toBe(false);
    expect(validate({ ...valid, source: { kind: "owned", label: "旧地址", uri: "urn:legacy:asset" } })).toBe(false);
    expect(validate({ ...valid, license: { ...license, commercial_use: false } })).toBe(false);
    expect(validate({ ...valid, project_path: "C:/secret.mp4" })).toBe(false);
  });

  it("accepts @1 and @2 manifests without making the union ambiguous", () => {
    const validate = validatorFor(contractIds.assetManifest);
    expect(validate({ format: "narralens.asset-manifest@1", assets: [v1Asset] })).toBe(true);
    expect(validate({ format: "narralens.asset-manifest@2", assets: [v1Asset] })).toBe(true);
    const derived = { ...v1Asset, asset_id: "asset_derived", source: { kind: "derived", label: "确定性合成", lineage: [sha] } };
    expect(validate({ format: "narralens.asset-manifest@2", assets: [derived] })).toBe(true);
    expect(validate({ format: "narralens.asset-manifest@1", assets: [derived] })).toBe(false);
    expect(validate({ format: "narralens.asset-manifest@2", assets: [{ ...derived, license: { ...license, status: "restricted" } }] })).toBe(false);
  });

  it("validates public responses without allowing project paths", () => {
    const importResponse = { format: "narralens.asset-import-response@1.0", asset_id: "asset_original",
      manifest_format: "narralens.asset-manifest@2", manifest_sha256: sha, created: true, migrated_from_v1: true };
    expect(validatorFor(contractIds.assetImportResponse)(importResponse)).toBe(true);
    const v1DuplicateResponse = { ...importResponse,
      manifest_format: "narralens.asset-manifest@1", created: false, migrated_from_v1: false };
    expect(validatorFor(contractIds.assetImportResponse)(v1DuplicateResponse)).toBe(true);
    expect(validatorFor(contractIds.assetImportResponse)({ ...importResponse,
      created: false, migrated_from_v1: false })).toBe(true);
    expect(validatorFor(contractIds.assetImportResponse)({ ...importResponse,
      migrated_from_v1: false })).toBe(true);
    expect(validatorFor(contractIds.assetImportResponse)({ ...v1DuplicateResponse, created: true })).toBe(false);
    expect(validatorFor(contractIds.assetImportResponse)({ ...v1DuplicateResponse, migrated_from_v1: true })).toBe(false);
    expect(validatorFor(contractIds.assetImportResponse)({ ...importResponse, created: false })).toBe(false);
    const inventory = { format: "narralens.asset-inventory@1.0", manifest_format: "narralens.asset-manifest@2", manifest_sha256: sha,
      assets: [{ asset_id: "asset_original", sha256: sha, media_type: "video/mp4", duration_frames: 30,
        source: v1Asset.source, license, availability: "available", eligible: true, blocking_reasons: [] }] };
    expect(validatorFor(contractIds.assetInventoryResponse)(inventory)).toBe(true);
    expect(validatorFor(contractIds.assetInventoryResponse)({ ...inventory,
      assets: [{ ...inventory.assets[0], project_path: "media/original.mp4" }] })).toBe(false);
  });

  it("publishes both stable media error codes in the runtime API error schema", () => {
    const schema = JSON.parse(readFileSync(new URL("../../contracts/api-error.schema.json", import.meta.url), "utf8")) as { properties: { code: { enum: string[] } } };
    expect(schema.properties.code.enum).toContain("INVALID_MEDIA");
    expect(schema.properties.code.enum).toContain("MEDIA_TOOL_UNAVAILABLE");
    const validate = validatorFor(contractIds.apiError);
    expect(validate({ code: "INVALID_MEDIA", message: "media rejected", correlation_id: "correlation-1" })).toBe(true);
    expect(validate({ code: "MEDIA_TOOL_UNAVAILABLE", message: "ffmpeg unavailable", correlation_id: "correlation-2" })).toBe(true);
  });
});
