import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { closeSync, fstatSync, lstatSync, openSync, realpathSync, type BigIntStats } from "node:fs";
import { copyFile, lstat, mkdir, open, readdir, rename, rm, stat, writeFile, type FileHandle } from "node:fs/promises";
import { dirname, resolve } from "node:path";
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
 * Seven rules shape it, and they are the rules of the canonical interface lock and of
 * the review that followed it:
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
 *   not by a retry. Only an *untransferred* staging directory is ever deleted, and a
 *   staging directory that cannot be deleted is reported rather than swallowed.
 * - **The object carries its own receipt.** Every published object holds a durable,
 *   fsynced receipt of its own files, so a crash before the database knows about the
 *   object still leaves something a reconciliation can read.
 * - **The inspection never touches the encoded object.** It writes its own immutable
 *   object with the probe and the decode output, and the encoded object stays exactly
 *   as the encoder left it.
 * - **The promised bytes are the bytes that are checked.** The inspection opens and
 *   hashes every file the closure promised, and an omitted, duplicated, reordered or
 *   changed file ends the inspection.
 * - **A technical pass is not an acceptance.** The inspection says what the tools
 *   found; the publication still refuses a blocked inspection and still refuses a
 *   warning without a recorded disposition.
 */

const HASH = /^[a-f0-9]{64}$/u;
const OBJECT_ID = /^[A-Za-z0-9_-]{1,64}$/u;

/** The name of the receipt every published phase object carries. */
export const PHASE_OBJECT_RECEIPT_NAME = "receipt.json";

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

/**
 * The durable receipt of one private phase object.
 *
 * It is written into the object before the object is published, so an object that
 * exists always carries the receipt that describes it. It names no absolute path: a
 * receipt is a fact about bytes, and a fact about bytes does not carry the place on a
 * disk where they happened to be written.
 */
export interface PhaseObjectReceiptV1 {
  readonly format: "narralens.phase-object-receipt@1";
  readonly object_id: string;
  readonly kind: "encoded" | "qc";
  readonly project_id: string;
  readonly snapshot_id: string;
  readonly source_digest: string;
  readonly config_digest: string;
  readonly files: readonly PhaseObjectFileV1[];
  readonly created_at: string;
  readonly receipt_digest: string;
}

/** The path of a descriptor inside the descriptor's own directory. */
const at = (fd: number, name = ""): string => `/proc/self/fd/${fd}${name.length > 0 ? `/${name}` : ""}`;

/** The identity of an inode: the device and the inode number. */
const identityOf = (stat: BigIntStats): string => `${stat.dev}:${stat.ino}`;

/** The identity of a directory: its inode, its mode and its owner. */
const directoryIdentityOf = (stat: BigIntStats): string => `${identityOf(stat)}:${stat.mode}:${stat.uid}`;

/** The fingerprint of a file: its identity, its size and when it last changed. */
const fileFingerprintOf = (stat: BigIntStats): string => `${directoryIdentityOf(stat)}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;

function contentTypeOf(relative_path: string): string {
  switch (relative_path.slice(relative_path.lastIndexOf(".")).toLowerCase()) {
    case ".json": return "application/json";
    case ".html": return "text/html; charset=utf-8";
    case ".vtt": return "text/vtt; charset=utf-8";
    case ".txt": return "text/plain; charset=utf-8";
    case ".log": return "text/plain; charset=utf-8";
    case ".mp4": return "video/mp4";
    default: return "application/octet-stream";
  }
}

/**
 * The exact rational value of a finite number.
 *
 * The closure states the film's length in seconds, and that value is a double: a film
 * of 91 frames at 30 fps is 3.0333…, and no rounding of it is a whole number of
 * seconds. The restricted canonical domain admits safe integers only, so the value
 * cannot go into a digest as it stands. It goes in as the exact rational it is: a
 * double is exactly `mantissa * 2^-k`, so it can be written as an integer numerator
 * over a power-of-two denominator, and both of those are safe integers.
 *
 * The canonicalization itself is not touched. A length that cannot be written exactly
 * is refused rather than approximated.
 */
export function exactRationalOf(value: number): { readonly numerator: number; readonly denominator: number } {
  if (!Number.isFinite(value)) {
    throw new CommittedRenderPhaseError("DURATION_NOT_FINITE", "the closure states a length that is not a finite number", false);
  }
  if (Number.isSafeInteger(value)) return { numerator: value, denominator: 1 };
  let numerator = value;
  let denominator = 1;
  while (!Number.isSafeInteger(numerator)) {
    numerator *= 2;
    denominator *= 2;
    if (!Number.isFinite(numerator) || !Number.isSafeInteger(denominator)) {
      throw new CommittedRenderPhaseError(
        "DURATION_NOT_EXACT",
        "the closure states a length that cannot be written as an exact rational of safe integers",
        false,
      );
    }
  }
  let left = Math.abs(numerator);
  let right = denominator;
  while (right !== 0) {
    const rest = left % right;
    left = right;
    right = rest;
  }
  const divisor = left === 0 ? 1 : left;
  return { numerator: numerator / divisor, denominator: denominator / divisor };
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

/** One directory of an anchored path. */
interface AnchoredDirectory {
  readonly fd: number;
  readonly parent: number;
  readonly name: string;
  readonly identity: string;
}

/**
 * A verified, read-only handle on a file of an immutable phase object.
 *
 * The whole path is anchored on file descriptors: the root, the objects directory, the
 * object and every directory on the way to the file were opened with `O_NOFOLLOW`, so
 * no component of the path can be a symlink and none of them can be swapped for one
 * while the handle is open. The digest was computed on the very descriptor that serves
 * the bytes, and the fingerprint of that descriptor is checked again before every
 * read: a file that is changed in place after it was opened is refused rather than
 * served.
 */
class AnchoredPhaseObjectHandle implements PhaseObjectHandle {
  readonly object_id: string;
  readonly relative_path: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly content_type: string;
  readonly #file: FileHandle;
  readonly #fileParent: number;
  readonly #fileName: string;
  readonly #fileIdentity: string;
  readonly #fileFingerprint: string;
  readonly #directories: readonly AnchoredDirectory[];
  #closed = false;

  constructor(input: {
    readonly object_id: string;
    readonly relative_path: string;
    readonly bytes: number;
    readonly sha256: string;
    readonly file: FileHandle;
    readonly fileParent: number;
    readonly fileName: string;
    readonly fileIdentity: string;
    readonly fileFingerprint: string;
    readonly directories: readonly AnchoredDirectory[];
  }) {
    this.object_id = input.object_id;
    this.relative_path = input.relative_path;
    this.bytes = input.bytes;
    this.sha256 = input.sha256;
    this.content_type = contentTypeOf(input.relative_path);
    this.#file = input.file;
    this.#fileParent = input.fileParent;
    this.#fileName = input.fileName;
    this.#fileIdentity = input.fileIdentity;
    this.#fileFingerprint = input.fileFingerprint;
    this.#directories = input.directories;
  }

  /** Check that nothing on the path or the file itself changed. */
  #assertUnchanged(): void {
    if (this.#closed) throw new CommittedRenderPhaseError("OBJECT_CLOSED", "the phase object handle is closed", false);
    for (const directory of this.#directories) {
      // The root has no name of its own: it is reached through its own descriptor, so
      // only the descriptor can be checked.
      if (directory.name.length > 0) {
        const named = lstatSync(at(directory.parent, directory.name), { bigint: true });
        if (directoryIdentityOf(named) !== directory.identity) {
          throw new CommittedRenderPhaseError("OBJECT_MUTATED", `the directory of a phase object file was replaced: ${this.relative_path}`, false);
        }
      }
      const opened = fstatSync(directory.fd, { bigint: true });
      if (directoryIdentityOf(opened) !== directory.identity) {
        throw new CommittedRenderPhaseError("OBJECT_MUTATED", `the directory of a phase object file was replaced: ${this.relative_path}`, false);
      }
    }
    const named = lstatSync(at(this.#fileParent, this.#fileName), { bigint: true });
    if (identityOf(named) !== this.#fileIdentity) {
      throw new CommittedRenderPhaseError("OBJECT_MUTATED", `the phase object file was replaced: ${this.relative_path}`, false);
    }
    const opened = fstatSync(this.#file.fd, { bigint: true });
    if (fileFingerprintOf(opened) !== this.#fileFingerprint) {
      throw new CommittedRenderPhaseError("OBJECT_MUTATED", `the phase object file changed after it was opened: ${this.relative_path}`, false);
    }
  }

  async read(range: { readonly offset: number; readonly length: number }): Promise<Uint8Array> {
    this.#assertUnchanged();
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
      const { bytesRead } = await this.#file.read(buffer, read, length - read, offset + read);
      if (bytesRead === 0) break;
      read += bytesRead;
    }
    if (read !== length) throw new CommittedRenderPhaseError("READ_SHORT", "the object file ended before the requested range was read", false);
    this.#assertUnchanged();
    return new Uint8Array(buffer);
  }

  /** Read the whole file. Only the small files of an object are read this way. */
  async readAll(maxBytes: number): Promise<Buffer> {
    if (this.bytes > maxBytes) {
      throw new CommittedRenderPhaseError("OBJECT_TOO_LARGE", `the object file is larger than ${maxBytes} bytes`, false);
    }
    const buffer = Buffer.alloc(this.bytes);
    let read = 0;
    while (read < this.bytes) {
      const chunk = await this.read({ offset: read, length: Math.min(PHASE_OBJECT_MAX_READ_BYTES, this.bytes - read) });
      buffer.set(chunk, read);
      read += chunk.byteLength;
    }
    return buffer;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    let failed = false;
    try {
      await this.#file.close();
    } catch {
      failed = true;
    }
    for (const directory of this.#directories) {
      try {
        closeSync(directory.fd);
      } catch {
        failed = true;
      }
    }
    if (failed) throw new CommittedRenderPhaseError("OBJECT_CLOSE_FAILED", "a phase object descriptor could not be closed", false);
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
  readonly #open = new Set<AnchoredPhaseObjectHandle>();
  readonly #pending = new Set<Promise<unknown>>();
  readonly #failures: Error[] = [];
  #closing = false;
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
   * immutable object that carries its own receipt, and only then does the fact exist.
   */
  async prepareEncoded(request: RenderRequest): Promise<EncodedFactV1> {
    this.#assertOpen();
    return await this.#track(async () => {
      const identity = this.#identityOf(request);
      await this.#fence(request, identity, "before the snapshot was read");

      const closure = await this.#readClosure(request);
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
      let failure: unknown;
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

        const media = await this.#stageCopiedFile(
          objectStaging,
          PACKAGE_FILES.media,
          ENCODED_ROLES.media,
          packageRefId(stageKeys.delivery_id, PACKAGE_ROLES.media),
          outPath,
        );
        files.push(media);

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

        const nativeSource = await this.#stageWrittenFile(
          objectStaging,
          PACKAGE_FILES.nativeSource,
          ENCODED_ROLES.nativeSource,
          packageRefId(stageKeys.delivery_id, PACKAGE_ROLES.nativeSource),
          `${JSON.stringify(nativeSourceAttachment(closure, copy.native_entry), null, 2)}\n`,
        );
        files.push(nativeSource);

        const supplementEntries = closure.entries.filter((entry) => entry.kind === "supplement");
        for (const [index, entry] of supplementEntries.entries()) {
          const staged = await this.#stageCopiedFile(
            objectStaging,
            supplementFileName(index, entry.relative_path.slice(entry.relative_path.lastIndexOf("."))),
            entry.role ?? `sup${index}`,
            packageRefId(stageKeys.delivery_id, `sup${index}`),
            resolve(copy.project_root, entry.relative_path),
          );
          if (staged.sha256 !== entry.sha256 || staged.bytes !== entry.bytes) {
            throw new CommittedRenderPhaseError("SUPPLEMENT_CHANGED", `the copied ${entry.role ?? entry.relative_path} does not match the bytes the snapshot committed to`, false);
          }
          files.push(staged);
        }

        // 5. The receipt of the object. It is written and made durable before the object
        //    is published, so an object that exists always carries the receipt that
        //    describes it.
        await this.#stageObjectReceipt(objectStaging, {
          object_id,
          kind: "encoded",
          project_id: request.project_id,
          snapshot_id: request.snapshot_id,
          source_digest: request.source_digest,
          config_digest: stageKeys.config_digest,
          files,
          created_at: new Date().toISOString(),
        });

        await syncTreeOf(objectStaging);

        // 6. The fence, once more, immediately before the object is published. A render
        //    that was cancelled while it encoded must not become an object.
        await this.#fence(request, identity, "before the encoded object was published");

        const objectId = await this.#publishObject(object_id, objectStaging);
        objectStaging = null;

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
        return { ...content, receipt_digest: phaseReceiptDigest({ ...content, receipt_digest: "" }) };
      } catch (error) {
        failure = error;
        throw error;
      } finally {
        // Only this attempt's own staging. A published object is never touched here, and
        // a staging directory that cannot be removed is reported rather than swallowed.
        await this.#cleanupStaging(objectStaging, workspace, failure);
      }
    });
  }

  /**
   * Inspect the encoded object and return the immutable quality-control receipt.
   *
   * The encoded object is reopened and re-verified before anything is inspected: the
   * closure and the rights the snapshot carries now have to be the ones the encoder
   * saw, and every promised file has to be the file the snapshot committed to. The
   * inspection writes its own object and never touches the encoded one.
   */
  async inspectEncoded(input: InspectEncodedInput): Promise<QcReceiptV1> {
    this.#assertOpen();
    return await this.#track(async () => {
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

      // Every promised file is opened and hashed. A file that is missing, changed,
      // duplicated or reordered ends the inspection.
      const supplements = await this.#verifyEncodedSupplements(encoded, closure, stageKeys.delivery_id, request.required_supplements);

      const workspace = await this.#createWorkspaceStaging();
      let objectStaging: string | null = null;
      let failure: unknown;
      try {
        const media = encoded.files.find((file) => file.id === encoded.media_ref.id);
        if (media === undefined) {
          throw new CommittedRenderPhaseError("ENCODED_MEDIA_MISSING", "the encoded fact does not name a media file", false);
        }
        const mediaPath = await this.#materialize(encoded.media_object_id, media, workspace);

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
          supplements: supplements,
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
        objectStaging = await this.#createObjectStaging();
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
          await this.#stageObjectReceipt(objectStaging, {
            object_id: qc_object_id,
            kind: "qc",
            project_id: request.project_id,
            snapshot_id: request.snapshot_id,
            source_digest: request.source_digest,
            config_digest: stageKeys.config_digest,
            files: [probe, decode],
            created_at: new Date().toISOString(),
          });
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
          if (!published) {
            const cleanupFailure = await this.#removeStaging(objectStaging);
            if (cleanupFailure !== null && failure === undefined) failure = cleanupFailure;
          }
        }
      } catch (error) {
        failure = error;
        throw error;
      } finally {
        await this.#cleanupStaging(null, workspace, failure);
      }
    });
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
    return await this.#track(async () => {
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
      await this.#verifyEncodedSupplements(encoded, closure, stageKeys.delivery_id, request.required_supplements);

      const staging = await this.#deps.packages.createStaging(`phase${request.attempt}`);
      let failure: unknown;
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
      } catch (error) {
        failure = error;
        throw error;
      } finally {
        const discarded = await this.#deps.packages.discardStaging(staging).then(() => null, (error: unknown) => error);
        if (discarded !== null && failure === undefined) {
          throw new CommittedRenderPhaseError("PHASE_CLEANUP_FAILED", `the package staging could not be discarded: ${String((discarded as Error).message)}`, true, true);
        }
      }
    });
  }

  /* ------------------------------------------------------------------------------------ */
  /* The resolver                                                                            */
  /* ------------------------------------------------------------------------------------ */

  /**
   * Open one file of one immutable phase object.
   *
   * The object id is a plain name and the relative path is checked before it reaches
   * the filesystem. The whole path is then opened on descriptors: the root, the
   * objects directory, the object, every directory on the way and the file itself are
   * each opened with `O_NOFOLLOW`, so no component of the path can be a symlink and
   * none of them can be replaced by one while the handle is open. The size and the
   * digest are checked on the very descriptor that serves the bytes, and the
   * fingerprint of that descriptor is checked again before every read.
   */
  async openPhaseObject(input: PhaseObjectOpenInput): Promise<PhaseObjectHandle> {
    this.#assertOpen();
    return await this.#track(async () => {
      const handle = await this.#openAnchored(input.object_id, input.relative_path, input.sha256, input.bytes);
      this.#open.add(handle);
      return handle;
    });
  }

  /**
   * Read the durable receipt of a published phase object.
   *
   * The receipt is the object's own account of itself. It is read through the same
   * anchored resolver as any other file of the object, so a receipt that was replaced
   * is refused rather than believed.
   */
  async readObjectReceipt(object_id: string): Promise<PhaseObjectReceiptV1> {
    this.#assertOpen();
    return await this.#track(async () => {
      const handle = await this.#openAnchoredUnverified(object_id, PHASE_OBJECT_RECEIPT_NAME);
      try {
        const bytes = await handle.readAll(PHASE_OBJECT_MAX_READ_BYTES);
        const parsed: unknown = JSON.parse(bytes.toString("utf8"));
        if (typeof parsed !== "object" || parsed === null) {
          throw new CommittedRenderPhaseError("RECEIPT_MALFORMED", "the receipt of a phase object is not an object", false);
        }
        const receipt = parsed as PhaseObjectReceiptV1;
        if (receipt.format !== "narralens.phase-object-receipt@1" || receipt.object_id !== object_id) {
          throw new CommittedRenderPhaseError("RECEIPT_MALFORMED", "the receipt of a phase object does not describe that object", false);
        }
        if (phaseReceiptDigest(receipt) !== receipt.receipt_digest) {
          throw new CommittedRenderPhaseError("RECEIPT_DIGEST_CHANGED", "the receipt of a phase object is not the receipt its digest describes", false);
        }
        return receipt;
      } finally {
        await handle.close();
      }
    });
  }

  /**
   * Close every descriptor this service still holds.
   *
   * The phases that are still running are waited for first: a descriptor that an
   * in-flight phase is about to open has to be closed by this call, not leaked by it.
   * A published object is not a descriptor and is not touched here.
   */
  async close(): Promise<void> {
    this.#closing = true;
    this.#closed = true;
    const failuresBefore = this.#failures.length;
    while (this.#pending.size > 0) {
      await Promise.allSettled([...this.#pending]);
    }
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
    const during = this.#failures.slice(failuresBefore);
    if (during.length > 0) {
      throw new CommittedRenderPhaseError(
        "PHASE_FAILED",
        `a phase that was running when the service closed failed: ${during.map((error) => error.message).join("; ")}`,
        true,
        true,
      );
    }
  }

  /* ------------------------------------------------------------------------------------ */
  /* The internals                                                                           */
  /* ------------------------------------------------------------------------------------ */

  #assertOpen(): void {
    if (this.#closing || this.#closed) {
      throw new CommittedRenderPhaseError("PHASES_CLOSED", "the phase service is closed", false);
    }
  }

  /**
   * Track one piece of work so that `close` can wait for it.
   *
   * The work starts immediately — it is not deferred — because a phase that had not
   * started yet would not be a phase that is running.
   */
  #track<T>(work: () => Promise<T>): Promise<T> {
    let promise: Promise<T>;
    try {
      promise = work();
    } catch (error) {
      this.#failures.push(error instanceof Error ? error : new Error(String(error)));
      return Promise.reject(error);
    }
    this.#pending.add(promise);
    return promise.then(
      (value) => {
        this.#pending.delete(promise);
        return value;
      },
      (error: unknown) => {
        this.#pending.delete(promise);
        this.#failures.push(error instanceof Error ? error : new Error(String(error)));
        throw error;
      },
    );
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

  /**
   * Open one file of one object on descriptors, and check it.
   *
   * Every descriptor this opens is closed again if anything goes wrong: a hash that
   * fails must not leave a descriptor behind.
   */
  async #openAnchored(object_id: string, relative_path: string, sha256: string, bytes: number): Promise<AnchoredPhaseObjectHandle> {
    const handle = await this.#openAnchoredUnverified(object_id, relative_path);
    try {
      if (!HASH.test(sha256)) {
        throw new CommittedRenderPhaseError("OBJECT_DIGEST_REJECTED", "the expected digest is not a digest", false);
      }
      if (!Number.isSafeInteger(bytes) || bytes < 0) {
        throw new CommittedRenderPhaseError("OBJECT_SIZE_REJECTED", "the expected size is not a size", false);
      }
      if (handle.bytes !== bytes) {
        throw new CommittedRenderPhaseError("OBJECT_SIZE_CHANGED", `the object file is not the size it was recorded to be: ${relative_path}`, false);
      }
      if (handle.sha256 !== sha256) {
        throw new CommittedRenderPhaseError("OBJECT_DIGEST_CHANGED", `the object file is not the bytes it was recorded to be: ${relative_path}`, false);
      }
      return handle;
    } catch (error) {
      await handle.close().catch(() => undefined);
      throw error;
    }
  }

  /**
   * Open one file of one object on descriptors, and describe it.
   *
   * The chain of directories is opened from the root down, each component with
   * `O_NOFOLLOW`, and each opened descriptor is compared with the named entry it came
   * from. The file is then hashed through its own descriptor.
   */
  async #openAnchoredUnverified(object_id: string, relative_path: string): Promise<AnchoredPhaseObjectHandle> {
    if (typeof object_id !== "string" || !OBJECT_ID.test(object_id)) {
      throw new CommittedRenderPhaseError("OBJECT_ID_REJECTED", "the object id is not a plain name", false);
    }
    const parts = assertSafeRelativePath(relative_path).split("/");
    const name = parts.pop();
    if (name === undefined || name.length === 0) {
      throw new CommittedRenderPhaseError("RELATIVE_PATH_REJECTED", "the object file has no name", false);
    }

    const directories: AnchoredDirectory[] = [];
    let file: FileHandle | null = null;
    try {
      const rootFd = openSync(this.#objectRoot, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      const rootStat = fstatSync(rootFd, { bigint: true });
      if (!rootStat.isDirectory()) {
        throw new CommittedRenderPhaseError("OBJECT_ROOT_INVALID", "the private object root is not a directory", false);
      }
      // The root has to be the root and not an alias of it: a root that is reached
      // through a symlink is a root somebody else can move.
      if (realpathSync(at(rootFd)) !== this.#objectRoot) {
        throw new CommittedRenderPhaseError("OBJECT_ROOT_ALIASED", "the private object root is an alias of another directory", false);
      }
      directories.push({ fd: rootFd, parent: rootFd, name: "", identity: directoryIdentityOf(rootStat) });

      let parent = rootFd;
      for (const component of ["objects", object_id, ...parts]) {
        const child = openSync(at(parent, component), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        const opened = fstatSync(child, { bigint: true });
        if (!opened.isDirectory()) {
          closeSync(child);
          throw new CommittedRenderPhaseError("OBJECT_PATH_INVALID", `a component of the object path is not a directory: ${component}`, false);
        }
        const named = lstatSync(at(parent, component), { bigint: true });
        if (directoryIdentityOf(named) !== directoryIdentityOf(opened)) {
          closeSync(child);
          throw new CommittedRenderPhaseError("OBJECT_PATH_REPLACED", `a component of the object path was replaced: ${component}`, false);
        }
        directories.push({ fd: child, parent, name: component, identity: directoryIdentityOf(opened) });
        parent = child;
      }

      file = await open(at(parent, name), constants.O_RDONLY | constants.O_NOFOLLOW);
      const opened = fstatSync(file.fd, { bigint: true });
      if (!opened.isFile()) {
        throw new CommittedRenderPhaseError("OBJECT_FILE_INVALID", `the object file is not a regular file: ${relative_path}`, false);
      }
      const named = lstatSync(at(parent, name), { bigint: true });
      if (identityOf(named) !== identityOf(opened)) {
        throw new CommittedRenderPhaseError("OBJECT_FILE_REPLACED", `the object file was replaced: ${relative_path}`, false);
      }

      const size = Number(opened.size);
      if (!Number.isSafeInteger(size) || size < 0) {
        throw new CommittedRenderPhaseError("OBJECT_SIZE_INVALID", `the object file has a size that cannot be used: ${relative_path}`, false);
      }
      const digest = await this.#digestOfHandle(file, size);
      const fileParent = parent;
      const handle = new AnchoredPhaseObjectHandle({
        object_id,
        relative_path,
        bytes: size,
        sha256: digest,
        file,
        fileParent,
        fileName: name,
        fileIdentity: identityOf(opened),
        fileFingerprint: fileFingerprintOf(opened),
        directories,
      });
      file = null;
      return handle;
    } catch (error) {
      if (file !== null) await file.close().catch(() => undefined);
      for (const directory of directories) {
        try {
          closeSync(directory.fd);
        } catch {
          /* the descriptor is already gone */
        }
      }
      if (error instanceof CommittedRenderPhaseError) throw error;
      throw new CommittedRenderPhaseError("OBJECT_OPEN_FAILED", `a phase object file could not be opened: ${relative_path}`, false);
    }
  }

  /** The digest of a file, read through the descriptor that will serve it. */
  async #digestOfHandle(handle: FileHandle, bytes: number): Promise<string> {
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      position += bytesRead;
      if (position > bytes) {
        throw new CommittedRenderPhaseError("OBJECT_TOO_LARGE", "the object file is larger than it was recorded to be", false);
      }
      hash.update(buffer.subarray(0, bytesRead));
    }
    if (position !== bytes) {
      throw new CommittedRenderPhaseError("OBJECT_SIZE_CHANGED", "the object file is not the size it was recorded to be", false);
    }
    return hash.digest("hex");
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
   * Write the receipt of the object into the staged object.
   *
   * The receipt is written before the object is published, so an object that exists
   * always carries it. It describes the payload files and never the receipt itself.
   */
  async #stageObjectReceipt(staged: string, content: Omit<PhaseObjectReceiptV1, "format" | "receipt_digest">): Promise<void> {
    const receipt: PhaseObjectReceiptV1 = {
      format: "narralens.phase-object-receipt@1",
      ...content,
      receipt_digest: phaseReceiptDigest({ ...content, format: "narralens.phase-object-receipt@1", receipt_digest: "" }),
    };
    await this.#stageWrittenFile(staged, PHASE_OBJECT_RECEIPT_NAME, "receipt", `${content.object_id}_receipt`, `${JSON.stringify(receipt, null, 2)}\n`);
  }

  /**
   * Check every promised file of an encoded object against the committed closure.
   *
   * The comparison is against the *bytes*: every promised file is opened, hashed and
   * measured, and the roles, the order and the number of the supplements have to be
   * exactly the ones the closure promised. A file that is missing, changed, duplicated
   * or reordered ends the phase.
   */
  async #verifyEncodedSupplements(
    encoded: EncodedFactV1,
    closure: SnapshotClosure,
    delivery_id: string,
    required_supplements: readonly string[],
  ): Promise<SupplementCheck[]> {
    const expected = closure.entries
      .filter((entry) => entry.kind === "supplement")
      .map((entry, index) => ({
        index,
        id: packageRefId(delivery_id, `sup${index}`),
        role: entry.role ?? `sup${index}`,
        sha256: entry.sha256,
        bytes: entry.bytes,
      }));

    const expectedIds = new Set(expected.map((entry) => entry.id));
    const actual = encoded.files.filter((file) => expectedIds.has(file.id));

    if (actual.length !== expected.length) {
      throw new CommittedRenderPhaseError(
        "SUPPLEMENT_MISSING",
        `the encoded object carries ${actual.length} of the ${expected.length} supplement(s) the closure promised`,
        false,
      );
    }
    for (const [index, entry] of expected.entries()) {
      const occurrences = actual.filter((file) => file.id === entry.id).length;
      if (occurrences !== 1) {
        throw new CommittedRenderPhaseError(
          "SUPPLEMENT_DUPLICATED",
          `the encoded object carries the supplement ${entry.id} ${occurrences} times`,
          false,
        );
      }
    }
    for (const [index, entry] of expected.entries()) {
      const file = actual[index];
      if (file === undefined || file.id !== entry.id) {
        throw new CommittedRenderPhaseError(
          "SUPPLEMENT_REORDERED",
          `the encoded object carries its supplement ${index + 1} out of order`,
          false,
        );
      }
      if (file.role !== entry.role) {
        throw new CommittedRenderPhaseError(
          "SUPPLEMENT_ROLE_MISMATCH",
          `the encoded object carries the supplement ${entry.id} with the role ${file.role}, not ${entry.role}`,
          false,
        );
      }
    }

    const rolesPresent = new Set<string>();
    const checks: SupplementCheck[] = [];
    for (const [index, entry] of expected.entries()) {
      const file = actual[index];
      if (file === undefined) {
        throw new CommittedRenderPhaseError("SUPPLEMENT_MISSING", `the encoded object does not carry the supplement ${entry.id}`, false);
      }
      const handle = await this.#openAnchored(encoded.media_object_id, file.relative_path, file.sha256, file.bytes);
      let actualSha: string;
      let actualBytes: number;
      try {
        actualBytes = handle.bytes;
        actualSha = handle.sha256;
      } finally {
        await handle.close();
      }
      if (actualSha !== entry.sha256 || actualBytes !== entry.bytes) {
        throw new CommittedRenderPhaseError(
          "SUPPLEMENT_CHANGED",
          `the encoded object carries a ${entry.role} that is not the bytes the snapshot committed to`,
          false,
        );
      }
      rolesPresent.add(entry.role);
      checks.push({
        id: `sup${index}`,
        role: entry.role,
        sha256: entry.sha256,
        bytes: entry.bytes,
        actual_sha256: actualSha,
        actual_bytes: actualBytes,
      });
    }

    const missing = [...MANDATORY_A_SUPPLEMENT_ROLES, ...required_supplements].filter((role) => !rolesPresent.has(role));
    if (missing.length > 0) {
      throw new CommittedRenderPhaseError(
        "SUPPLEMENT_MISSING",
        `the encoded object does not carry the promised ${missing.join(", ")}`,
        false,
      );
    }
    return checks;
  }

  /**
   * Copy one verified file of an immutable object into a staging directory.
   *
   * The file is opened on descriptors, checked against the fact that named it, and
   * copied through that descriptor. The copy is checked again afterwards.
   */
  async #materialize(object_id: string, file: PhaseObjectFileV1, staging: string): Promise<string> {
    const handle = await this.#openAnchored(object_id, file.relative_path, file.sha256, file.bytes);
    try {
      const target = resolve(staging, file.relative_path);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      const hash = createHash("sha256");
      const output = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
      try {
        let position = 0;
        while (position < handle.bytes) {
          const chunk = await handle.read({ offset: position, length: Math.min(PHASE_OBJECT_MAX_READ_BYTES, handle.bytes - position) });
          await output.write(chunk, 0, chunk.byteLength, position);
          hash.update(chunk);
          position += chunk.byteLength;
        }
        await output.sync();
      } finally {
        await output.close();
      }
      if (hash.digest("hex") !== file.sha256) {
        throw new CommittedRenderPhaseError("OBJECT_COPY_CHANGED", `the copy of an object file does not match: ${file.relative_path}`, false);
      }
      return target;
    } finally {
      await handle.close();
      this.#open.delete(handle);
    }
  }

  /** Remove a staging directory. A failure is returned, never swallowed. */
  async #removeStaging(path: string | null): Promise<unknown | null> {
    if (path === null) return null;
    try {
      await rm(path, { recursive: true, force: true });
      return null;
    } catch (error) {
      return error;
    }
  }

  /**
   * Clean this attempt's own staging up, and report a cleanup that did not work.
   *
   * Bytes that could not be removed may still be there, so the caller has to know: the
   * failure is turned into an error that asks for a reconciliation.
   */
  async #cleanupStaging(objectStaging: string | null, workspace: string | null, failure: unknown): Promise<void> {
    const problems: string[] = [];
    for (const path of [objectStaging, workspace]) {
      const error = await this.#removeStaging(path);
      if (error !== null) problems.push(`${String((error as Error).message)}`);
    }
    if (problems.length === 0) return;
    const message = `the staging of this phase could not be removed: ${problems.join("; ")}`;
    if (failure === undefined) {
      throw new CommittedRenderPhaseError("PHASE_CLEANUP_FAILED", message, true, true);
    }
    throw new AggregateError(
      [failure, new CommittedRenderPhaseError("PHASE_CLEANUP_FAILED", message, true, true)],
      "the phase failed and its staging could not be removed",
    );
  }
}

/**
 * The digest of a committed closure.
 *
 * The preimage names the files of the closure by their relative path and their
 * digests. It never names an absolute path: the closure is the same on every machine
 * that holds it, and a digest that carried a disk path would not be. The length of the
 * film goes in as the exact rational it is, because the restricted canonical domain
 * admits safe integers only.
 */
export function closureDigestOf(closure: SnapshotClosure): string {
  return canonicalDigest({
    project_id: closure.project_id,
    snapshot_id: closure.snapshot_id,
    source_digest: closure.source_digest,
    project_revision: closure.project_revision,
    native_entry: closure.native_entry,
    expected_frames: closure.expected_frames ?? null,
    expected_duration: closure.expected_duration_seconds === undefined
      ? null
      : exactRationalOf(closure.expected_duration_seconds),
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
