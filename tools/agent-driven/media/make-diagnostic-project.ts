/** Creates owned synthetic tool diagnostics, never a real-person A acceptance fixture. */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { migrateToOpenFilm } from '../../../src/host/projects/openfilm-migrator.js';
import { FPS_30 } from '../../../src/host/engine/time-model.js';
const argument = process.argv[2];
if (!argument)
    throw new Error('Explicit fresh diagnostic directory required');
const root = resolve(argument);
await mkdir(root);
const input = join(root, 'input');
await mkdir(input);
const sampleRate = 16000, buffer = Buffer.alloc(44 + sampleRate * 2);
buffer.write('RIFF', 0);
buffer.writeUInt32LE(buffer.length - 8, 4);
buffer.write('WAVEfmt ', 8);
buffer.writeUInt32LE(16, 16);
buffer.writeUInt16LE(1, 20);
buffer.writeUInt16LE(1, 22);
buffer.writeUInt32LE(sampleRate, 24);
buffer.writeUInt32LE(sampleRate * 2, 28);
buffer.writeUInt16LE(2, 32);
buffer.writeUInt16LE(16, 34);
buffer.write('data', 36);
buffer.writeUInt32LE(sampleRate * 2, 40);
for (let i = 0; i < sampleRate; i++)
    buffer.writeInt16LE(Math.round(6000 * Math.sin(2 * Math.PI * 440 * i / sampleRate)), 44 + i * 2);
await writeFile(join(input, 'tone.wav'), buffer);
await writeFile(join(input, 'subtitles.vtt'), 'WEBVTT\n\n00:00.000 --> 00:01.000\n技术测试：此声音是测试音，不是真人旁白。\n');
const project = join(root, 'project');
await migrateToOpenFilm({ sourceRoot: input, targetRoot: project, clips: [0, 1, 2].map(index => ({ source_id: 'diagnostic-' + index, start_frame: index * 10, end_frame_exclusive: (index + 1) * 10, title: '仅工具诊断 ' + (index + 1) })), narration: { source_path: 'tone.wav', target_path: 'assets/diagnostic-tone.wav' }, subtitles: [{ source_path: 'subtitles.vtt', target_path: 'subtitles.vtt' }], assets: [], fps: FPS_30, stage: { width: 320, height: 180 } });
await writeFile(join(project, 'rights.txt'), 'Internally generated diagnostic source/subtitles/tone. This is not licensed user footage, human narration, A acceptance, or a production delivery.\n');
const assets = [];
for (const [index, relative] of ['assets/diagnostic-tone.wav', 'subtitles.vtt', 'rights.txt'].entries())
    assets.push({ relative_path: relative, sha256: createHash('sha256').update(await readFile(join(project, relative))).digest('hex'), asset_id: 'diagnostic_asset_' + index, rights_ref: 'diagnostic_right_' + index, status: 'cleared', commercial_use: true, evidence_ref: 'internally-generated-tool-diagnostic' });
await writeFile(join(root, 'rights-manifest.json'), JSON.stringify({ schema_version: 'narralens.harness-rights@1', assets }, null, 2) + '\n');
process.stdout.write(JSON.stringify({ scope: 'Synthetic one-second diagnostic only; no real human narration, no A acceptance', project, rights_manifest: join(root, 'rights-manifest.json'), frames: 30, width: 320, height: 180 }) + '\n');
