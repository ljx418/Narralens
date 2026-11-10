/** Candidate test runner. Do not execute until MAIN resource admission; no native/browser/Host evidence. */
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import assert from 'node:assert/strict';
const folder = dirname(fileURLToPath(import.meta.url));
const target = process.argv[2]; if (!target) throw Error('Pass the actual built expected-projection.mjs path');
const { computeExpectedProjection } = await import(pathToFileURL(resolve(target)).href);
const { vectors } = JSON.parse(await readFile(resolve(folder, 'literal-vectors.json'), 'utf8'));
for (const vector of vectors) {
  const result = computeExpectedProjection(vector.input);
  assert.equal(result.status, vector.literal_expected.status, vector.id);
  if (result.status === 'unsupported') assert.equal(result.reason, vector.literal_expected.reason, vector.id);
  else for (const part of ['settings', 'markers']) assert.deepEqual(result[part], vector.literal_expected.parts[part], vector.id + ':' + part);
  console.log('PASS ' + vector.id);
}
console.log(JSON.stringify({ scope: 'pure expected adapter literal vectors only; no real snapshot/media/native UI', cases: vectors.length }));
