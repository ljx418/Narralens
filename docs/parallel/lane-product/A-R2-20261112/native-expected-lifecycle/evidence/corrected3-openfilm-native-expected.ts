import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type {
  ExpectedProjectionInput,
  ExpectedProjectionResult,
} from '../../../tools/agent-driven/product/native-inputs/expected-projection.js';

/**
 * The independent native expected projection (A-R2, L05).
 *
 * The editor says what it loaded. This module says what it *should* have loaded, from
 * the Host's own committed facts and never from the editor's rows. The two are compared
 * at the final acknowledgement boundary, and a difference is a refusal — never a
 * re-normalised success.
 *
 * The split of labour is exact and it is not a design choice:
 *
 * - the pinned **015** helper owns `settings` and `markers`. It is the original native
 *   algorithm, imported from the pinned candidate, and it is used verbatim;
 * - the Host's **committed reader** and the fixed original native parser/consumer rules
 *   own the film, the source closure, `subtitle_style` and `captions`. 015 explicitly
 *   does not prove those, and a 015 `not_proven` entry is never read as an absence;
 * - nothing here reads a UI row, a browser preference or an observed hash. An expected
 *   value that cannot be proved is `unsupported`, and `unsupported` produces no
 *   acknowledgement.
 *
 * The interface is fixed: `prove(binding)` / `assertCurrent(binding, proof)` /
 * `release(proof)` / `close()`. The proof is opaque, it holds the *retained* file
 * identity for as long as the verification needs it, and it cannot be rebuilt from JSON.
 */

/** The upstream the pinned candidate was cut from. It is a pin, not a version guess. */
export const NATIVE_EXPECTED_UPSTREAM_SHA = 'e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3';
/** The expected profile the pinned helper computes. */
export const NATIVE_EXPECTED_PROFILE = 'narralens.native-expected-numeric@1';
/** The exact 013/H-R1 effective-value preimage. Nothing else is hashed this way. */
export const NATIVE_EFFECTIVE_FORMAT = 'narralens.native-hydration-effective@1';

/** The four parts of the native hydration contract. */
export const NATIVE_EXPECTED_PARTS = ['settings', 'subtitle_style', 'captions', 'markers'] as const;
export type NativeExpectedPartKind = (typeof NATIVE_EXPECTED_PARTS)[number];

/**
 * The Host-private workspace a binding names.
 *
 * It is the identity of the *committed* workspace, not a path and not a URL. The client
 * cannot construct one, and the expected reader never walks out of it.
 */
export interface NativeExpectedWorkspace {
  readonly workspace_ref: string;
  readonly snapshot_id: string;
  readonly source_digest: string;
  readonly revision: number;
}

/** The binding of one expected proof: the Host's own private facts, never a request body. */
export interface NativeExpectedBinding {
  readonly project_id: string;
  readonly native_project_id: string;
  readonly revision: number;
  readonly snapshot_id: string;
  readonly source_digest: string;
  readonly instance_generation: number;
  readonly selection_version: number;
  readonly workspace: NativeExpectedWorkspace;
  /** Re-checks the real session's liveness at the moment it is called. */
  readonly isCurrent: () => boolean;
}

/**
 * The immutable snapshot of a binding's fields.
 *
 * The identity of an object does not protect its *fields*: a caller could mutate the
 * binding between `prove` and `assertCurrent`. The snapshot is the field-by-field truth
 * the proof was made against, and it is the comparison `assertCurrent` performs.
 */
export interface NativeExpectedBindingSnapshot {
  readonly project_id: string;
  readonly native_project_id: string;
  readonly revision: number;
  readonly snapshot_id: string;
  readonly source_digest: string;
  readonly instance_generation: number;
  readonly selection_version: number;
  readonly workspace_ref: string;
  readonly workspace_snapshot_id: string;
  readonly workspace_source_digest: string;
  readonly workspace_revision: number;
}

/** The snapshot of one binding's fields. */
export function snapshotNativeExpectedBinding(binding: NativeExpectedBinding): NativeExpectedBindingSnapshot {
  return Object.freeze({
    project_id: binding.project_id,
    native_project_id: binding.native_project_id,
    revision: binding.revision,
    snapshot_id: binding.snapshot_id,
    source_digest: binding.source_digest,
    instance_generation: binding.instance_generation,
    selection_version: binding.selection_version,
    workspace_ref: binding.workspace.workspace_ref,
    workspace_snapshot_id: binding.workspace.snapshot_id,
    workspace_source_digest: binding.workspace.source_digest,
    workspace_revision: binding.workspace.revision,
  });
}

/** One closed source file of the committed workspace. */
export interface NativeExpectedSourceEntry {
  readonly relative_path: string;
  readonly sha256: string;
}

/**
 * One retained, still-open descriptor of a committed source file.
 *
 * The reader opens the file, hashes it and keeps the descriptor. `verify` is the
 * *synchronous* guard of one file: it checks that the canonical root and the current
 * path still name the retained device and inode (no symlink, no escape, no replacement)
 * and that the bytes behind the same descriptor still hash to the recorded digest.
 *
 * `close` releases the descriptor. It is idempotent, and the Host calls it exactly once
 * per retained file on every path out of the verification.
 */
export interface NativeExpectedRetainedFile {
  readonly relative_path: string;
  readonly sha256: string;
  readonly bytes: number;
  /** The synchronous guard. Never throws; a failure is `false`. */
  readonly verify: () => boolean;
  /** Release the retained descriptor. Idempotent. */
  readonly close: () => void;
}

/**
 * The independently read source facts.
 *
 * These come from the Host's committed reader and from the fixed original native
 * parser/consumer rules. `expected_input` is the pinned 015 input, assembled by the
 * Host from proved facts — never from the editor's rows and never from a request body.
 */
export interface NativeExpectedSourceFacts {
  /** The exact closed source file set of the committed snapshot. */
  readonly entries: readonly NativeExpectedSourceEntry[];
  /** The committed film: its bytes, its hash and the native revision it was read at. */
  readonly film: {
    readonly relative_path: 'film.html';
    readonly sha256: string;
    readonly bytes: number;
    readonly native_rev: string;
  };
  /** The pinned 015 input, assembled from independently proved facts. */
  readonly expected_input: ExpectedProjectionInput;
  /**
   * The effective subtitle style, from the fixed original native parser rules.
   *
   * `state` records where the value came from: `present` is the project's own style,
   * `absent` is the pinned explicit default the native would use. `value` is always the
   * effective value, so the digest is the digest of what the editor consumes.
   */
  readonly style: { readonly state: 'present' | 'absent'; readonly value: unknown };
  /** The effective captions, from the fixed original native consumer rules. */
  readonly captions: { readonly state: 'present' | 'absent'; readonly value: unknown };
  /**
   * The retained descriptors. The proof holds them for the whole verification.
   *
   * The Host takes ownership of these handles the moment the read resolves, and closes
   * all of them if anything after that fails.
   */
  readonly retained: readonly NativeExpectedRetainedFile[];
  /**
   * The closure guard.
   *
   * It answers, synchronously, whether the *entire* relevant closure is still the one
   * that was read: the membership of every path and dependency, including the settings,
   * the style, the captions, the markers and the film, and any addition to or removal
   * from that closure. It is never derived from a request and it is never `true` by
   * default.
   */
  readonly verifyClosure: () => boolean;
}

/**
 * MAIN's committed reader (the I4 closure).
 *
 * It is a port, not a second implementation: the Host owns the committed source, and
 * this service consumes what the Host reads. The reader must return the files it read
 * **still open**, so the proof can hold a real file identity instead of a copy of one.
 * When the reader is absent or refuses, the expected value is `unsupported` and no
 * acknowledgement is produced.
 */
export interface NativeExpectedSourcePort {
  readSource(input: { readonly binding: NativeExpectedBinding }): Promise<NativeExpectedSourceFacts>;
}

/** What one expected part is. */
export type NativeExpectedPartState = 'hydrated' | 'absent_default' | 'unsupported';

/**
 * The origin an expected part must have.
 *
 * The pinned 013 contract is explicit about the origins: the settings, the captions
 * and the markers are revalidated with origin project, and a project without a style
 * uses the pinned default, which is origin explicit_default. A browser preference is
 * never an expected origin, not even when its value happens to be the default.
 */
export const NATIVE_EXPECTED_ORIGINS = ['project', 'explicit_default'] as const;
export type NativeExpectedOrigin = (typeof NATIVE_EXPECTED_ORIGINS)[number];

/** One expected part: its state, its origin and its own effective digest. */
export interface NativeExpectedPart {
  readonly state: NativeExpectedPartState;
  readonly origin: NativeExpectedOrigin | null;
  readonly effective_sha256: string | null;
  readonly reason: string | null;
}

/**
 * The expected projection of the committed source.
 *
 * It is what the editor is compared against. Every part carries its *own* digest, and an
 * absent part carries the digest of the pinned default rather than a null. Everything in
 * it is frozen: the caller can never reach a mutable nested fact.
 */
export interface NativeExpectedProjection {
  readonly project_id: string;
  readonly revision: number;
  readonly snapshot_id: string;
  readonly source_digest: string;
  readonly film_sha256: string;
  readonly film_bytes: number;
  readonly native_rev: string;
  readonly source_closure: readonly NativeExpectedSourceEntry[];
  readonly selection_version: number;
  readonly parts: Readonly<Record<NativeExpectedPartKind, NativeExpectedPart>>;
}

/**
 * The brand of a real proof.
 *
 * It is a private symbol, so a proof cannot be built from JSON or from a plain object
 * literal by anything outside this module.
 */
const PROOF_BRAND = Symbol('narralens.native-expected-proof@1');

/** The facts a proof holds while a verification is in flight. */
interface NativeExpectedFacts {
  /** The issuing instance's own token. A proof from another instance is refused. */
  readonly instance: object;
  /** The very binding object `prove` was given. `assertCurrent` requires this one. */
  readonly binding: NativeExpectedBinding;
  /** The immutable field snapshot of that binding, taken when the proof was made. */
  readonly binding_snapshot: NativeExpectedBindingSnapshot;
  readonly projection: NativeExpectedProjection;
  readonly input_sha256: string;
  /** The retained descriptors, still open. */
  readonly retained: readonly NativeExpectedRetainedFile[];
  /** The closure guard, owned by the reader. */
  readonly verifyClosure: () => boolean;
}

/**
 * The held facts, outside every object's reach.
 *
 * A `WeakMap` is used on purpose: the facts are not a property of the proof, so no
 * caller can read them, mutate them or fabricate them. Membership in this map is the
 * facts check; the *liveness* of a proof is the separate, module-private record
 * below, and it is the only authority.
 */
const HELD_FACTS = new WeakMap<NativeExpectedProof, NativeExpectedFacts>();

/**
 * The liveness of one proof, outside every object's reach.
 *
 * It outlives the facts on purpose. A released proof must stay recognisable as
 * *released* — and never as a foreign one — after its facts are gone, and the record
 * is what says whether the proof is still outstanding at all.
 *
 * The instance token is here as well, so that `release` can refuse a proof that this
 * instance did not issue without ever touching the resources of the instance that
 * did. The global facts map is never enough to answer that question.
 */
interface NativeExpectedProofStatus {
  /** The issuing instance's own token. Only that instance may release the proof. */
  readonly instance: object;
  /** Whether the authority of the proof has been revoked. */
  released: boolean;
}

const PROOF_STATUS = new WeakMap<NativeExpectedProof, NativeExpectedProofStatus>();

/**
 * An opaque proof.
 *
 * It carries nothing but its own identity. The facts live in a module-private map, so a
 * proof cannot be rebuilt from JSON, cannot be mutated from outside and cannot be
 * presented to another instance.
 */
export class NativeExpectedProof {
  #released = false;

  constructor(brand: symbol) {
    if (brand !== PROOF_BRAND) throw new Error('NATIVE_EXPECTED_PROOF_FORGED');
  }

  /**
   * Whether the proof has been released.
   *
   * It is a *view* of the module-private record, never the record itself: the public
   * surface of the proof is not the authority, and the authority is not derived from
   * anything a caller can reach.
   */
  get released(): boolean {
    const status = PROOF_STATUS.get(this);
    return status === undefined ? this.#released : status.released;
  }

  /** Mark the proof released. Only the owning service may do this. */
  markReleased(): void {
    this.#released = true;
    const status = PROOF_STATUS.get(this);
    if (status !== undefined) status.released = true;
  }
}

/**
 * The aggregate of a cleanup that did not finish.
 *
 * The message is a code and nothing else: no absolute path and no credential is ever
 * disclosed. The causes are kept in a non-enumerable field, so a logged or serialised
 * error carries the code and not the details.
 */
class NativeExpectedCleanupError extends Error {
  constructor(code: string, causes: readonly unknown[]) {
    super(code);
    this.name = 'NativeExpectedCleanupError';
    Object.defineProperty(this, 'errors', {
      value: causes,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }
}

/**
 * Attach the cleanup causes to the primary failure, without making them public.
 *
 * The primary failure keeps its own type, its own message and its own stack: it is
 * still the primary failure. The causes are added in a non-enumerable field, so the
 * error that leaves this module does not disclose a path or a credential.
 *
 * It answers whether the causes could be attached at all.
 */
function attachCleanupFailures(error: unknown, failures: readonly unknown[]): boolean {
  if (typeof error !== 'object' || error === null) return false;
  try {
    Object.defineProperty(error, 'cleanup_errors', {
      value: failures,
      enumerable: false,
      writable: false,
      configurable: true,
    });
    return true;
  } catch {
    // A frozen or sealed failure cannot carry them; the aggregate keeps them instead.
    return false;
  }
}

/** The fixed expected interface. */
export interface NativeExpectedPort {
  /** Read and hash the committed source independently of the editor. */
  prove(binding: NativeExpectedBinding): Promise<NativeExpectedProof>;
  /**
   * The final synchronous guard.
   *
   * It requires the proof to be outstanding, to come from this instance, to carry the
   * very binding it was proved against and that binding's original field snapshot, and
   * to still hold a source closure whose identity and bytes have not changed. It throws
   * when any of that is false.
   */
  assertCurrent(binding: NativeExpectedBinding, proof: NativeExpectedProof): NativeExpectedProjection;
  /** Drop the proof's held facts and release its retained descriptors. */
  release(proof: NativeExpectedProof): void;
  /** Close the service: no further proof may be produced, and the held ones are released. */
  close(): void;
}

/**
 * The approved build record.
 *
 * It is a *reviewed* record, not the manifest that sits next to the built files. The
 * built modules are only accepted when their bytes match a digest that a review
 * approved, and the approval is itself linked to the digest of the tracked inputs.
 */
export interface NativeExpectedApprovedBuild {
  readonly upstream_sha: string;
  /** The digest of the tracked build inputs, recomputed and compared on every load. */
  readonly inputs_sha256: string;
  /** The digest of the approved build manifest. */
  readonly build_sha256: string;
  /** The approved digest of each built module, by its file name. */
  readonly modules: Readonly<Record<string, string>>;
}

/** The pinned built candidate, as it is loaded from the private runtime root. */
export interface NativeExpectedLibrary {
  readonly EXPECTED_PROFILE: typeof NATIVE_EXPECTED_PROFILE;
  readonly upstream_sha: string;
  computeExpectedProjection(input: unknown): ExpectedProjectionResult;
  readonly hydrationCanonicalJson: (value: unknown) => string;
}

export interface NativeExpectedLibraryLoader {
  load(approved: NativeExpectedApprovedBuild): Promise<NativeExpectedLibrary>;
}

/**
 * The private runtime root of this worktree's native hydration build.
 *
 * It is `var/native-hydration-r2`: a private, per-worktree root that holds the pinned
 * 013 source, the pinned 015 source and the built candidate. It is never a shared
 * writable runtime, never `vendor`, and never another worktree's root.
 */
export function nativeExpectedRuntimeRoot(): string {
  return resolve(fileURLToPath(new URL('../../../var/native-hydration-r2', import.meta.url)));
}

/** The private root of the built expected candidate. */
export function nativeExpectedDistRoot(): string {
  return resolve(nativeExpectedRuntimeRoot(), 'managed-native-expected', 'dist');
}

/** The tracked build inputs of this ticket. They are reviewed source, not build output. */
export function nativeExpectedInputsRoot(): string {
  return resolve(fileURLToPath(new URL('../../../tools/agent-driven/product/native-inputs', import.meta.url)));
}

/** The tracked pin of the OpenFilm Studio candidate, reviewed source. */
export function nativeExpectedPinPath(): string {
  return resolve(fileURLToPath(new URL('./openfilm-studio-ui-pin.json', import.meta.url)));
}

/**
 * The approved build record, read from the tracked pin.
 *
 * The pin is reviewed source: changing it is a reviewed change. A build manifest that
 * sits next to the built modules is not, and it is never read for an approval.
 */
export function nativeExpectedApprovalFromPin(pinPath: string = nativeExpectedPinPath()): NativeExpectedApprovedBuild {
  const raw = readFileSync(pinPath, 'utf8');
  const pin = JSON.parse(raw) as {
    readonly native_expected?: {
      readonly upstream_sha?: string;
      readonly inputs_sha256?: string;
      readonly build_sha256?: string;
      readonly modules?: Record<string, string>;
      readonly approval?: string;
    };
  };
  const section = pin.native_expected;
  if (section === undefined) throw new Error('NATIVE_EXPECTED_BUILD_NOT_APPROVED');
  if (section.approval !== 'APPROVED') throw new Error('NATIVE_EXPECTED_BUILD_NOT_APPROVED');
  const modules = section.modules ?? {};
  if (Object.keys(modules).length === 0) throw new Error('NATIVE_EXPECTED_BUILD_NOT_APPROVED');
  if (typeof section.inputs_sha256 !== 'string' || section.inputs_sha256 === '') throw new Error('NATIVE_EXPECTED_BUILD_NOT_APPROVED');
  if (typeof section.build_sha256 !== 'string' || section.build_sha256 === '') throw new Error('NATIVE_EXPECTED_BUILD_NOT_APPROVED');
  return Object.freeze({
    upstream_sha: section.upstream_sha ?? '',
    inputs_sha256: section.inputs_sha256,
    build_sha256: section.build_sha256,
    modules: Object.freeze({ ...modules }),
  });
}

/** The tracked inputs the expected candidate is built from, by name. */
export const NATIVE_EXPECTED_INPUT_FILES = Object.freeze([
  'build-expected.mjs',
  'expected-projection.d.ts',
  'expected-projection.mjs',
  'native-pure.entry.ts',
  'request013.patch',
  'vite.expected.config.mjs',
]);

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/**
 * The digest of the tracked build inputs.
 *
 * It is the digest of the reviewed source files themselves, so a changed input is
 * detected before anything is built or loaded.
 */
export async function nativeExpectedInputsDigest(inputsRoot: string = nativeExpectedInputsRoot()): Promise<string> {
  const lines: string[] = [];
  for (const name of NATIVE_EXPECTED_INPUT_FILES) {
    const bytes = await readFile(resolve(inputsRoot, name));
    lines.push(`${name}\0${sha256(bytes)}`);
  }
  return sha256(Buffer.from(lines.join('\n'), 'utf8'));
}

/**
 * The dependency specifiers a built module declares.
 *
 * Only a `node:` builtin and a relative path that stays inside the verified directory
 * may be imported: a bare specifier would resolve outside the verified bytes, and a
 * relative path that climbs out would too. Either would be an unverified dependency.
 */
export function nativeExpectedModuleSpecifiers(source: string): readonly string[] {
  const found = new Set<string>();
  const patterns = [
    /(?:^|[^\w$])(?:import|export)\s[^;'"]*?from\s*['"]([^'"]+)['"]/gu,
    /(?:^|[^\w$])import\s*['"]([^'"]+)['"]/gu,
    /(?:^|[^\w$])import\s*\(\s*['"]([^'"]+)['"]\s*\)/gu,
    /(?:^|[^\w$])require\s*\(\s*['"]([^'"]+)['"]\s*\)/gu,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier !== undefined) found.add(specifier);
    }
  }
  return [...found].sort();
}

/**
 * Load the pinned built candidate from the private runtime root.
 *
 * The loader is deliberately strict, and it is strict in this order:
 *
 * 1. the approved record must name the pinned upstream;
 * 2. the tracked inputs are re-hashed and must match the approved `inputs_sha256`;
 * 3. the build manifest is hashed and must match the approved `build_sha256`, so a
 *    co-located manifest can never bless a module it did not describe;
 * 4. every module's bytes must match the approved module digest, and every dependency
 *    it declares must be a builtin or a path that stays inside the verified directory;
 * 5. the verified bytes are materialised into a private directory and *those* bytes are
 *    imported, so there is no window between the check and the import;
 * 6. the private directory is removed again once the import has resolved.
 *
 * A missing build, a changed input, a changed manifest, a swapped module, an unbound
 * dependency or a different upstream is a refusal. There is no fallback to another
 * candidate.
 */
export function nativeExpectedLibraryLoader(deps: {
  readonly distRoot?: string;
  readonly inputsRoot?: string;
  readonly runtimeRoot?: string;
} = {}): NativeExpectedLibraryLoader {
  const distRoot = deps.distRoot ?? nativeExpectedDistRoot();
  const inputsRoot = deps.inputsRoot ?? nativeExpectedInputsRoot();
  const runtimeRoot = deps.runtimeRoot ?? nativeExpectedRuntimeRoot();
  return {
    async load(approved: NativeExpectedApprovedBuild): Promise<NativeExpectedLibrary> {
      if (approved.upstream_sha !== NATIVE_EXPECTED_UPSTREAM_SHA) throw new Error('NATIVE_EXPECTED_UPSTREAM_MISMATCH');
      const inputs = await nativeExpectedInputsDigest(inputsRoot);
      if (inputs !== approved.inputs_sha256) throw new Error('NATIVE_EXPECTED_INPUTS_MISMATCH');
      const manifestBytes = await readFile(resolve(distRoot, 'build-manifest.json'))
        .catch(() => { throw new Error('NATIVE_EXPECTED_BUILD_MISSING'); });
      if (sha256(manifestBytes) !== approved.build_sha256) throw new Error('NATIVE_EXPECTED_BUILD_MANIFEST_MISMATCH');
      const names = Object.keys(approved.modules).sort();
      if (names.length === 0) throw new Error('NATIVE_EXPECTED_BUILD_NOT_APPROVED');
      const verifiedRoot = resolve(runtimeRoot, 'verified', approved.build_sha256);
      await mkdir(verifiedRoot, { recursive: true, mode: 0o700 });
      const verified: Array<[string, string]> = [];
      for (const name of names) {
        const bytes = await readFile(resolve(distRoot, name)).catch(() => { throw new Error('NATIVE_EXPECTED_BUILD_MISSING'); });
        if (sha256(bytes) !== approved.modules[name]) throw new Error('NATIVE_EXPECTED_MODULE_MISMATCH');
        // The imported file is a private copy of the *verified* bytes, so nothing can be
        // substituted between the check and the import.
        const target = resolve(verifiedRoot, name);
        await writeFile(target, bytes, { flag: 'wx', mode: 0o600 }).catch(() => undefined);
        const copied = await readFile(target);
        if (sha256(copied) !== approved.modules[name]) throw new Error('NATIVE_EXPECTED_VERIFIED_COPY_MISMATCH');
        // Every declared dependency must stay inside the verified directory.
        for (const specifier of nativeExpectedModuleSpecifiers(copied.toString('utf8'))) {
          if (specifier.startsWith('node:')) continue;
          if (!specifier.startsWith('.')) throw new Error('NATIVE_EXPECTED_MODULE_DEPENDENCY_UNBOUND');
          const target2 = resolve(verifiedRoot, specifier);
          if (!target2.startsWith(verifiedRoot + '/')) throw new Error('NATIVE_EXPECTED_MODULE_DEPENDENCY_UNBOUND');
          if (!names.includes(target2.slice(verifiedRoot.length + 1))) throw new Error('NATIVE_EXPECTED_MODULE_DEPENDENCY_UNBOUND');
        }
        verified.push([name, target]);
      }
      const expectedPath = verified.find(([name]) => name === 'expected-projection.mjs');
      const purePath = verified.find(([name]) => name === 'native-pure-library.mjs');
      if (expectedPath === undefined || purePath === undefined) throw new Error('NATIVE_EXPECTED_MODULE_MISSING');
      try {
        const expected = (await import(pathToFileURL(expectedPath[1]).href)) as unknown as {
          readonly EXPECTED_PROFILE: string;
          computeExpectedProjection(input: unknown): ExpectedProjectionResult;
        };
        const pure = (await import(pathToFileURL(purePath[1]).href)) as unknown as {
          readonly hydrationCanonicalJson: (value: unknown) => string;
        };
        if (expected.EXPECTED_PROFILE !== NATIVE_EXPECTED_PROFILE) throw new Error('NATIVE_EXPECTED_PROFILE_MISMATCH');
        if (typeof pure.hydrationCanonicalJson !== 'function') throw new Error('NATIVE_EXPECTED_CANONICAL_MISSING');
        return Object.freeze({
          EXPECTED_PROFILE: NATIVE_EXPECTED_PROFILE,
          upstream_sha: NATIVE_EXPECTED_UPSTREAM_SHA,
          computeExpectedProjection: expected.computeExpectedProjection,
          hydrationCanonicalJson: pure.hydrationCanonicalJson,
        });
      } finally {
        // The private copy exists only for the import; nothing is left behind.
        await rm(verifiedRoot, { recursive: true, force: true }).catch(() => undefined);
      }
    },
  };
}

export interface OpenFilmNativeExpectedDeps {
  /** MAIN's committed reader. Without it nothing can be proved. */
  readonly source: NativeExpectedSourcePort;
  /** The pinned built candidate's loader. */
  readonly loader: NativeExpectedLibraryLoader;
  /** The reviewed approval of the build. Without it nothing is loaded. */
  readonly approved: NativeExpectedApprovedBuild;
}

/**
 * The independent expected service.
 *
 * It computes, it never observes: nothing it returns is derived from the editor's own
 * numbers. Its `unsupported` answers are honest refusals, and they are the reason no
 * acknowledgement is written.
 */
export class OpenFilmNativeExpected implements NativeExpectedPort {
  readonly #source: NativeExpectedSourcePort;
  readonly #loader: NativeExpectedLibraryLoader;
  readonly #approved: NativeExpectedApprovedBuild;
  /** This instance's own token. A proof from another instance is refused. */
  readonly #instance = {};
  readonly #outstanding = new Set<NativeExpectedProof>();
  /**
   * The proofs this instance has already released.
   *
   * It is the instance's own record of its own work, so a repeated release is a
   * no-op and a foreign proof can never be mistaken for one of them.
   */
  readonly #released = new WeakSet<NativeExpectedProof>();
  /**
   * The retained resources this instance has already released.
   *
   * A resource is released exactly once. The same object may appear twice in one
   * list, and a raw descriptor number is never retried: closing a descriptor that is
   * already closed can close an unrelated file that took its number.
   */
  readonly #releasedResources = new WeakSet<NativeExpectedRetainedFile>();
  #library: Promise<NativeExpectedLibrary> | null = null;
  #closed = false;
  /**
   * Whether a cleanup failed and left the outcome of a release unknown.
   *
   * It is sticky: while it holds, this instance can no longer prove anything, because
   * it cannot say that every descriptor it took ownership of was released.
   */
  #cleanupUncertain = false;

  constructor(deps: OpenFilmNativeExpectedDeps) {
    this.#source = deps.source;
    this.#loader = deps.loader;
    this.#approved = deps.approved;
  }

  #load(): Promise<NativeExpectedLibrary> {
    if (this.#library === null) {
      // A failed load is not a permanent answer: the cache is dropped so a later round
      // can try again. What stays permanent is the refusal of an unapproved candidate,
      // which the loader decides again every time.
      this.#library = this.#loader.load(this.#approved).catch((error: unknown) => {
        this.#library = null;
        throw error;
      });
    }
    return this.#library;
  }

  async prove(binding: NativeExpectedBinding): Promise<NativeExpectedProof> {
    if (this.#closed) throw new Error('NATIVE_EXPECTED_CLOSED');
    if (this.#cleanupUncertain) throw new Error('NATIVE_EXPECTED_CLEANUP_UNCERTAIN');
    if (!binding.isCurrent()) throw new Error('NATIVE_EXPECTED_BINDING_STALE');
    const library = await this.#load();
    // The candidate may have loaded after the service was closed. `close` is
    // synchronous and cannot wait for this promise, so the state is checked again
    // here, and the read is not started at all.
    if (this.#closed) throw new Error('NATIVE_EXPECTED_CLOSED');
    if (this.#cleanupUncertain) throw new Error('NATIVE_EXPECTED_CLEANUP_UNCERTAIN');
    if (!binding.isCurrent()) throw new Error('NATIVE_EXPECTED_BINDING_STALE');
    const facts = await this.#source.readSource({ binding });
    // The handles are taken over the moment the read resolves. From here on they are
    // this service's, and every failure path closes them.
    const retained = facts.retained;
    try {
      // The read may have returned after the service was closed. The resources it
      // delivered are released and the proof is refused: a closed service issues
      // nothing, and a late read is not a reason to leak a descriptor.
      if (this.#closed) throw new Error('NATIVE_EXPECTED_CLOSED');
      if (this.#cleanupUncertain) throw new Error('NATIVE_EXPECTED_CLEANUP_UNCERTAIN');
      if (!binding.isCurrent()) throw new Error('NATIVE_EXPECTED_BINDING_STALE');
      const projection = this.#projection(binding, facts, library);
      // Every value that comes from a callback is computed *before* the guard that
      // decides whether a proof may be issued. A callback may close the service or
      // leave a cleanup uncertain, and the guard has to see that.
      const input_sha256 = sha256(Buffer.from(library.hydrationCanonicalJson(facts.expected_input), 'utf8'));
      // The snapshot is taken before the last liveness check, so that a binding
      // that is changed by that callback is caught by the comparison later.
      const binding_snapshot = snapshotNativeExpectedBinding(binding);
      // The liveness of the session is asked exactly once, and never in a loop.
      const current = binding.isCurrent();
      // The terminal guard of the service. Nothing runs a callback after this
      // point: the proof is issued from here on, and no callback can slip between
      // the guard and the issuance.
      if (this.#closed) throw new Error('NATIVE_EXPECTED_CLOSED');
      if (this.#cleanupUncertain) throw new Error('NATIVE_EXPECTED_CLEANUP_UNCERTAIN');
      if (!current) throw new Error('NATIVE_EXPECTED_BINDING_STALE');
      const proof = new NativeExpectedProof(PROOF_BRAND);
      HELD_FACTS.set(proof, {
        instance: this.#instance,
        binding,
        binding_snapshot,
        projection,
        input_sha256,
        retained,
        verifyClosure: facts.verifyClosure,
      });
      PROOF_STATUS.set(proof, { instance: this.#instance, released: false });
      this.#outstanding.add(proof);
      return proof;
    } catch (error) {
      // Nothing may leak: a failure after the reader returned still releases its
      // files, and every one of them is attempted even when an earlier one fails.
      this.#fail(error, this.#releaseResources(retained));
    }
  }

  assertCurrent(binding: NativeExpectedBinding, proof: NativeExpectedProof): NativeExpectedProjection {
    if (this.#closed) throw new Error('NATIVE_EXPECTED_CLOSED');
    // An uncertain cleanup is sticky and fail-closed: this instance cannot say that
    // everything it took ownership of was released, so it cannot certify anything.
    if (this.#cleanupUncertain) throw new Error('NATIVE_EXPECTED_CLEANUP_UNCERTAIN');
    const status = PROOF_STATUS.get(proof);
    if (status === undefined) throw new Error('NATIVE_EXPECTED_PROOF_FOREIGN');
    if (status.released) throw new Error('NATIVE_EXPECTED_PROOF_RELEASED');
    const facts = HELD_FACTS.get(proof);
    if (facts === undefined) throw new Error('NATIVE_EXPECTED_PROOF_FOREIGN');
    if (facts.instance !== this.#instance) throw new Error('NATIVE_EXPECTED_PROOF_FOREIGN');
    if (!this.#outstanding.has(proof)) throw new Error('NATIVE_EXPECTED_PROOF_FOREIGN');
    // The very binding object, and its immutable field snapshot: neither the object's
    // identity nor the fields alone are enough, so both are checked.
    if (facts.binding !== binding) throw new Error('NATIVE_EXPECTED_BINDING_MOVED');
    const snapshot = snapshotNativeExpectedBinding(binding);
    const held = facts.binding_snapshot;
    if (snapshot.project_id !== held.project_id
      || snapshot.native_project_id !== held.native_project_id
      || snapshot.revision !== held.revision
      || snapshot.snapshot_id !== held.snapshot_id
      || snapshot.source_digest !== held.source_digest
      || snapshot.instance_generation !== held.instance_generation
      || snapshot.selection_version !== held.selection_version
      || snapshot.workspace_ref !== held.workspace_ref
      || snapshot.workspace_snapshot_id !== held.workspace_snapshot_id
      || snapshot.workspace_source_digest !== held.workspace_source_digest
      || snapshot.workspace_revision !== held.workspace_revision) throw new Error('NATIVE_EXPECTED_BINDING_MOVED');
    if (!binding.isCurrent()) throw new Error('NATIVE_EXPECTED_BINDING_STALE');
    // The synchronous final guard: the whole closure, and then every retained file.
    if (facts.verifyClosure() !== true) throw new Error('NATIVE_EXPECTED_CLOSURE_MOVED');
    for (const file of facts.retained) {
      if (file.verify() !== true) throw new Error('NATIVE_EXPECTED_SOURCE_MOVED');
    }
    // The callbacks above may have closed the service or released this proof. The
    // authority is checked once more — no callback is asked again — and a
    // projection is never returned after it was revoked.
    if (this.#closed) throw new Error('NATIVE_EXPECTED_CLOSED');
    if (this.#cleanupUncertain) throw new Error('NATIVE_EXPECTED_CLEANUP_UNCERTAIN');
    const finalStatus = PROOF_STATUS.get(proof);
    if (finalStatus === undefined) throw new Error('NATIVE_EXPECTED_PROOF_FOREIGN');
    if (finalStatus.released) throw new Error('NATIVE_EXPECTED_PROOF_RELEASED');
    if (!this.#outstanding.has(proof)) throw new Error('NATIVE_EXPECTED_PROOF_FOREIGN');
    return facts.projection;
  }

  release(proof: NativeExpectedProof): void {
    const status = PROOF_STATUS.get(proof);
    // A proof this instance did not issue is refused, and nothing of the instance
    // that did issue it is touched: the global facts map is never the authority.
    if (status === undefined) throw new Error('NATIVE_EXPECTED_PROOF_FOREIGN');
    if (status.instance !== this.#instance) throw new Error('NATIVE_EXPECTED_PROOF_FOREIGN');
    if (this.#released.has(proof)) {
      // The release is idempotent: the descriptors are not touched again. But an
      // earlier uncertain cleanup is not erased by the absence of a record, so this
      // does not report a success it cannot stand behind.
      if (this.#cleanupUncertain) throw new Error('NATIVE_EXPECTED_CLEANUP_UNCERTAIN');
      return;
    }
    const facts = HELD_FACTS.get(proof);
    const retained = facts?.retained ?? [];
    // The authority is revoked *before* the cleanup: a proof whose cleanup failed
    // must not be assertable afterwards, and the failure of one release must not
    // stop the release of another proof.
    //
    // The revocation is the module-private record and nothing else. The proof's own
    // public surface belongs to the caller, who may replace a method or a getter
    // on it; a call into that surface would strand the descriptors below, skip the
    // other proofs and hide the uncertainty of a failed cleanup. The observable
    // `released` state is unchanged — it is a view of this very record.
    status.released = true;
    this.#released.add(proof);
    this.#outstanding.delete(proof);
    HELD_FACTS.delete(proof);
    const failures = this.#releaseResources(retained);
    if (failures.length > 0) {
      this.#cleanupUncertain = true;
      throw new NativeExpectedCleanupError('NATIVE_EXPECTED_CLEANUP_FAILED', failures);
    }
  }

  close(): void {
    this.#closed = true;
    const failures: unknown[] = [];
    for (const proof of [...this.#outstanding]) {
      const status = PROOF_STATUS.get(proof);
      if (status === undefined || status.instance !== this.#instance) continue;
      const facts = HELD_FACTS.get(proof);
      const retained = facts?.retained ?? [];
      // The authority is revoked before the cleanup, proof by proof, so that a
      // cleanup that fails cannot leave a proof that still asserts. The record is
      // the only thing that is written: the proof's own public surface is the
      // caller's, and a replaced method there must not stop this close.
      status.released = true;
      this.#released.add(proof);
      this.#outstanding.delete(proof);
      HELD_FACTS.delete(proof);
      // Every proof is attempted, even when an earlier one failed to release.
      failures.push(...this.#releaseResources(retained));
    }
    this.#outstanding.clear();
    this.#library = null;
    if (failures.length > 0) {
      this.#cleanupUncertain = true;
      throw new NativeExpectedCleanupError('NATIVE_EXPECTED_CLEANUP_FAILED', failures);
    }
    // A close that follows an uncertain cleanup does not report a success it cannot
    // stand behind.
    if (this.#cleanupUncertain) throw new Error('NATIVE_EXPECTED_CLEANUP_UNCERTAIN');
  }

  /**
   * Release a set of retained descriptors.
   *
   * Every descriptor is attempted, even when an earlier one failed: the first
   * failure must not strand the rest. A descriptor this instance already released is
   * never released again, and the same object listed twice is one resource, not two.
   *
   * The failures are returned and never thrown: the caller keeps the primary failure
   * and adds these to it.
   */
  #releaseResources(resources: readonly NativeExpectedRetainedFile[]): unknown[] {
    const failures: unknown[] = [];
    for (const resource of resources) {
      if (this.#releasedResources.has(resource)) continue;
      // The resource is marked before the attempt: an unknown outcome is never
      // retried on a raw descriptor number.
      this.#releasedResources.add(resource);
      try {
        resource.close();
      } catch (error) {
        failures.push(error);
      }
    }
    return failures;
  }

  /**
   * Fail with the primary error and the cleanup failures it collected.
   *
   * The primary error is still the primary error: it keeps its type, its message and
   * its stack, and it carries the cleanup causes in a non-enumerable field. When it
   * cannot carry them, the aggregate keeps them instead, and nothing is swallowed.
   */
  #fail(error: unknown, failures: readonly unknown[]): never {
    if (failures.length === 0) throw error;
    this.#cleanupUncertain = true;
    if (attachCleanupFailures(error, failures)) throw error;
    throw new NativeExpectedCleanupError('NATIVE_EXPECTED_CLEANUP_FAILED', [error, ...failures]);
  }

  /**
   * The expected projection of one read source.
   *
   * `settings` and `markers` come from the pinned 015 helper. `subtitle_style` and
   * `captions` come from the Host's own reader and the fixed original native rules, and
   * they are hashed with the *same* canonical implementation the editor used.
   */
  #projection(binding: NativeExpectedBinding, facts: NativeExpectedSourceFacts, library: NativeExpectedLibrary): NativeExpectedProjection {
    const unsupported = (reason: string): NativeExpectedPart => Object.freeze({ state: 'unsupported', origin: null, effective_sha256: null, reason });
    const computed = library.computeExpectedProjection(facts.expected_input);
    const parts: Record<NativeExpectedPartKind, NativeExpectedPart> = {
      settings: unsupported('NOT_COMPUTED'),
      subtitle_style: unsupported('NOT_COMPUTED'),
      captions: unsupported('NOT_COMPUTED'),
      markers: unsupported('NOT_COMPUTED'),
    };
    if (computed.status !== 'computed') {
      const reason = `EXPECTED_${computed.reason}`;
      for (const kind of NATIVE_EXPECTED_PARTS) parts[kind] = unsupported(reason);
    } else {
      // The 013 contract is explicit about the three parts that come from the project's
      // own sources: settings, captions and markers are revalidated as project and
      // hydrated, *including a legitimate empty parsed result*. The presence of the
      // source file is not what the state says; the parsed value is. So an absent
      // settings file still expects a hydrated part, with the digest of the empty
      // parsed settings.
      parts.settings = this.#part('hydrated', 'project', computed.settings.sha256);
      parts.markers = this.#part('hydrated', 'project', computed.markers.sha256);
      parts.captions = this.#effective('captions', facts.captions, library, 'hydrated', 'project');
      // The style is the one part that may be absent: a project without a style uses
      // the pinned default, and only then is the part absent_default with the explicit
      // default's origin.
      parts.subtitle_style = this.#effective('subtitle_style', facts.style, library,
        facts.style.state === 'present' ? 'hydrated' : 'absent_default',
        facts.style.state === 'present' ? 'project' : 'explicit_default');
    }
    return Object.freeze({
      project_id: binding.project_id,
      revision: binding.revision,
      snapshot_id: binding.snapshot_id,
      source_digest: binding.source_digest,
      film_sha256: facts.film.sha256,
      film_bytes: facts.film.bytes,
      native_rev: facts.film.native_rev,
      source_closure: Object.freeze(facts.entries.map(entry => Object.freeze({ relative_path: entry.relative_path, sha256: entry.sha256 }))),
      selection_version: binding.selection_version,
      parts: Object.freeze(parts),
    });
  }

  #part(
    state: 'hydrated' | 'absent_default',
    origin: NativeExpectedOrigin,
    sha256: string,
  ): NativeExpectedPart {
    return Object.freeze({ state, origin, effective_sha256: sha256, reason: null });
  }

  /**
   * The digest of one part the pinned helper does not cover.
   *
   * It is the exact 013 effective-value preimage, hashed with the pinned canonical
   * implementation. A part that is not present is not a null hash: it is the digest of
   * the pinned default the native would consume.
   */
  #effective(
    kind: NativeExpectedPartKind,
    fact: { readonly state: 'present' | 'absent'; readonly value: unknown },
    library: NativeExpectedLibrary,
    state: 'hydrated' | 'absent_default',
    origin: NativeExpectedOrigin,
  ): NativeExpectedPart {
    let canonical: string;
    try {
      canonical = library.hydrationCanonicalJson({ format: NATIVE_EFFECTIVE_FORMAT, part: kind, value: fact.value });
    } catch {
      return Object.freeze({ state: 'unsupported', origin: null, effective_sha256: null, reason: 'EXPECTED_VALUE_NOT_JSON' });
    }
    return Object.freeze({
      state,
      origin,
      effective_sha256: sha256(Buffer.from(canonical, 'utf8')),
      reason: null,
    });
  }
}
