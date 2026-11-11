import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Brief, CreateProject, JobReceipt, BootstrapResult } from '../../contracts/agent-driven-types.js';
import type { AssetLicense, AssetSource } from '../../contracts/types.js';
import { validateAgentDefinition, validateAgentRouteInput } from '../../contracts/agent-driven-validator.js';
import { matchesFrozenSchemaNamespace } from '../agent-driven/agent-schema-definition.js';
import { ProductSqliteRepository } from '../agent-driven/product-sqlite-repository.js';
import { canonicalJson, canonicalDigest, contentDigest } from '../creative/digest.js';
import { creativeInputClosure, assertIntakeOwner } from '../creative/creative-closure.js';
import { assertBriefConsistency } from '../creative/creative-service.js';
import type { ProductTransaction, BootstrapCommandRecord, ProjectOriginRecord } from '../creative/product-repository.js';
import { ProductError } from '../creative/trusted-context.js';
import { OPENFILM_UPSTREAM_SHA } from '../engine/engine-binding-store.js';
import { assertSafeRelativePath } from '../render/snapshot-copy.js';
import type { CreationSourceVerifier, VerifiedCreationSource } from './creation-source-verifier.js';
import { RevisionStore } from './revision-store.js';
import { snapshotIdFor, type PublishedSnapshot } from './snapshot-store.js';
export interface CreatedAssetFact {
    readonly asset_id: string;
    readonly path: string;
    readonly sha256: string;
    readonly bytes: number;
    readonly media_type: string;
    readonly duration_frames: number;
    readonly source: AssetSource;
    readonly license: AssetLicense;
}
export interface CreatedSourceFact {
    readonly schema_version: 1;
    readonly roots: readonly string[];
    readonly subtitles: readonly {
        readonly subtitle_id: string;
        readonly path: string;
    }[];
    readonly frame_count: number;
    readonly fps: {
        readonly num: number;
        readonly den: number;
    };
    readonly assets: readonly CreatedAssetFact[];
}
export interface CreationReservation {
    readonly command_id: string;
    readonly project_id: string;
    readonly job_id: string;
    readonly transaction_id: string;
    readonly request: CreateProject;
    readonly brief: Brief;
    readonly brief_digest: string;
    readonly closure_digest: string;
    readonly accepted: JobReceipt;
    readonly state: BootstrapCommandRecord['state'];
    readonly result: BootstrapResult | null;
}
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const HASH = /^[a-f0-9]{64}$/;
const DDL = `CREATE TABLE IF NOT EXISTS created_source_fact(
 project_id TEXT NOT NULL,snapshot_id TEXT NOT NULL,fact_json TEXT NOT NULL CHECK(json_valid(fact_json)),fact_sha256 TEXT NOT NULL CHECK(length(fact_sha256)=64),
 PRIMARY KEY(project_id,snapshot_id),FOREIGN KEY(project_id,snapshot_id) REFERENCES snapshot(project_id,snapshot_id));
 CREATE TRIGGER IF NOT EXISTS created_source_fact_no_update BEFORE UPDATE ON created_source_fact BEGIN SELECT RAISE(ABORT,'IMMUTABLE_CREATED_SOURCE_FACT'); END;
 CREATE TRIGGER IF NOT EXISTS created_source_fact_no_delete BEFORE DELETE ON created_source_fact BEGIN SELECT RAISE(ABORT,'IMMUTABLE_CREATED_SOURCE_FACT'); END;`;
const conflict = () => new ProductError('REVISION_CONFLICT', 'The creation facts changed');
const guard = () => new ProductError('APPROVAL_REQUIRED', 'A current trusted creation confirmation is required');
export const CREATION_COMMIT_BOUNDARIES = ['state', 'binding', 'snapshot', 'transaction', 'pointer', 'source_fact', 'origin', 'brief', 'command', 'job', 'outbox'] as const;
export type CreationCommitBoundary = (typeof CREATION_COMMIT_BOUNDARIES)[number];
export function validateCreatedSourceFact(fact: CreatedSourceFact): CreatedSourceFact {
    if (!fact || Object.keys(fact).sort().join(',') !== 'assets,fps,frame_count,roots,schema_version,subtitles' || fact.schema_version !== 1 || !Number.isSafeInteger(fact.frame_count) || fact.frame_count < 0 || !fact.fps || Object.keys(fact.fps).sort().join(',') !== 'den,num' || ![fact.fps.num, fact.fps.den].every(n => Number.isSafeInteger(n) && n > 0) || !Array.isArray(fact.roots) || fact.roots[0] !== 'film.html' || new Set(fact.roots).size !== fact.roots.length || !Array.isArray(fact.assets) || !Array.isArray(fact.subtitles))
        throw conflict();
    for (const path of fact.roots)
        assertSafeRelativePath(path);
    const ids = new Set<string>(), paths = new Set<string>();
    for (const asset of fact.assets) {
        if (!asset || Object.keys(asset).sort().join(',') !== 'asset_id,bytes,duration_frames,license,media_type,path,sha256,source' || !ID.test(asset.asset_id) || ids.has(asset.asset_id) || typeof asset.path !== 'string' || paths.has(asset.path) || !fact.roots.includes(asset.path) || !HASH.test(asset.sha256) || !Number.isSafeInteger(asset.bytes) || asset.bytes < 0 || !Number.isSafeInteger(asset.duration_frames) || asset.duration_frames < 0 || typeof asset.media_type !== 'string' || !asset.license || !['cleared', 'restricted', 'unknown'].includes(asset.license.status) || typeof asset.license.commercial_use !== 'boolean' || typeof asset.license.label !== 'string' || !asset.source || !['owned', 'generated', 'licensed', 'derived'].includes(asset.source.kind) || typeof asset.source.label !== 'string')
            throw conflict();
        assertSafeRelativePath(asset.path);
        ids.add(asset.asset_id);
        paths.add(asset.path);
    }
    const subtitleIds = new Set<string>();
    for (const subtitle of fact.subtitles) {
        if (!subtitle || Object.keys(subtitle).sort().join(',') !== 'path,subtitle_id' || !ID.test(subtitle.subtitle_id) || subtitleIds.has(subtitle.subtitle_id) || !fact.roots.includes(subtitle.path))
            throw conflict();
        assertSafeRelativePath(subtitle.path);
        subtitleIds.add(subtitle.subtitle_id);
    }
    return JSON.parse(canonicalJson(fact)) as CreatedSourceFact;
}
/** MAIN's bootstrap commit store. All state uses the existing shared SQLite connection. */
export class ProjectCreationStore {
    readonly #db: DatabaseSync;
    readonly #repository: ProductSqliteRepository;
    #schemaVersion = 0;
    constructor(readonly revisions: RevisionStore, private readonly now: () => Date = () => new Date(), private readonly verifier?: CreationSourceVerifier) {
        this.#repository = new ProductSqliteRepository(revisions);
        this.#db = revisions.compose(db => db);
        if (this.#db.prepare("SELECT 1 FROM sqlite_schema WHERE name GLOB 'created_source_fact*' LIMIT 1").get()) {
            if (!matchesFrozenSchemaNamespace(this.#db, DDL, 'created_source_fact'))
                throw conflict();
        }
        else
            revisions.atomic(() => { this.#db.exec(DDL); if (!matchesFrozenSchemaNamespace(this.#db, DDL, 'created_source_fact'))
                throw conflict(); });
        this.#schemaVersion = Number(this.#db.prepare('PRAGMA schema_version').get()?.schema_version);
    }
    async reserve(raw: CreateProject, principal: string): Promise<CreationReservation> {
        const request = validateAgentRouteInput('project.create', raw), digest = contentDigest(request);
        if (!ID.test(principal))
            throw guard();
        return this.#repository.transaction(tx => {
            this.assertSchema();
            const now = this.now();
            const old = tx.list('bootstrap_command', { principal_id: principal, operation: 'project.create' }).find(row => row.idempotency_key === request.meta.idempotency_key);
            if (old) {
                if (old.request_digest !== digest)
                    throw new ProductError('IDEMPOTENCY_CONFLICT', 'The key belongs to a different creation');
                return this.decode(old);
            }
            const { brief, briefDigest, closureDigest } = this.confirmed(tx, request, principal, now);
            const token = randomUUID().replaceAll('-', ''), projectId = 'project_' + token, commandId = 'create_' + token, jobId = 'job_' + token, transactionId = 'txn_' + token;
            const accepted = validateAgentDefinition<JobReceipt>('JobReceipt', { job_id: jobId, project_id: projectId, state: 'queued', attempt: 0, snapshot_id: null, result_ref: null, next_actions: ['poll_job'], execution: null, bootstrap: null });
            this.revisions.ensureProject(projectId, 0);
            this.revisions.createJobRow({ job_id: jobId, project_id: projectId, kind: 'snapshot_publish', payload_digest: digest, state: 'queued', lease_owner: null, lease_expires_at: null, attempt: 0, max_attempts: Number.MAX_SAFE_INTEGER, cost_status: 'known', created_at: now.toISOString(), updated_at: now.toISOString() });
            this.revisions.appendJobEvent(jobId, 'queued', now.toISOString(), { message: 'Local project creation reserved' }, true);
            this.revisions.beginTransaction({ transaction_id: transactionId, project_id: projectId, kind: 'snapshot_publish', correlation_id: request.meta.correlation_id, request_json: canonicalJson({ operation: 'agent.project.create@1', command_id: commandId, job_id: jobId, request, brief, brief_digest: briefDigest, closure_digest: closureDigest, root_ref: projectId }), request_hash: digest, base_revision: 0, createdAt: now });
            const row: BootstrapCommandRecord = { command_id: commandId, principal_id: principal, operation: 'project.create', idempotency_key: request.meta.idempotency_key, request_digest: digest, reserved_project_id: projectId, state: 'reserved', response_json: { accepted, result: null } };
            this.confirmed(tx, request, principal, this.now());
            tx.put('bootstrap_command', { principal_id: principal, operation: 'project.create', idempotency_key: request.meta.idempotency_key }, row);
            return this.decode(row);
        });
    }
    read(commandId: string): CreationReservation | null {
        const row = this.#db.prepare('SELECT * FROM cp_a0_bootstrap_command WHERE command_id=?').get(commandId);
        return row ? this.decode({ ...row, response_json: JSON.parse(String(row.response_json)) } as unknown as BootstrapCommandRecord) : null;
    }
    origin(projectId: string): ProjectOriginRecord | null {
        const row = this.#db.prepare('SELECT * FROM cp_a0_project_origin WHERE project_id=?').get(projectId);
        return row ? row as unknown as ProjectOriginRecord : null;
    }
    forProject(projectId: string): CreationReservation | null {
        const row = this.#db.prepare('SELECT command_id FROM cp_a0_bootstrap_command WHERE reserved_project_id=?').get(projectId);
        return row ? this.read(String(row.command_id)) : null;
    }
    pending(): CreationReservation[] { return (this.#db.prepare("SELECT command_id FROM cp_a0_bootstrap_command WHERE state IN('reserved','staging','compensating') ORDER BY rowid").all()).map(row => this.read(String(row.command_id))!); }
    markStaging(commandId: string): void {
        const moved = this.transitionBootstrap(commandId, ['reserved'], 'staging');
        if (!moved && this.read(commandId)?.state !== 'staging')
            throw conflict();
    }
    receiptForJob(jobId: string, principal: string): JobReceipt | null {
        const job = this.revisions.readJob(jobId);
        if (!job)
            return null;
        const row = this.#db.prepare('SELECT command_id FROM cp_a0_bootstrap_command WHERE reserved_project_id=? AND principal_id=?').get(job.project_id, principal);
        if (!row)
            return null;
        const reservation = this.read(String(row.command_id))!;
        if (reservation.job_id !== jobId)
            throw conflict();
        return validateAgentDefinition<JobReceipt>('JobReceipt', { ...reservation.accepted, state: job.state, attempt: job.attempt, snapshot_id: reservation.result?.initial_snapshot_id ?? null, bootstrap: reservation.result, next_actions: reservation.result ? ['read_context'] : ['failed','cancelled','attention'].includes(job.state) ? ['review_failure','confirm_brief'] : ['poll_job'] });
    }
    ownsProject(projectId: string, principal: string): boolean {
        const row = this.#db.prepare('SELECT command_id FROM cp_a0_bootstrap_command WHERE reserved_project_id=? AND principal_id=?').get(projectId, principal);
        if (!row) return false;
        const reservation = this.read(String(row.command_id))!;
        const intake = this.#db.prepare('SELECT principal_id FROM cp_a0_intake_version WHERE intake_id=? AND version=?').get(reservation.request.intake_id, reservation.request.intake_version);
        return intake?.principal_id === principal;
    }
    async assertContinuation(commandId: string): Promise<CreationReservation> {
        return this.#repository.transaction(tx => {
            this.assertSchema();
            const reservation = this.read(commandId);
            const row = this.#db.prepare('SELECT principal_id FROM cp_a0_bootstrap_command WHERE command_id=?').get(commandId);
            if (!reservation || !row) throw conflict();
            if (reservation.state !== 'committed') {
                const facts = this.confirmed(tx, reservation.request, String(row.principal_id), this.now());
                if (facts.briefDigest !== reservation.brief_digest || facts.closureDigest !== reservation.closure_digest) throw conflict();
            }
            return reservation;
        });
    }
    async reclaimExpired(commandId: string): Promise<boolean> {
        return this.#repository.transaction(() => {
            this.assertSchema();
            const reservation = this.read(commandId), now = this.now();
            if (!reservation || !['reserved','staging'].includes(reservation.state)) return false;
            const job = this.revisions.readJob(reservation.job_id);
            if (!job || job.state !== 'running' || job.lease_expires_at === null || job.lease_expires_at > now.getTime()) return false;
            if (!this.revisions.requeueExpiredObservedLease(job.job_id, job.lease_owner, job.attempt, job.lease_expires_at, now)) return false;
            this.revisions.appendJobEvent(job.job_id, 'queued', now.toISOString(), {message:'Expired creation worker reclaimed'}, true);
            return true;
        });
    }
    async fail(commandId: string, owner: string | null, attempt: number, code: string): Promise<boolean> {
        return this.#repository.transaction(() => {
            this.assertSchema();
            const reservation = this.read(commandId), now = this.now();
            if (!reservation || !['reserved','staging'].includes(reservation.state)) return false;
            const job = this.revisions.readJob(reservation.job_id);
            if (!job || job.lease_owner !== owner || job.attempt !== attempt || !['running','cancel_requested'].includes(job.state)) return false;
            const live = owner !== null && job.lease_expires_at !== null && job.lease_expires_at > now.getTime();
            const orphanedCancel = job.state === 'cancel_requested' && (job.lease_expires_at === null || job.lease_expires_at <= now.getTime());
            if (!live && !orphanedCancel) return false;
            const transaction = this.revisions.projectTransaction(reservation.transaction_id);
            if (!transaction || !['received','preconditions_checked','staged','validated','prepared'].includes(transaction.state) || this.revisions.activeCommit(reservation.project_id)) return false;
            this.revisions.transition(reservation.transaction_id, transaction.state, 'aborted', {error_code: /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : 'INTERNAL_ERROR', terminal_reason: 'CREATION_FAILED_BEFORE_COMMIT'}, now);
            const changed = job.state === 'cancel_requested'
                ? owner === null
                    ? this.revisions.completeUnownedCancellation(reservation.job_id, attempt, job.lease_expires_at, now)
                    : this.revisions.completeCancelledCallback(reservation.job_id, owner, attempt, now)
                : this.revisions.completeCallback(reservation.job_id, owner!, attempt, 'failed', 'known', canonicalJson({kind:'local.bootstrap_failure@1',code:/^[A-Z][A-Z0-9_]{0,63}$/.test(code)?code:'INTERNAL_ERROR'}), 'CREATION_FAILED_BEFORE_COMMIT', undefined, undefined, now);
            if (!changed) throw conflict();
            if (!this.transitionBootstrap(commandId, ['reserved', 'staging'], 'failed')) throw conflict();
            this.revisions.appendJobEvent(reservation.job_id, job.state === 'cancel_requested' ? 'cancelled' : 'failed', now.toISOString(), {message:'Project creation stopped before its initial commit'}, true);
            this.revisions.enqueueOutbox('project.creation.failed', reservation.project_id, canonicalJson({project_id:reservation.project_id,job_id:reservation.job_id,code:/^[A-Z][A-Z0-9_]{0,63}$/.test(code)?code:'INTERNAL_ERROR'}), now);
            return true;
        });
    }
    sourceFact(projectId: string, snapshotId: string): CreatedSourceFact | null {
        this.assertSchema();
        const row = this.#db.prepare('SELECT fact_json,fact_sha256 FROM created_source_fact WHERE project_id=? AND snapshot_id=?').get(projectId, snapshotId);
        if (!row)
            return null;
        const fact = validateCreatedSourceFact(JSON.parse(String(row.fact_json)) as CreatedSourceFact);
        if (canonicalDigest(fact) !== row.fact_sha256)
            throw conflict();
        return fact;
    }
    async commit(input: {
        command_id: string;
        owner: string;
        attempt: number;
        snapshot: PublishedSnapshot;
        fact: CreatedSourceFact;
        proof: VerifiedCreationSource;
        fault?: (point: CreationCommitBoundary) => void;
    }): Promise<BootstrapResult> {
        const fact = validateCreatedSourceFact(input.fact);
        return this.#repository.transaction(tx => {
            this.assertSchema();
            const now = this.now();
            const reservation = this.read(input.command_id);
            if (!reservation)
                throw conflict();
            if (reservation.state === 'committed') {
                if (reservation.result?.initial_snapshot_id !== input.snapshot.snapshot_id || reservation.result.source_digest !== input.snapshot.source_digest || canonicalDigest(this.sourceFact(reservation.project_id, input.snapshot.snapshot_id)) !== canonicalDigest(fact))
                    throw conflict();
                return reservation.result;
            }
            const row = this.#db.prepare('SELECT principal_id,request_digest FROM cp_a0_bootstrap_command WHERE command_id=?').get(input.command_id)!;
            const current = this.confirmed(tx, reservation.request, String(row.principal_id), now);
            const job = this.revisions.readJob(reservation.job_id), transaction = this.revisions.projectTransaction(reservation.transaction_id), projectId = reservation.project_id;
            if (reservation.state !== 'staging' || current.briefDigest !== reservation.brief_digest || current.closureDigest !== reservation.closure_digest || !job || job.project_id !== projectId || job.kind !== 'snapshot_publish' || job.state !== 'running' || job.lease_owner !== input.owner || job.attempt !== input.attempt || job.lease_expires_at === null || job.lease_expires_at <= now.getTime() || !transaction || transaction.state !== 'prepared' || transaction.request_hash !== row.request_digest || transaction.project_id !== projectId || transaction.base_revision !== 0 || this.revisions.recoveryGate(projectId, 0, reservation.transaction_id) || this.revisions.activeCommit(projectId) || this.revisions.readEngineBinding(projectId))
                throw conflict();
            if (!this.verifier)
                throw new ProductError('CAPABILITY_UNAVAILABLE', 'The native creation verifier is not installed');
            this.verifier.assertCurrent(input.proof, reservation, input.snapshot, fact);
            const snapshot = input.snapshot;
            if (snapshot.project_id !== projectId || snapshot.engine !== 'openfilm' || !HASH.test(snapshot.source_digest) || snapshot.snapshot_id !== snapshotIdFor(projectId, snapshot.source_digest) || transaction.snapshot_id !== snapshot.snapshot_id || transaction.source_digest_after !== snapshot.source_digest)
                throw conflict();
            const at = now.toISOString(), fault = (point: CreationCommitBoundary) => input.fault?.(point);
            const moved = this.#db.prepare('UPDATE project_state SET revision=1,source_digest=?,updated_at=? WHERE project_id=? AND revision=0 AND attention=0 AND CAST(control_revision AS INTEGER)=0').run(snapshot.source_digest, at, projectId);
            if (Number(moved.changes) !== 1)
                throw conflict();
            fault('state');
            this.revisions.bindEngine(projectId, 'openfilm', OPENFILM_UPSTREAM_SHA, null, at);
            fault('binding');
            this.#db.prepare('INSERT INTO snapshot(snapshot_id,project_id,source_digest,engine,created_at) VALUES(?,?,?,?,?)').run(snapshot.snapshot_id, projectId, snapshot.source_digest, 'openfilm', at);
            fault('snapshot');
            this.revisions.transition(reservation.transaction_id, 'prepared', 'committed', { snapshot_id: snapshot.snapshot_id, source_digest_after: snapshot.source_digest }, now);
            fault('transaction');
            this.#db.prepare('INSERT INTO active_commit(project_id,revision,snapshot_id,source_digest,engine,transaction_id,created_at) VALUES(?,1,?,?,?,?,?)').run(projectId, snapshot.snapshot_id, snapshot.source_digest, 'openfilm', reservation.transaction_id, at);
            fault('pointer');
            this.#db.prepare('INSERT INTO created_source_fact VALUES(?,?,?,?)').run(projectId, snapshot.snapshot_id, canonicalJson(fact), canonicalDigest(fact));
            fault('source_fact');
            tx.put('project_origin', { project_id: projectId }, { project_id: projectId, origin: 'created', command_id: reservation.command_id, intake_confirmation_id: reservation.request.decision_id, intake_digest: reservation.brief_digest, initial_snapshot_id: snapshot.snapshot_id, creation_transaction_id: reservation.transaction_id, root_ref: projectId });
            fault('origin');
            const artifactId = 'brief_' + projectId.slice('project_'.length);
            tx.put('artifact_version', { project_id: projectId, artifact_id: artifactId, version: 1 }, { project_id: projectId, artifact_id: artifactId, version: 1, kind: 'brief', schema_version: 1, input_digest: reservation.closure_digest, content_digest: reservation.brief_digest, content_json: reservation.brief, input_refs_json: [], created_at: at });
            tx.compareAndSet('artifact_head', { project_id: projectId, artifact_id: artifactId }, 0, { project_id: projectId, artifact_id: artifactId, draft_version: 1 });
            fault('brief');
            const result = validateAgentDefinition<BootstrapResult>('BootstrapResult', { project_id: projectId, origin: 'created', intake_ref: { id: reservation.request.intake_id, version: reservation.request.intake_version, sha256: reservation.brief_digest }, initial_transaction_id: reservation.transaction_id, initial_snapshot_id: snapshot.snapshot_id, project_revision: 1, control_revision: 0, source_digest: snapshot.source_digest, native_state: 'unconfirmed', native_ack: null });
            const updated = this.transitionBootstrap(reservation.command_id, ['staging'], 'committed', canonicalJson({ accepted: reservation.accepted, result }));
            if (!updated)
                throw conflict();
            fault('command');
            if (!this.revisions.completeCallback(reservation.job_id, input.owner, input.attempt, 'succeeded', 'known', canonicalJson({ kind: 'local.bootstrap_commit@1', transaction_id: reservation.transaction_id, snapshot_id: snapshot.snapshot_id }), '', undefined, undefined, now))
                throw conflict();
            this.revisions.appendJobEvent(reservation.job_id, 'succeeded', at, { message: 'Initial native snapshot committed' }, true);
            fault('job');
            this.revisions.enqueueOutbox('project.created', projectId, canonicalJson({ project_id: projectId, transaction_id: reservation.transaction_id, snapshot_id: snapshot.snapshot_id }), now);
            fault('outbox');
            this.assertSchema();
            this.verifier.assertCurrent(input.proof, reservation, input.snapshot, fact);
            const finalNow = this.now();
            if (job.lease_expires_at <= finalNow.getTime())
                throw conflict();
            this.confirmed(tx, reservation.request, String(row.principal_id), finalNow);
            return result;
        });
    }
  /** The sole bootstrap-command transition helper; Job state remains in RevisionStore. */
  private transitionBootstrap(commandId: string, expected: readonly BootstrapCommandRecord['state'][],
    target: BootstrapCommandRecord['state'], responseJson?: string): boolean {
    const legal = { reserved: ['staging', 'failed'], staging: ['committed', 'failed'] } as const;
    if (expected.length === 0 || new Set(expected).size !== expected.length
      || expected.some(from => !(legal[from as keyof typeof legal] as readonly string[] | undefined)?.includes(target))
      || (target === 'committed') !== (responseJson !== undefined)) throw conflict();
    const placeholders = expected.map(() => '?').join(',');
    const changed = this.#db.prepare(`UPDATE cp_a0_bootstrap_command SET state=?,
      response_json=COALESCE(?,response_json) WHERE command_id=? AND state IN(${placeholders})`)
      .run(target, responseJson ?? null, commandId, ...expected);
    return Number(changed.changes) === 1;
  }
    private assertSchema(): void {
        const version = Number(this.#db.prepare('PRAGMA schema_version').get()?.schema_version);
        if (version !== this.#schemaVersion) {
            if (!matchesFrozenSchemaNamespace(this.#db, DDL, 'created_source_fact'))
                throw conflict();
            this.#schemaVersion = version;
        }
    }
    private confirmed(tx: ProductTransaction, request: CreateProject, principal: string, now: Date): {
        brief: Brief;
        briefDigest: string;
        closureDigest: string;
    } {
        assertIntakeOwner(tx, request.intake_id, principal);
        const version = tx.get('intake_version', { intake_id: request.intake_id, version: request.intake_version }), head = tx.get('intake_head', { intake_id: request.intake_id }), confirmation = tx.get('intake_confirmation', { confirmation_id: request.decision_id });
        if (!version || head?.current_version !== request.intake_version)
            throw conflict();
        if (!confirmation || confirmation.intake_id !== request.intake_id || confirmation.intake_version !== request.intake_version || confirmation.principal_id !== principal || confirmation.channel !== 'trusted_ui' || confirmation.action !== 'project.create' || confirmation.input_digest !== version.input_digest || confirmation.issued_at > Math.floor(now.getTime() / 1000) || confirmation.expires_at <= Math.floor(now.getTime() / 1000))
            throw guard();
        const brief = validateAgentDefinition<Brief>('Brief', version.content_json);
        assertBriefConsistency(brief);
        if (canonicalDigest(brief) !== version.input_digest)
            throw conflict();
        const closure = creativeInputClosure(tx, request.intake_id, request.intake_version);
        if (closure.questions.some(question => question.answer === null))
            throw new ProductError('INVALID_REQUEST', 'Answer or explicitly skip the current questions before creation');
        return { brief, briefDigest: version.input_digest, closureDigest: canonicalDigest(closure) };
    }
    private decode(row: BootstrapCommandRecord): CreationReservation {
        const response = row.response_json as {
            accepted: JobReceipt;
            result: BootstrapResult | null;
        };
        const accepted = validateAgentDefinition<JobReceipt>('JobReceipt', response?.accepted);
        const transaction = this.revisions.projectTransactions(row.reserved_project_id).find(item => item.request_hash === row.request_digest && item.kind === 'snapshot_publish' && JSON.parse(item.request_json).command_id === row.command_id);
        if (!transaction)
            throw conflict();
        const envelope = JSON.parse(transaction.request_json) as {
            operation: string;
            command_id: string;
            job_id: string;
            request: CreateProject;
            brief: Brief;
            brief_digest: string;
            closure_digest: string;
            root_ref: string;
        };
        if (envelope.operation !== 'agent.project.create@1' || envelope.command_id !== row.command_id || envelope.job_id !== accepted.job_id || accepted.project_id !== row.reserved_project_id || accepted.state !== 'queued' || accepted.bootstrap !== null || envelope.root_ref !== row.reserved_project_id || contentDigest(envelope.request) !== row.request_digest || canonicalDigest(envelope.brief) !== envelope.brief_digest || !HASH.test(envelope.closure_digest))
            throw conflict();
        const result = response.result === null ? null : validateAgentDefinition<BootstrapResult>('BootstrapResult', response.result);
        if ((row.state === 'committed') !== (result !== null) || result && (result.project_id !== row.reserved_project_id || result.initial_transaction_id !== transaction.transaction_id))
            throw conflict();
        return { command_id: row.command_id, project_id: row.reserved_project_id, job_id: accepted.job_id, transaction_id: transaction.transaction_id, request: envelope.request, brief: envelope.brief, brief_digest: envelope.brief_digest, closure_digest: envelope.closure_digest, accepted, state: row.state, result };
    }
}
