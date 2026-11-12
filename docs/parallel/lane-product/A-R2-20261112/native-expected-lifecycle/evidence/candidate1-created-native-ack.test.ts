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
  NATIVE_EXPECTED_PROFILE,
  NATIVE_EXPECTED_UPSTREAM_SHA,
  OpenFilmNativeExpected,
  nativeExpectedInputsDigest,
  nativeExpectedApprovalFromPin,
  nativeExpectedLibraryLoader,
  snapshotNativeExpectedBinding,
  type NativeExpectedBinding,
  type NativeExpectedLibrary,
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
import Ajv2020 from 'ajv/dist/2020.js';
import { NativeAckStore } from '../../../src/host/m5/native-ack-store.js';
import { NativeObservationService, parseNativeObservationBody, type NativeObservationSessionBinding } from '../../../src/host/m5/native-observation.js';
import { ControlledStudioAccess, type NativeStudioGrant } from '../../../src/host/m5/controlled-studio-access.js';
import { NATIVE_OBSERVATION_ROUTE } from '../../../src/host/m5/openfilm-studio-gateway.js';
import { STUDIO_HOST_BRIDGE_SCRIPT } from '../../../src/host/m5/studio-host-bridge.js';
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
          settings: { state: 'hydrated', origin: 'project', effective_sha256: HASH_A },
          subtitle_style: { state: 'absent_default', origin: 'explicit_default', effective_sha256: digestOfPart('subtitle_style', {}) },
          captions: { state: 'hydrated', origin: 'project', effective_sha256: digestOfPart('captions', { cues: [] }) },
          markers: { state: 'hydrated', origin: 'project', effective_sha256: HASH_A },
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
      // A repeated report of the same state does not write a second acknowledgement.
      expect((await ackStore.latest('p1'))?.ack_seq).toBe(1);

      // A different selection: the version moves and the acknowledgement is void.
      const changed = await service.observe(binding, envelope(5, 'selection', {
        projectId: 'n1', time: 2, refs: [{ kind: 'clip' as const, id: 'shot2' }],
      }));
      expect(changed.accepted).toBe(true);
      expect(service.currentSelectionVersion('p1')).toBe(2);
      expect((await service.read('p1')).ack).toBeNull();
      // The changed selection produced no new acknowledgement of its own: the profile
      // is complete but the selection moved, so the old acknowledgement is void and
      // the next complete round writes the new one.
      expect((await ackStore.latest('p1'))?.ack_seq).toBe(1);

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

describe("the selection version of a stale session", () => {
  it("rejects a session that is no longer current, and keeps it apart from one that never observed", async () => {
    const root = mkdtempSync(join(tmpdir(), 'narralens-r2-stale-'));
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
        selectionMapping: {
          mapSelection: async ({ selection }) => ({
            shot_ids: selection.refs.map(ref => ref.id ?? 'shot'),
            start_frame: 0,
            end_frame_exclusive: 1,
          }),
        },
      });
      // A project with no session at all: nothing was observed, and 0 is the answer.
      expect(service.currentSelectionVersion('p1')).toBe(0);

      // A live session that has not observed a selection yet: also 0, and not a refusal.
      let live = true;
      const binding: NativeObservationSessionBinding = {
        bridge_session_id: 'c'.repeat(32),
        instance_generation: 1,
        project_id: 'p1',
        native_project_id: 'n1',
        owner_session_ref: 'owner1',
        revision: 3,
        snapshot_id: 'snap1',
        source_digest: HASH_A,
        workspace: { workspace_ref: 'ws1', snapshot_id: 'snap1', source_digest: HASH_A, revision: 3 },
        isCurrent: () => live,
      };
      service.sessionOpened(binding);
      expect(service.currentSelectionVersion('p1')).toBe(0);

      await service.observe(binding, {
        format: 'narralens.native-observation@1', sequence: 1, event_kind: 'selection',
        event: { projectId: 'n1', time: 1, refs: [{ kind: 'clip', id: 'shot1' }] },
      });
      expect(service.currentSelectionVersion('p1')).toBe(1);

      // The generation moves, or the owner is revoked: the binding is no longer current.
      live = false;
      // The version refuses. It does not answer 0, because 0 is what a session that
      // never observed a selection says, and the two must not be confused.
      expect(() => service.currentSelectionVersion('p1')).toThrow('NATIVE_OBSERVATION_SESSION_STALE');
      // The stale session is void, so the next answer is the honest one for a project
      // with no session at all — and never the stale number.
      expect(service.currentSelectionVersion('p1')).toBe(0);
      // The session is void, so the context has no stale facts either.
      const facts = await service.read('p1');
      expect(facts.selection_version).toBe(0);
      expect(facts.selection).toBeNull();
      expect(facts.ack).toBeNull();
      expect(facts.active_bridge_session_id).toBeNull();
      expect(facts.sync).toBe('unknown');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

/**
 * The controlled session and the observation binding.
 *
 * These cases use the real access object with a faked request and response: no
 * socket is bound, no listener is started, and nothing is fetched.
 */
describe("the controlled session and the observation binding", () => {
  const ORIGIN = "http://127.0.0.1:1234";

  const fakeRequest = (headers: Record<string, string>, body: string) => ({
    method: "POST",
    url: "/narralens/session/exchange",
    headers,
    rawHeaders: Object.entries(headers).flat(),
    async *[Symbol.asyncIterator]() { yield Buffer.from(body); },
  });

  const fakeResponse = () => {
    const state: { status: number | null; headers: Record<string, unknown>; body: string | null } = {
      status: null, headers: {}, body: null,
    };
    return {
      setHeader: (name: string, value: string) => { state.headers[name] = value; },
      writeHead: (status: number, headers?: Record<string, unknown>) => {
        state.status = status;
        if (headers !== undefined) for (const [name, value] of Object.entries(headers)) state.headers[name] = value;
      },
      end: (body?: string) => { state.body = body ?? null; },
      state,
    };
  };

  const grantOf = (opened: NativeObservationSessionBinding[], closed: NativeObservationSessionBinding[]): NativeStudioGrant => ({
    project_id: "p1",
    native_project_id: "n1",
    owner_session_ref: "owner1",
    instance_generation: 1,
    revision: 3,
    snapshot_id: "snap1",
    source_digest: HASH_A,
    isCurrent: () => true,
    readWorkbench: async () => ({}) as never,
    nativeObservation: {
      port: {
        sessionOpened: (binding) => { opened.push(binding); },
        observe: async () => ({ accepted: true, reason: "DOCUMENT_ACCEPTED", sequence: 1, ack: null }),
        sessionClosed: (binding) => { closed.push(binding); },
      },
      owner_session_ref: "owner1",
      project_id: "p1",
      native_project_id: "n1",
      instance_generation: 1,
      revision: 3,
      snapshot_id: "snap1",
      source_digest: HASH_A,
      workspace: { workspace_ref: "ws1", snapshot_id: "snap1", source_digest: HASH_A, revision: 3 },
      isCurrent: () => true,
    },
  });

  it("mints the bridge session id at the exchange, tells the producer, and closes it again", async () => {
    const opened: NativeObservationSessionBinding[] = [];
    const closed: NativeObservationSessionBinding[] = [];
    const access = new ControlledStudioAccess(() => ORIGIN);
    const issued = access.issue(grantOf(opened, closed));
    const ticket = issued.url.split("#native_ticket=")[1]!;
    const request = fakeRequest(
      { host: "127.0.0.1:1234", origin: ORIGIN, "content-type": "application/json" },
      JSON.stringify({ ticket }),
    );
    const response = fakeResponse();
    await access.exchange(request as never, response as never);
    expect(response.state.status).toBe(200);
    // The producer was told about the session exactly once.
    expect(opened.length).toBe(1);
    const binding = opened[0]!;
    // The bridge session id is minted by the Host, is not a credential, and is not
    // anything the client could have named.
    expect(binding.bridge_session_id).toMatch(/^[a-f0-9]{32}$/);
    expect(binding.project_id).toBe("p1");
    expect(binding.native_project_id).toBe("n1");
    expect(binding.instance_generation).toBe(1);
    expect(binding.workspace.workspace_ref).toBe("ws1");
    // Closing the access tells the producer before the credentials go away.
    access.close();
    expect(closed.length).toBe(1);
    expect(closed[0]).toBe(binding);
  });

  it("tells the producer again when the editor opens again on the same session", async () => {
    const opened: NativeObservationSessionBinding[] = [];
    const closed: NativeObservationSessionBinding[] = [];
    const access = new ControlledStudioAccess(() => ORIGIN);
    const grant = grantOf(opened, closed);
    const exchange = async (): Promise<void> => {
      const issued = access.issue(grant);
      const request = fakeRequest(
        { host: "127.0.0.1:1234", origin: ORIGIN, "content-type": "application/json" },
        JSON.stringify({ ticket: issued.url.split("#native_ticket=")[1]! }),
      );
      await access.exchange(request as never, fakeResponse() as never);
    };
    await exchange();
    expect(opened.length).toBe(1);
    // The editor opened again: the same session, and the producer is told again, so
    // that the profile of the view that is gone can be voided.
    await exchange();
    expect(opened.length).toBe(2);
    // And it is the same session: the same bridge session id.
    expect(opened[1]?.bridge_session_id).toBe(opened[0]?.bridge_session_id);
  });

  it("refuses an exchange from another origin", async () => {
    const opened: NativeObservationSessionBinding[] = [];
    const closed: NativeObservationSessionBinding[] = [];
    const access = new ControlledStudioAccess(() => ORIGIN);
    const issued = access.issue(grantOf(opened, closed));
    const ticket = issued.url.split("#native_ticket=")[1]!;
    const request = fakeRequest(
      { host: "127.0.0.1:1234", origin: "http://127.0.0.1:9999", "content-type": "application/json" },
      JSON.stringify({ ticket }),
    );
    const response = fakeResponse();
    await expect(access.exchange(request as never, response as never)).rejects.toThrow();
    // Nothing was told to the producer: no session was opened.
    expect(opened.length).toBe(0);
  });

  it("refuses an exchange whose body is not exactly the ticket", async () => {
    const opened: NativeObservationSessionBinding[] = [];
    const closed: NativeObservationSessionBinding[] = [];
    const access = new ControlledStudioAccess(() => ORIGIN);
    const issued = access.issue(grantOf(opened, closed));
    const ticket = issued.url.split("#native_ticket=")[1]!;
    const request = fakeRequest(
      { host: "127.0.0.1:1234", origin: ORIGIN, "content-type": "application/json" },
      JSON.stringify({ ticket, project_id: "p1" }),
    );
    const response = fakeResponse();
    await expect(access.exchange(request as never, response as never)).rejects.toThrow();
    expect(opened.length).toBe(0);
  });
});

/**
 * The shipped contract and the tracked pin.
 *
 * The contract file is the one the Gateway and the Host are bound to, so the cases
 * below validate real envelopes and real events against it, and they check that the
 * loader refuses a candidate that no review has approved.
 */
describe("the shipped native observation contract", () => {
  const schema = JSON.parse(readFileSync(resolve("contracts/native-observation-v1.schema.json"), "utf8")) as Record<string, unknown>;
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  ajv.addSchema(schema);
  const schemaId = String((schema as { $id?: string }).$id ?? "");
  const validateEnvelope = ajv.getSchema(schemaId);
  if (validateEnvelope === undefined) throw new Error("MISSING_CONTRACT");
  const validateEvent = (definition: string) => ajv.compile({
    $id: `https://narralens.local/internal/native-observation-case-${definition}@1`,
    $ref: `${schemaId}#/$defs/${definition}`,
  });

  const envelope = (event: unknown) => ({
    format: "narralens.native-observation@1", sequence: 1, event_kind: "hydration", event,
  });

  it("accepts a closed envelope and refuses one that carries an identity", () => {
    expect(validateEnvelope(envelope({ project_id: "n1" }))).toBe(true);
    expect(validateEnvelope({ ...envelope({ project_id: "n1" }), project_id: "p1" })).toBe(false);
    expect(validateEnvelope({ ...envelope({ project_id: "n1" }), session: "s" })).toBe(false);
    expect(validateEnvelope({ format: "narralens.native-observation@2", sequence: 1, event_kind: "hydration", event: {} })).toBe(false);
    expect(validateEnvelope({ format: "narralens.native-observation@1", sequence: 0, event_kind: "hydration", event: {} })).toBe(false);
    expect(validateEnvelope({ format: "narralens.native-observation@1", sequence: 1, event_kind: "write", event: {} })).toBe(false);
  });

  it("accepts the three original event shapes and refuses the ones they forbid", () => {
    const document = validateEvent("NativeDocumentObservation");
    expect(document({
      protocol_version: 1, kind: "document_dom_committed", project_id: "n1", editor_view_id: "v1",
      document_epoch: 2, native_rev: "rev-1", film_sha256: "a".repeat(64), utf8_byte_length: 10,
    })).toBe(true);
    expect(document({
      protocol_version: 1, kind: "document_dom_committed", project_id: "n1", editor_view_id: "v1",
      document_epoch: 2, native_rev: "rev-1", film_sha256: "A".repeat(64), utf8_byte_length: 10,
    })).toBe(false);

    const hydration = validateEvent("NativeHydrationObservation");
    const part = { state: "hydrated", origin: "project", effective_sha256: "a".repeat(64) };
    expect(hydration({
      project_id: "n1", editor_view_id: "v1", document_epoch: 2, hydration_epoch: 3,
      parts: { settings: part, subtitle_style: part, captions: part, markers: part },
    })).toBe(true);
    // A browser preference is never a proof.
    expect(hydration({
      project_id: "n1", editor_view_id: "v1", document_epoch: 2, hydration_epoch: 3,
      parts: {
        settings: { state: "hydrated", origin: "browser_preference", effective_sha256: "a".repeat(64) },
        subtitle_style: part, captions: part, markers: part,
      },
    })).toBe(false);

    const selection = validateEvent("NativeSelectionObservation");
    // The original StudioRef carries every field of its own branch.
    expect(selection({
      projectId: "n1", time: 1.25,
      refs: [{ kind: "clip", id: "c1", loc: null, label: "片段", clipKind: "video", src: null, start: 0, end: 5 }],
    })).toBe(true);
    expect(selection({ projectId: "n1", time: 1.25, refs: [{ kind: "unknown" }] })).toBe(false);
    // A reference that is missing a field of its own branch is not an original reference.
    expect(selection({ projectId: "n1", time: 1.25, refs: [{ kind: "clip", id: "c1" }] })).toBe(false);
  });
});

describe("the tracked candidate pin", () => {
  it("refuses the candidate until a review has approved it", () => {
    // The pin that is in the repository carries no approval: the build has not run
    // under a grant, so the loader must refuse rather than load anything.
    expect(() => nativeExpectedApprovalFromPin()).toThrow("NATIVE_EXPECTED_BUILD_NOT_APPROVED");
  });

  it("reads an approval that a review has recorded", () => {
    const root = mkdtempSync(join(tmpdir(), 'narralens-r2-pin-'));
    try {
      const path = resolve(root, 'pin.json');
      writeFileSync(path, JSON.stringify({
        native_expected: {
          upstream_sha: NATIVE_EXPECTED_UPSTREAM_SHA,
          inputs_sha256: "b".repeat(64),
          build_sha256: "c".repeat(64),
          modules: { 'expected-projection.mjs': "d".repeat(64) },
          approval: "APPROVED",
        },
      }));
      const approval = nativeExpectedApprovalFromPin(path);
      expect(approval.upstream_sha).toBe(NATIVE_EXPECTED_UPSTREAM_SHA);
      expect(approval.inputs_sha256).toBe("b".repeat(64));
      expect(approval.build_sha256).toBe("c".repeat(64));
      expect(approval.modules['expected-projection.mjs']).toBe("d".repeat(64));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("the body of one observation", () => {
  it("parses the closed envelope and refuses anything else", () => {
    const good = parseNativeObservationBody(JSON.stringify({
      format: "narralens.native-observation@1", sequence: 7, event_kind: "document",
      event: { protocol_version: 1, kind: "invalidated", project_id: "n1", editor_view_id: "v1", document_epoch: 1, reason: "dirty" },
    }));
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.value.sequence).toBe(7);

    const notJson = parseNativeObservationBody("not json at all");
    expect(notJson.ok).toBe(false);
    if (!notJson.ok) expect(notJson.reason).toBe("ENVELOPE_NOT_JSON");

    const withIdentity = parseNativeObservationBody(JSON.stringify({
      format: "narralens.native-observation@1", sequence: 7, event_kind: "document",
      event: {}, project_id: "p1",
    }));
    expect(withIdentity.ok).toBe(false);
    if (!withIdentity.ok) expect(withIdentity.reason).toBe("ENVELOPE_FIELDS_NOT_CLOSED");

    const empty = parseNativeObservationBody("");
    expect(empty.ok).toBe(false);
  });
});

describe("the counted observation route", () => {
  it("is exactly one additional Gateway route, and the registry says the same", () => {
    const registry = JSON.parse(readFileSync(resolve("contracts/native-observation-v1.registry.json"), "utf8")) as {
      readonly counting: { readonly additional_gateway_http: number; readonly mcp_tools: number };
      readonly additional_gateway_http: ReadonlyArray<{ readonly id: string; readonly method: string; readonly path: string }>;
    };
    // Exactly one, and it is the route the Gateway dispatches.
    expect(registry.additional_gateway_http.length).toBe(1);
    expect(registry.additional_gateway_http[0]?.path).toBe(NATIVE_OBSERVATION_ROUTE);
    expect(registry.additional_gateway_http[0]?.method).toBe("POST");
    expect(registry.counting.additional_gateway_http).toBe(1);
    // It joins no MCP tool set.
    expect(registry.counting.mcp_tools).toBe(0);
  });

  it("is the same path the Studio bridge reports into", () => {
    // The bridge is a served script, so it cannot import the constant; the case
    // exists so the two cannot drift apart unnoticed.
    expect(STUDIO_HOST_BRIDGE_SCRIPT).toContain(NATIVE_OBSERVATION_ROUTE);
  });
});

/**
 * The document epoch and the hydration epoch count different things.
 */
describe("the epoch of the hydration and the epoch of the document", () => {
  it("keeps the parts when the document event confirms the very hydration they belong to", async () => {
    const root = mkdtempSync(join(tmpdir(), 'narralens-r2-epoch-'));
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
          mapSelection: async () => ({ shot_ids: [], start_frame: 0, end_frame_exclusive: 1 }),
        },
      });
      const binding: NativeObservationSessionBinding = {
        bridge_session_id: 'd'.repeat(32),
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
      const envelope = (sequence: number, event_kind: 'document' | 'hydration' | 'selection', event: unknown) => ({
        format: 'narralens.native-observation@1' as const, sequence, event_kind, event,
      });
      const filmBytes = Buffer.from(film, 'utf8');
      // The hydration arrives first, for a document epoch of five.
      const hydration = await service.observe(binding, envelope(1, 'hydration', {
        project_id: 'n1', editor_view_id: 'view1', document_epoch: 5, hydration_epoch: 1,
        parts: {
          settings: { state: 'hydrated', origin: 'project', effective_sha256: HASH_A },
          subtitle_style: { state: 'absent_default', origin: 'explicit_default', effective_sha256: digestOfPart('subtitle_style', {}) },
          captions: { state: 'hydrated', origin: 'project', effective_sha256: digestOfPart('captions', { cues: [] }) },
          markers: { state: 'hydrated', origin: 'project', effective_sha256: HASH_A },
        },
      }));
      expect(hydration.accepted).toBe(true);
      // Then the document event for that very epoch confirms it.
      const document = await service.observe(binding, envelope(2, 'document', {
        protocol_version: 1, kind: 'document_dom_committed', project_id: 'n1',
        editor_view_id: 'view1', document_epoch: 5, native_rev: 'rev-1',
        film_sha256: sha256(filmBytes), utf8_byte_length: filmBytes.byteLength,
      }));
      expect(document.accepted).toBe(true);
      // The parts survived: the profile is complete, and the selection completes it.
      const selection = await service.observe(binding, envelope(3, 'selection', {
        projectId: 'n1', time: 1, refs: [],
      }));
      expect(selection.accepted).toBe(true);
      expect(selection.ack).not.toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("the expected state of the parts that come from the project's own sources", () => {
  it("expects settings, captions and markers to be hydrated, even when the parsed result is empty", async () => {
    const root = mkdtempSync(join(tmpdir(), 'narralens-r2-parts-'));
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
        selectionMapping: { mapSelection: async () => ({ shot_ids: [], start_frame: 0, end_frame_exclusive: 1 }) },
      });
      const binding: NativeObservationSessionBinding = {
        bridge_session_id: 'e'.repeat(32),
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
      const envelope = (sequence: number, event_kind: 'document' | 'hydration' | 'selection', event: unknown) => ({
        format: 'narralens.native-observation@1' as const, sequence, event_kind, event,
      });
      const filmBytes = Buffer.from(film, 'utf8');
      await service.observe(binding, envelope(1, 'document', {
        protocol_version: 1, kind: 'document_dom_committed', project_id: 'n1',
        editor_view_id: 'view1', document_epoch: 1, native_rev: 'rev-1',
        film_sha256: sha256(filmBytes), utf8_byte_length: filmBytes.byteLength,
      }));
      // The editor reports the settings as absent_default. The 013 contract says the
      // settings, the captions and the markers are revalidated as hydrated even when
      // the parsed result is empty, so the expectation and the report disagree and no
      // acknowledgement may be written.
      const wrong = await service.observe(binding, envelope(2, 'hydration', {
        project_id: 'n1', editor_view_id: 'view1', document_epoch: 1, hydration_epoch: 1,
        parts: {
          settings: { state: 'absent_default', origin: 'project', effective_sha256: HASH_A },
          subtitle_style: { state: 'absent_default', origin: 'explicit_default', effective_sha256: digestOfPart('subtitle_style', {}) },
          captions: { state: 'hydrated', origin: 'project', effective_sha256: digestOfPart('captions', { cues: [] }) },
          markers: { state: 'hydrated', origin: 'project', effective_sha256: HASH_A },
        },
      }));
      expect(wrong.accepted).toBe(true);
      const selection = await service.observe(binding, envelope(3, 'selection', {
        projectId: 'n1', time: 1, refs: [],
      }));
      expect(selection.accepted).toBe(true);
      expect(selection.ack).toBeNull();
      expect((await ackStore.latest('p1'))).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("the original Studio selection at the ingress", () => {
  it("refuses a reference that is missing the field the Host has to read", () => {
    // A clip without its id cannot be checked against the committed source.
    const withoutId = validateNativeSelectionObservation({
      projectId: "n1", time: 1, refs: [{ kind: "clip", label: "片段" }],
    });
    expect(withoutId.ok).toBe(false);
    if (!withoutId.ok) expect(withoutId.reason).toBe("SELECTION_REF_FIELD_MISSING");
    // A range without its times cannot be turned into frames.
    const withoutTimes = validateNativeSelectionObservation({
      projectId: "n1", time: 1, refs: [{ kind: "range", clipIds: [] }],
    });
    expect(withoutTimes.ok).toBe(false);
    // The field the Host reads is enough.
    expect(validateNativeSelectionObservation({
      projectId: "n1", time: 1, refs: [{ kind: "clip", id: "c1" }],
    }).ok).toBe(true);
  });

  it("refuses a selection that carries a field the original does not have", () => {
    const extra = validateNativeSelectionObservation({
      projectId: "n1", time: 1, refs: [], impact_id: "i1",
    });
    expect(extra.ok).toBe(false);
    if (!extra.ok) expect(extra.reason).toBe("SELECTION_FIELDS_NOT_CLOSED");
  });
});

describe("the closed shape of the document and the hydration event", () => {
  it("refuses an event that carries a field the original does not have", () => {
    const document = validateNativeDocumentObservation({
      protocol_version: 1, kind: "invalidated", project_id: "n1", editor_view_id: "v1",
      document_epoch: 1, reason: "dirty", impact_id: "i1",
    });
    expect(document.ok).toBe(false);
    if (!document.ok) expect(document.reason).toBe("DOCUMENT_FIELDS_NOT_CLOSED");
    const hydration = validateNativeHydrationObservation({
      project_id: "n1", editor_view_id: "v1", document_epoch: 1, hydration_epoch: 1,
      parts: {
        settings: { state: "hydrated", origin: "project", effective_sha256: HASH_A },
        subtitle_style: { state: "hydrated", origin: "project", effective_sha256: HASH_A },
        captions: { state: "hydrated", origin: "project", effective_sha256: HASH_A },
        markers: { state: "hydrated", origin: "project", effective_sha256: HASH_A },
      },
      session_id: "s1",
    });
    expect(hydration.ok).toBe(false);
    if (!hydration.ok) expect(hydration.reason).toBe("HYDRATION_FIELDS_NOT_CLOSED");
  });
});

describe("the document branches of the shipped contract", () => {
  it("accepts each branch on its own and refuses a mixture", () => {
    const schema = JSON.parse(readFileSync(resolve("contracts/native-observation-v1.schema.json"), "utf8")) as Record<string, unknown>;
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    ajv.addSchema(schema);
    const schemaId = String((schema as { $id?: string }).$id ?? "");
    const validate = ajv.compile({
      $id: "https://narralens.local/internal/native-observation-document-case@1",
      $ref: `${schemaId}#/$defs/NativeDocumentObservation`,
    });
    expect(validate({
      protocol_version: 1, kind: "document_dom_committed", project_id: "n1", editor_view_id: "v1",
      document_epoch: 2, native_rev: "rev-1", film_sha256: "a".repeat(64), utf8_byte_length: 10,
    })).toBe(true);
    expect(validate({
      protocol_version: 1, kind: "invalidated", project_id: "n1", editor_view_id: "v1",
      document_epoch: 2, reason: "dirty",
    })).toBe(true);
    // A committed document that also carries an invalidate reason is neither branch.
    expect(validate({
      protocol_version: 1, kind: "document_dom_committed", project_id: "n1", editor_view_id: "v1",
      document_epoch: 2, native_rev: "rev-1", film_sha256: "a".repeat(64), utf8_byte_length: 10, reason: "dirty",
    })).toBe(false);
    // An invalidation that also carries the committed fields is neither branch.
    expect(validate({
      protocol_version: 1, kind: "invalidated", project_id: "n1", editor_view_id: "v1",
      document_epoch: 2, reason: "dirty", native_rev: "rev-1",
    })).toBe(false);
  });
});

/**
 * The selection reference, against the real upstream source.
 *
 * The contract is not free to invent a shape: the reference it declares is the one the
 * pinned upstream declares, and this case reads that upstream source and compares the
 * two, branch by branch and field by field. An invented variant would fail here.
 */
describe("the selection reference against the upstream source", () => {
  const upstreamPath = resolve(
    "docs/execution/A/reviews/managed-native-observation-pre-review/p2/packages__openfilm__studio__ui__src__lib__host.ts",
  );
  const upstreamBranches = (): Map<string, { readonly fields: string[]; readonly required: string[] }> => {
    const source = readFileSync(upstreamPath, "utf8");
    const start = source.indexOf("export type StudioRef = (");
    const end = source.indexOf(") & { image?: StudioRefImage };", start);
    if (start < 0 || end < 0) throw new Error("THE_UPSTREAM_STUDIO_REF_IS_MISSING");
    const body = source.slice(start, end);
    const branches = new Map<string, { fields: string[]; required: string[] }>();
    for (const part of body.split("\n  | ")) {
      const kind = /kind: '([a-z]+)'/.exec(part)?.[1];
      if (kind === undefined) continue;
      const fields: string[] = [];
      const required: string[] = [];
      for (const match of part.matchAll(/(\w+)(\??):/g)) {
        const name = match[1]!;
        if (fields.includes(name)) continue;
        fields.push(name);
        if (match[2] !== "?") required.push(name);
      }
      branches.set(kind, { fields, required });
    }
    return branches;
  };

  it("declares exactly the branches and the fields the upstream declares", () => {
    const schema = JSON.parse(readFileSync(resolve("contracts/native-observation-v1.schema.json"), "utf8")) as {
      readonly $defs: {
        readonly NativeSelectionObservation: {
          readonly properties: {
            readonly refs: {
              readonly items: {
                readonly oneOf: ReadonlyArray<{
                  readonly required: readonly string[];
                  readonly properties: Record<string, unknown>;
                }>;
              };
            };
          };
        };
      };
    };
    const upstream = upstreamBranches();
    expect(upstream.size).toBe(8);
    const branches = schema.$defs.NativeSelectionObservation.properties.refs.items.oneOf;
    expect(branches.length).toBe(upstream.size);
    for (const branch of branches) {
      const kind = (branch.properties.kind as { const: string }).const;
      const declared = upstream.get(kind);
      expect(declared, kind).toBeDefined();
      if (declared === undefined) continue;
      // The contract's fields are the upstream's fields, and the same ones are required.
      const contractFields = Object.keys(branch.properties).filter((name) => name !== "image").sort();
      expect(contractFields, kind).toEqual([...declared.fields].sort());
      const contractRequired = [...branch.required].sort();
      expect(contractRequired, kind).toEqual([...declared.required].sort());
      // And the picture the pill shows is the upstream's own optional field.
      expect(Object.hasOwn(branch.properties, "image"), kind).toBe(true);
    }
  });
});

/**
 * The document and the hydration, against the real upstream sources.
 *
 * The document state is read from the pinned upstream's own host declaration, and the
 * hydration state is read from the pinned 013 patch that adds it. The contract is
 * compared with those, so it cannot drift into a shape the editor never sends.
 */
describe("the document and the hydration against the upstream sources", () => {
  const upstreamHostPath = resolve(
    "docs/execution/A/reviews/managed-native-observation-pre-review/p2/packages__openfilm__studio__ui__src__lib__host.ts",
  );
  const patchPath = resolve("tools/agent-driven/product/native-inputs/request013.patch");

  it("declares the document state the upstream declares", () => {
    const source = readFileSync(upstreamHostPath, "utf8");
    const start = source.indexOf("export type NarralensDocumentState = {");
    const end = source.indexOf(");", start);
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, end);
    const committed = /kind: 'document_dom_committed'; ([^}]*)\}/.exec(body)?.[1] ?? "";
    const invalidated = /kind: 'invalidated'; reason: ([^}]*)\}/.exec(body)?.[1] ?? "";
    const committedFields = [...committed.matchAll(/(\w+):/g)].map((match) => match[1]!).sort();
    const reasons = [...invalidated.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]!).sort();

    interface DocumentSchema {
      readonly $defs: {
        readonly NativeDocumentObservation: {
          readonly oneOf: ReadonlyArray<{ readonly required: readonly string[]; readonly properties: Record<string, unknown> }>;
        };
      };
    }
    const schema = JSON.parse(readFileSync(resolve("contracts/native-observation-v1.schema.json"), "utf8")) as DocumentSchema;
    const branches = schema.$defs.NativeDocumentObservation.oneOf;
    const committedBranch = branches.find((branch) => (branch.properties.kind as { const: string }).const === "document_dom_committed");
    const invalidatedBranch = branches.find((branch) => (branch.properties.kind as { const: string }).const === "invalidated");
    expect(committedBranch).toBeDefined();
    expect(invalidatedBranch).toBeDefined();
    if (committedBranch === undefined || invalidatedBranch === undefined) return;
    // The committed branch carries exactly the upstream's fields.
    expect([...committedBranch.required].filter((name) => name !== "kind" && name !== "protocol_version" && name !== "project_id"
      && name !== "editor_view_id" && name !== "document_epoch").sort()).toEqual(committedFields);
    // And the invalidation carries exactly the upstream's reasons.
    const declared = (invalidatedBranch.properties.reason as { enum: readonly string[] }).enum;
    expect([...declared].sort()).toEqual(reasons);
  });

  it("declares the hydration state the pinned patch adds", () => {
    const patch = readFileSync(patchPath, "utf8");
    const partNames = /NarralensHydrationPart = '([a-z_]+)' \| '([a-z_]+)' \| '([a-z_]+)' \| '([a-z_]+)'/.exec(patch);
    const states = /state: '([a-z_]+)' \| '([a-z_]+)' \| '([a-z_]+)' \| '([a-z_]+)' \| '([a-z_]+)' \| '([a-z_]+)'/.exec(patch);
    const origins = /NarralensHydrationOrigin = '([a-z_]+)' \| '([a-z_]+)' \| '([a-z_]+)'/.exec(patch);
    expect(partNames).not.toBeNull();
    expect(states).not.toBeNull();
    expect(origins).not.toBeNull();
    if (partNames === null || states === null || origins === null) return;
    const upstreamParts = partNames.slice(1).sort();
    const upstreamStates = states.slice(1).sort();
    const upstreamOrigins = origins.slice(1).sort();

    interface HydrationPartSchema {
      readonly properties: {
        readonly state: { readonly enum: readonly string[] };
        readonly origin: { readonly enum: readonly string[] };
      };
    }
    interface HydrationSchema {
      readonly $defs: {
        readonly NativeHydrationPart: HydrationPartSchema;
        readonly NativeHydrationObservation: {
          readonly properties: {
            readonly parts: { readonly required: readonly string[]; readonly properties: Record<string, { readonly $ref?: string }> };
          };
        };
      };
    }
    const schema = JSON.parse(readFileSync(resolve("contracts/native-observation-v1.schema.json"), "utf8")) as HydrationSchema;
    const parts = schema.$defs.NativeHydrationObservation.properties.parts;
    expect([...parts.required].sort()).toEqual(upstreamParts);
    // Every part is the one closed definition, referenced from the four names.
    const part = schema.$defs.NativeHydrationPart;
    expect([...part.properties.state.enum].sort()).toEqual(upstreamStates);
    expect([...part.properties.origin.enum].sort()).toEqual(upstreamOrigins);
    for (const kind of upstreamParts) {
      expect(parts.properties[kind], kind).toBeDefined();
      expect(parts.properties[kind]?.$ref, kind).toBe("#/$defs/NativeHydrationPart");
    }
  });
});

describe("the editor that opens again", () => {
  it("voids the acknowledgement of the view that is gone", async () => {
    const root = mkdtempSync(join(tmpdir(), 'narralens-r2-reopen-'));
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
            shot_ids: selection.refs.map((ref) => ref.id ?? 'none'),
            start_frame: 0,
            end_frame_exclusive: 1,
          }),
        },
      });
      const binding: NativeObservationSessionBinding = {
        bridge_session_id: 'f'.repeat(32),
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
      const envelope = (sequence: number, event_kind: 'document' | 'hydration' | 'selection', event: unknown) => ({
        format: 'narralens.native-observation@1' as const, sequence, event_kind, event,
      });
      const filmBytes = Buffer.from(film, 'utf8');
      await service.observe(binding, envelope(1, 'document', {
        protocol_version: 1, kind: 'document_dom_committed', project_id: 'n1',
        editor_view_id: 'view1', document_epoch: 1, native_rev: 'rev-1',
        film_sha256: sha256(filmBytes), utf8_byte_length: filmBytes.byteLength,
      }));
      await service.observe(binding, envelope(2, 'hydration', {
        project_id: 'n1', editor_view_id: 'view1', document_epoch: 1, hydration_epoch: 1,
        parts: {
          settings: { state: 'hydrated', origin: 'project', effective_sha256: HASH_A },
          subtitle_style: { state: 'absent_default', origin: 'explicit_default', effective_sha256: digestOfPart('subtitle_style', {}) },
          captions: { state: 'hydrated', origin: 'project', effective_sha256: digestOfPart('captions', { cues: [] }) },
          markers: { state: 'hydrated', origin: 'project', effective_sha256: HASH_A },
        },
      }));
      const selection = await service.observe(binding, envelope(3, 'selection', { projectId: 'n1', time: 1, refs: [] }));
      expect(selection.ack).not.toBeNull();
      expect((await service.read('p1')).ack).not.toBeNull();

      // The editor opens again on the same session. The acknowledgement of the view that
      // is gone must not survive it.
      service.sessionOpened(binding);
      const after = await service.read('p1');
      expect(after.ack).toBeNull();
      expect(after.sync).toBe('unknown');
      // The selection is not known any more, but it did not change, so the version
      // stays where it was and a plan that named it is still checked against it.
      expect(after.selection).toBeNull();
      expect(after.selection_version).toBe(1);
      // The sequence is not reset: the editor's counter continues.
      const next = await service.observe(binding, envelope(4, 'document', {
        protocol_version: 1, kind: 'document_dom_committed', project_id: 'n1',
        editor_view_id: 'view2', document_epoch: 1, native_rev: 'rev-1',
        film_sha256: sha256(filmBytes), utf8_byte_length: filmBytes.byteLength,
      }));
      expect(next.accepted).toBe(true);
      // The editor reports the same selection again after the reopening: the view
      // changed, the selection did not, so the version does not move and a plan that
      // named it is still checked against it.
      const again = await service.observe(binding, envelope(5, 'selection', { projectId: 'n1', time: 1, refs: [] }));
      expect(again.accepted).toBe(true);
      expect(service.currentSelectionVersion('p1')).toBe(1);
      // A selection that really is different does move it.
      const different = await service.observe(binding, envelope(6, 'selection', {
        projectId: 'n1', time: 1, refs: [{ kind: 'clip', id: 'other' }],
      }));
      expect(different.accepted).toBe(true);
      expect(service.currentSelectionVersion('p1')).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────────────────
 * The private lifecycle of the expected service.
 *
 * These are the counterexamples of the ticket. Every one of them is a real way the
 * old lifecycle loses a descriptor or keeps an authority it should have dropped, and
 * every one of them runs on real files, real descriptors and controlled promises.
 *
 * Two rules shape the cases:
 *
 * - a *primary* failure and a *cleanup* failure are different things. The primary
 *   failure stays the primary failure, and the cleanup causes are kept beside it
 *   without ever becoming public;
 * - a close that failed has an unknown outcome. Such a case never claims that the
 *   operating system released the descriptor — it only claims what it can prove.
 * ──────────────────────────────────────────────────────────────────────────────────── */

/** A controlled promise, so a read can be resolved after the service moved on. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/**
 * The facts of one read, with the given retained descriptors.
 *
 * It is the same fact shape the real reader produces; only the descriptors and the
 * closure guard are the case's own.
 */
function factsOf(retained: readonly NativeExpectedRetainedFile[], verifyClosure: () => boolean): NativeExpectedSourceFacts {
  return {
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
    verifyClosure,
  };
}

/**
 * A reader that opens *fresh* real descriptors on every read.
 *
 * The close of one designated file fails honestly: it throws and it does not close
 * the descriptor, so the outcome of that one release is unknown and no case may claim
 * that the operating system released it. Every other close really closes, and the
 * case can prove that with `fstatSync`.
 */
function faultyReader(root: string, names: readonly string[], failingCloseAt: number | null = null): {
  port: NativeExpectedSourcePort;
  readonly reads: () => number;
  readonly attempts: () => readonly (readonly number[])[];
  readonly descriptorIsOpen: (read: number, index: number) => boolean;
  readonly closeAll: () => void;
} {
  const source = resolve(root, 'source');
  mkdirSync(source, { recursive: true });
  const attempts: number[][] = [];
  const descriptors: number[][] = [];
  let reads = 0;
  const port: NativeExpectedSourcePort = {
    readSource: async () => {
      const read = reads;
      reads += 1;
      attempts.push(new Array<number>(names.length).fill(0));
      descriptors.push(new Array<number>(names.length).fill(-1));
      const retained: NativeExpectedRetainedFile[] = [];
      names.forEach((name, index) => {
        const path = resolve(source, name);
        writeFileSync(path, `the bytes of ${name}`);
        const fd = openSync(path, 'r');
        descriptors[read]![index] = fd;
        const bytes = readFileSync(path);
        const identity = fstatSync(fd);
        retained.push({
          relative_path: name,
          sha256: sha256(bytes),
          bytes: bytes.byteLength,
          verify: () => {
            try {
              const stat = lstatSync(path);
              if (!stat.isFile() || stat.dev !== identity.dev || stat.ino !== identity.ino) return false;
              const buffer = Buffer.alloc(bytes.byteLength);
              const count = readSync(fd, buffer, 0, buffer.byteLength, 0);
              if (count !== buffer.byteLength) return false;
              return sha256(buffer) === sha256(bytes);
            } catch {
              return false;
            }
          },
          close: () => {
            attempts[read]![index]! += 1;
            if (index === failingCloseAt) {
              // The close failed and the outcome is unknown: the descriptor is left
              // alone and the failure is reported.
              throw new Error(`THE_CLOSE_FAILED:${name}`);
            }
            try { closeSync(fd); } catch { /* already closed */ }
          },
        });
      });
      return factsOf(retained, () => true);
    },
  };
  return {
    port,
    reads: () => reads,
    attempts: () => attempts,
    descriptorIsOpen: (read, index) => {
      const fd = descriptors[read]?.[index] ?? -1;
      if (fd < 0) return false;
      try { fstatSync(fd); return true; } catch { return false; }
    },
    closeAll: () => {
      for (const row of descriptors) {
        for (const fd of row) {
          if (fd < 0) continue;
          try { closeSync(fd); } catch { /* already closed */ }
        }
      }
    },
  };
}

/** A stand-in for the pinned candidate, for the cases that never reach the maths. */
function stubLibrary(): NativeExpectedLibrary {
  return {
    EXPECTED_PROFILE: NATIVE_EXPECTED_PROFILE,
    upstream_sha: NATIVE_EXPECTED_UPSTREAM_SHA,
    computeExpectedProjection: () => ({ status: 'unsupported', profile: NATIVE_EXPECTED_PROFILE, reason: 'INPUT_INVALID' }),
    hydrationCanonicalJson: (value: unknown) => JSON.stringify(value) ?? 'null',
  };
}

describe('the private lifecycle of the expected service', () => {
  const serviceOf = async (root: string, reader: NativeExpectedSourcePort, staged: ReturnType<typeof stageLibrary>): Promise<OpenFilmNativeExpected> =>
    new OpenFilmNativeExpected({
      source: reader,
      loader: nativeExpectedLibraryLoader({ distRoot: staged.dist, inputsRoot: staged.inputs, runtimeRoot: staged.runtime }),
      approved: await approvedOf(staged),
    });

  it('keeps the projection failure and still releases every other descriptor', async () => {
    const root = mkdtempSync(join(tmpdir(), 'narralens-r2-lifecycle-'));
    const reader = faultyReader(root, ['film.html', 'settings.json', 'markers.json'], 0);
    try {
      const staged = stageLibrary(root, { throwOnCompute: true });
      const service = await serviceOf(root, reader.port, staged);
      const failure = await service.prove(bindingOf()).then(() => null, (error: unknown) => error);
      expect(failure).toBeInstanceOf(Error);
      // The primary failure is still the primary failure: the cleanup did not
      // overwrite it.
      expect((failure as Error).message).toContain('THE_PROJECTION_FAILED');
      // Every descriptor was attempted, including the ones after the failing close.
      expect(reader.attempts()[0]).toEqual([1, 1, 1]);
      // The two that closed really closed.
      expect(reader.descriptorIsOpen(0, 1)).toBe(false);
      expect(reader.descriptorIsOpen(0, 2)).toBe(false);
      // The failing one has an unknown outcome, and the case claims nothing about it.
      // The cleanup causes are preserved, but they are not public.
      const causes = (failure as { cleanup_errors?: unknown[] }).cleanup_errors;
      expect(Array.isArray(causes)).toBe(true);
      expect(causes?.length).toBe(1);
      expect(Object.keys(failure as object)).not.toContain('cleanup_errors');
    } finally {
      reader.closeAll();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('revokes the proof before the cleanup, and still releases every descriptor', async () => {
    const root = mkdtempSync(join(tmpdir(), 'narralens-r2-lifecycle-'));
    const reader = faultyReader(root, ['film.html', 'settings.json'], 0);
    try {
      const staged = stageLibrary(root, { computed: true });
      const service = await serviceOf(root, reader.port, staged);
      const binding = bindingOf();
      const proof = await service.prove(binding);
      expect(() => service.release(proof)).toThrow('NATIVE_EXPECTED_CLEANUP_FAILED');
      // Every descriptor was attempted, in spite of the first close failing.
      expect(reader.attempts()[0]).toEqual([1, 1]);
      expect(reader.descriptorIsOpen(0, 1)).toBe(false);
      // The authority was revoked before the cleanup, so the proof is dead even
      // though the release failed.
      expect(proof.released).toBe(true);
      expect(() => service.assertCurrent(binding, proof)).toThrow();
    } finally {
      reader.closeAll();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('releases every proof on close, even when the first cleanup fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'narralens-r2-lifecycle-'));
    const reader = faultyReader(root, ['film.html', 'settings.json'], 0);
    try {
      const staged = stageLibrary(root, { computed: true });
      const service = await serviceOf(root, reader.port, staged);
      await service.prove(bindingOf());
      await service.prove(bindingOf());
      expect(reader.reads()).toBe(2);
      expect(() => service.close()).toThrow('NATIVE_EXPECTED_CLEANUP_FAILED');
      // Both proofs were cleaned: the failure of the first did not strand the second.
      expect(reader.attempts()).toEqual([[1, 1], [1, 1]]);
      expect(reader.descriptorIsOpen(1, 1)).toBe(false);
    } finally {
      reader.closeAll();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not go green again after an uncertain cleanup', async () => {
    const root = mkdtempSync(join(tmpdir(), 'narralens-r2-lifecycle-'));
    const reader = faultyReader(root, ['film.html'], 0);
    try {
      const staged = stageLibrary(root, { computed: true });
      const service = await serviceOf(root, reader.port, staged);
      const binding = bindingOf();
      const proof = await service.prove(binding);
      expect(() => service.release(proof)).toThrow('NATIVE_EXPECTED_CLEANUP_FAILED');
      const attempts = reader.attempts()[0]!.slice();
      // The uncertainty is sticky: nothing is proved any more.
      await expect(service.prove(binding)).rejects.toThrow('NATIVE_EXPECTED_CLEANUP_UNCERTAIN');
      expect(() => service.assertCurrent(binding, proof)).toThrow('NATIVE_EXPECTED_CLEANUP_UNCERTAIN');
      // A repeated release neither retries the descriptor nor reports a success.
      expect(() => service.release(proof)).toThrow('NATIVE_EXPECTED_CLEANUP_UNCERTAIN');
      expect(reader.attempts()[0]).toEqual(attempts);
      // And a repeated close neither retries nor reports a success.
      expect(() => service.close()).toThrow('NATIVE_EXPECTED_CLEANUP_UNCERTAIN');
      expect(reader.attempts()[0]).toEqual(attempts);
    } finally {
      reader.closeAll();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses a candidate that loads after the close, and never reads the source', async () => {
    const root = mkdtempSync(join(tmpdir(), 'narralens-r2-lifecycle-'));
    try {
      const gate = deferred<NativeExpectedLibrary>();
      let reads = 0;
      const service = new OpenFilmNativeExpected({
        source: { readSource: async () => { reads += 1; return factsOf([], () => true); } },
        loader: { load: async () => gate.promise },
        approved: { upstream_sha: NATIVE_EXPECTED_UPSTREAM_SHA, inputs_sha256: HASH_A, build_sha256: HASH_A, modules: {} },
      });
      const pending = service.prove(bindingOf());
      service.close();
      gate.resolve(stubLibrary());
      await expect(pending).rejects.toThrow('NATIVE_EXPECTED_CLOSED');
      // The source was never read: a closed service starts no read at all.
      expect(reads).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('releases the descriptors of a source that returns after the close, and issues no proof', async () => {
    const root = mkdtempSync(join(tmpdir(), 'narralens-r2-lifecycle-'));
    const reader = faultyReader(root, ['film.html', 'settings.json']);
    try {
      const gate = deferred<NativeExpectedSourceFacts>();
      let readStarted!: () => void;
      const started = new Promise<void>(resolve => { readStarted = resolve; });
      const service = new OpenFilmNativeExpected({
        source: { readSource: () => { readStarted(); return gate.promise; } },
        loader: { load: async () => stubLibrary() },
        approved: { upstream_sha: NATIVE_EXPECTED_UPSTREAM_SHA, inputs_sha256: HASH_A, build_sha256: HASH_A, modules: {} },
      });
      const pending = service.prove(bindingOf());
      // The read is in flight when the service is closed.
      await started;
      service.close();
      // The read returns its descriptors now: the responsibility is the service's
      // from that moment on.
      const facts = await reader.port.readSource({ binding: bindingOf() });
      gate.resolve(facts);
      await expect(pending).rejects.toThrow('NATIVE_EXPECTED_CLOSED');
      // Every descriptor the late read delivered was released, and no proof was
      // issued.
      expect(reader.attempts()[0]).toEqual([1, 1]);
      expect(reader.descriptorIsOpen(0, 0)).toBe(false);
      expect(reader.descriptorIsOpen(0, 1)).toBe(false);
    } finally {
      reader.closeAll();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses a foreign proof and releases nothing of the owner', async () => {
    const root = mkdtempSync(join(tmpdir(), 'narralens-r2-lifecycle-'));
    const reader = faultyReader(root, ['film.html']);
    try {
      const staged = stageLibrary(root, { computed: true });
      const owner = await serviceOf(root, reader.port, staged);
      const other = await serviceOf(root, reader.port, staged);
      const binding = bindingOf();
      const proof = await owner.prove(binding);
      // Another instance may not release this proof, and it may not release the
      // resources behind it either.
      expect(() => other.release(proof)).toThrow('NATIVE_EXPECTED_PROOF_FOREIGN');
      // The owner's descriptor was never closed by the other instance.
      expect(reader.attempts()[0]).toEqual([0]);
      // The owner's proof still asserts: nobody revoked it behind its back.
      expect(() => owner.assertCurrent(binding, proof)).not.toThrow();
    } finally {
      reader.closeAll();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses a forged or a rebuilt proof, and releases nothing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'narralens-r2-lifecycle-'));
    const reader = faultyReader(root, ['film.html']);
    try {
      const staged = stageLibrary(root, { computed: true });
      const service = await serviceOf(root, reader.port, staged);
      const binding = bindingOf();
      const proof = await service.prove(binding);
      const forged = Object.create(Object.getPrototypeOf(proof)) as typeof proof;
      expect(() => service.release(forged)).toThrow('NATIVE_EXPECTED_PROOF_FOREIGN');
      const rebuilt = JSON.parse(JSON.stringify({ released: false })) as typeof proof;
      expect(() => service.release(rebuilt)).toThrow('NATIVE_EXPECTED_PROOF_FOREIGN');
      // Nothing was released: the owner's descriptor is still open.
      expect(reader.attempts()[0]).toEqual([0]);
      expect(reader.descriptorIsOpen(0, 0)).toBe(true);
      // The real proof is untouched.
      expect(() => service.assertCurrent(binding, proof)).not.toThrow();
    } finally {
      reader.closeAll();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('releases one resource that is listed twice exactly once', async () => {
    const root = mkdtempSync(join(tmpdir(), 'narralens-r2-lifecycle-'));
    let fd = -1;
    try {
      const source = resolve(root, 'source');
      mkdirSync(source, { recursive: true });
      writeFileSync(resolve(source, 'film.html'), 'the original film');
      fd = openSync(resolve(source, 'film.html'), 'r');
      let closes = 0;
      const file: NativeExpectedRetainedFile = {
        relative_path: 'film.html',
        sha256: HASH_A,
        bytes: 0,
        verify: () => true,
        close: () => { closes += 1; try { closeSync(fd); } catch { /* already closed */ } },
      };
      const staged = stageLibrary(root, { computed: true });
      const service = await serviceOf(root, readerPortOf([file, file]), staged);
      const proof = await service.prove(bindingOf());
      service.release(proof);
      // The same object twice in one list is one resource, not two: closing it twice
      // could close an unrelated file that took its descriptor number.
      expect(closes).toBe(1);
    } finally {
      if (fd >= 0) { try { closeSync(fd); } catch { /* already closed */ } }
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('releases a proof once, and a repeated release neither closes again nor fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'narralens-r2-lifecycle-'));
    const reader = faultyReader(root, ['film.html', 'settings.json']);
    try {
      const staged = stageLibrary(root, { computed: true });
      const service = await serviceOf(root, reader.port, staged);
      const binding = bindingOf();
      const proof = await service.prove(binding);
      service.release(proof);
      expect(reader.attempts()[0]).toEqual([1, 1]);
      expect(reader.descriptorIsOpen(0, 0)).toBe(false);
      // A repeated release is idempotent: the descriptors are not touched again.
      service.release(proof);
      expect(reader.attempts()[0]).toEqual([1, 1]);
      // And the released proof is refused from now on.
      expect(() => service.assertCurrent(binding, proof)).toThrow('NATIVE_EXPECTED_PROOF_RELEASED');
    } finally {
      reader.closeAll();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('closes twice without closing a descriptor twice', async () => {
    const root = mkdtempSync(join(tmpdir(), 'narralens-r2-lifecycle-'));
    const reader = faultyReader(root, ['film.html', 'settings.json']);
    try {
      const staged = stageLibrary(root, { computed: true });
      const service = await serviceOf(root, reader.port, staged);
      await service.prove(bindingOf());
      service.close();
      expect(reader.attempts()[0]).toEqual([1, 1]);
      expect(reader.descriptorIsOpen(0, 0)).toBe(false);
      // The second close is a no-op: it neither closes again nor fails.
      service.close();
      expect(reader.attempts()[0]).toEqual([1, 1]);
    } finally {
      reader.closeAll();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

/** A port that always answers with the given descriptors. */
function readerPortOf(retained: readonly NativeExpectedRetainedFile[]): NativeExpectedSourcePort {
  return { readSource: async () => factsOf(retained, () => true) };
}
