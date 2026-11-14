/**
 * The real approved 015 loader, exercised against the bytes MAIN provisioned.
 *
 * This is a *pure* filesystem check: it reads the tracked inputs, the approved build
 * manifest and the approved modules, and lets the real loader load them. It proves the
 * approval chain and the module exposure — not a native load, not an acknowledgement.
 */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {
  nativeExpectedApprovalFromPin,
  nativeExpectedInputsDigest,
  nativeExpectedLibraryLoader,
  nativeExpectedDistRoot,
  nativeExpectedInputsRoot,
} from '../../../../../src/host/m5/openfilm-native-expected.js';

const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

async function main(): Promise<void> {
  const approved = nativeExpectedApprovalFromPin();
  const inputs = await nativeExpectedInputsDigest();
  const distRoot = nativeExpectedDistRoot();
  const inputsRoot = nativeExpectedInputsRoot();
  const manifest = readFileSync(resolve(distRoot, 'build-manifest.json'));
  const modules = Object.fromEntries(Object.entries(approved.modules).map(([name, digest]) => {
    const bytes = readFileSync(resolve(distRoot, name));
    return [name, { approved: digest, observed: sha(bytes), match: sha(bytes) === digest }];
  }));
  const report = {
    cwd: process.cwd(),
    dist_root: distRoot,
    inputs_root: inputsRoot,
    upstream_sha: approved.upstream_sha,
    approved_inputs_sha256: approved.inputs_sha256,
    observed_inputs_sha256: inputs,
    inputs_match: inputs === approved.inputs_sha256,
    approved_build_sha256: approved.build_sha256,
    observed_build_sha256: sha(manifest),
    build_match: sha(manifest) === approved.build_sha256,
    modules,
  };
  const library = await nativeExpectedLibraryLoader().load(approved);
  const loaded = {
    expected_profile: library.EXPECTED_PROFILE,
    upstream_sha: library.upstream_sha,
    compute_expected_projection: typeof library.computeExpectedProjection,
    hydration_canonical_json: typeof library.hydrationCanonicalJson,
    parse_project_settings: typeof library.parseProjectSettings,
    parse_markers: typeof library.parseMarkers,
    parse_project_settings_sample: library.parseProjectSettings({fps: 30, trackNames: [{name: 'a', index: 0, clips: []}]}),
    parse_markers_sample: library.parseMarkers([{id: 'm1', t: 1.23456, color: 'green'}]),
  };
  process.stdout.write(JSON.stringify({report, loaded}, null, 2) + '\n');
}

await main();
