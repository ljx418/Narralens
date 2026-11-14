# N1N2 — the per-case requirement mapping, with every omitted obligation marked

Child: task_5dcbe8192764 / dispatch ctx_e5e736e1846b / terminal term_b4006907-19df-46dd-ae99-34909d8de5e6
Candidate under audit: the ten released paths at the digests in
`n1n2-claude-resume-handback.md` §1. The candidate is **frozen** for the existing independent audit;
no source change and no test run was made after it was handed over.

The requirements are the approved ones:
`R2/native-source-composition-design/DEVELOPMENT_AND_ACCEPTANCE.md` (R01–R07) and
`R2/native-source-composition-implementation/N1N2_IMPLEMENTATION_TICKET.md` (the N1/N2 entity
contract). The cases are the ones in
`tests/agent-driven/integration/created-native-source-reader.test.ts` (26) and the three existing
regression files (107 assertions).

**Every case below was actually run.** The evidence is the capture named beside it. A requirement
that no case covers is written as **NOT_RUN** or **UNPROVEN** — never as "covered by the design".

## 1. The R01–R07 matrix of the approved design

| requirement | case | evidence | outcome |
|---|---|---|---|
| **R01** real creation + producer + controlled adoption → a committed source; two independent trees; digests, rights, producer graph and clip ids consistent; the reader proves; the legacy unknown project is still refused | `R00 smoke reaches the reader…`, `R00 smoke commits a rich source…`, `R01 refuses the legacy project…` | capture 035 | **PASS** |
| R01 — the *rich* layout specifics (the box, the style and the volume of the created source) | — | — | **NOT_RUN**: the fixture's storyboard carries a concept page, a video and a narration, but the layout box, the style and the volume are not separately asserted |
| **R02** the same bytes under a new inode, the parent moved, a symbolic link, a same-size write with the change time restored; the change during the proof and before the cached read; everything refused; the descriptors owned | `P07 refuses a symbolic link, a same-bytes replacement and a restored change time`, `R02 invalidates the old proof…`, `R02 refuses a pending round when the working copy changes during the read` | captures 034, 035 | **PASS** |
| R02 — the *parent directory* moved under a replaced parent | — | — | **NOT_RUN**: the closure retains the ancestry above the root and verifies it, but no case moves a parent directory |
| R02 — the timing before the **Context**'s cached read | — | — | **NOT_RUN / out of scope**: the Context port and its final fence are N3/N4; this release does not wire the Context, so that timing cannot be exercised here |
| R02 — "**0 Ack rows**" | — | — | **NOT_RUN / out of scope**: no Ack is written by this release at all; the Ack path is N3/N4. The absence of Ack rows here is not a claim of this release |
| **R03** added or removed style, settings and markers; a media-side `.vtt` and a language translation; a missing directory that appears, including an empty one; a changed listing order or membership; every negative and directory dependency fails | `R03 refuses a sidecar, an unknown item and a missing committed file`, `P07 proves an empty directory and sees the file that appears in it`, `R06 lists the media in the native numeric order` | captures 034, 035 | **PASS** for the sidecar, the unknown item, the missing committed file, the empty directory and the listing order |
| R03 — the media-side `.vtt` and the language-translation variants | — | — | **NOT_RUN**: the fixture's narration has a `.vtt`; a *translation* `.vtt` is not exercised |
| R03 — a *membership* change (a file added) during a read | — | — | **NOT_RUN**: the during-read case replaces a file (an identity change); an added file is not exercised during a read |
| **R04** a `.film/id` that does not match; unknown metadata; a probe cache with the same key and a forged duration or audio; a legitimate cache that arrives late; a file in flight; the unknown refused, the legitimate one invalidating the old proof and the next stable round proving it | `R04 refuses a foreign native id, a forged probe cache and a file in flight`, `R04 accepts a legitimate cache in the next stable round`, `R03 refuses a sidecar…` (the unknown metadata) | capture 035 | **PASS** |
| R04 — the forged **audio** field of a probe cache | — | — | **NOT_RUN**: the reader compares the audio flag as well, but the case forges the duration only |
| R04 — the `posters`, `frames`, `waves` and `pageframes` cache families | — | — | **NOT_RUN**: the reader classifies all of them by the upstream's own key and pairing rules (handback §7), but no case produces them, because no native page was rendered in this release |
| **R05** a real ffprobe over a retained descriptor, field by field against the upstream `derived.probe`; the subtitle or trim length never substituting; a change during the probe; a slow, hung or abrupt child; the cancellation waiting for the real exit | `R05 proves the media facts of the retained bytes`, `R07 lets the real media child exit before the reader closes`, `R02 refuses a pending round…` | capture 035 | **PASS** for the facts, the child's real lifecycle, the descriptor's lifetime at the child's exit and the change during a real probe |
| R05 — the **authorised Chinese** recordings and videos | — | — | **NOT_RUN**: the fixture's media is diagnostic (a 320×180 three-second colour video and a three-second sine tone). This is the A-material gap and it is **not** claimed |
| R05 — the parent directory moved *during* the probe | — | — | **NOT_RUN** |
| R05 — the hung child beyond the 30 s deadline | — | — | **NOT_RUN**: the deadline is implemented, but no case waits it out |
| R05 — the **rotated** video, whose shown sides the upstream swaps a quarter turn | — | — | **NOT_RUN**: the reader's normalisation applies the upstream's rotation rule (the `side_data_list[].rotation` or `tags.rotate`, and the swapped width and height), but the fixture's video is not rotated, so no case observes the swap |
| R05 — a subtitle length that disagrees with the real duration | — | — | **NOT_RUN as a case**: the reader never derives a duration from a subtitle, so the behaviour is structural, not case-covered |
| **R06** the five pinned `native_rev` vectors; the real numeric collation of `video2` / `video10` / non-ASCII; the caption directory's own order kept separately; the same host's locale and ICU evidence | `P06 reproduces the five pinned native revision vectors`, `P06 lists the media in the numeric order of the host`, `R06 lists the media in the native numeric order`, `R06 places every clip where the committed film places it` | captures 034, 035 | **PASS** for the vectors, the numeric collation (with the pinned hidden-name filter) and the real listing and placement |
| R06 — the **caption** directory's non-sorted order, end to end | — | — | **NOT_RUN**: the reader hands the pinned consumer the *retained* listing, whose order the platform returned, and the closure's listing preserves it — but no case asserts a caption directory whose order differs from a sort |
| R06 — the **implicit placement** compared against the pinned consumer's own arithmetic | — | — | **UNPROVEN, explicitly unresolved**: the case compares the reader's placement with the film's own `at` values. Where a clip states **no** `at`, the reader uses the producer plan's frame range and cross-checks it against the film when the film states one; that implicit case is **not** compared against the pinned consumer's own placement arithmetic, and this release does not claim it is |
| **R07** the n-th open fails; ENOMEM / EMFILE / EIO / EACCES; the text, descriptor and output budgets; a constructor or verify throw; the first close fails; a close re-enters; the primary error and every cleanup error preserved; the sticky refusal of a new proof; every resource attempted; a raw descriptor never retried | `P07 refuses a text file above the budget and bounds the total`, `P07 refuses to release while work is in flight and releases every allocation once`, `P07 keeps the failure of the walk release with the failure that stopped it`, `P07 refuses a reentrant release from inside an accepted read`, `R07 refuses a later read after a delivered release failed` | captures 034, 035 | **PASS** for the budgets, the refused release, the per-allocation ownership, the never-retried number, the walk-close failure and the re-entrant close, and the sticky refusal of a later read |
| R07 — ENOMEM / EMFILE / EIO / EACCES as injected syscall outcomes | — | — | **NOT_RUN**: the release path is the same all-attempt one, but those specific errno outcomes are not injected |
| R07 — the **output** budget of the probe (4 MiB stdout, 256 KiB stderr) | — | — | **NOT_RUN**: the caps are implemented in the reader; no case makes the tool produce that much |
| R07 — the n-th open failing part-way through a large tree | — | — | **NOT_RUN**: the enumeration's own release failure is exercised, but not a mid-tree open failure |

## 2. The N1/N2 entity contract of the ticket

| the ticket's requirement | case | outcome |
|---|---|---|
| **N1** the retained closure with real parent/leaf ownership, the stream hashing, the synchronous verify, the positive/negative/ordered listings and the sticky all-attempt cleanup | the eight `P07`/`P06` cases | **PASS** for the ownership, the hashing, the verify, the listings and the cleanup; the *negative* lookup and the *ordered* listing are exercised through the reader's own facts |
| **N1** the opaque `VerifiedNativeFactsLease` bound to the committed producer, rights and graph, acquired without an unbounded media read | `R01 refuses the legacy project…`, `R02 refuses a facts lease of another authority`, `R05 proves the media facts…` | **PASS**: the lease is instance-registered, a foreign authority's lease is refused, and the media is hashed with a bounded stream |
| **N1** the issued-view registry, the private `acquireExpectedLease`, the invalidation of the old proof without deleting a live native root | `R02 keeps parallel leases independent…`, `R02 invalidates the old proof…`, `R02 releases the whole closure only after the last retained leaf` | **PASS**: the release of one lease does not revoke the ref, the old proof is invalidated by a change, and the root is never deleted by the reader |
| **N1** the reader's `readSource({binding})`: the immutable baseline, two independent retained trees, the film's own bytes and revision, the fixed consumers, no observed UI data | `R00 smoke reaches the reader…`, `R06 places every clip where the committed film places it`, `R05 proves the media facts…` | **PASS** |
| **N2** the same-FD media probe with the fixed ffprobe, the bounded output and time, the child's real exit before the descriptor is released | `R07 lets the real media child exit before the reader closes` | **PASS**: the probe runs against the parent's own retained descriptor, the descriptor is **live at the child's exit** and released only afterwards |
| **N2** the resource responsibility transferring to Expected on success and staying with the reader on failure | `R02 releases the whole closure only after the last retained leaf`, `R07 refuses a later read after a delivered release failed` | **PASS** |
| **N2** the native cache classification, the probe cache never being authority | `R04 accepts a legitimate cache in the next stable round`, `R04 refuses a foreign native id…` | **PASS** for the probe cache; the other cache families are classified but **NOT_RUN** (see R04 above) |

## 3. The unresolved item, stated plainly

**The implicit placement comparison against the pinned consumer is UNPROVEN.** The reader places a
clip that states no `at` by the producer plan's frame range, and cross-checks that range against the
film whenever the film states a place. The pinned consumer's own arithmetic for an unplaced clip was
not compared against it by any case, and this release does not claim that they agree. MAIN's
earlier review raised exactly this, and it remains open.

The related open item is the cache rule for a **media file replaced in place**: its cache entry is
no longer bound to any media file of the project and is therefore refused. That is the fail-closed
reading of the approved table, it is MAIN's to rule on, and it is stated in the handback §7 rather
than smoothed over.

## 4. What was preserved

Every failing capture is kept with its actual exit: `n1n2-claude-001` … `036`, including the
compile exits of 2 and the batch runs 008, 017, 018, 019, 021 and 022. The metadata correction
(the closure digest that once carried a stray character) and the after-freeze test-file change are
both recorded in the mail history and in `n1n2-claude-resume-batch-followup-001.md` §7 and §9a.
No scope was reduced and no failure was re-run under its own name.

## 5. The frozen state at the handback

```
7421eedae0a9a4b2c028ac705adb376e64697cf0cf7ce40745dcbe4a7035d2a6  src/host/agent-driven/committed-snapshot-authority.ts
b57bed5df0ea600a2aa1a5b2dc3df2873f794389ee5274f32efb52a6f3d653ad  src/host/agent-driven/created-native-workspace.ts
19110e45a83b6d5b611b4260620ce873f923f1e5a5b907bc6176c4b734fbeed3  src/host/m5/openfilm-native-expected.ts
6f5dd97ba9095c1cd8733b57dc75d27bd25ebd5b87fc715d567de5be8aa60b22  src/host/agent-driven/retained-native-closure.ts
93fb70c468af3649e0265d6fa1905d3833ecf413f787ff7db938ebd25e78b1cd  src/host/agent-driven/created-native-source-reader.ts
439d469032c9af2b83ceb826e0aead7cf5c2fe5c5693be7cbf18c8e67f0f615f  tests/agent-driven/integration/created-native-workspace.test.ts
bfd0c6373b254050d32a6a99e7b6f8b9827dc24b6b2587515ab4c5aad2cd9037  tests/agent-driven/integration/committed-snapshot-host.test.ts
5f50db85c7c07a2ecf4faefc20ec2ec6c7ad4910fafe549c2edc76bbad729c7c  tests/agent-driven/integration/created-native-ack.test.ts
7f270b9fbb61ad0fe39646e7dc89822c4428667031adb4ef9c2664b52a89320e  tests/agent-driven/integration/created-native-source-reader.test.ts
9a648b146095a2075505c9fbf7f024935f72c71d9e081ede6310d9d3fa0ea109  tests/agent-driven/integration/helpers/native-source-fixture.ts
```

HEAD and base `e2eff61b464d75d36598103d718cd2a75db5dfda`; the git index is **clean** (this child
never added, committed, reset, stashed or checked out anything); the protected `AGENTS.md` is
`37300463a72a612ae16e0a5fcfb496502c57c722b83781e0e2e8c9480594542b` and untouched.

**Bounded ownership evidence**: every command's launcher, recorder and vitest worker are absent,
and no media-tool process and no fixture tmpdir are present, in this shell's view at the recorded
moments — `n1n2-claude-resume-batch-cleanup-evidence.txt` sha256
`5dd29dbb189292e0cb1d9b85af3e8eafd0977b266dae6cbf4837b730bf560ad1` and
`n1n2-claude-resume-smoke011-cleanup-evidence.txt`. Those receipts state exactly what the view
showed and do **not** claim a global absence of processes or directories, a descriptor leak into
another process, or a per-resource lifetime test of the closure, the leases or the descriptors.
Every slot of this task — `N1N2-RESUME-SMOKE-001`, `-002` and `N1N2-RESUME-BATCH-001`, `-002`,
`-003` — is released with its receipt.

**No `worker_done` is sent for the whole of N1N2 on the strength of green selected tests.** The
single-writer identity of this child stays in place until MAIN hands it back explicitly.
