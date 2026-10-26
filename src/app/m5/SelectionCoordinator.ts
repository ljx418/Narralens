import type { SelectionContext, SelectionStore } from "./stores.js";
import type { WorkbenchClipV1, WorkbenchProjectionV1 } from "../../contracts/wave3-types.js";

/**
 * `SelectionCoordinator` (Wave 3 `01` §5, `04` §5).
 *
 * It is the Refine workspace's service layer and the **only** writer to the
 * `SelectionStore`. Everything that changes the selection — the chapter list, the shot
 * rail, the semantic search, the native timeline, the player — goes through it, so
 * there is one place where a selection is decided and one place where a loop between two
 * components can be broken.
 *
 * Two rules it enforces:
 *
 * - **One snapshot.** A selection belongs to the snapshot it was made in. A selection
 *   from an older snapshot is not carried over silently.
 * - **A revision change relocates or asks.** When the revision moves, the selection is
 *   re-located onto the same clip when that clip still exists and the range is still
 *   legal; otherwise the draft is kept and the operator is asked to choose again. A
 *   pointer that silently jumps to frame zero is a lie about what is selected.
 */
export class SelectionCoordinator {
  readonly #selection: SelectionStore;
  #relocating = false;

  constructor(selection: SelectionStore) {
    this.#selection = selection;
  }

  get current(): SelectionContext | null { return this.#selection.value; }

  /**
   * Select a clip of the current projection.
   *
   * The range is clamped to the clip: a half-open range that leaves the clip is not a
   * selection of that clip.
   */
  selectClip(projection: WorkbenchProjectionV1, clipId: string,
    range?: { start_frame: number; end_frame_exclusive: number }): SelectionContext | null {
    const clip = projection.clips.find((candidate) => candidate.clip_id === clipId);
    if (clip === undefined) return null;
    const start = Math.max(clip.start_frame, range?.start_frame ?? clip.start_frame);
    const end = Math.min(clip.end_frame_exclusive, range?.end_frame_exclusive ?? clip.end_frame_exclusive);
    const next: SelectionContext = {
      project_id: projection.project_id,
      snapshot_id: projection.active_snapshot_id,
      clip_id: clip.clip_id,
      source_shot_id: clip.source_shot_id,
      range: { start_frame: start, end_frame_exclusive: Math.max(start, end) },
    };
    this.#write(next);
    return next;
  }

  /**
   * The native Studio's selection, in frames.
   *
   * The Studio speaks seconds; the conversion happens here, at the boundary, with the
   * projection's own rational fps — never in the component and never with a float
   * accumulation.
   */
  selectFromStudio(projection: WorkbenchProjectionV1, input: {
    clipId: string | null; startFrame: number; endFrameExclusive: number;
  }): SelectionContext | null {
    if (input.clipId === null || input.clipId === "") return null;
    return this.selectClip(projection, input.clipId, {
      start_frame: input.startFrame, end_frame_exclusive: input.endFrameExclusive,
    });
  }

  /**
   * Re-locate the selection after a revision change.
   *
   * Returns true when the selection still means the same thing, and false when the
   * operator has to choose again. The draft is never thrown away either way.
   */
  relocate(projection: WorkbenchProjectionV1): boolean {
    const current = this.#selection.value;
    if (current === null) return true;
    if (current.project_id !== projection.project_id) return false;
    const clip = projection.clips.find((candidate) => candidate.clip_id === current.clip_id);
    if (clip === undefined) return false;
    const start = Math.max(clip.start_frame, current.range.start_frame);
    const end = Math.min(clip.end_frame_exclusive, current.range.end_frame_exclusive);
    if (end <= start) return false;
    if (current.snapshot_id === projection.active_snapshot_id
      && current.range.start_frame === start && current.range.end_frame_exclusive === end) {
      return true;
    }
    this.#write({
      ...current,
      snapshot_id: projection.active_snapshot_id,
      source_shot_id: clip.source_shot_id,
      range: { start_frame: start, end_frame_exclusive: end },
    });
    return true;
  }

  /** Clear the selection, e.g. when the project is closed. */
  clear(): void {
    this.#write(null);
  }

  /**
   * The write, guarded against a loop.
   *
   * A component that reacts to the selection by setting the selection again would spin.
   * The guard is a flag around the write, not a timer: it is exact, and it cannot leave a
   * selection half-written.
   */
  #write(next: SelectionContext | null): void {
    if (this.#relocating) return;
    this.#relocating = true;
    try { this.#selection.set(next); }
    finally { this.#relocating = false; }
  }
}

/** The clip a selection names, in the projection it was made in. */
export function clipOf(projection: WorkbenchProjectionV1,
  selection: SelectionContext | null): WorkbenchClipV1 | undefined {
  if (selection === null) return undefined;
  return projection.clips.find((clip) => clip.clip_id === selection.clip_id);
}
