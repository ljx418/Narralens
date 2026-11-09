import { afterEach, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { buildHarnessClosure } from '../../../tools/agent-driven/media/harness-closure.js';
const roots: string[] = [];
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const files = { 'film.html': '<html>diagnostic native source</html>', 'clip.mp4': 'diagnostic media bytes, not playable film evidence', 'subtitles.vtt': 'WEBVTT\n\n00:00.000 --> 00:01.000\n诊断字幕\n', 'rights.txt': 'Internal diagnostic fixture declaration only' };
async function fixture() { const root = await mkdtemp(join(tmpdir(), 'narralens-harness-')); roots.push(root); for (const [name, bytes] of Object.entries(files))
    await writeFile(join(root, name), bytes); return root; }
const options = { expected_frames: 30, expected_duration_seconds: 1, rights_manifest: undefined };
const declarations = () => Object.entries(files).filter(([name]) => name !== 'film.html').map(([relative_path, bytes], i) => ({ relative_path, sha256: hash(bytes), asset_id: 'asset' + i, rights_ref: 'right' + i, status: 'cleared', commercial_use: true, evidence_ref: 'internal-diagnostic-fixture' }));
afterEach(async () => { for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true }); });
it('classifies actual subtitles/rights/media and invents no cleared permission for an arbitrary directory', async () => {
    const root = await fixture(), closure = await buildHarnessClosure(root, options);
    expect(closure.entries.find(x => x.relative_path === 'film.html')?.kind).toBe('native_source');
    expect(closure.entries.find(x => x.relative_path === 'clip.mp4')).toMatchObject({ kind: 'asset', rights_ref: null });
    expect(closure.entries.find(x => x.relative_path === 'subtitles.vtt')).toMatchObject({ kind: 'supplement', role: 'subtitles', rights_ref: null });
    expect(closure.entries.find(x => x.relative_path === 'rights.txt')).toMatchObject({ kind: 'supplement', role: 'rights', rights_ref: null });
    expect(closure.rights).toEqual([]);
});
it('uses explicit byte-bound diagnostic rights facts for every asset and supplement', async () => {
    const root = await fixture(), manifest = join(root, '..', root.split('/').at(-1) + '-rights.json');
    roots.push(manifest);
    await writeFile(manifest, JSON.stringify({ schema_version: 'narralens.harness-rights@1', assets: declarations() }));
    const closure = await buildHarnessClosure(root, { ...options, rights_manifest: manifest });
    expect(closure.rights).toHaveLength(3);
    for (const entry of closure.entries.filter(x => x.kind !== 'native_source'))
        expect(closure.rights.find(right => right.ref === entry.rights_ref)?.status).toBe('cleared');
});
it.each(['wrong-bytes', 'absent-file', 'cross-alias'] as const)('rejects ambiguous or false manifest evidence: %s', async (mode) => {
    const root = await fixture(), manifest = join(root, '..', root.split('/').at(-1) + '-rights.json');
    roots.push(manifest);
    const assets = declarations();
    if (mode === 'wrong-bytes')
        assets[0]!.sha256 = '0'.repeat(64);
    if (mode === 'absent-file')
        assets[0]!.relative_path = 'missing.mp4';
    if (mode === 'cross-alias')
        assets[1]!.rights_ref = assets[0]!.asset_id;
    await writeFile(manifest, JSON.stringify({ schema_version: 'narralens.harness-rights@1', assets }));
    await expect(buildHarnessClosure(root, { ...options, rights_manifest: manifest })).rejects.toThrow();
});
it('refuses source symlinks instead of silently omitting a referenced file', async () => {
    const root = await fixture();
    await symlink(join(root, 'clip.mp4'), join(root, 'alias.mp4'));
    await expect(buildHarnessClosure(root, options)).rejects.toThrow(/symbolic/);
});
it.each(['font.woff2', 'opaque.dat'])('requires explicit permission for non-source resources such as %s', async (name) => {
    const root = await fixture();
    await writeFile(join(root, name), 'diagnostic bytes');
    const closure = await buildHarnessClosure(root, options);
    expect(closure.entries.find(entry => entry.relative_path === name)).toMatchObject({ kind: 'asset', rights_ref: null });
});
