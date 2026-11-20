import { beforeAll, afterAll, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile, cp, readdir, symlink, unlink, rename } from 'node:fs/promises';
import { readFileSync, writeFileSync, renameSync, symlinkSync, linkSync, unlinkSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NarralensHost } from '../../../src/host/server.js';
import { ProjectCatalog } from '../../../src/host/projects/project-catalog.js';
import { CreationApplication } from '../../../src/host/agent-driven/creation-application.js';
import { createTrustedCallerContext } from '../../../src/host/creative/trusted-context.js';
import { runLocalMediaTool } from '../../../src/host/agent-driven/local-media-probe.js';
import { validateImportedMedia } from '../../../src/host/assets/media-validator.js';
import { styleDigest } from '../../../src/host/creative/digest.js';
import { LocalAssetRegistry, type LocalAssetInput, type LocalAssetRegistryOptions } from '../../../src/host/agent-driven/local-asset-registry.js';
import type { IntakePut, Intake, Decision, JobReceipt } from '../../../src/contracts/agent-driven-types.js';
const vendorRoot = '/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm';
let generated: string;
beforeAll(async () => {
    generated = await mkdtemp(join(tmpdir(), 'narralens-local-asset-diagnostics-'));
    execFileSync('ffmpeg', ['-nostdin', '-hide_banner', '-v', 'error', '-filter_threads', '1', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=30:d=1', '-threads', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(generated, 'video.mp4')], { stdio: 'pipe', windowsHide: true, timeout: 30000 });
    execFileSync('ffmpeg', ['-nostdin', '-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=400:sample_rate=48000:duration=1', '-threads', '1', '-c:a', 'pcm_s16le', join(generated, 'audio.wav')], { stdio: 'pipe', windowsHide: true, timeout: 30000 });
    execFileSync('ffmpeg', ['-nostdin', '-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=400:sample_rate=48000', '-af', 'atrim=end_sample=1600', '-threads', '1', '-c:a', 'pcm_s16le', join(generated, 'one-frame.wav')], { stdio: 'pipe', windowsHide: true, timeout: 30000 });
    const combined = join(generated, 'with-audio.mp4');
    execFileSync('ffmpeg', ['-nostdin', '-hide_banner', '-v', 'error', '-i', join(generated, 'video.mp4'), '-i', join(generated, 'audio.wav'), '-c:v', 'copy', '-c:a', 'aac', '-threads', '1', '-shortest', combined], { stdio: 'pipe', windowsHide: true, timeout: 30000 });
    const packets = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_packets', '-show_entries', 'packet=pos,size', '-of', 'json', combined], { encoding: 'utf8', windowsHide: true, timeout: 30000 })) as {
        packets: {
            pos: string;
            size: string;
        }[];
    };
    const corrupt = await readFile(combined);
    for (const packet of packets.packets.slice(1, 4))
        corrupt.fill(255, Number(packet.pos), Number(packet.pos) + Number(packet.size));
    await writeFile(join(generated, 'bad-audio-track.mp4'), corrupt);
    const wav = await readFile(join(generated, 'audio.wav'));
    await writeFile(join(generated, 'truncated.wav'), wav.subarray(0, wav.length - 1));
}, 60000);
afterAll(async () => { await rm(generated, { recursive: true, force: true }); });
async function fixture(boundary?: LocalAssetRegistryOptions['boundary'], mediaObserver?: LocalAssetRegistryOptions['mediaObserver']) {
    const root = await mkdtemp(join(tmpdir(), 'narralens-local-asset-host-')), sourceRoot = join(root, 'input'), storageRoot = join(root, 'prepared-assets');
    await cp(generated, sourceRoot, { recursive: true });
    let app!: CreationApplication;
    const host = new NarralensHost({ catalog: new ProjectCatalog(new Map()), dbPath: join(root, 'host.sqlite'), snapshotsRoot: join(root, 'snapshots'), adoptionStagingRoot: join(root, 'stage'), migrationsRoot: join(root, 'migrations'), derivedRoot: join(root, 'derived'), openFilmVendorRoot: vendorRoot, agentApplication: instance => app = new CreationApplication(instance, { createdRoot: join(root, 'projects'), vendorRoot, worker: { pollMs: 10 }, localAssets: { sourceRoot, storageRoot, ...(boundary ? { boundary } : {}), ...(mediaObserver ? { mediaObserver } : {}) } }) });
    await host.listen(0);
    const owner = app.auth.issue({ principal_id: 'owner', channel: 'authenticated', expires_at: Date.now() + 300000 }), human = app.auth.issue({ principal_id: 'owner', channel: 'trusted_ui', expires_at: Date.now() + 300000 });
    const request = (path: string, body?: unknown, ui = false) => fetch(host.origin + path, { method: body === undefined ? 'GET' : 'POST', headers: { Origin: host.origin, ...(ui ? { Cookie: app.auth.cookieName + '=' + human.token, 'X-Narralens-CSRF': human.csrf! } : { Authorization: 'Bearer ' + owner.token }), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const vectors = JSON.parse(readFileSync('docs/agent-driven-v1/cp-a0/contract-vectors.json', 'utf8')) as {
        vectors: {
            id: string;
            value: unknown;
        }[];
    };
    const input = structuredClone(vectors.vectors.find(v => v.id === 'definition:IntakePut:valid')!.value) as IntakePut;
    input.intake_id = null;
    input.base_version = 0;
    input.brief.local_asset_ids = [];
    input.brief.narration_asset_id = null;
    input.brief.content_brief.material_strategy.asset_ids = [];
    input.brief.content_brief.material_strategy.narration_asset_id = null;
    input.brief.content_brief.material_strategy.rights_refs = [];
    input.brief.content_brief.script_ref = null;
    input.brief.content_brief.style.style_digest = styleDigest(input.brief.content_brief.style);
    const saved = await request('/api/agent/v1/intakes', input);
    expect(saved.status).toBe(200);
    const intake = await saved.json() as Intake;
    const confirmed = await request('/api/agent/v1/intakes/' + intake.intake_id + '/decision', { meta: { idempotency_key: 'confirm', correlation_id: 'confirm' }, intake_version: 1, brief_sha256: intake.brief_sha256, choice: 'confirm_brief' }, true);
    expect(confirmed.status).toBe(200);
    const decision = await confirmed.json() as Decision;
    const created = await request('/api/agent/v1/projects', { meta: { idempotency_key: 'create', correlation_id: 'create' }, intake_id: intake.intake_id, intake_version: 1, decision_id: decision.decision_id });
    expect(created.status).toBe(202);
    let job = await created.json() as JobReceipt;
    const until = Date.now() + 30000;
    while (Date.now() < until && job.state !== 'succeeded') {
        const response = await request('/api/agent/v1/projects/' + job.project_id + '/jobs/' + job.job_id);
        expect(response.status).toBe(200);
        job = await response.json() as JobReceipt;
        if (['failed', 'cancelled', 'attention'].includes(job.state))
            throw new Error('Creation failed');
        await new Promise(r => setTimeout(r, 10));
    }
    expect(job.state).toBe('succeeded');
    const project = job.project_id!, ui = createTrustedCallerContext({ principal_id: 'owner', channel: 'trusted_ui', source: 'trusted_ui', session_ref: 'real-test-ui' }), driver = createTrustedCallerContext({ principal_id: 'owner', channel: 'authenticated', source: 'driver_relay', session_ref: 'real-test-driver' }), foreign = createTrustedCallerContext({ principal_id: 'other', channel: 'trusted_ui', source: 'trusted_ui', session_ref: 'foreign-test-ui' });
    const video: LocalAssetInput = { project_id: project, idempotency_key: 'video', relative_path: 'video.mp4', expected_sha256: createHash('sha256').update(await readFile(join(sourceRoot, 'video.mp4'))).digest('hex'), kind: 'video', source: { kind: 'generated', label: 'Locally generated diagnostic color, not A footage' }, license: { status: 'cleared', label: 'Test-owned diagnostic generation', commercial_use: true }, recording_origin: null, attestation_ref: 'diagnostic-fixture' };
    const audio: LocalAssetInput = { ...video, idempotency_key: 'audio', relative_path: 'audio.wav', expected_sha256: createHash('sha256').update(await readFile(join(sourceRoot, 'audio.wav'))).digest('hex'), kind: 'audio', recording_origin: 'synthetic' };
    const registry = app.localAssets!;
    const count = () => Number(host.revisions.compose(db => db.prepare('SELECT count(*) AS n FROM created_local_asset').get()?.n));
    return { root, sourceRoot, storageRoot, host, app, project, ui, driver, foreign, video, audio, registry, count, close: async () => { await host.close(); await rm(root, { recursive: true, force: true }); } };
}
it('actually probes and fully decodes video and synthetic diagnostic audio into the same Host database without modifying native source', async () => {
    const f = await fixture();
    try {
        const author = join(f.root, 'projects', f.project, 'source', 'film.html'), before = await readFile(author);
        const video = await f.registry.import(f.video, f.ui), audio = await f.registry.import(f.audio, f.ui);
        expect(video.asset_id.length).toBeLessThanOrEqual(64);
        expect(audio.rights_ref.length).toBeLessThanOrEqual(64);
        expect(video.media).toMatchObject({ kind: 'video', duration_frames: 30, width: 160, height: 90, codec: 'h264' });
        expect(audio.media).toMatchObject({ kind: 'audio', duration_frames: 30, sample_rate: 48000, channels: 1 });
        expect(audio.attestation.recording_origin).toBe('synthetic');
        expect(f.registry.list(f.project, f.driver)).toHaveLength(2);
        expect(f.count()).toBe(2);
        expect(JSON.stringify(video)).not.toContain(f.root);
        expect(await readFile(author)).toEqual(before);
        expect(f.host.revisions.activeCommit(f.project)?.revision).toBe(1);
        expect(await readdir(join(f.storageRoot, 'staging'))).toEqual([]);
        const resolved = await f.registry.resolve(f.project, audio.asset_id, f.driver);
        expect(createHash('sha256').update(await readFile(resolved.absolute_path)).digest('hex')).toBe(f.audio.expected_sha256);
    }
    finally {
        await f.close();
    }
}, 120000);
it('requires real trusted UI provenance and ownership before reading files or recording rights', async () => {
    const f = await fixture();
    try {
        await expect(f.registry.import(f.video, f.driver)).rejects.toMatchObject({ code: 'ORIGIN_REJECTED' });
        await expect(f.registry.import(f.video, f.foreign)).rejects.toMatchObject({ code: 'NOT_FOUND' });
        await expect(f.registry.import(f.video, { principal_id: 'owner', channel: 'trusted_ui', source: 'trusted_ui', session_ref: 'forged-body' } as never)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
        expect(f.count()).toBe(0);
    }
    finally {
        await f.close();
    }
}, 120000);
it('replays the original registration without reimporting changed input and refuses a conflicting key', async () => {
    const f = await fixture();
    try {
        const asset = await f.registry.import(f.video, f.ui);
        await unlink(join(f.sourceRoot, 'video.mp4'));
        expect(await f.registry.import(f.video, f.ui)).toEqual(asset);
        await expect(f.registry.import({ ...f.video, license: { ...f.video.license, status: 'unknown' } }, f.ui)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
        expect(f.count()).toBe(1);
    }
    finally {
        await f.close();
    }
}, 120000);
it.each(['before_insert', 'after_insert', 'after_receipt', 'after_event'] as const)('rolls back row, command and outbox together at %s, preserving an unreferenced blob for a safe retry', async (point) => {
    let enabled = true;
    const f = await fixture(at => {
        if (enabled && at === point)
            throw new Error('injected SQL boundary');
    });
    try {
        const before = f.host.revisions.outboxRowCount('asset.local.registered');
        await expect(f.registry.import(f.video, f.ui)).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' });
        expect(f.count()).toBe(0);
        expect(f.host.revisions.outboxRowCount('asset.local.registered')).toBe(before);
        expect(f.host.revisions.compose(db => db.prepare("SELECT count(*) AS n FROM operation_idempotency WHERE operation_kind='agent.v1:local-asset.import'").get()?.n)).toBe(0);
        enabled = false;
        await f.registry.import(f.video, f.ui);
        expect(f.count()).toBe(1);
        expect(f.host.revisions.outboxRowCount('asset.local.registered')).toBe(before + 1);
    }
    finally {
        await f.close();
    }
}, 120000);
it('checks real input hashes, paths and media rather than accepting metadata as proof', async () => {
    const f = await fixture();
    try {
        await expect(f.registry.import({ ...f.video, relative_path: '../outside' }, f.ui)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
        await expect(f.registry.import({ ...f.video, expected_sha256: '0'.repeat(64) }, f.ui)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
        const outside = join(f.root, 'outside.mp4');
        await cp(join(f.sourceRoot, 'video.mp4'), outside);
        await symlink(outside, join(f.sourceRoot, 'alias.mp4'));
        await expect(f.registry.import({ ...f.video, relative_path: 'alias.mp4' }, f.ui)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
        await writeFile(join(f.sourceRoot, 'bad.mp4'), 'not media');
        await expect(f.registry.import({ ...f.video, relative_path: 'bad.mp4', expected_sha256: createHash('sha256').update('not media').digest('hex') }, f.ui)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
        expect(f.count()).toBe(0);
        expect(await readdir(join(f.storageRoot, 'staging'))).toEqual([]);
    }
    finally {
        await f.close();
    }
}, 120000);
it('preserves unknown license and synthetic origin as facts rather than silently clearing them', async () => {
    const f = await fixture();
    try {
        const result = await f.registry.import({ ...f.audio, license: { status: 'unknown', commercial_use: false, label: 'Not cleared' } }, f.ui);
        expect(result.license).toEqual({ status: 'unknown', commercial_use: false, label: 'Not cleared' });
        expect(result.attestation.recording_origin).toBe('synthetic');
    }
    finally {
        await f.close();
    }
}, 120000);
it('detects a published blob changed inside the final SQL boundary and commits no registration', async () => {
    const f = await fixture(point => {
        if (point === 'after_event')
            writeFileSync(join(f.storageRoot, 'objects', f.video.expected_sha256 + '.mp4'), 'tampered');
    });
    try {
        await expect(f.registry.import(f.video, f.ui)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
        expect(f.count()).toBe(0);
        expect(f.host.revisions.outboxRowCount('asset.local.registered')).toBe(0);
    }
    finally {
        await f.close();
    }
}, 120000);
it('converges concurrent same-key imports to one immutable row, one command and one business event', async () => {
    const f = await fixture();
    try {
        const results = await Promise.all([f.registry.import(f.video, f.ui), f.registry.import(f.video, f.ui)]);
        expect(results[0]).toEqual(results[1]);
        expect(f.count()).toBe(1);
        expect(f.host.revisions.outboxRowCount('asset.local.registered')).toBe(1);
        expect(await readdir(join(f.storageRoot, 'staging'))).toEqual([]);
    }
    finally {
        await f.close();
    }
}, 120000);
it('rounds audio directly from sample time to project frames rather than rounding through displayed milliseconds', async () => {
    const f = await fixture();
    try {
        const bytes = await readFile(join(f.sourceRoot, 'one-frame.wav'));
        const asset = await f.registry.import({ ...f.audio, relative_path: 'one-frame.wav', expected_sha256: createHash('sha256').update(bytes).digest('hex') }, f.ui);
        expect(asset.media.duration_ms).toBe(34);
        expect(asset.media.duration_frames).toBe(1);
    }
    finally {
        await f.close();
    }
}, 120000);
it('refuses truncated audio and a video with a damaged audio track even when video-only legacy validation passes', async () => {
    const f = await fixture();
    try {
        const badVideo = join(f.sourceRoot, 'bad-audio-track.mp4'), videoSha = createHash('sha256').update(await readFile(badVideo)).digest('hex');
        // Proves why a video-only decode is insufficient; it is not a bypass used by production.
        expect((await validateImportedMedia(badVideo, 30, videoSha)).durationFrames).toBe(30);
        await expect(f.registry.import({ ...f.video, relative_path: 'bad-audio-track.mp4', expected_sha256: videoSha }, f.ui)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
        const badAudio = await readFile(join(f.sourceRoot, 'truncated.wav'));
        await expect(f.registry.import({ ...f.audio, relative_path: 'truncated.wav', expected_sha256: createHash('sha256').update(badAudio).digest('hex') }, f.ui)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
        expect(f.count()).toBe(0);
    }
    finally {
        await f.close();
    }
}, 120000);
it('refuses local storage overlapping author, snapshot or input domains before creating directories', async () => {
    const f = await fixture();
    try {
        for (const protectedPath of [join(f.root, 'projects', 'unwanted'), join(f.root, 'snapshots', 'unwanted'), join(f.sourceRoot, 'unwanted'), f.root]) {
            expect(() => new LocalAssetRegistry(f.host.revisions, f.app.creation, { sourceRoot: f.sourceRoot, storageRoot: protectedPath, projectsRoot: join(f.root, 'projects'), snapshotsRoot: join(f.root, 'snapshots') })).toThrow(/overlaps/);
        }
        const alias = join(f.root, 'snapshot-alias');
        await symlink(join(f.root, 'snapshots'), alias, 'dir');
        expect(() => new LocalAssetRegistry(f.host.revisions, f.app.creation, { sourceRoot: f.sourceRoot, storageRoot: join(f.root, 'snapshots', 'unwanted'), projectsRoot: join(f.root, 'projects'), snapshotsRoot: alias })).toThrow(/overlaps/);
        expect(await readdir(join(f.root, 'snapshots'))).not.toContain('unwanted');
    }
    finally {
        await f.close();
    }
}, 120000);
it('does not follow a newly redirected configured source root, even when replacement bytes have the declared hash', async () => {
    const f = await fixture();
    try {
        const outside = join(f.root, 'other-input');
        await cp(f.sourceRoot, outside, { recursive: true });
        await rename(f.sourceRoot, f.sourceRoot + '-original');
        await symlink(outside, f.sourceRoot, 'dir');
        await expect(f.registry.import(f.video, f.ui)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
        expect(f.count()).toBe(0);
    }
    finally {
        await f.close();
    }
}, 120000);
it('captures trusted input by value before asynchronous inspection rather than accepting later permission changes', async () => {
    const f = await fixture();
    try {
        const input = { ...f.audio, license: { status: 'unknown' as const, commercial_use: false, label: 'Initial unapproved rights' } };
        const running = f.registry.import(input, f.ui);
        (input.license as {
            status: string;
        }).status = 'cleared';
        input.license.commercial_use = true;
        const asset = await running;
        expect(asset.license.status).toBe('unknown');
        expect(asset.license.commercial_use).toBe(false);
    }
    finally {
        await f.close();
    }
}, 120000);
it.each(['cancel', 'timeout'] as const)('waits for the actual media child to close after %s and reports a retryable tool boundary', async (mode) => {
    const root = await mkdtemp(join(tmpdir(), 'narralens-local-tool-lifecycle-'));
    let pid: number | undefined;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const path = join(root, 'video.mp4');
        await cp(join(generated, 'video.mp4'), path);
        const running = runLocalMediaTool('ffmpeg', ['-nostdin', '-hide_banner', '-v', 'error', '-re', '-i', path, '-map', '0:v', '-f', 'null', '-'], { signal: controller.signal, timeoutMs: mode === 'timeout' ? 100 : 5000, onSpawn: childPid => {
                pid = childPid;
                if (mode === 'cancel')
                    timer = setTimeout(() => controller.abort(), 100);
            } });
        await expect(running).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE', message: mode === 'cancel' ? 'Media inspection was cancelled' : 'Media inspection exceeded its deadline' });
        expect(pid).toBeDefined();
        expect(() => process.kill(pid!, 0)).toThrow();
    }
    finally {
        clearTimeout(timer);
        await rm(root, { recursive: true, force: true });
    }
}, 30000);
it('bounds real concurrent imports to two and removes a cancelled queued request without leaking a slot', async () => {
    const f = await fixture();
    try {
        const controller = new AbortController();
        const first = f.registry.import({ ...f.video, idempotency_key: 'capacity-one' }, f.ui);
        const second = f.registry.import({ ...f.video, idempotency_key: 'capacity-two' }, f.ui);
        const queued = f.registry.import({ ...f.video, idempotency_key: 'capacity-queued' }, f.ui, controller.signal);
        expect(f.registry.capacity).toEqual({ running: 2, queued: 1, limit: 2 });
        controller.abort();
        await expect(queued).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' });
        expect(f.registry.capacity.queued).toBe(0);
        await Promise.all([first, second]);
        expect(f.registry.capacity).toEqual({ running: 0, queued: 0, limit: 2 });
        expect(f.count()).toBe(1);
        expect(f.host.revisions.compose(db => db.prepare("SELECT count(*) AS n FROM operation_idempotency WHERE operation_kind='agent.v1:local-asset.import'").get()?.n)).toBe(2);
        // TWO receipts, ONE immutable asset fact and ONE business event: the second
        // import of the same content converges on the first, it does not register a
        // second registration.
        expect(f.host.revisions.outboxRowCount('asset.local.registered')).toBe(1);
    }
    finally {
        await f.close();
    }
}, 120000);
/**
 * The published blob is proved again when only the change time of its inode moved.
 *
 * The published object is content-addressed: another publisher that links or unlinks
 * its own staging name moves the change time of that very inode while not one byte
 * of it moves. The observation point is exactly in that window - after the initial
 * stat of the published blob and before its bytes are read - so the case can make
 * the real proof window happen on purpose, with real links.
 *
 * What is proved here is a FACT about the content: the change time moved, the whole
 * content identity did not, and the content was proved again from the same
 * descriptor. It is NOT a claim about WHY the change time moved.
 */
it('proves a published blob again when only the change time of its inode moved, and keeps every other change refused', async () => {
    const observations: { readonly dev: string; readonly ino: string; readonly size: string; readonly mtime: string; readonly ctime_before: string; readonly ctime_after: string; readonly sha256: string }[] = [];
    let hits = 0;
    const f = await fixture((point: Parameters<NonNullable<LocalAssetRegistryOptions['boundary']>>[0]) => {
        if (point !== 'after_published_stat')
            return;
        hits += 1;
        const published = join(f.storageRoot, 'objects', `${f.video.expected_sha256}.mp4`);
        const before = statSync(published, { bigint: true });
        // A REAL link and unlink of the very inode: the number of its names changes,
        // so its change time moves - and its bytes do not move at all.
        const extra = join(f.storageRoot, 'objects', `proof-window-${hits}.link`);
        linkSync(published, extra);
        unlinkSync(extra);
        const after = statSync(published, { bigint: true });
        observations.push({
            dev: before.dev.toString(), ino: before.ino.toString(), size: before.size.toString(), mtime: before.mtimeNs.toString(),
            ctime_before: before.ctimeNs.toString(), ctime_after: after.ctimeNs.toString(),
            sha256: createHash('sha256').update(readFileSync(published)).digest('hex'),
        });
    });
    try {
        const asset = await f.registry.import(f.video, f.ui);
        expect(asset.sha256).toBe(f.video.expected_sha256);
        // The observation point really fired, on the real proof of the published blob.
        expect(hits).toBeGreaterThan(0);
        expect(observations.length).toBe(hits);
        const observed = observations[0]!;
        // The change time of the inode really moved: a strict comparison of the whole
        // identity - the change time included - would have refused this blob.
        expect(observed.ctime_before).not.toBe(observed.ctime_after);
        // Everything else about the file is exactly what it was: the same device, the
        // same inode, the same size, the same modification time.
        const current = statSync(join(f.storageRoot, 'objects', `${f.video.expected_sha256}.mp4`), { bigint: true });
        expect(current.dev.toString()).toBe(observed.dev);
        expect(current.ino.toString()).toBe(observed.ino);
        expect(current.size.toString()).toBe(observed.size);
        expect(current.mtimeNs.toString()).toBe(observed.mtime);
        // And the content is still the content that was asked for.
        expect(observed.sha256).toBe(f.video.expected_sha256);
        expect(f.count()).toBe(1);
    }
    finally {
        await f.close();
    }
}, 120000);
it('preserves cancellation through the actual video validator wrapper and waits for its media child before returning', async () => {
    const controller = new AbortController();
    let pid: number | undefined;
    const f = await fixture(undefined, event => {
        if (event.command === 'ffprobe' && pid === undefined) {
            pid = event.pid;
            controller.abort();
        }
    });
    try {
        await expect(f.registry.import(f.video, f.ui, controller.signal)).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' });
        expect(pid).toBeDefined();
        expect(() => process.kill(pid!, 0)).toThrow();
        expect(f.count()).toBe(0);
        expect(f.registry.capacity.running).toBe(0);
        expect(await readdir(join(f.storageRoot, 'staging'))).toEqual([]);
    }
    finally {
        await f.close();
    }
}, 120000);
it('quiesces admitted local imports and their real media child before the Host closes its shared database', async () => {
    let shutdown: Promise<void> | undefined, pid: number | undefined;
    const f = await fixture(undefined, event => {
        if (event.command === 'ffprobe' && pid === undefined) {
            pid = event.pid;
            shutdown = f.host.close();
        }
    });
    try {
        const outcome = await Promise.allSettled([f.registry.import(f.video, f.ui)]);
        expect(outcome[0]?.status).toBe('rejected');
        expect(shutdown).toBeDefined();
        await shutdown;
        expect(pid).toBeDefined();
        expect(() => process.kill(pid!, 0)).toThrow();
        expect(f.registry.capacity).toEqual({ running: 0, queued: 0, limit: 2 });
        await expect(f.registry.import(f.video, f.ui)).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE', message: 'Local asset service is stopping' });
        expect(await readdir(join(f.storageRoot, 'staging'))).toEqual([]);
    }
    finally {
        await f.close();
    }
}, 120000);
it.each(['before_stage_create', 'before_publish'] as const)('keeps snapshot bytes untouched when a storage parent is replaced exactly at %s', async (boundary) => {
    let redirected = false;
    const f = await fixture(point => {
        if (point !== boundary || redirected)
            return;
        redirected = true;
        const storage = join(f.storageRoot, boundary === 'before_publish' ? 'objects' : 'staging');
        renameSync(storage, storage + '-original');
        symlinkSync(f.host.snapshots.snapshotRoot(f.project, f.host.revisions.activeCommit(f.project)!.snapshot_id) + '/source', storage, 'dir');
    });
    try {
        const snapshot = f.host.snapshots.snapshotRoot(f.project, f.host.revisions.activeCommit(f.project)!.snapshot_id), source = join(snapshot, 'source');
        const beforeNames = await readdir(source), before = await readFile(join(source, 'film.html'));
        await expect(f.registry.import(f.video, f.ui)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
        expect(redirected).toBe(true);
        expect(await readdir(source)).toEqual(beforeNames);
        expect(await readFile(join(source, 'film.html'))).toEqual(before);
        expect(f.count()).toBe(0);
        const staged = join(f.storageRoot, boundary === 'before_stage_create' ? 'staging-original' : 'staging');
        expect(await readdir(staged)).toEqual([]);
    }
    finally {
        await f.close();
    }
}, 120000);
