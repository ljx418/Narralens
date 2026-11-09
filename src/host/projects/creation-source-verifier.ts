import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { canonicalDigest } from '../creative/digest.js';
import { ProductError } from '../creative/trusted-context.js';
import { OPENFILM_UPSTREAM_SHA } from '../engine/engine-binding-store.js';
import { computeSourceDigest } from '../engine/source-digest-v1.js';
import { OpenFilmEngineAdapter } from '../../adapters/openfilm/openfilm-engine-adapter.js';
import { createPinnedOpenFilmUpstream } from '../../adapters/openfilm/openfilm-upstream.js';
import type { CreatedSourceFact, CreationReservation } from './project-creation-store.js';
import { fsyncPath, SnapshotStore, snapshotIdFor, type PublishedSnapshot } from './snapshot-store.js';
declare const verifiedCreation: unique symbol;
export interface VerifiedCreationSource {
    readonly [verifiedCreation]: true;
}
interface ProofRecord {
    command_id: string;
    project_id: string;
    snapshot_id: string;
    source_digest: string;
    fact_digest: string;
    root: string;
    author_root: string;
    files: readonly {
        path: string;
        sha256: string;
        size: number;
    }[];
}
const reject = () => new ProductError('REVISION_CONFLICT', 'The published native source does not prove its creation facts');
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
/** Actual pinned parsing + immutable snapshot bytes; no injectable fake verification callback. */
export class CreationSourceVerifier {
    readonly #proofs = new WeakMap<object, ProofRecord>();
    constructor(private readonly snapshots: SnapshotStore, private readonly vendorRoot: string, private readonly createdRoot: string) { }
    async prove(reservation: CreationReservation, snapshot: PublishedSnapshot, fact: CreatedSourceFact): Promise<VerifiedCreationSource> {
        if (snapshot.project_id !== reservation.project_id || snapshot.engine !== 'openfilm' || snapshot.snapshot_id !== snapshotIdFor(reservation.project_id, snapshot.source_digest))
            throw reject();
        const directory = this.snapshots.snapshotRoot(reservation.project_id, snapshot.snapshot_id), source = resolve(directory, 'source');
        const [directoryStat, sourceStat] = await Promise.all([lstat(directory), lstat(source)]);
        if (directoryStat.isSymbolicLink() || sourceStat.isSymbolicLink() || !directoryStat.isDirectory() || !sourceStat.isDirectory())
            throw reject();
        const projectRoot = await realpath(this.snapshots.projectRoot(reservation.project_id)), canonicalDirectory = await realpath(directory), root = await realpath(source);
        if (canonicalDirectory !== resolve(projectRoot, snapshot.snapshot_id) || root !== resolve(canonicalDirectory, 'source'))
            throw reject();
        const base = await realpath(this.createdRoot), project = resolve(base, reservation.project_id), authorRoot = resolve(project, 'source');
        const [projectStat, authorStat] = await Promise.all([lstat(project), lstat(authorRoot)]);
        if (projectStat.isSymbolicLink() || authorStat.isSymbolicLink() || !projectStat.isDirectory() || !authorStat.isDirectory() || await realpath(project) !== project || await realpath(authorRoot) !== authorRoot)
            throw reject();
        const digest = await computeSourceDigest({ root, roots: fact.roots, engine: 'openfilm', engineUpstreamSha: OPENFILM_UPSTREAM_SHA });
        if (digest.source_digest !== snapshot.source_digest || digest.external_reference_count !== 0)
            throw reject();
        const authorDigest = await computeSourceDigest({ root: authorRoot, roots: fact.roots, engine: 'openfilm', engineUpstreamSha: OPENFILM_UPSTREAM_SHA });
        if (authorDigest.source_digest !== digest.source_digest)
            throw reject();
        const media = digest.manifest.assets.map(row => ({ path: row.path, sha256: row.sha256, size: row.size })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
        const assets = fact.assets.map(row => ({ path: row.path, sha256: row.sha256, size: row.bytes })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
        if (canonicalDigest(media) !== canonicalDigest(assets))
            throw reject();
        const adapter = new OpenFilmEngineAdapter(await createPinnedOpenFilmUpstream(this.vendorRoot));
        const projection = await adapter.inspectSnapshot({ root, roots: fact.roots, subtitles: fact.subtitles }, snapshot.source_digest, { projectId: reservation.project_id, correlationId: reservation.request.meta.correlation_id, signal: new AbortController().signal });
        if (projection.problems.length || projection.frame_count !== fact.frame_count || projection.fps.num !== fact.fps.num || projection.fps.den !== fact.fps.den || projection.source_digest !== snapshot.source_digest)
            throw reject();
        // Publication of the source and its parent entry must be durable before the DB pointer.
        for (const file of [...digest.manifest.files, ...digest.manifest.assets])
            await fsyncPath(resolve(authorRoot, file.path));
        const directories = new Set<string>();
        for (const file of [...digest.manifest.files, ...digest.manifest.assets]) {
            let path = resolve(authorRoot, file.path, '..');
            while (path.startsWith(authorRoot + sep)) {
                directories.add(path);
                path = resolve(path, '..');
            }
        }
        for (const path of [...directories].sort((a, b) => b.length - a.length))
            await fsyncPath(path);
        await fsyncPath(authorRoot);
        await fsyncPath(project);
        await fsyncPath(base);
        const proof = Object.freeze({}) as VerifiedCreationSource;
        this.#proofs.set(proof, { command_id: reservation.command_id, project_id: reservation.project_id, snapshot_id: snapshot.snapshot_id, source_digest: snapshot.source_digest, fact_digest: canonicalDigest(fact), root, author_root: authorRoot, files: [...digest.manifest.files, ...digest.manifest.assets].map(({ path, sha256, size }) => ({ path, sha256, size })) });
        this.assertCurrent(proof, reservation, snapshot, fact);
        return proof;
    }
    /** Synchronous recheck inside the ONE final DB transaction, including after fault seams. */
    assertCurrent(proof: VerifiedCreationSource, reservation: CreationReservation, snapshot: PublishedSnapshot, fact: CreatedSourceFact): void {
        const record = proof && typeof proof === 'object' ? this.#proofs.get(proof) : undefined;
        if (!record || record.command_id !== reservation.command_id || record.project_id !== reservation.project_id || record.snapshot_id !== snapshot.snapshot_id || record.source_digest !== snapshot.source_digest || record.fact_digest !== canonicalDigest(fact))
            throw reject();
        try {
            for (const source of [record.root, record.author_root]) {
                if (realpathSync(source) !== source || lstatSync(source).isSymbolicLink())
                    throw reject();
                for (const file of record.files) {
                    const path = resolve(source, file.path), canonical = realpathSync(path);
                    if (canonical !== path || !canonical.startsWith(source + sep))
                        throw reject();
                    const bytes = readFileSync(canonical);
                    if (bytes.length !== file.size || sha(bytes) !== file.sha256)
                        throw reject();
                }
            }
        }
        catch (error) {
            if (error && typeof error === 'object' && 'code' in error && ['ENOMEM', 'EAGAIN', 'EMFILE', 'ENFILE', 'EBUSY', 'ETIMEDOUT', 'ECONNRESET'].includes(String(error.code)))
                throw new ProductError('HOST_RESOURCE_EXHAUSTED', 'Native source verification could not complete');
            throw reject();
        }
    }
}
