/**
 * The PRODUCT observation surfaces.
 *
 * MAIN mounts these components; they add no application root, no timeline and no player.
 */

export { WorkflowTopBar, TaskDetailDialog } from "./WorkflowTopBar.js";
export type { WorkflowTopBarProps } from "./WorkflowTopBar.js";
export { CreativeReviewPanel } from "./CreativeReviewPanel.js";
export type { CreativeReviewPanelProps, ReviewAdoptionState } from "./CreativeReviewPanel.js";
export { BriefView, ScriptView, StoryboardView, PreparedTextView } from "./content-views.js";
export { NativeSyncIndicator, nativeSyncState } from "./NativeSyncIndicator.js";
export type { NativeSyncState } from "./NativeSyncIndicator.js";
export { LocalAssetRegistrationPanel } from "./LocalAssetRegistrationPanel.js";
export type { LocalAssetRegistrationPanelProps } from "./LocalAssetRegistrationPanel.js";
export type {
  LocalAssetCandidate,
  LocalAssetInventoryItem,
  LocalAssetLicense,
  LocalAssetLicenseStatus,
  LocalAssetRecordingOrigin,
  LocalAssetRegistrationRequest,
  LocalAssetSource,
  LocalAssetSourceKind,
} from "../agent-workbench-client.js";
