/** Pure Node import probe: no TS loader, native-module execution, browser, Host, render or media process. */
import { readFile } from 'node:fs/promises';
import { buildPinnedNativeSubtitleBurnSource } from '../../../src/host/render/native-subtitle-burn-source.mjs';
import fixture from './native-subtitle-burn.fixture.json' with { type: 'json' };

const result = buildPinnedNativeSubtitleBurnSource({ ...fixture.input, subtitle_module_bytes: await readFile(process.argv[2]) });
process.stdout.write(JSON.stringify({ entry: result.entry, files: result.files.map(file => ({ path: file.relative_path, sha256: file.sha256 })) }) + '\n');
