# N1N2 smoke 008 — diagnosis, cleanup receipt and the corrected retry request

Child: task_5dcbe8192764 / dispatch ctx_e5e736e1846b / terminal term_b4006907-19df-46dd-ae99-34909d8de5e6
cwd: `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration` — HEAD/base `e2eff61b464d75d36598103d718cd2a75db5dfda` — git index clean.

## 1. The capture, preserved exactly

`n1n2-claude-resume-008-smoke` — recorder exit **1**, log sha256 `136e6fe39d9418c8c2e8c41c922fde5264c9e1266bbbdb8e91fd653926c30314`, `source_changed: []`, `source_added: []` (no input drift). The capture is kept as it is; nothing was overwritten.

The result: **1 passed, 1 failed**.
- PASS — `R00 smoke commits a rich source with the native files and the media`: the real committed rich source really holds `film.html`, `.film/settings.json`, `.film/subtitles.json`, `rights.json`, `draft-plan.json`, `scenes/*.html`, `assets/video/*.mp4` and `assets/vo/*.wav`.
- FAIL — `R00 smoke reaches the reader from the real committed created source`: `expected 'unsupported' to be 'hydrated'` at the settings part.

The reader itself was **not** the failure: `prove()` resolved, `assertCurrent()` returned a projection, and every retained handle's `verify()` and the whole closure's `verifyClosure()` passed — so the retained descriptors, the byte identity of the source and of the working copy, the digests and the membership were all proved. The approved 015 module refused the **input** the reader assembled.

## 2. Cleanup receipt, before the slot is returned

- **Recorder**: pid 930430 — not present any more (`ps -p 930430` → no such process).
- **Test process**: pid 930809 — not present any more.
- **Owned media tools**: `ps -eo pid,ppid,etimes,args | grep -E "ffprobe|ffmpeg|vitest|narralens|openfilm"` → **empty**. No `ffprobe` and no `ffmpeg` child of the run survived; the reader kills and reaps every child it owns before it releases a descriptor.
- **Owned Host**: the fixture's `NarralensHost` was closed by the fixture's own `close()`; the loopback listeners now present belong to unrelated long-running services of this machine (pids 391, 739047, 739047/739066/739092, and the codex sessions), none of them from this run — the run's pids were 930430/930809.
- **Owned roots**: `ls -d /tmp/narralens-*` → **empty**. The fixture removed its own tmpdir (Host, SQLite database, snapshots, stage, derived, tasks, local assets, publication and native workspaces) on both the success and the failure path.
- **Owned descriptors**: the run's descriptors belonged to the exited test process; the fixture's `disposeAfterNative` removed the working copies, and the reader's failure path released every retained leaf, both closures and both leases.

The heavy slot `N1N2-RESUME-SMOKE-001` is therefore free of every resource this run owned.

## 3. The diagnosis: the actual defect in the reader

PRODUCT's read-only review (msg_2fd6d2987ef4) located it, and the source confirms it:

> the reader's `mediaFacts` were pushed **per clip**, with no dedup by `source_ref`.

The real producer uses **one registered video asset for two shots** (`s1` and `s2` both use the same asset), so the committed film has **two clips with the same `src`** (`shot-s1` and `shot-s2`, both `assets/video/001-<sha>.mp4`). The approved 015 module requires one media fact per source:

```js
demand(relativePath(fact.source_ref) && !facts.has(fact.source_ref) && …, 'UNPROVEN_FACTS');
```

A second fact for the same `source_ref` therefore fails `!facts.has(fact.source_ref)` → **UNPROVEN_FACTS** → the projection is `unsupported` → all four parts are `unsupported`. That is exactly the observed failure, and it is a defect of my reader, not of the approved artifact, the Expected lifecycle or the pin.

**The fix** (in `created-native-source-reader.ts` only):
- the media facts are now collected in a map keyed by `source_ref` and emitted **once per distinct source**; a second shot of the same media reuses that one fact.

**A second correction from the same review**, also applied in the same file:
- the placement of a clip is now the **producer's own fact** — the committed plan's frame range from the consumer graph (`start_frame`/`end_frame_exclusive` at the plan's fps) — and the film's own `at`, when it states one, must **agree** with it (a disagreement is a refusal). A clip is never placed at zero by default any more, because two clips at zero would silently overlap.

**A third change**, in the released test only: the read is now taken **once** and handed to the expected service, and every part assertion carries the exact refusal reason and a compact summary of the emitted input (the clips with their `at`/`time`, the media facts, the listing and the clip references). If the projection refuses again, the capture shows the real reason and the real input instead of only `unsupported`.

Nothing else changed: the approved 015 artifact, the pin, the `OpenFilmNativeExpected` lifecycle, the four-part assertions and the public contract are untouched, and the assertion was **not** weakened to accept `unsupported`.

## 4. The corrected retry request

Exact command (cwd `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`):

```sh
python3 docs/execution/A/implementation-20261111/integration/e1-main-takeover/run-recorded.py \
  n1n2-claude-resume-011-smoke-corrected \
  corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/created-native-source-reader.test.ts -t "R00 smoke"
```

Selected case names — the same two, unchanged:
1. `R00 smoke reaches the reader from the real committed created source`
2. `R00 smoke commits a rich source with the native files and the media`

Classification and effects: **the same heavy classification and the same effects as the granted slot** — real Host HTTP listener on `127.0.0.1` with an ephemeral port, a private SQLite database and private roots under the fixture's own tmpdir, the fixed local `ffmpeg` producing two diagnostic media files (320x180 3 s libx264 colour video, 3 s 48 kHz sine wav — diagnostic only, not authorised Chinese film material, not A-film evidence), the fixed local `ffprobe` invoked by the reader through the parent's own retained descriptor with the upstream argv plus one `ffprobe -version`, the read-only pinned upstream `e70d9d93`, and the already provisioned approved 015 module (no rebuild, no pin change). No browser, no external network, no J drive, no provider, no paid action, no build, no config change, no index change.

Frozen inputs at the moment of this request:

```
7421eedae0a9a4b2c028ac705adb376e64697cf0cf7ce40745dcbe4a7035d2a6  src/host/agent-driven/committed-snapshot-authority.ts
b57bed5df0ea600a2aa1a5b2dc3df2873f794389ee5274f32efb52a6f3d653ad  src/host/agent-driven/created-native-workspace.ts
19110e45a83b6d5b611b4260620ce873f923f1e5a5b907bc6176c4b734fbeed3  src/host/m5/openfilm-native-expected.ts
c5c311c99bfcdb547e3e4fc61787f26e499dfb15ec14e736eeba90fd6b85378b  src/host/agent-driven/retained-native-closure.ts
858ecfdf608b39bddc303d6c3b6ae950d2bf2ceb76dbfa3a132987c7d0b47a04  src/host/agent-driven/created-native-source-reader.ts
439d469032c9af2b83ceb826e0aead7cf5c2fe5c5693be7cbf18c8e67f0f615f  tests/agent-driven/integration/created-native-workspace.test.ts
bfd0c6373b254050d32a6a99e7b6f8b9827dc24b6b2587515ab4c5aad2cd9037  tests/agent-driven/integration/committed-snapshot-host.test.ts
e0b3c6985819618cb70af7970b18b8c3e993834ff5b9237af0c00b7ae8a0aa95  tests/agent-driven/integration/created-native-ack.test.ts
0f270944d5adeb7fa5d9e1c975df31c73fce6bcec9d1a98b0cc3a1a0d2d22bb1  tests/agent-driven/integration/created-native-source-reader.test.ts
98c07c98b20cc4660f81f05e7713f8b97032eaa41071966a90e43a112c1c70e9  tests/agent-driven/integration/helpers/native-source-fixture.ts
```

Only the reader and its test changed since the granted slot; the other eight paths are byte-identical to the hashes MAIN verified. Protected `AGENTS.md` is `37300463a72a612ae16e0a5fcfb496502c57c722b83781e0e2e8c9480594542b` (untouched). Git index: clean.

Compile evidence for these bytes: `n1n2-claude-resume-010-tsc-placement`, argv `corepack pnpm exec tsc --noEmit`, cwd main-integration, actual exit **0**, log sha256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (empty log). Compile is not behaviour evidence.

Not requested, not run: no full suite, no build, no browser, no network, no provider, no paid action, no J drive, no migration of an old Gate, no package or lock change, no index mutation, no other test file. The remaining R01–R07 cases are submitted separately, case by case, after this smoke is green.
