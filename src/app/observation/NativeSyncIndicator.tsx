import type { Context } from "../../contracts/agent-driven-types.js";

/**
 * The native-sync indicator.
 *
 * It says one thing, and it says only what the Host actually proved: whether the
 * editor has loaded *this* version of *this* project. It lives in its own module
 * because the workbench shows it next to the prepared preview, where a wrong claim
 * would be read as "the prepared media is on screen".
 *
 * The rules are unchanged from the original implementation, and there is exactly one
 * implementation of them:
 *
 * - "Loaded" is only ever said when the acknowledgement matches the project's current
 *   revision, snapshot, source digest and selection. A succeeded job or a committed
 *   film is not a native acknowledgement.
 * - The `native_sync` flag alone is never enough. It says what the Host believes; only
 *   the acknowledgement says what the editor actually loaded.
 * - In R1 there is no acknowledgement producer on this path, so the honest answer is
 *   "unknown" or "pending" — never "loaded" inferred from a commit or an accepted gate.
 */

/** The native-sync state the indicator shows. */
export interface NativeSyncState {
  readonly state: "loaded" | "pending" | "unknown";
  readonly reason: string;
}

/**
 * The native-sync state of a project.
 *
 * "Loaded" is only ever said when the context says so *and* the acknowledgement matches
 * the project's current revision, snapshot, source digest and selection. A succeeded job
 * or a committed film is not a native acknowledgement: the editor may still be showing
 * the previous version, and claiming otherwise is the "commit ≠ native loaded" mistake
 * the contract keeps calling out.
 *
 * The `native_sync` flag alone is never enough. It says what the Host believes; only
 * the acknowledgement says what the editor actually loaded.
 */
export function nativeSyncState(context: Context | null): NativeSyncState {
  if (context === null) {
    return { state: "unknown", reason: "尚未读取工程状态。" };
  }
  if (context.native_sync === "unknown") {
    return { state: "unknown", reason: "编辑区状态未知，未收到原生确认。" };
  }
  if (context.native_sync === "pending") {
    return { state: "pending", reason: "工程已提交，等待编辑区确认。" };
  }
  const ack = context.native_ack;
  if (ack === null) {
    return { state: "unknown", reason: "编辑区没有返回确认记录。" };
  }
  if (ack.project_id !== context.project_id) {
    return { state: "unknown", reason: "编辑区确认属于另一工程。" };
  }
  if (ack.loaded_project_revision !== context.project_revision) {
    return {
      state: "unknown",
      reason: "编辑区确认的版本与工程当前版本不同。",
    };
  }
  if (ack.loaded_snapshot_id !== context.snapshot_id) {
    return { state: "unknown", reason: "编辑区确认的快照与工程当前快照不同。" };
  }
  if (ack.source_digest !== context.source_digest) {
    return { state: "unknown", reason: "编辑区确认的内容摘要与工程当前摘要不同。" };
  }
  if (ack.selection_version !== context.selection_version) {
    return { state: "unknown", reason: "编辑区确认的选区与工程当前选区不同。" };
  }
  return { state: "loaded", reason: "编辑区已载入同一版本。" };
}

/** The native-sync indicator. */
export function NativeSyncIndicator(props: { readonly context: Context | null }) {
  const state = nativeSyncState(props.context);
  return (
    <p className={`nl-native-sync nl-native-sync-${state.state}`} role="status" aria-live="polite">
      {state.reason}
    </p>
  );
}
