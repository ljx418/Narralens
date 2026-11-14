# N1N2 corrected prewrite ACK — resumed Claude child

Child: task_5dcbe8192764 / dispatch ctx_e5e736e1846b / terminal term_b4006907-19df-46dd-ae99-34909d8de5e6
cwd of every source/test tool: /mnt/c/workspace/videoworkline/Narralens-agents/main-integration (WSL)
branch: agent-driven/main-a-integration — HEAD/base: e2eff61b464d75d36598103d718cd2a75db5dfda — git index clean
Recorded: 2026-11-12, after MAIN's conditional GO (msg_db83066df5e9) and PRODUCT's read-only review (msg_d3d0d5b4920f).

This record adopts the three mandatory constraints in full, before the first source edit.

## 0. State re-verified immediately before this record

| path | sha256 | state |
|---|---|---|
| src/host/agent-driven/committed-snapshot-authority.ts | c11dc60c20e49d7a4a9293eb5b501508bed5eeffd6468d008715db2a50e3ef76 | preserved partial, unchanged |
| src/host/agent-driven/created-native-workspace.ts | f4dcd1c4518e63c1835bd768ca941e2b764b588660332b4bc4a54c7b13124f73 | preserved partial, unchanged |
| src/host/m5/openfilm-native-expected.ts | 19110e45a83b6d5b611b4260620ce873f923f1e5a5b907bc6176c4b734fbeed3 | preserved partial, unchanged |
| src/host/agent-driven/retained-native-closure.ts | d3c9b58eaffd6b63240a86f743275c2157c93430e6c5bee61eb26090b57a3bf0 | preserved partial, unchanged |
| tests/agent-driven/integration/created-native-workspace.test.ts | 439d469032c9af2b83ceb826e0aead7cf5c2fe5c5693be7cbf18c8e67f0f615f | unchanged |
| tests/agent-driven/integration/committed-snapshot-host.test.ts | bfd0c6373b254050d32a6a99e7b6f8b9827dc24b6b2587515ab4c5aad2cd9037 | unchanged |
| tests/agent-driven/integration/created-native-ack.test.ts | 439677f921b14e70e4f3553747d8e683ef4490e0595854df4f8d8ccc71959e19 | preserved partial, unchanged |
| src/host/agent-driven/created-native-source-reader.ts | — | ABSENT, to implement |
| tests/agent-driven/integration/created-native-source-reader.test.ts | — | ABSENT, to implement |
| tests/agent-driven/integration/helpers/native-source-fixture.ts | — | ABSENT, to implement |
| AGENTS.md (protected) | 37300463a72a612ae16e0a5fcfb496502c57c722b83781e0e2e8c9480594542b | untouched |

`git diff --cached` is empty. No add/commit/reset/stash/checkout/cherry-pick/push by this child.

Baseline compile evidence already captured (read-only, before the first ACK): `n1n2-claude-resume-001-tsc-baseline`, argv `corepack pnpm exec tsc --noEmit`, cwd main-integration, actual exit **2**, two errors, both in the already-dirty `created-native-ack.test.ts`: `Cannot find name 'ProjectSettings'`, `Cannot find name 'Marker'`. The three errors from capture 006 are absent from the current bytes. 004-tsc0 is not cited as a pass.

## 1. Mandatory constraint (1) — the media probe is file-internal, and no caller supplies facts

Adopted in full. The earlier proposal of an injected `NativeMediaProbe` that returns `{duration,audio,fps}` is **withdrawn**.

* The probe is a module-private function inside `src/host/agent-driven/created-native-source-reader.ts`. It is not exported, not a dependency of the reader's constructor, and there is no seam through which a caller, a test or a dependency can state a duration, an audio flag, an fps, a width or a height.
* The reader's constructor takes only `{authority, workspaces, library}`:
  - `authority: CommittedSnapshotAuthority` — the committed producer/rights/consumer-graph authority,
  - `workspaces: CreatedNativeWorkspaceService` — the issued-view registry,
  - `library: NativeExpectedLibrary` — the **approved 015** module, used only for `computeExpectedProjection`, `parseProjectSettings`, `parseMarkers`, `hydrationCanonicalJson`. It is the same approved module the Expected service uses; no direct import of `tools/`, no second parser, no fallback, no pin change.
* The tool is the **fixed local ffprobe** of this host, spawned by the reader itself. No download, no install, no provider, no CLI-config read, no network, no shell. The argv profile is exactly the upstream `derived.probe` profile:
  `ffprobe -v error -print_format json -show_format -show_streams <heldFdPath>`
  where `<heldFdPath>` is `/proc/<parentPid>/fd/<fd>` produced by the retained closure of the **same** lease that holds the media. It is never `/proc/self/fd`, never a plain path, never a path a caller can supply, and never a swappable pathname. The Host's own global media-tool policy (`installMediaProcessPolicy`, `localMediaArgs`) remains in force and is not modified.
* Limits and ownership, all inside the reader: at most **2 concurrent probes per round**, **30 s** per probe, **stdout ≤ 4 MiB**, **stderr ≤ 256 KiB**. Exceeding any limit is a refusal with a failure meaning; it is never a truncated success and never a silent downgrade.
* The child's **real exit** is awaited (`close` event, not `exit`) before any descriptor is released. On timeout or cancellation the reader kills its own child, reaps it, and only then releases the input descriptor. A child that cannot be proven exited leaves the outcome UNKNOWN — the reader does not claim the descriptor was released.
* Normalisation is the upstream rule set, computed **inside** the reader, keeping the **full** normalised fact set — not a reduced duration/audio/fps interface:
  - `duration` = `Number(format.duration)`, kept only when finite, `> 0`, and the format name does not match `/image|png|mjpeg/`;
  - `video` = the **first** stream with `codec_type === 'video'`; `audio` = any stream with `codec_type === 'audio'`;
  - `fps` = `Math.round((n/d)*100)/100` from the first video stream's `avg_frame_rate` (`'0/1'` when absent);
  - `turn` = the first `side_data_list[].rotation`, else `tags.rotate`, else `0`; `quarter = Math.abs(Math.round(turn/90)) % 2 === 1`; when quarter, the shown size is `{width: video.height, height: video.width}`, otherwise `{width: video.width, height: video.height}`;
  - `codec` = the first video stream's `codec_name`, `pixfmt` = its `pix_fmt`.
  The 015 projection consumes `duration_ms`/`has_audio`/`fps`; the reader keeps width, height, codec and pixfmt in its own probe record and in the probe evidence digest.
* `duration_ms` follows the pinned `factsOfProbe` rule exactly: `Math.round(duration * 1000)` on the normalised duration, never a second rounding and never a value taken from subtitles, trim length or metadata.
* **Probe evidence provenance**: every probe produces a `proof_digest` = SHA-256 over a canonical record binding (a) the tool version (`ffprobe -version` first line), (b) the argv profile, (c) the probed input's `sha256` and byte count, (d) the ledger identity (the retained file's relative path, device and inode, and the closure's identity), and (e) the complete normalised result. The proof digest is what the 015 input carries as `proof_digest`; the raw tool output is never exposed as a trusted fact on its own.
* A probe cache is **not** authority: `.film/cache/probe/*` is never read as a fact source. The reader always probes the retained bytes itself. A cache file that appears or changes is handled as an unknown workspace item under constraint (4) of the design (fail closed), never as a substitute probe.

## 2. Mandatory constraint (2) — ownership transfer keeps both closures and their dependencies alive

Adopted in full.

* Two **independent** retained closures are held for the whole read: the committed **source** tree (through the authority lease) and the **workspace working copy** (through the workspace lease). They are never deduplicated by relative path; the same relative path in the two trees is two distinct resource objects with two distinct descriptors.
* On success the reader transfers **both** closures to Expected together with the per-file retained handles. The transfer carries the directory dependencies (retained directory listings) and the negative dependencies (proved absences and their nearest existing parent) as well; they are released **only after the last leaf handle has been released**.
* The reader does **not** release the authority lease or the workspace lease early, and `reader.close()` does **not** close delivered resources. `reader.close()` stops admission and drains in-flight work only.
* Implementation shape: each retained handle owns exactly one descriptor. Its `close()` releases that descriptor once (never a numeric fd retried) and decrements the closure's outstanding-leaf count. When the last leaf of a closure is released, that closure releases its directory descriptors, its negative-lookup parent descriptors, its parent chain and its root descriptor — all-attempt, with a sticky uncertainty latch on any failure. The authority lease and the workspace lease are released by the same owner-release step, after every returned resource has been released.
* Before delivery, **every** failure path (throw, abort, late resolution) releases both closures, all handles, all directory and negative dependencies and the leases itself, all-attempt, preserving the primary error and attaching every cleanup error in a non-enumerable `cleanup_errors` field. A cleanup failure latches the reader as uncertain and refuses any later proof.
* Cancellation and late results: in-flight probe children are terminated and **reaped before** any descriptor is closed. A child that cannot be proven exited leaves the release state UNKNOWN; the reader never reports a released descriptor it cannot prove.

## 3. Mandatory constraint (3) — scope, contract and evidence

Adopted in full.

* Exactly ten paths and nothing else: the seven above plus the three absent ones. No other source, test, helper, contract, DDL, migration, configuration, pin, package script or lock file is touched. No index mutation of any kind.
* The public `NativeExpectedSourcePort` shape, the `NativeExpectedBinding`, `NativeExpectedSourceFacts`, `NativeExpectedRetainedFile` and the whole `OpenFilmNativeExpected` lifecycle body stay byte-identical; the existing 84 assertions in `created-native-ack.test.ts` stay intact. The only change to that file is the two missing **type-only imports** (`ProjectSettings`, `Marker`) needed by the loader change that is already in the preserved partial.
* The loader change (exposing `parseProjectSettings` / `parseMarkers` from the same approved 015 module, refusing `NATIVE_EXPECTED_BUILD_UNSUPPORTED` when the export is missing, with no fallback) is kept exactly as the preserved partial has it. The approved artifact already exports both functions (`expected-projection.d.ts` lines 79–80 of the approved build); no rebuild, no pin change.
* All new evidence uses the `n1n2-claude-resume-*` prefix, through the existing immutable `run-recorded.py` (not modified), with full argv, cwd, input hashes, actual exit and complete stdout/stderr. The preserved 001–006 captures stay untouched.
* Validation authorisation in force is **tsc only**, serial, through that runner. No test command is authorised yet: each proposed file/case set will be submitted for classification with exact selected test names, argv, cwd, fixture and resource effects and frozen inputs **before** any DB/Host/ffprobe/ffmpeg/media execution. A mixed file is never invoked wholesale as "pure".
* No DDL, no Observation/Ack/Context change, no public wiring, no provider, no network, no J drive, no paid action, no build, no browser, no package or lock change, no full-suite run, no old Gate write.
* Any **new** 429: immediate STOP, preserve source, logs, child identities and descriptor state, report, no automatic retry, no provider or credential switch, no Codex/MAIN takeover.

## 4. Proposed private surface after the correction

`src/host/agent-driven/retained-native-closure.ts` (extend the preserved file):
`RetainedNativeBudget`, `RetainedNativeError`, `RetainedNativeFile{relative_path,bytes,mtime_ms,sha256,dev,ino}`, `RetainedNativeDirectory{relative_path,names}`, `RetainedNativeAbsent{relative_path,nearest_existing_parent}`; `class RetainedNativeClosure { static open(root,budget?) ; root ; closed ; uncertain ; membership() ; directories() ; files() ; retainedDirectories() ; negatives() ; retainFile(p) [idempotent per path] ; retainDirectory(p) ; retainAbsent(p) ; readText(file) ; hashFile(file) ; verifyFile(file):boolean [sync, dev/ino/size + rehash from the held descriptor] ; releaseFile(file):void [closes that descriptor once, never retried, latches uncertainty] ; probePath(file):string [-> /proc/<parentPid>/fd/<fd>] ; verify():boolean [synchronous whole-closure guard] ; close():void [all-attempt, sticky] }`

`src/host/agent-driven/committed-snapshot-authority.ts`: `VerifiedNativeFacts`, `VerifiedNativeFactsLease{facts,closure,assertCurrent(),release(),released}`, `isVerifiedNativeFactsLease`, `acquireNativeFacts(projectId,transactionId,principalId)`. The preserved re-digest stays byte-equivalent to `computeSourceDigest`; the one divergence I found (`avif` present in the partial's asset-extension set, absent from the pinned `source-digest-v1.ts`) is corrected so the recomputed digest equals the committed `source_digest`.

`src/host/agent-driven/created-native-workspace.ts`: `NativeWorkspaceBinding`, `NativeWorkspaceExpectation`, `NativeWorkspaceLease`, `registerWorkspaceRef`, `acquireExpectedLease`, `isNativeWorkspaceLease` — kept as the preserved partial has them.

`src/host/agent-driven/created-native-source-reader.ts` (new):
`export interface CreatedNativeSourceReaderDeps { authority: CommittedSnapshotAuthority ; workspaces: CreatedNativeWorkspaceService ; library: NativeExpectedLibrary }`
`export class CreatedNativeSourceReader implements NativeExpectedSourcePort { constructor(deps) ; readSource(input:{binding:NativeExpectedBinding}):Promise<NativeExpectedSourceFacts> ; close():Promise<void> }`
plus module-private: the fixed-ffprobe runner, the upstream normalisation, the probe evidence digest, the dependency ledger reconciliation, and the native listing (numeric `localeCompare`, video-only, `assets/`-scoped, hidden names skipped) — no exported probe seam of any kind.

`tests/agent-driven/integration/helpers/native-source-fixture.ts` (new): real fixture producers — the real HTTP bootstrap, a real registered local asset, the real SOURCE_ONLY draft producer and the real controlled adoption that commits the rich source, then the real `CreatedNativeWorkspaceService.prepare`. No hand-written snapshot, no fabricated digest.

`tests/agent-driven/integration/created-native-source-reader.test.ts` (new): the R01–R07 cases.

## 5. R01–R07 case plan (each a named case; internal evidence only)

* **R01** real bootstrap + real SOURCE_ONLY producer + real controlled adoption → committed rich source; two independent descriptor trees; digests, rights, producer graph and clip ids consistent; the reader proves; the legacy unknown project is still refused.
* **R02** same bytes with a new inode, parent directory moved and recreated, symlink, same-size write with the mtime restored; the change is injected before the proof and before `assertCurrent`/the cached Context read; every case is refused, no Ack row is written, no descriptor leaks.
* **R03** added/removed style, settings, markers, media-side `.vtt` and a language translation, a missing directory that appears (including an empty one), a listing order or membership change; every negative and directory dependency fails; nothing passes because it was absent from the old manifest.
* **R04** `.film/id` mismatch, unknown metadata, a forged probe cache with the same key, a legitimate late cache, an atomic `.tmp` present; unknown is refused; a legitimate derivation invalidates the old proof and a later stable round proves it; the probe cache is never used as a fact source.
* **R05** real ffprobe on the held parent-PID descriptor, field by field against the upstream `derived.probe` normalisation and the pinned `factsOfProbe` rule; subtitle/trim length never substitutes for a real duration; the source or the parent directory is moved during the probe; a slow/hung/abrupt child; cancellation — the descriptor is released only after the real exit. Diagnostic media only, explicitly not A-film evidence.
* **R06** the five pinned `native_rev` vectors (including Chinese, emoji, CRLF and BOM); numeric `localeCompare` ordering with `video2`/`video10`/non-ASCII names; the caption directory's own readdir order kept separately; the Node/ICU/locale evidence recorded.
* **R07** the n-th open fails; ENOMEM/EMFILE/EIO/EACCES; text, descriptor and output budgets; a constructor or verify throw; the first close fails and a close re-enters; the primary error and every cleanup error are preserved; the sticky latch refuses a new proof; every remaining resource is attempted; a raw descriptor number is never retried.

No case is claimed as passed until it is actually run with its actual exit recorded. Cases that need a DB/Host/ffprobe/ffmpeg/media run are submitted for classification first.

## 6. Observed defects in the preserved partial — adopted for repair inside the ten paths

PRODUCT's read-only review (msg_4d6757108f7b) found six concrete defects in the preserved partial. All six are observed defects of the preserved candidate, not new scope; all six are repaired inside the same ten paths and each gets a matching R case.

1. **Directory membership vs. manifest count.** `acquireNativeFacts` compared `closure.membership()` — which includes directories — against the manifest's file count, so any normal nested directory (for example `assets/`) was rejected. Repair: the file membership of the tree is compared with the manifest's file set, and directories are kept as **separate evidence** (retained directory listings and their real readdir order, including empty directories), not silently folded into the file count.
2. **Text budget was checked after the whole file was read, and the BOM was stripped.** `readText` read the entire file into memory before testing the 8 MiB / 64 MiB budgets, and `TextDecoder` without `ignoreBOM` removes the UTF-8 BOM, which would change the film's own revision. Repair: the size is checked from the descriptor **before** the read and enforced **during** it, with growth beyond the recorded size refused (a file that grows while it is read is not the file that was taken); the decoder is `fatal:true, ignoreBOM:true`, and the re-encode equality check stays, so the BOM is preserved byte-exactly — required by the pinned `native_rev` vector `﻿<html>标题</html>` → `3f847bbde4e77a30`.
3. **Two owners for one descriptor, and swallowed cleanup failures.** `closeSync(record.handle.fd)` closed a raw descriptor that a `FileHandle` still owned, so a later finaliser could close a reused descriptor number; and `#closeAll` plus the `catch(close => undefined)` paths dropped cleanup failures. Repair: **one** owner per descriptor — raw descriptors owned by the closure itself, with no second owner and no numeric descriptor ever retried — and every release is all-attempt, preserving the primary error and attaching every cleanup error, with the sticky uncertainty latch set on any failure (constructor, enumeration, per-file release and whole-closure release alike).
4. **Closing with work still in flight.** `close()` marked the closure uncertain but still closed descriptors that an accepted operation could still be using. Repair: the closure refuses to release while an accepted operation is outstanding; the owner drains first and only then releases. The reader terminates and reaps its probe children before any descriptor is closed.
5. **The root's own ancestry was not retained.** Above the root the chain was only a path `lstat`, so moving the same root inode under a replaced parent was not detected. Repair: the ancestor chain of the root is retained (bounded, anchored by held descriptors) and every ancestor's identity is re-verified by the synchronous closure guard.
6. **Wrong open flags and a duplicated file.** `retainDirectory` opened its final component with the file flags instead of `O_DIRECTORY`, and `retainFile` was not idempotent, so `film.html` was opened twice. Repair: directories are opened with `O_DIRECTORY`, and `retainFile` is idempotent per relative path and returns the same retained object.

Matching R cases: R01 (nested asset directories are accepted and proved), R02 (BOM-exact `native_rev`, ancestor replacement, duplicated-open accounting), R03 (empty and newly appearing directories), R04 (unknown items), R06 (BOM vector), R07 (budget-before-read, growth during read, cleanup failure preservation, drain-before-release).

## 7. Request

Corrected ACK recorded and adopted. Proceeding with the implementation under the conditional GO: exact ten paths, tsc-only validation until further exact test authorisation, no index mutation, no heavy slot, and the supervisor's read-only supervision.
