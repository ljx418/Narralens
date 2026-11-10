# Fixed native pure expected-projection helper candidate

Writer PRODUCT Codex. Starting Narralens HEAD37ed5c7800d7e32818cdc75dfa8b915467d11a48; fixed upstream e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3. **Source/static preparation only: no Node import/test, tsc, Vite/library build, Host, browser, ffmpeg, install, provider or network executed.** MAIN16548 held the actual-check slot. 013/H-R1 source and artifacts remain untouched; this candidate lives in independent `var/managed-native-expected/source` plus docs015.

## Files / intended use

- `candidate/native-pure.entry.ts` selects original pure exports; `native-source-closure.json` records23 exact source/package/lock/license file hashes and static runtime import graph, including two managed013 canonical/host source inputs. Fixed code is copied verbatim from Git objects (or exact013 source bytes), not from another timeline implementation.
- `candidate/expected-projection.mjs` supplies only Host-only supported-domain checks and original ProjectView/useEditorTools projection glue around those functions. `candidate/expected-projection.d.ts` is standalone input/output typing. `CONTRACT.md` defines exact supported facts/origins/canonical output semantics.
- `candidate/vite.expected.config.mjs` and `build-expected.mjs` are **unexecuted** controlled offline library build entries. They use the existing pinned private native Vite7.3.7 toolchain and React19.3 resolution, not MAIN dependencies; configLoader=native avoids a config bundle cache in unrelated node_modules. Selected exports must tree-shake all unused native services/React hooks/transport/clock. The builder rejects non-pure residue before copying the Node wrapper/types/license and producing an output manifest.
- `literal-vectors.json` contains7 literal positives and8 literal refusals: initial empty, controlled concept page with no registry/rights record, page/video/audio, two actual temporal overlap rows, marker trim/speed/end behavior, empty project with listed video fps, Host-attested matching spans; missing refs/fps/source hash/unsupported transient/profile/UI-observed inputs refuse. `generate-literal-vectors.py` only constructs these literals and canonical hash strings. The source/native math was not executed to produce expected values. `check-literal-vectors.mjs` is a future pure-module runner, currently NOT_RUN. Fixture label hashes are not real file/media/rights/probe facts.

The future built `dist/expected-projection.mjs` imports only node:crypto and its adjacent generated `native-pure-library.mjs`; no TS runtime/React package/Host process should be needed to import it. That generated file **does not exist yet**. Source wrapper import cannot be claimed working until admitted build/purity/import/vector checks actually succeed. Production packaging/pinning/Host expected-fact construction belongs to MAIN.

## Model boundary

Input origin tags, artifact/asset references and digest strings are only the structural input model. The helper cannot authenticate them. MAIN builds inputs independently from exact snapshot/workspace and fixed parser/probe/controlled producer facts, verifies actual rights and provenance/currentness, and must never relabel UI observed rows/hashes/spans as independent expected input. Non-page assets use actual AssetRegistry+rights records. Controlled concept pages use actual source file SHA + immutable source/script artifact + real controlled writer receipt, not fictional AssetRegistry rows/rights IDs; known no-applicable-media summaries may be null. This preserves a real empty/concept-only path without assigning fake rights.

`ui_profile` explicitly excludes pending drops, preview error, live height and browser preferences from a committed-baseline calculation. It does not certify their absence in a native view. Active/unknown/observed override inputs are unsupported; MAIN separately requires clean real hydration state and matches values/hashes. Output `computed` is **expected math only**, never NativeAck/loaded/current/rights permission or decoded/media/ASR/subtitle-burn/QC evidence. Source shape remains exactly013 for settings/markers envelopes; style/captions are not calculated here.

## Proposed commands — NOT_RUN

After MAIN grants resources, run from the actual private tree, with NODE_PATH unset:

`node var/managed-native-expected/source/managed-expected/build-expected.mjs`

Then only under the granted scope:

`node docs/parallel/lane-product/requests/015-native-expected-projection/check-literal-vectors.mjs var/managed-native-expected/dist/expected-projection.mjs`

Record actual commands/cwd/tool/runtime/input hashes/PID/exit/logs. Missing dependencies must be reported, not installed/upgraded/downloaded. A failing hand-prepared literal requires preserving the first failure and checking original native semantics; no weakened safety test or made-up producer receipt. Real same-source UI comparison/Host currentness and independent review follow later, not inferred from pure-vector results. No new manual module gate, no self-signed A05/human PASS.

Rollback deletes/disables only this unassembled expected helper candidate; it does not modify013 runtime files, source, saved projects or immutable snapshots.
