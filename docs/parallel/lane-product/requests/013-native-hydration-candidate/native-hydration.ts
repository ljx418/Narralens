/** Managed observation metadata only. Original native state/reducers remain the authority. */
import * as React from 'react';
import { studioHost, type NarralensHydrationPart as Part, type NarralensHydrationOrigin as Origin,
  type NarralensHydrationPartState as PartState, type NarralensHydrationState } from './host';
import type { ProjectSettings } from '../api';
import type { SubtitleStyle, FilmCaptions } from './subtitles';
import type { Marker } from './markers';

/** Frozen managed effective-value shapes; original parsers still define native field semantics. */
export interface SettingsHydrationValue {
  settings: ProjectSettings;
  resolved_fps: number;
  fps_source: 'project' | 'footage_or_default';
  track_names: Array<{ doc_index: number; name: string }>;
  track_heights: Array<{ lane: string; doc_index: number | null; index: number; height: number }>;
}
export interface HydrationEffectiveValues {
  settings: SettingsHydrationValue;
  subtitle_style: SubtitleStyle;
  captions: Pick<FilmCaptions, 'cues' | 'sourceLanguage' | 'languages' | 'untranscribed'>;
  markers: { placed: Array<{ marker: Marker; ms: number; clip_id: string | null }> };
}
export type HydrationSnapshots = { [P in Part]: HydrationSnapshot<HydrationEffectiveValues[P]> | null };

export interface NativeHydrationScope {
  readonly projectId: string;
  readonly editorViewId: string;
  current(): { epoch: number; valid: boolean };
}
export interface NativeReadTicket { readonly sequence: number; readonly documentEpoch: number }
export interface NativePartObserver {
  begin(): NativeReadTicket;
  success(ticket: NativeReadTicket, origin?: Origin): void;
  failed(ticket: NativeReadTicket): void;
  dirty(): void;
  pending(): void;
}
export interface HydrationSnapshot<T = unknown> {
  /** The actual native state used as this read's input to the effective projection. */
  readonly basis: unknown;
  /** Exact part-specific projection of actual consuming state, documented by the managed contract. */
  readonly value: T;
  /** Read-only verification. It must never set/reseed the native state or start a producer. */
  read(): Promise<{ basis: unknown; origin: Origin; state: 'hydrated' | 'absent_default' | 'unsupported' }>;
}
type NativeOutcome = 'pending' | 'success' | 'failed' | 'dirty';
type Receipt = { sequence: number; version: number; outcome: NativeOutcome; origin: Origin; dirty: boolean; nativeCurrent: boolean };
const PARTS: readonly Part[] = ['settings', 'subtitle_style', 'captions', 'markers'];

/** Sorted object keys, array order retained. Undefined object members are omitted; non-JSON values fail closed. */
export function hydrationCanonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(hydrationCanonicalJson).join(',')}]`;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort()
      .map((key) => `${JSON.stringify(key)}:${hydrationCanonicalJson(record[key])}`).join(',')}}`;
  }
  throw new Error('UNSUPPORTED_HYDRATION_VALUE');
}

class NativeHydrationObserver {
  readonly enabled = studioHost?.narralensHydration?.version === 1;
  readonly parts: Record<Part, NativePartObserver>;
  private active = true;
  private round = 0;
  private eventEpoch = 0;
  private root: HTMLElement | null = null;
  private receipts = Object.fromEntries(PARTS.map((part) => [part,
    { sequence: 0, version: 0, outcome: 'pending', origin: 'project', dirty: false, nativeCurrent: false }])) as Record<Part, Receipt>;

  constructor(readonly scope: NativeHydrationScope, private changed: () => void) {
    this.parts = Object.fromEntries(PARTS.map((part) => [part, {
      begin: () => {
        const record = this.receipts[part]; record.sequence++; record.version++;
        record.outcome = record.dirty ? 'dirty' : 'pending'; record.nativeCurrent = false; this.touch();
        return { sequence: record.sequence, documentEpoch: scope.current().epoch };
      },
      success: (ticket: NativeReadTicket, origin: Origin = 'project') => {
        const record = this.receipts[part];
        if (!this.active || ticket.sequence !== record.sequence) return;
        // Even same-epoch native GET success is not a proof. A fresh fenced read below must match actual state.
        record.nativeCurrent = ticket.documentEpoch === scope.current().epoch && scope.current().valid;
        record.outcome = record.dirty ? 'dirty' : 'success'; record.origin = origin; record.version++; this.touch();
      },
      failed: (ticket: NativeReadTicket) => {
        const record = this.receipts[part];
        if (!this.active || ticket.sequence !== record.sequence) return;
        record.outcome = record.dirty ? 'dirty' : 'failed'; record.version++; this.touch();
      },
      dirty: () => {
        const record = this.receipts[part]; record.dirty = true; record.outcome = 'dirty';
        record.sequence++; record.version++; this.touch();
      },
      pending: () => {
        const record = this.receipts[part]; record.sequence++; record.version++;
        record.outcome = record.dirty ? 'dirty' : 'pending'; record.nativeCurrent = false; this.touch();
      },
    }])) as Record<Part, NativePartObserver>;
  }
  mount() { this.active = true; this.touch(); }
  unmount() { this.round++; if (this.active) this.publish(this.pendingStates()); this.active = false; }
  invalidateChecks() {
    this.round++;
    if (this.enabled && this.active && this.root?.isConnected) this.publish(this.pendingStates());
    if (this.enabled && this.active) this.changed();
  }
  private touch() { this.invalidateChecks(); }
  private pendingStates(): Record<Part, PartState> {
    return Object.fromEntries(PARTS.map((part) => {
      const record = this.receipts[part];
      return [part, { state: record.outcome === 'success' ? record.nativeCurrent ? 'pending' : 'unsupported' : record.outcome,
        origin: record.origin, effective_sha256: null }];
    })) as Record<Part, PartState>;
  }
  private publish(parts: Record<Part, PartState>): boolean {
    if (!this.enabled || !this.active) return false;
    const event: NarralensHydrationState = { project_id: this.scope.projectId, editor_view_id: this.scope.editorViewId,
      document_epoch: this.scope.current().epoch, hydration_epoch: ++this.eventEpoch, parts };
    try {
      const receiver = studioHost?.narralensHydration;
      if (receiver?.version !== 1 || typeof receiver.onState !== 'function') return false;
      receiver.onState(event); return true;
    } catch { return false; /* A receiver failure invalidates proof, never native editing. */ }
  }
  /** Called only by ProjectView's real layout commit, not by a GET or a queue Promise. */
  observe(root: HTMLElement, snapshots: HydrationSnapshots): () => void {
    this.root = root;
    const scope = this.scope.current();
    const round = ++this.round;
    if (!this.enabled || !this.active) return () => {};
    if (!this.publish(this.pendingStates())) {
      if (this.round === round) this.round++;
      return () => {}; // No GET/hash work or same-round recovery after failed pending delivery.
    }
    if (!scope.valid) return () => { if (this.round === round) this.round++; };
    const current = () => this.active && this.round === round && root.isConnected && this.root === root
      && this.scope.current().valid && this.scope.current().epoch === scope.epoch;
    void Promise.all(PARTS.map(async (part): Promise<[Part, PartState]> => {
      const record = this.receipts[part]; const version = record.version; const snapshot = snapshots[part];
      const outcome = record.outcome; const origin = record.origin;
      const empty = (state: PartState['state'], from = origin): [Part, PartState] => [part, { state, origin: from, effective_sha256: null }];
      if (outcome !== 'success') return empty(outcome);
      if (!snapshot) return empty('pending');
      try {
        const basis = hydrationCanonicalJson(snapshot.basis);
        const value = hydrationCanonicalJson({ format: 'narralens.native-hydration-effective@1', part, value: snapshot.value });
        // Verification starts after the DOM commit and captures this request's view/epoch/part version.
        const requestEpoch = this.scope.current().epoch;
        const result = await snapshot.read();
        if (!current() || requestEpoch !== scope.epoch || this.receipts[part].version !== version) return empty('unsupported');
        if (result.origin !== origin || result.origin === 'browser_preference' || result.state === 'unsupported'
          || hydrationCanonicalJson(result.basis) !== basis || hydrationCanonicalJson(snapshot.basis) !== basis) return empty('unsupported');
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
        if (!current() || this.receipts[part].version !== version) return empty('unsupported');
        return [part, { state: result.state, origin: result.origin,
          effective_sha256: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('') }];
      } catch { return empty('failed'); }
    })).then((states) => {
      if (current() && !this.publish(Object.fromEntries(states) as Record<Part, PartState>)) {
        if (this.round === round) this.round++; // A failed final delivery cannot revive this round.
      }
    }).catch(() => { /* A rejected verification never becomes success. */ });
    return () => { if (this.round === round) this.round++; };
  }
}

export function useNativeHydration(scope: NativeHydrationScope) {
  const [revision, setRevision] = React.useState(0);
  const observer = React.useRef<NativeHydrationObserver | null>(null);
  if (!observer.current) observer.current = new NativeHydrationObserver(scope, () => setRevision((value) => value + 1));
  const current = observer.current;
  React.useEffect(() => { current.mount(); return () => current.unmount(); }, [current]);
  return { observer: current, revision };
}
