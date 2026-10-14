import { createHash, randomUUID } from "node:crypto";
import type { EditRequest, EditResponse, FitEditOperation, MediaEditOperation } from "../../contracts/types.js";
import { HypitWriteAdapter, type HypitCapture, type HypitMediaCapture } from "../../adapters/hypit/hypit-write-adapter.js";
import { HttpError } from "../api-error.js";
import type { ProjectCatalog } from "./project-catalog.js";
import { RevisionStore, type JournalRecord } from "./revision-store.js";
import { AssetRegistry } from "./asset-registry.js";
import { InMemoryProjectOperationQueue, type ProjectOperationQueue } from "./project-operation-queue.js";

export class ProjectWriteActor {
  readonly adapter: HypitWriteAdapter;
  readonly assets: AssetRegistry;
  readonly operations: ProjectOperationQueue;

  constructor(readonly catalog: ProjectCatalog, readonly store: RevisionStore, adapter?: HypitWriteAdapter,
    operations: ProjectOperationQueue = new InMemoryProjectOperationQueue()) {
    this.adapter = adapter ?? new HypitWriteAdapter(catalog);
    this.assets = new AssetRegistry(catalog);
    this.operations = operations;
  }

  async projectState(projectId: string): Promise<{ revision: number; visual_locked: boolean; attention: boolean }> {
    const descriptor = await this.catalog.readDescriptor(projectId);
    return this.store.state(projectId, descriptor.revision);
  }

  setVisualLock(projectId: string, initialRevision: number, locked: boolean): void {
    this.store.setVisualLock(projectId, initialRevision, locked);
  }

  execute(projectId: string, request: EditRequest, correlationId = randomUUID()): Promise<EditResponse> {
    return this.operations.run(projectId, () => this.#execute(projectId, request, correlationId));
  }

  async #execute(projectId: string, request: EditRequest, correlationId: string): Promise<EditResponse> {
    const descriptor = await this.catalog.readDescriptor(projectId);
    const operation = request.operations[0];
    const shot = descriptor.shots.find((candidate) => candidate.shot_id === request.selection.shot_id);
    if (!shot || shot.start_frame !== request.selection.start_frame || shot.end_frame_exclusive !== request.selection.end_frame_exclusive) {
      throw new HttpError(422, "UNSUPPORTED_EDIT", "Selection is not a registered project shot", undefined, correlationId);
    }
    const requestJson = canonicalJson(request);
    const requestHash = sha256(requestJson);
    const cached = this.store.idempotent(projectId, request.idempotency_key, requestHash);
    if (cached) return cached;
    const state = this.store.state(projectId, descriptor.revision);
    if (state.attention) throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED", "The project requires transaction recovery", undefined, correlationId);
    if (state.visual_locked) throw new HttpError(423, "TARGET_LOCKED", "The visual target is locked", undefined, correlationId);
    if (state.revision !== request.base_revision) throw new HttpError(409, "REVISION_CONFLICT", "Project revision has changed", undefined, correlationId);

    if (operation.op === "replace_visual_asset") {
      return await this.#executeMedia(projectId, descriptor.revision, request, operation, shot.authoring_id, requestJson, requestHash, correlationId);
    }

    const before = await this.adapter.inspect(projectId, operation.shot_id, operation.value);
    const expectedSource = this.adapter.predictedSource(before, operation.value);
    const record: JournalRecord = {
      transaction_id: `txn_${randomUUID().replaceAll("-", "")}`,
      project_id: projectId,
      correlation_id: correlationId,
      state: "prepared",
      request_json: requestJson,
      request_hash: requestHash,
      base_revision: request.base_revision,
      authoring_id: shot.authoring_id,
      before_fit: before.fit,
      target_fit: operation.value,
      source_before: before.source_sha256,
      run_before: before.run_sha256,
      narration_before: before.narration_sha256,
      semantic_before: canonicalJson(before.semantic),
      source_path: before.snapshot.source.path,
      source_expected: sha256(expectedSource),
      studio_revision_before: before.snapshot.revision,
      compensation_attempt: 0,
    };
    const preparedCache = this.store.prepare(record, request.idempotency_key, descriptor.revision);
    if (preparedCache) return preparedCache;

    if (before.fit === operation.value) {
      const response = result(record, operation, request.base_revision, request.base_revision, false, before);
      this.store.commit(record, request.idempotency_key, response);
      return response;
    }

    let mutation;
    try { mutation = await this.adapter.mutate(before, operation.value); }
    catch (error) { return this.#mutationException(record, before, operation.value, correlationId, error); }
    if (mutation.status !== 200) return this.#mutationFailure(record, before, operation.value, mutation.status, correlationId);

    let after: HypitCapture;
    try {
      after = await this.adapter.inspect(projectId, operation.shot_id, operation.value);
      const actualSource = await this.adapter.sourceText(projectId, after.snapshot.source.path);
      assertInvariants(before, after, expectedSource, actualSource, operation.value);
      this.store.markSourceValidated(record.transaction_id);
    } catch (error) {
      await this.#compensate(record, projectId, operation.shot_id, before, correlationId);
      throw new HttpError(500, "TRANSACTION_FAILED", "Post-write validation failed and the edit was compensated", undefined, correlationId);
    }

    const response = result(record, operation, request.base_revision, request.base_revision + 1, true, after);
    try {
      this.store.commit(record, request.idempotency_key, response);
      return response;
    } catch (error) {
      await this.#compensate(record, projectId, operation.shot_id, before, correlationId);
      throw new HttpError(500, "TRANSACTION_FAILED", "Metadata commit failed and the edit was compensated", undefined, correlationId);
    }
  }

  async #executeMedia(projectId: string, descriptorRevision: number, request: EditRequest, operation: MediaEditOperation,
    authoringId: string, requestJson: string, requestHash: string, correlationId: string): Promise<EditResponse> {
    const targetAsset = await this.assets.resolve(projectId, operation.asset_id);
    const selectedFrames = request.selection.end_frame_exclusive - request.selection.start_frame;
    if (targetAsset.duration_frames !== selectedFrames) {
      throw new HttpError(422, "MISSING_ASSET", "The replacement asset must exactly cover the selected shot", undefined, correlationId);
    }
    const before = await this.adapter.inspectMedia(projectId, operation.shot_id);
    const beforeAsset = await this.assets.resolve(projectId, before.media_asset.asset_id);
    if (beforeAsset.sha256 !== before.media_asset.sha256 || beforeAsset.manifest_sha256 !== targetAsset.manifest_sha256) {
      throw new HttpError(409, "MANIFEST_CHANGED", "The asset manifest changed during prepare", undefined, correlationId);
    }
    const record: JournalRecord = {
      transaction_id: `txn_${randomUUID().replaceAll("-", "")}`, project_id: projectId, correlation_id: correlationId,
      state: "prepared", request_json: requestJson, request_hash: requestHash, base_revision: request.base_revision,
      authoring_id: authoringId, before_fit: before.media_asset.asset_id, target_fit: operation.asset_id,
      source_before: before.source_sha256, run_before: before.run_sha256, narration_before: before.narration_sha256,
      semantic_before: canonicalJson(before.semantic), source_path: before.snapshot.source.path, source_expected: "",
      studio_revision_before: before.snapshot.revision, compensation_attempt: 0, manifest_sha: targetAsset.manifest_sha256,
    };
    const preparedCache = this.store.prepare(record, request.idempotency_key, descriptorRevision);
    if (preparedCache) return preparedCache;
    if (before.media_asset.asset_id === operation.asset_id) {
      const response = result(record, operation, request.base_revision, request.base_revision, false, before);
      this.store.commit(record, request.idempotency_key, response);
      return response;
    }
    let mutation;
    try { mutation = await this.adapter.mutateMedia(before, operation.asset_id, record.manifest_sha!); }
    catch (error) { return await this.#mediaMutationException(record, before, operation, correlationId, error); }
    if (mutation.status !== 200) return await this.#mediaMutationFailure(record, before, operation, mutation.status, mutation.error, correlationId);
    try {
      const [currentTarget, currentBefore] = await Promise.all([
        this.assets.resolve(projectId, operation.asset_id), this.assets.resolve(projectId, before.media_asset.asset_id),
      ]);
      if (currentTarget.manifest_sha256 !== record.manifest_sha || currentBefore.manifest_sha256 !== record.manifest_sha
        || currentTarget.sha256 !== targetAsset.sha256 || currentBefore.sha256 !== beforeAsset.sha256) throw new Error("asset authorization changed");
    } catch {
      this.store.markAttention(projectId, record.transaction_id, "MEDIA_ASSET_CHANGED_AFTER_PREPARE");
      throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED", "The asset authorization changed after transaction prepare", undefined, correlationId);
    }
    let after: HypitMediaCapture;
    try {
      after = await this.adapter.inspectMedia(projectId, operation.shot_id);
      assertMediaInvariants(before, after, operation.asset_id, targetAsset.sha256);
      this.store.markSourceValidated(record.transaction_id, after.source_sha256);
      record.source_expected = after.source_sha256;
    } catch {
      await this.#compensateMedia(record, projectId, operation.shot_id, before, correlationId);
      throw new HttpError(500, "TRANSACTION_FAILED", "Post-write validation failed and the media edit was compensated", undefined, correlationId);
    }
    const response = result(record, operation, request.base_revision, request.base_revision + 1, true, after);
    try {
      this.store.commit(record, request.idempotency_key, response);
      return response;
    } catch {
      await this.#compensateMedia(record, projectId, operation.shot_id, before, correlationId);
      throw new HttpError(500, "TRANSACTION_FAILED", "Metadata commit failed and the media edit was compensated", undefined, correlationId);
    }
  }

  async #mediaMutationException(record: JournalRecord, before: HypitMediaCapture, operation: MediaEditOperation,
    correlationId: string, original: unknown): Promise<never> {
    try {
      const current = await this.adapter.inspectMedia(record.project_id, operation.shot_id);
      if (sameMediaState(current, before)) {
        this.store.markAborted(record.transaction_id);
        if (original instanceof HttpError) throw original;
        throw new HttpError(500, "TRANSACTION_FAILED", "Hypit media mutation failed before changing the Source", undefined, correlationId);
      }
    } catch (verificationError) {
      if (this.store.journal(record.transaction_id)?.state === "aborted" && verificationError instanceof HttpError) throw verificationError;
    }
    this.store.markAttention(record.project_id, record.transaction_id, "MEDIA_MUTATION_RESPONSE_UNCERTAIN");
    throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED", "The Hypit media mutation outcome is uncertain", undefined, correlationId);
  }

  async #mediaMutationFailure(record: JournalRecord, before: HypitMediaCapture, operation: MediaEditOperation,
    status: number, upstreamError: string | undefined, correlationId: string): Promise<never> {
    const manifestChanged = status === 409 && upstreamError?.toLowerCase().includes("manifest changed");
    try {
      const current = await this.adapter.inspectMedia(record.project_id, operation.shot_id);
      if (!sameMediaState(current, before)) {
        this.store.markAttention(record.project_id, record.transaction_id, "MEDIA_MUTATION_RESULT_UNCERTAIN");
        throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED", "Hypit media mutation result is uncertain", undefined, correlationId);
      }
      this.store.markAborted(record.transaction_id);
    } catch (error) {
      if (error instanceof HttpError && error.code === "PROJECT_ATTENTION_REQUIRED") throw error;
      this.store.markAttention(record.project_id, record.transaction_id, "MEDIA_MUTATION_RESULT_UNREADABLE");
      throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED", "Hypit media mutation result could not be verified", undefined, correlationId);
    }
    if (manifestChanged) throw new HttpError(409, "MANIFEST_CHANGED", "The asset manifest changed before the media mutation completed", undefined, correlationId);
    if (status === 409) throw new HttpError(409, "REVISION_CONFLICT", "Hypit Studio Source changed", undefined, correlationId);
    if (status === 422) throw new HttpError(422, "UNSUPPORTED_EDIT", "Hypit rejected the typed media edit", undefined, correlationId);
    throw new HttpError(500, "TRANSACTION_FAILED", "Hypit failed before changing the media Source", undefined, correlationId);
  }

  async #compensateMedia(record: JournalRecord, projectId: string, shotId: string, before: HypitMediaCapture,
    correlationId: string): Promise<void> {
    this.store.nextCompensationAttempt(record.transaction_id);
    try {
      const current = await this.adapter.inspectMedia(projectId, shotId);
      if (sameMediaState(current, before)) { this.store.markCompensated(record.transaction_id); return; }
      const response = await this.adapter.mutateMedia(current, before.media_asset.asset_id, record.manifest_sha!);
      if (response.status !== 200) throw new Error("media compensation rejected");
      const restored = await this.adapter.inspectMedia(projectId, shotId);
      if (!sameMediaState(restored, before)) throw new Error("media compensation mismatch");
      this.store.markCompensated(record.transaction_id);
    } catch {
      this.store.markAttention(projectId, record.transaction_id, "MEDIA_COMPENSATION_FAILED");
      throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED", "The media edit could not be safely compensated", undefined, correlationId);
    }
  }

  async recoverIncomplete(projectId?: string): Promise<void> {
    if (projectId) await this.catalog.readDescriptor(projectId);
    for (const record of this.store.incomplete().filter((candidate) => projectId === undefined || candidate.project_id === projectId)) {
      try {
        const request = JSON.parse(record.request_json) as EditRequest;
        const operation = request.operations[0];
        if (operation.op === "replace_visual_asset") {
          await this.#recoverMedia(record, request, operation);
          continue;
        }
        if (record.state === "attention") continue;
        const shotId = request.selection.shot_id;
        const current = await this.adapter.inspect(record.project_id, shotId, operation.value);
        const existing = this.store.idempotencyEntry(record.project_id, request.idempotency_key);
        const semanticBefore = record.semantic_before;
        const normalizedCurrent = canonicalJson(current.semantic.map((item) => item.authored_id === record.authoring_id ? { ...item, fit: record.before_fit } : item));
        if (existing) {
          const consistentHash = existing.request_hash === record.request_hash;
          const response = existing.response;
          const consistentContent = response.changed
            ? current.source_sha256 === record.source_expected && current.fit === record.target_fit
            : current.source_sha256 === record.source_before && current.fit === record.before_fit;
          if (consistentHash && consistentContent && response.new_revision === this.store.state(record.project_id, record.base_revision).revision) {
            this.store.markMetadataCommitted(record.transaction_id);
            continue;
          }
          this.store.markAttention(record.project_id, record.transaction_id, "IDEMPOTENCY_RECOVERY_CONFLICT");
          continue;
        }
        if (current.source_sha256 === record.source_before && current.fit === record.before_fit
          && current.run_sha256 === record.run_before && current.narration_sha256 === record.narration_before
          && canonicalJson(current.semantic) === semanticBefore) {
          this.store.markAborted(record.transaction_id);
          continue;
        }
        if (current.source_sha256 === record.source_expected && current.fit === record.target_fit
          && current.run_sha256 === record.run_before && current.narration_sha256 === record.narration_before
          && normalizedCurrent === semanticBefore) {
          const response = result(record, operation, record.base_revision, record.base_revision + 1, true, current);
          this.store.commit(record, request.idempotency_key, response);
          continue;
        }
        const before = { ...current, fit: record.before_fit as "contain" | "cover", source_sha256: record.source_before,
          run_sha256: record.run_before, narration_sha256: record.narration_before,
          semantic: JSON.parse(record.semantic_before) as HypitCapture["semantic"] };
        await this.#compensate(record, record.project_id, shotId, before, record.correlation_id);
      } catch {
        this.store.markAttention(record.project_id, record.transaction_id, "RECOVERY_UNCERTAIN");
      }
    }
  }

  async #recoverMedia(record: JournalRecord, request: EditRequest, operation: MediaEditOperation): Promise<void> {
    const targetAsset = await this.assets.resolve(record.project_id, operation.asset_id);
    const beforeAsset = await this.assets.resolve(record.project_id, record.before_fit);
    if (!record.manifest_sha || targetAsset.manifest_sha256 !== record.manifest_sha
      || beforeAsset.manifest_sha256 !== record.manifest_sha) {
      this.store.markAttention(record.project_id, record.transaction_id, "MEDIA_MANIFEST_RECOVERY_CONFLICT");
      return;
    }
    const current = await this.adapter.inspectMedia(record.project_id, request.selection.shot_id);
    const existing = this.store.idempotencyEntry(record.project_id, request.idempotency_key);
    if (existing) {
      const content = existing.response.changed
        ? current.media_asset.asset_id === operation.asset_id && current.source_sha256 === existing.response.source_sha256
        : current.media_asset.asset_id === record.before_fit && current.source_sha256 === record.source_before;
      if (existing.request_hash === record.request_hash && content
        && existing.response.new_revision === this.store.state(record.project_id, record.base_revision).revision) {
        this.store.markMetadataCommitted(record.transaction_id);
        return;
      }
      this.store.markAttention(record.project_id, record.transaction_id, "MEDIA_IDEMPOTENCY_RECOVERY_CONFLICT");
      return;
    }
    if (current.media_asset.asset_id === record.before_fit && current.media_asset.sha256 === beforeAsset.sha256
      && current.source_sha256 === record.source_before && current.run_sha256 === record.run_before
      && current.narration_sha256 === record.narration_before && canonicalJson(current.semantic) === record.semantic_before) {
      this.store.markAborted(record.transaction_id);
      return;
    }
    const normalized = canonicalJson(current.semantic.map((item) => item.authored_id === record.authoring_id
      ? { ...item, media_asset_id: record.before_fit } : item));
    if (current.media_asset.asset_id === operation.asset_id && current.media_asset.sha256 === targetAsset.sha256
      && current.run_sha256 === record.run_before && current.narration_sha256 === record.narration_before
      && normalized === record.semantic_before) {
      record.source_expected = current.source_sha256;
      this.store.markSourceValidated(record.transaction_id, current.source_sha256);
      this.store.commit(record, request.idempotency_key,
        result(record, operation, record.base_revision, record.base_revision + 1, true, current));
      return;
    }
    const before = { ...current, media_asset: { asset_id: record.before_fit, sha256: beforeAsset.sha256 },
      source_sha256: record.source_before, run_sha256: record.run_before, narration_sha256: record.narration_before,
      semantic: JSON.parse(record.semantic_before) as HypitMediaCapture["semantic"] };
    await this.#compensateMedia(record, record.project_id, operation.shot_id, before, record.correlation_id);
  }

  async #mutationException(record: JournalRecord, before: HypitCapture, target: FitEditOperation["value"], correlationId: string, original: unknown): Promise<never> {
    try {
      const shotId = before.descriptor.shots.find((shot) => shot.authoring_id === record.authoring_id)!.shot_id;
      const current = await this.adapter.inspect(record.project_id, shotId, target);
      if (current.source_sha256 === before.source_sha256 && current.fit === before.fit
        && current.run_sha256 === before.run_sha256 && current.narration_sha256 === before.narration_sha256
        && canonicalJson(current.semantic) === canonicalJson(before.semantic)) {
        this.store.markAborted(record.transaction_id);
        if (original instanceof HttpError) throw original;
        throw new HttpError(500, "TRANSACTION_FAILED", "Hypit mutation failed before changing the Source", undefined, correlationId);
      }
    } catch (verificationError) {
      if (this.store.journal(record.transaction_id)?.state === "aborted" && verificationError instanceof HttpError) throw verificationError;
    }
    this.store.markAttention(record.project_id, record.transaction_id, "MUTATION_RESPONSE_UNCERTAIN");
    throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED", "The Hypit mutation outcome is uncertain", undefined, correlationId);
  }

  async #mutationFailure(record: JournalRecord, before: HypitCapture, target: FitEditOperation["value"], status: number, correlationId: string): Promise<never> {
    try {
      const current = await this.adapter.inspect(record.project_id, before.descriptor.shots.find((shot) => shot.authoring_id === record.authoring_id)!.shot_id, target);
      if (current.source_sha256 !== before.source_sha256 || current.fit !== before.fit) {
        this.store.markAttention(record.project_id, record.transaction_id, "MUTATION_RESULT_UNCERTAIN");
        throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED", "Hypit mutation result is uncertain", undefined, correlationId);
      }
      this.store.markAborted(record.transaction_id);
    } catch (error) {
      if (error instanceof HttpError && error.code === "PROJECT_ATTENTION_REQUIRED") throw error;
      this.store.markAttention(record.project_id, record.transaction_id, "MUTATION_RESULT_UNREADABLE");
      throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED", "Hypit mutation result could not be verified", undefined, correlationId);
    }
    if (status === 409) throw new HttpError(409, "REVISION_CONFLICT", "Hypit Studio revision has changed", undefined, correlationId);
    if (status === 422) throw new HttpError(422, "UNSUPPORTED_EDIT", "Hypit rejected the typed edit", undefined, correlationId);
    throw new HttpError(500, "TRANSACTION_FAILED", "Hypit failed before changing the Source", undefined, correlationId);
  }

  async #compensate(record: JournalRecord, projectId: string, shotId: string, before: HypitCapture, correlationId: string): Promise<void> {
    this.store.nextCompensationAttempt(record.transaction_id);
    try {
      const current = await this.adapter.inspect(projectId, shotId, before.fit);
      if (current.source_sha256 === before.source_sha256 && current.fit === before.fit) {
        this.store.markCompensated(record.transaction_id);
        return;
      }
      const response = await this.adapter.mutate(current, before.fit);
      if (response.status !== 200) throw new Error("compensation rejected");
      const restored = await this.adapter.inspect(projectId, shotId, before.fit);
      if (restored.source_sha256 !== before.source_sha256 || restored.run_sha256 !== before.run_sha256
        || restored.narration_sha256 !== before.narration_sha256 || canonicalJson(restored.semantic) !== canonicalJson(before.semantic)) {
        throw new Error("compensation mismatch");
      }
      this.store.markCompensated(record.transaction_id);
    } catch {
      this.store.markAttention(projectId, record.transaction_id, "COMPENSATION_FAILED");
      throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED", "The edit could not be safely compensated", undefined, correlationId);
    }
  }
}

function result(record: JournalRecord, operation: EditRequest["operations"][0], previous: number, next: number, changed: boolean,
  capture: Pick<HypitCapture, "source_sha256" | "run_sha256"> | Pick<HypitMediaCapture, "source_sha256" | "run_sha256">): EditResponse {
  return { transaction_id: record.transaction_id, project_id: record.project_id, previous_revision: previous,
    new_revision: next, operation, status: changed ? "committed" : "unchanged", changed,
    source_sha256: capture.source_sha256, run_sha256: capture.run_sha256 };
}

function assertInvariants(before: HypitCapture, after: HypitCapture, expectedSource: string, actualSource: string, target: string): void {
  if (actualSource !== expectedSource || after.fit !== target || after.snapshot.timeline.frameCount !== before.snapshot.timeline.frameCount
    || after.run_sha256 !== before.run_sha256 || after.narration_sha256 !== before.narration_sha256) throw new Error("write invariant failed");
  const normalize = (capture: HypitCapture): string => canonicalJson(capture.semantic.map((item) => item.authored_id === capture.target.authoredId ? { ...item, fit: before.fit } : item));
  if (canonicalJson(before.semantic) !== normalize(after)) throw new Error("non-target semantic drift");
}

function sameMediaState(current: HypitMediaCapture, before: HypitMediaCapture): boolean {
  return current.source_sha256 === before.source_sha256 && current.media_asset.asset_id === before.media_asset.asset_id
    && current.media_asset.sha256 === before.media_asset.sha256 && current.run_sha256 === before.run_sha256
    && current.narration_sha256 === before.narration_sha256 && canonicalJson(current.semantic) === canonicalJson(before.semantic);
}

function assertMediaInvariants(before: HypitMediaCapture, after: HypitMediaCapture, targetAssetId: string, targetSha: string): void {
  if (after.media_asset.asset_id !== targetAssetId || after.media_asset.sha256 !== targetSha
    || after.snapshot.timeline.frameCount !== before.snapshot.timeline.frameCount
    || after.run_sha256 !== before.run_sha256 || after.narration_sha256 !== before.narration_sha256) {
    throw new Error("media write invariant failed");
  }
  const normalized = canonicalJson(after.semantic.map((item) => item.authored_id === after.target.authoredId
    ? { ...item, media_asset_id: before.media_asset.asset_id } : item));
  if (canonicalJson(before.semantic) !== normalized) throw new Error("non-target media semantic drift");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
