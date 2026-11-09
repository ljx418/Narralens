/**
 * The PRODUCT system control surface.
 *
 * MAIN mounts the panel and owns the system lifecycle commands; the panel only renders
 * the health facts and delegates the optional read-only probes.
 */

export { SystemControlPanel, effectiveServiceState, DEFAULT_STALE_AFTER_MS } from "./SystemControlPanel.js";
export type { SystemControlPanelProps, SystemControlActions } from "./SystemControlPanel.js";
