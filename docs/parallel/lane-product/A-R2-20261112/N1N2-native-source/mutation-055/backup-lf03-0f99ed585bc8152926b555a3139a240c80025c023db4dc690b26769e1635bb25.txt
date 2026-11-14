import { createHash, randomUUID } from 'node:crypto';
import { constants, lstatSync, openSync, fstatSync, closeSync, realpathSync, readSync, fsyncSync } from 'node:fs';
import { link, lstat, open, readdir, realpath, unlink } from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';
import { resolve, join, sep, dirname, relative } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { AssetLicense, AssetSource } from '../../contracts/types.js';
import type { RevisionStore } from '../projects/revision-store.js';
import type { ProjectCreationStore } from '../projects/project-creation-store.js';
import type { TrustedCallerContext } from '../creative/product-repository.js';
import { isTrustedCallerContext, ProductError } from '../creative/trusted-context.js';
import { canonicalDigest, canonicalJson } from '../creative/digest.js';
import { OperationIdempotencyStore } from '../projects/operation-idempotency-store.js';
import { matchesFrozenSchemaNamespace } from './agent-schema-definition.js';
import { CreativeProjectAuthority } from './creative-project-authority.js';
import { runtimeRoot } from './owned-runtime.js';
import { assertSafeRelativePath } from '../render/snapshot-copy.js';
import { probeLocalMedia, type LocalMediaFacts } from './local-media-probe.js';
import { asHostResourceError } from '../api-error.js';
export interface LocalAssetInput {
    readonly project_id: string;
    readonly idempotency_key: string;
    readonly relative_path: string;
    readonly expected_sha256: string;
    readonly kind: 'video' | 'audio';
    readonly source: AssetSource;
    readonly license: AssetLicense;
    readonly recording_origin: 'human_recording' | 'synthetic' | 'unknown' | null;
    readonly attestation_ref: string;
}
export interface LocalAsset {
    readonly project_id: string;
    readonly asset_id: string;
    readonly sha256: string;
    readonly bytes: number;
    readonly media: LocalMediaFacts;
    readonly source: AssetSource;
    readonly license: AssetLicense;
    readonly rights_ref: string;
    readonly registration_digest: string;
    readonly attestation: {
        readonly operator_id: string;
        readonly session_ref: string;
        readonly source_message_ref: string;
        readonly recording_origin: LocalAssetInput['recording_origin'];
        readonly recorded_at: string;
    };
}
export interface LocalAssetRegistryOptions {
    readonly sourceRoot: string;
    readonly storageRoot: string;
    readonly projectsRoot: string;
    readonly snapshotsRoot: string;
    readonly mediaObserver?: (event: {
        readonly command: 'ffprobe' | 'ffmpeg';
        readonly pid: number;
    }) => void;
    readonly boundary?: (point: 'before_stage_create' | 'before_publish' | 'after_published_stat' | 'before_insert' | 'after_insert' | 'after_receipt' | 'after_event') => void;
}
const DDL = `CREATE TABLE IF NOT EXISTS created_local_asset(
 project_id TEXT NOT NULL REFERENCES project_state(project_id),asset_id TEXT NOT NULL,
 registration_digest TEXT NOT NULL CHECK(length(registration_digest)=64),
 blob_token TEXT NOT NULL,fact_json TEXT NOT NULL CHECK(json_valid(fact_json)),fact_sha256 TEXT NOT NULL CHECK(length(fact_sha256)=64),
 PRIMARY KEY(project_id,asset_id),UNIQUE(project_id,registration_digest));
 CREATE TRIGGER IF NOT EXISTS created_local_asset_no_update BEFORE UPDATE ON created_local_asset BEGIN SELECT RAISE(ABORT,'IMMUTABLE_LOCAL_ASSET'); END;
 CREATE TRIGGER IF NOT EXISTS created_local_asset_no_delete BEFORE DELETE ON created_local_asset BEGIN SELECT RAISE(ABORT,'IMMUTABLE_LOCAL_ASSET'); END;`;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const SHA = /^[a-f0-9]{64}$/;
const OP = 'agent.v1:local-asset.import';
/** The media extensions the existing probe and importer accept. */
const MEDIA_EXTENSIONS = new Set(['mp4', 'wav', 'm4a', 'mp3', 'flac', 'ogg']);
/** The listing never walks an unbounded tree. */
const MAX_SOURCE_DEPTH = 4;
/** One safe source file. It carries a relative path and a regular-file identity only. */
export interface SourceFileCandidate {
    readonly relative_path: string;
    readonly display_name: string;
    readonly kind: 'video' | 'audio';
    readonly bytes: number;
    readonly identity: string;
}
/** Resolve even a not-yet-created reserved domain through its existing ancestor. */
function canonicalLocation(path: string): string {
    const absolute = resolve(path);
    let ancestor = absolute;
    while (true) {
        try {
            lstatSync(ancestor);
            break;
        }
        catch (error) {
            if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
                throw error;
            const parent = dirname(ancestor);
            if (parent === ancestor)
                throw error;
            ancestor = parent;
        }
    }
    return resolve(realpathSync(ancestor), relative(ancestor, absolute));
}
const MAX_BYTES = 2 * 1024 * 1024 * 1024;
const invalid = () => new ProductError('INVALID_REQUEST', 'Invalid local asset input');
const conflict = () => new ProductError('REVISION_CONFLICT', 'Local asset facts or bytes changed');
function keys(value: unknown, expected: string): boolean { return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === expected; }
function fingerprint(info: BigIntStats): string { return [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(':'); }
function core(asset: LocalAsset) { return { project_id: asset.project_id, sha256: asset.sha256, bytes: asset.bytes, media: asset.media, source: asset.source, license: asset.license, recording_origin: asset.attestation.recording_origin, attestation_ref: asset.attestation.source_message_ref, operator_id: asset.attestation.operator_id }; }
/** Created-project input catalog, one shared database and the original command ledger.
 * Host-only configuration fixes the readable directory. No public DTO can supply a root.
 * Registrations prepare immutable inputs, never write author source or increment revision.
 */
export class LocalAssetRegistry {
    readonly #db: DatabaseSync;
    readonly #commands: OperationIdempotencyStore;
    readonly #owner: CreativeProjectAuthority;
    readonly #root: string;
    readonly #objects: string;
    readonly #staging: string;
    readonly #sourceRoot: string;
    readonly #sourceIdentity: string;
    readonly #sourceFd: number;
    readonly #rootFd: number;
    readonly #objectsFd: number;
    readonly #stagingFd: number;
    readonly #directoryFds: number[] = [];
    readonly #boundary: LocalAssetRegistryOptions['boundary'];
    readonly #mediaObserver: LocalAssetRegistryOptions['mediaObserver'];
    readonly #shutdown = new AbortController();
    readonly #pending = new Set<Promise<unknown>>();
    #closed = false;
    #closePromise: Promise<void> | undefined;
    #active = 0;
    readonly #waiting: Array<{
        grant: () => void;
    }> = [];
    get capacity() { return { running: this.#active, queued: this.#waiting.length, limit: 2 as const }; }
    #acquire(signal?: AbortSignal): Promise<void> {
        if (signal?.aborted)
            return Promise.reject(new ProductError('CAPABILITY_UNAVAILABLE', 'Local asset import was cancelled'));
        if (this.#active < 2) {
            this.#active++;
            return Promise.resolve();
        }
        return new Promise((resolve, reject) => {
            let pending = true;
            const abort = () => {
                if (!pending)
                    return;
                pending = false;
                const at = this.#waiting.indexOf(waiter);
                if (at >= 0)
                    this.#waiting.splice(at, 1);
                signal?.removeEventListener('abort', abort);
                reject(new ProductError('CAPABILITY_UNAVAILABLE', 'Local asset import was cancelled'));
            };
            const waiter = { grant: () => { pending = false; signal?.removeEventListener('abort', abort); resolve(); } };
            this.#waiting.push(waiter);
            signal?.addEventListener('abort', abort, { once: true });
            if (signal?.aborted)
                abort();
        });
    }
    #release() {
        const next = this.#waiting.shift();
        if (next)
            next.grant();
        else
            this.#active--;
    }
    #schemaVersion = 0;
    constructor(private readonly revisions: RevisionStore, private readonly creation: ProjectCreationStore, options: LocalAssetRegistryOptions) {
        const storage = resolve(options.storageRoot), source = resolve(options.sourceRoot);
        const overlaps = (a: string, b: string) => a === b || a.startsWith(b + sep) || b.startsWith(a + sep);
        if ([options.projectsRoot, options.snapshotsRoot, source].some(root => overlaps(canonicalLocation(storage), canonicalLocation(root))))
            throw new ProductError('CAPABILITY_UNAVAILABLE', 'Local asset storage overlaps a protected source or snapshot domain');
        const sourceStat = lstatSync(source, { bigint: true });
        if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink() || realpathSync(source) !== source)
            throw new ProductError('CAPABILITY_UNAVAILABLE', 'The configured local input root is unavailable');
        this.#sourceRoot = source;
        this.#sourceIdentity = [sourceStat.dev, sourceStat.ino].join(':');
        this.#boundary = options.boundary;
        this.#mediaObserver = options.mediaObserver;
        this.#root = runtimeRoot(storage);
        this.#objects = runtimeRoot(join(storage, 'objects'));
        this.#staging = runtimeRoot(join(storage, 'staging'));
        this.#owner = new CreativeProjectAuthority(creation);
        this.#db = revisions.compose(db => db);
        this.#commands = new OperationIdempotencyStore(this.#db);
        if (this.#db.prepare("SELECT 1 FROM sqlite_schema WHERE name GLOB 'created_local_asset*' LIMIT 1").get()) {
            if (!matchesFrozenSchemaNamespace(this.#db, DDL, 'created_local_asset'))
                throw conflict();
        }
        else
            revisions.atomic(() => {
                this.#db.exec(DDL);
                if (!matchesFrozenSchemaNamespace(this.#db, DDL, 'created_local_asset'))
                    throw conflict();
            });
        this.#schemaVersion = Number(this.#db.prepare('PRAGMA schema_version').get()?.schema_version);
        const keep = (path: string) => { const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK); this.#directoryFds.push(fd); return fd; };
        try {
            this.#sourceFd = keep(this.#sourceRoot);
            this.#rootFd = keep(this.#root);
            this.#objectsFd = keep(this.#objects);
            this.#stagingFd = keep(this.#staging);
            this.#assertSourceRoot();
            this.#assertStorage();
        }
        catch (error) {
            for (const fd of this.#directoryFds)
                closeSync(fd);
            throw error;
        }
    }
    #at(fd: number, name: string): string { return join('/proc', String(process.pid), 'fd', String(fd), name); }
    #assertStorage() {
        for (const [path, fd] of [[this.#root, this.#rootFd], [this.#objects, this.#objectsFd], [this.#staging, this.#stagingFd]] as const) {
            const actual = lstatSync(path, { bigint: true }), held = fstatSync(fd, { bigint: true });
            if (!actual.isDirectory() || actual.isSymbolicLink() || realpathSync(path) !== path || actual.dev !== held.dev || actual.ino !== held.ino || (Number(actual.mode) & 0o077) !== 0 || actual.uid !== BigInt(process.getuid!()))
                throw conflict();
        }
    }
    async #openInput(relativePath: string) {
        const parts = relativePath.split('/'), parents: Array<Awaited<ReturnType<typeof open>>> = [];
        let directory = this.#sourceFd;
        let leaf:Awaited<ReturnType<typeof open>>|undefined;
        try {
            for (const part of parts.slice(0, -1)) {
                const handle = await open(this.#at(directory, part), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
                parents.push(handle);
                directory = handle.fd;
            }
            const handle = await open(this.#at(directory, parts.at(-1)!), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
            leaf=handle;
            if (await realpath(this.#at(handle.fd, '')) !== resolve(this.#sourceRoot, relativePath))throw conflict();
            leaf=undefined;
            return { handle, closeParents: async () => {
                    const outcomes = await Promise.allSettled(parents.map(parent => parent.close()));
                    const failure = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
                    if (failure)
                        throw failure.reason;
                } };
        }
        catch (error) {
            await Promise.allSettled([...parents,...(leaf?[leaf]:[])].map(handle=>handle.close()));
            throw error;
        }
    }
    #assertSourceRoot() {
        const st = lstatSync(this.#sourceRoot, { bigint: true });
        if (!st.isDirectory() || st.isSymbolicLink() || realpathSync(this.#sourceRoot) !== this.#sourceRoot || [st.dev, st.ino].join(':') !== this.#sourceIdentity || [fstatSync(this.#sourceFd, { bigint: true }).dev, fstatSync(this.#sourceFd, { bigint: true }).ino].join(':') !== this.#sourceIdentity)
            throw conflict();
    }
    #schema() {
        const version = Number(this.#db.prepare('PRAGMA schema_version').get()?.schema_version);
        if (version !== this.#schemaVersion) {
            if (!matchesFrozenSchemaNamespace(this.#db, DDL, 'created_local_asset'))
                throw conflict();
            this.#schemaVersion = version;
        }
    }
    #access(project: string, caller: TrustedCallerContext, write = false) {
        if (this.#closed)
            throw new ProductError('CAPABILITY_UNAVAILABLE', 'Local asset service is stopping');
        if (!isTrustedCallerContext(caller) || caller.channel === 'native_bridge')
            throw new ProductError('UNAUTHORIZED', 'An authenticated owner is required');
        if (write && (caller.channel !== 'trusted_ui' || caller.source !== 'trusted_ui'))
            throw new ProductError('ORIGIN_REJECTED', 'Local rights registration needs a trusted user session');
        this.#owner.assertOwner(project, caller.principal_id);
        this.#schema();
    }
    #validate(input: LocalAssetInput) {
        if (!keys(input, 'attestation_ref,expected_sha256,idempotency_key,kind,license,project_id,recording_origin,relative_path,source') || !ID.test(input.project_id) || !ID.test(input.idempotency_key) || !ID.test(input.attestation_ref) || !SHA.test(input.expected_sha256) || !['audio', 'video'].includes(input.kind))
            throw invalid();
        try {
            assertSafeRelativePath(input.relative_path);
        }
        catch {
            throw invalid();
        }
        if (!keys(input.license, 'commercial_use,label,status') || !['cleared', 'restricted', 'unknown'].includes(input.license.status) || typeof input.license.commercial_use !== 'boolean' || typeof input.license.label !== 'string' || input.license.label.length < 1 || input.license.label.length > 2000)
            throw invalid();
        const source = input.source;
        if (!source || !['owned', 'generated', 'licensed', 'derived'].includes(source.kind) || typeof source.label !== 'string' || !source.label || source.label.length > 2000)
            throw invalid();
        if (source.kind === 'derived') {
            if (!keys(source, 'kind,label,lineage') || !Array.isArray(source.lineage) || source.lineage.length < 1 || source.lineage.length > 256 || source.lineage.some(id => !ID.test(id)))
                throw invalid();
            for (const id of source.lineage)
                if (!this.#db.prepare('SELECT 1 FROM created_local_asset WHERE project_id=? AND asset_id=?').get(input.project_id, id))
                    throw invalid();
        }
        else if (!keys(source, 'kind,label') && !keys(source, 'kind,label,uri') || ('uri' in source && typeof source.uri !== 'string'))
            throw invalid();
        if ('uri' in source) {
            try {
                const url = new URL(source.uri!);
                if (source.uri!.length > 2048 || !['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
                    throw invalid();
            }
            catch {
                throw invalid();
            }
        }
        if (input.kind === 'video' ? input.recording_origin !== null : !['human_recording', 'synthetic', 'unknown'].includes(String(input.recording_origin)))
            throw invalid();
    }
    #row(project: string, assetId: string): {
        asset: LocalAsset;
        token: string;
    } | null {
        this.#schema();
        const row = this.#db.prepare('SELECT * FROM created_local_asset WHERE project_id=? AND asset_id=?').get(project, assetId);
        if (!row)
            return null;
        const asset = JSON.parse(String(row.fact_json)) as LocalAsset;
        if (!keys(asset, 'asset_id,attestation,bytes,license,media,project_id,registration_digest,rights_ref,sha256,source') || canonicalDigest(asset) !== row.fact_sha256 || asset.project_id !== project || asset.asset_id !== assetId || canonicalDigest(core(asset)) !== row.registration_digest || asset.registration_digest !== row.registration_digest || asset.asset_id !== 'asset_' + asset.registration_digest.slice(0, 56) || asset.rights_ref !== 'rights_' + asset.registration_digest.slice(0, 56))
            throw conflict();
        const token = String(row.blob_token);
        if (token !== asset.sha256 + '.' + asset.media.extension || !/^([a-f0-9]{64})\.(mp4|wav|m4a|mp3|flac|ogg)$/.test(token))
            throw conflict();
        return { asset, token };
    }
    list(project: string, caller: TrustedCallerContext): LocalAsset[] { this.#access(project, caller); return this.#db.prepare('SELECT asset_id FROM created_local_asset WHERE project_id=? ORDER BY asset_id').all(project).map(row => this.#row(project, String(row.asset_id))!.asset); }
    #replay(input: LocalAssetInput, digest: string): LocalAsset | null {
        const found = this.#commands.recall(input.project_id, OP, input.idempotency_key);
        if (!found)
            return null;
        if (found.request_digest !== digest)
            throw new ProductError('IDEMPOTENCY_CONFLICT', 'The local asset key belongs to different input');
        const response = JSON.parse(found.response_json) as LocalAsset;
        const stored = this.#row(input.project_id, response.asset_id);
        if (!stored || canonicalDigest(stored.asset) !== canonicalDigest(response))
            throw conflict();
        return stored.asset;
    }
    import(input: LocalAssetInput, caller: TrustedCallerContext, signal?: AbortSignal): Promise<LocalAsset> {
        if (this.#closed)
            return Promise.reject(new ProductError('CAPABILITY_UNAVAILABLE', 'Local asset service is stopping'));
        const combined = signal ? AbortSignal.any([signal, this.#shutdown.signal]) : this.#shutdown.signal;
        return this.#track(this.#importWithSlot(input, caller, combined));
    }
    #track<T>(task: Promise<T>): Promise<T> {
        this.#pending.add(task);
        void task.then(() => { this.#pending.delete(task); }, () => { this.#pending.delete(task); });
        return task;
    }
    close(): Promise<void> {
        if (this.#closePromise)
            return this.#closePromise;
        this.#closed = true;
        this.#shutdown.abort();
        return this.#closePromise = Promise.allSettled([...this.#pending]).then(() => {
            for (const fd of this.#directoryFds)
                closeSync(fd);
        });
    }
    async #importWithSlot(input: LocalAssetInput, caller: TrustedCallerContext, signal?: AbortSignal): Promise<LocalAsset> {
        let acquired = false;
        try {
            if (!isTrustedCallerContext(caller))
                throw new ProductError('UNAUTHORIZED', 'An authenticated owner is required');
            const request = JSON.parse(canonicalJson(input)) as LocalAssetInput, serverCaller = Object.freeze({ ...caller });
            this.#access(request.project_id, serverCaller, true);
            this.#validate(request);
            await this.#acquire(signal);
            acquired = true;
            return await this.#import(request, serverCaller, signal);
        }
        catch (error) {
            if (error instanceof ProductError)
                throw error;
            if (signal?.aborted)
                throw new ProductError('CAPABILITY_UNAVAILABLE', 'Local asset import was cancelled');
            if (asHostResourceError(error))
                throw new ProductError('HOST_RESOURCE_EXHAUSTED', 'Local asset import could not complete');
            throw new ProductError('CAPABILITY_UNAVAILABLE', 'Local asset import is unavailable');
        }
        finally {
            if (acquired)
                this.#release();
        }
    }
    async #import(input: LocalAssetInput, caller: TrustedCallerContext, signal?: AbortSignal): Promise<LocalAsset> {
        this.#access(input.project_id, caller, true);
        this.#validate(input);
        signal?.throwIfAborted();
        const digest = canonicalDigest({ input, principal_id: caller.principal_id }), prior = this.#replay(input, digest);
        if (prior)
            return prior;
        this.#assertSourceRoot();
        const path = resolve(this.#sourceRoot, input.relative_path);
        if (!path.startsWith(this.#sourceRoot + sep) || await realpath(path) !== path)
            throw invalid();
        this.#assertStorage();
        const inputFile = await this.#openInput(input.relative_path), source = inputFile.handle;
        const stagingName = randomUUID() + '.input', staging = this.#at(this.#stagingFd, stagingName), stagingCanonical = join(this.#staging, stagingName);
        try {
            this.#assertStorage();
            const before = await source.stat({ bigint: true });
            if (!before.isFile() || before.size < 1 || before.size > BigInt(MAX_BYTES))
                throw invalid();
            this.#boundary?.('before_stage_create');
            const target = await open(staging, 'wx', 0o600), hash = createHash('sha256');
            let bytes = 0;
            try {
                const buffer = Buffer.alloc(1024 * 1024);
                while (true) {
                    signal?.throwIfAborted();
                    const part = await source.read(buffer, 0, buffer.length, null);
                    if (!part.bytesRead)
                        break;
                    bytes += part.bytesRead;
                    if (bytes > MAX_BYTES)
                        throw invalid();
                    hash.update(buffer.subarray(0, part.bytesRead));
                    await target.writeFile(buffer.subarray(0, part.bytesRead));
                }
                await target.sync();
            }
            finally {
                await target.close();
            }
            if (hash.digest('hex') !== input.expected_sha256 || fingerprint(before) !== fingerprint(await source.stat({ bigint: true })) || await realpath(path) !== path)
                throw conflict();
            this.#assertSourceRoot();
            const current = this.revisions.activeCommit(input.project_id);
            if (!current)
                throw conflict();
            const fact = this.creation.sourceFact(input.project_id, current.snapshot_id);
            if (!fact)
                throw conflict();
            this.#assertStorage();
            const media = await probeLocalMedia(staging, input.kind, input.expected_sha256, fact.fps, signal, this.#mediaObserver);
            // The decoder was given a private regular file, not the external input path.
            const proven = await this.#hashFile(staging, input.expected_sha256, false, stagingCanonical);
            if (proven.size !== BigInt(bytes))
                throw conflict();
            const base = { project_id: input.project_id, sha256: input.expected_sha256, bytes, media, source: input.source, license: input.license, recording_origin: input.recording_origin, attestation_ref: input.attestation_ref, operator_id: caller.principal_id };
            const registration_digest = canonicalDigest(base), asset_id = 'asset_' + registration_digest.slice(0, 56), rights_ref = 'rights_' + registration_digest.slice(0, 56);
            const asset: LocalAsset = { project_id: input.project_id, asset_id, sha256: input.expected_sha256, bytes, media, source: input.source, license: input.license, rights_ref, registration_digest, attestation: { operator_id: caller.principal_id, session_ref: caller.session_ref, source_message_ref: input.attestation_ref, recording_origin: input.recording_origin, recorded_at: new Date().toISOString() } };
            const token = input.expected_sha256 + '.' + media.extension, destination = this.#at(this.#objectsFd, token), destinationCanonical = join(this.#objects, token);
            this.#assertStorage();
            this.#boundary?.('before_publish');
            try {
                await link(staging, destination);
            }
            catch (error) {
                if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST'))
                    throw error;
            }
            const blobProof = await this.#hashFile(destination, input.expected_sha256, true, destinationCanonical, true);
            this.#assertStorage();
            fsyncSync(this.#objectsFd);
            fsyncSync(this.#rootFd);
            return this.revisions.atomic(() => {
                signal?.throwIfAborted();
                this.#access(input.project_id, caller, true);
                const replay = this.#replay(input, digest);
                if (replay)
                    return replay;
                this.#boundary?.('before_insert');
                const existing = this.#row(input.project_id, asset_id);
                if (existing && canonicalDigest(core(existing.asset)) !== registration_digest)
                    throw conflict();
                const response = existing?.asset ?? asset;
                if (!existing)
                    this.#db.prepare('INSERT INTO created_local_asset VALUES(?,?,?,?,?,?)').run(input.project_id, asset_id, registration_digest, token, canonicalJson(asset), canonicalDigest(asset));
                this.#boundary?.('after_insert');
                this.#commands.record({ projectId: input.project_id, operationKind: OP, idempotencyKey: input.idempotency_key, requestDigest: digest, response });
                this.#boundary?.('after_receipt');
                if (!existing)
                    this.revisions.enqueueOutbox('asset.local.registered', input.project_id, canonicalJson({ asset_id, registration_digest, kind: media.kind, rights_ref, recording_origin: input.recording_origin }));
                this.#boundary?.('after_event');
                this.#assertStorage();
                this.#assertBlob(destination, blobProof, input.expected_sha256, destinationCanonical);
                this.#assertSourceRoot();
                this.#access(input.project_id, caller, true);
                signal?.throwIfAborted();
                return response;
            });
        }
        finally {
            try {
                await source.close();
            }
            finally {
                try {
                    await inputFile.closeParents();
                }
                finally {
                    await unlink(staging).catch(() => undefined);
                }
            }
        }
    }
    /**
     * Prove the content of one file, and its identity, through one open descriptor.
     *
     * The PRIVATE staging file is not shared with anybody: its whole identity, the
     * change time of the inode included, must be exactly what it was before the read.
     *
     * The PUBLISHED blob is a content-addressed object whose NAME COUNT changes while
     * other publishers publish the same content: a publisher that links or unlinks its
     * own staging name moves the change time of the inode without moving a single
     * byte. That is not assumed here - it is PROVED: the content is proved a second
     * time, from the SAME descriptor, from the explicit start of the file, and the
     * whole identity, the change time included, must be stable across that second
     * proof. The second proof is synchronous, so no other cleanup of this process can
     * slip into its window, and it happens ONCE: there is no retry loop, no general
     * waiver of the change time, and no claim about WHY the change time moved.
     */
    async #hashFile(path: string, expected: string, synchronize = false, canonical = path, published = false): Promise<BigIntStats> {
        if (await realpath(path) !== canonical)
            throw conflict();
        const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
            const before = await handle.stat({ bigint: true });
            if (!before.isFile() || before.size < 1 || before.size > BigInt(MAX_BYTES))
                throw conflict();
            // The observation point of the published blob is exactly HERE: after its
            // initial stat and before its bytes are read, so that the real proof
            // window can be made to happen on purpose.
            if (published)
                this.#boundary?.('after_published_stat');
            const hash = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024);
            while (true) {
                if (this.#closed)
                    throw new ProductError('CAPABILITY_UNAVAILABLE', 'Local asset service is stopping');
                const part = await handle.read(buffer, 0, buffer.length, null);
                if (!part.bytesRead)
                    break;
                hash.update(buffer.subarray(0, part.bytesRead));
            }
            const after = await handle.stat({ bigint: true });
            if (hash.digest('hex') !== expected || await realpath(path) !== canonical)
                throw conflict();
            if (!published) {
                // The private staging file: every part of its identity must be the
                // one it had before the read.
                if (fingerprint(before) !== fingerprint(after))
                    throw conflict();
            }
            else if (before.ctimeNs !== after.ctimeNs) {
                // The content is the same and the change time of the inode moved.
                // The content is proved AGAIN, from the same descriptor, from the
                // explicit start of the file - the cursor is never continued from
                // where the first read stopped - and the whole identity must be
                // stable across that second proof.
                const beforeSecond = fstatSync(handle.fd, { bigint: true });
                const second = createHash('sha256'), secondBuffer = Buffer.alloc(1024 * 1024);
                let secondBytes = 0, offset = 0;
                while (true) {
                    const count = readSync(handle.fd, secondBuffer, 0, secondBuffer.length, offset);
                    if (!count)
                        break;
                    secondBytes += count;
                    if (secondBytes > MAX_BYTES)
                        throw conflict();
                    second.update(secondBuffer.subarray(0, count));
                    offset += count;
                }
                const afterSecond = fstatSync(handle.fd, { bigint: true });
                if (second.digest('hex') !== expected
                    || fingerprint(beforeSecond) !== fingerprint(afterSecond)
                    || before.dev !== afterSecond.dev || before.ino !== afterSecond.ino
                    || before.size !== afterSecond.size || before.mtimeNs !== afterSecond.mtimeNs
                    || await realpath(path) !== canonical)
                    throw conflict();
            }
            if (synchronize)
                await handle.sync();
            return before;
        }
        finally {
            await handle.close();
        }
    }
    #assertBlob(path: string, proof: BigIntStats, expected: string, canonical = path) {
        if (realpathSync(path) !== canonical || lstatSync(path).isSymbolicLink())
            throw conflict();
        const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
            const sameContentIdentity = (info: BigIntStats) => info.isFile() && [info.dev, info.ino, info.size, info.mtimeNs].join(':') === [proof.dev, proof.ino, proof.size, proof.mtimeNs].join(':');
            const current = fstatSync(fd, { bigint: true });
            if (!sameContentIdentity(current))
                throw conflict();
            // Unlinking a successful publisher's staging hard link changes ctime without
            // changing bytes. Re-hash such a proof; never waive the content check.
            if (current.ctimeNs !== proof.ctimeNs) {
                const hash = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024);
                let size = 0;
                while (true) {
                    const count = readSync(fd, buffer, 0, buffer.length, null);
                    if (!count)
                        break;
                    size += count;
                    if (size > MAX_BYTES)
                        throw conflict();
                    hash.update(buffer.subarray(0, count));
                }
                if (hash.digest('hex') !== expected || fingerprint(current) !== fingerprint(fstatSync(fd, { bigint: true })))
                    throw conflict();
            }
        }
        finally {
            closeSync(fd);
        }
    }
    /** Host-only owner/access check for the adjunct transports. It performs no read of
     * the material itself and never leaks whether another project exists. */
    assertAccess(project: string, caller: TrustedCallerContext): void { this.#access(project, caller); }
    /** Host-only: an opaque generation token for the configured source root. It changes
     * when the root itself is replaced and it never reveals a path. */
    sourceRootGeneration(): string {
        this.#assertSourceRoot();
        return canonicalDigest({ root: this.#sourceIdentity });
    }
    /** R1 adjunct: the original typed import receipt for a key, without re-reading the
     * source input. Only this registry's own operation response is read; no arbitrary
     * operation response is exposed, and the caller still has to own the project. */
    recallImport(project: string, idempotencyKey: string, caller: TrustedCallerContext): LocalAsset | null {
        this.#access(project, caller);
        if (typeof idempotencyKey !== 'string' || !ID.test(idempotencyKey)) throw invalid();
        const found = this.#commands.recall(project, OP, idempotencyKey);
        if (!found) return null;
        const response = JSON.parse(found.response_json) as LocalAsset;
        const stored = this.#row(project, response.asset_id);
        if (!stored || canonicalDigest(stored.asset) !== canonicalDigest(response)) throw conflict();
        return stored.asset;
    }
    /** Host-only: the safe, bounded listing of the configured source root. It returns
     * only relative paths and regular-file identities, never an absolute path, and it
     * never hashes a file. Symlinks, non-regular files and anything outside the
     * configured root are skipped, so a listing cannot become a directory walk. */
    async listSourceFiles(limit: number): Promise<readonly SourceFileCandidate[]> {
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 4096) throw invalid();
        this.#assertSourceRoot();
        const found: SourceFileCandidate[] = [];
        await this.#walkSource('', 0, found, limit);
        return found;
    }
    async #walkSource(prefix: string, depth: number, found: SourceFileCandidate[], limit: number): Promise<void> {
        if (found.length >= limit || depth > MAX_SOURCE_DEPTH) return;
        let entries: Array<{ name: string; isSymbolicLink(): boolean; isDirectory(): boolean; isFile(): boolean }>;
        try {
            entries = await readdir(prefix ? resolve(this.#sourceRoot, prefix) : this.#sourceRoot, { withFileTypes: true });
        } catch {
            return;
        }
        entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        for (const entry of entries) {
            if (found.length >= limit) return;
            if (entry.name.startsWith('.') || entry.name.includes('/')) continue;
            const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
            // A symlink is never followed and never listed: it is the only way a listing
            // could escape the configured root.
            if (entry.isSymbolicLink()) continue;
            if (entry.isDirectory()) { await this.#walkSource(relative, depth + 1, found, limit); continue; }
            if (!entry.isFile()) continue;
            const extension = entry.name.slice(entry.name.lastIndexOf('.') + 1).toLowerCase();
            if (!MEDIA_EXTENSIONS.has(extension)) continue;
            let stat: BigIntStats;
            try { stat = await lstat(resolve(this.#sourceRoot, relative), { bigint: true }); } catch { continue; }
            if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1n || stat.size > BigInt(MAX_BYTES)) continue;
            found.push({
                relative_path: relative,
                display_name: entry.name,
                kind: extension === 'mp4' ? 'video' : 'audio',
                bytes: Number(stat.size),
                identity: [stat.dev, stat.ino, stat.size, stat.mtimeNs].join(':'),
            });
        }
    }
    /** Host-only: hash ONE selected source file inside the configured root. The file is
     * opened without following a symlink, and its regular-file identity is re-checked
     * afterwards, so a file that was replaced between the listing and the import is
     * refused instead of being registered under a stale identity. */
    async hashSourceFile(relativePath: string, expectedIdentity: string): Promise<{ sha256: string; bytes: number }> {
        this.#assertSourceRoot();
        const path = resolve(this.#sourceRoot, relativePath);
        if (!path.startsWith(this.#sourceRoot + sep) || await realpath(path) !== path) throw invalid();
        const opened = await this.#openInput(relativePath);
        try {
            const before = await opened.handle.stat({ bigint: true });
            if (!before.isFile()) throw invalid();
            const hash = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024);
            let bytes = 0;
            while (true) {
                const part = await opened.handle.read(buffer, 0, buffer.length, null);
                if (!part.bytesRead) break;
                bytes += part.bytesRead;
                if (bytes > MAX_BYTES) throw invalid();
                hash.update(buffer.subarray(0, part.bytesRead));
            }
            const after = await opened.handle.stat({ bigint: true });
            if ([after.dev, after.ino, after.size, after.mtimeNs].join(':') !== expectedIdentity)
                throw new ProductError('REVISION_CONFLICT', 'The selected source file changed');
            return { sha256: hash.digest('hex'), bytes };
        } finally {
            try { await opened.handle.close(); } finally { await opened.closeParents(); }
        }
    }
    /** Host-only path resolution for a verifier, never serialized or accepted as a DTO. */
    blobPathForFact(asset:LocalAsset):string {
        if(this.#closed)throw new ProductError('CAPABILITY_UNAVAILABLE','Local asset service is stopping');
        const row=this.#row(asset.project_id,asset.asset_id);
        if(!row||canonicalDigest(row.asset)!==canonicalDigest(asset))throw conflict();
        this.#assertStorage();return join(this.#objects,row.token);
    }
    protectedRoots():readonly string[]{return [this.#sourceRoot,this.#root];}
    resolve(project: string, assetId: string, caller: TrustedCallerContext) {
        if (this.#closed)
            return Promise.reject(new ProductError('CAPABILITY_UNAVAILABLE', 'Local asset service is stopping'));
        return this.#track(this.#resolve(project, assetId, caller));
    }
    async #resolve(project: string, assetId: string, caller: TrustedCallerContext): Promise<{
        asset: LocalAsset;
        absolute_path: string;
    }> {
        this.#access(project, caller);
        const row = this.#row(project, assetId);
        if (!row)
            throw new ProductError('NOT_FOUND', 'Local asset not found');
        this.#assertStorage();
        const path = join(this.#objects, row.token);
        await this.#hashFile(this.#at(this.#objectsFd, row.token), row.asset.sha256, false, path, true);
        this.#access(project, caller);
        return { asset: row.asset, absolute_path: path };
    }
}
