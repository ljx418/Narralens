import { HttpError } from "../api-error.js";
import type { HistoryStore } from "./history-store.js";
import type { ProjectResolver } from "../projects/project-resolver.js";

/**
 * `HistoryCommandTranslator` (M4C gate §2, §3.4).
 *
 * It turns a *command* — restore, undo, redo — into a **typed intent**: a target snapshot
 * id and nothing else. It never approves, never commits and never names a revision.
 *
 * That is the whole point of the module. The native history entry points are buttons in a
 * studio; a button that "undoes" must not be able to move the active pointer, must not be
 * able to skip the authorization, and must not be able to invent a revision. A translator
 * that produced anything stronger would be a bypass, and the only thing it is allowed to
 * produce is the name of a snapshot that then has to go through an impact and an explicit
 * approval like any other write.
 *
 * The three commands have three different answers:
 *
 * - **restore** names its target explicitly.
 * - **undo** names the nearest committed snapshot *below* the current revision.
 * - **redo** names the snapshot that was active before the restore — but only when the
 *   **current commit is itself a committed restore**. After an adoption or an edit has been
 *   committed on top of the restore, there is no redo: the current commit is not a restore,
 *   and ADR-W2.0-006 §D-08 says the redo is derived from the current commit's immutable
 *   fact. There is no redo stack: a stack would be a second timeline, and this architecture
 *   has exactly one.
 */

export type HistoryCommand = "restore" | "undo" | "redo";

export interface HistoryIntentV1 {
  readonly format: "narralens.history-intent@1.0";
  readonly op: "restore_snapshot";
  readonly target_snapshot_id: string;
  /** Which command produced this intent. */
  readonly source: HistoryCommand;
  /** The revision the project is at now. The intent names no revision of its own. */
  readonly current_revision: number;
}

export interface HistoryCommandTranslatorDeps {
  readonly history: HistoryStore;
  readonly resolver: ProjectResolver;
}

export class HistoryCommandTranslator {
  readonly #deps: HistoryCommandTranslatorDeps;

  constructor(deps: HistoryCommandTranslatorDeps) { this.#deps = deps; }

  async translate(projectId: string, command: HistoryCommand,
    targetSnapshotId?: string): Promise<HistoryIntentV1> {
    const view = await this.#deps.resolver.resolveActivated(projectId);
    if (command === "restore") {
      if (targetSnapshotId === undefined || targetSnapshotId === "") {
        throw new HttpError(422, "INVALID_REQUEST",
          "A restore needs a target snapshot", undefined, projectId);
      }
      return { format: "narralens.history-intent@1.0", op: "restore_snapshot",
        target_snapshot_id: targetSnapshotId, source: "restore", current_revision: view.revision };
    }
    if (command === "undo") {
      const target = this.#deps.history.undoTarget(projectId, view.revision);
      if (target === undefined) {
        throw new HttpError(422, "INVALID_REQUEST",
          "There is no earlier snapshot to undo to", undefined, projectId);
      }
      return { format: "narralens.history-intent@1.0", op: "restore_snapshot",
        target_snapshot_id: target.snapshot_id, source: "undo", current_revision: view.revision };
    }
    if (command === "redo") {
      const target = this.#deps.history.redoTarget(projectId);
      if (target === undefined) {
        throw new HttpError(422, "INVALID_REQUEST",
          "There is no later snapshot to redo to", undefined, projectId);
      }
      return { format: "narralens.history-intent@1.0", op: "restore_snapshot",
        target_snapshot_id: target.snapshot_id, source: "redo", current_revision: view.revision };
    }
    throw new HttpError(422, "INVALID_REQUEST",
      "Only restore, undo and redo are history commands the Host translates",
      { command }, projectId);
  }
}
