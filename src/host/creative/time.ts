/**
 * Time handling for the PRODUCT lane.
 *
 * The frozen SQL stores every deadline and issue time as INTEGER epoch seconds
 * (`issued_at`, `expires_at` in `cp_a0_intake_confirmation`, `cp_a0_trusted_confirmation`,
 * `cp_a0_execution_grant` and `cp_a0_approval`), while the frozen wire DTOs carry
 * ISO-8601 strings. The conversion lives here so that no call site has to remember which
 * unit it is holding: mixing the two makes a deadline expire in 1970 or in the far future.
 */

/** The current time in epoch seconds. */
export function nowEpochSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** Epoch seconds to ISO-8601. */
export function epochSecondsToIso(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

/** ISO-8601 to epoch seconds. */
export function isoToEpochSeconds(iso: string): number {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) throw new Error(`Not a valid timestamp: ${iso}`);
  return Math.floor(parsed / 1000);
}

/** True when a deadline in epoch seconds has passed. */
export function isExpired(expiresAtEpochSeconds: number, nowEpochSecondsValue: number): boolean {
  return nowEpochSecondsValue >= expiresAtEpochSeconds;
}
