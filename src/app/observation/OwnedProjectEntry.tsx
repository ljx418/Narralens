import { useId } from "react";
import "./OwnedProjectEntry.css";

export interface OwnedProjectEntryProject {
  readonly project_id: string;
  readonly title: string;
  readonly project_revision: number | null;
  readonly snapshot_id: string | null;
  readonly saved_at: string | null;
  readonly frame_count: number | null;
  readonly state: "saved" | "attention";
}

export interface OwnedProjectEntryProps {
  readonly projects: readonly OwnedProjectEntryProject[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly openingProjectId: string | null;
  readonly hasNext: boolean;
  readonly onReload: () => void;
  readonly onNext: () => void;
  readonly onOpen: (projectId: string) => void;
}

function nonnegativeInteger(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value >= 0;
}

function savedTime(value: string | null): { label: string; iso: string } | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return { label: date.toLocaleString("zh-CN", { hour12: false }), iso: date.toISOString() };
}

/** An owned-project read view. MAIN supplies all facts, identity and native open callbacks. */
export function OwnedProjectEntry({
  projects, loading, error, openingProjectId, hasNext, onReload, onNext, onOpen,
}: OwnedProjectEntryProps) {
  const id = useId();
  const busy = loading || openingProjectId !== null;
  return (
    <section className="nl-owned-project-entry" aria-labelledby={`${id}-heading`}>
      <header className="nl-owned-entry-header">
        <div>
          <h1 id={`${id}-heading`}>创作工程</h1>
          <p>打开已保存的工程，进入当前原生剪辑区继续创作。</p>
        </div>
        <button type="button" onClick={onReload} disabled={busy}>刷新工程</button>
      </header>

      <p className="nl-owned-entry-notice">已保存表示工程已有保存记录；原生剪辑区是否已加载，需要进入后确认。</p>
      <p className="nl-owned-entry-status" role="status" aria-live="polite" aria-atomic="true">
        {openingProjectId !== null ? "正在打开工程，请等待原生剪辑区就绪。"
          : loading ? "正在读取工程…"
            : projects.length > 0 ? `当前显示 ${projects.length} 个工程` : ""}
      </p>
      {error !== null && <p className="nl-owned-entry-error" role="alert">{error}</p>}

      {!loading && error === null && projects.length === 0 && (
        <div className="nl-owned-entry-empty">
          <h2>还没有可显示的工程</h2>
          <p>向 Agent 描述影片主题并确认简报。创建完成后，在这里打开工程继续剪辑。</p>
        </div>
      )}

      <ul className="nl-owned-entry-list" aria-label="创作工程列表" aria-busy={loading}>
        {projects.map((project, index) => {
          const opening = openingProjectId === project.project_id;
          const attention = project.state === "attention";
          const saved = savedTime(project.saved_at);
          const titleId = `${id}-project-${index}`;
          return (
            <li key={project.project_id}>
              <article className="nl-owned-entry-row" aria-labelledby={titleId}>
                <div className="nl-owned-entry-content">
                  <div className="nl-owned-entry-title">
                    <h2 id={titleId}>{project.title || "未命名工程"}</h2>
                    <span className={attention ? "nl-owned-entry-attention" : "nl-owned-entry-saved"}>
                      {attention ? "需要处理" : "已保存"}
                    </span>
                  </div>
                  <dl className="nl-owned-entry-facts">
                    <div><dt>保存版本</dt><dd>{nonnegativeInteger(project.project_revision) ? project.project_revision : "待核对"}</dd></div>
                    <div><dt>保存时间</dt><dd>{saved ? <time dateTime={saved.iso}>{saved.label}</time> : "待核对"}</dd></div>
                    <div><dt>内容</dt><dd>{nonnegativeInteger(project.frame_count)
                      ? project.frame_count === 0 ? "空工程" : `${project.frame_count} 帧` : "待核对"}</dd></div>
                  </dl>
                  <details className="nl-owned-entry-record">
                    <summary>保存信息</summary>
                    <dl>
                      <div><dt>工程 ID</dt><dd>{project.project_id}</dd></div>
                      <div><dt>保存快照</dt><dd>{project.snapshot_id ?? "待核对"}</dd></div>
                    </dl>
                  </details>
                  {attention && <p className="nl-owned-entry-reason">工程需要处理后才能打开，请让 Agent 检查工程状态。</p>}
                </div>
                <button className="nl-owned-entry-open" type="button" disabled={busy || attention}
                  aria-label={`${opening ? "正在打开" : "进入原生剪辑"}：${project.title || "未命名工程"}`}
                  onClick={() => { if (!busy && !attention) onOpen(project.project_id); }}>
                  {opening ? "正在打开…" : "进入原生剪辑"}
                </button>
              </article>
            </li>
          );
        })}
      </ul>
      {hasNext && <footer className="nl-owned-entry-footer">
        <button type="button" onClick={onNext} disabled={busy}>下一页工程</button>
      </footer>}
    </section>
  );
}
