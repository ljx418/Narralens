import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import type { DeliveryManifest, QCItem, Ref } from "../../contracts/agent-driven-types.js";
import { MANDATORY_A_SUPPLEMENT_ROLES, runPreflight } from "../preflight/preflight.js";
import { assertManifestMatches, buildDeliveryManifest } from "../delivery/manifest.js";
import { realMediaToolRunner, runQualityControl, type MediaToolRunner, type SupplementCheck } from "../delivery/qc.js";
import type { PublishedPackageStore } from "../delivery/published-package-store.js";
import {
  PACKAGE_FILES,
  PACKAGE_ROLES,
  deriveDeliveryId,
  deriveDownloadRef,
  derivePackageId,
  packageRefId,
  supplementFileName,
} from "../delivery/package-layout.js";
import { copySnapshotClosure, SnapshotCopyError, verifySnapshotCopy, type SnapshotCopy } from "./snapshot-copy.js";
import { NativeRenderCancelled, NativeRenderError, type NativeRenderPort } from "./native-renderer.js";
import { computeRenderConfigDigest } from "./render-profile.js";
import { RENDER_PIN, type RenderPinVerdict } from "./upstream-pin.js";
import type {
  AttemptIdentity,
  DeliveryCommitPort,
  RenderBoundary,
  RenderBoundaryContext,
  RenderBoundaryHooks,
  RenderOutcome,
  RenderPort,
  RenderRequest,
  SnapshotReadPort,
  AttemptFencePort,
  SnapshotClosure,
} from "./ports.js";

/**
 * The snapshot render.
 *
 * This is the whole delivery path, in the order the contract demands:
 *
 * preflight → copy the snapshot → render → verify the copy → probe and decode →
 * build the package → publish it atomically → let MAIN record it.
 *
 * Four rules shape the code:
 *
 * - **Nothing durable happens here.** This module writes files and asks MAIN to record
 *   facts. The job state, the delivery record and the business event are MAIN's.
 * - **Nothing is published before it is checked.** A package is published only after
 *   the whole file has decoded, the file is as long as the native document says, every
 *   supplement matches its committed digest and every promised supplement is there. A
 *   blocked check ends the render without a package.
 * - **Nothing of somebody else's is touched.** Every attempt has its own staging
 *   directory, a publish never overwrites, and a cancelled attempt's output is moved
 *   aside rather than adopted or deleted.
 * - **Nothing is dropped on the way.** Every check the preflight made is carried into
 *   the delivery's own list, so a warning cannot disappear between the preflight and
 *   the manifest.
 */

/** What the service is made of. */
export interface SnapshotRenderServiceDeps {
  readonly snapshots: SnapshotReadPort;
  readonly fence: AttemptFencePort;
  readonly commit: DeliveryCommitPort;
  readonly packages: PublishedPackageStore;
  readonly native_renderer: NativeRenderPort;
  /** The pinned OpenFilm checkout. */
  readonly upstream_root: string;
  /** MAIN's boundary hooks. MAIN emits `ready_committed` and `events_published`. */
  readonly hooks: RenderBoundaryHooks;
  readonly qc_runner?: MediaToolRunner;
  /** How the pinned upstream is checked. The default is the real check. */
  readonly pin_verifier?: (upstream_root: string) => Promise<RenderPinVerdict>;
  readonly render_timeout_ms?: number;
  readonly qc_timeout_ms?: number;
}

/** The default time a render may take. */
export const DEFAULT_RENDER_TIMEOUT_MS = 30 * 60 * 1000;
/** The default time the probe and the full decode may take. */
export const DEFAULT_QC_TIMEOUT_MS = 15 * 60 * 1000;

function sha256Of(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * The digest of a file, read in pieces.
 *
 * The media is the one file that can be large, and it is hashed more than once: when
 * the package is built and when the package is verified. Reading it in pieces keeps a
 * delivery from needing as much memory as the film is big.
 */
async function sha256File(path: string): Promise<string | null> {
  return await new Promise<string | null>((resolvePromise) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("error", () => { resolvePromise(null); });
    stream.on("data", (chunk) => { hash.update(chunk); });
    stream.on("end", () => { resolvePromise(hash.digest("hex")); });
  });
}

function failure(code: string, message: string, retryable: boolean, requiresReconciliation = false): RenderOutcome {
  return {
    state: "failed",
    manifest: null,
    qc: "pending",
    artifact_ref: null,
    download_ref: null,
    failure: { code, message, retryable },
    qc_items: [],
    requires_reconciliation: requiresReconciliation,
  };
}

function blocked(items: readonly QCItem[], message: string, requiresReconciliation = false): RenderOutcome {
  return {
    state: "blocked",
    manifest: null,
    qc: "blocked",
    artifact_ref: null,
    download_ref: null,
    failure: { code: "QC_BLOCKED", message, retryable: false },
    qc_items: items,
    requires_reconciliation: requiresReconciliation,
  };
}

/**
 * How a renderer failure is reported.
 *
 * A disk that filled up is worth another try; a film that cannot be rendered is not.
 * The distinction is in the reason the renderer gave, and the reason is checked rather
 * than assumed.
 */
export function classifyRenderFailure(error: NativeRenderError): { code: string; message: string; retryable: boolean } {
  const message = String(error.message ?? "");
  if (/no space left|ENOSPC/iu.test(message)) {
    return { code: "RENDER_OUT_OF_SPACE", message: "the renderer ran out of space", retryable: true };
  }
  if (error.code === "RENDER_TIMEOUT") {
    return { code: "RENDER_TIMEOUT", message: "the renderer did not finish in time", retryable: true };
  }
  if (error.code === "RENDER_CANCELLED") {
    return { code: "RENDER_CANCELLED", message: "the render was cancelled", retryable: true };
  }
  return { code: error.code, message, retryable: error.retryable };
}

/**
 * Apply the rule that a warned check needs a recorded decision.
 *
 * A warning is not a failure, but it is not a silent pass either: the contract asks
 * for a decision that a person made, and the decision is MAIN's to hold. A warning
 * whose id is not among the recorded decisions blocks the delivery.
 *
 * The function is exported so that the rule can be checked on its own, with the checks
 * it is about, and not only through a whole render.
 */
export function applyDispositionGate(items: readonly QCItem[], dispositions: readonly string[]): QCItem[] {
  const recorded = new Set(dispositions);
  const undispositioned = items.filter((item) => item.status === "warn" && !recorded.has(item.id));
  if (undispositioned.length === 0) return [...items];
  return [
    ...items,
    {
      id: "qc_disposition",
      status: "block",
      reason: `a warned check has no recorded decision: ${undispositioned.map((item) => item.id).join(", ")}`,
      evidence_ref: null,
    },
  ];
}

export class SnapshotRenderService implements RenderPort {
  readonly #deps: SnapshotRenderServiceDeps;

  constructor(deps: SnapshotRenderServiceDeps) {
    this.#deps = deps;
  }

  async render(request: RenderRequest): Promise<RenderOutcome> {
    const identity: AttemptIdentity = {
      project_id: request.project_id,
      job_id: request.job_id,
      attempt: request.attempt,
      execution: request.execution,
    };

    const claimed = await this.#deps.fence.claimAttempt(identity);
    if (!claimed) {
      return failure("ATTEMPT_NOT_CLAIMED", "another attempt is already running for this job", true);
    }

    let staging: string | null = null;
    let requiresReconciliation = false;
    try {
      const initialVerdict = await this.#deps.fence.checkAttempt(identity);
      if (initialVerdict !== "proceed" || request.signal?.aborted) {
        const cancelled = initialVerdict === "cancelled" || request.signal?.aborted;
        return failure(cancelled ? "ATTEMPT_CANCELLED" : "ATTEMPT_SUPERSEDED",
          "the persistent attempt no longer permits rendering", true);
      }
      await this.#deps.packages.prepare();

      // 1. The snapshot. MAIN is the only one that knows whether it is committed.
      let closure: SnapshotClosure;
      try {
        closure = await this.#deps.snapshots.readSnapshot({
          project_id: request.project_id,
          snapshot_id: request.snapshot_id,
          source_digest: request.source_digest,
        });
      } catch (error) {
        return failure("SNAPSHOT_UNAVAILABLE", `the snapshot could not be read: ${String((error as Error).message)}`, false);
      }

      // 2. Everything that can be checked without a frame.
      const preflight = await runPreflight({
        closure,
        render_spec: request.render_spec,
        project_id: request.project_id,
        snapshot_id: request.snapshot_id,
        expected_source_digest: request.source_digest,
        upstream_root: this.#deps.upstream_root,
        staging_parent: this.#deps.packages.stagingRoot,
        required_supplements: [...MANDATORY_A_SUPPLEMENT_ROLES, ...request.required_supplements],
        ...(this.#deps.pin_verifier === undefined ? {} : { pin_verifier: this.#deps.pin_verifier }),
      });
      const preflightItems: QCItem[] = preflight.findings.map((finding) => ({
        id: finding.id,
        status: finding.status,
        reason: finding.reason,
        evidence_ref: null,
      }));
      if (!preflight.ok) {
        return blocked(preflightItems, preflight.blocking.map((finding) => `${finding.id}: ${finding.reason}`).join("; "));
      }

      // 3. The delivery key. One key, one package: a second attempt for the same film
      //    and the same configuration finds the first one's package instead of
      //    publishing a second copy.
      const configDigest = computeRenderConfigDigest({
        render_spec: request.render_spec,
        upstream_sha: RENDER_PIN.upstream_sha,
        worker_sha256: RENDER_PIN.worker_sha256,
      });
      const key = {
        project_id: request.project_id,
        snapshot_id: request.snapshot_id,
        render_config_digest: configDigest,
      };
      const deliveryId = deriveDeliveryId(key);
      const packageId = derivePackageId(key);
      const downloadRef = deriveDownloadRef(packageId);

      // 4. The film's own copy. The live project is never rendered.
      staging = await this.#deps.packages.createStaging(`attempt${request.attempt}`);
      let copy: SnapshotCopy;
      try {
        copy = await copySnapshotClosure({ closure, staging_root: staging });
      } catch (error) {
        if (error instanceof SnapshotCopyError) {
          return failure(error.code, error.message, false);
        }
        throw error;
      }

      // A copy can be slow. Re-read durable cancellation/fencing immediately before
      // launching any browser/encoder; an AbortSignal is not the durable authority.
      const renderVerdict = await this.#deps.fence.checkAttempt(identity);
      if (renderVerdict !== "proceed" || request.signal?.aborted) {
        await this.#deps.packages.quarantineStaging(staging, `fenced-before-render-${request.attempt}`);
        const cancelled = renderVerdict === "cancelled" || request.signal?.aborted;
        return failure(cancelled ? "ATTEMPT_CANCELLED" : "ATTEMPT_SUPERSEDED",
          "the persistent attempt changed while preparing the snapshot", true);
      }
      // 5. The render itself.
      const outPath = resolve(staging, PACKAGE_FILES.media);
      try {
        await this.#deps.native_renderer.render({
          project_root: copy.project_root,
          native_entry: copy.native_entry,
          out_path: outPath,
          staging_root: staging,
          upstream_root: this.#deps.upstream_root,
          width: request.render_spec.width,
          height: request.render_spec.height,
          fps: request.render_spec.fps_numerator / request.render_spec.fps_denominator,
          timeout_ms: this.#deps.render_timeout_ms ?? DEFAULT_RENDER_TIMEOUT_MS,
          signal: request.signal,
        });
      } catch (error) {
        if (error instanceof NativeRenderCancelled) {
          // The renderer is gone; its children may not be. When they could not be seen
          // to end, MAIN has to record a reconciling fact and the attempt stays claimed.
          requiresReconciliation = error.group_settled !== true;
          await this.#deps.packages.quarantineStaging(staging, `cancelled-${request.attempt}`);
          return failure("RENDER_CANCELLED", "the render was cancelled", true, requiresReconciliation);
        }
        if (error instanceof NativeRenderError) {
          const classified = classifyRenderFailure(error);
          // The renderer is gone, but its children may not be. That is true for a
          // failure and for a timeout, not only for a cancellation: whatever may still
          // be running has to be reported, and the attempt has to stay claimed.
          requiresReconciliation = error.group_settled !== true;
          await this.#deps.packages.quarantineStaging(staging, `failed-${request.attempt}`);
          return failure(classified.code, classified.message, classified.retryable, requiresReconciliation);
        }
        throw error;
      }

      // 6. The inputs have to be the inputs the snapshot recorded.
      try {
        await verifySnapshotCopy(copy);
      } catch (error) {
        if (error instanceof SnapshotCopyError) {
          await this.#deps.packages.quarantineStaging(staging, `tampered-${request.attempt}`);
          return failure(error.code, error.message, false);
        }
        throw error;
      }

      const mediaSize = await stat(outPath).then((info) => info.size).catch(() => 0);
      if (mediaSize <= 0) {
        await this.#deps.packages.quarantineStaging(staging, `empty-${request.attempt}`);
        return failure("MEDIA_EMPTY", "the renderer produced no file", true);
      }

      await this.#boundary("encode_finished", {
        project_id: request.project_id,
        job_id: request.job_id,
        snapshot_id: request.snapshot_id,
        attempt: request.attempt,
        manifest: null,
        delivery_id: deliveryId,
      });

      // 7. The quality control: the file itself, and the files that travel with it.
      //    The digests are the ones the snapshot committed to, not the ones the copies
      //    happen to have.
      const supplementChecks: SupplementCheck[] = [];
      const supplementEntries = closure.entries.filter((entry) => entry.kind === "supplement");
      for (const [index, entry] of supplementEntries.entries()) {
        const path = resolve(copy.project_root, entry.relative_path);
        const bytes = await readFile(path).catch(() => null);
        supplementChecks.push({
          id: `sup${index}`,
          role: entry.role ?? "",
          sha256: entry.sha256,
          bytes: entry.bytes,
          actual_sha256: bytes === null ? null : sha256Of(bytes),
          actual_bytes: bytes === null ? null : bytes.byteLength,
        });
      }

      const qc = await runQualityControl({
        media_path: outPath,
        delivery_id: deliveryId,
        render_spec: request.render_spec,
        supplements: supplementChecks,
        required_supplements: [...MANDATORY_A_SUPPLEMENT_ROLES, ...request.required_supplements],
        expected_frames: closure.expected_frames,
        expected_duration_seconds: closure.expected_duration_seconds,
        runner: this.#deps.qc_runner ?? realMediaToolRunner,
        timeout_ms: this.#deps.qc_timeout_ms ?? DEFAULT_QC_TIMEOUT_MS,
        signal: request.signal,
      });

      // The same bounded process lifecycle governs QC. A cancellation is not proof
      // that a tool stopped; only the runner's close/group confirmation can say that.
      requiresReconciliation = qc.requires_reconciliation;
      if (request.signal?.aborted === true) {
        return failure("RENDER_CANCELLED", "the render was cancelled during quality control", true, requiresReconciliation);
      }

      // Every check the preflight made is carried on. A warning that the preflight
      // raised is a warning the delivery has, and a warning without a recorded
      // decision blocks it.
      const qcItems = applyDispositionGate(
        [...preflightItems, ...qc.items],
        request.qc_dispositions ?? [],
      );

      await this.#boundary("qc_finished", {
        project_id: request.project_id,
        job_id: request.job_id,
        snapshot_id: request.snapshot_id,
        attempt: request.attempt,
        manifest: null,
        delivery_id: deliveryId,
      });

      if (qcItems.some((item) => item.status === "block")) {
        await this.#deps.packages.quarantineStaging(staging, `blocked-${request.attempt}`);
        return blocked(
          qcItems,
          qcItems.filter((item) => item.status === "block").map((item) => `${item.id}: ${item.reason}`).join("; "),
          requiresReconciliation,
        );
      }

      // 8. The fence, once more. A render that was cancelled while it encoded must not
      //    become a delivery afterwards.
      const verdict = await this.#deps.fence.checkAttempt(identity);
      if (verdict !== "proceed") {
        await this.#deps.packages.quarantineStaging(staging, `fenced-${verdict}-${request.attempt}`);
        return failure(verdict === "cancelled" ? "ATTEMPT_CANCELLED" : "ATTEMPT_SUPERSEDED",
          verdict === "cancelled" ? "the attempt was cancelled before the package was published" : "another attempt took over", true);
      }

      // 9. The package.
      const probePath = resolve(staging, PACKAGE_FILES.ffprobe);
      const decodePath = resolve(staging, PACKAGE_FILES.fullDecode);
      await writeFile(probePath, qc.probe_bytes, { mode: 0o600 });
      await writeFile(decodePath, qc.decode_bytes, { mode: 0o600 });

      const files: Array<{ id: string; name: string; source_path: string }> = [
        { id: packageRefId(deliveryId, PACKAGE_ROLES.media), name: PACKAGE_FILES.media, source_path: outPath },
        { id: packageRefId(deliveryId, PACKAGE_ROLES.ffprobe), name: PACKAGE_FILES.ffprobe, source_path: probePath },
        { id: packageRefId(deliveryId, PACKAGE_ROLES.fullDecode), name: PACKAGE_FILES.fullDecode, source_path: decodePath },
      ];

      const supplementRefs: Ref[] = [];
      for (const [index, entry] of supplementEntries.entries()) {
        const source = resolve(copy.project_root, entry.relative_path);
        const name = supplementFileName(index, extname(entry.relative_path));
        const target = resolve(staging, name);
        await copyFile(source, target);
        const digest = await sha256File(target);
        if (digest === null || digest !== entry.sha256) {
          // The copy does not match what the snapshot committed to. The committed
          // digest is the one that goes into the manifest; a copy that disagrees is
          // not published under it.
          await this.#deps.packages.quarantineStaging(staging, `supplement-${request.attempt}`);
          return failure("SUPPLEMENT_CHANGED", `the copied ${entry.role ?? entry.relative_path} does not match the bytes the snapshot committed to`, false);
        }
        supplementRefs.push({ id: packageRefId(deliveryId, `sup${index}`), version: 1, sha256: digest });
        files.push({ id: packageRefId(deliveryId, `sup${index}`), name, source_path: target });
      }

      // The native, editable source travels with the package: the film's own document
      // and a list of the source files with the digests the snapshot committed to. A
      // package that holds only an MP4 would present a flat film as if it were the
      // project; this one says which project it came from and carries its document.
      const nativeDocumentPath = resolve(staging, PACKAGE_FILES.nativeDocument);
      await copyFile(resolve(copy.project_root, copy.native_entry), nativeDocumentPath);
      const nativeDocumentDigest = await sha256File(nativeDocumentPath);
      const nativeEntry = closure.entries.find((entry) => entry.relative_path === copy.native_entry);
      if (nativeDocumentDigest === null || nativeDocumentDigest !== nativeEntry?.sha256) {
        await this.#deps.packages.quarantineStaging(staging, `native-${request.attempt}`);
        return failure("NATIVE_DOCUMENT_CHANGED", "the film's own document does not match the bytes the snapshot committed to", false);
      }
      const nativeSourcePath = resolve(staging, PACKAGE_FILES.nativeSource);
      await writeFile(nativeSourcePath, `${JSON.stringify({
        kind: "narralens.native_project_attachment@1.0",
        // What this file is, exactly: the film's own document and the list of the
        // snapshot's files. It is not an export of the whole editable project — the
        // assets stay in the snapshot, which is the authoritative editable source.
        scope: "document_and_closure_reference",
        editable_project_complete: false,
        note: "the package carries the film's entry document; the snapshot remains the authoritative editable source",
        project_id: closure.project_id,
        snapshot_id: closure.snapshot_id,
        source_digest: closure.source_digest,
        project_revision: closure.project_revision,
        native_entry: copy.native_entry,
        expected_frames: closure.expected_frames ?? null,
        expected_duration_seconds: closure.expected_duration_seconds ?? null,
        copied: closure.entries
          .filter((entry) => entry.relative_path === copy.native_entry)
          .map((entry) => ({ relative_path: entry.relative_path, sha256: entry.sha256, bytes: entry.bytes })),
        referenced: closure.entries
          .filter((entry) => entry.relative_path !== copy.native_entry)
          .map((entry) => ({ relative_path: entry.relative_path, sha256: entry.sha256, bytes: entry.bytes })),
      }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      files.push({
        id: packageRefId(deliveryId, PACKAGE_ROLES.nativeDocument),
        name: PACKAGE_FILES.nativeDocument,
        source_path: nativeDocumentPath,
      });
      files.push({
        id: packageRefId(deliveryId, PACKAGE_ROLES.nativeSource),
        name: PACKAGE_FILES.nativeSource,
        source_path: nativeSourcePath,
      });

      const mediaDigest = await sha256File(outPath);
      if (mediaDigest === null) {
        await this.#deps.packages.quarantineStaging(staging, `unreadable-${request.attempt}`);
        return failure("MEDIA_UNREADABLE", "the rendered file could not be read", true);
      }
      const mediaBytes = (await stat(outPath)).size;
      const mediaRef: Ref = { id: packageRefId(deliveryId, PACKAGE_ROLES.media), version: 1, sha256: mediaDigest };
      const ffprobeRef: Ref = { id: packageRefId(deliveryId, PACKAGE_ROLES.ffprobe), version: 1, sha256: sha256Of(qc.probe_bytes) };
      const fullDecodeRef: Ref = { id: packageRefId(deliveryId, PACKAGE_ROLES.fullDecode), version: 1, sha256: sha256Of(qc.decode_bytes) };

      const manifest: DeliveryManifest = buildDeliveryManifest({
        delivery_id: deliveryId,
        project_id: request.project_id,
        snapshot_id: request.snapshot_id,
        source_digest: request.source_digest,
        render_spec: request.render_spec,
        render_config_digest: configDigest,
        attempt: request.attempt,
        media_ref: mediaRef,
        ffprobe_ref: ffprobeRef,
        full_decode_ref: fullDecodeRef,
        supplement_refs: supplementRefs,
        qc: qcItems,
        published_at: new Date().toISOString(),
        download_ref: downloadRef,
      });
      assertManifestMatches(manifest, {
        project_id: request.project_id,
        snapshot_id: request.snapshot_id,
        source_digest: request.source_digest,
        render_config_digest: configDigest,
        attempt: request.attempt,
      });

      // 10. Publish. One package per key, no overwriting, and the object is complete
      //     before the receipt that names it exists.
      const published = await this.#deps.packages.publish({
        package_id: packageId,
        staging_dir: staging,
        files,
        manifest,
        published_at: manifest.published_at,
      });

      await this.#boundary("package_published", {
        project_id: request.project_id,
        job_id: request.job_id,
        snapshot_id: request.snapshot_id,
        attempt: published.manifest.attempt,
        manifest: published.manifest,
        delivery_id: published.manifest.delivery_id,
      });

      // 11. The fence, a third time. The package is published but the record is not
      //     written yet, and a cancelled attempt must not produce a record.
      const finalVerdict = await this.#deps.fence.checkAttempt(identity);
      if (finalVerdict !== "proceed") {
        await this.#deps.packages.quarantineStaging(staging, `fenced-late-${request.attempt}`);
        return failure(finalVerdict === "cancelled" ? "ATTEMPT_CANCELLED" : "ATTEMPT_SUPERSEDED",
          finalVerdict === "cancelled"
            ? "the attempt was cancelled before the delivery was recorded; the package is published and awaits reconciliation"
            : "another attempt took over; the package is published and awaits reconciliation", true);
      }

      // 12. MAIN records it. One transaction: the receipt, the state and the event.
      try {
        await this.#deps.commit.commitReady({
          project_id: request.project_id,
          job_id: request.job_id,
          snapshot_id: request.snapshot_id,
          source_digest: request.source_digest,
          attempt: published.manifest.attempt,
          delivery_id: published.manifest.delivery_id,
          manifest: published.manifest,
          download_ref: published.manifest.download_ref,
          execution: request.execution,
          package_id: published.package_id,
          object_id: published.object_id,
        }, this.#deps.hooks);
      } catch (error) {
        // The package is published but not recorded. That is one of the three states a
        // crash between the publish and the record is allowed to leave, and it is
        // recoverable: the package is found by its key and the record is written then.
        return failure("COMMIT_FAILED", `the package was published but could not be recorded: ${String((error as Error).message)}`, true);
      }

      return {
        state: "ready",
        manifest: published.manifest,
        qc: "passed",
        artifact_ref: published.manifest.media_ref,
        download_ref: published.manifest.download_ref,
        failure: null,
        qc_items: qcItems,
        requires_reconciliation: false,
      };
    } finally {
      if (staging !== null) {
        // Only this attempt's own staging directory. A published package lives in the
        // published root and in the objects root, and is not touched here.
        if (requiresReconciliation) {
          // Something may still be running: the bytes are kept, not thrown away.
          await this.#deps.packages.quarantineStaging(staging, `unsettled-${request.attempt}`);
        } else {
          await this.#deps.packages.discardStaging(staging);
        }
      }
      if (requiresReconciliation) {
        // The attempt stays claimed: a process that may still be writing must not be
        // allowed to start a second attempt against the same job.
      } else {
        // The release is best effort: an attempt that cannot give its claim back must
        // not turn a completed render into a failed one.
        await this.#deps.fence.releaseAttempt(identity).catch(() => undefined);
      }
    }
  }

  async #boundary(boundary: RenderBoundary, context: RenderBoundaryContext): Promise<void> {
    await this.#deps.hooks.onBoundary(boundary, context);
  }
}

/** The directory a delivery's packages are published in. */
export async function prepareDeliveryRoot(root: string): Promise<void> {
  await mkdir(root, { recursive: true, mode: 0o700 });
}
