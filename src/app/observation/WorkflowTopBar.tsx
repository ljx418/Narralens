import { useCallback, useEffect, useRef, useState } from "react";
import type { Workflow, WorkflowNode } from "../../contracts/agent-driven-types.js";

/**
 * The R4 workflow bar.
 *
 * The shape is the approved R4 prototype: a collapsed summary by default, a horizontal
 * list of stages when it is expanded, and a task detail dialog when a stage is clicked.
 *
 * Three things it deliberately does not do:
 *
 * - It does not own the workflow. It renders the `Workflow` DTO it is given, so the nodes,
 *   the attempts, the job and the output references all come from the Host's facts.
 * - Closing the dialog has no control effect. Reading a node is not a pause, not a cancel
 *   and not a change: the dialog only reads.
 * - It does not infer progress. A node that never ran stays `pending` with attempt 0,
 *   whatever the surrounding prose might suggest.
 */

export interface WorkflowTopBarProps {
  /** The workflow to show. */
  readonly workflow: Workflow;
  /** The one-line summary of the current task. */
  readonly title?: string;
  /** The one-line status under the title. */
  readonly status?: string;
  /** Controlled expansion state. When omitted the bar manages its own. */
  readonly expanded?: boolean;
  /** Notified when the user expands or collapses the bar. */
  readonly onExpandedChange?: (expanded: boolean) => void;
  /** Scrolls the current work into view. Optional. */
  readonly onLocate?: () => void;
}

const STATE_LABEL: Readonly<Record<string, string>> = {
  pending: "待开始",
  running: "进行中",
  waiting_user: "待你决定",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
  stale: "已过期",
  unknown: "未知",
};

export function WorkflowTopBar(props: WorkflowTopBarProps) {
  const { workflow } = props;
  const [uncontrolledExpanded, setUncontrolledExpanded] = useState(false);
  const expanded = props.expanded ?? uncontrolledExpanded;
  const [openNodeId, setOpenNodeId] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const setExpanded = useCallback(
    (next: boolean) => {
      if (props.expanded === undefined) setUncontrolledExpanded(next);
      props.onExpandedChange?.(next);
    },
    [props],
  );

  const openNode = useCallback((nodeId: string) => {
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpenNodeId(nodeId);
  }, []);

  const closeNode = useCallback(() => {
    setOpenNodeId(null);
    // The focus goes back where it came from: reading a node must not move the user.
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (openNodeId === null) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeNode();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [openNodeId, closeNode]);

  const openNodeRecord = openNodeId === null
    ? undefined
    : workflow.nodes.find((node) => node.node_id === openNodeId);
  const currentNode = openNodeRecord ?? null;
  const summary = summarize(workflow);

  return (
    <section className="nl-topbar" aria-label="当前工作流">
      <div className="nl-topbar-head">
        <div className="nl-topbar-summary">
          <strong>{props.title ?? summary}</strong>
          <span>{props.status ?? "展开“工作流”可查看每个阶段与它的真实任务。"}</span>
        </div>
        {props.onLocate === undefined ? null : (
          <button type="button" onClick={props.onLocate}>定位当前事项</button>
        )}
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls="nl-workflow-stages"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "收起工作流" : "工作流"}
        </button>
      </div>
      <div id="nl-workflow-stages" hidden={!expanded}>
        <ol className="nl-stage-rail">
          {workflow.nodes.map((node) => (
            <li key={node.node_id}>
              <button
                type="button"
                className={`nl-stage nl-stage-${node.state}`}
                aria-current={node.state === "running" ? "step" : undefined}
                onClick={() => openNode(node.node_id)}
              >
                <span className="nl-stage-name">{node.node_id}</span>
                <span className="nl-stage-state">{STATE_LABEL[node.state] ?? node.state}</span>
              </button>
            </li>
          ))}
        </ol>
        <p className="nl-stage-hint">点击阶段查看真实任务、输入与输出；查看不会暂停或改动工程。</p>
      </div>
      {currentNode === null ? null : (
        <TaskDetailDialog node={currentNode} onClose={closeNode} />
      )}
    </section>
  );
}

/**
 * The task detail dialog.
 *
 * It shows the node's own facts: its state, its reason, its attempt, its job, the
 * references it consumed and the references it produced. There is no action button that
 * changes anything — the only control is "close".
 */
export function TaskDetailDialog(props: {
  readonly node: WorkflowNode;
  readonly onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const heading = dialogRef.current?.querySelector<HTMLElement>("h2");
    heading?.focus();
  }, []);

  const { node } = props;
  return (
    <div className="nl-dialog-backdrop" onClick={props.onClose}>
      <div
        ref={dialogRef}
        className="nl-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="nl-task-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="nl-dialog-head">
          <h2 id="nl-task-dialog-title" tabIndex={-1}>{node.node_id}</h2>
          <button type="button" onClick={props.onClose} aria-label="关闭任务详情">关闭</button>
        </header>
        <dl className="nl-task-facts">
          <dt>状态</dt>
          <dd>{STATE_LABEL[node.state] ?? node.state}</dd>
          <dt>说明</dt>
          <dd>{node.reason}</dd>
          <dt>尝试次数</dt>
          <dd>{node.attempt}</dd>
          <dt>任务</dt>
          <dd>{node.job_id ?? "尚未派发"}</dd>
          <dt>依赖</dt>
          <dd>{node.dependencies.length === 0 ? "无" : node.dependencies.join("、")}</dd>
          <dt>可执行动作</dt>
          <dd>{node.allowed_actions.length === 0 ? "无" : node.allowed_actions.join("、")}</dd>
          <dt>输入</dt>
          <dd>{node.input_refs.length === 0 ? "无" : node.input_refs.map((ref) => `${ref.id}@${ref.version}`).join("、")}</dd>
          <dt>输出</dt>
          <dd>{node.output_refs.length === 0 ? "无" : node.output_refs.map((ref) => `${ref.id}@${ref.version}`).join("、")}</dd>
        </dl>
        <footer className="nl-dialog-foot">
          <p className="nl-muted">查看详情不会暂停任务，也不会改动工程。</p>
          <button type="button" onClick={props.onClose}>关闭</button>
        </footer>
      </div>
    </div>
  );
}

/** The collapsed summary: the stage that is running, or the first one that is not done. */
function summarize(workflow: Workflow): string {
  const running = workflow.nodes.find((node) => node.state === "running");
  if (running !== undefined) return `进行中：${running.node_id}`;
  const waiting = workflow.nodes.find((node) => node.state === "waiting_user");
  if (waiting !== undefined) return `等你决定：${waiting.node_id}`;
  const next = workflow.nodes.find((node) => node.state === "pending");
  if (next !== undefined) return `下一步：${next.node_id}`;
  return `共 ${workflow.nodes.length} 个阶段`;
}
