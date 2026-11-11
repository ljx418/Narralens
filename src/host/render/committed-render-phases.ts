import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, open, readdir, readFile, rename, rm, stat, writeFile, type FileHandle } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import type { DeliveryManifest, QCItem, Ref } from "../../contracts/agent-driven-types.js";
import { canonicalDigest } from "../creative/digest.js";
import { assertManifestMatches, buildDeliveryManifest } from "../delivery/manifest.js";
import { PACKAGE_FILES, PACKAGE_ROLES, packageRefId, supplementFileName } from "../delivery/package-layout.js";
import { realMediaToolRunner, runQualityControl, type SupplementCheck } from "../delivery/qc.js";
import { MANDATORY_A_SUPPLEMENT_ROLES, runPreflight } from "../preflight/preflight.js";
import { NativeRenderCancelled, NativeRenderError } from "./native-renderer.js";
import {
  applyDispositionGate,
  buildSupplementChecks,
  DEFAULT_QC_TIMEOUT_MS,
  DEFAULT_RENDER_TIMEOUT_MS,
  nativeSourceAttachment,
  renderStageKeys,
  sha256FileDigest,
} from "./render-snapshot.js";
import { assertSafeRelativePath, copySnapshotClosure, SnapshotCopyError, verifySnapshotCopy } from "./snapshot-copy.js";
import {
  CommittedRenderPhaseError,
  phaseReceiptDigest,
  PHASE_OBJECT_MAX_READ_BYTES,
  type AttemptIdentity,
  type CommittedRenderPhasesDeps,
  type CommittedRenderPhasesPort,
  type EncodedFactV1,
  type InspectEncodedInput,
  type PhaseObjectFileV1,
  type PhaseObjectHandle,
  type PhaseObjectOpenInput,
  type PhaseObjectResolver,
  type PublishedPhaseReceiptV1,
  type PublishValidatedInput,
  type QcReceiptV1,
  type RenderRequest,
  type SnapshotClosure,
} from "./ports.js";

/**
 * The three media stages of a committed render.
 *
 * The legacy `SnapshotRenderService` is a facade: one call runs preflight, copy,
 * render, inspect, package, publish and record. That is the right shape for a Host that
 * owns the whole job, and the wrong shape for a run whose chapters are rendered one at a
 * time, each of them inspected, each of them waiting for a person before it is
 * published. This module is the same work split at the points where a fact becomes
 * durable.
 *
 * Five rules shape it, and they are the rules of the canonical interface lock:
 *
 * - **A stage never claims a job and never records a fact.** The executor holds the
 *   real lease and records the facts in its own transaction. A stage asks the fence
 *   whether the attempt it is bound to may still act, before and after every wait and
 *   before every publication.
 * - **The object comes before the fact.** The bytes are written, hashed and made
 *   durable first, and only then does a receipt name them. A crash in between leaves a
 *   private orphan that MAIN reconciles — never a half-written object, and never a fact
 *   that names bytes which do not exist.
 * - **A successful object is never removed.** Not by `close`, not by a later failure,
 *   not by a retry. Only an *untransferred* staging directory is ever deleted.
 * - **The inspection never touches the encoded object.** It writes its own immutable
 *   object with the probe and the decode output, and the encoded object stays exactly
 *   as the encoder left it.
 * - **A technical pass is not an acceptance.** The inspection says what the tools
 *   found; the publication still refuses a blocked inspection and still refuses a
 *   warning without a recorded disposition.
 */

const HASH = /^[a-f0-9]{64}$/u;
const OBJECT_ID = /^[A-Za-z0-9_-]{1,64}$/u;

/** The largest number of bytes one read of a phase object may return. */
export { PHASE_OBJECT_MAX_READ_BYTES } from "./ports.js";

/** The roles the files of an encoded object fill. */
const ENCODED_ROLES = Object.freeze({
  media: PACKAGE_ROLES.media,
  nativeDocument: PACKAGE_ROLES.nativeDocument,
  nativeSource: PACKAGE_ROLES.nativeSource,
});

/** The roles the files of an inspection object fill. */
const QC_ROLES = Object.freeze({
  probe: PACKAGE_ROLES.ffprobe,
  decode: PACKAGE_ROLES.fullDecode,
});

function contentTypeOf(relative_path: string): string {
  switch (extname(relative_path).toLowerCase()) {
    case ".json": return "application/json";
    case ".html": return "text/html; charset=utf-8";
    case ".vtt": return "text/vtt; charset=utf-8";
    case ".txt": return "text/plain; charset=utf-8";
    case ".log": return "text/plain; charset=utf-8";
    case ".mp4": return "video/mp4";
    default: return "application/octet-stream";
  }
}

async function syncFileOf(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectoryOf(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Make every directory of a tree durable, deepest first. */
async function syncTreeOf(root: string): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) await syncTreeOf(resolve(root, entry.name));
  }
  await syncDirectoryOf(root);
}

/**
 * The digest of a file, read through an open descriptor.
 *
 * The bytes are hashed on the very descriptor that will later serve them, so the
 * digest and the served bytes cannot be two different things.
 */
async function digestOfHandle(handle: FileHandle, bytes: number): Promise<string> {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let position = 0;
  for (;;) {
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
    if (bytesRead === 0) break;
    position += bytesRead;
    if (position > bytes) throw new CommittedRenderPhaseError("OBJECT_TOO_LARGE", "the object file is larger than it was recorded to be", false);
    hash.update(buffer.subarray(0, bytesRead));
  }
  if (position !== bytes) {
    throw new CommittedRenderPhaseError("OBJECT_SIZE_CHANGED", "the object file is not the size it was recorded to be", false);
  }
  return hash.digest("hex");
}

/**
 * One verified, read-only handle on a file of an immutable phase object.
 *
 * The descriptor is opened once, with `O_NOFOLLOW`, and the digest is computed on that
 * descriptor. Every read afterwards comes from the same descriptor, so a file that is
 * swapped underneath the handle cannot make the handle serve different bytes than the
 * ones it verified.
 */
class ImmutablePhaseObjectHandle implements PhaseObjectHandle {
  readonly object_id: string;
  readonly relative_path: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly content_type: string;
  readonly #handle: FileHandle;
  #closed = false;

  constructor(input: {
    readonly object_id: string;
    readonly relative_path: string;
    readonly bytes: number;
    readonly sha256: string;
    readonly handle: FileHandle;
  }) {
    this.object_id = input.object_id;
    this.relative_path = input.relative_path;
    this.bytes = input.bytes;
    this.sha256 = input.sha256;
    this.content_type = contentTypeOf(input.relative_path);
    this.#handle = input.handle;
  }

  async read(range: { readonly offset: number; readonly length: number }): Promise<Uint8Array> {
    if (this.#closed) throw new CommittedRenderPhaseError("OBJECT_CLOSED", "the phase object handle is closed", false);
    const offset = range.offset;
    const length = range.length;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0) {
      throw new CommittedRenderPhaseError("READ_RANGE_REJECTED", "the requested range is not a usable range", false);
    }
    if (length > PHASE_OBJECT_MAX_READ_BYTES) {
      throw new CommittedRenderPhaseError("READ_TOO_LARGE", `a phase object read may return at most ${PHASE_OBJECT_MAX_READ_BYTES} bytes`, false);
    }
    if (offset + length > this.bytes) {
      throw new CommittedRenderPhaseError("READ_OUT_OF_RANGE", "the requested range is outside the file", false);
    }
    const buffer = Buffer.alloc(length);
    if (length === 0) return new Uint8Array(buffer);
    let read = 0;
    while (read < length) {
      const { bytesRead } = await this.#handle.read(buffer, read, length - read, offset + read);
      if (bytesRead === 0) break;
      read += bytesRead;
    }
    if (read !== length) throw new CommittedRenderPhaseError("READ_SHORT", "the object file ended before the requested range was read", false);
    return new Uint8Array(buffer);
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#handle.close();
  }
}

/**
 * The media stages of a committed render.
 *
 * The service owns two Host-selected private roots and nothing else: the workspace
 * where an attempt's staging happens, and the object root where the immutable objects
 * live. It owns no database, no job table and no state machine.
 */
export class CommittedRenderPhases implements CommittedRenderPhasesPort, PhaseObjectResolver {
  readonly #deps: CommittedRenderPhasesDeps;
  readonly #objectRoot: string;
  readonly #objectsDir: string;
  readonly #stagingDir: string;
  readonly #workspaceRoot: string;
  readonly #open = new Set<PhaseObjectHandle>();
  #closed = false;

  constructor(deps: CommittedRenderPhasesDeps) {
    this.#deps = deps;
    this.#objectRoot = resolve(deps.object_root);
    this.#objectsDir = resolve(this.#objectRoot, "objects");
    this.#stagingDir = resolve(this.#objectRoot, "staging");
    this.#workspaceRoot = resolve(deps.workspace_root);
  }

  /* ------------------------------------------------------------------------------------ */
  /* The three stages                                                                       */
  /* ------------------------------------------------------------------------------------ */

  /**
   * Encode the committed closure and return the immutable encoded fact.
   *
   * The order is the one the contract demands: the snapshot is read, everything that can
   * be checked without a frame is checked, the closure is copied, the fence is asked
   * again, the film is rendered, the copy is verified, the bytes are made durable in an
   * immutable object, and only then does the fact exist.
   */
  async prepareEncoded(request: RenderRequest): Promise<EncodedFactV1> {
    this.#assertOpen();
    const identity = this.#identityOf(request);
    await this.#fence(request, identity, "before the snapshot was read");

    let closure: SnapshotClosure;
    try {
      closure = await this.#deps.snapshots.readSnapshot({
        project_id: request.project_id,
        snapshot_id: request.snapshot_id,
        source_digest: request.source_digest,
      });
    } catch (error) {
      throw new CommittedRenderPhaseError("SNAPSHOT_UNAVAILABLE", `the snapshot could not be read: ${String((error as Error).message)}`, false);
    }
    if (closure.project_id !== request.project_id || closure.snapshot_id !== request.snapshot_id) {
      throw new CommittedRenderPhaseError("SNAPSHOT_MISMATCH", "the snapshot that was read is not the snapshot that was asked for", false);
    }
    if (closure.source_digest !== request.source_digest) {
      throw new CommittedRenderPhaseError("SNAPSHOT_CHANGED", "the snapshot no longer has the digest the request named", false);
    }
    if (closure.expected_frames === undefined) {
      throw new CommittedRenderPhaseError("SNAPSHOT_LENGTH_UNKNOWN", "the snapshot does not say how many frames the film has, so no encoded fact can state a frame count", false);
    }

    const stageKeys = renderStageKeys(request.project_id, request.snapshot_id, request.render_spec);

    // 1. Everything that can be checked without a frame. A closure that is incomplete
    //    or uncleared is refused before an encoder is started.
    const preflight = await runPreflight({
      closure,
      render_spec: request.render_spec,
      project_id: request.project_id,
      snapshot_id: request.snapshot_id,
      expected_source_digest: request.source_digest,
      upstream_root: this.#deps.upstream_root,
      staging_parent: this.#workspaceRoot,
      required_supplements: [...MANDATORY_A_SUPPLEMENT_ROLES, ...request.required_supplements],
      ...(this.#deps.pin_verifier === undefined ? {} : { pin_verifier: this.#deps.pin_verifier }),
    });
    if (!preflight.ok) {
      throw new CommittedRenderPhaseError(
        "PREFLIGHT_BLOCKED",
        preflight.blocking.map((finding) => `${finding.id}: ${finding.reason}`).join("; "),
        false,
      );
    }

    // 2. The film's own copy. The live project is never rendered.
    const workspace = await this.#createWorkspaceStaging();
    let objectStaging: string | null = null;
    try {
      let copy;
      try {
        copy = await copySnapshotClosure({ closure, staging_root: workspace });
      } catch (error) {
        if (error instanceof SnapshotCopyError) {
          throw new CommittedRenderPhaseError(error.code, error.message, false);
        }
        throw error;
      }

      // A copy can be slow. Re-read the durable cancellation before launching any
      // encoder: an AbortSignal is not the durable authority.
      await this.#fence(request, identity, "before the film was rendered");

      const outPath = resolve(workspace, PACKAGE_FILES.media);
      try {
        await this.#deps.native_renderer.render({
          project_root: copy.project_root,
          native_entry: copy.native_entry,
          frame_count: closure.expected_frames,
          out_path: outPath,
          staging_root: workspace,
          upstream_root: this.#deps.upstream_root,
          width: request.render_spec.width,
          height: request.render_spec.height,
          fps: request.render_spec.fps_numerator / request.render_spec.fps_denominator,
          timeout_ms: this.#deps.render_timeout_ms ?? DEFAULT_RENDER_TIMEOUT_MS,
          signal: request.signal,
        });
      } catch (error) {
        if (error instanceof NativeRenderCancelled) {
          throw new CommittedRenderPhaseError("RENDER_CANCELLED", "the render was cancelled", true, error.group_settled !== true);
        }
        if (error instanceof NativeRenderError) {
          throw new CommittedRenderPhaseError(error.code, error.message, error.retryable, error.group_settled !== true);
        }
        throw error;
      }

      // 3. The inputs have to be the inputs the snapshot recorded.
      try {
        await verifySnapshotCopy(copy);
      } catch (error) {
        if (error instanceof SnapshotCopyError) {
          throw new CommittedRenderPhaseError(error.code, error.message, false);
        }
        throw error;
      }

      const mediaSize = await stat(outPath).then((info) => info.size).catch(() => 0);
      if (mediaSize <= 0) {
        throw new CommittedRenderPhaseError("MEDIA_EMPTY", "the renderer produced no file", true);
      }

      // 4. The immutable object. Everything is written, hashed and made durable before
      //    the object is published under its own name.
      const object_id = `obj_${randomUUID().replace(/-/gu, "")}`;
      objectStaging = await this.#createObjectStaging();
      const files: PhaseObjectFileV1[] = [];

      const mediaDigest = await this.#stageCopiedFile(objectStaging, PACKAGE_FILES.media, ENCODED_ROLES.media, packageRefId(stageKeys.delivery_id, PACKAGE_ROLES.media), outPath);
      files.push(mediaDigest);

      const nativeEntry = closure.entries.find((entry) => entry.relative_path === copy.native_entry);
      if (nativeEntry === undefined) {
        throw new CommittedRenderPhaseError("FILM_DOCUMENT_NOT_IN_CLOSURE", "the film's own document is not part of the snapshot's closure", false);
      }
      const nativeDocument = await this.#stageCopiedFile(
        objectStaging,
        PACKAGE_FILES.nativeDocument,
        ENCODED_ROLES.nativeDocument,
        packageRefId(stageKeys.delivery_id, PACKAGE_ROLES.nativeDocument),
        resolve(copy.project_root, copy.native_entry),
      );
      files.push(nativeDocument);

      const nativeSourceText = `${JSON.stringify(nativeSourceAttachment(closure, copy.native_entry), null, 2)}\n`;
      const nativeSource = await this.#stageWrittenFile(
        objectStaging,
        PACKAGE_FILES.nativeSource,
        ENCODED_ROLES.nativeSource,
        packageRefId(stageKeys.delivery_id, PACKAGE_ROLES.nativeSource),
        nativeSourceText,
      );
      files.push(nativeSource);

      const supplementEntries = closure.entries.filter((entry) => entry.kind === "supplement");
      for (const [index, entry] of supplementEntries.entries()) {
        const name = supplementFileName(index, extname(entry.relative_path));
        const staged = await this.#stageCopiedFile(
          objectStaging,
          name,
          entry.role ?? `sup${index}`,
          packageRefId(stageKeys.delivery_id, `sup${index}`),
          resolve(copy.project_root, entry.relative_path),
        );
        if (staged.sha256 !== entry.sha256 || staged.bytes !== entry.bytes) {
          throw new CommittedRenderPhaseError("SUPPLEMENT_CHANGED", `the copied ${entry.role ?? entry.relative_path} does not match the bytes the snapshot committed to`, false);
        }
        files.push(staged);
      }

      await syncTreeOf(objectStaging);

      // 5. The fence, once more, immediately before the object is published. A render
      //    that was cancelled while it encoded must not become an object.
      await this.#fence(request, identity, "before the encoded object was published");

      const objectId = await this.#publishObject(object_id, objectStaging);
      objectStaging = null;

      const media = files.find((file) => file.role === ENCODED_ROLES.media);
      if (media === undefined) {
        throw new CommittedRenderPhaseError("MEDIA_MISSING", "the encoded object does not hold the film", false);
      }

      const content = {
        format: "narralens.encoded-fact@1" as const,
        project_id: request.project_id,
        job_id: request.job_id,
        producer_execution: request.execution,
        producer_lease_attempt: request.attempt,
        snapshot_id: request.snapshot_id,
        source_digest: request.source_digest,
        render_spec: request.render_spec,
        config_digest: stageKeys.config_digest,
        media_object_id: objectId,
        media_ref: { id: media.id, version: 1, sha256: media.sha256 } satisfies Ref,
        files,
        frame_count: closure.expected_frames,
        fps_numerator: request.render_spec.fps_numerator,
        fps_denominator: request.render_spec.fps_denominator,
        closure_digest: closureDigestOf(closure),
        rights_digest: rightsDigestOf(closure),
        created_at: new Date().toISOString(),
      };
      const encoded: EncodedFactV1 = { ...content, receipt_digest: phaseReceiptDigest({ ...content, receipt_digest: "" }) };
      return encoded;
    } finally {
      // Only this attempt's own staging. A published object is never touched here.
      if (objectStaging !== null) await rm(objectStaging, { recursive: true, force: true }).catch(() => undefined);
      await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /**
   * Inspect the encoded object and return the immutable quality-control receipt.
   *
   * The encoded object is reopened and re-verified before anything is inspected: the
   * closure and the rights the snapshot carries now have to be the ones the encoder
   * saw, or the inspection would describe something else. The inspection writes its
   * own object and never touches the encoded one.
   */
  async inspectEncoded(input: InspectEncodedInput): Promise<QcReceiptV1> {
    this.#assertOpen();
    const request = input.request;
    const encoded = input.encoded;
    const identity = this.#identityOf(request);
    await this.#fence(request, identity, "before the encoded object was inspected");

    this.#assertReceipt(encoded);
    if (encoded.project_id !== request.project_id || encoded.snapshot_id !== request.snapshot_id || encoded.source_digest !== request.source_digest) {
      throw new CommittedRenderPhaseError("ENCODED_MISMATCH", "the encoded fact is not about the snapshot this request names", false);
    }
    const stageKeys = renderStageKeys(request.project_id, request.snapshot_id, request.render_spec);
    if (encoded.config_digest !== stageKeys.config_digest) {
      throw new CommittedRenderPhaseError("CONFIG_MISMATCH", "the encoded fact was produced by another configuration", false);
    }

    // The closure is read again, and it has to be the closure the encoder saw.
    const closure = await this.#readClosure(request);
    if (closureDigestOf(closure) !== encoded.closure_digest) {
      throw new CommittedRenderPhaseError("CLOSURE_CHANGED", "the committed closure is no longer the closure the film was rendered from", false);
    }
    if (rightsDigestOf(closure) !== encoded.rights_digest) {
      throw new CommittedRenderPhaseError("RIGHTS_CHANGED", "the rights of the closure are no longer the rights the film was rendered under", false);
    }

    // The encoded object is reopened, file by file, and every file is checked against
    // the fact that named it.
    const workspace = await this.#createWorkspaceStaging();
    try {
      const media = encoded.files.find((file) => file.id === encoded.media_ref.id);
      if (media === undefined) {
        throw new CommittedRenderPhaseError("ENCODED_MEDIA_MISSING", "the encoded fact does not name a media file", false);
      }
      const mediaPath = await this.#materialize(encoded.media_object_id, media, workspace);

      // The supplements are checked against the digests the snapshot recorded.
      const supplementFiles = encoded.files.filter((file) => file.id !== encoded.media_ref.id
        && file.role !== ENCODED_ROLES.nativeDocument
        && file.role !== ENCODED_ROLES.nativeSource);
      const supplementChecks: SupplementCheck[] = [];
      for (const [index, file] of supplementFiles.entries()) {
        const entry = closure.entries.filter((candidate) => candidate.kind === "supplement")[index];
        const expected = entry === undefined
          ? { sha256: file.sha256, bytes: file.bytes }
          : { sha256: entry.sha256, bytes: entry.bytes };
        supplementChecks.push({
          id: `sup${index}`,
          role: file.role,
          sha256: expected.sha256,
          bytes: expected.bytes,
          actual_sha256: file.sha256,
          actual_bytes: file.bytes,
        });
      }

      const preflight = await runPreflight({
        closure,
        render_spec: request.render_spec,
        project_id: request.project_id,
        snapshot_id: request.snapshot_id,
        expected_source_digest: request.source_digest,
        upstream_root: this.#deps.upstream_root,
        staging_parent: this.#workspaceRoot,
        required_supplements: [...MANDATORY_A_SUPPLEMENT_ROLES, ...request.required_supplements],
        ...(this.#deps.pin_verifier === undefined ? {} : { pin_verifier: this.#deps.pin_verifier }),
      });

      const qc = await runQualityControl({
        media_path: mediaPath,
        delivery_id: stageKeys.delivery_id,
        render_spec: request.render_spec,
        supplements: supplementChecks,
        required_supplements: [...MANDATORY_A_SUPPLEMENT_ROLES, ...request.required_supplements],
        expected_frames: closure.expected_frames,
        expected_duration_seconds: closure.expected_duration_seconds,
        runner: this.#deps.qc_runner ?? realMediaToolRunner,
        timeout_ms: this.#deps.qc_timeout_ms ?? DEFAULT_QC_TIMEOUT_MS,
        signal: request.signal,
      });

      if (request.signal?.aborted === true || qc.requires_reconciliation) {
        throw new CommittedRenderPhaseError(
          "QC_UNSETTLED",
          qc.requires_reconciliation
            ? "a media tool could not be confirmed stopped, so the inspection cannot be trusted"
            : "the inspection was cancelled",
          true,
          qc.requires_reconciliation,
        );
      }

      const qcItems: QCItem[] = [
        ...preflight.findings.map((finding) => ({
          id: finding.id,
          status: finding.status,
          reason: finding.reason,
          evidence_ref: null,
        })),
        ...qc.items,
      ];

      // The inspection object. It is its own immutable object; the encoded object is
      // not touched.
      const qc_object_id = `obj_${randomUUID().replace(/-/gu, "")}`;
      const objectStaging = await this.#createObjectStaging();
      let published = false;
      try {
        const probe = await this.#stageWrittenFile(
          objectStaging,
          PACKAGE_FILES.ffprobe,
          QC_ROLES.probe,
          packageRefId(stageKeys.delivery_id, PACKAGE_ROLES.ffprobe),
          qc.probe_bytes.toString("utf8"),
        );
        const decode = await this.#stageWrittenFile(
          objectStaging,
          PACKAGE_FILES.fullDecode,
          QC_ROLES.decode,
          packageRefId(stageKeys.delivery_id, PACKAGE_ROLES.fullDecode),
          qc.decode_bytes.toString("utf8"),
        );
        await syncTreeOf(objectStaging);
        await this.#fence(request, identity, "before the inspection object was published");
        const qcObjectId = await this.#publishObject(qc_object_id, objectStaging);
        published = true;

        const technical_status: "pass" | "warn" | "block" = qcItems.some((item) => item.status === "block")
          ? "block"
          : qcItems.some((item) => item.status === "warn") ? "warn" : "pass";

        const content = {
          format: "narralens.qc-receipt@1" as const,
          project_id: request.project_id,
          snapshot_id: request.snapshot_id,
          source_digest: request.source_digest,
          config_digest: stageKeys.config_digest,
          parent_encoded_digest: encoded.receipt_digest,
          qc_object_id: qcObjectId,
          qc_items: qcItems,
          technical_status,
          files: [probe, decode],
          created_at: new Date().toISOString(),
        };
        return { ...content, receipt_digest: phaseReceiptDigest({ ...content, receipt_digest: "" }) };
      } finally {
        if (!published) await rm(objectStaging, { recursive: true, force: true }).catch(() => undefined);
      }
    } finally {
      await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /**
   * Publish the delivery package from the already encoded and already inspected bytes.
   *
   * Nothing is rendered again and nothing is re-encoded: the package carries the very
   * bytes the encoder produced and the very evidence the inspection produced, and both
   * are reopened and re-verified first.
   */
  async publishValidated(input: PublishValidatedInput): Promise<PublishedPhaseReceiptV1> {
    this.#assertOpen();
    const request = input.request;
    const encoded = input.encoded;
    const qc = input.qc;
    const identity = this.#identityOf(request);
    await this.#fence(request, identity, "before the package was published");

    this.#assertReceipt(encoded);
    this.#assertReceipt(qc);
    if (qc.parent_encoded_digest !== encoded.receipt_digest) {
      throw new CommittedRenderPhaseError("QC_PARENT_MISMATCH", "the inspection receipt is not about this encoded fact", false);
    }
    if (encoded.project_id !== request.project_id || encoded.snapshot_id !== request.snapshot_id || encoded.source_digest !== request.source_digest) {
      throw new CommittedRenderPhaseError("ENCODED_MISMATCH", "the encoded fact is not about the snapshot this request names", false);
    }
    if (qc.project_id !== request.project_id || qc.snapshot_id !== request.snapshot_id || qc.source_digest !== request.source_digest) {
      throw new CommittedRenderPhaseError("QC_MISMATCH", "the inspection receipt is not about the snapshot this request names", false);
    }
    const stageKeys = renderStageKeys(request.project_id, request.snapshot_id, request.render_spec);
    if (encoded.config_digest !== stageKeys.config_digest || qc.config_digest !== stageKeys.config_digest) {
      throw new CommittedRenderPhaseError("CONFIG_MISMATCH", "the facts were produced by another configuration", false);
    }
    if (qc.technical_status === "block") {
      throw new CommittedRenderPhaseError("QC_BLOCKED", "the inspection blocked, so nothing is published", false);
    }

    // A warning is not a silent pass: it needs a recorded decision.
    const qcItems = applyDispositionGate(qc.qc_items, request.qc_dispositions ?? []);
    if (qcItems.some((item) => item.status === "block")) {
      throw new CommittedRenderPhaseError(
        "QC_DISPOSITION_MISSING",
        qcItems.filter((item) => item.status === "block").map((item) => `${item.id}: ${item.reason}`).join("; "),
        false,
      );
    }

    // The closure is read again and it has to be the one the facts describe.
    const closure = await this.#readClosure(request);
    if (closureDigestOf(closure) !== encoded.closure_digest || rightsDigestOf(closure) !== encoded.rights_digest) {
      throw new CommittedRenderPhaseError("CLOSURE_CHANGED", "the committed closure is no longer the closure the facts describe", false);
    }

    const staging = await this.#deps.packages.createStaging(`phase${request.attempt}`);
    try {
      // Every byte of the package comes out of the two immutable objects, and every
      // one of them is re-verified against the fact that named it.
      const packageFiles: Array<{ id: string; name: string; source_path: string }> = [];
      const supplementRefs: Ref[] = [];

      for (const file of encoded.files) {
        const source = await this.#materialize(encoded.media_object_id, file, staging);
        packageFiles.push({ id: file.id, name: file.relative_path, source_path: source });
        if (file.id !== encoded.media_ref.id
          && file.role !== ENCODED_ROLES.nativeDocument
          && file.role !== ENCODED_ROLES.nativeSource) {
          supplementRefs.push({ id: file.id, version: 1, sha256: file.sha256 });
        }
      }

      for (const file of qc.files) {
        const source = await this.#materialize(qc.qc_object_id, file, staging);
        packageFiles.push({ id: file.id, name: file.relative_path, source_path: source });
      }

      const media = encoded.files.find((file) => file.id === encoded.media_ref.id);
      if (media === undefined) {
        throw new CommittedRenderPhaseError("ENCODED_MEDIA_MISSING", "the encoded fact does not name a media file", false);
      }
      const probe = qc.files.find((file) => file.role === QC_ROLES.probe);
      const decode = qc.files.find((file) => file.role === QC_ROLES.decode);
      if (probe === undefined || decode === undefined) {
        throw new CommittedRenderPhaseError("QC_EVIDENCE_MISSING", "the inspection receipt does not name its evidence", false);
      }

      const mediaRef: Ref = { id: encoded.media_ref.id, version: 1, sha256: media.sha256 };
      const ffprobeRef: Ref = { id: probe.id, version: 1, sha256: probe.sha256 };
      const fullDecodeRef: Ref = { id: decode.id, version: 1, sha256: decode.sha256 };

      const manifest: DeliveryManifest = buildDeliveryManifest({
        delivery_id: stageKeys.delivery_id,
        project_id: request.project_id,
        snapshot_id: request.snapshot_id,
        source_digest: request.source_digest,
        render_spec: request.render_spec,
        render_config_digest: stageKeys.config_digest,
        attempt: request.attempt,
        media_ref: mediaRef,
        ffprobe_ref: ffprobeRef,
        full_decode_ref: fullDecodeRef,
        supplement_refs: supplementRefs,
        qc: qcItems,
        published_at: new Date().toISOString(),
        download_ref: stageKeys.download_ref,
      });
      assertManifestMatches(manifest, {
        project_id: request.project_id,
        snapshot_id: request.snapshot_id,
        source_digest: request.source_digest,
        render_config_digest: stageKeys.config_digest,
        attempt: request.attempt,
      });

      // The fence, once more, immediately before the publication.
      await this.#fence(request, identity, "before the package was published");

      const published = await this.#deps.packages.publish({
        package_id: stageKeys.package_id,
        staging_dir: staging,
        files: packageFiles,
        manifest,
        published_at: manifest.published_at,
      });

      // The package is published but the record is not written yet.
      await this.#fence(request, identity, "after the package was published");

      const content = {
        format: "narralens.published-phase-receipt@1" as const,
        package_receipt: published.receipt,
        parent_encoded_digest: encoded.receipt_digest,
        parent_qc_digest: qc.receipt_digest,
        publication_execution: request.execution,
        publication_lease_attempt: request.attempt,
      };
      return { ...content, receipt_digest: phaseReceiptDigest({ ...content, receipt_digest: "" }) };
    } finally {
      await this.#deps.packages.discardStaging(staging).catch(() => undefined);
    }
  }

  /* ------------------------------------------------------------------------------------ */
  /* The resolver                                                                            */
  /* ------------------------------------------------------------------------------------ */

  /**
   * Open one file of one immutable phase object.
   *
   * The object id is a plain name and the relative path is checked before it reaches
   * the filesystem, so a path cannot walk out of the object root. The file is opened
   * with `O_NOFOLLOW`, its size and its digest are checked on that very descriptor,
   * and the handle serves the bytes of that descriptor.
   */
  async openPhaseObject(input: PhaseObjectOpenInput): Promise<PhaseObjectHandle> {
    this.#assertOpen();
    const object_id = input.object_id;
    if (typeof object_id !== "string" || !OBJECT_ID.test(object_id)) {
      throw new CommittedRenderPhaseError("OBJECT_ID_REJECTED", "the object id is not a plain name", false);
    }
    if (typeof input.sha256 !== "string" || !HASH.test(input.sha256)) {
      throw new CommittedRenderPhaseError("OBJECT_DIGEST_REJECTED", "the expected digest is not a digest", false);
    }
    if (!Number.isSafeInteger(input.bytes) || input.bytes < 0) {
      throw new CommittedRenderPhaseError("OBJECT_SIZE_REJECTED", "the expected size is not a size", false);
    }
    const relative_path = assertSafeRelativePath(input.relative_path);
    const root = resolve(this.#objectsDir, object_id);
    if (!root.startsWith(`${this.#objectsDir}${sep}`)) {
      throw new CommittedRenderPhaseError("OBJECT_ESCAPES_ROOT", "the object does not live in the private object root", false);
    }
    const path = resolve(root, relative_path);
    if (!path.startsWith(`${root}${sep}`)) {
      throw new CommittedRenderPhaseError("OBJECT_ESCAPES_ROOT", "the file does not live in its object", false);
    }
    const info = await lstat(path).catch(() => null);
    if (info === null || !info.isFile()) {
      throw new CommittedRenderPhaseError("OBJECT_FILE_MISSING", `the object file is not there: ${relative_path}`, false);
    }
    if (info.size !== input.bytes) {
      throw new CommittedRenderPhaseError("OBJECT_SIZE_CHANGED", `the object file is not the size it was recorded to be: ${relative_path}`, false);
    }
    let handle: FileHandle;
    try {
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch {
      throw new CommittedRenderPhaseError("OBJECT_FILE_UNREADABLE", `the object file could not be opened: ${relative_path}`, false);
    }
    const digest = await digestOfHandle(handle, input.bytes);
    if (digest !== input.sha256) {
      await handle.close();
      throw new CommittedRenderPhaseError("OBJECT_DIGEST_CHANGED", `the object file is not the bytes it was recorded to be: ${relative_path}`, false);
    }
    const result = new ImmutablePhaseObjectHandle({
      object_id,
      relative_path,
      bytes: input.bytes,
      sha256: digest,
      handle,
    });
    this.#open.add(result);
    return result;
  }

  /**
   * Close every descriptor this service still holds.
   *
   * A published object is not a descriptor and is not touched here: only the handles
   * that are still open are closed.
   */
  async close(): Promise<void> {
    this.#closed = true;
    const handles = [...this.#open];
    this.#open.clear();
    let failed = false;
    for (const handle of handles) {
      try {
        await handle.close();
      } catch {
        failed = true;
      }
    }
    if (failed) throw new CommittedRenderPhaseError("OBJECT_CLOSE_FAILED", "a phase object descriptor could not be closed", false);
  }

  /* ------------------------------------------------------------------------------------ */
  /* The internals                                                                           */
  /* ------------------------------------------------------------------------------------ */

  #assertOpen(): void {
    if (this.#closed) throw new CommittedRenderPhaseError("PHASES_CLOSED", "the phase service is closed", false);
  }

  #identityOf(request: RenderRequest): AttemptIdentity {
    return {
      project_id: request.project_id,
      job_id: request.job_id,
      attempt: request.attempt,
      execution: request.execution,
    };
  }

  /**
   * Ask the fence whether the attempt may still act.
   *
   * The fence is asked before a wait and after it, because a cancellation that arrives
   * during a wait has to stop the stage that follows it. The durable fence is the
   * authority: an aborted signal is only a second opinion.
   */
  async #fence(request: RenderRequest, identity: AttemptIdentity, point: string): Promise<void> {
    const verdict = await this.#deps.fence.checkAttempt(identity);
    if (verdict !== "proceed" || request.signal?.aborted === true) {
      const cancelled = verdict === "cancelled" || request.signal?.aborted === true;
      throw new CommittedRenderPhaseError(
        cancelled ? "ATTEMPT_CANCELLED" : "ATTEMPT_SUPERSEDED",
        `the attempt may not act ${point}`,
        true,
      );
    }
  }

  async #readClosure(request: RenderRequest): Promise<SnapshotClosure> {
    let closure: SnapshotClosure;
    try {
      closure = await this.#deps.snapshots.readSnapshot({
        project_id: request.project_id,
        snapshot_id: request.snapshot_id,
        source_digest: request.source_digest,
      });
    } catch (error) {
      throw new CommittedRenderPhaseError("SNAPSHOT_UNAVAILABLE", `the snapshot could not be read: ${String((error as Error).message)}`, false);
    }
    if (closure.source_digest !== request.source_digest) {
      throw new CommittedRenderPhaseError("SNAPSHOT_CHANGED", "the snapshot no longer has the digest the request named", false);
    }
    return closure;
  }

  #assertReceipt(receipt: { readonly receipt_digest: string }): void {
    if (typeof receipt.receipt_digest !== "string" || !HASH.test(receipt.receipt_digest)) {
      throw new CommittedRenderPhaseError("RECEIPT_DIGEST_MISSING", "the receipt does not carry a digest", false);
    }
    if (phaseReceiptDigest(receipt) !== receipt.receipt_digest) {
      throw new CommittedRenderPhaseError("RECEIPT_DIGEST_CHANGED", "the receipt is not the receipt its digest describes", false);
    }
  }

  async #createWorkspaceStaging(): Promise<string> {
    await mkdir(this.#workspaceRoot, { recursive: true, mode: 0o700 });
    const path = resolve(this.#workspaceRoot, `attempt-${randomUUID()}`);
    await mkdir(path, { mode: 0o700 });
    return path;
  }

  async #createObjectStaging(): Promise<string> {
    await mkdir(this.#stagingDir, { recursive: true, mode: 0o700 });
    const path = resolve(this.#stagingDir, randomUUID());
    await mkdir(path, { mode: 0o700 });
    return path;
  }

  /** Publish a staged object under its own name. The rename is the publication. */
  async #publishObject(object_id: string, staged: string): Promise<string> {
    await mkdir(this.#objectsDir, { recursive: true, mode: 0o700 });
    const target = resolve(this.#objectsDir, object_id);
    await rename(staged, target);
    await syncDirectoryOf(this.#objectsDir);
    return object_id;
  }

  /** Copy a file into the staged object, hash it there and make it durable. */
  async #stageCopiedFile(
    staged: string,
    relative_path: string,
    role: string,
    id: string,
    source: string,
  ): Promise<PhaseObjectFileV1> {
    const target = resolve(staged, relative_path);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await copyFile(source, target);
    await syncFileOf(target);
    const digest = await sha256FileDigest(target);
    if (digest === null) throw new CommittedRenderPhaseError("OBJECT_FILE_UNREADABLE", `the staged file could not be read: ${relative_path}`, false);
    const bytes = (await stat(target)).size;
    return { id, relative_path, role, bytes, sha256: digest };
  }

  /** Write a file into the staged object, hash it there and make it durable. */
  async #stageWrittenFile(
    staged: string,
    relative_path: string,
    role: string,
    id: string,
    content: string,
  ): Promise<PhaseObjectFileV1> {
    const target = resolve(staged, relative_path);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, content, { encoding: "utf8", mode: 0o600 });
    await syncFileOf(target);
    const digest = await sha256FileDigest(target);
    if (digest === null) throw new CommittedRenderPhaseError("OBJECT_FILE_UNREADABLE", `the staged file could not be read: ${relative_path}`, false);
    const bytes = (await stat(target)).size;
    return { id, relative_path, role, bytes, sha256: digest };
  }

  /**
   * Copy one verified file of an immutable object into a staging directory.
   *
   * The file is reopened, its digest and its size are checked against the fact that
   * named it, and only then is it copied. The copy is what the next step reads.
   */
  async #materialize(object_id: string, file: PhaseObjectFileV1, staging: string): Promise<string> {
    const handle = await this.openPhaseObject({
      object_id,
      relative_path: file.relative_path,
      sha256: file.sha256,
      bytes: file.bytes,
    });
    try {
      const target = resolve(staging, file.relative_path);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      const source = await this.#verifiedPath(object_id, file);
      await copyFile(source, target);
      const digest = await sha256FileDigest(target);
      if (digest !== file.sha256) {
        throw new CommittedRenderPhaseError("OBJECT_COPY_CHANGED", `the copy of an object file does not match: ${file.relative_path}`, false);
      }
      return target;
    } finally {
      await handle.close();
      this.#open.delete(handle);
    }
  }

  /** The path of a verified file inside the private object root. */
  async #verifiedPath(object_id: string, file: PhaseObjectFileV1): Promise<string> {
    const root = resolve(this.#objectsDir, object_id);
    const path = resolve(root, assertSafeRelativePath(file.relative_path));
    if (!path.startsWith(`${root}${sep}`)) {
      throw new CommittedRenderPhaseError("OBJECT_ESCAPES_ROOT", "the file does not live in its object", false);
    }
    const info = await lstat(path).catch(() => null);
    if (info === null || !info.isFile()) {
      throw new CommittedRenderPhaseError("OBJECT_FILE_MISSING", `the object file is not there: ${file.relative_path}`, false);
    }
    if (info.size !== file.bytes) {
      throw new CommittedRenderPhaseError("OBJECT_SIZE_CHANGED", `the object file is not the size it was recorded to be: ${file.relative_path}`, false);
    }
    return path;
  }
}

/**
 * The digest of a committed closure.
 *
 * The preimage names the files of the closure by their relative path and their
 * digests. It never names an absolute path: the closure is the same on every machine
 * that holds it, and a digest that carried a disk path would not be.
 */
export function closureDigestOf(closure: SnapshotClosure): string {
  return canonicalDigest({
    project_id: closure.project_id,
    snapshot_id: closure.snapshot_id,
    source_digest: closure.source_digest,
    project_revision: closure.project_revision,
    native_entry: closure.native_entry,
    expected_frames: closure.expected_frames ?? null,
    expected_duration_seconds: closure.expected_duration_seconds ?? null,
    entries: closure.entries
      .map((entry) => ({
        relative_path: entry.relative_path,
        sha256: entry.sha256,
        bytes: entry.bytes,
        kind: entry.kind,
        rights_ref: entry.rights_ref,
        role: entry.role,
      }))
      .sort((left, right) => left.relative_path < right.relative_path ? -1 : left.relative_path > right.relative_path ? 1 : 0),
  });
}

/** The digest of the rights facts of a committed closure. */
export function rightsDigestOf(closure: SnapshotClosure): string {
  return canonicalDigest(closure.rights
    .map((right) => ({
      asset_id: right.asset_id,
      status: right.status,
      commercial_use: right.commercial_use,
      ref: right.ref,
    }))
    .sort((left, right) => left.asset_id < right.asset_id ? -1 : left.asset_id > right.asset_id ? 1 : 0));
}

/**
 * The checks the inspection makes about the supplements of an encoded object.
 *
 * Exported so that the phase service and the legacy facade agree on what a supplement
 * check is.
 */
export { buildSupplementChecks } from "./render-snapshot.js";
