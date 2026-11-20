# Independent bounded media/recovery review

**Outcome: NOT_PASS (scoped media preview/reader). BLOCKER: 0; MAJOR: 2; MINOR: 2.** The purpose-separated proof changes and the reviewed SQLite authority extraction have no identified blocking/major defect; preview filesystem publication and reader consistency require correction before a scoped combined PASS. This is not a full A audit or an application acceptance signature.

Frozen commit: `05889e7f10e94538b0aff9ef121d3a120e52a985`.
Parent/recovery change: `6402ae78179a48dfad5ab1c1ebfe54488ae9ce2d`.
Before-root base: `cca95020ee4ede16ef133ecd6e08b6a27632adaa`.
MEDIA comparison: `c8a06729c2a58d0e79c40042f3155c558ca6fd11`.
Reviewer task: `task_b340f9c5b5ef`; dispatch: `ctx_3a63c94997c9`; date: 2026-11-11.

Method: read-only Git-object review, source comparison, assertion tracing and SHA256/JSON checks. I did not author these changes. No test/build/Host/browser/ffmpeg process was run, no credentials/config were read, and no helper was started. Only this canonical report was written. Findings below are precise source-derived counterexamples with deterministic test recipes, **not claimed executed reproductions**. The separately dirty architecture test and untracked evidence/report material were excluded; conclusions bind Git objects, not those working-tree changes.

## MAJOR M1 — object-domain replacement can redirect preview writes into protected source

Location: `src/host/render/preview-prepared-source.ts:376`–378; initial checks at 403–411 and final source check at 474.

Trigger: start a valid preview with separate private workspace/object/author roots. After the initial object-root checks, while the renderer/probes are awaited, rename the object directory to a held sibling and replace its old name with a symlink to the author source directory. Keep the prepared source, author bytes and registry facts otherwise unchanged. The final proof checks prepared/author/rights facts, not the identity of the configured object directory. `#publish` then resolves the original object-root string and opens `objectRoot/obj_<uuid>` with O_NOFOLLOW only on the final leaf. The intermediate directory symlink is followed, so the actual new product file is created in the author tree. No leaf existed, so O_EXCL does not prevent this.

Impact: the preview producer can write five object files into a protected domain despite its source-only/isolation contract. Later reader rejection does not undo those writes. This counterexample requires filesystem mutation by a concurrent same-UID actor/fault, not a remotely supplied path; that is the directory-substitution boundary the existing anchoring/no-symlink checks purport to protect.

Narrow fix/test: retain a verified object-directory FD and identity across the operation; create outputs through that FD, validate the named domain before exposure, and never clean up through a substituted path. Add a controlled boundary test that swaps the object-root name after admission (e.g. during a paused render), checks rejection/no receipt and proves the protected author tree receives no object files. Merely adding another path-only check immediately before open leaves the same check/open race.

## MAJOR M2 — reader can return changed bytes under the original verified digest

Location: `src/host/render/preview-prepared-source.ts:323`–329; related open hashing at 304–309.

Trigger: obtain a legitimate reader handle. In a deterministic filesystem wrapper, pause its positional `owned.read` after both pre-read fingerprint calls have completed. Rewrite the same inode with different bytes of the same length, then allow the real read to proceed. The read returns the requested length; the code immediately returns those bytes without a post-read fstat/path check. The handle still advertises the original SHA256. A single-chunk response can therefore be delivered completely; there is no next read to discover the drift. No hash collision or forged receipt is needed.

Impact: the controlled reader's verified-byte guarantee fails during an asynchronous read. A client doing its own final hash may detect corruption, but that is not the reader contract and cannot make already exposed bytes verified. The source proof verifier already uses before/after fingerprint checks; this new reader does not.

Narrow fix/test: after the entire read loop, check held and named identity/fingerprint again before returning bytes (and check cancellation/closed state). Also verify stability at the end of initial hashing before returning a handle. Add a barrier test performing a same-size overwrite specifically between precheck and read completion; expect rejection, no returned altered chunk and exactly-once close. Existing tests mutate before a later open and do not cover this interleaving.

## MINOR m1 — isolated copy discards short writes

Location: `src/host/render/preview-prepared-source.ts:251`–254.

Trigger: make one target FileHandle.write successfully write only a positive prefix of the supplied buffer and return its actual smaller bytesWritten, as the write API permits. The loop ignores bytesWritten, advances the source to its next chunk, and hashes/counts only the source. The final source hash/size checks still pass while the isolated target is truncated or missing bytes.

Impact: a verified source can yield an incomplete copy, causing avoidable render failure or a copied HTML/style variant that remains renderable but is not byte-identical. The retained happy-path product does not exercise partial writes.

Narrow fix/test: loop until the entire bytesRead segment has been written, rejecting zero progress; verify the copied output against the fact before rendering. A targeted short-write injection should prove every byte is copied exactly or the preview is refused, without changing the renderer guard.

## MINOR m2 — cancellation/close during final publication still resolves a receipt

Location: `src/host/render/preview-prepared-source.ts:476`–495; close at 502.

Trigger: pause the fifth publication's writeFile/sync operation after the pre-publish checks. Abort request.signal (or call service.close), then release the I/O. There is no check after `await #publish` or before the receipt return, so preview resolves successfully although it was cancelled/closed before completion. Current source/rights are likewise checked only before the sequence of asynchronous publications.

Impact: the producer reports completion after cancellation and may return a receipt whose current-author/rights check predates the last publication. This does not itself commit/adopt the project, so it is classified below the isolation/integrity majors.

Narrow fix/test: recheck signal/closed/current proof at the final exposure boundary after all product writes and before returning a receipt. Clean or explicitly retain only owned unpublished objects on refusal. Add a final-write barrier case; the existing pre-aborted-signal case does not test this timing.

## What the code and assertions do establish

- Completed-source proof records have distinct lease/read/adoption purposes, complete binding digests, task/fact digests, producer attempt and root identity. Read cannot pass adoption or vice versa; JSON copies cannot reproduce WeakMap proof membership. The author source digest is bound to task.request.source_digest; the prepared digest is the separate fact/provider digest. Exact producer execution equality is checked, rather than treating a lease retry as a new workflow attempt.
- Completed-source input is expressly Host-only and assembled by BRIDGE from authoritative rows. MEDIA checks consistency and live filesystem facts but is not a second Job/approval authority. Current author/rights callbacks must be synchronous and run around final FD checks. Tests' no-op/current-row callbacks and invented adoption IDs exercise the proof seam, not production authorization.
- Proof FD ownership is explicit: retained descriptors, immutable binding copies, release and close/pending disposal. Same-size prepared-source tampering, proof-purpose substitution, wrong base/source/execution/job/root/producer attempt, async callbacks, thrown authority callbacks and released proof reuse are negatively asserted in the processor suite. Running-task source-only/lease behavior remains intact.
- The shared fixture now starts the actual processor/worker, waits for persisted Job success, and reads terminal reason/provider receipt/prepared fact/producer attempt from the real store. It registers real synthetic video/tone media. Fixture capability eligibility and TestAdoptionAuthority remain explicitly synthetic ports. There is no second production metadata writer introduced by the fixture repair.
- The preview uses an isolated copy and the real pinned renderer/probes. The repaired staging_root is the common owned workspace containing project and render, which satisfies the original containment rule. `native-renderer.ts` is byte-identical to the before-root base: the producer was corrected, not the guard relaxed. Timestamp step uses den/num, so 30 fps is checked as 1/30 second. Frame count, timestamp cadence, video decode and separate narration sample-count checks are real operations in recorded runs.
- SQLite helpers keep writes in RevisionStore and preserve precise observed Job predicates. Requeue compares running state, owner (including NULL), attempt, exact expiry and expired time; orphan cancellation requires cancel_requested, NULL owner, exact attempt/expiry and no live expiry. They add no transaction/database of their own. ProjectCreationStore invokes them inside its original product transaction with journal/bootstrap/event/outbox settlement. Its bootstrap helper accepts only the narrow legal transitions; ledger activation now uses the existing transition owner inside the existing atomic seed.
- I traced all eight new SQLite cases: four changed/live lease predicates, exact once-only requeue with unrelated Job preservation, NULL-owner cancellation mismatches/once-only completion, rejection of owned cancellation, and rollback with the caller transaction. Existing creation commit boundary rollback/stale owner/attempt/expiry tests and ledger atomic-seed failures provide relevant regression assertions. No global architecture PASS is inferred. BRIDGE's task-store NULL-owner inline Job writer remains the explicitly pending consumer, outside this change.

## Evidence validation and limits

I read committed MAIN_REPAIR/diagnosis, run command/result/log files, typecheck and cleanup records, manifests, retained receipt, quality object and recorded probe. I recomputed hashes from frozen Git blobs, not from untracked runtime output.

- Prior MEDIA c8a06729 failure (processor 7 pass, preview 4 fixture failures) is preserved as historical diagnosis in this package; I did not reinterpret it as preview success or independently rerun it.
- MAIN run1 actually records 7 processor pass + 2 negative-preview pass + 2 preview failures at PROJECT_ROOT_OUTSIDE_STAGING; exit 1 is retained. Its log matches `ea66c2afd0ec1576c2a143e01070eddec0f735d1e8d825ff8e10cc5a51c2fb55`.
- MAIN run2 records 4/4 preview pass after the producer-root repair, log `b8fdf76bf962d272c53a783b3603081c55a8d6cf9923b77a42aade82e22e497b`.
- The final test adds retained-artifact assertions; run3 records 1 positive pass / 3 skipped against that final test hash, log `0fcddad3345ab91c1ffd48a748a1a269bf002ca611952a76f8fc1e5bb6b7b03f`. This is not another full four-test run. The source production hash is unchanged from run2.
- SQLite regression records 36 creation + 30 ledger + 13 atomic-ledger + 8 CAS = 87 passing cases in four files, log `3291ca5e1a21180f3716fa6cafe3892ab490598723483f4107ebad25fe0863df`. All four log digests above were independently matched. tsc exit 0 is a recorded MAIN result, not a reviewer rerun; its standalone record does not bind all input hashes.
- All five actual committed products match manifest bytes/hash and receipt part bytes/hash. The receipt canonical content digest recomputes to `a8d11776bc399ff92473950f860f3b3fef0f186138489678b1e321b38eba1601`. Recorded ffprobe binds the exact preview hash and reports H264 30/1, AAC 48000 Hz stereo, duration 3.000000 seconds. Quality/receipt record 90 frames, 1/30-second steps and separate mono narration 144000 samples at 48000 Hz. I did not independently decode/play it. Rights explicitly mark generated diagnostic media and synthetic narration; this is not 60–180 seconds of human Chinese voice or A acceptance.
- Preview negative cases cover forged/wrong-purpose proof, changed binding/root, pre-aborted and pre-closed service, lexical protected-root overlap, mutated receipt/unknown object, changed object before open and content-type/media-kind mismatch even with recomputed receipt digest. They do not exercise M1/M2/m1/m2. FD cleanup assertions are scoped to fixture paths. The positive test records `active_commit_unchanged` but its callback checks commit equality; it does not independently hash the entire author tree after rendering. Prepared-tree equality is actually asserted.
- Cleanup records absence of named command/test PIDs only; no claim about unrelated OS services. The dirty architecture test is not audited or used to improve the result.

Disposition: correct the narrow preview/reader issues and run their causal negative regressions under MAIN's resource ownership; then request delta review of the repaired bytes. Existing proof-purpose and recovery evidence can be retained. No future R1/A functionality is demanded by these findings.

## Exact source/test SHA256 bindings

Paths below refer to frozen commit 05889e7; unchanged supporting files were inspected only at relevant call sites/assertions.

| Path | SHA256 |
|---|---|
| `src/host/agent-driven/prepared-draft-verifier.ts` | `f69770afba85137d0dfd7a33be6115093538a411c2a4308295b523a018bbe93f` |
| `src/host/render/assembly-ports.ts` | `5d216cb00662bb002ba44b18a4c15dced7c90e27d88d8c0162d81926d4ef1c67` |
| `src/host/render/preview-prepared-source.ts` | `d87a82cc1658fbe9aeb97047fa143b0c7e5a80d109c6568e0e95298be1e52db1` |
| `src/host/agent-driven/created-draft-processor.ts` | `bafb71ffdbf41aab2f2d7779bfa0f42e0127ccee661f7a3631b0427220c62de2` |
| `tests/agent-driven/integration/helpers/created-draft-fixture.ts` | `3e553993afcb4c9364227b86806fb64466e3ce595ed838433ee1cfcbb5b92ffb` |
| `tests/agent-driven/integration/created-draft-processor.test.ts` | `51da71f510271fa63e66c2b740ee9f680fa5f51b7c756b3afaf72ba2f9d304f0` |
| `tests/agent-driven/media/preview-prepared-source.test.ts` | `64c10883c3f25a7d49dd37ffb73971758c94fa233dc9e5ae539410d92c8e34d0` |
| `src/host/projects/revision-store.ts` | `95a2158d8bf69a680227a525090724d2e0721aba7bf08b9332a7f3dbfd4c8c0f` |
| `src/host/projects/project-creation-store.ts` | `2ca8d5cea9dc3148f90d46d44f419bc87c9466027641172daf725e61d6e05e8e` |
| `src/host/projects/migrated-asset-ledger.ts` | `67cf33e938ad98c3a995ae02759d6f1fd82e1110775a6da1c3e6710916e814f9` |
| `tests/agent-driven/integration/job-recovery-authority.test.ts` | `2140d19334d6b66381af99616349ad588f7438757e13fc98276e09d9725aae14` |
| `tests/agent-driven/integration/project-creation-store.test.ts` | `fdb25b7ca6f7d2edd10c7da9b326b0cf674c336115cedae4f92375c78106ffe1` |
| `tests/wave2/w2-asset-ledger.test.ts` | `5640a5085ed46ced807cf60a02d1a63dd566fd2b872647b0a4a49f306381b8ff` |
| `tests/wave2/w2-asset-03-atomic.test.ts` | `f1772457549c764effd1c5d5b8cc13dac1fe5afab2b96985272e2ea195d037cf` |
| `src/host/render/native-renderer.ts` | `591c30235a12df42a0234ad9bdf3bf09975864db818ca2b4ed2484a4ca8c829f` |

## Retained product hashes

| Product | Bytes | SHA256 |
|---|---:|---|
| `docs/parallel/lane-media/A-R1-20261111/evidence/prepared-preview-real-1794409475326/preview.mp4` | 84175 | `011bd960b4cc2d41b575af6e91a252ee6f96524e24a22f3a608603957378e1ec` |
| `docs/parallel/lane-media/A-R1-20261111/evidence/prepared-preview-real-1794409475326/narration.wav` | 288078 | `42c9992dbd4dcfbeaf52790767beb0febee1279ce37e2e46d5cb474bdd8e1a1d` |
| `docs/parallel/lane-media/A-R1-20261111/evidence/prepared-preview-real-1794409475326/subtitles.vtt` | 259 | `7589688eff6e9ca5ee39341deb23d149f5a6cccec1da8ac9299fbb07230b88d9` |
| `docs/parallel/lane-media/A-R1-20261111/evidence/prepared-preview-real-1794409475326/shot-summary.json` | 385 | `d7528b4e19720d8e1c599f7ade44df54bb53b9ec01e25033bb21d2d685753a69` |
| `docs/parallel/lane-media/A-R1-20261111/evidence/prepared-preview-real-1794409475326/rights-quality.json` | 1663 | `a6138990bd416c662dab43217dbdf31d695c5626f56c591c6a6a2157f22ab177` |

## Frozen evidence artifact hashes

| Path | SHA256 |
|---|---|
| `docs/execution/A/implementation-20261111/integration/media-main-rework3/ARTIFACT_MANIFEST.json` | `aff06a16eaf1136efddd515df08069cabfdcbdb4c0081279ef0178b0ca8ff785` |
| `docs/execution/A/implementation-20261111/integration/media-main-rework3/MAIN_REPAIR.md` | `657f0d2ecf6ffd8e086c51cc343a835479830553fc308a5ddb70d92114fd6017` |
| `docs/execution/A/implementation-20261111/integration/media-main-rework3/cleanup-observed.json` | `5089ca5b4576892cfcff35030e6bf8f3f5dd0c5340a9e3a7bda59c0e715e7c4a` |
| `docs/execution/A/implementation-20261111/integration/media-main-rework3/diagnosis.json` | `bd8f73249b2ff5f08163ac11ec12866620c145a5fb01a6d888f58e1c19b4548d` |
| `docs/execution/A/implementation-20261111/integration/media-main-rework3/retained-video-probe.json` | `74873774a5ca9548d181227615f1172d78f1e1fe52c76b2719fce19eda3d752f` |
| `docs/execution/A/implementation-20261111/integration/media-main-rework3/run1.cmd.json` | `7a12c56e4fe7a0de3dac7a591acef26ef80934f32e58d6c2c98cdd8d5816c82c` |
| `docs/execution/A/implementation-20261111/integration/media-main-rework3/run1.diagnosis.json` | `59df515af072cb3f7d077795f7de8a00bc0ec18fa6851eb3e09f811b4f22e45e` |
| `docs/execution/A/implementation-20261111/integration/media-main-rework3/run1.result.json` | `e6e33c167b947c81f9f35f7ac5568e75c1c9f633bc36dcd36ad7df1f83d750a7` |
| `docs/execution/A/implementation-20261111/integration/media-main-rework3/run1.txt` | `ea66c2afd0ec1576c2a143e01070eddec0f735d1e8d825ff8e10cc5a51c2fb55` |
| `docs/execution/A/implementation-20261111/integration/media-main-rework3/run2.cmd.json` | `843767e02e7f36a8cb7854f0b342a0db225bf0eae43f6ceb92416dafec9bc1e9` |
| `docs/execution/A/implementation-20261111/integration/media-main-rework3/run2.result.json` | `a04ae1837425330493d8ed81b6ec34a9fe83878262990db870fe2104568b173d` |
| `docs/execution/A/implementation-20261111/integration/media-main-rework3/run2.txt` | `b8fdf76bf962d272c53a783b3603081c55a8d6cf9923b77a42aade82e22e497b` |
| `docs/execution/A/implementation-20261111/integration/media-main-rework3/run3-artifacts.cmd.json` | `5450625bb13ba283867edd71a87103b3046d4ec10fddab670b80bd3942e1eb0b` |
| `docs/execution/A/implementation-20261111/integration/media-main-rework3/run3-artifacts.result.json` | `a7907098cf95da778fa4e33afde1065abf5ddb50e706e8550dce15060ae673fd` |
| `docs/execution/A/implementation-20261111/integration/media-main-rework3/run3-artifacts.txt` | `0fcddad3345ab91c1ffd48a748a1a269bf002ca611952a76f8fc1e5bb6b7b03f` |
| `docs/execution/A/implementation-20261111/integration/media-main-rework3/typecheck-result.json` | `e744a57d5a1626a5ccaae4300e9170f852891d603b02be4aebef398e357c9103` |

## Working-tree exclusion record

The review uses immutable Git objects. Observed status at report creation:

```text
?? docs/parallel/lane-media/A-R1-20261111/evidence/draft-processor-real-1794408971653/
```
