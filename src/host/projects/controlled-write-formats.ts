/**
 * The request formats the controlled write paths own.
 *
 * A `project_transaction` row records the request that created it, and the *shape* of that
 * request is what says which module owns the row. Two modules own controlled writes — M4B's
 * adoption and M4C's restore — and each must be able to tell its own rows from the other's
 * without guessing.
 *
 * The rule lives here, in one module, because the two readers are exactly the two places
 * where a wrong answer is expensive: a module that decides another module's transaction
 * answers for a request it does not understand, and a module that ignores another module's
 * pending row lets the generic recovery strand it.
 */

export const ADOPT_REQUEST_FORMAT = "narralens.adopt-request@1.0";
export const RESTORE_REQUEST_FORMAT = "narralens.restore-request@1.0";

/** Every format a controlled write may carry. */
export const CONTROLLED_REQUEST_FORMATS: ReadonlySet<string> = new Set([
  ADOPT_REQUEST_FORMAT, RESTORE_REQUEST_FORMAT,
]);

/**
 * Whether a stored request is a controlled write at all.
 *
 * A row whose request cannot be parsed is *not* claimed: it may belong to the legacy edit
 * route, and the legacy module owns it.
 */
export function claimsControlledWrite(requestJson: string): boolean {
  try {
    const parsed = JSON.parse(requestJson) as { format?: unknown } | null;
    return typeof parsed?.format === "string" && CONTROLLED_REQUEST_FORMATS.has(parsed.format);
  } catch { return false; }
}

/** Whether a stored request is specifically a restore. */
export function claimsHistoryRestore(requestJson: string): boolean {
  try {
    const parsed = JSON.parse(requestJson) as { format?: unknown } | null;
    return parsed?.format === RESTORE_REQUEST_FORMAT;
  } catch { return false; }
}

/** Whether a stored request is specifically an adoption. */
export function claimsAdoption(requestJson: string): boolean {
  try {
    const parsed = JSON.parse(requestJson) as { format?: unknown } | null;
    return parsed?.format === ADOPT_REQUEST_FORMAT;
  } catch { return false; }
}
