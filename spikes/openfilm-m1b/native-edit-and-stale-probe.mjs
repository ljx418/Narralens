import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { editProjectFilm, readProjectFilm } from '../../vendor/openfilm/packages/openfilm/studio/server/film.mjs';

const root = resolve(process.argv[2]);
const probe = await mkdtemp(join(tmpdir(), 'narralens-openfilm-stale-'));
await cp(root, probe, { recursive: true });

const original = await readProjectFilm(root);
const edited = await editProjectFilm(root, original.rev, [{ op: 'set', clip: 'shot-02', field: 'overrides', value: [{
  at: '#editable-title', text: '选择更清晰的表达', t: [0, -36], style: { color: '#fff3a3' },
}] }]);

const probeBase = await readProjectFilm(probe);
await editProjectFilm(probe, probeBase.rev, [{ op: 'set', clip: 'shot-01', field: 'overrides', value: [{ at: '.t', text: '外部修改' }] }]);
const nativeRebase = await editProjectFilm(probe, probeBase.rev, [{ op: 'set', clip: 'shot-03', field: 'overrides', value: [{ at: '.t', text: '原生旧 base 仍写入' }] }]);

const strictBase = await readProjectFilm(probe);
await editProjectFilm(probe, strictBase.rev, [{ op: 'set', clip: 'shot-01', field: 'overrides', value: [{ at: '.t', text: '第二次外部修改' }] }]);
const beforeReject = await readFile(join(probe, 'film.html'));
let rejected = null;
try {
  const current = await readProjectFilm(probe);
  if (current.rev !== strictBase.rev) throw Object.assign(new Error('REVISION_CONFLICT'), { status: 409, code: 'REVISION_CONFLICT' });
  await editProjectFilm(probe, strictBase.rev, [{ op: 'set', clip: 'shot-02', field: 'at', value: 11 }]);
} catch (error) {
  rejected = { status: error.status, code: error.code, message: error.message };
}
const afterReject = await readFile(join(probe, 'film.html'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
assert.equal(edited.rebased, false);
assert.deepEqual(edited.doc.tracks[0].clips.map((clip) => clip.id), ['shot-01', 'shot-02', 'shot-03']);
assert.equal(nativeRebase.rebased, true);
assert.deepEqual(rejected, { status: 409, code: 'REVISION_CONFLICT', message: 'REVISION_CONFLICT' });
assert.equal(hash(beforeReject), hash(afterReject));
console.log(JSON.stringify({
  main: { base_rev: original.rev, new_rev: edited.rev, rebased: edited.rebased, clips: edited.doc.tracks[0].clips.map((clip) => clip.id) },
  native_stale_base: { base_rev: probeBase.rev, result_rev: nativeRebase.rev, rebased: nativeRebase.rebased },
  narralens_gateway: { rejected, before_sha256: hash(beforeReject), after_sha256: hash(afterReject), unchanged: hash(beforeReject) === hash(afterReject) },
}, null, 2));
await rm(probe, { recursive: true, force: true });
