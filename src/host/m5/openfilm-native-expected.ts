import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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
 * `release(proof)` / `close()`. The proof is opaque and holds the original file
 * identities for as long as the verification needs them; it cannot be rebuilt from JSON.
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

/** One closed source file of the committed workspace. */
export interface NativeExpectedSourceEntry {
  readonly relative_path: string;
  readonly sha256: string;
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
}

/**
 * MAIN's committed reader (the I4 closure).
 *
 * It is a port, not a second implementation: the Host owns the committed source, and
 * this service consumes what the Host reads. When the reader is absent or refuses, the
 * expected value is `unsupported` and no acknowledgement is produced.
 */
export interface NativeExpectedSourcePort {
  readSource(input: { readonly binding: NativeExpectedBinding }): Promise<NativeExpectedSourceFacts>;
}

/** What one expected part is. */
export type NativeExpectedPartState = 'hydrated' | 'absent_default' | 'unsupported';

/** One expected part: its state and its own effective digest. */
export interface NativeExpectedPart {
  readonly state: NativeExpectedPartState;
  readonly effective_sha256: string | null;
  readonly reason: string | null;
}

/**
 * The expected projection of the committed source.
 *
 * It is what the editor is compared against. Every part carries its *own* digest, and an
 * absent part carries the digest of the pinned default rather than a null.
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

/** The facts a proof holds while a verification is in flight. */
export interface NativeExpectedFacts {
  readonly binding: NativeExpectedBinding;
  readonly projection: NativeExpectedProjection;
  readonly input_sha256: string;
}

/**
 * The brand of a real proof.
 *
 * It is a private symbol, so a proof cannot be built from JSON or from a plain object
 * literal by anything outside this module.
 */
const PROOF_BRAND = Symbol('narralens.native-expected-proof@1');

/**
 * An opaque proof.
 *
 * It holds the original file identities for as long as the verification needs them, and
 * it is released explicitly. `assertCurrent` refuses a released proof.
 */
export class NativeExpectedProof {
  readonly #facts: NativeExpectedFacts;
  #released = false;

  constructor(brand: symbol, facts: NativeExpectedFacts) {
    if (brand !== PROOF_BRAND) throw new Error('NATIVE_EXPECTED_PROOF_FORGED');
    this.#facts = facts;
  }

  /** The held facts. They are readable only by the service that owns the proof. */
  get facts(): NativeExpectedFacts { return this.#facts; }

  /** Whether the proof has been released. */
  get released(): boolean { return this.#released; }

  /** Drop the held identities. The proof is dead afterwards. */
  release(): void { this.#released = true; }
}

/** The fixed expected interface. */
export interface NativeExpectedPort {
  /** Read and hash the committed source independently of the editor. */
  prove(binding: NativeExpectedBinding): Promise<NativeExpectedProof>;
  /** Re-check that the binding and the proof still describe the same current source. */
  assertCurrent(binding: NativeExpectedBinding, proof: NativeExpectedProof): NativeExpectedProjection;
  /** Drop the proof's held identities. */
  release(proof: NativeExpectedProof): void;
  /** Close the service: no further proof may be produced, and the held ones are dropped. */
  close(): void;
}

/** The pinned built candidate, as it is loaded from the private runtime root. */
export interface NativeExpectedLibrary {
  readonly EXPECTED_PROFILE: typeof NATIVE_EXPECTED_PROFILE;
  readonly upstream_sha: string;
  computeExpectedProjection(input: unknown): ExpectedProjectionResult;
  readonly hydrationCanonicalJson: (value: unknown) => string;
}

/** The build manifest the pinned candidate leaves behind. */
interface NativeExpectedBuildManifest {
  readonly kind: string;
  readonly upstream_sha: string;
  readonly files: ReadonlyArray<{ readonly path: string; readonly bytes: number; readonly sha256: string }>;
}

export interface NativeExpectedLibraryLoader {
  load(): Promise<NativeExpectedLibrary>;
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

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/**
 * Load the pinned built candidate from the private runtime root.
 *
 * The loader is deliberately strict: the build manifest must name the pinned upstream,
 * and the two modules it loads must be the exact bytes the manifest recorded. A
 * missing build, a changed byte or a different upstream is a refusal — never a silent
 * fallback to another candidate.
 */
export function nativeExpectedLibraryLoader(distRoot: string = nativeExpectedDistRoot()): NativeExpectedLibraryLoader {
  return {
    async load(): Promise<NativeExpectedLibrary> {
      const manifestRaw = await readFile(resolve(distRoot, 'build-manifest.json'), 'utf8')
        .catch(() => { throw new Error('NATIVE_EXPECTED_BUILD_MISSING'); });
      const manifest = JSON.parse(manifestRaw) as NativeExpectedBuildManifest;
      if (manifest.kind !== 'narralens.native-expected-projection-build@1') throw new Error('NATIVE_EXPECTED_BUILD_MANIFEST_INVALID');
      if (manifest.upstream_sha !== NATIVE_EXPECTED_UPSTREAM_SHA) throw new Error('NATIVE_EXPECTED_UPSTREAM_MISMATCH');
      const recorded = new Map(manifest.files.map(file => [file.path, file.sha256]));
      const expectedModule = resolve(distRoot, 'expected-projection.mjs');
      const pureModule = resolve(distRoot, 'native-pure-library.mjs');
      for (const [file, path] of [[expectedModule, 'expected-projection.mjs'], [pureModule, 'native-pure-library.mjs']] as const) {
        const bytes = await readFile(file).catch(() => { throw new Error('NATIVE_EXPECTED_BUILD_MISSING'); });
        if (recorded.get(path) !== sha256(bytes)) throw new Error('NATIVE_EXPECTED_BUILD_BYTES_MISMATCH');
      }
      const expected = (await import(pathToFileURL(expectedModule).href)) as unknown as {
        readonly EXPECTED_PROFILE: string;
        computeExpectedProjection(input: unknown): ExpectedProjectionResult;
      };
      const pure = (await import(pathToFileURL(pureModule).href)) as unknown as {
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
    },
  };
}

export interface OpenFilmNativeExpectedDeps {
  /** MAIN's committed reader. Without it nothing can be proved. */
  readonly source: NativeExpectedSourcePort;
  /** The pinned built candidate's loader. */
  readonly loader: NativeExpectedLibraryLoader;
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
  readonly #outstanding = new Set<NativeExpectedProof>();
  #library: Promise<NativeExpectedLibrary> | null = null;
  #closed = false;

  constructor(deps: OpenFilmNativeExpectedDeps) {
    this.#source = deps.source;
    this.#loader = deps.loader;
  }

  #load(): Promise<NativeExpectedLibrary> {
    this.#library ??= this.#loader.load();
    return this.#library;
  }

  async prove(binding: NativeExpectedBinding): Promise<NativeExpectedProof> {
    if (this.#closed) throw new Error('NATIVE_EXPECTED_CLOSED');
    if (!binding.isCurrent()) throw new Error('NATIVE_EXPECTED_BINDING_STALE');
    const library = await this.#load();
    if (!binding.isCurrent()) throw new Error('NATIVE_EXPECTED_BINDING_STALE');
    const facts = await this.#source.readSource({ binding });
    if (!binding.isCurrent()) throw new Error('NATIVE_EXPECTED_BINDING_STALE');
    const projection = this.#projection(binding, facts, library);
    const proof = new NativeExpectedProof(PROOF_BRAND, {
      binding,
      projection,
      input_sha256: sha256(Buffer.from(library.hydrationCanonicalJson(facts.expected_input), 'utf8')),
    });
    this.#outstanding.add(proof);
    return proof;
  }

  assertCurrent(binding: NativeExpectedBinding, proof: NativeExpectedProof): NativeExpectedProjection {
    if (this.#closed) throw new Error('NATIVE_EXPECTED_CLOSED');
    if (proof.released) throw new Error('NATIVE_EXPECTED_PROOF_RELEASED');
    const facts = proof.facts;
    if (!binding.isCurrent()) throw new Error('NATIVE_EXPECTED_BINDING_STALE');
    if (facts.binding.revision !== binding.revision
      || facts.binding.snapshot_id !== binding.snapshot_id
      || facts.binding.source_digest !== binding.source_digest
      || facts.binding.selection_version !== binding.selection_version
      || facts.binding.instance_generation !== binding.instance_generation
      || facts.binding.project_id !== binding.project_id) throw new Error('NATIVE_EXPECTED_BINDING_MOVED');
    return facts.projection;
  }

  release(proof: NativeExpectedProof): void {
    this.#outstanding.delete(proof);
    proof.release();
  }

  close(): void {
    this.#closed = true;
    for (const proof of this.#outstanding) proof.release();
    this.#outstanding.clear();
    this.#library = null;
  }

  /**
   * The expected projection of one read source.
   *
   * `settings` and `markers` come from the pinned 015 helper. `subtitle_style` and
   * `captions` come from the Host's own reader and the fixed original native rules, and
   * they are hashed with the *same* canonical implementation the editor used.
   */
  #projection(binding: NativeExpectedBinding, facts: NativeExpectedSourceFacts, library: NativeExpectedLibrary): NativeExpectedProjection {
    const unsupported = (reason: string): NativeExpectedPart => ({ state: 'unsupported', effective_sha256: null, reason });
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
      parts.settings = this.#part('settings', facts.expected_input.settings.file.state === 'present' ? 'hydrated' : 'absent_default', computed.settings.sha256);
      parts.markers = this.#part('markers', facts.expected_input.markers.file.state === 'present' ? 'hydrated' : 'absent_default', computed.markers.sha256);
      parts.subtitle_style = this.#effective('subtitle_style', facts.style, library);
      parts.captions = this.#effective('captions', facts.captions, library);
    }
    return Object.freeze({
      project_id: binding.project_id,
      revision: binding.revision,
      snapshot_id: binding.snapshot_id,
      source_digest: binding.source_digest,
      film_sha256: facts.film.sha256,
      film_bytes: facts.film.bytes,
      native_rev: facts.film.native_rev,
      source_closure: Object.freeze([...facts.entries].map(entry => Object.freeze({ ...entry }))),
      selection_version: binding.selection_version,
      parts: Object.freeze(parts),
    });
  }

  #part(kind: NativeExpectedPartKind, state: 'hydrated' | 'absent_default', sha256: string): NativeExpectedPart {
    return Object.freeze({ state, effective_sha256: sha256, reason: null });
  }

  /**
   * The digest of one part the pinned helper does not cover.
   *
   * It is the exact 013 effective-value preimage, hashed with the pinned canonical
   * implementation. A part that is not present is not a null hash: it is the digest of
   * the pinned default the native would consume.
   */
  #effective(kind: NativeExpectedPartKind, fact: { readonly state: 'present' | 'absent'; readonly value: unknown }, library: NativeExpectedLibrary): NativeExpectedPart {
    let canonical: string;
    try {
      canonical = library.hydrationCanonicalJson({ format: NATIVE_EFFECTIVE_FORMAT, part: kind, value: fact.value });
    } catch {
      return Object.freeze({ state: 'unsupported', effective_sha256: null, reason: 'EXPECTED_VALUE_NOT_JSON' });
    }
    return Object.freeze({
      state: fact.state === 'present' ? 'hydrated' : 'absent_default',
      effective_sha256: sha256(Buffer.from(canonical, 'utf8')),
      reason: null,
    });
  }
}
