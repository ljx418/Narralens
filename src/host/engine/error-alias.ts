import type { ApiErrorCode } from "../../contracts/types.js";

/**
 * Machine-readable companion to the alias/version table in
 * `docs/migration/M2/ADR-M2.1-001-contract-reconciliation.md` §2
 * (`narralens.error-alias@1`).
 *
 * Every member of the production `ApiErrorCode` union appears exactly once. Codes that
 * existed before the migration are marked `legacy`; the five codes M2.1 introduces each
 * name the closest existing code and what makes it semantically different, so a reviewer
 * can confirm they are not synonyms (`docs/03_Architecture.md:188`).
 */

export interface ErrorAliasEntry {
  readonly code: ApiErrorCode;
  readonly http_status: number;
  readonly legacy: boolean;
  readonly introduced_by: string | null;
  readonly distinguishes_from: ApiErrorCode | null;
  readonly distinction: string | null;
}

export const ERROR_ALIAS_VERSION = "narralens.error-alias@1";

export const ERROR_ALIAS_TABLE: readonly ErrorAliasEntry[] = Object.freeze([
  { code: "INVALID_REQUEST", http_status: 400, legacy: true, introduced_by: null, distinguishes_from: null, distinction: null },
  { code: "INVALID_SESSION", http_status: 401, legacy: true, introduced_by: null, distinguishes_from: null, distinction: null },
  { code: "ORIGIN_REJECTED", http_status: 403, legacy: true, introduced_by: null, distinguishes_from: null, distinction: null },
  { code: "NOT_FOUND", http_status: 404, legacy: true, introduced_by: null, distinguishes_from: null, distinction: null },
  { code: "REVISION_CONFLICT", http_status: 409, legacy: true, introduced_by: null, distinguishes_from: null, distinction: null },
  { code: "INVALID_PROPOSAL", http_status: 422, legacy: true, introduced_by: null, distinguishes_from: null, distinction: null },
  { code: "INVALID_PROPOSAL_SET", http_status: 422, legacy: true, introduced_by: null, distinguishes_from: null, distinction: null },
  { code: "PROVIDER_REJECTED", http_status: 422, legacy: true, introduced_by: null, distinguishes_from: null, distinction: null },
  { code: "PROVIDER_OVERLOADED", http_status: 529, legacy: true, introduced_by: null, distinguishes_from: null, distinction: null },
  { code: "RUNNER_UNAVAILABLE", http_status: 503, legacy: true, introduced_by: null, distinguishes_from: null, distinction: null },
  { code: "RUNNER_TIMEOUT", http_status: 504, legacy: true, introduced_by: null, distinguishes_from: null, distinction: null },
  { code: "IDEMPOTENCY_KEY_CONFLICT", http_status: 409, legacy: true, introduced_by: null, distinguishes_from: null, distinction: null },
  { code: "UNSUPPORTED_EDIT", http_status: 422, legacy: true, introduced_by: null, distinguishes_from: null, distinction: null },
  { code: "MISSING_ASSET", http_status: 422, legacy: true, introduced_by: null, distinguishes_from: null, distinction: null },
  { code: "INVALID_MEDIA", http_status: 422, legacy: true, introduced_by: null, distinguishes_from: null, distinction: null },
  { code: "MEDIA_TOOL_UNAVAILABLE", http_status: 503, legacy: true, introduced_by: null, distinguishes_from: null, distinction: null },
  { code: "MANIFEST_CHANGED", http_status: 409, legacy: true, introduced_by: null, distinguishes_from: null, distinction: null },
  { code: "AMBIGUOUS_TIME", http_status: 422, legacy: true, introduced_by: null, distinguishes_from: null, distinction: null },
  { code: "APPROVAL_REQUIRED", http_status: 428, legacy: true, introduced_by: null, distinguishes_from: null, distinction: null },
  { code: "TARGET_LOCKED", http_status: 423, legacy: true, introduced_by: null, distinguishes_from: null, distinction: null },
  { code: "PROJECT_ATTENTION_REQUIRED", http_status: 423, legacy: true, introduced_by: null, distinguishes_from: null, distinction: null },
  { code: "HYPIT_UNAVAILABLE", http_status: 503, legacy: true, introduced_by: null, distinguishes_from: null, distinction: null },
  { code: "TRANSACTION_FAILED", http_status: 500, legacy: true, introduced_by: null, distinguishes_from: null, distinction: null },
  { code: "INTERNAL_ERROR", http_status: 500, legacy: true, introduced_by: null, distinguishes_from: null, distinction: null },
  { code: "CAPABILITY_NOT_ENABLED", http_status: 404, legacy: false, introduced_by: "M2.1", distinguishes_from: "NOT_FOUND",
    distinction: "The stage gate for this known capability is not open yet; NOT_FOUND means the resource or route does not exist." },
  { code: "SOURCE_CHANGED", http_status: 409, legacy: false, introduced_by: "M2.1", distinguishes_from: "MANIFEST_CHANGED",
    distinction: "The source reference closure digest changed (film, scenes, subtitles, settings, fonts, referenced assets); MANIFEST_CHANGED is scoped to the asset manifest alone." },
  { code: "ENGINE_UNAVAILABLE", http_status: 503, legacy: false, introduced_by: "M2.1", distinguishes_from: "HYPIT_UNAVAILABLE",
    distinction: "The bound engine or its pinned upstream cannot be used at all (including an unpinned or absent upstream checkout); HYPIT_UNAVAILABLE is a Hypit fork runtime outage." },
  { code: "INVALID_RANGE", http_status: 422, legacy: false, introduced_by: "M2.1", distinguishes_from: "AMBIGUOUS_TIME",
    distinction: "The frame range is structurally invalid (zero length, negative start, out of bounds, crossing a clip); AMBIGUOUS_TIME means a time could not be determined uniquely." },
  { code: "DATA_POLICY_DENIED", http_status: 403, legacy: false, introduced_by: "M2.1", distinguishes_from: "ORIGIN_REJECTED",
    distinction: "An egress, cost or credential policy refused the operation; ORIGIN_REJECTED is the same-origin check refusing the request." },
]);
