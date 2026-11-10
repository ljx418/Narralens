/* Deterministic unit test of the actual candidate helper class. No React render, DOM, native API, browser or Host.
 * Only the class export is appended for testing; its real method bodies are transpiled unchanged. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { createRequire } = require('node:module');
const lane = path.resolve(__dirname, '../../../../..');
const nativeRequire = createRequire(path.join(lane, 'var/managed-native-observation/source/packages/openfilm/package.json'));
const ts = nativeRequire('typescript');
const input = path.resolve(process.argv[2]);
const source = fs.readFileSync(input, 'utf8');
const moduleValue = { exports: {} };
const studioHost = { narralensHydration: { version: 1, onState() {} } };
let hashes = 0;
const sandbox = {
  module: moduleValue, exports: moduleValue.exports, console, TextEncoder, setTimeout,
  require(name) { if (name === 'react') return {}; if (name === './host') return { studioHost }; throw Error('Unexpected dependency ' + name); },
  crypto: { subtle: { digest(...args) { hashes++; return webcrypto.subtle.digest(...args); } } },
};
const context = vm.createContext(sandbox);
const compiled = ts.transpileModule(source + '\nexport { NativeHydrationObserver };\n', {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
});
vm.runInContext(compiled.outputText, context, { filename: input });
const vectors = JSON.parse(fs.readFileSync(path.join(__dirname, 'effective-goldens.json'), 'utf8')).vectors;
context.testClass = moduleValue.exports.NativeHydrationObserver;
context.canonical = moduleValue.exports.hydrationCanonicalJson;
context.studioHost = studioHost;
context.vectorsJson = JSON.stringify(vectors);
context.equal = assert.equal;
context.getHashCount = () => hashes;
context.resetHashCount = () => { hashes = 0; };
vm.runInContext(`(async () => {
  const vectors = JSON.parse(vectorsJson);
  const values = Object.fromEntries(vectors.filter(v => v.relation === 'base').map(v => [v.envelope.part, v.envelope.value]));
  let calls = 0, reads = 0, delivered = 0, failPending = true, failFinal = false;
  studioHost.narralensHydration.onState = (event) => {
    calls++;
    const ready = Object.values(event.parts).every(p => p.state === 'hydrated' || p.state === 'absent_default');
    if (!ready && failPending) { failPending = false; throw Error('intentional first pending callback failure'); }
    if (ready && failFinal) { failFinal = false; throw Error('intentional final callback failure'); }
    if (ready) delivered++;
  };
  const observer = new testClass({ projectId: 'native-unit', editorViewId: 'view-unit', current: () => ({ epoch: 7, valid: true }) }, () => {});
  for (const part of Object.keys(values)) {
    const ticket = observer.parts[part].begin(); observer.parts[part].success(ticket, 'project');
  }
  const snapshots = Object.fromEntries(Object.entries(values).map(([part, value]) => [part, {
    basis: value, value, read: async () => { reads++; return { basis: value, origin: 'project', state: 'hydrated' }; },
  }]));
  const root = { isConnected: true }; // Connection probe only; deliberately not a real DOM claim.
  const flush = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 2)); };
  observer.observe(root, snapshots); await flush();
  equal(reads, 0, 'A pending callback failure must prevent every verification GET in that round');
  equal(getHashCount(), 0, 'A pending callback failure must prevent every hash in that round');
  equal(delivered, 0, 'Callback recovery cannot resurrect the failed original round');
  console.log('PASS failed pending round: zero reads, zero hashes, zero hydrated deliveries');
  observer.observe(root, snapshots); await flush();
  equal(reads, 4, 'A new normal round must perform its own four current verification reads');
  equal(getHashCount(), 4); equal(delivered, 1, 'A new normal round must deliver actual helper hydration');
  console.log('PASS new normal round: four reads/hashes and hydrated delivery');
  failFinal = true;
  observer.observe(root, snapshots); await flush();
  equal(reads, 8); equal(getHashCount(), 8); equal(delivered, 1, 'A failing final callback cannot be delivered as success');
  await flush(); equal(delivered, 1, 'The same failed final round must not retry after recovery');
  observer.observe(root, snapshots); await flush();
  equal(reads, 12); equal(getHashCount(), 12); equal(delivered, 2);
  console.log('PASS final failure ends its round; a subsequent normal round succeeds');
  for (const vector of vectors) {
    const text = canonical(vector.envelope); equal(text, vector.canonical_utf8);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    const sha = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
    equal(sha, vector.sha256);
  }
  console.log('PASS actual helper canonical/hash matches eight literal contract vectors');
  console.log(JSON.stringify({ scope: 'actual-helper VM unit only; no React render/DOM/browser/Host', calls, reads, hashes: getHashCount(), delivered }));
})()`, context).catch(error => { console.error(error); process.exitCode = 1; });
