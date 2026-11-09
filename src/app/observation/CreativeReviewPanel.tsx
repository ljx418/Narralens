import type {
  Brief,
  ReviewPackage,
  ReviewPart,
  Script,
  Storyboard,
} from "../../contracts/agent-driven-types.js";
import { BriefView, ScriptView, StoryboardView } from "./content-views.js";

/**
 * The creative review panel.
 *
 * It shows one review package and the creative objects it belongs to, and it offers the
 * decisions the package allows. Three rules shape it:
 *
 * - **The chapter bundle is one package.** The preview, the narration, the subtitles, the
 *   shot summary and the rights/quality evidence are parts of the same package and the
 *   same version. The panel never presents them as separate things to accept.
 * - **The cover is independent.** A cover package is its own review with its own
 *   decision. It is never folded into the chapter bundle.
 * - **Closing is not deciding.** The close button and the "viewed" state produce no
 *   decision at all. Accepting, asking for changes and rejecting are separate actions,
 *   and only the ones the package allows are offered.
 */

export interface CreativeReviewPanelProps {
  /** The package under review, or `null` when there is nothing to review. */
  readonly package: ReviewPackage | null;
  /** The brief, when it is known. */
  readonly brief?: Brief | null;
  /** The script, when it is known. */
  readonly script?: Script | null;
  /** The storyboard, when it is known. */
  readonly storyboard?: Storyboard | null;
  /** Accept the package. Only offered when the package allows it. */
  readonly onAccept?: () => void;
  /** Ask for changes. Only offered when the package allows it. */
  readonly onRequestChanges?: () => void;
  /** Reject the package. Only offered when the package allows it. */
  readonly onReject?: () => void;
  /** Accept and adopt in one trusted act. Only offered when the package allows it. */
  readonly onAcceptAndAdopt?: () => void;
  /**
   * Opens one part of the package in the host's own player.
   *
   * The panel has no player, no timeline and no clock of its own: the workbench keeps
   * its original player, selection and clock, and the panel only asks the host to show
   * the part there.
   */
  readonly onOpenPart?: (part: ReviewPart) => void;
  /** Close the panel. This produces no decision. */
  readonly onClose?: () => void;
}

const PART_LABEL: Readonly<Record<ReviewPart["kind"], string>> = {
  preview: "画面",
  narration: "旁白",
  subtitles: "字幕",
  shot_summary: "镜头摘要",
  rights_quality: "来源与质量",
};

const KIND_LABEL: Readonly<Record<ReviewPackage["kind"], string>> = {
  sample: "样片",
  first_chapter: "首章",
  chapter_pack: "章节包",
  audio: "音频",
  cover: "封面",
};

export function CreativeReviewPanel(props: CreativeReviewPanelProps) {
  const packageDocument = props.package;
  if (packageDocument === null) {
    return (
      <section className="nl-review" aria-label="创作审阅">
        <p className="nl-muted">当前没有待审阅的内容。</p>
        {props.onClose === undefined ? null : (
          <button type="button" onClick={props.onClose}>关闭</button>
        )}
      </section>
    );
  }

  const allowed = new Set(packageDocument.allowed_choices);
  const canAdopt = allowed.has("accept_and_adopt") && packageDocument.impact !== null;
  const isCover = packageDocument.kind === "cover";

  return (
    <section className="nl-review" aria-label="创作审阅">
      <header className="nl-review-head">
        <div>
          <span className="nl-result-label">{KIND_LABEL[packageDocument.kind]}</span>
          <h2>{isCover ? "独立封面" : "整章审阅"}</h2>
          <p className="nl-muted">{packageDocument.selection_reason}</p>
        </div>
        {props.onClose === undefined ? null : (
          <button type="button" onClick={props.onClose} aria-label="关闭审阅">关闭</button>
        )}
      </header>

      <div className="nl-review-body">
        <section className="nl-review-bundle" aria-label={isCover ? "封面内容" : "章节内容包"}>
          <h3>{isCover ? "封面内容" : "音画字幕同包"}</h3>
          <ul className="nl-parts">
            {packageDocument.parts.map((part) => (
              <li key={`${part.kind}-${part.artifact_ref.id}`} className="nl-part">
                <span className="nl-part-kind">{PART_LABEL[part.kind]}</span>
                <span className="nl-muted">
                  {part.artifact_ref.id}@{part.artifact_ref.version}
                </span>
                {props.onOpenPart === undefined ? null : (
                  <button type="button" onClick={() => props.onOpenPart?.(part)}>
                    在工作台中查看
                  </button>
                )}
                {part.download_ref === null ? (
                  <span className="nl-muted">尚无可下载文件</span>
                ) : (
                  <a href={part.download_ref}>下载</a>
                )}
              </li>
            ))}
          </ul>
          {isCover ? (
            <p className="nl-muted">封面是独立审阅，不与章节内容合并确认。</p>
          ) : null}
          <p className="nl-muted">
            来源镜头 {packageDocument.source_shot_ids.length === 0
              ? "未记录"
              : packageDocument.source_shot_ids.join("、")}
          </p>
        </section>

        <section className="nl-review-content" aria-label="创作内容">
          <BriefView brief={props.brief ?? null} />
          <ScriptView script={props.script ?? null} />
          <StoryboardView storyboard={props.storyboard ?? null} />
        </section>
      </div>

      <footer className="nl-review-actions">
        <button
          type="button"
          disabled={!allowed.has("accept") || props.onAccept === undefined}
          onClick={() => props.onAccept?.()}
        >
          接受
        </button>
        <button
          type="button"
          disabled={!allowed.has("changes_requested") || props.onRequestChanges === undefined}
          onClick={() => props.onRequestChanges?.()}
        >
          提出修改
        </button>
        <button
          type="button"
          disabled={!allowed.has("reject") || props.onReject === undefined}
          onClick={() => props.onReject?.()}
        >
          拒绝
        </button>
        <button
          type="button"
          className="nl-primary"
          disabled={!canAdopt || props.onAcceptAndAdopt === undefined}
          onClick={() => props.onAcceptAndAdopt?.()}
        >
          确认并采用
        </button>
        <p className="nl-muted">关闭面板不会产生任何决定。</p>
      </footer>
    </section>
  );
}
