# N1N2 — HANDBACK update from the implementation child

Child: task_5dcbe8192764 / dispatch ctx_e5e736e1846b / terminal term_b4006907-19df-46dd-ae99-34909d8de5e6
cwd of every command: `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration` (WSL)
Base and HEAD: `e2eff61b464d75d36598103d718cd2a75db5dfda`. The candidate is **frozen** for the
coverage auditor `ctx_1cb85a138c29`: no source or index edit and no further command or test was
made after it was handed over. This child keeps its single-writer identity until MAIN hands it back.

**State: `N1N2_INTERNAL_EVIDENCED` — component evidence only.** Not an independent review, not a
NativeAck, not a Studio or native-UI readiness, not an A-film result, not a human acceptance. The
whole of N1N2 is **not** called complete, and the counts below are not offered as a completion
claim.

## 1. The exact ten paths and their digests

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

The git index is **clean** — this child never added, committed, reset, stashed or checked out
anything. The protected `AGENTS.md` is `37300463a72a612ae16e0a5fcfb496502c57c722b83781e0e2e8c9480594542b`
and untouched. MAIN owns any scoped Git freeze commit.

## 2. The requirement → case → evidence mapping

The full mapping, with every omitted sub-requirement marked **NOT_RUN** or **UNPROVEN**, is in
`n1n2-claude-resume-requirement-mapping.md`. Its structure: for each of the approved design's
R01–R07 and for each of the ticket's N1/N2 entity obligations, the named case that covers it, the
capture that proves it, and the outcome. The summary:

| requirement | covering cases | capture | outcome |
|---|---|---|---|
| R01 the real chain, the two independent trees, the legacy refusal | `R00 smoke reaches the reader…`, `R00 smoke commits a rich source…`, `R01 refuses the legacy project…` | 035 | PASS |
| R02 the same bytes under a new inode, the symbolic link, the restored change time, the change during the proof and during a real probe | `P07 refuses a symbolic link…`, `R02 invalidates the old proof…`, `R02 refuses a pending round…` | 034, 035 | PASS |
| R03 the sidecar, the unknown item, the missing committed file, the empty directory, the listing order | `R03 refuses a sidecar…`, `P07 proves an empty directory…`, `R06 lists the media…` | 034, 035 | PASS |
| R04 the foreign native id, the forged probe cache, the file in flight, the legitimate cache in the next stable round | `R04 refuses a foreign native id…`, `R04 accepts a legitimate cache…` | 035 | PASS |
| R05 the media facts against an independent probe, the real child's lifecycle, the descriptor's lifetime, the change during a real probe | `R05 proves the media facts…`, `R07 lets the real media child exit…`, `R02 refuses a pending round…` | 035 | PASS |
| R06 the five pinned revision vectors, the numeric collation with the pinned hidden filter, the real listing and placement | `P06 reproduces the five pinned…`, `P06 lists the media…`, `R06 lists the media…`, `R06 places every clip…` | 034, 035 | PASS |
| R07 the budgets, the refused release, the per-allocation ownership, the never-retried number, the walk-close failure, the re-entrant close, the sticky refusal | the five `P07` cases, `R07 refuses a later read…` | 034, 035 | PASS |
| the legacy regressions | the three existing files, 107 assertions | 036 | PASS |

## 3. The sub-requirements that are NOT_RUN or UNPROVEN

These cannot be inferred from the titles above and are stated here so that no reader of a green
count mistakes them for covered work.

**NOT_RUN** — the parent directory moved under a replaced parent; the Context's cached-read timing
(the Context port is N3/N4 and is not wired here); "0 Ack rows" (no Ack is written by this release
at all — the Ack path is N3/N4); the media-side `.vtt` and the language-translation variants; a
membership change during a read; the forged **audio** field of a probe cache; the `posters`,
`frames`, `waves` and `pageframes` cache families (the reader classifies them by the upstream's own
key and pairing rules, but no native page was rendered here, so no case produces them); the
**authorised Chinese** recordings and videos (the fixture's media is diagnostic — a 320×180
three-second colour video and a three-second sine tone — and the A-material gap is **not** claimed);
the parent moved during the probe; the hung child beyond the 30 s deadline; the **rotated** video,
whose shown sides the upstream swaps a quarter turn (the rule is implemented, the fixture's video is
not rotated); a subtitle length that disagrees with the real duration (the reader never derives a
duration from a subtitle, so the behaviour is structural rather than case-covered); ENOMEM / EMFILE /
EIO / EACCES as injected syscall outcomes; the **output** budget of the probe (4 MiB stdout,
256 KiB stderr); the n-th open failing part-way through a large tree; the R01 rich layout specifics
(the box, the style, the volume); the caption directory's non-sorted order end to end.

**UNPROVEN, explicitly unresolved**: the **implicit placement** compared against the pinned
consumer's own arithmetic. The reader places a clip that states no `at` by the producer plan's
frame range and cross-checks that range against the film whenever the film states a place; no case
compares that implicit case with the pinned consumer's own placement arithmetic, and this release
does not claim that they agree. MAIN raised this, and it is open.

The related open item, for MAIN to rule on: a cache entry whose media was **replaced in place** is
no longer bound to any media file of the project and is therefore refused — the fail-closed reading
of the approved table. This release does not ignore `.film` wholesale and deletes nothing.

## 4. The evidence that is retained

Every prior failed capture is kept with its actual exit: `n1n2-claude-001` … `036`, including the
compile exits of 2 and the batch runs 008, 017, 018, 019, 021 and 022. No capture was overwritten and
no failing capture was re-run under its own name.

The **011 freeze deviation** is retained and not smoothed over: the test file was changed once
*after* a freeze request, it was reported immediately, and the actual bytes that ran are recorded
in `n1n2-claude-resume-batch-followup-001.md` §7 and §9a, together with the metadata correction
(the closure digest that once carried a stray character — the real digest is in §1 and equals what
capture 033 froze).

## 5. The bounded ownership evidence and the slot return

Every command's launcher, recorder and vitest worker are absent, and no media-tool process and no
fixture tmpdir are present, **in this shell's view at the recorded moments**:
`n1n2-claude-resume-batch-cleanup-evidence.txt` sha256
`5dd29dbb189292e0cb1d9b85af3e8eafd0977b266dae6cbf4837b730bf560ad1` and
`n1n2-claude-resume-smoke011-cleanup-evidence.txt`. Those receipts do **not** claim a global absence
of processes or directories, a descriptor leak into another process, or a per-resource lifetime test
of the closure, the leases or the descriptors.

Every slot of this task — `N1N2-RESUME-SMOKE-001`, `-002` and `N1N2-RESUME-BATCH-001`, `-002`,
`-003` — is released with its receipt. No command of this child is running and no child of it is
running. No `worker_done` is sent for the whole of N1N2 on the strength of green selected tests.

## 6. The two documents this handback rests on

- `n1n2-claude-resume-handback.md` — the implementation handback: the diff and the digests, the
  per-case outcome, the commands and their evidence, the existing behaviour that is protected, the
  rollback, the resources handed back, and the cache rules with their upstream sources.
- `n1n2-claude-resume-requirement-mapping.md` — the requirement → case → evidence mapping, with
  every omitted adversarial obligation marked.
