import type {
  Brief,
  Script,
  Storyboard,
} from "../../contracts/agent-driven-types.js";

/**
 * Read-only views of the creative objects.
 *
 * The views read the frozen DTOs and nothing else. They never fetch, never decide and
 * never claim that something happened because a job says so.
 *
 * The native-sync indicator moved into its own module — it is shown next to the
 * prepared preview, where a wrong claim would be read as "the prepared media is on
 * screen". It is re-exported here so the original import path keeps working, and there
 * is still exactly one implementation of its rules.
 */
export { NativeSyncIndicator, nativeSyncState } from "./NativeSyncIndicator.js";
export type { NativeSyncState } from "./NativeSyncIndicator.js";

/**
 * One prepared text or JSON product, shown as text.
 *
 * A subtitle track or a JSON product is *text*, and it is shown item by item as text:
 * the content is escaped by the renderer and never handed to the browser as markup, so
 * a prepared product can never become a script. A product that claims to be HTML is
 * refused outright rather than shown.
 */
export function PreparedTextView(props: {
  /** The content type the descriptor reported. */
  readonly contentType: string;
  /** The bytes, already decoded as UTF-8 text. */
  readonly text: string;
}) {
  const contentType = props.contentType.toLowerCase();
  if (contentType.includes("html")) {
    return (
      <p className="nl-muted" role="alert" data-nl-prepared-text="refused">
        这一部分声明为 HTML，已拒绝展示：这里只显示安全的文本内容。
      </p>
    );
  }
  const isJson = contentType.includes("json");
  let body = props.text;
  if (isJson) {
    try {
      body = JSON.stringify(JSON.parse(props.text) as unknown, null, 2);
    } catch {
      body = props.text;
    }
  }
  return (
    <pre className="nl-prepared-text" data-nl-prepared-text={isJson ? "json" : "text"}>{body}</pre>
  );
}

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
