import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { buildPinnedNativeSubtitleBurnSource, NATIVE_SUBTITLE_MODULE_SHA256, type NativeSubtitleBurnInput } from '../../../src/host/render/native-subtitle-burn-source.mjs';
import { buildPinnedNativeSubtitleBurnSource as typedEntry } from '../../../src/host/render/native-subtitle-burn-source.js';
import fixture from './native-subtitle-burn.fixture.json' with { type: 'json' };

const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const modulePath = '/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm/packages/openfilm/studio/server/film-subtitle.mjs';
async function input(): Promise<NativeSubtitleBurnInput> {
  return { ...structuredClone(fixture.input), subtitle_module_bytes: await readFile(modulePath) };
}
// Pure generated-source checks. No browser, native render, decoded media or subtitle pixels are executed here.
describe('direct Node mjs native subtitle source adapter', () => {
  it('loads in a plain Node child without TypeScript loader or extension rewriting', async () => {
    const env = { ...process.env }; delete env.NODE_OPTIONS; delete env.NODE_PATH;
    const result = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('./native-subtitle-burn-node-probe.mjs', import.meta.url)), modulePath], { env });
    const observed = JSON.parse(result.stdout);
    expect(observed.files[0].sha256).toBe(fixture.expected_page_sha256);
    expect(observed.files[1].sha256).toBe(NATIVE_SUBTITLE_MODULE_SHA256);
  });
  it('has one implementation and preserves original-template bytes/hash deterministically', async () => {
    expect(typedEntry).toBe(buildPinnedNativeSubtitleBurnSource);
    const source = await input(); const first = buildPinnedNativeSubtitleBurnSource(source), second = buildPinnedNativeSubtitleBurnSource(source);
    expect(first).toEqual(second);
    expect(first.files[0]!.sha256).toBe(fixture.expected_page_sha256);
    expect(first.files.map(file => file.sha256)).toEqual(first.files.map(file => hash(file.bytes)));
    expect(first.files[1]!.sha256).toBe(NATIVE_SUBTITLE_MODULE_SHA256);
    // Own copied module bytes cannot be changed by mutating the caller's source after generation.
    source.subtitle_module_bytes[0] = source.subtitle_module_bytes[0]! ^ 1;
    expect(hash(first.files[1]!.bytes)).toBe(NATIVE_SUBTITLE_MODULE_SHA256);
  });
  it('escapes hostile cue markup and retains the exact native ready/sound/cut forwarding source', async () => {
    const page = Buffer.from(buildPinnedNativeSubtitleBurnSource(await input()).files[0]!.bytes).toString('utf8');
    expect(page.match(/<\/script>/g)).toHaveLength(1);
    expect(page).not.toContain('</script><script>globalThis.BAD');
    expect(page).toContain('\\u003c/script>');
    expect(page).toContain('await (typeof win.film.ready');
    expect(page).toContain('await inner.film.frame(t)');
    expect(page).toContain('window.__filmSounds = () => inner?.__filmSounds?.() ?? []');
    expect(page).toContain('window.__filmCuts = () => inner?.__filmCuts?.() ?? null');
  });
  it('rejects wrong module bytes and invalid/sparse/nonfinite inputs with fixed ordinary Errors', async () => {
    const valid = await input();
    const bad = new Uint8Array(valid.subtitle_module_bytes); bad[0] = bad[0]! ^ 1;
    expect(() => buildPinnedNativeSubtitleBurnSource({ ...valid, subtitle_module_bytes: bad })).toThrow('The fixed native subtitle renderer does not match');
    for (const invalid of [null, { ...valid, width: 0 }, { ...valid, style: null }, { ...valid, cues: new Array(1) }, { ...valid, cues: [{ text: 'bad', startMs: NaN, durMs: 1 }] }, { ...valid, cues: [{ text: 'late', startMs: 1000, durMs: 1000 }] }]) {
      expect(() => buildPinnedNativeSubtitleBurnSource(invalid as NativeSubtitleBurnInput)).toThrow(Error);
    }
  });
  it('rejects accessors/cycles/toJSON without invoking user code or disclosing thrown paths', async () => {
    const valid = await input(); let called = false;
    const style = Object.defineProperty({}, 'font', { enumerable: true, get() { called = true; throw new Error('/private/operator/credential'); } });
    expect(() => buildPinnedNativeSubtitleBurnSource({ ...valid, style })).toThrow('Invalid native subtitle burn input');
    const hidden = Object.defineProperty({}, 'toJSON', { value() { called = true; throw new Error('/private/operator/credential'); } });
    expect(() => buildPinnedNativeSubtitleBurnSource({ ...valid, style: hidden })).toThrow('Invalid native subtitle burn input');
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    expect(() => buildPinnedNativeSubtitleBurnSource({ ...valid, style: cycle })).toThrow('Invalid native subtitle burn input');
    expect(called).toBe(false);
  });
});
