import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { HttpError } from "../api-error.js";
import type { MaterializationState, MaterializationV1, MaterializationProxy, LineageEntryV1, NativePlanV1 } from "../../contracts/wave2-types.js";
import { canonicalJson } from "../engine/source-digest-v1.js";
import { validatorFor, contractIds } from "../../contracts/validator.js";
import type { RevisionStore } from "../projects/revision-store.js";

/**
 * The materialization read model (M3.1).
 *
 * A materialization is a *discardable preparation fact*. It can be thrown away and rebuilt
 * from the comparison, the asset ledger and the bindings, which is precisely why it must
 * never be mistaken for content. The authoritative facts stay where they belong — the
 * comparison owns the intent, the ledger owns the assets, the bindings own the frame
 * mapping — and this row records only what was believed, at a moment, by whom.
 *
 * That is why every mutable fact is stored separately and re-checked on read. A row whose
 * base revision, source digest, control revision, inventory digest or rights digest no longer
 * agrees with the world is `stale`, and `stale` is not upgradeable: a materialization whose
 * premises moved has to be rebuilt as a new one, not talked out of it. Auto-recovering would
 * mean the row silently starts asserting things nobody re-verified.
 *
 * Nothing here is a timeline. The plan is stored as opaque JSON that has passed the runtime
 * contract, never as columns that could be read as a second authoritative sequence.
 */

/** The whole state machine, in one place. */
const TRANSITIONS: Readonly<Record<string, readonly MaterializationState[]>> = Object.freeze({
  queued: ["running", "cancel_requested", "failed", "attention", "stale"],
  running: ["validating", "cancel_requested", "failed", "attention", "stale"],
  validating: ["ready_for_adoption", "cancel_requested", "failed", "attention", "stale"],
  ready_for_adoption: ["stale", "cancelled"],
  stale: ["cancelled"],
  cancel_requested: ["cancelled", "attention"],
  cancelled: [],
  failed: [],
  attention: [],
});

export interface ReplayLineage {
  readonly recorded_stdout_sha256: string;
  readonly recorded_payload_sha256: string;
  /** Always `RECORDED_PROVIDER_OUTPUT_REPLAY`: this is not a new provider call. */
  readonly mode: "RECORDED_PROVIDER_OUTPUT_REPLAY";
}

export interface CreateMaterialization {
  readonly materializationId: string;
  readonly projectId: string;
  readonly comparisonId: string;
  readonly proposalId: string;
  readonly jobId: string;
  readonly baseRevision: number;
  readonly sourceDigest: string;
  readonly controlRevision: number;
  readonly proposalSha256: string;
  readonly assetInventorySha256: string;
  readonly rightsDigest: string;
  /** Canonical hash of the request; the idempotency key is bound to this. */
  readonly requestDigest: string;
  readonly idempotencyKey: string;
  /**
   * The bindings the caller asked for, kept verbatim so the worker re-reads what was asked
   * rather than what a caller might send later. They live in the table and not in the view:
   * `MaterializationV1` is frozen and a request echo does not belong in a response.
   */
  readonly requestedBindings: ReadonlyArray<{
    segment_id: string; asset_id: string;
    source_start_frame: number; source_end_frame_exclusive: number;
  }>;
  readonly replay?: ReplayLineage;
  readonly now?: Date;
}

interface MaterializationRow {
  readonly materialization_id: string;
  readonly project_id: string;
  readonly job_id: string;
  readonly comparison_id: string;
  readonly proposal_id: string;
  readonly state: MaterializationState;
  readonly base_revision: number;
  readonly source_digest: string;
  readonly control_revision: number;
  readonly proposal_sha256: string;
  readonly asset_inventory_sha256: string;
  readonly rights_digest: string;
  readonly request_digest: string;
  readonly idempotency_key: string;
  readonly plan_json: string | null;
  readonly proxy_json: string | null;
  readonly lineage_json: string | null;
  readonly blocking_json: string;
  readonly request_json: string;
  readonly replay_json: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export class MaterializationStore {
  readonly #db: DatabaseSync;

  constructor(revisions: RevisionStore) {
    this.#db = revisions.compose((db) => db);
    this.#migrate();
  }

  #migrate(): void {
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS materialization (
        materialization_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, job_id TEXT NOT NULL,
        comparison_id TEXT NOT NULL, proposal_id TEXT NOT NULL, state TEXT NOT NULL,
        base_revision INTEGER NOT NULL, source_digest TEXT NOT NULL, control_revision INTEGER NOT NULL,
        proposal_sha256 TEXT NOT NULL, asset_inventory_sha256 TEXT NOT NULL, rights_digest TEXT NOT NULL,
        request_digest TEXT NOT NULL, idempotency_key TEXT NOT NULL, request_json TEXT NOT NULL,
        plan_json TEXT, proxy_json TEXT, lineage_json TEXT,
        blocking_json TEXT NOT NULL DEFAULT '[]', replay_json TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE (project_id, idempotency_key)
      );
      CREATE TABLE IF NOT EXISTS operation_idempotency (
        project_id TEXT NOT NULL, operation_kind TEXT NOT NULL, idempotency_key TEXT NOT NULL,
        request_digest TEXT NOT NULL, response_json TEXT NOT NULL,
        transaction_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
        PRIMARY KEY (project_id, operation_kind, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS materialization_by_job ON materialization (job_id);
      CREATE INDEX IF NOT EXISTS materialization_by_state ON materialization (state, updated_at);
    `);
  }

  /**
   * Idempotent by evidence: the same key with the same request digest returns the original
   * row; a different digest is a conflict the caller has to resolve, not a replacement.
   */
  async create(input: CreateMaterialization): Promise<MaterializationV1> {
    const existing = this.#byKey(input.projectId, input.idempotencyKey);
    if (existing !== undefined) {
      if (existing.request_digest !== input.requestDigest) {
        throw new HttpError(409, "IDEMPOTENCY_KEY_CONFLICT",
          "This idempotency key was used with a different request",
          { materialization_id: existing.materialization_id }, input.projectId);
      }
      return toView(existing);
    }
    const at = (input.now ?? new Date()).toISOString();
    this.#db.prepare(
      `INSERT INTO materialization(materialization_id, project_id, job_id, comparison_id, proposal_id, state,
        base_revision, source_digest, control_revision, proposal_sha256, asset_inventory_sha256, rights_digest,
        request_digest, idempotency_key, blocking_json, replay_json, request_json, created_at, updated_at)
       VALUES(?,?,?,?,?,'queued',?,?,?,?,?,?,?,?,'[]',?,?,?,?)`,
    ).run(input.materializationId, input.projectId, input.jobId, input.comparisonId, input.proposalId,
      input.baseRevision, input.sourceDigest, input.controlRevision, input.proposalSha256,
      input.assetInventorySha256, input.rightsDigest, input.requestDigest, input.idempotencyKey,
      input.replay === undefined ? null : JSON.stringify(input.replay),
      canonicalJson({ bindings: input.requestedBindings }), at, at);
    return this.require(input.materializationId);
  }

  /** The bindings the request asked for, as recorded. */
  requestedBindingsOf(materializationId: string): Array<{
    segment_id: string; asset_id: string;
    source_start_frame: number; source_end_frame_exclusive: number;
  }> {
    const row = this.#requireRow("materialization_id = ?", materializationId);
    return (JSON.parse(row.request_json) as { bindings: Array<{
      segment_id: string; asset_id: string;
      source_start_frame: number; source_end_frame_exclusive: number;
    }> }).bindings;
  }

  require(materializationId: string): MaterializationV1 {
    const row = this.#select("materialization_id = ?", materializationId);
    if (row === undefined) throw new HttpError(404, "NOT_FOUND", "Materialization not found");
    return toView(row);
  }

  find(materializationId: string): MaterializationV1 | undefined {
    const row = this.#select("materialization_id = ?", materializationId);
    return row === undefined ? undefined : toView(row);
  }

  byProject(projectId: string): MaterializationV1[] {
    return this.#db.prepare("SELECT * FROM materialization WHERE project_id=? ORDER BY created_at")
      .all(projectId).map((row) => toView(row as unknown as MaterializationRow));
  }

  byJob(jobId: string): MaterializationV1 | undefined {
    const row = this.#select("job_id = ?", jobId);
    return row === undefined ? undefined : toView(row);
  }

  /** Rows a worker should pick up: anything not yet terminal. */
  runnable(now = new Date()): MaterializationV1[] {
    return this.#db.prepare(
      "SELECT * FROM materialization WHERE state IN ('queued','running','validating','cancel_requested') ORDER BY created_at",
    ).all().map((row) => toView(row as unknown as MaterializationRow));
  }

  // ── payload writers ────────────────────────────────────────────────────────────────
  // Each of these is a separate statement so a crash between them leaves a state that
  // `ready_for_adoption` refuses: a row missing its plan or proxy cannot be promoted.

  /**
   * The plan is validated on its own, embedded in a minimal envelope.
   *
   * Validating the whole row here would be wrong in both directions: the row is being built
   * up one artefact at a time, so it always fails the parts not yet written — and a
   * failure about `lineage` would be reported as though the *plan* were wrong. The envelope
   * satisfies the rest of the contract so the only thing under test is the plan, and the
   * runtime schema stays the single source of truth rather than a second validator here.
   */
  /**
   * Records the facts the worker actually proved.
   *
   * The request cannot know the inventory or rights digests — those are established when the
   * bindings are re-read — so the row starts without them and gets them here. Writing a
   * placeholder at request time would make every later read look like drift, which is how
   * "re-verify on every read" turns into "everything is stale".
   */
  setProvenFacts(materializationId: string, facts: {
    proposalSha256: string; assetInventorySha256: string; rightsDigest: string;
  }, now = new Date()): void {
    this.#db.prepare(
      `UPDATE materialization SET proposal_sha256=?, asset_inventory_sha256=?, rights_digest=?, updated_at=?
       WHERE materialization_id=?`,
    ).run(facts.proposalSha256, facts.assetInventorySha256, facts.rightsDigest,
      now.toISOString(), materializationId);
  }

  /** Facts the worker has not proven yet are recorded as empty, never guessed. */
  setPendingFacts(materializationId: string, now = new Date()): void {
    this.#db.prepare(
      `UPDATE materialization SET proposal_sha256='', asset_inventory_sha256='', rights_digest='', updated_at=?
       WHERE materialization_id=?`,
    ).run(now.toISOString(), materializationId);
  }

  async setPlan(materializationId: string, plan: NativePlanV1): Promise<void> {
    assertValidPlan(plan);
    this.#db.prepare("UPDATE materialization SET plan_json=?, updated_at=? WHERE materialization_id=?")
      .run(JSON.stringify(plan), new Date().toISOString(), materializationId);
  }

  async setProxy(materializationId: string, proxy: MaterializationProxy): Promise<void> {
    this.#db.prepare("UPDATE materialization SET proxy_json=?, updated_at=? WHERE materialization_id=?")
      .run(JSON.stringify(proxy), new Date().toISOString(), materializationId);
  }

  async setLineage(materializationId: string, lineage: readonly LineageEntryV1[]): Promise<void> {
    this.#db.prepare("UPDATE materialization SET lineage_json=?, updated_at=? WHERE materialization_id=?")
      .run(JSON.stringify(lineage), new Date().toISOString(), materializationId);
  }

  // ── state machine ──────────────────────────────────────────────────────────────────

  /**
   * Predecessor-checked. The UPDATE carries the expected state, so a worker holding a stale
   * view cannot advance a row that moved on underneath it.
   */
  transition(materializationId: string, from: MaterializationState, to: MaterializationState,
    now = new Date()): MaterializationV1 {
    return this.transitionFrom(materializationId, from, to, now, []);
  }

  /** As `transition`, but the caller must also satisfy the readiness preconditions. */
  transitionFrom(materializationId: string, from: MaterializationState, to: MaterializationState,
    now = new Date(), _unused?: readonly never[]): MaterializationV1 {
    const allowed = TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) {
      throw new Error(`INVALID_MATERIALIZATION_TRANSITION:${from}->${to}`);
    }
    if (to === "ready_for_adoption") this.#assertReady(materializationId);
    const changes = Number(this.#db.prepare(
      "UPDATE materialization SET state=?, updated_at=? WHERE materialization_id=? AND state=?",
    ).run(to, now.toISOString(), materializationId, from).changes);
    if (changes !== 1) throw new Error(`INVALID_MATERIALIZATION_TRANSITION:${from}->${to}`);
    return this.require(materializationId);
  }

  /**
   * `ready_for_adoption` is a promise about completeness, so it checks the three artefacts
   * rather than trusting the caller to have set them.
   */
  #assertReady(materializationId: string): void {
    const row = this.#requireRow("materialization_id = ?", materializationId);
    const missing: string[] = [];
    if (row.plan_json === null) missing.push("native_plan");
    if (row.proxy_json === null) missing.push("proxy");
    if (row.lineage_json === null) missing.push("lineage");
    if (missing.length > 0) {
      throw new HttpError(422, "INVALID_MEDIA", `Materialization is not complete: ${missing.join(",")}`,
        { missing }, materializationId);
    }
    const lineage = JSON.parse(row.lineage_json ?? "[]") as LineageEntryV1[];
    const outputs = new Set(lineage.map((entry) => entry.output_sha256));
    const proxy = JSON.parse(row.proxy_json!) as MaterializationProxy;
    if (!outputs.has(proxy.sha256)) {
      throw new HttpError(422, "INVALID_MEDIA", "The proxy is not covered by the lineage",
        { proxy_sha256: proxy.sha256 }, materializationId);
    }
  }

  /**
   * Drift, with reasons. Reached from `running`, `validating` or `ready_for_adoption`;
   * never from a terminal state, so a cancelled or failed materialization cannot be
   * relabelled as merely stale.
   */
  markStale(materializationId: string, reasons: readonly string[], now = new Date()): MaterializationV1 {
    const from = this.#requireRow("materialization_id = ?", materializationId).state;
    if (!(TRANSITIONS[from] ?? []).includes("stale")) {
      throw new Error(`INVALID_MATERIALIZATION_TRANSITION:${from}->stale`);
    }
    const changes = Number(this.#db.prepare(
      "UPDATE materialization SET state='stale', blocking_json=?, updated_at=? WHERE materialization_id=? AND state=?",
    ).run(JSON.stringify([...reasons]), now.toISOString(), materializationId, from).changes);
    if (changes !== 1) throw new Error(`INVALID_MATERIALIZATION_TRANSITION:${from}->stale`);
    return this.require(materializationId);
  }

  /**
   * A late result, or a torn one, is parked rather than resolved.
   *
   * `attention` is terminal here too: an artifact nobody can attribute must not become
   * adoptable by asking again later.
   */
  quarantine(materializationId: string, lineage: readonly LineageEntryV1[], now = new Date()): MaterializationV1 {
    const from = this.#requireRow("materialization_id = ?", materializationId).state;
    if (!(TRANSITIONS[from] ?? []).includes("attention")) {
      throw new Error(`INVALID_MATERIALIZATION_TRANSITION:${from}->attention`);
    }
    // The quarantined lineage is *recorded*, not discarded: an artifact nobody can attribute
    // has to be visible, or the later question "what did that worker leave behind?" has no
    // answer. The UPDATE carries the expected state, so a row that moved on is not overwritten.
    const changes = Number(this.#db.prepare(
      `UPDATE materialization SET state='attention', lineage_json=?, updated_at=?
       WHERE materialization_id=? AND state=?`,
    ).run(JSON.stringify([...lineage]), now.toISOString(), materializationId, from).changes);
    if (changes !== 1) throw new Error(`INVALID_MATERIALIZATION_TRANSITION:${from}->attention`);
    return this.require(materializationId);
  }

  /**
   * Replay lineage, when the comparison behind this materialization was rebuilt from
   * recorded provider output rather than a fresh call.
   *
   * Deliberately not a field of `MaterializationV1`. That contract is frozen, and the
   * provenance of a comparison belongs with the comparison: `generation_audit.stdout_sha256`
   * already carries the recorded runner's own hash. This is an audit view for evidence, not
   * a wire addition.
   */
  replayOf(materializationId: string): ReplayLineage | undefined {
    const row = this.#select("materialization_id = ?", materializationId);
    if (row?.replay_json === null || row?.replay_json === undefined) return undefined;
    return JSON.parse(row.replay_json) as ReplayLineage;
  }

  /** Drop a derived preparation fact. Content is untouched: this only forgets an attempt. */
  remove(materializationId: string): void {
    this.#db.prepare("DELETE FROM materialization WHERE materialization_id=?").run(materializationId);
  }

  // ── generic operation idempotency (project + kind + key) ───────────────────────────

  /** The single authority for Wave 2 idempotency; never writes the legacy edit table. */
  rememberOperation(input: {
    projectId: string; operationKind: string; idempotencyKey: string;
    requestDigest: string; response: unknown; transactionId?: string; now?: Date;
  }): { replayed: boolean; response: unknown } {
    const found = this.#db.prepare(
      "SELECT request_digest, response_json FROM operation_idempotency WHERE project_id=? AND operation_kind=? AND idempotency_key=?",
    ).get(input.projectId, input.operationKind, input.idempotencyKey) as
      { request_digest?: unknown; response_json?: unknown } | undefined;
    if (found !== undefined) {
      if (String(found.request_digest) !== input.requestDigest) {
        throw new HttpError(409, "IDEMPOTENCY_KEY_CONFLICT",
          "This idempotency key was used with a different request",
          { operation_kind: input.operationKind }, input.projectId);
      }
      return { replayed: true, response: JSON.parse(String(found.response_json)) as unknown };
    }
    this.#db.prepare(
      `INSERT INTO operation_idempotency(project_id, operation_kind, idempotency_key, request_digest, response_json, transaction_id, created_at)
       VALUES(?,?,?,?,?,?,?)`,
    ).run(input.projectId, input.operationKind, input.idempotencyKey, input.requestDigest,
      JSON.stringify(input.response), input.transactionId ?? "",
      (input.now ?? new Date()).toISOString());
    return { replayed: false, response: input.response };
  }

  forgetOperation(projectId: string, operationKind: string, idempotencyKey: string): void {
    this.#db.prepare(
      "DELETE FROM operation_idempotency WHERE project_id=? AND operation_kind=? AND idempotency_key=?",
    ).run(projectId, operationKind, idempotencyKey);
  }

  // ── internals ──────────────────────────────────────────────────────────────────────

  #byKey(projectId: string, idempotencyKey: string): MaterializationRow | undefined {
    return this.#select("project_id = ? AND idempotency_key = ?", projectId, idempotencyKey);
  }

  #select(where: string, ...values: SQLInputValue[]): MaterializationRow | undefined {
    const row = this.#db.prepare(`SELECT * FROM materialization WHERE ${where}`).get(...values) as
      Record<string, unknown> | undefined;
    return row === undefined ? undefined : toRow(row);
  }

  #requireRow(where: string, ...values: SQLInputValue[]): MaterializationRow {
    const row = this.#select(where, ...values);
    if (row === undefined) throw new HttpError(404, "NOT_FOUND", "Materialization not found");
    return row;
  }
}

function toRow(row: Record<string, unknown>): MaterializationRow {
  const optional = (value: unknown): string | null =>
    value === null || value === undefined ? null : String(value);
  return {
    materialization_id: String(row.materialization_id), project_id: String(row.project_id),
    job_id: String(row.job_id), comparison_id: String(row.comparison_id),
    proposal_id: String(row.proposal_id), state: String(row.state) as MaterializationState,
    base_revision: Number(row.base_revision), source_digest: String(row.source_digest),
    control_revision: Number(row.control_revision), proposal_sha256: String(row.proposal_sha256),
    asset_inventory_sha256: String(row.asset_inventory_sha256), rights_digest: String(row.rights_digest),
    request_digest: String(row.request_digest), idempotency_key: String(row.idempotency_key),
    plan_json: optional(row.plan_json), proxy_json: optional(row.proxy_json),
    lineage_json: optional(row.lineage_json),
    blocking_json: String(row.blocking_json ?? "[]"), replay_json: optional(row.replay_json),
    request_json: String(row.request_json ?? '{"bindings":[]}'),
    created_at: String(row.created_at), updated_at: String(row.updated_at),
  };
}

function toView(row: MaterializationRow): MaterializationV1 {
  return {
    format: "narralens.materialization@1.0",
    materialization_id: row.materialization_id, job_id: row.job_id, project_id: row.project_id,
    comparison_id: row.comparison_id, proposal_id: row.proposal_id, state: row.state,
    base_revision: row.base_revision, source_digest: row.source_digest,
    control_revision: row.control_revision, proposal_sha256: row.proposal_sha256,
    asset_inventory_sha256: row.asset_inventory_sha256, rights_digest: row.rights_digest,
    request_digest: row.request_digest,
    native_plan: row.plan_json === null ? null : JSON.parse(row.plan_json) as NativePlanV1,
    proxy: row.proxy_json === null ? null : JSON.parse(row.proxy_json) as MaterializationProxy,
    lineage: row.lineage_json === null ? [] : JSON.parse(row.lineage_json) as LineageEntryV1[],
    blocking_reasons: JSON.parse(row.blocking_json) as string[],
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

/** Replays the runtime contract on a plan alone, so a bad plan cannot land. */
function assertValidPlan(plan: NativePlanV1): void {
  const placeholder = "0".repeat(64);
  const envelope = {
    format: "narralens.materialization@1.0", materialization_id: "m", job_id: "j", project_id: "p",
    comparison_id: "c", proposal_id: "r", state: "running", base_revision: 0, source_digest: placeholder,
    control_revision: 0, proposal_sha256: placeholder, asset_inventory_sha256: placeholder,
    rights_digest: placeholder, request_digest: placeholder,
    native_plan: plan,
    proxy: { token: "proxies/placeholder", sha256: placeholder, frame_count: 1, profile_id: "p" },
    lineage: [{ output_sha256: placeholder, input_asset_id: "a", input_sha256: placeholder,
      source: { start_frame: 0, end_frame_exclusive: 1 }, output: { start_frame: 0, end_frame_exclusive: 1 } }],
    blocking_reasons: [], created_at: "1970-01-01T00:00:00.000Z", updated_at: "1970-01-01T00:00:00.000Z",
  };
  if (!validatorFor(contractIds.materialization)(envelope)) {
    throw new HttpError(422, "INVALID_MEDIA", "Refusing to store a native plan that does not satisfy the contract");
  }
}
