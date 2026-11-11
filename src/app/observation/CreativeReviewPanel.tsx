import type {
  Brief,
  ReviewDecision,
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
 * decisions the package allows. Four rules shape it:
 *
 * - **The chapter bundle is one package.** The preview, the narration, the subtitles, the
 *   shot summary and the rights/quality evidence are parts of the same package and the
 *   same version. The panel never presents them as separate things to accept.
 * - **The cover is independent.** A cover package is its own review with its own
 *   decision. It is never folded into the chapter bundle.
 * - **Closing is not deciding.** The close button and the "viewed" state produce no
 *   decision at all. Accepting, asking for changes and rejecting are separate actions,
 *   and only the ones the package allows are offered.
 * - **A decision is not a commit and not an acknowledgement.** When the Host records a
 *   decision, the panel says the decision was recorded. The adoption is a separate fact
 *   with its own state, and the panel never turns "accepted" into "adopted" or
 *   "loaded".
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
  /**
   * The decision the Host recorded, when there is one.
   *
   * It is the record of a decision, not of a commit: the panel shows it as such and
   * never as an adoption.
   */
  readonly decision?: ReviewDecision | null;
  /** What is known about the adoption a decision may have started. */
  readonly adoption?: ReviewAdoptionState | null;
  /**
   * The project's own committed revision.
   *
   * It is shown on its own line, because it is its own fact. The project may have
   * committed for a reason that has nothing to do with this decision, so the reader
   * must be able to see the commit without it being read as this adoption.
   */
  readonly committedRevision?: number | null;
  /**
   * The controlled media address of *this* instance.
   *
   * A `download_ref` is only followed when it belongs to this instance: another
   * instance's address is shown as unusable rather than linked.
   */
  readonly controlledMediaBase?: string;
  /**
   * Whether a decision is in flight.
   *
   * A decision that is on its way must not be sent twice: the buttons are disabled
   * until the Host has answered.
   */
  readonly busy?: boolean;
  /**
   * Whether the package on screen is no longer the one the Host would answer about.
   *
   * The last known package stays on screen, but it cannot be decided until it has been
   * read again.
   */
  readonly stale?: boolean;
}

/** The adoption state the panel shows. It is never derived from the decision itself. */
export interface ReviewAdoptionState {
  readonly state: "not_requested" | "requested" | "registered" | "unknown";
  readonly reason: string;
}

/** The project's own facts the adoption is read against. */
export interface AdoptionFacts {
  readonly project_revision: number;
  readonly snapshot_id: string;
  readonly source_digest: string;
}

/**
 * What is known about the adoption.
 *
 * The four facts stay apart, and this function reads only one of them: the *commit*.
 * The decision says that a person chose; the commit says that the Host published a new
 * version; the native acknowledgement says that the editor loaded it. Each is read from
 * its own source, and none of it is inferred from another.
 *
 * A project whose revision advanced is a project that committed — but it is not
 * necessarily *this* decision that was committed. An unrelated native edit, another
 * adoption, or a commit that happened for another reason all move the revision, and
 * none of them is evidence for this one. So the adoption is registered only when a
 * commit is bound to this decision, this package and this impact, and when the
 * committed facts are the project's current facts. Otherwise the adoption stays
 * pending, or unknown when the facts cannot be lined up.
 */
export function reviewAdoptionState(input: {
  readonly decision: ReviewDecision | null;
  /** The project's facts when the decision was recorded. */
  readonly atDecision: AdoptionFacts | null;
  /** The project's facts now. */
  readonly current: AdoptionFacts | null;
  /**
   * The commit, when the Host bound one to a decision.
   *
   * The bound decision is the *existing* decision record, so nothing new is invented
   * here: the caller says which decision the commit belongs to, and the function
   * checks that it is this one and that the committed facts are the current ones.
   */
  readonly committed?: {
    readonly decision: ReviewDecision;
    readonly project_revision: number;
    readonly snapshot_id: string;
    readonly source_digest: string;
  } | null;
}): ReviewAdoptionState {
  const decision = input.decision;
  if (decision === null) return { state: "not_requested", reason: "尚未登记任何决定。" };
  if (decision.choice !== "accept_and_adopt") return { state: "not_requested", reason: "这次决定没有请求采用。" };
  const atDecision = input.atDecision;
  const current = input.current;
  if (atDecision === null) return { state: "unknown", reason: "登记决定时的工程版本未知，采用状态无法核对。" };
  if (current === null) return { state: "unknown", reason: "尚未读到工程的当前版本，采用状态未知。" };
  const committed = input.committed ?? null;
  if (committed === null) {
    // The project may well have committed for another reason. That is not this
    // adoption, so this adoption stays pending.
    return {
      state: "requested",
      reason: `决定已登记；工程当前版本为 ${current.project_revision}，但没有与这次决定绑定的提交记录，采用保持待完成。`,
    };
  }
  if (committed.decision.decision_id !== decision.decision_id
    || committed.decision.package_id !== decision.package_id
    || committed.decision.package_version !== decision.package_version
    || (decision.approval?.impact_id ?? null) !== (committed.decision.approval?.impact_id ?? null)) {
    // The commit belongs to another decision. The revision moved; this adoption did
    // not, and it is not credited with the other one's commit.
    return {
      state: "unknown",
      reason: "工程已前进，但那次提交绑定的是另一个决定，不能算作这次采用。",
    };
  }
  if (committed.snapshot_id !== current.snapshot_id || committed.source_digest !== current.source_digest) {
    return { state: "unknown", reason: "那次提交的快照或内容摘要与工程当前状态不同，采用状态未知。" };
  }
  if (committed.project_revision < atDecision.project_revision) {
    return { state: "unknown", reason: "那次提交的版本早于登记决定时的版本，采用状态未知。" };
  }
  return {
    state: "registered",
    reason: `采用已提交：工程版本已从 ${atDecision.project_revision} 前进到 ${committed.project_revision}。提交与原生确认仍是两件事。`,
  };
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

const ADOPTION_LABEL: Readonly<Record<ReviewAdoptionState["state"], string>> = {
  not_requested: "尚未请求采用",
  requested: "采用待完成",
  registered: "采用已登记",
  unknown: "采用状态未知",
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
  const decision = props.decision ?? null;
  const adoption = props.adoption ?? null;
  // A package that is stale, or that the Host has already decided, cannot be decided
  // again: the buttons are disabled rather than offered and refused.
  const decidable = packageDocument.state === "pending" && props.busy !== true && props.stale !== true;

  return (
    <section
      className="nl-review"
      aria-label="创作审阅"
      data-nl-review-package={packageDocument.package_id}
      data-nl-review-package-version={packageDocument.version}
      data-nl-review-run={packageDocument.run_id}
    >
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
                {downloadOf(part.download_ref, props.controlledMediaBase) === null ? (
                  <span className="nl-muted">
                    {part.download_ref === null ? "尚无可下载文件" : "下载不可用：不是本实例的受控引用"}
                  </span>
                ) : (
                  <a href={downloadOf(part.download_ref, props.controlledMediaBase)!}>下载</a>
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
          {packageDocument.reuse_of_package_id === null ? null : (
            <p className="nl-muted" data-nl-review-reuse={packageDocument.reuse_of_package_id}>
              复用自上一份包 {packageDocument.reuse_of_package_id}：内容与来源沿用该包的真实记录。
            </p>
          )}
          <p className="nl-muted">预览是准备内容，尚未采用，也不是正式交付。</p>
        </section>

        <section className="nl-review-content" aria-label="创作内容">
          <BriefView brief={props.brief ?? null} />
          <ScriptView script={props.script ?? null} />
          <StoryboardView storyboard={props.storyboard ?? null} />
        </section>
      </div>

      {decision === null ? null : (
        <section className="nl-review-decision" aria-label="决定记录">
          <p className="nl-review-decision-line" role="status" aria-live="polite"
            data-nl-review-decision={decision.decision_id}>
            决定已登记：{decision.choice} · {decision.decision_id}
          </p>
          <p className="nl-muted">登记一条决定不等于已经提交，也不等于编辑区已经载入。</p>
        </section>
      )}

      {adoption === null ? null : (
        <p className="nl-review-adoption" data-nl-review-adoption={adoption.state}>
          {ADOPTION_LABEL[adoption.state]}：{adoption.reason}
        </p>
      )}

      {props.committedRevision === undefined || props.committedRevision === null ? null : (
        <p className="nl-review-committed" data-nl-review-committed={props.committedRevision}>
          工程当前版本：{props.committedRevision}
        </p>
      )}

      <footer className="nl-review-actions">
        <button
          type="button"
          disabled={!decidable || !allowed.has("accept") || props.onAccept === undefined}
          onClick={() => props.onAccept?.()}
        >
          接受
        </button>
        <button
          type="button"
          disabled={!decidable || !allowed.has("changes_requested") || props.onRequestChanges === undefined}
          onClick={() => props.onRequestChanges?.()}
        >
          提出修改
        </button>
        <button
          type="button"
          disabled={!decidable || !allowed.has("reject") || props.onReject === undefined}
          onClick={() => props.onReject?.()}
        >
          拒绝
        </button>
        <button
          type="button"
          className="nl-primary"
          disabled={!decidable || !canAdopt || props.onAcceptAndAdopt === undefined}
          onClick={() => props.onAcceptAndAdopt?.()}
        >
          确认并采用
        </button>
        {packageDocument.state === "stale" ? (
          <p className="nl-muted" data-nl-review-stale="true">这份内容包已过期：请重新读取当前待审的内容包。</p>
        ) : null}
        {props.stale === true ? (
          <p className="nl-muted" data-nl-review-stale="true">
            这份内容包没有重新读到：它不能被决定了，请稍后重试。
          </p>
        ) : null}
        <p className="nl-muted">关闭面板不会产生任何决定。</p>
      </footer>
    </section>
  );
}

/**
 * The download address of this instance, or `null`.
 *
 * A `download_ref` is the frozen contract's own opaque token — a path, a URL or a
 * foreign address is not one, and is never turned into one. The controlled address is
 * built from this instance's own base and that token, and nothing else is linked: a
 * panel never links an address it cannot vouch for.
 */
function downloadOf(ref: string | null, base: string | undefined): string | null {
  if (ref === null) return null;
  if (base === undefined || base === "") return null;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(ref)) return null;
  return `${base}${encodeURIComponent(ref)}`;
}
