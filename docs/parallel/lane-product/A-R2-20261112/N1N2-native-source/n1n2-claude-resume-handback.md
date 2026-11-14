# N1N2 handback — the real native source and the retained facts

Child: task_5dcbe8192764 / dispatch ctx_e5e736e1846b / terminal term_b4006907-19df-46dd-ae99-34909d8de5e6
cwd of every command: `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration` (WSL)
base and HEAD: `e2eff61b464d75d36598103d718cd2a75db5dfda` — **the index was never touched** by this
child; protected `AGENTS.md` `37300463a72a612ae16e0a5fcfb496502c57c722b83781e0e2e8c9480594542b` untouched.

**Internal state: `N1N2_INTERNAL_EVIDENCED`.** This is component evidence produced by the
implementation child. It is **not** an independent review, **not** a NativeAck, **not** a Studio or
native-UI readiness, **not** an A-film result and **not** a human acceptance — and none of those is
claimed anywhere in this handback.

## 1. What was delivered — the ten released paths

```
7421eedae0a9a4b2c028ac705adb376e64697cf0cf7ce40745dcbe4a7035d2a6  30083  src/host/agent-driven/committed-snapshot-authority.ts
b57bed5df0ea600a2aa1a5b2dc3df2873f794389ee5274f32efb52a6f3d653ad  22057  src/host/agent-driven/created-native-workspace.ts
19110e45a83b6d5b611b4260620ce873f923f1e5a5b907bc6176c4b734fbeed3  47279  src/host/m5/openfilm-native-expected.ts
6f5dd97ba9095c1cd8733b57dc75d27bd25ebd5b87fc715d567de5be8aa60b22  40405  src/host/agent-driven/retained-native-closure.ts      (new)
93fb70c468af3649e0265d6fa1905d3833ecf413f787ff7db938ebd25e78b1cd  58122  src/host/agent-driven/created-native-source-reader.ts   (new)
439d469032c9af2b83ceb826e0aead7cf5c2fe5c5693be7cbf18c8e67f0f615f  12700  tests/agent-driven/integration/created-native-workspace.test.ts
bfd0c6373b254050d32a6a99e7b6f8b9827dc24b6b2587515ab4c5aad2cd9037  12061  tests/agent-driven/integration/committed-snapshot-host.test.ts
5f50db85c7c07a2ecf4faefc20ec2ec6c7ad4910fafe549c2edc76bbad729c7c 134160  tests/agent-driven/integration/created-native-ack.test.ts
7f270b9fbb61ad0fe39646e7dc89822c4428667031adb4ef9c2664b52a89320e  47767  tests/agent-driven/integration/created-native-source-reader.test.ts (new)
9a648b146095a2075505c9fbf7f024935f72c71d9e081ede6310d9d3fa0ea109  19918  tests/agent-driven/integration/helpers/native-source-fixture.ts (new)
```

The diff of the four pre-existing paths against the base is **+521 / −12** lines
(`committed-snapshot-authority.ts` +324, `created-native-workspace.ts` +155, `openfilm-native-expected.ts`
+21, `created-native-ack.test.ts` +33/−12); the four new files are 3 060 lines in total. No file
outside these ten was written.

What each one carries:

- **`retained-native-closure.ts`** — the retained closure of a tree: the real descriptors of the
  files, directories and proved absences it holds; the parent chain that anchors them to the root;
  the ancestry **above** the root, so a root moved under a replaced parent is seen; the whole
  membership as it was at the open; a bounded 64 KiB streaming digest; a text budget enforced
  *before* and *during* the read, with growth refused; the UTF-8 BOM preserved (the film's revision
  is the revision of its own bytes); a synchronous whole-closure guard; and one owner per
  allocation — a descriptor is closed at most once, never retried, and the release is attempted
  all-at-once with the primary error kept and every cleanup error attached.
- **`committed-snapshot-authority.ts`** — `VerifiedNativeFactsLease`: the opaque, instance-registered
  authority over one committed transaction's producer, rights, geometry and consumer graph, with the
  source tree genuinely retained. The digest is recomputed with a **bounded stream** over the media
  instead of reading them whole, and the recomputation is byte-identical to the committed
  `source_digest` (the one extension-set divergence from the pinned `source-digest-v1.ts` was removed).
- **`created-native-workspace.ts`** — the issued-view registry: a workspace ref is a name the Host
  generated, registered against the exact issued view, bound to owner, project, transaction,
  snapshot, revision, source digest, native project id and the **generation the owning service
  derives**. Leases are per acquisition: releasing one invalidates that lease and nothing else, so a
  later stable round can prove again on the same view.
- **`openfilm-native-expected.ts`** — the loader now also exposes the approved module's
  `parseProjectSettings` and `parseMarkers`. A candidate without them is refused with
  `NATIVE_EXPECTED_BUILD_UNSUPPORTED`; there is **no fallback** to another parser. The Expected
  lifecycle body is byte-unchanged.
- **`created-native-source-reader.ts`** — the reader itself: it opens the committed source and the
  working copy as **two independent** retained closures, compares them, reads the film's own bytes,
  classifies every derived item of the working copy by the upstream rule that produced it, lists the
  media in the native's own numeric order, probes the media with the **fixed local ffprobe** through
  the parent's own retained descriptor, builds the 015 input from proved facts only, runs the pinned
  native consumers for the style and the captions, and verifies both trees **before** it delivers.
  It never guesses: a clip it cannot place numerically is left unplaced and the projection refuses it.
- **`created-native-source-reader.test.ts`** and **`helpers/native-source-fixture.ts`** — the cases and
  the real fixture: the real HTTP bootstrap, the real registered local assets, the real SOURCE_ONLY
  producer, the real controlled adoption that commits the rich source, the real working copy, the
  real approved 015 module and the real fixed ffprobe.

## 2. Per-case outcome

**The new file — `tests/agent-driven/integration/created-native-source-reader.test.ts`, 26 cases,
all PASS** (capture `n1n2-claude-resume-035-batch-component`, exit 0, log
`82d64e914fab5b2371dd77d22e1e5ee82f784d118cd526bab4a354a43aac7da5`):

| case | outcome |
|---|---|
| R00 smoke reaches the reader from the real committed created source | PASS |
| R00 smoke commits a rich source with the native files and the media | PASS |
| R01 refuses the legacy project that has no created producer | PASS |
| R02 invalidates the old proof when the working copy changes under it | PASS |
| R02 refuses a pending round when the working copy changes during the read | PASS |
| R02 keeps parallel leases independent and refuses foreign and copied tokens | PASS |
| R02 refuses a facts lease of another authority | PASS |
| R02 releases the whole closure only after the last retained leaf | PASS |
| R03 refuses a sidecar, an unknown item and a missing committed file | PASS |
| R04 refuses a foreign native id, a forged probe cache and a file in flight | PASS |
| R04 accepts a legitimate cache in the next stable round | PASS |
| R05 proves the media facts of the retained bytes | PASS |
| R06 lists the media in the native numeric order | PASS |
| R06 places every clip where the committed film places it | PASS |
| R07 ends a read at a close and releases a late result exactly once | PASS |
| R07 lets the real media child exit before the reader closes | PASS |
| R07 registers the read before a binding callback can close the reader | PASS |
| R07 refuses a later read after a delivered release failed | PASS |
| P06 reproduces the five pinned native revision vectors | PASS |
| P06 lists the media in the numeric order of the host | PASS |
| P07 refuses a symbolic link, a same-bytes replacement and a restored change time | PASS |
| P07 refuses a text file above the budget and bounds the total | PASS |
| P07 refuses to release while work is in flight and releases every allocation once | PASS |
| P07 refuses a reentrant release from inside an accepted read | PASS |
| P07 keeps the failure of the walk release with the failure that stopped it | PASS |
| P07 proves an empty directory and sees the file that appears in it | PASS |

(The eight P cases are in capture `n1n2-claude-resume-034-batch-pure`, exit 0, log
`2df7f22afccda8cba9a772720c125d27c34be3bee265459420a8d7e11bd37eea`; the eighteen R cases are in
`n1n2-claude-resume-035-batch-component` as above.)

**The existing regressions — 107 assertions, all PASS** (capture
`n1n2-claude-resume-036-batch-regressions`, exit 0, log
`4c84e9e75dea48f0f68a07380b57bfd2003d24790b0b1c6b895429a30c50f04f`): `created-native-ack.test.ts`
(the 84 inherited assertions, the loader refusals and the new missing-parser negative case),
`committed-snapshot-host.test.ts` and `created-native-workspace.test.ts`.

**The earlier component smoke** — `n1n2-claude-resume-011-smoke-corrected`, exit 0, log
`8343533b27b7eb0d11a985ca841fab2a6ea24012e06c0594c3ef5bd0f46b9e83`, 2/2.

**NOT RUN, and not claimed:** the two 60–180 second authorised Chinese films with sound (GATE A);
any native UI load, any NativeAck row, any Studio session; the browser, the external network, the J
drive, a provider, a paid action, a build, a full-suite run, an old-Gate migration, a DDL or a
configuration change; the S01/S02 selection epoch, the A01–A05 and H01–H04 gates (those are N3, N4
and N5, outside this release); and the independent review of this candidate.

**Every failure along the way is preserved**: the captures `n1n2-claude-001` … `036` carry their
actual exits, including the exits of 2 (compile), and the batch runs that failed — 008, 017, 018,
019, 021, 022. The full capture list with its exits is in the capture directory; nothing was
overwritten and no failing capture was re-run under its own name.

## 3. The real commands and their evidence

Every command ran through the existing immutable `run-recorded.py` with the unique
`n1n2-claude-resume-*` prefix, in the MAIN cwd, one at a time, with the sources frozen for the
recorder's lifetime. The final three:

| command | recorder exit | drift | raw log sha256 |
|---|---|---|---|
| `n1n2-claude-resume-034-batch-pure` | 0 | none | `2df7f22afccda8cba9a772720c125d27c34be3bee265459420a8d7e11bd37eea` |
| `n1n2-claude-resume-035-batch-component` | 0 | none | `82d64e914fab5b2371dd77d22e1e5ee82f784d118cd526bab4a354a43aac7da5` |
| `n1n2-claude-resume-036-batch-regressions` | 0 | none | `4c84e9e75dea48f0f68a07380b57bfd2003d24790b0b1c6b895429a30c50f04f` |

The compile gate for the delivered bytes: `n1n2-claude-resume-033-tsc-afterbatch`, argv
`corepack pnpm exec tsc --noEmit`, cwd MAIN, actual exit **0**, log sha256
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (empty log). Compile is not
behaviour evidence.

## 4. The existing behaviour that is protected

- The `OpenFilmNativeExpected` lifecycle — `prove` / `assertCurrent` / `release` / `close`, the
  baseline snapshot, the late cleanup, the sticky failure — is **byte-unchanged**; the loader
  change is the only edit in that file, and it *adds* a refusal rather than relaxing one.
- The approved 015 artifact and its pin are untouched: the module is read from the already
  provisioned `var/native-hydration-r2/managed-native-expected/dist` (`expected-projection.mjs`
  sha256 `3500b1d6485791b13ec9364c6eb80740531142c16754877e21923ad73e9d494e`,
  `native-pure-library.mjs` sha256 `9cb18aebe9a5daf08a2c92259b6314493fe98e40fe8a1b410bad444671a9904c`).
  Nothing was rebuilt and no pin was changed.
- The 84 inherited assertions of `created-native-ack.test.ts` are intact; the only change to that
  file is two type-only imports and the fixture-only parsers its generated stand-in module now
  exports — plus a new negative case that pins the refusal of a module *without* those exports.
- The legacy render contract of `CommittedSnapshotAuthority` is untouched: `readerForTransaction`
  and `readSnapshot` behave exactly as before, and the legacy path is still refused where it was
  refused.
- No public DTO, EnginePort, SQL namespace, configuration, pin, package script or lock file was
  changed, and the git index was never mutated by this child.

## 5. The rollback

The rollback is a plain revert of the ten released paths: four of them exist in the base commit
`e2eff61` and can be restored with `git checkout e2eff61 -- <path>`; the four new files are removed.
Nothing else in the worktree depends on them — no index entry, no migration, no configuration, no
pin — so the rollback needs no other step. The protected `AGENTS.md` and every other user-dirty
file are untouched by the change and by its rollback.

## 6. Resources handed back

- **Processes**: the launcher, the recorder and the vitest worker of every command of this task are
  absent; the raw receipts are in `n1n2-claude-resume-batch-cleanup-evidence.txt` (sha256
  `5dd29dbb189292e0cb1d9b85af3e8eafd0977b266dae6cbf4837b730bf560ad1`) and in the earlier
  `n1n2-claude-resume-smoke011-cleanup-evidence.txt`. Each receipt states exactly what this shell's
  view showed and explicitly does **not** claim a global absence of processes or directories, a
  descriptor leak into another process, or a per-resource lifetime test of the closure, the leases
  or the descriptors.
- **Descriptors**: every retained leaf, directory, absence, parent chain and ancestry is owned by
  exactly one allocation, released once, and never retried; the reader's close drains the accepted
  reads, the underlying acquisitions and the real child exits before it returns.
- **Slots**: `N1N2-RESUME-SMOKE-001`, `-002`, `N1N2-RESUME-BATCH-001`, `-002` and `-003` are all
  released with their receipts.
- **The worktree**: the only files this child wrote are the ten released paths and the evidence
  under `docs/parallel/lane-product/A-R2-20261112/N1N2-native-source/` and the captures under
  `docs/execution/A/implementation-20261111/integration/e1-main-takeover/`.

## 7. What is handed to MAIN as an open item

The design asks for the exact upstream evidence of every native cache item, and for anything the
native needs that this release does not cover to be reported rather than guessed. The cache rules
implemented here are the upstream's own, from the pinned source:

- `.film/cache/probe/<20hex>.3.json` — the key must be the upstream's own key of a media file that
  is *in this project now* (`derived.mjs`: `sha1(rel\0size\0round(mtimeMs)).slice(0,20)`), and the
  cached answer must equal an **independent probe of the same bytes**, field by field. The probe
  cache is never authority.
- `.film/cache/posters/<20hex>.jpg`, `frames/<20hex>-<ms>-<width>.jpg`, `waves/<20hex>.json` — the
  key must bind a media file of this project; the frame's width must be one the native draws.
- `.film/cache/pageframes/<24hex>.{jpg,json,stamp}` — the trio must be complete, the `.json`'s
  files must exist, and the `.stamp` must equal the stamp recomputed from those files
  (`pageframes.mjs`).
- `.film/cache/film-duration.json` — its `film` part must be the current `film.html`'s
  `mtimeMs:size`; `.film/cache/film-poster.jpg` — a regular file.
- `.film/id` — the upstream's format and the id the Host issued; `.film/.gitignore` — exactly `*\n`
  (`projects.mjs`).
- **Everything else under `.film/cache/` is refused** as an unknown item: `proxies/`, `audio/`,
  `export/`, `commits/`, `history-files.json`, `.film/history/`, and any item whose producer is not
  one of the rules above (`derived.mjs`, `pageframes.mjs`, `projects.mjs`).

The residual operational consequence, stated plainly rather than hidden: a cache entry whose media
has since been **replaced in place** is no longer bound to any media file of the project, so it is
refused. That is the fail-closed reading of the approved table ("only the media key the upstream
actually bound"), and it is MAIN's to rule on: either the upstream is asked for a rule that covers a
replaced media file, or the operational answer is that a replaced media file makes the working copy
unprovable until the cache is regenerated. This release does **not** ignore `.film` wholesale and
does **not** delete anything.

## 8. The honest limits of this handback

- This is **component** evidence from the implementation child. The independent review of this
  candidate is **outstanding** and is not mine to perform; the root must be frozen and reviewed by
  someone who took no part in this implementation.
- The media the fixture produced is **diagnostic**: a 320×180 three-second colour video and a
  three-second sine tone. They are not authorised Chinese film material and they carry no claim
  about the real A material.
- The native UI, the NativeAck path, the selection epoch and the A/H gates were not exercised here;
  they belong to the later releases and to the human acceptance that this work does not replace.
- Two process facts were corrected during this task and are recorded rather than smoothed over: the
  digest I reported for the closure once carried a stray character (the real one is in §1 and equals
  what capture 033 froze), and the test file was changed once **after** a freeze request, which was
  reported immediately and is preserved in the mail history.
