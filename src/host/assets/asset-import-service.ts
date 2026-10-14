import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, link, lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { resolve, sep } from "node:path";

import { contractIds, validatorFor } from "../../contracts/validator.js";
import type { AssetImportResponse, AssetManifest, AssetManifestEntry } from "../../contracts/types.js";
import { HttpError } from "../api-error.js";
import { AssetManifestPublishUncertain, AssetRegistry, assetIdentity } from "../projects/asset-registry.js";
import type { ProjectCatalog } from "../projects/project-catalog.js";
import type { ProjectOperationQueue } from "../projects/project-operation-queue.js";
import type { AssetImportJournalRecord, RevisionStore } from "../projects/revision-store.js";
import { cleanupStagedAsset, receiveAssetUpload, type AssetUploadDependencies, type AssetUploadLimits, type StagedAssetUpload } from "./asset-import-upload.js";
import { validateImportedMedia, type MediaValidationOptions, type ValidatedMedia } from "./media-validator.js";

export interface AssetImportResult {
  status: 200 | 201;
  response: AssetImportResponse;
}

export interface AssetImportServiceOptions {
  upload?: AssetUploadLimits;
  uploadDependencies?: AssetUploadDependencies;
  media?: MediaValidationOptions;
  contentInstall?: { link?: typeof link };
}

const defaultUploadLimit = 2 * 1024 * 1024 * 1024;

export class AssetImportService {
  readonly #uploadLimits: AssetUploadLimits;
  readonly #uploadDependencies: AssetUploadDependencies;
  readonly #mediaOptions: MediaValidationOptions;
  readonly #contentLink: typeof link;

  constructor(readonly catalog: ProjectCatalog, readonly registry: AssetRegistry, readonly revisions: RevisionStore,
    readonly operations: ProjectOperationQueue, options: AssetImportServiceOptions = {}) {
    this.#uploadLimits = options.upload ?? { fileBytes: defaultUploadLimit };
    this.#uploadDependencies = options.uploadDependencies ?? {};
    this.#mediaOptions = options.media ?? {};
    this.#contentLink = options.contentInstall?.link ?? link;
  }

  async importRequest(projectId: string, request: IncomingMessage, signal?: AbortSignal): Promise<AssetImportResult> {
    const upload = await receiveAssetUpload(request, this.catalog.descriptorRoot(projectId), this.#uploadLimits,
      this.#uploadDependencies);
    try {
      if (signal?.aborted) throw new HttpError(400, "INVALID_REQUEST", "Asset import was cancelled");
      const project = await this.catalog.read(projectId);
      const media = await validateImportedMedia(upload.filePath, project.frame_rate, upload.bytesSha256,
        { ...this.#mediaOptions, ...(signal ? { signal } : {}) });
      return await this.operations.run(projectId, async () => {
        if (signal?.aborted) throw new HttpError(400, "INVALID_REQUEST", "Asset import was cancelled");
        return await this.#commit(projectId, upload, media);
      });
    } finally {
      await cleanupStagedAsset(upload);
    }
  }

  async recoverIncomplete(projectId?: string): Promise<void> {
    for (const record of this.revisions.incompleteAssetImports().filter((candidate) => projectId === undefined || candidate.project_id === projectId)) {
      await this.operations.run(record.project_id, async () => await this.#recover(record));
    }
  }

  async #commit(projectId: string, upload: StagedAssetUpload, media: ValidatedMedia): Promise<AssetImportResult> {
    const project = await this.catalog.read(projectId);
    const entry: AssetManifestEntry = {
      asset_id: assetIdentity(upload.bytesSha256, upload.metadata.source, upload.metadata.license),
      project_path: `media/${upload.bytesSha256}/source.mp4`,
      sha256: upload.bytesSha256,
      media_type: "video/mp4",
      kind: "video",
      duration_frames: media.durationFrames,
      source: upload.metadata.source,
      license: upload.metadata.license,
    };
    const requestHash = sha256(Buffer.from(canonicalJson({ bytes_sha256: upload.bytesSha256, metadata: upload.metadata }), "utf8"));
    const existing = this.revisions.assetImportIdempotent(projectId, upload.metadata.idempotency_key, requestHash);
    if (existing !== undefined) return { status: existing.status as 200 | 201, response: existing.response };
    const plan = await this.registry.planAppend(projectId, entry);
    const transactionId = `asset_import_${randomUUID()}`;
    const record: AssetImportJournalRecord = {
      transaction_id: transactionId,
      project_id: projectId,
      correlation_id: randomUUID(),
      idempotency_key: upload.metadata.idempotency_key,
      request_hash: requestHash,
      state: "prepared",
      asset_id: entry.asset_id,
      bytes_sha: upload.bytesSha256,
      manifest_before_sha: plan.before.sha256,
      manifest_after_sha: plan.after_sha256,
      manifest_before_json: Buffer.from(plan.before.bytes).toString("utf8"),
      manifest_after_json: Buffer.from(plan.after_bytes).toString("utf8"),
      bytes_created: false,
    };
    const replay = this.revisions.prepareAssetImport(record, project.revision);
    if (replay !== undefined) return { status: replay.status as 200 | 201, response: replay.response };

    try {
      const bytesCreated = await installContent(plan.before.root, upload.filePath, upload.bytesSha256, this.#contentLink);
      this.revisions.markAssetImportBytesInstalled(transactionId, bytesCreated);
      const published = plan.created
        ? await this.registry.publish(projectId, plan.before.sha256, plan.after_bytes)
        : await this.registry.readManifest(projectId);
      if (published.sha256 !== plan.after_sha256) {
        throw new HttpError(409, "MANIFEST_CHANGED", "Asset manifest changed during import");
      }
      this.revisions.markAssetImportManifestPublished(transactionId);
      const response = importResponse(entry.asset_id, published.manifest.format, published.sha256,
        plan.created, plan.migrated_from_v1);
      const status = plan.created ? 201 : 200;
      this.revisions.commitAssetImport(transactionId, status, response);
      return { status, response };
    } catch (error) {
      if (error instanceof AssetInstallUncertain) {
        this.revisions.markAssetImportAttention(projectId, transactionId, "IMPORT_BYTES_RECOVERY_UNPROVED");
        throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED", "Asset byte installation requires recovery");
      }
      try { await this.#compensate(this.revisions.assetImportJournal(transactionId)!); }
      catch {
        this.revisions.markAssetImportAttention(projectId, transactionId, "IMPORT_MANIFEST_RECOVERY_UNPROVED");
        throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED", "Asset import recovery could not be proved");
      }
      if (error instanceof HttpError) throw error;
      if (error instanceof AssetManifestPublishUncertain) {
        throw new HttpError(500, "TRANSACTION_FAILED", "Asset manifest publication was compensated");
      }
      throw new HttpError(500, "TRANSACTION_FAILED", "Asset import transaction failed");
    }
  }

  async #recover(record: AssetImportJournalRecord): Promise<void> {
    try { await this.#recoverRecord(record); }
    catch {
      this.revisions.markAssetImportAttention(record.project_id, record.transaction_id, "IMPORT_MANIFEST_RECOVERY_UNPROVED");
    }
  }

  async #recoverRecord(record: AssetImportJournalRecord): Promise<void> {
    let current;
    try { current = await this.registry.readManifest(record.project_id); }
    catch {
      this.revisions.markAssetImportAttention(record.project_id, record.transaction_id, "IMPORT_MANIFEST_RECOVERY_UNPROVED");
      return;
    }
    if (record.state === "prepared") {
      if (current.sha256 === record.manifest_before_sha) this.revisions.markAssetImportAborted(record.transaction_id);
      else this.revisions.markAssetImportAttention(record.project_id, record.transaction_id, "IMPORT_MANIFEST_RECOVERY_UNPROVED");
      return;
    }
    if (current.sha256 === record.manifest_before_sha) {
      await this.#removeUnreferencedBytes(record, current.manifest);
      this.revisions.markAssetImportCompensated(record.transaction_id);
      return;
    }
    if (current.sha256 !== record.manifest_after_sha) {
      this.revisions.markAssetImportAttention(record.project_id, record.transaction_id, "IMPORT_MANIFEST_RECOVERY_UNPROVED");
      return;
    }
    try {
      await assertInstalledContent(current.root, record.bytes_sha);
      if (record.state === "bytes_installed") {
        await this.registry.restore(record.project_id, record.manifest_after_sha, Buffer.from(record.manifest_before_json, "utf8"));
        const restored = await this.registry.readManifest(record.project_id);
        await this.#removeUnreferencedBytes(record, restored.manifest);
        this.revisions.markAssetImportCompensated(record.transaction_id);
        return;
      }
      if (record.state === "attention") this.revisions.markAssetImportManifestPublished(record.transaction_id);
      const result = responseFromRecord(record);
      this.revisions.commitAssetImport(record.transaction_id, result.status, result.response);
    } catch {
      this.revisions.markAssetImportAttention(record.project_id, record.transaction_id, "IMPORT_MANIFEST_RECOVERY_UNPROVED");
    }
  }

  async #compensate(record: AssetImportJournalRecord): Promise<void> {
    if (record.state === "prepared") {
      this.revisions.markAssetImportAborted(record.transaction_id);
      return;
    }
    if (record.state === "committed" || record.state === "aborted" || record.state === "compensated") return;
    const current = await this.registry.readManifest(record.project_id);
    let restored = current;
    if (current.sha256 === record.manifest_after_sha && record.manifest_after_sha !== record.manifest_before_sha) {
      restored = await this.registry.restore(record.project_id, record.manifest_after_sha,
        Buffer.from(record.manifest_before_json, "utf8"));
    } else if (current.sha256 !== record.manifest_before_sha) {
      throw new Error("IMPORT_MANIFEST_RECOVERY_UNPROVED");
    }
    await this.#removeUnreferencedBytes(record, restored.manifest);
    this.revisions.markAssetImportCompensated(record.transaction_id);
  }

  async #removeUnreferencedBytes(record: AssetImportJournalRecord, manifest: AssetManifest): Promise<void> {
    if (!record.bytes_created || manifest.assets.some((asset) => asset.sha256 === record.bytes_sha)) return;
    const root = await realpath(this.catalog.descriptorRoot(record.project_id));
    const path = resolve(root, "media", record.bytes_sha, "source.mp4");
    let resolved: string;
    try {
      const lexicalFacts = await lstat(path);
      if (!lexicalFacts.isFile() || lexicalFacts.isSymbolicLink()) throw new Error("IMPORT_BYTES_RECOVERY_UNPROVED");
      resolved = await realpath(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    if (!resolved.startsWith(`${root}${sep}`)) throw new Error("IMPORT_BYTES_RECOVERY_UNPROVED");
    const facts = await lstat(resolved);
    if (!facts.isFile() || facts.isSymbolicLink() || await hashFile(resolved) !== record.bytes_sha) {
      throw new Error("IMPORT_BYTES_RECOVERY_UNPROVED");
    }
    await unlink(path);
  }
}

async function installContent(rootInput: string, stagedPath: string, bytesSha: string, installLink: typeof link): Promise<boolean> {
  const root = await realpath(rootInput);
  const stagingRoot = await realpath(resolve(root, ".narralens", "staging"));
  const lexicalSourceFacts = await lstat(stagedPath);
  if (!lexicalSourceFacts.isFile() || lexicalSourceFacts.isSymbolicLink()) {
    throw new HttpError(500, "TRANSACTION_FAILED", "Validated upload staging path is unsafe");
  }
  const source = await realpath(stagedPath);
  if (!source.startsWith(`${stagingRoot}${sep}`) || !source.startsWith(`${root}${sep}`)) {
    throw new HttpError(500, "TRANSACTION_FAILED", "Validated upload escaped project staging");
  }
  const sourceFacts = await lstat(source);
  if (!sourceFacts.isFile() || sourceFacts.isSymbolicLink() || await hashFile(source) !== bytesSha) {
    throw new HttpError(422, "INVALID_MEDIA", "Validated upload bytes changed before installation");
  }
  const directory = await secureContentDirectory(root, ["media", bytesSha]);
  const destination = resolve(directory, "source.mp4");
  try {
    const lexicalFacts = await lstat(destination);
    if (!lexicalFacts.isFile() || lexicalFacts.isSymbolicLink()) throw new AssetInstallUncertain();
    const existing = await realpath(destination);
    const facts = await lstat(existing);
    if (!existing.startsWith(`${root}${sep}`) || !facts.isFile() || facts.isSymbolicLink()
      || await hashFile(existing) !== bytesSha) throw new AssetInstallUncertain();
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  let linked = false;
  try {
    const sourceHandle = await open(source, "r");
    try { await sourceHandle.sync(); } finally { await sourceHandle.close(); }
    await chmod(source, 0o444);
    await installLink(source, destination);
    linked = true;
    const destinationHandle = await open(destination, "r");
    try { await destinationHandle.sync(); } finally { await destinationHandle.close(); }
    const directoryHandle = await open(directory, "r");
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      const lexicalFacts = await lstat(destination);
      if (!lexicalFacts.isFile() || lexicalFacts.isSymbolicLink()) throw new AssetInstallUncertain(error);
      const existing = await realpath(destination);
      if (!existing.startsWith(`${root}${sep}`) || await hashFile(existing) !== bytesSha) throw new AssetInstallUncertain(error);
      return false;
    }
    if (linked) {
      try {
        await unlink(destination);
        const directoryHandle = await open(directory, "r");
        try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
      } catch { throw new AssetInstallUncertain(error); }
    }
    throw error;
  }
}

async function assertInstalledContent(rootInput: string, bytesSha: string): Promise<void> {
  const root = await realpath(rootInput);
  const lexicalPath = resolve(root, "media", bytesSha, "source.mp4");
  const lexicalFacts = await lstat(lexicalPath);
  if (!lexicalFacts.isFile() || lexicalFacts.isSymbolicLink()) throw new Error("IMPORT_BYTES_RECOVERY_UNPROVED");
  const path = await realpath(lexicalPath);
  if (!path.startsWith(`${root}${sep}`) || await hashFile(path) !== bytesSha) {
    throw new Error("IMPORT_BYTES_RECOVERY_UNPROVED");
  }
}

async function secureContentDirectory(root: string, segments: string[]): Promise<string> {
  let current = root;
  for (const segment of segments) {
    const candidate = resolve(current, segment);
    if (!candidate.startsWith(`${root}${sep}`)) throw new AssetInstallUncertain();
    try {
      const facts = await lstat(candidate);
      if (!facts.isDirectory() || facts.isSymbolicLink()) throw new AssetInstallUncertain();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      try { await mkdir(candidate, { mode: 0o700 }); }
      catch (mkdirError) {
        if ((mkdirError as NodeJS.ErrnoException).code !== "EEXIST") throw mkdirError;
      }
    }
    current = await realpath(candidate);
    if (!current.startsWith(`${root}${sep}`)) throw new AssetInstallUncertain();
  }
  return current;
}

function importResponse(assetId: string, manifestFormat: AssetManifest["format"], manifestSha: string,
  created: boolean, migrated: boolean): AssetImportResponse {
  const response: AssetImportResponse = { format: "narralens.asset-import-response@1.0", asset_id: assetId,
    manifest_format: manifestFormat, manifest_sha256: manifestSha, created, migrated_from_v1: migrated };
  if (!validatorFor(contractIds.assetImportResponse)(response)) throw new Error("INVALID_ASSET_IMPORT_RESPONSE");
  return response;
}

function responseFromRecord(record: AssetImportJournalRecord): AssetImportResult {
  const before = JSON.parse(record.manifest_before_json) as AssetManifest;
  const after = JSON.parse(record.manifest_after_json) as AssetManifest;
  const created = !before.assets.some((asset) => asset.asset_id === record.asset_id)
    && after.assets.some((asset) => asset.asset_id === record.asset_id);
  const response = importResponse(record.asset_id, after.format, record.manifest_after_sha, created,
    created && before.format === "narralens.asset-manifest@1");
  return { status: created ? 201 : 200, response };
}

async function hashFile(path: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk as Buffer);
  return digest.digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }

class AssetInstallUncertain extends Error {
  constructor(cause?: unknown) { super("Asset content installation could not be proved", { cause }); }
}
