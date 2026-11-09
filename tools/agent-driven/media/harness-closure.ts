import { createHash } from 'node:crypto';
import { readFile, readdir, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assertSafeRelativePath } from '../../../src/host/render/snapshot-copy.js';
import type { SnapshotClosure, SnapshotEntry, SnapshotRightsFact } from '../../../src/host/render/ports.js';
/** Diagnostic operator attestations only. Never a production rights authority. */
export interface HarnessRight {
    readonly relative_path: string;
    readonly sha256: string;
    readonly asset_id: string;
    readonly rights_ref: string;
    readonly status: SnapshotRightsFact['status'];
    readonly commercial_use: boolean;
    readonly evidence_ref: string;
}
const supplements = new Map([['subtitles.vtt', 'subtitles'], ['subtitles.srt', 'subtitles'], ['rights.txt', 'rights'], ['LICENSE.txt', 'rights'], ['license.txt', 'rights']]);
const nativeSource = /\.(html?|css|[cm]?js|json)$/i;
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
function parseRights(value: unknown): HarnessRight[] {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Invalid explicit harness rights manifest');
    const doc = value as Record<string, unknown>;
    if (Object.keys(doc).sort().join(',') !== 'assets,schema_version' || doc.schema_version !== 'narralens.harness-rights@1' || !Array.isArray(doc.assets))
        throw new Error('Invalid explicit harness rights manifest');
    const paths = new Set<string>(), keys = new Set<string>();
    return doc.assets.map((raw: unknown) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw))
            throw new Error('Invalid harness rights row');
        const row = raw as Record<string, unknown>;
        if (Object.keys(row).sort().join(',') !== 'asset_id,commercial_use,evidence_ref,relative_path,rights_ref,sha256,status' || typeof row.relative_path !== 'string' || typeof row.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.sha256) || !['cleared', 'restricted', 'unknown'].includes(String(row.status)) || typeof row.commercial_use !== 'boolean' || typeof row.evidence_ref !== 'string' || !row.evidence_ref.trim() || typeof row.asset_id !== 'string' || !row.asset_id || typeof row.rights_ref !== 'string' || !row.rights_ref)
            throw new Error('Invalid harness rights row');
        const path = assertSafeRelativePath(row.relative_path);
        if (paths.has(path) || keys.has(row.rights_ref) || keys.has(row.asset_id))
            throw new Error('Ambiguous harness rights declaration');
        paths.add(path);
        keys.add(row.asset_id);
        keys.add(row.rights_ref);
        return raw as HarnessRight;
    });
}
export async function buildHarnessClosure(directory: string, options: {
    expected_frames: number | undefined;
    expected_duration_seconds: number | undefined;
    rights_manifest: string | undefined;
}): Promise<SnapshotClosure> {
    const root = await realpath(directory);
    const declarations = options.rights_manifest === undefined ? [] : parseRights(JSON.parse(await readFile(options.rights_manifest, 'utf8')));
    const byPath = new Map(declarations.map(row => [row.relative_path, row])), seen = new Set<string>();
    const entries: SnapshotEntry[] = [], rights: SnapshotRightsFact[] = [];
    async function walk(current: string, prefix: string): Promise<void> {
        for (const item of (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
            const relative = assertSafeRelativePath(prefix ? prefix + '/' + item.name : item.name);
            if (item.isSymbolicLink())
                throw new Error('Harness source may not contain symbolic links');
            if (item.isDirectory()) {
                if (['.film', 'node_modules', '.git'].includes(item.name))
                    continue;
                await walk(resolve(current, item.name), relative);
                continue;
            }
            if (!item.isFile())
                throw new Error('Harness source contains a nonregular entry');
            const path = resolve(current, item.name), bytes = await readFile(path), digest = sha(bytes);
            const declaration = byPath.get(relative), role = supplements.get(relative) ?? null;
            if (declaration && declaration.sha256 !== digest)
                throw new Error('Harness rights declaration does not match actual bytes');
            if (declaration) {
                seen.add(relative);
                rights.push({ asset_id: declaration.asset_id, status: declaration.status, commercial_use: declaration.commercial_use, ref: declaration.rights_ref });
            }
            entries.push({ relative_path: relative, absolute_path: path, sha256: digest, bytes: bytes.length, kind: role ? 'supplement' : declaration || !nativeSource.test(relative) ? 'asset' : 'native_source', rights_ref: declaration?.rights_ref ?? null, role });
        }
    }
    await walk(root, '');
    if (declarations.some(row => !seen.has(row.relative_path)))
        throw new Error('Harness rights manifest names a file outside the diagnostic closure');
    const sourceDigest = sha(entries.map(entry => `${entry.relative_path}:${entry.sha256}`).sort().join('\n'));
    return { project_id: 'harness', snapshot_id: 'harness', source_digest: sourceDigest, project_revision: 0, expected_frames: options.expected_frames, expected_duration_seconds: options.expected_duration_seconds, native_root: root, native_entry: 'film.html', entries, rights };
}
