# N1N2 corrective release 004 — the defect-to-assertion matrix

Child: task_5dcbe8192764 / dispatch ctx_e5e736e1846b / terminal term_b4006907-19df-46dd-ae99-34909d8de5e6
Source root: `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration` — base `e2eff61b464d75d36598103d718cd2a75db5dfda`
Authority: `MAIN_CORRECTIVE_RELEASE_004.md` (sha256 `d36f5972eef6101c6d0da201a1d793446828ac664abbdbfd3116b6db1cc9c214`) and the
independent gap audit `independent-coverage-audit/REVIEW.md` (sha256 `c36b12832ae245db07c856f7550607cacb113dc67ed5c5bacec4552226891f02`)
with `MATRIX.json` (sha256 `45bb25e1413363c8da7e3dc46da67682ed8b2360ddc7766f386b246c58b1eb41`).

The audit is a **gap audit, not an external PASS**. The frozen candidate of batch 003 and every
capture of it stay as historical evidence; the ten paths below are the corrective bytes.

## 0. What the corrective bytes are

```
754e57885787bd8586923105f96790db77521feb2344532f2d3057e821d28805  src/host/agent-driven/committed-snapshot-authority.ts
b57bed5df0ea600a2aa1a5b2dc3df2873f794389ee5274f32efb52a6f3d653ad  src/host/agent-driven/created-native-workspace.ts
19110e45a83b6d5b611b4260620ce873f923f1e5a5b907bc6176c4b734fbeed3  src/host/m5/openfilm-native-expected.ts
0b6c3de8f10d1ad06b4abe0f287dfb80f00f25adeeba61d0ac46faf2fef35290  src/host/agent-driven/retained-native-closure.ts
6ecb32430c6c33e7f0d4f0de6ea8a9a766a54d593090a64f82606cda2d72d14a  src/host/agent-driven/created-native-source-reader.ts
439d469032c9af2b83ceb826e0aead7cf5c2fe5c5693be7cbf18c8e67f0f615f  tests/agent-driven/integration/created-native-workspace.test.ts
bfd0c6373b254050d32a6a99e7b6f8b9827dc24b6b2587515ab4c5aad2cd9037  tests/agent-driven/integration/committed-snapshot-host.test.ts
5f50db85c7c07a2ecf4faefc20ec2ec6c7ad4910fafe549c2edc76bbad729c7c  tests/agent-driven/integration/created-native-ack.test.ts
25eacd8f24c832ea892ae4431b54a0b65624ab8b6d2c0ee77e3cb7be28243d22  tests/agent-driven/integration/created-native-source-reader.test.ts
9a648b146095a2075505c9fbf7f024935f72c71d9e081ede6310d9d3fa0ea109  tests/agent-driven/integration/helpers/native-source-fixture.ts
```

Compile evidence: `n1n2-claude-resume-045-tsc-f10d`, argv `corepack pnpm exec tsc --noEmit`, cwd MAIN,
actual exit **0**, log sha256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (empty log).

## 1. F01–F10: the finding, the change, the assertion, the outcome

| finding | the change in the corrective bytes | the assertion | outcome |
|---|---|---|---|
| **F01** BLOCKER — the verification walk and the negative walk swallowed their temporary close failures, and `closeOwned` did not latch the uncertainty | `#closeOwned` now latches `#uncertain` and records every close failure in `#cleanupFailures`; the verification walk's own release keeps its failure; `verify()` re-reads the latch **after** the walk; the final release returns the **complete ledger once** (the temporary failures plus the fresh ones, deduplicated, never erased by a repeated release); the negative walk has no temporary descriptors left to lose — `retainAbsent` now reuses the retained directories | `F01 keeps a temporary release failure and reports it once at the final release` | **PASS when run** — the assertion is written and the bytes compile; the *run* is pending the runtime grant |
| **F02** — the dependency closure demanded positive files for proved absences, and there was one precomputed supply pass | the dependencies are now checked against **their own ledgers**: the retained files, the closure's proved absences, the retained directories and the probed media; a consumer that reports a missing dependency is served from the retained tree by a **bounded discovery** (three rounds, sixty-four dependencies per round) and the consumer runs again | the R00/R03 cases exercise the ledgers; the discovery's *success* path is not produced by the fixture | **the ledgers PASS when run; the discovery's success path is NOT_RUN** — the fixture's consumers find everything the reader supplied, so the discovery never runs |
| **F03** — the source identities were first retained *after* the asynchronous digest and lineage reads | the closure is opened **first**: the digest, the plan and the film are read through the **retained** descriptors, the parse is compared with the retained text, and the tree is verified again before the facts are delivered; the binding is re-checked at the delivery | `F03 refuses a stale source identity and proves the next one` | **PASS when run** for the post-issue variant; the **in-flight** variant (a source leaf replaced *inside* the acquisition) is **NOT_RUN**: there is no deterministic barrier inside the authority without a seam, and no seam was added |
| **F04** — no hardlink/alias rejection, and the classification saw files only | the reader compares the device and the inode of every committed leaf in the two trees: a leaf that *is* the committed file is an alias, not a copy; the **directories** of the working copy are classified too, against the source's directories plus the native's own cache directories | `F04 refuses a hardlink alias and an unknown directory in the working copy` | **PASS when run** |
| **F05** — the page-frame pairing accepted an arbitrary key and an empty dependency list, and the film poster was accepted unconditionally | both are now **explicitly refused**: the page-frame key needs the page, the moment, the width and the overrides, which the upstream does not persist, so the pairing is not provable from the tree; the film poster is the *last* poster the native kept, not a proof of a current render. Nothing is deleted and no whitelist is widened | `F05 refuses a page frame cache entry and an orphan film poster` | **PASS when run** — and the refusal is reported as a native usability consequence, not as a silent prohibition |
| **F06** — the authority read a non-media file whole before the size check, had no cumulative bound and no descriptor estimate | the digest reads **through the retained descriptors**, so the closure's own limits apply: the size is refused before the bytes are read, the total is bounded, the path and depth bounds are the closure's; the closure now **reuses one descriptor per directory** and holds an explicit `maxDescriptors` budget, so a tree's descriptors are bounded by its paths and not by its file count | the pure budget and descriptor cases in P07 | **the closure's budgets PASS when run; the authority's own preflight is NOT_RUN** — a committed source with an oversized text or too many paths cannot be produced by the real producer, and inventing one would fabricate the committed bytes |
| **F07** — the cleanup reporting differed before and after the transfer, and the reader's close could resolve after a delivered release had failed | the authority's failure path keeps the **primary** and attaches the cleanup causes; the reader's delivered and failed paths push their failures into the reader's ledger, so `reader.close()` reports the real cleanup state | `F07 reports a delivered release failure when the reader closes` | **PASS when run** |
| **F08** — the lease's guard did not revisit the producer's DB lineage | the lineage fingerprint (the adoption fact, the impact fact and the committed plan, which carries the consumer graph's digest) is sampled **before the first authority await**, required to be present, compared after the whole acquisition and bound to the lease; `assertCurrent` re-derives it | `F08 refuses a lease whose producer lineage changed after the issue` | **PASS when run** for the post-issue variant; the **in-flight** variant is **NOT_RUN** for the same reason as F03 |
| **F09** — the probe's failure, limit and normalisation semantics were unproved | the reader's probe keeps its own refusals (malformed answer, non-zero exit, spawn failure, deadline, output bound) and its full normalised fact set (duration, width, height, fps, audio, codec, pixfmt) with the rotation swap; the probe evidence binds the tool version, the argv, the input digest and bytes, the ledger identity and the normalised result | the R05 case (the facts against an independent probe of the same bytes) and the R07 case (the real child's start and exit, the input live at the exit and released afterwards) | **the real-tool facts and the child's lifetime PASS when run; the tool FAULT cases (malformed, non-zero, spawn, deadline, output overrun) are NOT_RUN** — they need either a tool seam, which would fabricate outputs, or a crafted committed media, which this release may not fabricate; the **rotation and multiple-stream** vectors are NOT_RUN for the same reason (the fixture's media is a plain colour video) |
| **F10** — the ordering oracle was a second handwritten sort and the environment was only checked for existing | the listing is compared with the **pinned consumer itself** (`files.mjs`'s `listFiles`) on a real tree with `video2`, `video10` and a non-ASCII name; the caption directory's retained listing is compared with the platform's own order; the Node, ICU and locale values are **recorded**; the pinned consumer is shown to refuse a clip that states no number, so the reader's placement has to be a proved one | `F10 lists the media as the pinned consumer lists it`, `F10 keeps the caption directory in the platform order`, `F10 shows that the pinned consumer refuses a clip without a number` | **PASS when run**; the implicit placement is thereby shown to be the **reader's proved** placement, and the pinned consumer's own arithmetic for an unplaced clip is **not** reachable, so the comparison is closed in the direction that matters |

## 2. The original R01–R07, after the correction

| requirement | the assertions that cover it | outcome |
|---|---|---|
| R01 the real chain and the two independent trees | the two R00 cases, `R01 refuses the legacy project`, `F04` (the alias and the directory), `F08` | **PASS when run**; the rich layout specifics (the box, the style, the volume) stay **NOT_RUN** |
| R02 the identity, the swap and the fences | `R02 invalidates the old proof`, `R02 refuses a pending round`, `R02 keeps parallel leases independent`, `R02 refuses a facts lease of another authority`, `R02 releases the whole closure only after the last retained leaf`, `F03` | **PASS when run**; the parent-directory move under a replaced parent is **NOT_RUN** at the reader level (the closure's ancestry is retained and verified ✓, but the case is not written) |
| R03 the positive and negative dependencies | `R03 refuses a sidecar, an unknown item and a missing committed file`, `P07 proves an empty directory…` | **PASS when run**; the media-side `.vtt` and translation variants and the discovery's success path are **NOT_RUN** |
| R04 the native identity and the cache | `R04 refuses a foreign native id…`, `R04 accepts a legitimate cache in the next stable round`, `F05` | **PASS when run**; the `posters`, `frames` and `waves` cache families are classified by the upstream's own key rules but **no case produces them** — **NOT_RUN** |
| R05 the probe | `R05 proves the media facts of the retained bytes`, `R07 lets the real media child exit before the reader closes` | **PASS when run**; the **authorised Chinese** recordings and videos are **NOT_RUN** — the fixture's media is diagnostic |
| R06 the revision and the ordering | `P06 reproduces the five pinned native revision vectors`, `P06 lists the media in the numeric order of the host`, `R06 lists the media…`, `R06 places every clip…`, the three `F10` cases | **PASS when run** |
| R07 the budgets, the ownership and the cleanup | the six `P07` cases, `R07 ends a read at a close…`, `R07 registers the read before a binding callback…`, `R07 refuses a later read after a delivered release failed`, `F01`, `F07` | **PASS when run**; ENOMEM/EMFILE/EIO/EACCES as injected outcomes are **NOT_RUN** |

## 3. The runtime batch that is requested

The cases are **35** in the new file and the three legacy files. The selection is by name pattern, so
that the pure cases never run a Host, a media tool or a database.

**A — the pure cases** (no Host, no DB, no media tool, no network):

```sh
python3 docs/execution/A/implementation-20261111/integration/e1-main-takeover/run-recorded.py \
  n1n2-claude-resume-046-corrective-pure \
  corepack pnpm exec vitest run --config vitest.config.ts \
  tests/agent-driven/integration/created-native-source-reader.test.ts \
  -t "P0|F01|F10a|F10b"
```

**B — the component cases** (real Host, private DB, diagnostic media, the real fixed ffprobe):

```sh
python3 docs/execution/A/implementation-20261111/integration/e1-main-takeover/run-recorded.py \
  n1n2-claude-resume-047-corrective-component \
  corepack pnpm exec vitest run --config vitest.config.ts \
  tests/agent-driven/integration/created-native-source-reader.test.ts \
  -t "R0|F03|F04|F05|F07|F08|F10d"
```

**C — the legacy regressions** (every case of the three files):

```sh
python3 docs/execution/A/implementation-20261111/integration/e1-main-takeover/run-recorded.py \
  n1n2-claude-resume-048-corrective-regressions \
  corepack pnpm exec vitest run --config vitest.config.ts \
  tests/agent-driven/integration/created-native-ack.test.ts \
  tests/agent-driven/integration/committed-snapshot-host.test.ts \
  tests/agent-driven/integration/created-native-workspace.test.ts
```

The effects are the ones already granted and are unchanged: a real `NarralensHost` on an ephemeral
loopback port, a private SQLite database with this worktree's migrations, private roots under the
fixture's tmpdir, the fixed local `ffmpeg` producing two **diagnostic** media files (a 320×180
three-second colour video and a three-second sine tone — not authorised Chinese film material), the
fixed local `ffprobe` invoked by the reader through the parent's own retained descriptor, the
read-only pinned upstream `e70d9d93`, and the already provisioned approved 015 module (no rebuild,
no pin change). No browser, no external network, no J drive, no provider, no paid action, no build,
no index or configuration change.

## 4. What this does not claim

The whole of N1N2 is **not** called complete. This is component evidence from the implementation
child; the independent audit was a gap audit and not an external acceptance, and the acceptance of
this candidate still has to bind a real frozen commit to a reviewer who took no part in this
implementation. The **NOT_RUN** rows of §1 and §2 are not waivers: they are the adversarial
obligations that no case of this release establishes, and MAIN owns the decision on each of them.

## 5. Amendment 1 — the cases the first request did not name, and the corrected selection

The first request of this corrective release was **not granted**: its test digest
(`25eacd8f…`) was the file *before* the last case was added, so the recorded bytes and the bytes on disk
differed. The request is preserved above; this is the amendment, and nothing of the earlier request is
rewritten.

**The corrected bytes** (the file is `642ba52c…` now):

```
d18dfac5405228204faf7d3798a3e739f96ebbec02fa06f64dd761bf48fe3d1a  src/host/agent-driven/committed-snapshot-authority.ts
b57bed5df0ea600a2aa1a5b2dc3df2873f794389ee5274f32efb52a6f3d653ad  src/host/agent-driven/created-native-workspace.ts
19110e45a83b6d5b611b4260620ce873f923f1e5a5b907bc6176c4b734fbeed3  src/host/m5/openfilm-native-expected.ts
0b6c3de8f10d1ad06b4abe0f287dfb80f00f25adeeba61d0ac46faf2fef35290  src/host/agent-driven/retained-native-closure.ts
6ae2329d63d83d4cd882dbf4120d44a241c8194e8b4163fb927520c66cba2931  src/host/agent-driven/created-native-source-reader.ts
439d469032c9af2b83ceb826e0aead7cf5c2fe5c5693be7cbf18c8e67f0f615f  tests/agent-driven/integration/created-native-workspace.test.ts
bfd0c6373b254050d32a6a99e7b6f8b9827dc24b6b2587515ab4c5aad2cd9037  tests/agent-driven/integration/committed-snapshot-host.test.ts
5f50db85c7c07a2ecf4faefc20ec2ec6c7ad4910fafe549c2edc76bbad729c7c  tests/agent-driven/integration/created-native-ack.test.ts
642ba52c41009a77a20b7b36fa0e710cd699138f5e737c1c8245769206080d67  tests/agent-driven/integration/created-native-source-reader.test.ts
0109458a3a7530f31c7c5fd1397cebf1ebe4b2a0da6857e14b9cf37f5ea456c2  tests/agent-driven/integration/helpers/native-source-fixture.ts
```

Compile evidence for these bytes: `n1n2-claude-resume-048-tsc-f10`, argv `corepack pnpm exec tsc --noEmit`,
cwd MAIN, actual exit **0**, log sha256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

### The exact selection, corrected

The file holds **41** cases. The pure ones are eleven: the six `P07`, the two `P06`, `F01`, `F10 lists`
and `F10 keeps`. The other thirty need the Host, the database, the diagnostic media or the real tool.

```sh
# A — the eleven pure cases: no Host, no database, no media tool, no network
python3 docs/execution/A/implementation-20261111/integration/e1-main-takeover/run-recorded.py \
  n1n2-claude-resume-049-corrective-pure \
  corepack pnpm exec vitest run --config vitest.config.ts \
  tests/agent-driven/integration/created-native-source-reader.test.ts \
  -t "P0|F01|F10 lists|F10 keeps"

# B — the thirty component cases
python3 docs/execution/A/implementation-20261111/integration/e1-main-takeover/run-recorded.py \
  n1n2-claude-resume-050-corrective-component \
  corepack pnpm exec vitest run --config vitest.config.ts \
  tests/agent-driven/integration/created-native-source-reader.test.ts \
  -t "R0|F02|F03|F04|F05|F06|F07|F08|F09|F10 shows"

# C — the legacy regressions
python3 docs/execution/A/implementation-20261111/integration/e1-main-takeover/run-recorded.py \
  n1n2-claude-resume-051-corrective-regressions \
  corepack pnpm exec vitest run --config vitest.config.ts \
  tests/agent-driven/integration/created-native-ack.test.ts \
  tests/agent-driven/integration/committed-snapshot-host.test.ts \
  tests/agent-driven/integration/created-native-workspace.test.ts
```

`F10 lists` and `F10 keeps` are pure (they touch only a temporary tree and the pinned consumer);
`F10 shows` is a component case (it needs the fixture's facts). The earlier filter named `F10a`/`F10b`/`F10d`,
which matched **no** actual title — that was my error, and the filters above are the exact titles.

### What the in-flight cases needed, and what they use

- **F03 in flight** — the acquisition had to be interruptible at a *deterministic* point. The authority
  now exposes a Host-private observation of the source reads
  (`observeNativeFactsSourceReads`): the case swaps the source leaf, or the source's `assets/video`
  parent, at the moment the source is read, and the acquisition must refuse it. The post-issue variant
  stays as its own case.
- **F08 in flight** — the same observation lets the case change the impact plan while the acquisition is
  running; the fence that was sampled **before** the first await must still hold.
- **F02** — a proved absence is a legitimate dependency: the markers file the committed source does not
  have is accepted, and its later birth invalidates the proof that was made while it was absent.
- **F06** — the authority's own preflight is bounded: a referenced text above the budget, named as a root of
  the committed fact, is refused with the budget's own code — before its bytes are read.
- **F09** — the probe's failure branches are reached through a fault injection that can only make the probe
  **fail** (`spawn`, `timeout`, `nonzero`, `malformed`, `output`); the normalisation's success vectors use a
  **real** tool: a real rotated video, whose shown sides the upstream swaps a quarter turn, and the first of
  two video streams.
- **F01** — the injected release now closes the descriptor and *then* fails, so the number is really
  released and the operating system may hand it out again; no number is accused twice. The assertions are
  the ledger's length, the latch and the final report.
- **F10 listing** — the reader's listing is fed the paths in a **scrambled** order and must return the
  **pinned** consumer's order, so a listing that echoed its input could not pass; the Node, ICU and locale
  values are **emitted** into the captured log with the `N1N2_ENVIRONMENT_FINGERPRINT` marker.

### Still NOT_RUN, honestly

- **The caption directory's order through the consumed route.** The consumer's translation order comes from
  the directory listing the reader supplies, but the committed source carries one transcript and **no**
  translation, and a translation in the working copy is a derived sidecar the source does not have — refused
  by F05's rule. The order is therefore not observable through the consumed route in this release. The
  closure-level order is asserted (`F10 keeps`).
- **The in-flight *cache* and *workspace* mutations during a probe** — the in-flight case covers the source
  and the working copy's film; a cache appearing during the probe is the same mechanism ✓ (the membership
  walk) but is not a separate case.
- **The probe's normalisation against a video with an unusual frame rate or a missing duration** — the
  normalisation's rules are exercised for the rotation, the frame rate and the first stream ✓; a missing
  duration is not exercised (the fixture's media always has one).

## 6. Amendment 2 — the ACTUAL outcomes of batch 004, and the corrections they caused

Batch `N1N2-RESUME-BATCH-004` ran its three commands serially, each once, on the frozen bytes. The
results are **actual**, not expected:

| command | result | raw log sha256 |
|---|---|---|
| 049 `n1n2-claude-resume-049-corrective-pure` | **11 passed**, 30 filtered, exit 0 | `1f994bfd27da29c3d9a21c29d1615fd684fa5c776f5c303e1de8efc8b1df2c99` |
| 050 `n1n2-clume-050-corrective-component` | **26 passed, 4 failed**, 11 filtered, exit 1 | `5dd8781441e319209fdc593c7eac152f7986538cb5155fe7b8e8598749fb65f8` |
| 051 `n1n2-claude-resume-051-corrective-regressions` | **107 passed**, 3 files, exit 0 | `ca70ae830234f79bee703e157e21e646faa9855acc07ed3a5597615e4ac7d237` |

So the **pure** cases are PASS (eleven of eleven), the **legacy regressions** are PASS (107 of 107), and
the **component** cases are 26 of 30 — the four that failed are the four listed in §6.1. The correction
map of §1 is therefore **not** a claim: the rows that say "PASS when run" now carry their actual
outcome, and the rows that are still pending say so.

### 6.1 The four failures and the correction each one caused

| the failure | what it showed | the correction |
|---|---|---|
| R07 (the delivered release) | the case's own cleanup rejected the reader's close **reporting** the delivered failure — the behaviour under test | the case now asserts the expected failure **and its cause**, and the fixture's own close is checked for the same reporting instead of being swallowed as an accident |
| F06 (the budget) | I corrupted the committed **fact**, whose digest protected it, so the acquisition refused *changed facts* before the budget was reached | the database facts stay entirely unchanged; the **existing** referenced film is overwritten on the disk (post-commit filesystem corruption and a resource defence); the exact budget code is asserted, and a private read seam proves that **no bytes** were moved before the refusal |
| F09 (the faults) | the case built the reader with an empty library, and the injection **bypassed** the production runner | the injection is now a **transport** injection: it replaces the process the runner starts and the deadline it enforces, so the **same** runner, parser and child bookkeeping take their real failure branches; each scenario asserts its **exact** code |
| F09 (the rotation) | the file carried no display matrix, because this ffmpeg ignores `-metadata rotate=90` | verified against the real tool: `-display_rotation 90` (an **input** option) produces the `Display Matrix` with `rotation: 90`; the coded size stays 320×180 and the upstream's rule swaps it to the shown 180×320. The case asserts the coded size, the matrix and the swapped result — the expected width was not changed, the fixture was |

### 6.2 The corrected bytes for the next batch

```
f8470afddb8e8732edb112379902c3e28f51892a0104d6182f13207d473906c9  src/host/agent-driven/committed-snapshot-authority.ts
b57bed5df0ea600a2aa1a5b2dc3df2873f794389ee5274f32efb52a6f3d653ad  src/host/agent-driven/created-native-workspace.ts
19110e45a83b6d5b611b4260620ce873f923f1e5a5b907bc6176c4b734fbeed3  src/host/m5/openfilm-native-expected.ts
b5a94daf6560701d7c0f4751ac4f51bf2a46c95a3f256f53d68606ee482c91cd  src/host/agent-driven/retained-native-closure.ts
82cd502970800d5d53be4833b693612ec4ad7bdaa04490cd1be0ad86df7520da  src/host/agent-driven/created-native-source-reader.ts
439d469032c9af2b83ceb826e0aead7cf5c2fe5c5693be7cbf18c8e67f0f615f  tests/agent-driven/integration/created-native-workspace.test.ts
bfd0c6373b254050d32a6a99e7b6f8b9827dc24b6b2587515ab4c5aad2cd9037  tests/agent-driven/integration/committed-snapshot-host.test.ts
5f50db85c7c07a2ecf4faefc20ec2ec6c7ad4910fafe549c2edc76bbad729c7c  tests/agent-driven/integration/created-native-ack.test.ts
cd26495a9a6d188f0bc0c2d96483fb70f1869930a1c7fd5a7cf64525c90bb7e1  tests/agent-driven/integration/created-native-source-reader.test.ts
19cb73cb9d69394e550699d3363128a4ea60e96a3f28f22e1ea4fce01c6dda0a  tests/agent-driven/integration/helpers/native-source-fixture.ts
```

Compile evidence: `n1n2-claude-resume-056-tsc-fixes5`, argv `corepack pnpm exec tsc --noEmit`, cwd MAIN,
actual exit **0**, log sha256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

The next batch is the same three commands with new capture names: `057-corrective-pure`
(`-t "P0|F01|F10 lists|F10 keeps"`), `058-corrective-component`
(`-t "R0|F02|F03|F04|F05|F06|F07|F08|F09|F10 shows"`) and `059-corrective-regressions` (the three
legacy files). The effects are unchanged: the real Host, the private database, the diagnostic media, the
real fixed ffprobe and the read-only pinned upstream.

## 7. Amendment 3 — the remaining original proofs, and the two contract facts MAIN must rule on

Focused batch `N1N2-RESUME-FOCUSED-006` (command 064, exit 0, **3 passed / 38 filtered**, raw log
`1c683c55d20e45339d6f1afd7c7189435642b1f8517aa05080fbdab49faa9ca8`) closed the three failures of batch
005. This section records the remaining original proofs, the new assertions that carry them, and the two
facts that are **contract facts about the pinned upstream** rather than missing evidence.

### 7.1 The assertions that were added

| the obligation | the assertion | kind |
|---|---|---|
| the read that meets a changed file | `P07 refuses a grown file, the cumulative text, the deep tree and the descriptor budget` — the file grows between the retention and the read, the cumulative text is bounded, the depth is bounded and the descriptor budget is a refusal, not an EMFILE | pure FS |
| the N-th open | `P07 keeps the primary error when an open fails and releases everything else` — the third open fails, the primary error is kept, every cleanup cause is kept and the closure still holds nothing half-opened | pure FS, the injection is labelled |
| the missing or invalid duration | `P06 normalises a missing and a picture duration as no duration` — a zero duration, a picture format and a stream with no video stream | pure |
| the probe provenance | `F05 binds the probe evidence to the concrete tool, argv, input and result` — the digest is **recomputed** from the concrete tool version, the argv profile, the input digest and bytes, the file's device and inode and the independently normalised result | component |
| the working copy changing during the probe | `F03 refuses a pending round when the working copy changes during the probe` — a cache entry and a directory appear while the real media probe runs; the pending round is refused | component |
| the delivered resources | `R07 keeps the delivered resources until their owner releases them` — the reader's close does not destroy the delivered handles; the closure verifies until its owner releases them, and not after | component |
| the caption set | `R03 refuses a translation beside the media that the committed source does not have` | component |
| the dependency ledgers | the F02 case (a proved absence accepted, its later birth invalidating the proof) and the reader's own ledger checks (the consumed files, the proved absences, the listed directories and the probed media each against their own ledger) | component |

### 7.2 The two contract facts MAIN must rule on — not missing evidence

1. **The caption translation order through the consumption chain.** The pinned consumer reads the
   directory listing to find the translations (`translationsOf`, native-effective-sidecars.ts:2989-3001) and
   the order it receives decides the order of the alt lines. The **created producer writes exactly one
   transcript per media and never a translation** (`native-draft-assembler.ts:87-91` writes the `.vtt`
   only when a shot has a caption), so a created source has no translation to order. The reader refuses a
   translation that the committed source does not have (R03 above), so the branch is **unreachable for a
   created source** rather than unproven. The reader still supplies the platform's raw order to the
   consumer. MAIN rules whether that boundary is acceptable for this release or whether the producer must
   express translations.
2. **The implicit placement.** The numeric profile's refusal of a clip without a number proves the
   *profile's* limit, not that the pinned native consumer has no implicit placement. It does have one:
   the approved module's own `guessedSpan` places a clip whose `at` is absent at **0**
   (`native-pure-library.mjs:119-126`). The reader is therefore **stricter** than the pinned consumer: it
   refuses an unproved placement instead of defaulting to zero, and it cross-checks the film's own `at`
   against the producer plan's frame range. That boundary is explicit in the code and is MAIN's to accept
   or to overrule.

## 8. Amendment 4 — the placement semantics follow the pinned native, not my plan

MAIN's ruling (`MAIN_NATIVE_PLACEMENT_AND_CAPTION_DECISION.md`) corrected my section 7.2: the reader was
**not** stricter than the pinned consumer — it **changed the playback meaning**. My section 7.2 claim is
withdrawn.

The pinned upstream resolves an omitted place as **zero** (`timeline.mjs`: `settle()` line 494
`c.at = row.at ?? 0`; `cue()` line 818 `const at = row.at ?? 0`), and the Studio's own layout does the
same (`timeline-layout.ts:620`). It is *not* "after the previous clip" and it is *not* the Narralens
plan's time.

**What the reader now does** (`nativeClipPlacement`, exported from the reader):

- a clip that states **no** place is resolved to **0** — the native's own value;
- a clip that states a place which is **not** a number (or is negative or not finite) is **refused**;
  it is never treated as an omission;
- an explicit numeric place is kept as it is;
- the producer plan is **never** substituted for the document: it is only **compared** with the place
  the document resolved, and a difference is an explicit refusal (`NATIVE_SOURCE_PLACEMENT_MISMATCH`).
* The source bytes and the `native_rev` are unchanged ✓; no timeline authority is introduced ✓.

**The assertions that carry it** (`P06 resolves a clip without a place as the native does and refuses a
disagreement`): an omitted place with a plan of zero succeeds; an omitted place with a non-zero plan is
refused; an explicit place that agrees succeeds; an explicit place that disagrees is refused; and a
stated place that is not a number, is not finite or is negative is refused rather than defaulted.

**The parity with the real consumer** (`P06 places a clip without a place where the pinned consumer
places it`): the case loads the **approved module's own** `filmShape` and `layoutTracks` from
`var/native-hydration-r2/managed-native-expected/dist/native-pure-library.mjs` — the same approved
artifact the loader verifies — and compares the consumer's own block start with the reader's resolution.
It is the pinned consumer that is called, not a second handwritten formula.

### 8.1 The caption scope, as MAIN ruled it

The created producer writes **one** `.vtt` per narration and no translation
(`native-draft-assembler.ts:84-92`); that translation branch is therefore **unreachable for this
producer's input range**, and that is documented as a fact about *this* chain — not a claim that
OpenFilm has no translations, and not a waiver of the reader's dependency on the directory listing.
The reader still supplies the platform's raw directory order to the consumer, still refuses a
translation the committed source does not have (the R03 case), and the reachable caption consumption
and the negative closure are proved by the F02 case (a proved absence accepted, its later birth
invalidating the proof) and by the reader's per-ledger dependency checks.

## 9. Amendment 5 — the pure gate 080 ran, two cases failed, and both were real defects

Pure gate `N1N2-RESUME-PURE-007` (command 080, exit 1, **14 passed / 2 failed / 34 filtered**, raw log
`c7623a026aa4fae0e234b47a32ce95d4d210c8acab3d5e749ca69818874a2a18`) showed that two of my new pure
cases did not prove what they claimed — MAIN's pre-grant review had predicted exactly this.

1. **A file that grows under the read was not refused.** The read *resolved* with the grown content:
   the closure compared the device and the inode but not the **size**, so a file that grew after it was
   retained was read as if it were the file the closure took. The closure now compares the size with the
   size recorded at the retention and refuses a changed file (`NATIVE_CLOSURE_MEMBERSHIP_MOVED`).
2. **The N-th open failure fired at the wrong allocation** and the case asserted a generic code. The
   injection now names **one** allocation (the walk's own directory), the primary cause and every
   cleanup cause are asserted, and the case closes the descriptor the injected release left open.

MAIN's further limits are applied as well: the **cumulative** text case now uses two texts that are each
under the limit — the first is read, reading it again is not counted twice, and only the second crosses
the sum (so the closure now counts what it **holds**, each file once, rather than every read); the
**depth** case now asserts the **open** as the admission failure rather than assuming a silent
truncation; the **N-th open** case asserts the primary cause and all the cleanup causes at a named
allocation; the **missing duration** case now covers a duration that is genuinely **absent**, one that is
**invalid** and one that is zero; and **EMFILE, ENOMEM and EACCES** are injected at their own layers with
the primary cause kept — the injection is labelled as a stand-in for a platform failure, not as one.

The pure gate is therefore requested again on the corrected bytes before any heavy command.

## 10. Amendment 6 — the pure gate 083 ran, MAIN's preflight corrections, and the allocator audit

Pure gate `N1N2-RESUME-PURE-008` (command 083, exit 1, **14 passed / 3 failed / 34 filtered**, raw log
`2d2a6a577176d36146385ecc4c2deed2842a2ba6254a1362b152973863e2b0d2`) showed three more real defects, and
MAIN's review of them was right on every count.

### 10.1 The three failures of 083 and the correction each one caused

1. **The identity fence was not a fence.** The read compared the device and the inode but not the size
   and not the change times, so a file that **grew** after it was retained was read as if it were the file
   the closure took. The fence is now real and it is on **both** sides of the read: before the read the
   file must be the very file that was retained (device, inode, size **and** change times), after the read
   the same is checked again, and the content digest must equal the digest that was retained. A grown
   file, a same-size rewrite with a restored change time, and bytes changed under the read are all
   refused (`NATIVE_CLOSURE_MEMBERSHIP_MOVED`).
2. **The text budget counted the reads, not the held bytes.** The budget now counts what the closure
   **holds**: each file once, with the file's own contribution **replaced** rather than added, so a
   repeated read of a text that was read already does not cross the sum while a second, distinct text
   does. The case builds two texts of known length and computes the limit as the longer text plus a
   margin, and asserts that the limit is above the longer text and below the two together, so it proves
   accumulation rather than one oversized file.
3. **The cleanup causes were overwritten.** They are **merged** now, and never overwritten: a later
   cleanup does not erase the ones before it. The enumeration's own open failure and the root's open
   keep the cause that stopped them — the injected `EIO` was being lost.

### 10.2 MAIN's preflight corrections of msg_f314672d4476, all applied

1. **Every owned open goes through the budgeted allocator.** The verification walk no longer calls
   `openSync` directly; it goes through `#openDescriptor`, which **reserves** the descriptor before the
   open and **releases the reservation** when the open fails. The audit of every `openSync` in the file
   now shows exactly two call sites: the root's own open, which happens before the closure exists and is
   counted once at construction, and the one inside `#openDescriptor` itself. The counter is owned per
   **allocation**, not per number: `#reserveDescriptor` refuses **before** the open with
   `NATIVE_CLOSURE_BUDGET`, so the closure never reaches `EMFILE`; `#closeOwned` is the only decrement; a
   failed release latches the closure uncertain and is kept in `cleanupFailures`.
2. **The descriptor-budget case asserts the admission refusal and then a measured baseline.** The
   `maxDescriptors:2` open is outside, so it is refused at the admission with `NATIVE_CLOSURE_BUDGET`. The
   baseline then measures the **peak** of live allocations with an injected opener and closer, sets the
   cap to `peak+1`, asserts **inside** the opener that the live count never exceeds the cap, and retains
   the named later allocations one at a time until one of them is refused with `NATIVE_CLOSURE_BUDGET`.
3. **The P07 keeps cases arm both injection hooks only after the closure has opened**, and assert that
   the injection **actually fired**, so no case can pass on a failure that never happened. The other P07
   release cases close the descriptor **first** and inject the failure afterwards, so no descriptor number
   is left open and none is closed twice. The primary error and every injected cleanup cause are both
   asserted.

### 10.3 The P09-01 allocator corrections of msg_2e126697ffe6 and msg_2541f00d4706, all applied

The root is counted as one successful owned allocation before the ancestry is retained. The legacy double
counting in `#directoryRecord` and `retainFile` is gone — the allocator already reserves. The verification
walk allocates nothing once the closure is uncertain. The root's `lstat` catch, the enumeration's
`readdir` catch and the child's `lstat` catch all keep the syscall that stopped them.

### 10.4 Two further causes of the same class, found by the audit and fixed before the request

Every owned open site that caught a failure was **relabelling** it, and in three of them the relabelling
masked the **budget refusal** — this closure's own protection — behind a code that says something else:

| the open | the code it used to report | the code it reports now |
|---|---|---|
| the ancestry | `NATIVE_CLOSURE_ANCESTOR_INVALID` | `NATIVE_CLOSURE_BUDGET` for the budget, the cause kept otherwise |
| the enumeration's child directory | `NATIVE_CLOSURE_UNSUPPORTED_TYPE` | `NATIVE_CLOSURE_BUDGET` for the budget, the cause kept otherwise |
| the retained directory record | `NATIVE_CLOSURE_UNSUPPORTED_TYPE` | `NATIVE_CLOSURE_BUDGET` for the budget, the cause kept otherwise |

One rule now covers all three: the budget refusal keeps its own code, and every other failure keeps the
syscall that stopped it as its cause. The retained file's `ENOENT`/`ENOTDIR` mapping keeps its cause too,
and the invalid-UTF-8 refusal keeps the decode failure that caused it.

### 10.5 What is requested now, and what is not chained

The **pure gate only**, once, through the unchanged recorder, with the sources frozen until it terminates:
`n1n2-claude-resume-093-gate-pure` — `corepack pnpm exec vitest run --config vitest.config.ts
tests/agent-driven/integration/created-native-source-reader.test.ts -t "P0|F01|F10 lists|F10 keeps"`,
seventeen pure cases, thirty-four component cases and the three legacy files filtered out. The compile
evidence is `n1n2-claude-resume-092-tsc-budget` (exit 0, empty log). The **heavy component gate** and the
**legacy regressions** are **not** chained: they are asked for separately, with fresh hashes, once this
pure gate is green.

The 080 and 083 runs and their cleanup receipts are preserved with their real exits. No capture was
overwritten and no failing capture was re-run under its own name.

## 11. Amendment 7 — the pure gate 093 ran and is green, and one description of it was wrong

### 11.1 The actual outcome of 093

`N1N2-RESUME-PURE-009` (command `n1n2-claude-resume-093-gate-pure`): **exit 0**, **17 passed / 0 failed /
34 skipped**, Test Files 1 passed (1), duration 11.73s. Raw log
`5b365d6eba647a2fd65b30bc32f5ce4d6b41b467e5631d1ebd7818583732b7d1`. The recorder's `result.json` reports
`exit 0`, `source_changed []`, `source_added []`, and the **624** recorded inputs were re-hashed after the
command terminated: **no drift**. The compile evidence is `n1n2-claude-resume-092-tsc-budget` (exit 0, empty
log `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`).

### 11.2 The correction to my own report of it

My first report of 093 said that "the thirty-four component cases **and the three legacy files** are the
skipped ones". That conflated two different things. 093 selected **one file** — `created-native-source-
reader.test.ts` — and selected seventeen of its fifty-one cases. The **34 skipped** are the thirty-four
component cases **of that file**: they ran and were filtered out of the report. The **three legacy files
were not selected at all**: they are three other files, they were not in the vitest invocation, and their
names appear **zero** times in 093's log. A skipped case is a case that was filtered out of a run; a file
that was never selected is not a skip.

The counts, the exit, the log digest, the input set and the cleanup receipt are unchanged. What changes is
what the legacy regressions are: on these bytes they are **NOT_RUN**, not "skipped" — their last real run
was capture 036, on the older bytes.

### 11.3 The cleanup receipt of 093

`docs/parallel/lane-product/A-R2-20261112/N1N2-native-source/n1n2-claude-resume-pure009-cleanup-evidence.txt`,
sha256 `9d74b353c7bd0f2af7482844af5463acf9fde2a32b0f9865c085c6ea533038a8`. It says plainly that **the pid
of 093's own shell was not captured during the run** — the recorder records the argv, the cwd and the start
time, not the pid of the shell that launched it — so no value is invented for that field. It claims only
what this shell's view showed, and not a global absence, a descriptor leak elsewhere or a per-resource
lifetime test.

### 11.4 What is requested next, and what is not chained

The **heavy component gate** is requested separately, on the same ten bytes, under the fresh name
`n1n2-claude-resume-094-gate-component`, selecting the thirty-four component cases with the filter
`R0|F02|F03|F04|F05|F06|F07|F08|F09|F10 shows` — the exact complement of 093's selection. It starts the
local `ffmpeg` and `ffprobe` as short-lived children, and it uses a Host and a sqlite database in the
test's own temporary space. The **legacy regressions** are requested behind it under the reserved name
`n1n2-claude-resume-095-gate-legacy`, over the three legacy files. The two names do not collide and neither
grant is chained to the other.

A green pure gate is **not** the whole of N1N2: it is not an independent review, not a NativeAck, not a
Studio or native-UI readiness, not an A-film result, not a human acceptance, and not a completion claim.
