import { useEffect, useRef } from "react";
import type { HealthRead, ServiceHealth } from "../../contracts/agent-driven-types.js";

/**
 * The R4 system control panel.
 *
 * It is a **non-modal** aside: no backdrop, no focus trap, and it never takes the focus
 * when it opens. The editor stays usable while it is open — that is the whole point of
 * the R4 layout, where the operator keeps refining a shot while the panel is showing.
 *
 * Two rules govern what it shows and what it may do:
 *
 * - **A stale sample is unknown.** The health contract samples every five seconds and
 *   treats a sample older than fifteen seconds as unknown. The panel applies that rule
 *   itself instead of showing a stale "ready".
 * - **Shared services are read-only.** The panel never offers to restart, unload or clear
 *   a shared instance. And in this round there is no model mutation at all: `A` does not
 *   authorize a runtime write, so the model section states that it is unverified and
 *   offers no control.
 *
 * Every action is delegated to an optional MAIN callback. The component never executes a
 * system command itself.
 */

export interface SystemControlActions {
  /** Re-checks the readiness of one service. A read-only probe. */
  readonly onCheckService?: (serviceId: string) => void;
  /** Re-checks the dependencies of the blocked work. A read-only probe. */
  readonly onCheckDependencies?: () => void;
}

export interface SystemControlPanelProps {
  /** The latest health sample, or `null` when nothing has been observed yet. */
  readonly health: HealthRead | null;
  /** The current time in epoch milliseconds, used for the staleness rule. */
  readonly nowMs: number;
  /** Whether the panel is open. */
  readonly open: boolean;
  /** Called when the user closes the panel. */
  readonly onClose?: () => void;
  /** The optional MAIN callbacks. */
  readonly actions?: SystemControlActions;
  /** A note about the current blocker. */
  readonly impact?: string;
}

/** The stale threshold of the contract. */
export const DEFAULT_STALE_AFTER_MS = 15000;

/**
 * The state of a service as the panel shows it.
 *
 * A sample that is older than the stale window is `unknown`, even when the sample itself
 * said `ready`: the panel shows what it knows, and it knows that the sample is too old.
 */
export function effectiveServiceState(
  service: ServiceHealth,
  nowMs: number,
  staleAfterMs: number = DEFAULT_STALE_AFTER_MS,
): ServiceHealth["state"] {
  const sampledAt = Date.parse(service.sampled_at);
  if (Number.isNaN(sampledAt)) return "unknown";
  if (nowMs - sampledAt > staleAfterMs) return "unknown";
  return service.state;
}

const SERVICE_STATE_LABEL: Readonly<Record<ServiceHealth["state"], string>> = {
  starting: "启动中",
  ready: "就绪",
  degraded: "降级",
  stopped: "已停止",
  unknown: "未知",
};

export function SystemControlPanel(props: SystemControlPanelProps) {
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    // The panel is not modal, so opening it must not steal the focus. The heading is only
    // given a tab stop so that a keyboard user can reach it deliberately.
    if (headingRef.current !== null) headingRef.current.tabIndex = -1;
  }, [props.open]);

  if (!props.open) return null;

  const staleAfterMs = props.health?.stale_after_ms ?? DEFAULT_STALE_AFTER_MS;
  const services = props.health?.services ?? [];

  return (
    <aside className="nl-system-panel" aria-labelledby="nl-system-title">
      <header className="nl-system-head">
        <div>
          <h2 id="nl-system-title" ref={headingRef}>系统控制</h2>
          <p>独立面板 · 可继续编辑</p>
        </div>
        {props.onClose === undefined ? null : (
          <button type="button" onClick={props.onClose} aria-label="关闭系统面板">关闭</button>
        )}
      </header>

      <p className="nl-system-impact">{props.impact ?? "当前无已知阻塞。"}</p>

      <section aria-labelledby="nl-system-services">
        <h3 id="nl-system-services">本项目服务</h3>
        {services.length === 0 ? (
          <p className="nl-muted">尚未采到健康样本。状态未知。</p>
        ) : (
          <ul className="nl-service-list">
            {services.map((service) => {
              const state = effectiveServiceState(service, props.nowMs, staleAfterMs);
              return (
                <li key={service.service_id} className="nl-service-row">
                  <strong>{service.service_id}</strong>
                  <span>
                    {SERVICE_STATE_LABEL[state]}
                    {state === "unknown" && service.state !== "unknown" ? "（样本已过期）" : ""}
                  </span>
                  <span className="nl-muted">{service.ownership === "shared" ? "共享 · 只读" : "本项目所有"}</span>
                  {service.ownership === "shared" ? null : (
                    <button
                      type="button"
                      disabled={props.actions?.onCheckService === undefined}
                      onClick={() => props.actions?.onCheckService?.(service.service_id)}
                    >
                      检查就绪状态
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p className="nl-muted">不管理共享实例，不擅自重启、卸载或清队列。</p>
      </section>

      <section aria-labelledby="nl-system-models">
        <h3 id="nl-system-models">登记的生图运行配置</h3>
        <p className="nl-muted">本轮不支持模型装载、预热或卸载：这些属于运行期写操作，未获授权。配置状态未经验证，显示为未知。</p>
        <p className="nl-muted">请求受理不等于就绪；活动任务期间不允许卸载。</p>
      </section>

      <section aria-labelledby="nl-system-recovery">
        <h3 id="nl-system-recovery">受影响的创作事项</h3>
        <p className="nl-muted">{props.impact ?? "当前无待恢复事项。"}</p>
        <button
          type="button"
          disabled={props.actions?.onCheckDependencies === undefined}
          onClick={() => props.actions?.onCheckDependencies?.()}
        >
          检查依赖
        </button>
        <p className="nl-muted">只检查依赖，不重新执行媒体任务。结果未知先对账。</p>
      </section>
    </aside>
  );
}
