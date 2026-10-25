import { HttpError } from "../api-error.js";
import type { MigrationPlanV1 } from "../../contracts/migration-types.js";

/**
 * OpenFilm layout facts (`09_M4A_CLAUDE_HANDOFF.md` M4A-0, ADR-W2.0-004 §6).
 *
 * A migrated OpenFilm target has to be re-inspectable after a Host restart, and the only
 * thing that survives a restart is what the migration wrote down. So the layout is derived
 * here, from the stored plan, and nowhere else — `OpenFilmEngineAdapter.registerLayout()`
 * is a test/probe hook and cannot be the production answer.
 *
 * The single most important property of this module is that it produces *the same digest
 * the migration committed*. `computeSourceDigest` folds `declaredAssets` into the manifest by
 * writing an `asset_id` where the roots-only pass wrote `null`, so adding declared assets to
 * the layout would silently change `source_digest` and every activated target would read as
 * `SOURCE_CHANGED`. The layout therefore carries roots only, and the ledger is checked
 * against those roots rather than merged into them (see `assertLedgerWithinRoots`).
 *
 * A second answer here is a second digest, so `openFilmRoots` is the one implementation:
 * `MigrationService` uses it to publish and to verify, and the projection seam uses it to
 * rebuild. They cannot disagree because there is nothing to disagree with.
 */

export interface OpenFilmSubtitleFact {
  readonly subtitle_id: string;
  readonly path: string;
}

export interface OpenFilmLayoutFacts {
  /** `film.html` first, then narration, subtitles and assets in plan order. */
  readonly roots: readonly string[];
  readonly subtitles: readonly OpenFilmSubtitleFact[];
}

/**
 * Structurally the *minimum* a roots derivation needs, rather than any one caller's type.
 *
 * `MigrationService` publishes with `MigrateInput` (subtitle mappings that have no digest
 * yet) and verifies with the stored plan (mappings that do). The roots are the same in both
 * cases, so the shared signature accepts both instead of asking one of them to widen.
 */
interface RootsInput {
  readonly narration: { readonly source_path: string; readonly target_path: string } | null;
  readonly subtitles: readonly { readonly source_path: string; readonly target_path: string }[];
  readonly assets: readonly { readonly source_path: string; readonly target_path: string }[];
}

/** film.html plus every subtitle and asset the migration carried into the copy. */
export function openFilmRoots(input: RootsInput): string[] {
  const roots = ["film.html"];
  if (input.narration !== null) roots.push(input.narration.target_path);
  for (const subtitle of input.subtitles) roots.push(subtitle.target_path);
  for (const asset of input.assets) roots.push(asset.target_path);
  return [...new Set(roots)];
}

/**
 * The subtitle id the upstream and the probe already use for the file the plan carries, so
 * the projection names it the same way whether it was rebuilt or hand-registered.
 */
function subtitleIdOf(targetPath: string): string {
  const base = targetPath.slice(targetPath.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return stem.length === 0 ? "subtitle" : stem;
}

/** Every layout fact the projection needs, derived from the immutable plan and nothing else. */
export function openFilmLayoutFacts(plan: MigrationPlanV1): OpenFilmLayoutFacts {
  const subtitles = plan.subtitles.map((subtitle): OpenFilmSubtitleFact => ({
    subtitle_id: subtitleIdOf(subtitle.target_path), path: subtitle.target_path,
  }));
  const ids = new Set<string>();
  for (const subtitle of subtitles) {
    if (ids.has(subtitle.subtitle_id)) {
      throw new HttpError(422, "INVALID_REQUEST",
        `the migration plan declares two subtitles with the same id: ${subtitle.subtitle_id}`,
        undefined, plan.target_project_id);
    }
    ids.add(subtitle.subtitle_id);
  }
  return { roots: openFilmRoots(plan), subtitles };
}

/**
 * Reject a plan-derived root that could reach outside the target.
 *
 * The layout is built from stored text, but "stored" is not "trusted": a plan whose
 * `target_path` is absolute or traverses upwards must not become a read of something
 * outside the migrated copy. This runs before the path is ever joined to a root, so the
 * escape is refused lexically rather than after a realpath has already followed it.
 */
export function assertRelativeInsideRoot(relative: string, projectId: string, label: string): void {
  const value = relative.trim();
  const escaped =
    value === ""
    || value.includes("\\")
    || value.startsWith("/")
    || /^[a-z]:/iu.test(value)
    || value.split("/").some((segment) => segment === ".." || segment === "");
  if (escaped) {
    throw new HttpError(422, "UNSUPPORTED_EDIT",
      `${label} is not a path inside the migrated target`, { path_escape: label }, projectId);
  }
}

/**
 * Cross-check the ledger against the plan-derived roots.
 *
 * The ADR requires the ledger's target facts to be part of the rebuild, and they are — as a
 * *constraint* rather than as extra roots. An asset the ledger knows about but the plan's
 * closure does not cover is a real inconsistency between two durable records, and admitting
 * it would mean deciding which one wins; refusing it keeps the digest comparable with the
 * committed one while still refusing to build a layout over contradictory facts.
 */
export function assertLedgerWithinRoots(facts: OpenFilmLayoutFacts, ledgerTargetPaths: readonly string[],
  projectId: string): void {
  const roots = new Set(facts.roots);
  for (const target of ledgerTargetPaths) {
    assertRelativeInsideRoot(target, projectId, "ledger target_path");
    if (!roots.has(target)) {
      throw new HttpError(422, "UNSUPPORTED_EDIT",
        "the asset ledger names a target the migrated plan does not cover",
        { ledger_target: target }, projectId);
    }
  }
}

/** A content-addressed asset the Host installed during an adoption. */
const INSTALLED_ASSET = /^assets\/[a-f0-9]{64}\/source\.mp4$/u;

/**
 * The weaker ledger rule M4C needs, and why it is weaker.
 *
 * The subset rule above is right for a *migration*: the plan's closure and the ledger are
 * two records of the same copy, and a disagreement between them is a contradiction. It is
 * wrong after a **restore**, and M4C is what makes it wrong: a restore puts an older
 * closure back into the active source, so the assets an earlier adoption installed are no
 * longer referenced by the film — but they are still in the ledger, and they are still on
 * disk. They are leftovers, and the gate permits them to be leftovers.
 *
 * So the rule becomes containment plus provenance: every ledger target must still be a
 * relative path inside the project, and a target that is not among the roots must be an
 * installed, content-addressed asset. A ledger row that points anywhere else is still a
 * contradiction, and it is still refused.
 */
export function assertLedgerStaysInsideTheProject(facts: OpenFilmLayoutFacts,
  ledgerTargetPaths: readonly string[], projectId: string): void {
  const roots = new Set(facts.roots);
  for (const target of ledgerTargetPaths) {
    assertRelativeInsideRoot(target, projectId, "ledger target_path");
    if (roots.has(target)) continue;
    if (!INSTALLED_ASSET.test(target)) {
      throw new HttpError(422, "UNSUPPORTED_EDIT",
        "the asset ledger names a target that is neither in the closure nor an installed asset",
        { ledger_target: target }, projectId);
    }
  }
}
