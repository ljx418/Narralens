/**
 * The PRODUCT observation surfaces.
 *
 * MAIN mounts these components; they add no application root, no timeline and no player.
 */

export { WorkflowTopBar, TaskDetailDialog } from "./WorkflowTopBar.js";
export type { WorkflowTopBarProps } from "./WorkflowTopBar.js";
export { CreativeReviewPanel } from "./CreativeReviewPanel.js";
export type { CreativeReviewPanelProps } from "./CreativeReviewPanel.js";
export {
  BriefView,
  ScriptView,
  StoryboardView,
  NativeSyncIndicator,
  nativeSyncState,
} from "./content-views.js";
export type { NativeSyncState } from "./content-views.js";
