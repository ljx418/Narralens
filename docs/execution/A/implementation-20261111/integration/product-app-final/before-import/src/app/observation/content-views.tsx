import type {
  Brief,
  Context,
  Script,
  Storyboard,
} from "../../contracts/agent-driven-types.js";

/**
 * Read-only views of the creative objects, and the native-sync indicator.
 *
 * The views read the frozen DTOs and nothing else. They never fetch, never decide and
 * never claim that something happened because a job says so.
 */

/** The brief: the topic, the audience, the length and the structured content brief. */
export function BriefView(props: { readonly brief: Brief | null }) {
  const brief = props.brief;
  if (brief === null) {
    return <p className="nl-muted">还没有简报。</p>;
  }
  return (
    <section className="nl-content-view" aria-label="简报">
      <h3>{brief.topic}</h3>
      <dl className="nl-facts">
        <dt>观众</dt>
        <dd>{brief.audience}</dd>
        <dt>时长</dt>
        <dd>{brief.duration_seconds} 秒</dd>
        <dt>语气</dt>
        <dd>{brief.tone}</dd>
        <dt>旁白素材</dt>
        <dd>{brief.narration_asset_id ?? "未指定"}</dd>
        <dt>概念</dt>
        <dd>{brief.concept_summary}</dd>
        <dt>本地素材</dt>
        <dd>{brief.local_asset_ids.length === 0 ? "无" : brief.local_asset_ids.join("、")}</dd>
        <dt>素材策略</dt>
        <dd>
          {brief.content_brief.material_strategy.mode}
          {brief.content_brief.material_strategy.selection_notes.length === 0
            ? ""
            : ` · ${brief.content_brief.material_strategy.selection_notes}`}
        </dd>
        <dt>风格</dt>
        <dd>
          {brief.content_brief.style.visual_direction} / {brief.content_brief.style.voice_direction} /{" "}
          {brief.content_brief.style.subtitle_direction}
        </dd>
      </dl>
    </section>
  );
}

/** The script, paragraph by paragraph. */
export function ScriptView(props: { readonly script: Script | null }) {
  const script = props.script;
  if (script === null) {
    return <p className="nl-muted">还没有脚本。</p>;
  }
  return (
    <section className="nl-content-view" aria-label="脚本">
      <ol className="nl-paragraphs">
        {script.paragraphs.map((paragraph) => (
          <li key={paragraph.paragraph_id}>
            <span className="nl-muted">{paragraph.paragraph_id}</span>
            <p>{paragraph.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The storyboard, shot by shot. */
export function StoryboardView(props: { readonly storyboard: Storyboard | null }) {
  const storyboard = props.storyboard;
  if (storyboard === null) {
    return <p className="nl-muted">还没有分镜。</p>;
  }
  return (
    <section className="nl-content-view" aria-label="分镜">
      <p className="nl-muted">帧率 {storyboard.fps}</p>
      <ol className="nl-shots">
        {storyboard.shots.map((shot) => (
          <li key={shot.shot_id}>
            <strong>{shot.shot_id}</strong>
            <span className="nl-muted"> {shot.duration_frames} 帧</span>
            <p>{shot.caption}</p>
            <p className="nl-muted">{shot.concept_text}</p>
            <p className="nl-muted">
              {shot.asset_id ?? "无素材"} · {shot.paragraph_id}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

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
 * The `native_sync` flag alone is never enough. It says what the Host believes; only the
 * acknowledgement says what the editor actually loaded.
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
