import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { closeSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import {
  NATIVE_OBSERVATION_FORMAT,
  nativeSecondsCanonical,
  validateNativeDocumentObservation,
  validateNativeHydrationObservation,
  validateNativeObservationEnvelope,
  validateNativeSelectionObservation,
} from '../../../src/host/m5/native-observation.js';
import {
  NATIVE_EXPECTED_INPUT_FILES,
  NATIVE_EXPECTED_UPSTREAM_SHA,
  OpenFilmNativeExpected,
  nativeExpectedInputsDigest,
  nativeExpectedLibraryLoader,
  snapshotNativeExpectedBinding,
  type NativeExpectedBinding,
  type NativeExpectedRetainedFile,
  type NativeExpectedSourceFacts,
  type NativeExpectedSourcePort,
} from '../../../src/host/m5/openfilm-native-expected.js';

/**
 * The closed native observation envelope (A-R2, L05).
 *
 * These cases are pure: they start no Host, open no listener, read no fixture and need
 * no heavy-resource slot. They prove the *shape* rules of the ingress, and they are
 * deliberately written so that a laxer implementation turns them red.
 */

const HASH = 'a'.repeat(64);
const OTHER_HASH = 'b'.repeat(64);

describe('the native observation envelope', () => {
  it('accepts exactly the four closed fields', () => {
    const envelope = validateNativeObservationEnvelope({
      format: NATIVE_OBSERVATION_FORMAT,
      sequence: 1,
      event_kind: 'hydration',
      event: { project_id: 'native' },
    });
    expect(envelope.ok).toBe(true);
  });

  it('refuses an envelope that carries any identity of its own', () => {
    for (const extra of ['project_id', 'actor', 'session', 'grant', 'revision', 'snapshot_id', 'source_digest', 'approval', 'proof']) {
      const envelope = validateNativeObservationEnvelope({
        format: NATIVE_OBSERVATION_FORMAT,
        sequence: 1,
        event_kind: 'hydration',
        event: { project_id: 'native' },
        [extra]: 'anything',
      });
      expect(envelope.ok, extra).toBe(false);
      if (!envelope.ok) expect(envelope.reason).toBe('ENVELOPE_FIELDS_NOT_CLOSED');
    }
  });

  it('refuses an unknown format, an unknown event kind and a non-integer sequence', () => {
    expect(validateNativeObservationEnvelope({ format: 'narralens.native-observation@2', sequence: 1, event_kind: 'hydration', event: {} }).ok).toBe(false);
    expect(validateNativeObservationEnvelope({ format: NATIVE_OBSERVATION_FORMAT, sequence: 1, event_kind: 'write', event: {} }).ok).toBe(false);
    expect(validateNativeObservationEnvelope({ format: NATIVE_OBSERVATION_FORMAT, sequence: 0, event_kind: 'hydration', event: {} }).ok).toBe(false);
    expect(validateNativeObservationEnvelope({ format: NATIVE_OBSERVATION_FORMAT, sequence: 1.5, event_kind: 'hydration', event: {} }).ok).toBe(false);
    expect(validateNativeObservationEnvelope({ format: NATIVE_OBSERVATION_FORMAT, sequence: 1, event_kind: 'hydration', event: [] }).ok).toBe(false);
  });
});

describe('the original p2 document observation', () => {
  it('accepts a committed document and an invalidation', () => {
    const committed = validateNativeDocumentObservation({
      protocol_version: 1,
      kind: 'document_dom_committed',
      project_id: 'native-1',
      editor_view_id: 'view-1',
      document_epoch: 4,
      native_rev: 'rev-1',
      film_sha256: HASH,
      utf8_byte_length: 1024,
    });
    expect(committed.ok).toBe(true);
    const invalidated = validateNativeDocumentObservation({
      protocol_version: 1,
      kind: 'invalidated',
      project_id: 'native-1',
      editor_view_id: 'view-1',
      document_epoch: 5,
      reason: 'dirty',
    });
    expect(invalidated.ok).toBe(true);
  });

  it('refuses a foreign protocol version, a broken hash and an unknown reason', () => {
    const base = {
      protocol_version: 1,
      kind: 'document_dom_committed',
      project_id: 'native-1',
      editor_view_id: 'view-1',
      document_epoch: 4,
      native_rev: 'rev-1',
      film_sha256: HASH,
      utf8_byte_length: 1024,
    };
    expect(validateNativeDocumentObservation({ ...base, protocol_version: 2 }).ok).toBe(false);
    expect(validateNativeDocumentObservation({ ...base, film_sha256: 'not-a-hash' }).ok).toBe(false);
    expect(validateNativeDocumentObservation({ ...base, kind: 'invalidated', reason: 'whatever' }).ok).toBe(false);
    expect(validateNativeDocumentObservation({ ...base, document_epoch: -1 }).ok).toBe(false);
  });
});

describe('the original 013 hydration observation', () => {
  const part = (state: string, origin: string, effective_sha256: string | null) => ({ state, origin, effective_sha256 });
  const event = (parts: Record<string, unknown>) => ({
    project_id: 'native-1',
    editor_view_id: 'view-1',
    document_epoch: 3,
    hydration_epoch: 7,
    parts,
  });

  it('accepts exactly the four parts with a project origin', () => {
    const check = validateNativeHydrationObservation(event({
      settings: part('hydrated', 'project', HASH),
      subtitle_style: part('hydrated', 'project', OTHER_HASH),
      captions: part('absent_default', 'explicit_default', HASH),
      markers: part('hydrated', 'project', HASH),
    }));
    expect(check.ok).toBe(true);
  });

  it('refuses a part set that is not exactly the four', () => {
    const check = validateNativeHydrationObservation(event({
      settings: part('hydrated', 'project', HASH),
      subtitle_style: part('hydrated', 'project', HASH),
      captions: part('hydrated', 'project', HASH),
    }));
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toBe('HYDRATION_PARTS_NOT_CLOSED');
  });

  it('refuses a browser preference as a proven origin', () => {
    const check = validateNativeHydrationObservation(event({
      settings: part('hydrated', 'browser_preference', HASH),
      subtitle_style: part('hydrated', 'project', HASH),
      captions: part('hydrated', 'project', HASH),
      markers: part('hydrated', 'project', HASH),
    }));
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toBe('HYDRATION_PART_ORIGIN_REFUSED');
  });

  it('refuses a digest on a part that is not hydrated and refuses a missing one', () => {
    const withHash = validateNativeHydrationObservation(event({
      settings: part('dirty', 'project', HASH),
      subtitle_style: part('hydrated', 'project', HASH),
      captions: part('hydrated', 'project', HASH),
      markers: part('hydrated', 'project', HASH),
    }));
    expect(withHash.ok).toBe(false);
    if (!withHash.ok) expect(withHash.reason).toBe('HYDRATION_PART_HASH_UNEXPECTED');
    const withoutHash = validateNativeHydrationObservation(event({
      settings: part('hydrated', 'project', null),
      subtitle_style: part('hydrated', 'project', HASH),
      captions: part('hydrated', 'project', HASH),
      markers: part('hydrated', 'project', HASH),
    }));
    expect(withoutHash.ok).toBe(false);
    if (!withoutHash.ok) expect(withoutHash.reason).toBe('HYDRATION_PART_HASH_MISSING');
  });

  it('refuses a hydration epoch that is not positive', () => {
    const check = validateNativeHydrationObservation({
      ...event({
        settings: part('hydrated', 'project', HASH),
        subtitle_style: part('hydrated', 'project', HASH),
        captions: part('hydrated', 'project', HASH),
        markers: part('hydrated', 'project', HASH),
      }),
      hydration_epoch: 0,
    });
    expect(check.ok).toBe(false);
  });
});

describe('the original Studio selection', () => {
  it('accepts a fractional native second and the original ref kinds', () => {
    const check = validateNativeSelectionObservation({
      projectId: 'native-1',
      time: 12.345,
      refs: [{ kind: 'clip', id: 'clip-1' }, { kind: 'time', time: 1 }],
      range: { start: 1, end: 2 },
      stage: { w: 1920, h: 1080 },
    });
    expect(check.ok).toBe(true);
  });

  it('refuses a non-finite time, an unknown ref kind and a broken range', () => {
    expect(validateNativeSelectionObservation({ projectId: 'native-1', time: Number.NaN, refs: [] }).ok).toBe(false);
    expect(validateNativeSelectionObservation({ projectId: 'native-1', time: 1, refs: [{ kind: 'whatever' }] }).ok).toBe(false);
    expect(validateNativeSelectionObservation({ projectId: 'native-1', time: 1, refs: [], range: { start: 1 } }).ok).toBe(false);
  });
});

describe('the native seconds canonicalisation', () => {
  it('is its own fractional domain and never the integer canonical domain', () => {
    expect(nativeSecondsCanonical(1)).toBe('1');
    expect(nativeSecondsCanonical(1.5)).toBe('1.5');
    expect(nativeSecondsCanonical(1.0000004)).toBe('1');
    expect(nativeSecondsCanonical(1.0000006)).toBe('1.000001');
    expect(nativeSecondsCanonical(-0.0000004)).toBe('0');
    expect(nativeSecondsCanonical(-1.5)).toBe('-1.5');
    expect(nativeSecondsCanonical(0)).toBe('0');
  });

  it('refuses a value that is not finite', () => {
    expect(() => nativeSecondsCanonical(Number.POSITIVE_INFINITY)).toThrow('NATIVE_SECONDS_NOT_FINITE');
  });
});

/* ────────────────────────────────────────────────────────────────────────────────────
 * The independent expected side.

 * Everything below runs on real files and real descriptors in a temporary directory.
 * The pinned 015 candidate is **not built** — building it needs a MAIN heavy-resource
 * grant — so the *library* is a local stand-in whose own API shape is the pinned one.
 * What is under test here is not the 015 math: it is the retained-identity guard, the
 * closure guard, the proof's membership rules, the loader's approval chain and the
 * descriptor cleanup. Those are the parts this ticket owns.
 * ──────────────────────────────────────────────────────────────────────────────────── */

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const HASH_A = 'a'.repeat(64);

const bindingOf = (overrides: Partial<NativeExpectedBinding> = {}): NativeExpectedBinding => ({
  project_id: 'p1',
  native_project_id: 'n1',
  revision: 3,
  snapshot_id: 'snap1',
  source_digest: HASH_A,
  instance_generation: 2,
  selection_version: 4,
  workspace: { workspace_ref: 'ws1', snapshot_id: 'snap1', source_digest: HASH_A, revision: 3 },
  isCurrent: () => true,
  ...overrides,
});

/**
 * A reader over real files.
 *
 * It keeps the descriptors open, binds the current path to the retained device and
 * inode, re-hashes the bytes behind the same descriptor and checks the whole closure
 * membership. This is the port's contract, exercised for real.
 */
function realReader(root: string, names: readonly string[]): {
  port: NativeExpectedSourcePort;
  readonly openDescriptors: () => number;
  readonly closedDescriptors: () => number;
} {
  const descriptors: number[] = [];
  let closed = 0;
  const retained: NativeExpectedRetainedFile[] = [];
  for (const name of names) {
    const path = resolve(root, name);
    const fd = openSync(path, 'r');
    descriptors.push(fd);
    const bytes = readFileSync(path);
    const identity = fstatSync(fd);
    retained.push({
      relative_path: name,
      sha256: sha256(bytes),
      bytes: bytes.byteLength,
      verify: () => {
        try {
          const stat = lstatSync(path);
          // A symlink, a different file or a different inode is a failure, even when
          // the bytes behind the retained descriptor are unchanged.
          if (!stat.isFile() || stat.dev !== identity.dev || stat.ino !== identity.ino) return false;
          const buffer = Buffer.alloc(bytes.byteLength);
          const read = readSync(fd, buffer, 0, buffer.byteLength, 0);
          if (read !== buffer.byteLength) return false;
          return sha256(buffer) === sha256(bytes);
        } catch {
          return false;
        }
      },
      close: () => {
        try { closeSync(fd); } catch { /* already closed */ }
        closed += 1;
      },
    });
  }
  const listing = (): string[] => {
    const found: string[] = [];
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const full = resolve(directory, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile()) found.push(relative(root, full).split(sep).join('/'));
      }
    };
    walk(root);
    return found.sort();
  };
  const closedSet = listing();
  const rootIdentity = lstatSync(root);
  const port: NativeExpectedSourcePort = {
    readSource: async () => {
      const facts: NativeExpectedSourceFacts = {
        entries: retained.map(file => ({ relative_path: file.relative_path, sha256: file.sha256 })),
        film: { relative_path: 'film.html', sha256: retained[0]?.sha256 ?? HASH_A, bytes: retained[0]?.bytes ?? 0, native_rev: 'rev-1' },
        expected_input: {
          format: 'narralens.native-expected-input@1',
          upstream_sha: NATIVE_EXPECTED_UPSTREAM_SHA,
          profile: 'narralens.native-expected-numeric@1',
          binding: { project_id: 'p1', project_revision: 3, snapshot_id: 'snap1', source_digest: HASH_A, film_sha256: HASH_A },
          provenance: { origin: 'host_independent', source_manifest_digest: HASH_A, rights_digest: null, media_catalog_digest: null, listing_digest: HASH_A },
          ui_profile: { pending_drops: 'excluded', preview_error: 'excluded', live_height: 'excluded', browser_preferences: 'excluded' },
          source_entries: [{ relative_path: 'film.html', sha256: HASH_A }],
          film: { file: { relative_path: 'film.html', state: 'present', sha256: HASH_A }, value: { tracks: [] } },
          settings: { file: { relative_path: '.film/settings.json', state: 'absent', sha256: null }, value: {} },
          markers: { file: { relative_path: '.film/markers.json', state: 'absent', sha256: null }, value: [] },
          clip_refs: [],
          media_facts: [],
          video_files_in_native_order: [],
          span_facts: { profile: 'numeric_source_only', origin: 'not_used', proof_digest: null, values: [] },
        },
        style: { state: 'absent', value: {} },
        captions: { state: 'absent', value: { cues: [] } },
        retained,
        verifyClosure: () => {
          // The root identity, and the membership of the closure. The *contents* are
          // the per-file guard's business, not the closure's.
          const rootStat = lstatSync(root);
          if (!rootStat.isDirectory() || rootStat.dev !== rootIdentity.dev || rootStat.ino !== rootIdentity.ino) return false;
          const now = listing();
          if (now.length !== closedSet.length) return false;
          for (let index = 0; index < now.length; index += 1) if (now[index] !== closedSet[index]) return false;
          return true;
        },
      };
      return facts;
    },
  };
  return { port, openDescriptors: () => descriptors.length, closedDescriptors: () => closed };
}

/** A loader stand-in that is loaded through the *real* loader path. */
function stageLibrary(root: string, options: { readonly throwOnCompute?: boolean; readonly computed?: boolean } = {}): { dist: string; inputs: string; runtime: string; digestOf: (name: string) => string } {
  const dist = resolve(root, 'dist');
  const inputs = resolve(root, 'inputs');
  const runtime = resolve(root, 'runtime');
  mkdirSync(dist, { recursive: true });
  mkdirSync(inputs, { recursive: true });
  mkdirSync(runtime, { recursive: true });
  for (const name of NATIVE_EXPECTED_INPUT_FILES) {
    writeFileSync(resolve(inputs, name), readFileSync(resolve(nativeExpectedInputsRoot(), name)));
  }
  writeFileSync(resolve(dist, 'native-pure-library.mjs'),
    'export function hydrationCanonicalJson(value) {\n'
    + '  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);\n'
    + '  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);\n'
    + '  if (Array.isArray(value)) return "[" + value.map(hydrationCanonicalJson).join(",") + "]";\n'
    + '  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {\n'
    + '    const record = value;\n'
    + '    return "{" + Object.keys(record).filter((key) => record[key] !== undefined).sort()\n'
    + '      .map((key) => JSON.stringify(key) + ":" + hydrationCanonicalJson(record[key])).join(",") + "}";\n'
    + '  }\n'
    + '  throw new Error("UNSUPPORTED_HYDRATION_VALUE");\n'
    + '}\n');
  writeFileSync(resolve(dist, 'expected-projection.mjs'),
    'import { hydrationCanonicalJson } from "./native-pure-library.mjs";\n'
    + 'export const EXPECTED_PROFILE = "narralens.native-expected-numeric@1";\n'
    + (options.throwOnCompute === true
      ? 'export function computeExpectedProjection() { throw new Error("THE_PROJECTION_FAILED"); }\n'
      : options.computed === true
        ? 'export function computeExpectedProjection(input) {\n'
          + '  const part = { value: {}, canonical_utf8: "{}", sha256: "' + HASH_A + '" };\n'
          + '  return { status: "computed", profile: EXPECTED_PROFILE, binding: input.binding, input_sha256: "' + HASH_A + '", settings: part, markers: part, not_proven: ["UI_TRANSIENTS"] };\n'
          + '}\n'
        : 'export function computeExpectedProjection() {\n'
          + '  return { status: "unsupported", profile: EXPECTED_PROFILE, reason: "INPUT_INVALID" };\n'
          + '}\n')
    + 'export { hydrationCanonicalJson };\n');
  writeFileSync(resolve(dist, 'build-manifest.json'), JSON.stringify({ kind: 'narralens.native-expected-projection-build@1', upstream_sha: NATIVE_EXPECTED_UPSTREAM_SHA }));
  return {
    dist,
    inputs,
    runtime,
    digestOf: (name: string) => sha256(readFileSync(resolve(dist, name))),
  };
}

function nativeExpectedInputsRoot(): string {
  return resolve(process.cwd(), 'tools/agent-driven/product/native-inputs');
}

async function approvedOf(staged: ReturnType<typeof stageLibrary>): Promise<{
  upstream_sha: string;
  inputs_sha256: string;
  build_sha256: string;
  modules: Record<string, string>;
}> {
  return {
    upstream_sha: NATIVE_EXPECTED_UPSTREAM_SHA,
    inputs_sha256: await nativeExpectedInputsDigest(staged.inputs),
    build_sha256: sha256(readFileSync(resolve(staged.dist, 'build-manifest.json'))),
    modules: {
      'native-pure-library.mjs': staged.digestOf('native-pure-library.mjs'),
      'expected-projection.mjs': staged.digestOf('expected-projection.mjs'),
    },
  };
}

describe('the retained source identity', () => {
  it('refuses a proof whose file bytes drifted between prove and the acknowledgement', async () => {
    const root = mkdtempSync(join(tmpdir(), 'narralens-r2-expected-'));
    try {
      const source = resolve(root, 'source');
      mkdirSync(source, { recursive: true });
      writeFileSync(resolve(source, 'film.html'), 'the original film');
      const reader = realReader(source, ['film.html']);
      const facts = await reader.port.readSource({ binding: bindingOf() });
      // The bytes drift: the same length, different content. The membership of the
      // closure did not move, so the closure guard still holds and the file guard is
      // the one that refuses.
      writeFileSync(resolve(source, 'film.html'), 'the drifted film');
      expect(facts.retained[0]?.verify()).toBe(false);
      expect(facts.verifyClosure()).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses a proof whose file was replaced by another file with the same bytes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'narralens-r2-expected-'));
    try {
      const source = resolve(root, 'source');
      mkdirSync(source, { recursive: true });
      const original = 'the original film';
      writeFileSync(resolve(source, 'film.html'), original);
      const reader = realReader(source, ['film.html']);
      const facts = await reader.port.readSource({ binding: bindingOf() });
      // The same bytes, a different file: the inode moved. The membership did not
      // move, so the file guard is the one that refuses.
      rmSync(resolve(source, 'film.html'));
      writeFileSync(resolve(source, 'film.html'), original);
      expect(facts.retained[0]?.verify()).toBe(false);
      expect(facts.verifyClosure()).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses a closure that gained or lost a file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'narralens-r2-expected-'));
    try {
      const source = resolve(root, 'source');
      mkdirSync(source, { recursive: true });
      writeFileSync(resolve(source, 'film.html'), 'the original film');
      const reader = realReader(source, ['film.html']);
      const facts = await reader.port.readSource({ binding: bindingOf() });
      expect(facts.verifyClosure()).toBe(true);
      writeFileSync(resolve(source, 'extra.txt'), 'an addition');
      expect(facts.verifyClosure()).toBe(false);
      rmSync(resolve(source, 'extra.txt'));
      expect(facts.verifyClosure()).toBe(true);
      rmSync(resolve(source, 'film.html'));
      expect(facts.verifyClosure()).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('the expected proof', () => {
  const serviceOf = async (root: string, reader: { port: NativeExpectedSourcePort }, staged: ReturnType<typeof stageLibrary>): Promise<OpenFilmNativeExpected> =>
    new OpenFilmNativeExpected({
      source: reader.port,
      loader: nativeExpectedLibraryLoader({ distRoot: staged.dist, inputsRoot: staged.inputs, runtimeRoot: staged.runtime }),
      approved: await approvedOf(staged),
    });

  it('refuses a proof whose file drifted between prove and the acknowledgement', async () => {
    const root = mkdtempSync(join(tmpdir(), 'narralens-r2-proof-'));
    try {
      const source = resolve(root, 'source');
      mkdirSync(source, { recursive: true });
      writeFileSync(resolve(source, 'film.html'), 'the original film');
      const reader = realReader(source, ['film.html']);
      const staged = stageLibrary(root);
      const service = await serviceOf(root, reader, staged);
      const binding = bindingOf();
      const proof = await service.prove(binding);
      writeFileSync(resolve(source, 'film.html'), 'the drifted film');
      expect(() => service.assertCurrent(binding, proof)).toThrow('NATIVE_EXPECTED_SOURCE_MOVED');
      service.release(proof);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses a proof whose file was replaced by an identical file, and a closure that changed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'narralens-r2-proof-'));
    try {
      const source = resolve(root, 'source');
      mkdirSync(source, { recursive: true });
      const original = 'the original film';
      writeFileSync(resolve(source, 'film.html'), original);
      const reader = realReader(source, ['film.html']);
      const staged = stageLibrary(root);
      const service = await serviceOf(root, reader, staged);
      const binding = bindingOf();
      const proof = await service.prove(binding);
      rmSync(resolve(source, 'film.html'));
      writeFileSync(resolve(source, 'film.html'), original);
      expect(() => service.assertCurrent(binding, proof)).toThrow('NATIVE_EXPECTED_SOURCE_MOVED');
      service.release(proof);

      const second = await service.prove(binding);
      writeFileSync(resolve(source, 'extra.txt'), 'an addition');
      expect(() => service.assertCurrent(binding, second)).toThrow('NATIVE_EXPECTED_CLOSURE_MOVED');
      service.release(second);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses a released proof and a proof from another instance', async () => {
    const root = mkdtempSync(join(tmpdir(), 'narralens-r2-proof-'));
    try {
      const source = resolve(root, 'source');
      mkdirSync(source, { recursive: true });
      writeFileSync(resolve(source, 'film.html'), 'the original film');
      const reader = realReader(source, ['film.html']);
      const staged = stageLibrary(root);
      const service = await serviceOf(root, reader, staged);
      const other = await serviceOf(root, reader, staged);
      const binding = bindingOf();
      const proof = await service.prove(binding);
      // Another instance may not assert this proof.
      expect(() => other.assertCurrent(binding, proof)).toThrow('NATIVE_EXPECTED_PROOF_FOREIGN');
      service.release(proof);
      expect(() => service.assertCurrent(binding, proof)).toThrow('NATIVE_EXPECTED_PROOF_RELEASED');
      // A fabricated proof is refused as well.
      const fabricated = Object.create(Object.getPrototypeOf(proof)) as typeof proof;
      expect(() => service.assertCurrent(binding, fabricated)).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses a binding that is not the one the proof was made against', async () => {
    const root = mkdtempSync(join(tmpdir(), 'narralens-r2-proof-'));
    try {
      const source = resolve(root, 'source');
      mkdirSync(source, { recursive: true });
      writeFileSync(resolve(source, 'film.html'), 'the original film');
      const reader = realReader(source, ['film.html']);
      const staged = stageLibrary(root);
      const service = await serviceOf(root, reader, staged);
      const binding = bindingOf();
      const proof = await service.prove(binding);
      // The same fields, a different object.
      expect(() => service.assertCurrent(bindingOf(), proof)).toThrow('NATIVE_EXPECTED_BINDING_MOVED');
      service.release(proof);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('closes every descriptor when the projection fails, and when the service is closed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'narralens-r2-proof-'));
    try {
      const source = resolve(root, 'source');
      mkdirSync(source, { recursive: true });
      writeFileSync(resolve(source, 'film.html'), 'the original film');
      const reader = realReader(source, ['film.html']);
      const staged = stageLibrary(root, { throwOnCompute: true });
      const service = await serviceOf(root, reader, staged);
      const binding = bindingOf();
      await expect(service.prove(binding)).rejects.toThrow('THE_PROJECTION_FAILED');
      // The reader's handles are the service's from the moment the read resolved.
      expect(reader.closedDescriptors()).toBe(1);

      const stagedOk = stageLibrary(resolve(root, 'second'));
      const serviceOk = await serviceOf(resolve(root, 'second'), reader, stagedOk);
      const proof = await serviceOk.prove(binding);
      expect(reader.closedDescriptors()).toBe(1);
      serviceOk.close();
      expect(reader.closedDescriptors()).toBe(2);
      expect(() => serviceOk.assertCurrent(binding, proof)).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('the expected loader approval chain', () => {
  it('loads a candidate whose inputs, manifest and modules all match the approval', async () => {
    const root = mkdtempSync(join(tmpdir(), 'narralens-r2-loader-'));
    try {
      const staged = stageLibrary(root);
      const approved = await approvedOf(staged);
      const library = await nativeExpectedLibraryLoader({ distRoot: staged.dist, inputsRoot: staged.inputs, runtimeRoot: staged.runtime }).load(approved);
      expect(library.EXPECTED_PROFILE).toBe('narralens.native-expected-numeric@1');
      expect(library.upstream_sha).toBe(NATIVE_EXPECTED_UPSTREAM_SHA);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses a changed input, a changed manifest and a swapped module', async () => {
    const root = mkdtempSync(join(tmpdir(), 'narralens-r2-loader-'));
    try {
      const staged = stageLibrary(root);
      const approved = await approvedOf(staged);
      const loader = nativeExpectedLibraryLoader({ distRoot: staged.dist, inputsRoot: staged.inputs, runtimeRoot: staged.runtime });
      // The tracked input moved.
      writeFileSync(resolve(staged.inputs, 'expected-projection.mjs'), '// tampered\n');
      await expect(loader.load(approved)).rejects.toThrow('NATIVE_EXPECTED_INPUTS_MISMATCH');
      writeFileSync(resolve(staged.inputs, 'expected-projection.mjs'), readFileSync(resolve(nativeExpectedInputsRoot(), 'expected-projection.mjs')));
      // The manifest moved.
      writeFileSync(resolve(staged.dist, 'build-manifest.json'), '{"kind":"other"}');
      await expect(loader.load(approved)).rejects.toThrow('NATIVE_EXPECTED_BUILD_MANIFEST_MISMATCH');
      writeFileSync(resolve(staged.dist, 'build-manifest.json'), JSON.stringify({ kind: 'narralens.native-expected-projection-build@1', upstream_sha: NATIVE_EXPECTED_UPSTREAM_SHA }));
      // The module moved.
      writeFileSync(resolve(staged.dist, 'expected-projection.mjs'), 'export const EXPECTED_PROFILE = "other";\n');
      await expect(loader.load(approved)).rejects.toThrow('NATIVE_EXPECTED_MODULE_MISMATCH');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses a module that reaches outside the verified directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'narralens-r2-loader-'));
    try {
      const staged = stageLibrary(root);
      const approved = await approvedOf(staged);
      writeFileSync(resolve(staged.dist, 'expected-projection.mjs'),
        'import { something } from "some-package";\n'
        + 'export const EXPECTED_PROFILE = "narralens.native-expected-numeric@1";\n'
        + 'export function computeExpectedProjection() { return { status: "unsupported", profile: EXPECTED_PROFILE, reason: "INPUT_INVALID" }; }\n');
      approved.modules['expected-projection.mjs'] = staged.digestOf('expected-projection.mjs');
      await expect(nativeExpectedLibraryLoader({ distRoot: staged.dist, inputsRoot: staged.inputs, runtimeRoot: staged.runtime }).load(approved))
        .rejects.toThrow('NATIVE_EXPECTED_MODULE_DEPENDENCY_UNBOUND');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses a candidate whose upstream is not the pinned one', async () => {
    const root = mkdtempSync(join(tmpdir(), 'narralens-r2-loader-'));
    try {
      const staged = stageLibrary(root);
      const approved = await approvedOf(staged);
      await expect(nativeExpectedLibraryLoader({ distRoot: staged.dist, inputsRoot: staged.inputs, runtimeRoot: staged.runtime })
        .load({ ...approved, upstream_sha: '0'.repeat(40) })).rejects.toThrow('NATIVE_EXPECTED_UPSTREAM_MISMATCH');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('the binding snapshot', () => {
  it('captures the fields, so a mutated binding cannot pass for the original', () => {
    const binding = bindingOf();
    const snapshot = snapshotNativeExpectedBinding(binding);
    expect(snapshot.project_id).toBe('p1');
    expect(snapshot.workspace_ref).toBe('ws1');
    expect(Object.isFrozen(snapshot)).toBe(true);
  });
});

/* ────────────────────────────────────────────────────────────────────────────────────
 * The selection version port and the acknowledgement it guards (L02).
 *
 * The expected side is the *real* service, over a staged candidate whose helper
 * returns a computed projection, so the whole acknowledgement path runs for real:
 * the document event, the four hydration parts, the selection, the comparison and
 * the final boundary. Only the 015 math is a stand-in; the pinned candidate is
 * not built.
 * ──────────────────────────────────────────────────────────────────────────────────── */

import { pathToFileURL } from 'node:url';
import { NativeAckStore } from '../../../src/host/m5/native-ack-store.js';
import { NativeObservationService, type NativeObservationSessionBinding } from '../../../src/host/m5/native-observation.js';
import { RevisionStore } from '../../../src/host/projects/revision-store.js';

describe('the selection version port', () => {
  it('follows the real selection changes, voids the acknowledgement, and refuses when closed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'narralens-r2-selection-'));
    try {
      const source = resolve(root, 'source');
      mkdirSync(source, { recursive: true });
      const film = 'the original film';
      writeFileSync(resolve(source, 'film.html'), film);
      const reader = realReader(source, ['film.html']);
      const staged = stageLibrary(root, { computed: true });
      const expected = new OpenFilmNativeExpected({
        source: reader.port,
        loader: nativeExpectedLibraryLoader({ distRoot: staged.dist, inputsRoot: staged.inputs, runtimeRoot: staged.runtime }),
        approved: await approvedOf(staged),
      });
      // The canonical the staged candidate uses, imported from the staged bytes.
      const canonical = (await import(pathToFileURL(resolve(staged.dist, 'native-pure-library.mjs')).href)) as {
        hydrationCanonicalJson: (value: unknown) => string;
      };
      const digestOfPart = (part: string, value: unknown): string =>
        sha256(Buffer.from(canonical.hydrationCanonicalJson({ format: 'narralens.native-hydration-effective@1', part, value }), 'utf8'));

      const revisions = new RevisionStore(':memory:');
      const now = new Date().toISOString();
      revisions.compose(db => {
        db.prepare('INSERT INTO snapshot(snapshot_id,project_id,source_digest,engine,created_at) VALUES(?,?,?,?,?)')
          .run('snap1', 'p1', HASH_A, 'openfilm', now);
        db.prepare('INSERT INTO active_commit(project_id,revision,snapshot_id,source_digest,engine,transaction_id,created_at) VALUES(?,?,?,?,?,?,?)')
          .run('p1', 3, 'snap1', HASH_A, 'openfilm', 'tx1', now);
      });
      const ackStore = new NativeAckStore({ revisions });
      const service = new NativeObservationService({
        ackStore,
        expected,
        selectionMapping: {
          mapSelection: async ({ selection }) => ({
            shot_ids: selection.refs.map(ref => ref.id ?? 'shot'),
            start_frame: Math.round(selection.time * 24),
            end_frame_exclusive: Math.round(selection.time * 24) + 1,
          }),
        },
      });

      // No session, no observed selection: the version is 0, never a guess.
      expect(service.currentSelectionVersion('p1')).toBe(0);
      const binding: NativeObservationSessionBinding = {
        bridge_session_id: 'a'.repeat(32),
        instance_generation: 1,
        project_id: 'p1',
        native_project_id: 'n1',
        owner_session_ref: 'owner1',
        revision: 3,
        snapshot_id: 'snap1',
        source_digest: HASH_A,
        workspace: { workspace_ref: 'ws1', snapshot_id: 'snap1', source_digest: HASH_A, revision: 3 },
        isCurrent: () => true,
      };
      service.sessionOpened(binding);
      expect(service.currentSelectionVersion('p1')).toBe(0);

      const envelope = (sequence: number, event_kind: string, event: unknown) => ({
        format: 'narralens.native-observation@1' as const, sequence, event_kind: event_kind as 'document' | 'hydration' | 'selection', event,
      });
      const filmBytes = Buffer.from(film, 'utf8');
      const document = await service.observe(binding, envelope(1, 'document', {
        protocol_version: 1,
        kind: 'document_dom_committed',
        project_id: 'n1',
        editor_view_id: 'view1',
        document_epoch: 3,
        native_rev: 'rev-1',
        film_sha256: sha256(filmBytes),
        utf8_byte_length: filmBytes.byteLength,
      }));
      expect(document.accepted).toBe(true);
      // The document alone is not a loaded editor: there is no selection and no part.
      expect(document.ack).toBeNull();

      const hydration = await service.observe(binding, envelope(2, 'hydration', {
        project_id: 'n1',
        editor_view_id: 'view1',
        document_epoch: 3,
        hydration_epoch: 1,
        parts: {
          settings: { state: 'absent_default', origin: 'project', effective_sha256: HASH_A },
          subtitle_style: { state: 'absent_default', origin: 'project', effective_sha256: digestOfPart('subtitle_style', {}) },
          captions: { state: 'absent_default', origin: 'project', effective_sha256: digestOfPart('captions', { cues: [] }) },
          markers: { state: 'absent_default', origin: 'project', effective_sha256: HASH_A },
        },
      }));
      expect(hydration.accepted).toBe(true);
      // Still no acknowledgement: the selection is not known yet.
      expect(hydration.ack).toBeNull();

      const selection = { projectId: 'n1', time: 2, refs: [{ kind: 'clip' as const, id: 'shot1' }] };
      const first = await service.observe(binding, envelope(3, 'selection', selection));
      expect(first.accepted).toBe(true);
      expect(first.ack).not.toBeNull();
      expect(service.currentSelectionVersion('p1')).toBe(1);
      // The acknowledgement really was written, on the real table.
      const durable = await ackStore.latest('p1');
      expect(durable?.loaded_revision).toBe(3);
      expect(durable?.editor_session_id).toBe('a'.repeat(32));

      // The same selection again: the version does not move, and the acknowledgement stands.
      const again = await service.observe(binding, envelope(4, 'selection', selection));
      expect(again.accepted).toBe(true);
      expect(service.currentSelectionVersion('p1')).toBe(1);
      expect((await service.read('p1')).ack).not.toBeNull();

      // A different selection: the version moves and the acknowledgement is void.
      const changed = await service.observe(binding, envelope(5, 'selection', {
        projectId: 'n1', time: 2, refs: [{ kind: 'clip' as const, id: 'shot2' }],
      }));
      expect(changed.accepted).toBe(true);
      expect(service.currentSelectionVersion('p1')).toBe(2);
      expect((await service.read('p1')).ack).toBeNull();

      service.close();
      expect(() => service.currentSelectionVersion('p1')).toThrow('NATIVE_OBSERVATION_CLOSED');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('moves the version even when the selection cannot be mapped, because nothing can be proved', async () => {
    const root = mkdtempSync(join(tmpdir(), 'narralens-r2-selection-'));
    try {
      const source = resolve(root, 'source');
      mkdirSync(source, { recursive: true });
      writeFileSync(resolve(source, 'film.html'), 'the original film');
      const reader = realReader(source, ['film.html']);
      const staged = stageLibrary(root, { computed: true });
      const expected = new OpenFilmNativeExpected({
        source: reader.port,
        loader: nativeExpectedLibraryLoader({ distRoot: staged.dist, inputsRoot: staged.inputs, runtimeRoot: staged.runtime }),
        approved: await approvedOf(staged),
      });
      const revisions = new RevisionStore(':memory:');
      const ackStore = new NativeAckStore({ revisions });
      const service = new NativeObservationService({
        ackStore,
        expected,
        selectionMapping: { mapSelection: async () => null },
      });
      const binding: NativeObservationSessionBinding = {
        bridge_session_id: 'b'.repeat(32),
        instance_generation: 1,
        project_id: 'p1',
        native_project_id: 'n1',
        owner_session_ref: 'owner1',
        revision: 3,
        snapshot_id: 'snap1',
        source_digest: HASH_A,
        workspace: { workspace_ref: 'ws1', snapshot_id: 'snap1', source_digest: HASH_A, revision: 3 },
        isCurrent: () => true,
      };
      service.sessionOpened(binding);
      const outcome = await service.observe(binding, {
        format: 'narralens.native-observation@1', sequence: 1, event_kind: 'selection',
        event: { projectId: 'n1', time: 1, refs: [] },
      });
      expect(outcome.accepted).toBe(false);
      expect(outcome.reason).toBe('SELECTION_NOT_MAPPABLE');
      // The version moves anyway: the Host cannot prove the selection is unchanged.
      expect(service.currentSelectionVersion('p1')).toBe(1);
      expect((await service.read('p1')).selection).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
