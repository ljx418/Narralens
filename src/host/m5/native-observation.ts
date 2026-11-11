import type { NativeAck, Selection } from '../../contracts/agent-driven-types.js';
import type { NativeContextFacts, NativeContextPort } from '../agent-driven/project-context-service.js';
import type { NativeAckStore } from './native-ack-store.js';
import type {
  NativeExpectedBinding,
  NativeExpectedPart,
  NativeExpectedPartKind,
  NativeExpectedPort,
  NativeExpectedProof,
  NativeExpectedProjection,
  NativeExpectedWorkspace,
} from './openfilm-native-expected.js';

/**
 * The native observation service (A-R2, L05).
 *
 * The editor reports what it loaded; this service decides whether that report is
 * *evidence*, and it is deliberately hard to make it say yes:
 *
 * - the report arrives on one closed envelope, over the native cookie and the native
 *   CSRF proof, inside a live controlled session. A UI cookie, a read token, another
 *   origin or a stale session is not a report;
 * - the envelope carries **no** identity. The logical project, the actor, the session,
 *   the grant, the Host revision, the snapshot, the source digest, the approval and the
 *   proof all come from the session binding, so a client cannot name any of them;
 * - the sequence is recorded *before* the asynchronous verification, so a late callback
 *   can never re-green a session that has already moved on;
 * - the view, the document epoch and the hydration epoch only ever move forward, and a
 *   new view voids the old profile;
 * - all four parts must be proved, from the project or from the pinned explicit
 *   default, and a browser preference is never an acceptable origin;
 * - the expected side is computed independently, from the Host's committed source. A
 *   matching hash on its own is not enough: the film, the revision and the current
 *   commit are compared too;
 * - and the whole thing is re-checked at the final, synchronous record boundary. The
 *   acknowledgement is written only if the session, the sequence, the generation, the
 *   view, the document epoch, the hydration epoch, the commit, the control revision,
 *   the selection and the recovery gate are all still exactly what they were.
 *
 * A decision, a commit and a native load stay three different facts. This service only
 * ever produces the third one, and only from the editor's own report checked against
 * the Host's own source.
 */

/* ── the closed envelope ───────────────────────────────────────────────────────────── */

export const NATIVE_OBSERVATION_FORMAT = 'narralens.native-observation@1';
export const NATIVE_OBSERVATION_EVENT_KINDS = ['document', 'hydration', 'selection'] as const;
export type NativeObservationEventKind = (typeof NATIVE_OBSERVATION_EVENT_KINDS)[number];

/** The one envelope the native ingress accepts. */
export interface NativeObservationEnvelope {
  readonly format: typeof NATIVE_OBSERVATION_FORMAT;
  readonly sequence: number;
  readonly event_kind: NativeObservationEventKind;
  readonly event: unknown;
}

/* ── the three event kinds, in their original shapes ───────────────────────────────── */

/** The original p2 `NarralensDocumentState` invalidate reasons. */
export const NATIVE_DOCUMENT_INVALIDATE_REASONS =
  ['dirty', 'refresh', 'broken', 'external_edit', 'replaced', 'hash_failed', 'unmounted'] as const;
export type NativeDocumentInvalidateReason = (typeof NATIVE_DOCUMENT_INVALIDATE_REASONS)[number];

export interface NativeDocumentCommitted {
  readonly kind: 'document_dom_committed';
  readonly native_rev: string;
  readonly film_sha256: string;
  readonly utf8_byte_length: number;
}

export interface NativeDocumentInvalidated {
  readonly kind: 'invalidated';
  readonly reason: NativeDocumentInvalidateReason;
}

/** The original p2 `NarralensDocumentState`. */
export type NativeDocumentObservation = {
  readonly protocol_version: 1;
  readonly project_id: string;
  readonly editor_view_id: string;
  readonly document_epoch: number;
} & (NativeDocumentCommitted | NativeDocumentInvalidated);

/** The original 013 hydration part states and origins. */
export const NATIVE_HYDRATION_PART_STATES =
  ['pending', 'hydrated', 'absent_default', 'dirty', 'failed', 'unsupported'] as const;
export type NativeHydrationPartState = (typeof NATIVE_HYDRATION_PART_STATES)[number];
export const NATIVE_HYDRATION_ORIGINS = ['project', 'explicit_default', 'browser_preference'] as const;
export type NativeHydrationOrigin = (typeof NATIVE_HYDRATION_ORIGINS)[number];

export interface NativeHydrationPartObservation {
  readonly state: NativeHydrationPartState;
  readonly origin: NativeHydrationOrigin;
  readonly effective_sha256: string | null;
}

/** The original 013 hydration event: five fields and exactly four parts. */
export interface NativeHydrationObservation {
  readonly project_id: string;
  readonly editor_view_id: string;
  readonly document_epoch: number;
  readonly hydration_epoch: number;
  readonly parts: Readonly<Record<NativeExpectedPartKind, NativeHydrationPartObservation>>;
}

/** The original Studio selection reference kinds. */
export const NATIVE_SELECTION_REF_KINDS =
  ['clip', 'layer', 'region', 'time', 'range', 'track', 'file', 'subtitle'] as const;
export type NativeSelectionRefKind = (typeof NATIVE_SELECTION_REF_KINDS)[number];

/** One original `StudioRef`. Only the fields the closed contract declares. */
export interface NativeSelectionRef {
  readonly kind: NativeSelectionRefKind;
  readonly id?: string | null;
  readonly loc?: string | null;
  readonly clipId?: string | null;
  readonly track?: number;
  readonly time?: number;
  readonly start?: number;
  readonly end?: number;
  readonly path?: string;
  readonly text?: string | null;
  readonly index?: number;
  readonly clipIds?: readonly string[];
}

/** The original `StudioSelection`. */
export interface NativeSelectionObservation {
  readonly projectId: string;
  readonly time: number;
  readonly refs: readonly NativeSelectionRef[];
  readonly range?: { readonly start: number; readonly end: number } | null;
  readonly stage?: { readonly w: number; readonly h: number };
}

/* ── the session binding and the port ───────────────────────────────────────────────── */

/**
 * The Host's own binding of one native session.
 *
 * It is created by the Host at the exchange and it is never built from a request body.
 * `bridge_session_id` is a non-secret identifier, not a credential.
 */
export interface NativeObservationSessionBinding {
  readonly bridge_session_id: string;
  readonly instance_generation: number;
  readonly project_id: string;
  readonly native_project_id: string;
  readonly owner_session_ref: string;
  readonly revision: number;
  readonly snapshot_id: string;
  readonly source_digest: string;
  readonly workspace: NativeExpectedWorkspace;
  /** Re-checks the real session's liveness, owner and generation. */
  readonly isCurrent: () => boolean;
}

/** What one observation produced. */
export interface NativeObservationOutcome {
  readonly accepted: boolean;
  readonly reason: string;
  readonly sequence: number;
  readonly ack: NativeAck | null;
}

/** The fixed observation port the grant may carry. */
export interface NativeObservationPort {
  sessionOpened(binding: NativeObservationSessionBinding): void;
  observe(binding: NativeObservationSessionBinding, envelope: NativeObservationEnvelope): Promise<NativeObservationOutcome>;
  sessionClosed(binding: NativeObservationSessionBinding): void;
}

/**
 * What BRIDGE captures in the `#openNative` closure.
 *
 * The client cannot construct one: it carries the real owner, the real project, the
 * real commit, the instance generation, the verified workspace and the authoritative
 * selection authority.
 */
export interface NativeObservationGrant {
  readonly port: NativeObservationPort;
  readonly owner_session_ref: string;
  readonly project_id: string;
  readonly native_project_id: string;
  readonly instance_generation: number;
  readonly revision: number;
  readonly snapshot_id: string;
  readonly source_digest: string;
  readonly workspace: NativeExpectedWorkspace;
  readonly isCurrent: () => boolean;
}

/**
 * MAIN's committed clip and time mapping (the I4 closure).
 *
 * The native selection names clip ids and seconds; the Host's own `Selection` names
 * shots and frames. Only the committed source can say which is which, so the mapping is
 * a port and not a guess.
 */
export interface NativeSelectionMappingPort {
  mapSelection(input: {
    readonly binding: NativeObservationSessionBinding;
    readonly selection: NativeSelectionObservation;
  }): Promise<{ readonly shot_ids: readonly string[]; readonly start_frame: number; readonly end_frame_exclusive: number } | null>;
}

export interface NativeObservationServiceDeps {
  /** The durable acknowledgement store, on the Host's one connection. */
  readonly ackStore: NativeAckStore;
  /** The independent expected side. */
  readonly expected: NativeExpectedPort;
  /** The committed clip/time mapping. Without it no selection is ever current. */
  readonly selectionMapping?: NativeSelectionMappingPort | undefined;
  readonly now?: () => Date;
}

/* ── the small closed helpers ──────────────────────────────────────────────────────── */

type Check<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };

const ok = <T>(value: T): Check<T> => ({ ok: true, value });
const no = (reason: string): Check<never> => ({ ok: false, reason });
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const isSha256 = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const isName = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256;
const isEpoch = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/**
 * The native seconds canonicalisation.
 *
 * Native seconds are a *fractional* domain of their own: the editor counts in seconds
 * with a millisecond resolution, and it never enters the integer canonical domain of
 * the contract. The rounding is half away from zero at the native millisecond, and the
 * result is a plain decimal so that two observations of the same moment compare equal.
 */
export function nativeSecondsCanonical(value: number): string {
  if (!Number.isFinite(value)) throw new Error('NATIVE_SECONDS_NOT_FINITE');
  const factor = 1e6;
  const scaled = value * factor;
  const rounded = (scaled < 0 ? -1 : 1) * Math.round(Math.abs(scaled));
  const normalised = rounded / factor;
  return Object.is(normalised, -0) ? '0' : String(normalised);
}

/* ── the envelope and event validation ─────────────────────────────────────────────── */

/**
 * The envelope shell.
 *
 * Only the four fields exist. A body that carries a logical project, an actor, a
 * session, a grant, a Host revision, a snapshot, a source digest, an approval or a
 * proof is refused outright: those facts come from the session binding and nowhere
 * else.
 */
export function validateNativeObservationEnvelope(value: unknown): Check<NativeObservationEnvelope> {
  if (!isPlainObject(value)) return no('ENVELOPE_NOT_AN_OBJECT');
  const keys = Object.keys(value).sort();
  if (keys.length !== 4 || keys[0] !== 'event' || keys[1] !== 'event_kind' || keys[2] !== 'format' || keys[3] !== 'sequence') {
    return no('ENVELOPE_FIELDS_NOT_CLOSED');
  }
  if (value.format !== NATIVE_OBSERVATION_FORMAT) return no('ENVELOPE_FORMAT_UNKNOWN');
  if (typeof value.sequence !== 'number' || !Number.isSafeInteger(value.sequence) || value.sequence < 1) {
    return no('ENVELOPE_SEQUENCE_INVALID');
  }
  if (typeof value.event_kind !== 'string' || !(NATIVE_OBSERVATION_EVENT_KINDS as readonly string[]).includes(value.event_kind)) {
    return no('ENVELOPE_EVENT_KIND_UNKNOWN');
  }
  if (!isPlainObject(value.event)) return no('ENVELOPE_EVENT_NOT_AN_OBJECT');
  return ok({
    format: NATIVE_OBSERVATION_FORMAT,
    sequence: value.sequence,
    event_kind: value.event_kind as NativeObservationEventKind,
    event: value.event,
  });
}

/** The original p2 document state, in its original shape. */
export function validateNativeDocumentObservation(value: unknown): Check<NativeDocumentObservation> {
  if (!isPlainObject(value)) return no('DOCUMENT_NOT_AN_OBJECT');
  if (value.protocol_version !== 1) return no('DOCUMENT_PROTOCOL_VERSION_UNKNOWN');
  if (!isName(value.project_id)) return no('DOCUMENT_PROJECT_ID_INVALID');
  if (!isName(value.editor_view_id)) return no('DOCUMENT_VIEW_ID_INVALID');
  if (!isEpoch(value.document_epoch)) return no('DOCUMENT_EPOCH_INVALID');
  if (value.kind === 'document_dom_committed') {
    if (!isName(value.native_rev)) return no('DOCUMENT_REV_INVALID');
    if (!isSha256(value.film_sha256)) return no('DOCUMENT_FILM_HASH_INVALID');
    if (typeof value.utf8_byte_length !== 'number' || !Number.isSafeInteger(value.utf8_byte_length) || value.utf8_byte_length < 0) {
      return no('DOCUMENT_BYTE_LENGTH_INVALID');
    }
    const committed: NativeDocumentCommitted = {
      kind: 'document_dom_committed',
      native_rev: value.native_rev,
      film_sha256: value.film_sha256,
      utf8_byte_length: value.utf8_byte_length,
    };
    return ok({
      protocol_version: 1,
      project_id: value.project_id,
      editor_view_id: value.editor_view_id,
      document_epoch: value.document_epoch,
      ...committed,
    });
  }
  if (value.kind === 'invalidated') {
    if (typeof value.reason !== 'string' || !(NATIVE_DOCUMENT_INVALIDATE_REASONS as readonly string[]).includes(value.reason)) {
      return no('DOCUMENT_REASON_INVALID');
    }
    return ok({
      protocol_version: 1,
      project_id: value.project_id,
      editor_view_id: value.editor_view_id,
      document_epoch: value.document_epoch,
      kind: 'invalidated',
      reason: value.reason as NativeDocumentInvalidateReason,
    });
  }
  return no('DOCUMENT_KIND_UNKNOWN');
}

/** The original 013 hydration event: five fields and exactly four closed parts. */
export function validateNativeHydrationObservation(value: unknown): Check<NativeHydrationObservation> {
  if (!isPlainObject(value)) return no('HYDRATION_NOT_AN_OBJECT');
  if (!isName(value.project_id)) return no('HYDRATION_PROJECT_ID_INVALID');
  if (!isName(value.editor_view_id)) return no('HYDRATION_VIEW_ID_INVALID');
  if (!isEpoch(value.document_epoch)) return no('HYDRATION_DOCUMENT_EPOCH_INVALID');
  if (typeof value.hydration_epoch !== 'number' || !Number.isSafeInteger(value.hydration_epoch) || value.hydration_epoch < 1) {
    return no('HYDRATION_EPOCH_INVALID');
  }
  if (!isPlainObject(value.parts)) return no('HYDRATION_PARTS_NOT_AN_OBJECT');
  const partKeys = Object.keys(value.parts).sort();
  if (partKeys.length !== 4 || partKeys.join(',') !== 'captions,markers,settings,subtitle_style') {
    return no('HYDRATION_PARTS_NOT_CLOSED');
  }
  const parts = {} as Record<NativeExpectedPartKind, NativeHydrationPartObservation>;
  for (const kind of ['settings', 'subtitle_style', 'captions', 'markers'] as const) {
    const part = value.parts[kind];
    if (!isPlainObject(part)) return no('HYDRATION_PART_NOT_AN_OBJECT');
    const partKeysInner = Object.keys(part).sort();
    if (partKeysInner.length !== 3 || partKeysInner[0] !== 'effective_sha256' || partKeysInner[1] !== 'origin' || partKeysInner[2] !== 'state') {
      return no('HYDRATION_PART_FIELDS_NOT_CLOSED');
    }
    if (typeof part.state !== 'string' || !(NATIVE_HYDRATION_PART_STATES as readonly string[]).includes(part.state)) {
      return no('HYDRATION_PART_STATE_UNKNOWN');
    }
    if (typeof part.origin !== 'string' || !(NATIVE_HYDRATION_ORIGINS as readonly string[]).includes(part.origin)) {
      return no('HYDRATION_PART_ORIGIN_UNKNOWN');
    }
    const hash = part.effective_sha256;
    if (hash !== null && !isSha256(hash)) return no('HYDRATION_PART_HASH_INVALID');
    const state = part.state as NativeHydrationPartState;
    const origin = part.origin as NativeHydrationOrigin;
    // Only a hydrated or an absent-default part may carry a digest, and only a project
    // or an explicit default may be one. A browser preference is never a proof.
    if ((state === 'hydrated' || state === 'absent_default') && hash === null) return no('HYDRATION_PART_HASH_MISSING');
    if (state !== 'hydrated' && state !== 'absent_default' && hash !== null) return no('HYDRATION_PART_HASH_UNEXPECTED');
    if ((state === 'hydrated' || state === 'absent_default') && origin === 'browser_preference') return no('HYDRATION_PART_ORIGIN_REFUSED');
    parts[kind] = { state, origin, effective_sha256: hash };
  }
  return ok({
    project_id: value.project_id,
    editor_view_id: value.editor_view_id,
    document_epoch: value.document_epoch,
    hydration_epoch: value.hydration_epoch,
    parts,
  });
}

/** The original `StudioSelection`, in its original shape. */
export function validateNativeSelectionObservation(value: unknown): Check<NativeSelectionObservation> {
  if (!isPlainObject(value)) return no('SELECTION_NOT_AN_OBJECT');
  if (!isName(value.projectId)) return no('SELECTION_PROJECT_ID_INVALID');
  if (typeof value.time !== 'number' || !Number.isFinite(value.time)) return no('SELECTION_TIME_INVALID');
  if (!Array.isArray(value.refs)) return no('SELECTION_REFS_INVALID');
  const refs: NativeSelectionRef[] = [];
  for (const entry of value.refs) {
    if (!isPlainObject(entry)) return no('SELECTION_REF_NOT_AN_OBJECT');
    if (typeof entry.kind !== 'string' || !(NATIVE_SELECTION_REF_KINDS as readonly string[]).includes(entry.kind)) {
      return no('SELECTION_REF_KIND_UNKNOWN');
    }
    refs.push(entry as unknown as NativeSelectionRef);
  }
  let range: { start: number; end: number } | null | undefined;
  if (value.range !== undefined && value.range !== null) {
    if (!isPlainObject(value.range)) return no('SELECTION_RANGE_INVALID');
    if (typeof value.range.start !== 'number' || !Number.isFinite(value.range.start)
      || typeof value.range.end !== 'number' || !Number.isFinite(value.range.end)) return no('SELECTION_RANGE_INVALID');
    range = { start: value.range.start, end: value.range.end };
  } else if (value.range === null) {
    range = null;
  }
  let stage: { w: number; h: number } | undefined;
  if (value.stage !== undefined) {
    if (!isPlainObject(value.stage)) return no('SELECTION_STAGE_INVALID');
    if (typeof value.stage.w !== 'number' || !Number.isFinite(value.stage.w)
      || typeof value.stage.h !== 'number' || !Number.isFinite(value.stage.h)) return no('SELECTION_STAGE_INVALID');
    stage = { w: value.stage.w, h: value.stage.h };
  }
  return ok({
    projectId: value.projectId,
    time: value.time,
    refs,
    ...(range === undefined ? {} : { range }),
    ...(stage === undefined ? {} : { stage }),
  });
}

/* ── the service ───────────────────────────────────────────────────────────────────── */

interface SessionState {
  readonly binding: NativeObservationSessionBinding;
  lastSequence: number;
  viewId: string | null;
  documentEpoch: number;
  document: NativeDocumentCommitted | null;
  hydrationEpoch: number;
  parts: Record<NativeExpectedPartKind, NativeHydrationPartObservation>;
  selection: NativeSelectionObservation | null;
  selectionVersion: number;
  mapped: { readonly shot_ids: readonly string[]; readonly start_frame: number; readonly end_frame_exclusive: number } | null;
  ack: NativeAck | null;
  closed: boolean;
}

const emptyParts = (): Record<NativeExpectedPartKind, NativeHydrationPartObservation> => ({
  settings: { state: 'pending', origin: 'project', effective_sha256: null },
  subtitle_style: { state: 'pending', origin: 'project', effective_sha256: null },
  captions: { state: 'pending', origin: 'project', effective_sha256: null },
  markers: { state: 'pending', origin: 'project', effective_sha256: null },
});

export class NativeObservationService implements NativeContextPort, NativeObservationPort {
  readonly #ackStore: NativeAckStore;
  readonly #expected: NativeExpectedPort;
  readonly #selectionMapping: NativeSelectionMappingPort | undefined;
  readonly #now: () => Date;
  readonly #sessions = new Map<string, SessionState>();
  readonly #active = new Map<string, SessionState>();
  #closed = false;

  constructor(deps: NativeObservationServiceDeps) {
    this.#ackStore = deps.ackStore;
    this.#expected = deps.expected;
    this.#selectionMapping = deps.selectionMapping;
    this.#now = deps.now ?? (() => new Date());
  }

  /* the NativeContextPort face ------------------------------------------------------ */

  async read(projectId: string): Promise<NativeContextFacts> {
    const session = this.#active.get(projectId);
    if (session === undefined || session.closed || this.#closed) {
      return { selection: null, selection_version: 0, ack: null, sync: 'unknown', active_bridge_session_id: null };
    }
    return {
      selection: this.#selectionOf(session),
      selection_version: session.selectionVersion,
      ack: session.ack,
      sync: session.ack !== null ? 'loaded' : (session.document !== null ? 'pending' : 'unknown'),
      active_bridge_session_id: session.binding.bridge_session_id,
    };
  }

  /* the NativeObservationPort face --------------------------------------------------- */

  sessionOpened(binding: NativeObservationSessionBinding): void {
    if (this.#closed) return;
    // The most recent explicit open is the project's active session; the old one is
    // void from this moment, and a first observation can never take the active seat.
    const previous = this.#active.get(binding.project_id);
    if (previous !== undefined && previous.binding.bridge_session_id !== binding.bridge_session_id) {
      this.#closeSession(previous, 'SESSION_SUPERSEDED');
    }
    const existing = this.#sessions.get(binding.bridge_session_id);
    if (existing !== undefined) {
      existing.closed = false;
      this.#active.set(binding.project_id, existing);
      return;
    }
    const session: SessionState = {
      binding,
      lastSequence: 0,
      viewId: null,
      documentEpoch: -1,
      document: null,
      hydrationEpoch: 0,
      parts: emptyParts(),
      selection: null,
      selectionVersion: 0,
      mapped: null,
      ack: null,
      closed: false,
    };
    this.#sessions.set(binding.bridge_session_id, session);
    this.#active.set(binding.project_id, session);
  }

  sessionClosed(binding: NativeObservationSessionBinding): void {
    const session = this.#sessions.get(binding.bridge_session_id);
    if (session === undefined) return;
    this.#closeSession(session, 'SESSION_CLOSED');
  }

  async observe(binding: NativeObservationSessionBinding, envelope: NativeObservationEnvelope): Promise<NativeObservationOutcome> {
    const session = this.#sessions.get(binding.bridge_session_id);
    if (this.#closed) return { accepted: false, reason: 'SERVICE_CLOSED', sequence: 0, ack: null };
    if (session === undefined || session.closed || session.binding !== binding) {
      return { accepted: false, reason: 'SESSION_UNKNOWN', sequence: 0, ack: null };
    }
    if (this.#active.get(binding.project_id) !== session) {
      return { accepted: false, reason: 'SESSION_SUPERSEDED', sequence: session.lastSequence, ack: null };
    }
    const shell = validateNativeObservationEnvelope(envelope);
    if (!shell.ok) return { accepted: false, reason: shell.reason, sequence: session.lastSequence, ack: null };
    // The latest sequence is recorded before anything is verified. A callback that
    // arrives late can therefore never re-green a session that has already moved on.
    if (shell.value.sequence <= session.lastSequence) {
      return { accepted: false, reason: 'SEQUENCE_NOT_MONOTONIC', sequence: session.lastSequence, ack: null };
    }
    session.lastSequence = shell.value.sequence;
    if (!this.#bindingCurrent(session)) {
      this.#closeSession(session, 'SESSION_STALE');
      return { accepted: false, reason: 'SESSION_STALE', sequence: session.lastSequence, ack: null };
    }

    if (shell.value.event_kind === 'document') {
      return this.#onDocument(session, shell.value.event, shell.value.sequence);
    }
    if (shell.value.event_kind === 'hydration') {
      return this.#onHydration(session, shell.value.event, shell.value.sequence);
    }
    return this.#onSelection(session, shell.value.event, shell.value.sequence);
  }

  /** Stop the ingress before the database is closed. */
  close(): void {
    this.#closed = true;
    for (const session of this.#sessions.values()) {
      session.closed = true;
      session.ack = null;
      session.parts = emptyParts();
      session.document = null;
      session.mapped = null;
    }
    this.#sessions.clear();
    this.#active.clear();
    this.#expected.close();
  }

  /* the three event handlers --------------------------------------------------------- */

  async #onDocument(session: SessionState, event: unknown, sequence: number): Promise<NativeObservationOutcome> {
    const check = validateNativeDocumentObservation(event);
    if (!check.ok) {
      this.#invalidateParts(session, 'failed');
      return { accepted: false, reason: check.reason, sequence, ack: null };
    }
    const document = check.value;
    if (document.project_id !== session.binding.native_project_id) {
      return { accepted: false, reason: 'DOCUMENT_PROJECT_MISMATCH', sequence, ack: null };
    }
    // A new view voids the old profile: the parts, the selection and the proof of the
    // previous view never carry over.
    if (session.viewId !== null && session.viewId !== document.editor_view_id) {
      this.#resetProfile(session);
    }
    session.viewId = document.editor_view_id;
    if (document.document_epoch < session.documentEpoch) {
      return { accepted: false, reason: 'DOCUMENT_EPOCH_STALE', sequence, ack: null };
    }
    if (session.hydrationEpoch > 0 && document.document_epoch > session.hydrationEpoch) {
      // The document moved past the hydration that was already accepted: those parts
      // describe an older document and cannot be kept.
      this.#invalidateParts(session, 'pending');
    }
    session.documentEpoch = document.document_epoch;
    if (document.kind === 'invalidated') {
      session.document = null;
      this.#invalidateParts(session, 'pending');
      return { accepted: false, reason: 'DOCUMENT_INVALIDATED', sequence, ack: null };
    }
    session.document = {
      kind: 'document_dom_committed',
      native_rev: document.native_rev,
      film_sha256: document.film_sha256,
      utf8_byte_length: document.utf8_byte_length,
    };
    const ack = await this.#acknowledge(session, sequence);
    return { accepted: true, reason: 'DOCUMENT_ACCEPTED', sequence, ack };
  }

  async #onHydration(session: SessionState, event: unknown, sequence: number): Promise<NativeObservationOutcome> {
    const check = validateNativeHydrationObservation(event);
    if (!check.ok) {
      this.#invalidateParts(session, 'failed');
      return { accepted: false, reason: check.reason, sequence, ack: null };
    }
    const hydration = check.value;
    if (hydration.project_id !== session.binding.native_project_id) {
      return { accepted: false, reason: 'HYDRATION_PROJECT_MISMATCH', sequence, ack: null };
    }
    if (session.viewId !== null && session.viewId !== hydration.editor_view_id) {
      return { accepted: false, reason: 'HYDRATION_VIEW_MISMATCH', sequence, ack: null };
    }
    if (session.documentEpoch >= 0 && session.documentEpoch !== hydration.document_epoch) {
      return { accepted: false, reason: 'HYDRATION_DOCUMENT_EPOCH_MISMATCH', sequence, ack: null };
    }
    if (hydration.hydration_epoch <= session.hydrationEpoch) {
      return { accepted: false, reason: 'HYDRATION_EPOCH_NOT_MONOTONIC', sequence, ack: null };
    }
    session.hydrationEpoch = hydration.hydration_epoch;
    if (session.documentEpoch < 0) session.documentEpoch = hydration.document_epoch;
    session.parts = { ...hydration.parts };
    const ack = await this.#acknowledge(session, sequence);
    return { accepted: true, reason: 'HYDRATION_ACCEPTED', sequence, ack };
  }

  async #onSelection(session: SessionState, event: unknown, sequence: number): Promise<NativeObservationOutcome> {
    const check = validateNativeSelectionObservation(event);
    if (!check.ok) return { accepted: false, reason: check.reason, sequence, ack: null };
    const selection = check.value;
    if (selection.projectId !== session.binding.native_project_id) {
      return { accepted: false, reason: 'SELECTION_PROJECT_MISMATCH', sequence, ack: null };
    }
    const mapping = this.#selectionMapping;
    const mapped = mapping === undefined
      ? null
      : await mapping.mapSelection({ binding: session.binding, selection });
    // The mapping is an await: the session, the sequence and the epochs are re-checked
    // before anything is kept.
    if (!this.#stillCurrent(session, sequence)) {
      return { accepted: false, reason: 'SELECTION_SUPERSEDED', sequence, ack: null };
    }
    session.selection = selection;
    // The version is Host-owned and it moves whenever the editor's selection moves, so
    // an acknowledgement written before this can never match the current selection.
    session.selectionVersion += 1;
    session.mapped = mapped;
    if (mapped === null) {
      // The selection is known to have changed, but it cannot be mapped onto the
      // committed source: the old acknowledgement is void and no new one is written.
      session.ack = null;
      return { accepted: false, reason: 'SELECTION_NOT_MAPPABLE', sequence, ack: null };
    }
    const ack = await this.#acknowledge(session, sequence);
    return { accepted: true, reason: 'SELECTION_ACCEPTED', sequence, ack };
  }

  /* the acknowledgement -------------------------------------------------------------- */

  /**
   * The one place an acknowledgement is written.
   *
   * It is written only when the profile is complete, the expected side agrees, and the
   * final synchronous boundary still holds. Every `await` is followed by a re-check.
   */
  async #acknowledge(session: SessionState, sequence: number): Promise<NativeAck | null> {
    if (!this.#profileComplete(session)) return null;
    const binding = this.#expectedBinding(session);
    let proof: NativeExpectedProof;
    try {
      proof = await this.#expected.prove(binding);
    } catch {
      return null;
    }
    try {
      if (!this.#stillCurrent(session, sequence)) return null;
      let projection: NativeExpectedProjection;
      try {
        projection = this.#expected.assertCurrent(binding, proof);
      } catch {
        // The final guard refused: the closure moved, the proof is foreign or released.
        // No acknowledgement is written, and the event itself stays accepted.
        return null;
      }
      if (!this.#agrees(session, projection)) return null;
      if (!this.#stillCurrent(session, sequence)) return null;
      const current = this.#ackStore.currentState(session.binding.project_id);
      if (current === null) return null;
      if (current.recovery_gate) return null;
      if (current.revision !== session.binding.revision) return null;
      if (current.snapshot_id !== session.binding.snapshot_id) return null;
      if (current.source_digest !== session.binding.source_digest) return null;
      if (current.control_revision !== this.#controlRevisionOf(session)) return null;
      const ack: NativeAck = {
        project_id: session.binding.project_id,
        bridge_session_id: session.binding.bridge_session_id,
        instance_generation: session.binding.instance_generation,
        loaded_project_revision: session.binding.revision,
        loaded_snapshot_id: session.binding.snapshot_id,
        source_digest: session.binding.source_digest,
        selection_version: session.selectionVersion,
        observed_at: this.#now().toISOString(),
      };
      // The final guard runs again, immediately before the insert, with no `await` in
      // between: the closure and every retained file must still be exactly what the
      // proof was made against at the very moment the acknowledgement is written.
      try {
        this.#expected.assertCurrent(binding, proof);
      } catch {
        return null;
      }
      await this.#ackStore.record({
        project_id: ack.project_id,
        bridge_session_id: ack.bridge_session_id,
        loaded_revision: ack.loaded_project_revision,
        loaded_snapshot_id: ack.loaded_snapshot_id,
        source_digest: ack.source_digest,
      });
      if (!this.#stillCurrent(session, sequence)) return null;
      session.ack = ack;
      return ack;
    } finally {
      this.#expected.release(proof);
    }
  }

  /** Whether the editor's report covers every part, from an acceptable origin. */
  #profileComplete(session: SessionState): boolean {
    if (session.document === null) return false;
    if (session.mapped === null) return false;
    for (const kind of ['settings', 'subtitle_style', 'captions', 'markers'] as const) {
      const part = session.parts[kind];
      if (part.state !== 'hydrated' && part.state !== 'absent_default') return false;
      if (part.origin === 'browser_preference') return false;
      if (part.effective_sha256 === null) return false;
    }
    return true;
  }

  /**
   * Whether the editor's report agrees with the independently computed expectation.
   *
   * A matching hash on its own is not enough: the film bytes, the native revision and
   * every part's own digest and state must agree. An unsupported expectation never
   * agrees.
   */
  #agrees(session: SessionState, projection: NativeExpectedProjection): boolean {
    const document = session.document;
    if (document === null) return false;
    if (projection.film_sha256 !== document.film_sha256) return false;
    if (projection.film_bytes !== document.utf8_byte_length) return false;
    if (projection.native_rev !== document.native_rev) return false;
    for (const kind of ['settings', 'subtitle_style', 'captions', 'markers'] as const) {
      const observed = session.parts[kind];
      const expected: NativeExpectedPart = projection.parts[kind];
      if (expected.state === 'unsupported') return false;
      if (expected.effective_sha256 === null) return false;
      if (observed.state !== expected.state) return false;
      if (observed.effective_sha256 !== expected.effective_sha256) return false;
    }
    return true;
  }

  /* the session helpers -------------------------------------------------------------- */

  #expectedBinding(session: SessionState): NativeExpectedBinding {
    const binding = session.binding;
    return {
      project_id: binding.project_id,
      native_project_id: binding.native_project_id,
      revision: binding.revision,
      snapshot_id: binding.snapshot_id,
      source_digest: binding.source_digest,
      instance_generation: binding.instance_generation,
      selection_version: session.selectionVersion,
      workspace: binding.workspace,
      isCurrent: binding.isCurrent,
    };
  }

  #controlRevisionOf(session: SessionState): number {
    const current = this.#ackStore.currentState(session.binding.project_id);
    return current === null ? -1 : current.control_revision;
  }

  /** The session is still the active one and its own binding is still live. */
  #bindingCurrent(session: SessionState): boolean {
    if (this.#closed || session.closed) return false;
    if (this.#active.get(session.binding.project_id) !== session) return false;
    try {
      return session.binding.isCurrent() === true;
    } catch {
      return false;
    }
  }

  /** The session is still current *and* nothing newer arrived while we waited. */
  #stillCurrent(session: SessionState, sequence: number): boolean {
    if (!this.#bindingCurrent(session)) return false;
    return session.lastSequence === sequence;
  }

  #selectionOf(session: SessionState): Selection | null {
    const mapped = session.mapped;
    if (mapped === null) return null;
    return {
      selection_id: `sel_${session.selectionVersion}`,
      selection_version: session.selectionVersion,
      project_revision: session.binding.revision,
      shot_ids: [...mapped.shot_ids],
      start_frame: mapped.start_frame,
      end_frame_exclusive: mapped.end_frame_exclusive,
    };
  }

  /** A new view, a new document or a closed session void every part. */
  #resetProfile(session: SessionState): void {
    session.documentEpoch = -1;
    session.document = null;
    session.hydrationEpoch = 0;
    session.parts = emptyParts();
    session.selection = null;
    session.mapped = null;
    session.ack = null;
  }

  #invalidateParts(session: SessionState, state: NativeHydrationPartState): void {
    const parts = emptyParts();
    for (const kind of ['settings', 'subtitle_style', 'captions', 'markers'] as const) {
      parts[kind] = { state, origin: session.parts[kind].origin, effective_sha256: null };
    }
    session.parts = parts;
    session.ack = null;
  }

  #closeSession(session: SessionState, reason: string): void {
    session.closed = true;
    session.ack = null;
    session.parts = emptyParts();
    session.document = null;
    session.mapped = null;
    this.#sessions.delete(session.binding.bridge_session_id);
    if (this.#active.get(session.binding.project_id) === session) {
      this.#active.delete(session.binding.project_id);
    }
    void reason;
  }
}
