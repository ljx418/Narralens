import type { Sha256 } from "../../contracts/engine-types.js";

/**
 * M5's three stores (Wave 3 `01` §5).
 *
 * They are deliberately small, and each one owns exactly one thing:
 *
 * - `SelectionStore` holds **one** selection: the project, the snapshot, the clip, the
 *   read-only source shot, the half-open frame range and the optional script anchor.
 *   There is no second selection anywhere in the app.
 * - `WorkbenchStore` holds the *UI* state: the drafts, the focus, what is expanded and
 *   what the page is showing. It never holds a clip list — a store that could rebuild the
 *   film on its own would be a second timeline.
 * - `PlaybackClock` holds the integer frame. The HTML media element's seconds are a
 *   *projection* of it, never the other way round, so a dropped frame cannot move the
 *   authoritative time.
 */
export interface SelectionContext {
  readonly project_id: string;
  readonly snapshot_id: Sha256;
  readonly clip_id: string;
  readonly source_shot_id: string | null;
  readonly range: { readonly start_frame: number; readonly end_frame_exclusive: number };
  readonly script_anchor?: string;
}

type Listener<T> = (value: T) => void;

/** A tiny observable value. */
export class Store<T> {
  #value: T;
  readonly #listeners = new Set<Listener<T>>();

  constructor(initial: T) {
    this.#value = initial;
  }

  get value(): T { return this.#value; }

  set(next: T): void {
    if (Object.is(next, this.#value)) return;
    this.#value = next;
    for (const listener of [...this.#listeners]) listener(next);
  }

  subscribe(listener: Listener<T>): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }
}

export class SelectionStore extends Store<SelectionContext | null> {
  constructor() { super(null); }
}

export interface WorkbenchUiState {
  /** The operator's own words. A draft, and nothing more. */
  readonly intent: string;
  /** Which proposal the operator is looking at. */
  readonly selectedProposalId: string;
  /** Which panel section is open. */
  readonly expanded: "atlas" | "director" | "locks" | "history";
  /** The focused element's id, so the focus can be restored. */
  readonly focusedId: string | null;
  /** The last error, with the next step the operator can take. */
  readonly error: { readonly code: string; readonly message: string; readonly next: string } | null;
  /** The controlled state word the page is in. */
  readonly phase: "proposal_only" | "bindings_required" | "materializing" | "preview_ready"
    | "approval_required" | "ready_for_adoption" | "adopted" | "stale" | "failed" | "cancelled"
    | "attention";
}

export const INITIAL_WORKBENCH_UI: WorkbenchUiState = {
  intent: "",
  selectedProposalId: "",
  expanded: "atlas",
  focusedId: null,
  error: null,
  phase: "proposal_only",
};

export class WorkbenchStore extends Store<WorkbenchUiState> {
  constructor() { super(INITIAL_WORKBENCH_UI); }

  patch(next: Partial<WorkbenchUiState>): void {
    this.set({ ...this.value, ...next });
  }
}

/**
 * The integer-frame clock.
 *
 * `fps` is a rational, so a frame↔second conversion is exact at the boundary and never
 * accumulates a float error. The clock never moves backwards on its own: a seek to an
 * earlier frame is a *command*, not a drift.
 */
export class PlaybackClock {
  #frame = 0;
  #playing = false;
  readonly #listeners = new Set<(frame: number) => void>();

  constructor(readonly fps: { readonly num: number; readonly den: number }) {}

  get frame(): number { return this.#frame; }
  get playing(): boolean { return this.#playing; }

  /** The seconds the HTML media element should show for the current frame. */
  get seconds(): number { return this.#frame * this.fps.den / this.fps.num; }

  /** The frame a time in seconds names, rounded down: the frame that is on screen. */
  frameFor(seconds: number): number {
    return Math.max(0, Math.floor(seconds * this.fps.num / this.fps.den));
  }

  seek(frame: number): void {
    const next = Math.max(0, Math.floor(frame));
    if (next === this.#frame) return;
    this.#frame = next;
    for (const listener of [...this.#listeners]) listener(next);
  }

  setPlaying(playing: boolean): void { this.#playing = playing; }

  onFrame(listener: (frame: number) => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }
}
