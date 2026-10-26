/**
 * The `/api/migration/v1` route gate, shared by the two fitness files.
 *
 * `tests/architecture/m2.2-fitness.test.ts` and `tests/wave2/w2-route-fitness.test.ts`
 * both assert the *same* exact route list, and they used to carry two copies of it. Two
 * copies of a whitelist are two answers to "which routes exist", and the second one
 * drifts. So the list and the comparison live here, once, and the M5 mutation bite in
 * `tests/m5/route-fitness.test.ts` mutates *this* gate rather than a copy of it.
 *
 * The gate is exact in both directions: a route that is missing and a route that is not
 * authorised both make it red. `contains` would pass for a server that grew a route
 * nobody approved, which is the failure the fitness rule exists to catch.
 */

/**
 * The authorised routes, in the order they are mounted.
 *
 * M5A added exactly four (Wave 3 `04` §6): the workbench read model, the two lock
 * routes and the comparison replay. The Studio Gateway is *not* here: it is a separate
 * loopback origin and it mounts nothing under `/api/migration/v1`.
 */
export const MIGRATION_ROUTE_WHITELIST: readonly string[] = Object.freeze([
  "projects\\/([A-Za-z0-9_-]+)\\/engine",
  "projects\\/([A-Za-z0-9_-]+)\\/workbench",
  "projects\\/([A-Za-z0-9_-]+)\\/migrate-copy",
  "projects\\/([A-Za-z0-9_-]+)\\/proposals\\/([A-Za-z0-9_-]+)\\/materialize",
  "projects\\/([A-Za-z0-9_-]+)\\/impact",
  "projects\\/([A-Za-z0-9_-]+)\\/edits",
  "projects\\/([A-Za-z0-9_-]+)\\/history",
  "projects\\/([A-Za-z0-9_-]+)\\/history\\/restore",
  "projects\\/([A-Za-z0-9_-]+)\\/history\\/undo",
  "projects\\/([A-Za-z0-9_-]+)\\/history\\/redo",
  "projects\\/([A-Za-z0-9_-]+)\\/locks",
  "projects\\/([A-Za-z0-9_-]+)\\/locks\\/([A-Za-z0-9_-]+)",
  "projects\\/([A-Za-z0-9_-]+)\\/comparisons\\/replay",
  "materializations\\/([A-Za-z0-9_-]+)",
  "migrations\\/([A-Za-z0-9_-]+)",
  "migrations\\/([A-Za-z0-9_-]+)\\/rollback",
]);

/** The routes the server's own source mounts, in the order it mounts them. */
export function extractMigrationRoutes(source: string): string[] {
  return [...source.matchAll(/\^\\\/api\\\/migration\\\/v1\\\/([^$]*)\$/gu)].map((match) => match[1]!);
}

export interface MigrationRouteGateResult {
  /** True only when the mounted routes are exactly the authorised ones. */
  readonly ok: boolean;
  readonly actual: readonly string[];
  /** An authorised route that is not mounted. */
  readonly missing: readonly string[];
  /** A mounted route that is not authorised. */
  readonly unexpected: readonly string[];
}

export function migrationRouteGate(source: string): MigrationRouteGateResult {
  const actual = extractMigrationRoutes(source);
  const missing = MIGRATION_ROUTE_WHITELIST.filter((route) => !actual.includes(route));
  const unexpected = actual.filter((route) => !MIGRATION_ROUTE_WHITELIST.includes(route));
  return { ok: missing.length === 0 && unexpected.length === 0, actual, missing, unexpected };
}
