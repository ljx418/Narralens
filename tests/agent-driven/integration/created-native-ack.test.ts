import { describe, expect, it } from 'vitest';
import {
  NATIVE_OBSERVATION_FORMAT,
  nativeSecondsCanonical,
  validateNativeDocumentObservation,
  validateNativeHydrationObservation,
  validateNativeObservationEnvelope,
  validateNativeSelectionObservation,
} from '../../../src/host/m5/native-observation.js';

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
