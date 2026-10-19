import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { resolve, sep } from "node:path";
import { canonicalJson } from "../engine/source-digest-v1.js";
import { contractIds, validatorFor } from "../../contracts/validator.js";
import { sha256File, treeDigest } from "./openfilm-migrator.js";
import { HttpError } from "../api-error.js";
import type { AssetLicense, AssetManifestEntry, AssetSource } from "../../contracts/types.js";
import type { MigrationAssetMapping } from "../../contracts/migration-types.js";
import type { AssetRegistry } from "./asset-registry.js";
import type { ProjectCatalog } from "./project-catalog.js";
import type { RevisionStore } from "./revision-store.js";

/**
 * MigratedAssetLedger (W2-G12, C-06, ASSET-01..03).
 *
 * M2.3 copied the source project's media into the target's `assets/` directory and wrote a
 * migration plan, but it copied no `Manifest@2` and the plan's asset rows carry no licence.
 * The result is a target holding bytes with no identity, no rights and no proof they are
 * the bytes the migration wrote — which is exactly the state in which "silently fall back
 * to reading the source project" becomes tempting. The frozen plan forbids that fallback.
 *
 * So the ledger is built once, by proof, and never by inference. A row may only exist if
 * three independent records agree about one file:
 *
 *   the source `Manifest@2`  (asset id, licence, origin, frame count)
 *   the migration plan        (source path -> target path, and the hash the migration wrote)
 *   the target bytes on disk  (hash and frame count, re-read now)
 *
 * Any disagreement, ambiguity or absence lands the bootstrap in `attention` and writes no
 * row at all. A partial ledger is worse than none: it would let M3 believe a mapping it
 * cannot prove.
 *
 * What it is *not*: it holds no frames, no clips, no ordering. Asset facts are a ledger of
 * what a file is, not a second timeline of what the film does (AC-015). The tables live in
 * the existing `RevisionStore` connection — same database, no second store.
 *
 * The ledger never writes author source, the source revision, or the target's active
 * commit. It is a Host-controlled read model, and the only way it changes is through a
 * bootstrap whose evidence hash is recorded alongside it.
 */

export interface MigratedAssetRecord {
  readonly project_id: string;
  readonly asset_id: string;
  readonly migration_id: string;
  readonly source_project_id: string;
  readonly source_manifest_sha256: string;
  readonly source_path: string;
  readonly target_path: string;
  readonly source_sha256: string;
  readonly target_sha256: string;
  readonly duration_frames: number;
  readonly media_type: string;
  readonly source: AssetSource;
  readonly license: AssetLicense;
}

export type LedgerBootstrapState = "prepared" | "active" | "attention";

export interface LedgerBootstrapRecord {
  readonly project_id: string;
  readonly migration_id: string;
  readonly state: LedgerBootstrapState;
  readonly input_digest: string;
  readonly control_revision: number;
  readonly attention_reason: string | null;
  readonly created_at: string;
}

/**
 * A source manifest row, carrying whether it satisfies the runtime contract on its own.
 * Kept off the persisted row: it is a fact about the *source* manifest, and the ledger's
 * own rows are only ever built from entries where it is true.
 */
type SourceManifestEntry = AssetManifestEntry & { readonly __contract_valid: boolean };

export interface BootstrapResult {
  readonly state: LedgerBootstrapState;
  readonly project_id: string;
  readonly migration_id: string;
  readonly input_digest: string;
  readonly seeded: number;
  readonly already_seeded: boolean;
  readonly reason: string | null;
}

export interface MigratedAssetLedgerDeps {
  /** Used for its migration records; the connection itself is composed from it. */
  readonly revisions: RevisionStore;
  /** Test-only seam for proving the seeding transaction is all-or-nothing. */
  readonly fault?: (point: LedgerBootstrapFaultPoint) => void;
  /** The legacy source of truth for the pre-migration project. */
  readonly registry: AssetRegistry;
  readonly catalog: ProjectCatalog;
  /** Root under which every migrated copy lives; target paths resolve inside it. */
  readonly migrationRoot: string;
}

/**
 * Injected so the atomicity claim is observable rather than asserted.
 *
 * These points sit *inside* the seeding transaction, so a fault here must leave nothing
 * behind at all — no `prepared` record, no asset rows. That is the property ASSET-03 is
 * about, and it cannot be proven by reading the code.
 */
/**
 * Migration states an activation-time seed may run at.
 *
 * It starts at `snapshot_published`, not `staged`: the ledger's proof includes the target's
 * bytes and their hash, and before the snapshot is published the copy is still being staged,
 * so seeding then would verify a tree that is about to change. It deliberately excludes
 * `aborted`, `attention` and `recovering` — seeding against a migration that failed, or that
 * needs a human to decide, is never right.
 */
const IN_FLIGHT_ACTIVATION: ReadonlySet<string> = new Set([
  "snapshot_published", "committed", "activated", "reported",
]);

export type LedgerBootstrapFaultPoint =
  | "after_prepared"
  | "after_rows"
  | "before_active";

export interface MigratedAssetLedgerDependencies {
  readonly fault?: (point: LedgerBootstrapFaultPoint) => void;
}

export interface BootstrapRequest {
  readonly projectId: string;
  /** Only seed when this is the migration that produced the target. */
  readonly migrationId?: string;
  /**
   * Declares that the caller is seeding *as part of* activation, before the migration
   * reaches its terminal state.
   *
   * ASSET-03 requires the ledger to exist before the migration becomes terminal, otherwise
   * there is a window where the project resolves and its ledger does not. That ordering
   * means the ledger must accept a migration that is still `committed` — but only when the
   * caller says so, and only for a migration on its forward path. The reverse situation is
   * harmless: a ledger whose migration never reached terminal leaves the project
   * unresolvable, because resolution requires the terminal state.
   */
  readonly activationPhase?: boolean;
  readonly now?: Date;
}

export class MigratedAssetLedger {
  readonly #db: DatabaseSync;
  readonly #dependencies: MigratedAssetLedgerDependencies;
  readonly #revisions: RevisionStore;
  readonly #registry: AssetRegistry;
  readonly #catalog: ProjectCatalog;
  readonly #migrationRoot: string;

  /**
   * Composed over the store's own connection so the ledger cannot become a second
   * database. Callers use `create` below, which is the only supported entry point.
   */
  private constructor(db: DatabaseSync, deps: MigratedAssetLedgerDeps) {
    this.#db = db;
    this.#dependencies = { ...(deps.fault === undefined ? {} : { fault: deps.fault }) };
    this.#revisions = deps.revisions;
    this.#registry = deps.registry;
    this.#catalog = deps.catalog;
    this.#migrationRoot = deps.migrationRoot;
    this.#migrate();
  }

  static create(deps: MigratedAssetLedgerDeps): MigratedAssetLedger {
    return deps.revisions.compose((db) => new MigratedAssetLedger(db, deps));
  }

  /**
   * Adds the two additive tables to the existing connection. Neither is created in a
   * separate database and neither carries a timeline.
   */
  #migrate(): void {
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS migrated_asset (
        project_id TEXT NOT NULL, asset_id TEXT NOT NULL, migration_id TEXT NOT NULL,
        source_project_id TEXT NOT NULL, source_manifest_sha256 TEXT NOT NULL,
        source_path TEXT NOT NULL, target_path TEXT NOT NULL,
        source_sha256 TEXT NOT NULL, target_sha256 TEXT NOT NULL,
        duration_frames INTEGER NOT NULL, media_type TEXT NOT NULL,
        source_json TEXT NOT NULL, license_json TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY (project_id, asset_id), UNIQUE (project_id, target_path)
      );
      CREATE TABLE IF NOT EXISTS asset_ledger_bootstrap (
        project_id TEXT PRIMARY KEY, migration_id TEXT NOT NULL, state TEXT NOT NULL,
        input_digest TEXT NOT NULL, control_revision INTEGER NOT NULL,
        attention_reason TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
        UNIQUE (project_id, input_digest)
      );
    `);
  }

  // ── reads ───────────────────────────────────────────────────────────────────────────

  assets(projectId: string): MigratedAssetRecord[] {
    return rowsOf(this.#db.prepare(
      "SELECT * FROM migrated_asset WHERE project_id=? ORDER BY asset_id").all(projectId)).map(migratedAssetRow);
  }

  get(projectId: string, assetId: string): MigratedAssetRecord | undefined {
    const rows = rowsOf(this.#db.prepare(
      "SELECT * FROM migrated_asset WHERE project_id=? AND asset_id=?").all(projectId, assetId));
    return rows[0] === undefined ? undefined : migratedAssetRow(rows[0]!);
  }

  bootstrapRecord(projectId: string): LedgerBootstrapRecord | undefined {
    const rows = rowsOf(this.#db.prepare("SELECT * FROM asset_ledger_bootstrap WHERE project_id=?").all(projectId));
    return rows[0] === undefined ? undefined : bootstrapRow(rows[0]!);
  }

  // ── bootstrap ───────────────────────────────────────────────────────────────────────

  /**
   * ASSET-01. Verifies the whole mapping, then writes it in one transaction.
   *
   * Idempotence is by evidence, not by flag: the `input_digest` is a hash over exactly
   * what was verified (migration id, captured source tree digest, source manifest hash,
   * plan asset rows). Re-running with the same evidence re-reports `active` without
   * rewriting rows; running with different evidence means something changed, which is a
   * reason to go to attention rather than to silently update the ledger.
   */
  async bootstrap(request: BootstrapRequest): Promise<BootstrapResult> {
    const now = request.now ?? new Date();
    // Read the record first. Whether `attention` is terminal is decided from the stored
    // state, not from what a fresh evidence gather happens to conclude this time.
    const existing = this.bootstrapRecord(request.projectId);
    if (existing?.state === "attention") {
      return {
        state: "attention", project_id: existing.project_id, migration_id: existing.migration_id,
        input_digest: existing.input_digest, seeded: 0, already_seeded: true,
        reason: existing.attention_reason,
      };
    }
    const evidence = await this.#gatherEvidence(request, now);
    if (evidence.state === "attention") return this.#attention(evidence, now, existing);
    if (evidence.state === "blocked") {
      throw new HttpError(404, "NOT_FOUND", "No migration produced this project", undefined, request.projectId);
    }

    if (existing !== undefined) {
      // Only an *active* record may be reported active. A `prepared` record is a torn
      // write: reporting it as active would hand a caller an "everything is seeded" answer
      // over a ledger that holds nothing, which is how a migration could go terminal with
      // no asset facts behind it.
      if (existing.state !== "active") {
        return this.#attention({ state: "attention", projectId: existing.project_id,
          migrationId: existing.migration_id, reason: "TORN_BOOTSTRAP_RECORD" }, now, existing);
      }
      if (existing.input_digest === evidence.inputDigest) {
        return { ...summary(evidence), state: "active", seeded: this.assets(evidence.projectId).length, already_seeded: true };
      }
      // The evidence changed under an active ledger. That is drift, not an update.
      return this.#attention({ state: "attention", projectId: evidence.projectId,
        migrationId: evidence.migrationId, reason: "EVIDENCE_CHANGED_AFTER_BOOTSTRAP" }, now, existing);
    }

    return this.#seed(evidence, now);
  }

  /**
   * ASSET-02. Re-reads every proof against the live filesystem and manifest.
   *
   * This can only ever move a ledger *into* `attention`. It never moves one out: a ledger
   * that has already been called a human's attention is a decision, not an observation,
   * and re-proving the bytes does not retract it.
   *
   * It also never *creates* a ledger. C-06 requires the legacy-target bootstrap to happen
   * once, before any Wave 2 write, and forbids it being triggered lazily by a request; a
   * read path that seeds itself is precisely that.
   */
  async reverify(request: BootstrapRequest): Promise<BootstrapResult> {
    const now = request.now ?? new Date();
    const current = this.bootstrapRecord(request.projectId);
    if (current === undefined) {
      // Verification never creates. C-06 requires the legacy-target bootstrap to happen
      // once, before any Wave 2 write, and explicitly forbids it being triggered lazily by
      // a request — a read that seeds itself is exactly that. An activated project with no
      // ledger has facts that were never established, so it fails closed.
      throw new HttpError(423, "PROJECT_ATTENTION_REQUIRED",
        "Migrated project has no asset ledger; its asset facts are not established",
        { recoverable: false, ledger: "asset_ledger_bootstrap" }, request.projectId);
    }
    if (current.state === "attention") {
      // Already a decision. Re-deriving the facts cannot retract it, and reading the
      // evidence again here would only risk rewriting the reason a human was called in.
      return {
        state: "attention", project_id: current.project_id, migration_id: current.migration_id,
        input_digest: current.input_digest, seeded: 0, already_seeded: true,
        reason: current.attention_reason,
      };
    }
    const evidence = await this.#gatherEvidence(request, now);
    if (evidence.state !== "verified") return this.#attention(evidence, now, current);
    const drift = this.#driftAgainst(current, evidence);
    if (drift === null) {
      return { ...summary(evidence), state: "active",
        seeded: this.assets(request.projectId).length, already_seeded: true };
    }
    return this.#attention({ state: "attention", projectId: evidence.projectId,
      migrationId: evidence.migrationId, reason: drift }, now, current);
  }

  /**
   * Predecessor-checked, and the complete state machine.
   *
   * Three edges exist and no others: `prepared -> active`, `prepared -> attention`,
   * `active -> attention`. Every self-loop, every edge back to `prepared`, and every exit
   * from `attention` are refused.
   *
   * `attention` is terminal on purpose. An earlier version allowed `attention -> active`,
   * which made the state meaningless: an operator could not rely on a ledger staying in
   * attention, and the licence judgement behind it was overwritten by the next read.
   * Reversing it requires a separate, explicit, audited operation carrying its own base
   * and control revision. That belongs to a later stage and is deliberately absent here.
   *
   * `active -> attention` is the one way out of `active`, and it exists precisely so a
   * contradicted fact can withdraw a claim, which is what ASSET-02 requires.
   */
  transitionBootstrap(projectId: string, from: LedgerBootstrapState, to: LedgerBootstrapState,
    now = new Date(), reason = ""): BootstrapResult {
    if (!((from === "prepared" && (to === "active" || to === "attention"))
      || (from === "active" && to === "attention"))) {
      throw new Error(`INVALID_LEDGER_BOOTSTRAP_TRANSITION:${from}->${to}`);
    }
    const record = this.bootstrapRecord(projectId);
    if (record === undefined || record.state !== from) {
      throw new Error(`INVALID_LEDGER_BOOTSTRAP_TRANSITION:${from}->${to}`);
    }
    const changes = Number(this.#db.prepare(
      "UPDATE asset_ledger_bootstrap SET state=?, attention_reason=?, control_revision=? WHERE project_id=? AND state=?",
    ).run(to, to === "attention" ? reason : "", record.control_revision + 1, projectId, from).changes);
    if (changes !== 1) throw new Error(`INVALID_LEDGER_BOOTSTRAP_TRANSITION:${from}->${to}`);
    return {
      state: to, project_id: projectId, migration_id: record.migration_id,
      input_digest: record.input_digest, seeded: this.assets(projectId).length,
      already_seeded: to === "active", reason: to === "attention" ? reason : null,
    };
  }

  /**
   * ASSET-03. Activation and seeding share one outcome: either the ledger rows and the
   * active bootstrap record are both durable, or neither is.
   */
  /**
   * ASSET-03. The bootstrap record, every asset row and the `active` transition commit in
   * one `RevisionStore.atomic` transaction.
   *
   * The first implementation committed `prepared` plus the rows, then transitioned to
   * `active` in a second transaction. A crash between them left a durable `prepared`
   * record: a project that looked bootstrapped, held no usable facts, and could never
   * leave `prepared` because nothing moves it forward. That is the "either fully visible or
   * nothing" requirement stated as a half-state nobody can classify.
   *
   * The `prepared -> active` move still happens through a predecessor-checked UPDATE, it
   * just happens inside the same transaction, so there is no instant at which the record
   * is committed as `prepared`.
   */
  #seed(evidence: Extract<Evidence, { state: "verified" }>, now: Date,
    dependencies: MigratedAssetLedgerDependencies = this.#dependencies): BootstrapResult {
    const at = now.toISOString();
    this.#revisions.atomic(() => {
      this.#db.prepare(
        `INSERT INTO asset_ledger_bootstrap(project_id, migration_id, state, input_digest, control_revision, attention_reason, created_at)
         VALUES(?,?,'prepared',?,?,'',?)`,
      ).run(evidence.projectId, evidence.migrationId, evidence.inputDigest, evidence.controlRevision, at);
      dependencies.fault?.("after_prepared");

      for (const row of evidence.rows) {
        this.#db.prepare(
          `INSERT INTO migrated_asset(project_id, asset_id, migration_id, source_project_id, source_manifest_sha256,
            source_path, target_path, source_sha256, target_sha256, duration_frames, media_type,
            source_json, license_json, created_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(
          row.project_id, row.asset_id, row.migration_id, row.source_project_id, row.source_manifest_sha256,
          row.source_path, row.target_path, row.source_sha256, row.target_sha256, row.duration_frames,
          row.media_type, canonicalJson(row.source), canonicalJson(row.license), at,
        );
      }
      dependencies.fault?.("after_rows");
      dependencies.fault?.("before_active");

      const moved = this.#db.prepare(
        "UPDATE asset_ledger_bootstrap SET state='active', control_revision=control_revision+1 WHERE project_id=? AND state='prepared'",
      ).run(evidence.projectId);
      if (Number(moved.changes) !== 1) {
        throw new Error(`INVALID_LEDGER_BOOTSTRAP_TRANSITION:prepared->active:${evidence.projectId}`);
      }
    });
    return {
      state: "active", project_id: evidence.projectId, migration_id: evidence.migrationId,
      input_digest: evidence.inputDigest, seeded: evidence.rows.length,
      already_seeded: false, reason: null,
    };
  }

  #attention(evidence: NotVerified, now: Date, existing?: LedgerBootstrapRecord): BootstrapResult {
    const reason = evidence.reason;
    if (existing !== undefined) {
      if (existing.state === "attention") {
        return { state: "attention", project_id: existing.project_id, migration_id: existing.migration_id,
          input_digest: existing.input_digest, seeded: 0, already_seeded: true, reason: existing.attention_reason };
      }
      return this.transitionBootstrap(evidence.projectId, existing.state, "attention", now, reason);
    }
    // A failed gather has no evidence hash, so the record is keyed by what was actually
    // proven plus the reason it was not; a later successful run is a different input and
    // therefore a different fact rather than an overwrite.
    const inputDigest = hashEvidence({
      migrationId: evidence.migrationId, sourceSha256Before: "", sourceManifestSha256: "",
      assets: [{ source_path: reason, target_path: "", sha256: "", asset_id: null }],
    });
    const at = now.toISOString();
    // Insert and resolve in ONE transaction. Doing the insert here and the transition in a
    // second one left a durable `prepared` record if the process died between them, which
    // is the half-state ASSET-03 forbids: it looks bootstrapped, holds nothing, and nothing
    // can move it forward. `#seed` learned this the same way.
    this.#revisions.atomic(() => {
      this.#db.prepare(
        `INSERT INTO asset_ledger_bootstrap(project_id, migration_id, state, input_digest, control_revision, attention_reason, created_at)
         VALUES(?,?,'attention',?,?,?,?)`,
      ).run(evidence.projectId, evidence.migrationId, inputDigest, 1, reason, at);
    });
    return {
      state: "attention", project_id: evidence.projectId, migration_id: evidence.migrationId,
      input_digest: inputDigest, seeded: 0, already_seeded: false, reason,
    };
  }

  // ── evidence ────────────────────────────────────────────────────────────────────────

  /**
   * Every proof, or a reason. Nothing here writes; the caller decides what a reason means.
   */
  async #gatherEvidence(request: BootstrapRequest, _now: Date): Promise<Evidence> {
    const projectId = request.projectId;
    const candidates = this.#revisions.migrations.all().filter((row) => row.target_project_id === projectId);
    if (candidates.length === 0) return { state: "blocked", projectId, migrationId: "", reason: "NO_MIGRATION" };

    const activation = request.activationPhase === true;
    const usable = candidates.filter((row) => row.state === "reported"
      || (activation && IN_FLIGHT_ACTIVATION.has(row.state)));
    if (usable.length !== 1) {
      return {
        state: "attention", projectId, migrationId: usable[0]?.migration_id ?? candidates[0]!.migration_id,
        reason: usable.length === 0 ? "MIGRATION_NOT_TERMINAL" : "AMBIGUOUS_MIGRATION",
      };
    }
    const migration = usable[0]!;
    if (request.migrationId !== undefined && request.migrationId !== migration.migration_id) {
      return { state: "attention", projectId, migrationId: migration.migration_id, reason: "FOREIGN_MIGRATION" };
    }

    // A target that already has a Wave 2 transaction has moved past the point where a
    // bootstrap may be inferred for it. Refuse rather than reconcile.
    if (this.#revisions.projectTransactions(projectId).length > 0) {
      return { state: "attention", projectId, migrationId: migration.migration_id, reason: "TARGET_ALREADY_WRITTEN" };
    }

    const sourceProjectId = migration.project_id;
    const controlRevision = this.#revisions.controlRevision(projectId, 1);

    // C-06: the source tree must still be exactly what the migration captured, or the
    // licence facts we are about to copy across are no longer migration-time facts.
    const sourceRoot = this.#catalog.descriptorRoot(sourceProjectId);
    let sourceTreeNow: string;
    try { sourceTreeNow = await treeDigest(sourceRoot); }
    catch (error) {
      // Distinct from the manifest failure below, and distinguished again by class: two
      // different reads failing for two different reasons were both reported as
      // "SOURCE_UNREADABLE", which made a transient I/O failure indistinguishable from a
      // corrupt manifest.
      return {
        state: "attention", projectId, migrationId: migration.migration_id,
        reason: `SOURCE_TREE_UNREADABLE:${failureClass(error)}`,
      };
    }
    if (sourceTreeNow !== migration.source_sha256_before) {
      return { state: "attention", projectId, migrationId: migration.migration_id, reason: "SOURCE_TREE_CHANGED" };
    }

    // Read the source manifest directly rather than through `AssetRegistry`. The registry
    // validates against `Manifest@2`, which admits only `video/mp4`; a real legacy project
    // carries a `Manifest@1` that also lists its narration audio and subtitles. Requiring
    // the registry's stricter reader here would make a perfectly ordinary source project
    // unmigratable, which would break MIG-01..04 to satisfy a W2.0 ledger.
    let manifest: { sha256: string; assets: SourceManifestEntry[] };
    try {
      manifest = await this.#readSourceManifest(sourceProjectId);
    } catch (error) {
      // The reason carries the *class* of failure, never its message: "unreadable" and
      // "out of memory" call for completely different responses, and collapsing them made
      // a memory failure look like a data problem.
      return {
        state: "attention", projectId, migrationId: migration.migration_id,
        reason: `SOURCE_MANIFEST_UNREADABLE:${failureClass(error)}`,
      };
    }

    const plan = this.#revisions.migrations.plan(migration.migration_id);
    if (plan === undefined) {
      return { state: "attention", projectId, migrationId: migration.migration_id, reason: "PLAN_UNREADABLE" };
    }
    const planned = plan.assets;

    // One-to-one in both directions. A manifest asset nobody copied, or a plan asset with no
    // manifest entry, both mean the mapping is not provable.
    const bySourcePath = new Map<string, SourceManifestEntry[]>();
    for (const entry of manifest.assets) {
      bySourcePath.set(entry.project_path, [...(bySourcePath.get(entry.project_path) ?? []), entry]);
    }
    const byTargetPath = new Map<string, MigrationAssetMapping[]>();
    for (const asset of planned) {
      byTargetPath.set(asset.target_path, [...(byTargetPath.get(asset.target_path) ?? []), asset]);
    }

    const rows: Array<MigratedAssetRecord | { reason: string }> = [];
    for (const asset of planned) {
      const sources = bySourcePath.get(asset.source_path) ?? [];
      if (sources.length !== 1 || byTargetPath.get(asset.target_path)!.length !== 1) {
        return {
          state: "attention", projectId, migrationId: migration.migration_id,
          reason: sources.length > 1 ? "SOURCE_PATH_AMBIGUOUS" : "TARGET_PATH_COLLISION",
        };
      }
      if (!sources[0]!.__contract_valid) {
        // The plan copied an asset whose source fact does not satisfy the runtime contract.
        return { state: "attention", projectId, migrationId: migration.migration_id,
          reason: "SOURCE_MANIFEST_ENTRY_INVALID" };
      }
      rows.push(await this.#verifyOne(projectId, migration.migration_id, sourceProjectId,
        manifest.sha256, asset, sources[0]!));
      continue;
    }

    // Bijection over the media the migration actually copied. A source manifest also lists
    // narration audio and subtitle files, which the migration carries in `narration` and
    // `subtitles` rather than `assets`; demanding they appear in `plan.assets` would be
    // demanding the plan contradict itself. What must hold is that every *video* asset the
    // source registered has a provable row in the ledger.
    const mappedSourcePaths = new Set(planned.map((asset) => asset.source_path));
    for (const entry of manifest.assets) {
      if (mappedSourcePaths.has(entry.project_path)) continue;
      if (!entry.__contract_valid || !isMigratedMedia(entry)) continue;
      return { state: "attention", projectId, migrationId: migration.migration_id, reason: "MANIFEST_ASSET_UNMAPPED" };
    }

    // Fail on the first unprovable row: a partially seeded ledger would let M3 believe a
    // mapping that was never established.
    for (const row of rows) {
      if ("reason" in row) {
        return { state: "attention", projectId, migrationId: migration.migration_id, reason: row.reason };
      }
    }
    const verified = rows as MigratedAssetRecord[];

    return {
      state: "verified", projectId, migrationId: migration.migration_id, controlRevision,
      inputDigest: hashEvidence({
        migrationId: migration.migration_id, sourceSha256Before: migration.source_sha256_before,
        sourceManifestSha256: manifest.sha256, assets: planned,
      }),
      rows: verified,
    };
  }

  /**
   * Reads the source project's asset manifest as a source fact, accepting `@1` and `@2`.
   *
   * The digest is taken over the file bytes, so it identifies exactly the manifest the
   * migration-time licence facts came from.
   */
  async #readSourceManifest(sourceProjectId: string): Promise<{ sha256: string; assets: SourceManifestEntry[] }> {
    const descriptor = await this.#catalog.readDescriptor(sourceProjectId);
    if (descriptor.asset_manifest === undefined || descriptor.asset_manifest === "") {
      throw new HttpError(422, "MISSING_ASSET", "Project has no asset manifest");
    }
    const root = await realpath(this.#catalog.descriptorRoot(sourceProjectId));
    const path = resolve(root, descriptor.asset_manifest);
    if (!path.startsWith(`${root}${sep}`)) throw new HttpError(403, "ORIGIN_REJECTED", "Manifest path escapes the project");
    const bytes = await readFile(path);
    if (bytes.byteLength > 1024 * 1024) throw new HttpError(422, "MISSING_ASSET", "Asset manifest exceeds the allowed size");
    let value: unknown;
    try { value = JSON.parse(bytes.toString("utf8")); }
    catch { throw new HttpError(422, "MISSING_ASSET", "Asset manifest is invalid"); }
    // Entries are validated individually, and only the ones the ledger actually maps.
    // A real legacy `Manifest@1` can carry a subtitle or narration row whose `media_type`
    // the `@2` contract does not admit; that says nothing about the video entries beside
    // it, and the ledger has no proof obligation over a row it never claims. Every entry a
    // row *is* built from is still checked against the runtime contract on its own, so
    // nothing slips through on the strength of its neighbours.
    const parsed = value as { assets?: unknown };
    if (!Array.isArray(parsed.assets)) {
      throw new HttpError(422, "MISSING_ASSET", "Asset manifest is not a Manifest@1/@2 document");
    }
    const format = valueFormatOf(value);
    const validateEntry = validatorFor(contractIds.assetManifest);
    // Validity is *recorded* per entry, not required here. A legacy `Manifest@1` can carry
    // a subtitle or narration row whose `media_type` the `@2` contract does not admit, and
    // refusing to read the whole file for a row the ledger never maps would make an ordinary
    // source project unusable. `#gatherEvidence` demands a valid entry for every asset it
    // actually maps, which is where the obligation belongs.
    const assets: SourceManifestEntry[] = (parsed.assets as Array<Record<string, unknown>>).map((candidate) => {
      const entry = candidate as unknown as SourceManifestEntry;
      return { ...entry, __contract_valid: validateEntry({ format, assets: [candidate] }) };
    });
    return { sha256: createHash("sha256").update(bytes).digest("hex"), assets };
  }

  /** One file, three records. Returns a row, or null plus the reason it is not provable. */
  async #verifyOne(projectId: string, migrationId: string, sourceProjectId: string,
    sourceManifestSha256: string, asset: MigrationAssetMapping, entry: SourceManifestEntry):
    Promise<MigratedAssetRecord | { reason: string }> {
    const targetPath = await this.#containedTarget(projectId, migrationId, asset.target_path);
    if (targetPath === null) return { reason: "TARGET_OUTSIDE_ROOT" };

    // Type before bytes: a directory or device would either fail the hash read or, worse,
    // block on it, and the distinction matters when deciding whether bytes are missing.
    let targetSha: string;
    try {
      if (!(await stat(targetPath)).isFile()) return { reason: "TARGET_NOT_A_FILE" };
      targetSha = await sha256File(targetPath);
    } catch { return { reason: "TARGET_BYTES_MISSING" }; }
    // Two hashes and the plan's own record must all agree before this is a fact.
    if (targetSha !== asset.sha256 || targetSha !== entry.sha256) return { reason: "TARGET_BYTES_DISAGREE" };

    let frames: number;
    try { frames = await this.#probeFrames(targetPath); }
    catch { return { reason: "TARGET_MEDIA_UNREADABLE" }; }
    if (frames !== entry.duration_frames) return { reason: "FRAME_COUNT_DISAGREES" };

    return {
      project_id: projectId, asset_id: entry.asset_id, migration_id: migrationId,
      source_project_id: sourceProjectId, source_manifest_sha256: sourceManifestSha256,
      source_path: asset.source_path, target_path: asset.target_path,
      source_sha256: entry.sha256, target_sha256: targetSha,
      duration_frames: entry.duration_frames, media_type: entry.media_type,
      source: entry.source, license: entry.license,
    };
  }

  async #containedTarget(projectId: string, migrationId: string, targetPath: string): Promise<string | null> {
    if (targetPath.length === 0 || targetPath.startsWith("/") || targetPath.split(/[\\/]/u).includes("..")) return null;
    let root: string;
    let migrationRoot: string;
    try {
      root = await realpath(resolve(this.#migrationRoot, migrationId));
      migrationRoot = await realpath(this.#migrationRoot);
    } catch { return null; }
    if (root !== migrationRoot && !root.startsWith(`${migrationRoot}${sep}`)) return null;
    // `..` and absolute paths are refused above, so `resolve` cannot leave the root here;
    // what it can still do is follow a symlinked directory component, which is what the
    // realpath check below exists for.
    const candidate = resolve(root, targetPath);
    let actual: string;
    try { actual = await realpath(candidate); }
    catch { return null; }
    // A symlink inside the target must not point outside it, or the "target bytes" are
    // somebody else's file and the hash comparison above proves nothing.
    if (actual !== candidate && !actual.startsWith(`${root}${sep}`)) return null;
    return actual;
  }

  async #probeFrames(path: string): Promise<number> {
    return await this.#registry.probeFrames(path);
  }

  /** What changed between what a live ledger claims and what the current evidence proves. */
  #driftAgainst(current: LedgerBootstrapRecord,
    evidence: Extract<Evidence, { state: "verified" }>): string | null {
    if (current.input_digest !== evidence.inputDigest) return "EVIDENCE_CHANGED_AFTER_BOOTSTRAP";
    const rows = this.assets(current.project_id);
    const proven = new Map(evidence.rows.map((row) => [row.asset_id, row]));
    if (rows.length !== proven.size) return "LEDGER_ROW_COUNT_CHANGED";
    for (const row of rows) {
      const now = proven.get(row.asset_id);
      if (now === undefined) return "LEDGER_ROW_UNPROVABLE";
      if (now.target_sha256 !== row.target_sha256) return "TARGET_BYTES_CHANGED";
      if (canonicalJson(now.license) !== canonicalJson(row.license)) return "LICENSE_CHANGED";
      if (now.duration_frames !== row.duration_frames) return "FRAME_COUNT_CHANGED";
    }
    return null;
  }
}

/**
 * The outcome of gathering proofs, as a discriminated union so a caller cannot read
 * `rows` from an evidence value that failed.
 */
type Evidence =
  | { readonly state: "verified"; readonly projectId: string; readonly migrationId: string;
      readonly controlRevision: number; readonly inputDigest: string; readonly rows: MigratedAssetRecord[] }
  | { readonly state: "attention"; readonly projectId: string; readonly migrationId: string; readonly reason: string }
  | { readonly state: "blocked"; readonly projectId: string; readonly migrationId: string; readonly reason: string };

type NotVerified = Extract<Evidence, { state: "attention" | "blocked" }>;

const summary = (evidence: Evidence): BootstrapResult => ({
  // `blocked` never reaches a caller as a result: it is turned into a thrown NOT_FOUND so a
  // project nobody migrated is indistinguishable from one that never existed.
  state: evidence.state === "verified" ? "active" : "attention",
  project_id: evidence.projectId, migration_id: evidence.migrationId,
  input_digest: evidence.state === "verified" ? evidence.inputDigest : "",
  seeded: evidence.state === "verified" ? evidence.rows.length : 0,
  already_seeded: false, reason: evidence.state === "verified" ? null : evidence.reason,
});

function hashEvidence(input: {
  migrationId: string; sourceSha256Before: string; sourceManifestSha256: string;
  assets: readonly MigrationAssetMapping[];
}): string {
  const digest = createHash("sha256");
  digest.update("narralens-asset-ledger-bootstrap-v1\n");
  digest.update(canonicalJson({
    migration_id: input.migrationId,
    source_sha256_before: input.sourceSha256Before,
    source_manifest_sha256: input.sourceManifestSha256,
    assets: input.assets.map((asset) => ({
      source_path: asset.source_path, target_path: asset.target_path, sha256: asset.sha256,
    })),
  }));
  return digest.digest("hex");
}

function migratedAssetRow(row: Record<string, unknown>): MigratedAssetRecord {
  return {
    project_id: String(row.project_id), asset_id: String(row.asset_id),
    migration_id: String(row.migration_id), source_project_id: String(row.source_project_id),
    source_manifest_sha256: String(row.source_manifest_sha256),
    source_path: String(row.source_path), target_path: String(row.target_path),
    source_sha256: String(row.source_sha256), target_sha256: String(row.target_sha256),
    duration_frames: Number(row.duration_frames), media_type: String(row.media_type),
    source: JSON.parse(String(row.source_json)) as AssetSource,
    license: JSON.parse(String(row.license_json)) as AssetLicense,
  };
}

function bootstrapRow(row: Record<string, unknown>): LedgerBootstrapRecord {
  return {
    project_id: String(row.project_id), migration_id: String(row.migration_id),
    state: String(row.state) as LedgerBootstrapState, input_digest: String(row.input_digest),
    control_revision: Number(row.control_revision),
    attention_reason: String(row.attention_reason) === "" ? null : String(row.attention_reason),
    created_at: String(row.created_at),
  };
}

/** A Node error code, or the error's constructor name. Never the message. */
function failureClass(error: unknown): string {
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && /^[A-Z][A-Z0-9_]*$/u.test(code)) return code;
  return error instanceof Error ? error.constructor.name : "unknown";
}

function valueFormatOf(value: unknown): "narralens.asset-manifest@1" | "narralens.asset-manifest@2" {
  const format = (value as { format?: unknown }).format;
  if (format === "narralens.asset-manifest@1" || format === "narralens.asset-manifest@2") return format;
  throw new HttpError(422, "MISSING_ASSET", "Asset manifest has an unknown format");
}

/**
 * Whether a source manifest entry is one of the media the migration copies into
 * `plan.assets`. Narration audio and subtitle files are carried in the plan's own
 * `narration`/`subtitles` rows and are not target asset rows.
 */
function isMigratedMedia(entry: SourceManifestEntry): boolean {
  if (/\.(vtt|srt|wav|mp3|m4a|aac|flac|ogg)$/iu.test(entry.project_path)) return false;
  return entry.media_type.startsWith("video/");
}

function rowsOf(rows: unknown): Array<Record<string, unknown>> {
  return rows as Array<Record<string, unknown>>;
}
