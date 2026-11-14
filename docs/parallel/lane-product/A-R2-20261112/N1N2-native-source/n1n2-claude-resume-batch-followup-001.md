# N1N2 — batch N1N2-RESUME-BATCH-001 terminal report and the corrected batch

Child: task_5dcbe8192764 / dispatch ctx_e5e736e1846b / terminal term_b4006907-19df-46dd-ae99-34909d8de5e6
cwd of every command: `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration` (WSL)
HEAD/base: `e2eff61b464d75d36598103d718cd2a75db5dfda` — git index clean — protected `AGENTS.md` untouched.

## 1. The three granted commands, terminal identities and results

| command | shell pid | start → end (UTC) | recorder exit | result | raw log sha256 |
|---|---|---|---|---|---|
| A `n1n2-claude-resume-017-batch-pure` | 979111 | 06:37:16 → 06:37:54 | 1 | 2 passed / 5 failed / 15 filtered | `a94348421d081a401176f81d92ddfb4629c6a009a1bc89144979250f79ea3921` |
| B `n1n2-claude-resume-018-batch-component` | 980705 | 06:38:29 → 06:42:23 | 1 | 14 passed / 1 failed / 7 filtered | `360ade92e1cc02e404123e4d545ac819bb33ed7a2cd8f1ceb195ff1533d3711e` |
| C `n1n2-claude-resume-019-batch-regressions` | 987200 | 06:42:51 → 06:44:42 | 1 | 82 passed / 24 failed | `d8f638c0b85fe8bf7b825bb9fb7b993e0fa44aa7358bbc33842b8861abdd42bc` |

All three: `source_changed []` and `source_added []` — **no input drift**. All three captures are
preserved exactly; none was overwritten. The batch mapping is **A 2P/5F, B 14P/1F, C 82P/24F**,
and **no gate is inferred from it**: the full N1N2 gate remains unproven, and the independent
review of this candidate is still outstanding and is not mine to perform.

## 2. Owned-resource cleanup and the slot return

Recorded raw in `n1n2-claude-resume-batch-cleanup-evidence.txt`, sha256
`c457ab963f681a0f4d2aada4512696c00b461c3605f73dcd749051849487200f`:

- the recorder, the vitest launcher and the vitest worker of **each** of the three commands are
  **absent** in this shell's process view after the command terminated;
- no process matching `ffprobe|ffmpeg|vitest|narralens|openfilm` was found in **this shell's
  view** at those moments;
- no fixture tmpdir (`/tmp/narralens-created-workspace-*`, `/tmp/narralens-committed-read-*`) was
  present in **this shell's view** at those moments.

What this receipt does **not** claim: it is not a proof that no such process or directory exists
anywhere on the machine, not a proof that no descriptor of the runs leaked into another process, not
a proof that the machine is free of media tools, and not a per-resource lifetime test of the
closure, the leases or the descriptors.

**Slot N1N2-RESUME-BATCH-001 is returned.** No command of mine is running and no child of mine is
running.

## 3. What each failure actually was

**Command A — five failures, all in my test expectations, and in every one the product was right:**

1. *the restored-mtime write* — I asserted the per-file guard stays `true`; it correctly became
   `false`. The write changed the bytes **under the descriptor the closure holds**, so the byte
   proof fails. The correct oracle is the stronger one: `verifyFile` must be `false`.
2. *the refused release* — I never started the accepted operation before asking for the release,
   so nothing was outstanding and no refusal was due. A test omission.
3. *the injected walk-close failure* — I expected the **close** to fail; the walk's own release
   failure correctly aborts the **open**, with the failure kept in `cleanup_errors`. My expectation
   was on the wrong call.
4. *the five revision vectors* — I wrote the vector files **after** `closure.open`, so they are
   correctly not members of the tree the closure took. The files must exist before the open.
5. *the listing order* — my expected order was invented ("video before clip"); the product's order
   is the pinned collation of the **whole relative path**, so `assets/clip/…` comes first because
   the directory names decide, and `video1 < video2 < video10` because the numbers are compared
   numerically.

**Command B — one failure, again my expectation:** I replaced the working copy's `film.html` with a
**same-bytes** copy and then expected the *next read* to be refused as drifted. But the bytes are
still the committed bytes, so a fresh read legitimately succeeds; what actually breaks is the
**existing proof**, whose `verifyClosure()` correctly became `false`. MAIN's ruling is that a
same-bytes/new-inode replacement invalidates the old proof and any pending read, while a fresh,
fully revalidated stable round may succeed with independently retained new identities.

**Command C — 24 failures, and here the defect was mine in the production path's fixture:** the
loader change requires the approved module to export `parseProjectSettings` and `parseMarkers`, and
the strict loader refused the candidate with `NATIVE_EXPECTED_BUILD_UNSUPPORTED` — which is the
correct behaviour. The `created-native-ack.test.ts` *generated stand-in* module did not export them,
so every case that loads that stand-in failed. **The production loader was not weakened**: the
stand-in was brought up to the same contract, and a dedicated negative case for a module *without*
the two exports was added so the new guard still bites.

## 4. The two product defects that were real, and their fixes

1. **The accepted operation was invoked before it was registered** (`#admit`). The body of an
   operation runs synchronously up to its first await, so a release asked for *from inside* it
   would find nothing pending and would destroy the very descriptor the operation was about to
   use. The registration now happens **before** the operation is invoked, and it settles and is
   removed exactly once. A Host-private synchronous read observation makes this reachable from a
   case, and the new case proves it: under the old shape the release would proceed and the read
   would fail on a closed descriptor; under the fix the release is refused with
   `NATIVE_CLOSURE_BUSY` and the read still completes, and the closure is still whole.
2. **The reader did not verify the trees before it delivered the facts.** A change *while* the read
   was in flight would have been delivered as if it had not happened — two epochs mixed in one
   round. The reader now verifies the committed source and the working copy before delivery and
   refuses the round with `NATIVE_SOURCE_CLOSURE_MOVED`. A new case replaces the working copy's
   file **during a real media probe** — the barrier is the real tool reading a retained descriptor
   of this process — and the pending round refuses.

## 5. The corrected batch

Same three commands, same classifications, same effects, with the corrected bytes.

**A — pure FS** (`-t "P0"`, eight cases):

```sh
python3 docs/execution/A/implementation-20261111/integration/e1-main-takeover/run-recorded.py \
  n1n2-claude-resume-021-batch-pure \
  corepack pnpm exec vitest run --config vitest.config.ts \
  tests/agent-driven/integration/created-native-source-reader.test.ts -t "P0"
```

**B — heavy** (`-t "R0"`, sixteen cases):

```sh
python3 docs/execution/A/implementation-20261111/integration/e1-main-takeover/run-recorded.py \
  n1n2-claude-resume-022-batch-component \
  corepack pnpm exec vitest run --config vitest.config.ts \
  tests/agent-driven/integration/created-native-source-reader.test.ts -t "R0"
```

**C — the existing regressions** (every case of the three files, unchanged):

```sh
python3 docs/execution/A/implementation-20261111/integration/e1-main-takeover/run-recorded.py \
  n1n2-claude-resume-023-batch-regressions \
  corepack pnpm exec vitest run --config vitest.config.ts \
  tests/agent-driven/integration/created-native-ack.test.ts \
  tests/agent-driven/integration/committed-snapshot-host.test.ts \
  tests/agent-driven/integration/created-native-workspace.test.ts
```

Frozen inputs:

```
7421eedae0a9a4b2c028ac705adb376e64697cf0cf7ce40745dcbe4a7035d2a6  src/host/agent-driven/committed-snapshot-authority.ts
b57bed5df0ea600a2aa1a5b2dc3df2873f794389ee5274f32efb52a6f3d653ad  src/host/agent-driven/created-native-workspace.ts
19110e45a83b6d5b611b4260620ce873f923f1e5a5b907bc6176c4b734fbeed3  src/host/m5/openfilm-native-expected.ts
1ecf01eee5ea0107c441fba72821a5a7f240ef63596b6031927f7be0f8ee7bd0  src/host/agent-driven/retained-native-closure.ts
aabcb1545df6c04f8d16c73f2630514da2b465367e0da7f9f771243231db7ff1  src/host/agent-driven/created-native-source-reader.ts
439d469032c9af2b83ceb826e0aead7cf5c2fe5c5693be7cbf18c8e67f0f615f  tests/agent-driven/integration/created-native-workspace.test.ts
bfd0c6373b254050d32a6a99e7b6f8b9827dc24b6b2587515ab4c5aad2cd9037  tests/agent-driven/integration/committed-snapshot-host.test.ts
5f50db85c7c07a2ecf4faefc20ec2ec6c7ad4910fafe549c2edc76bbad729c7c  tests/agent-driven/integration/created-native-ack.test.ts
678c63d806844ef1e6319c44c5459d9f2c8819ab00dcd961314348bac1e607d0  tests/agent-driven/integration/created-native-source-reader.test.ts
d6d719f1c2c7deddd900b6b2372c840ed515da26df92c16c16c1791ea4a9c322  tests/agent-driven/integration/helpers/native-source-fixture.ts
```

Compile evidence for these bytes: `n1n2-claude-resume-020-tsc-fixes`, argv
`corepack pnpm exec tsc --noEmit`, cwd main-integration, actual exit **0**, log sha256
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (empty log). Compile is not
behaviour evidence.

Nothing else is requested or run: no full suite, no build, no browser, no network, no provider, no
paid action, no J drive, no old-Gate migration, no package or lock change, no index mutation.

This batch is component evidence only: no human acceptance, no native UI load, no NativeAck, no
Studio session, no A-film, no independent review.

## 6. Append-only update to the corrected batch — the R07 oracles

Two defects in the R07 cases of the new test file, both found by MAIN's review of the live bytes
and both fixed **before** any corrected batch was granted. No prior request, capture or result was
rewritten.

1. **The pid mix-up.** The FD path's directory component is the **parent** process, while the
   child's event carries the **child's** pid; the two were compared against each other. The case
   now captures the started event's `{pid, argument}` as two separate identities, asserts that the
   argument's parent is this process (`process.pid`), and compares the exit event against the
   captured **child** pid.
2. **The descriptor's lifetime at the child's exit.** The ordering `exit < close-returned` did not
   test when the held input was released. The case now observes, in the child's own exit callback,
   that the descriptor it was reading was **still held**, and then that it is **released only
   afterwards**.

The late-authority case no longer sleeps: the close is started and left **pending**, the authority
is resolved **independently** while the close is outstanding, the late result's release is awaited
through a deferred the release itself resolves (so the assertion is exact-once with no elapsed
time), and the owner's close is awaited **afterwards**.

New sha256 of the one changed path — the other nine are byte-identical to the request above:

```
5a73ed32da64e5cab2ebe8ca54285d48984d8a7e53a6ee40652cef37b267b8fd  tests/agent-driven/integration/created-native-source-reader.test.ts
```

Compile evidence for these bytes: `n1n2-claude-resume-025-tsc-r07fix`, argv
`corepack pnpm exec tsc --noEmit`, cwd main-integration, actual exit **0**, log sha256
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (empty log).

The three commands are exactly the ones requested: `n1n2-claude-resume-021-batch-pure` (`-t "P0"`),
`n1n2-claude-resume-022-batch-component` (`-t "R0"`) and `n1n2-claude-resume-023-batch-regressions`.

## 7. Append-only update — the owner's drain and the delivered-failure latch

MAIN's ruling on the live bytes, applied before any grant. Three paths changed; the other seven
are byte-identical to the request above.

1. **A cancelled caller is not a quiescent owner.** The reader now tracks the *underlying*
   acquisition until it really settles: the caller's wait ends at once when the reader closes,
   while the close stays pending until the dependency has ended. A late result is released by
   that one owner, exactly once, and a failure of that release is kept, latches the reader's
   uncertainty and makes the close report the real cleanup state instead of a silent success.
   The reader's close now rejects with the retained cleanup failures.
2. **A delivered release that failed latches the reader.** Every cleanup failure inside the
   ownership transfer latches the uncertainty *before* any release is attempted, so a later read
   is refused with the actual uncertainty instead of being admitted.
3. **One owner, one attempt.** Before the delivery the owner belongs to the reader and is
   released once, draining the work in flight first; after the delivery the owner travels with
   the handles and goes with the last of them. The failure path no longer releases the same
   allocation a second time.

The reader's admission is also registered **before** the read is invoked: the read calls the
binding's own callbacks, and one of them may close the reader — the close must find the read
admitted rather than return while it is still running.

Two oracles were added for these: one where a binding callback closes the reader and the close
is proved to return only after the read settled, and one where a delivered release fails and a
later read is refused for the actual uncertainty.

```
7930beba9469f79b28e864a0a7781e886bd0d83b5d408ad691533d7b9736a074  src/host/agent-driven/created-native-source-reader.ts
```

(the test file and the fixture changed with it; their digests are in the message to MAIN)

Compile evidence: `n1n2-claude-resume-032-tsc-oracles`, argv `corepack pnpm exec tsc --noEmit`,
cwd main-integration, actual exit **0**, log sha256
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (empty log).

The three commands are unchanged: `n1n2-claude-resume-021-batch-pure`, `-022-batch-component`
and `-023-batch-regressions`.

### 7a. The final digests of the three changed paths

The reader's digest in section 7 was taken before its last one-line correction (the owner
release inside the transfer's handle). The digests that the request carries are:

```
ee0ece61b6f2252f4c908217c57437e0dbdcab3076b96f3ab6740b90d6cac107  src/host/agent-driven/created-native-source-reader.ts
78b9a752fba083409d2719247f9fce5827bfdb57187d2bfe4e563b972dfa6f13  tests/agent-driven/integration/created-native-source-reader.test.ts
9a648b146095a2075505c9fbf7f024935f72c71d9e081ede6310d9d3fa0ea109  tests/agent-driven/integration/helpers/native-source-fixture.ts
```

The other seven released paths are byte-identical to the request above, and
`1ecf01eee5ea0107c441fba72821a5a7f240ef63596b6031927f7be0f8ee7bd0` is still the closure.

## 8. Corrected batch N1N2-RESUME-BATCH-002 — terminal results and the three fixes

All three commands are terminal and serial, all preserved, none overwritten:

| command | shell pid | start → end (UTC) | recorder exit | result | raw log sha256 |
|---|---|---|---|---|---|
| A `n1n2-claude-resume-021-batch-pure` | 1057699 | 07:01:53 → 07:02:18 | 1 | 6 passed / 2 failed / 18 filtered | `ccc6ac29b697f69bdf52931de560c9eaa88c0032dd1cec3ea4676f82bef3362c` |
| B `n1n2-claude-resume-022-batch-component` | 1059874 | 07:02:46 → 07:06:11 | 1 | 17 passed / 1 failed + 1 unhandled / 8 filtered | `58f3114a15ce4c69cc60a4e718b879b983e88a13989a1a54a816b4837d727a13` |
| C `n1n2-claude-resume-023-batch-regressions` | 1090112 | 07:06:56 → 07:08:43 | **0** | **107 passed**, 3 files | `53bfd698cc978698fabf41ffac3de14d5d5b7d84a4631814d84b2e905cfa0a50` |

All three: `source_changed []` and `source_added []` — no input drift. The owned-resource receipt is in
`n1n2-claude-resume-batch-cleanup-evidence.txt`, sha256
`1141ba9e71c0adbb94c314bc7804c8cb7e6753d1e3ec07b1aa4748dc907a7129`: the launcher, the recorder and the
vitest worker of each command are absent in this shell's view, no `ffprobe|ffmpeg|vitest|narralens|openfilm`
process is present in that view, and no fixture tmpdir is present in that view. It does not claim a
global absence of processes or directories, a descriptor leak elsewhere, or a per-resource lifetime
test of the closure, the leases or the descriptors. **Slot N1N2-RESUME-BATCH-002 is returned.**

The legacy regression file is green again: 107 assertions, including the 84 inherited ones and the
missing-parser negative case. The old smoke, the 011 freeze deviation and every earlier capture stay
as they are.

### The three failures and the one unhandled rejection, and what each was

1. **A — a denied release latched the uncertainty (a product semantic).** The BUSY branch throws
   *before* any descriptor is closed, so nothing was lost and the closure still holds everything it
   took: it can still say so. The refusal no longer latches the uncertainty; only a real cleanup
   failure or an unknown syscall outcome stays sticky.
2. **A — the listing oracle forgot the hidden-component filter.** The product correctly excludes
   `assets/.hidden/secret.mp4`, exactly as the native's own `listFiles` does. The second, supposedly
   independent expectation now applies the pinned hidden-name rule as well as the numeric
   full-relative-path ordering.
3. **B — the read was not fenced after a reentrant callback, and the raw promise was abandoned
   (a product defect and a real unhandled rejection).** The binding's liveness callback may close
   the reader; the read now checks the closed state after every external callback, before any new
   dependency starts, so it no longer reaches the authority after the close. And `#adopt` never
   abandons an already-started raw promise: it always consumes its rejection, registers the
   underlying drain and releases a late result exactly once.
4. **B — the oracle measured the wrong thing.** The settlement marker is now attached to the
   returned promise itself, so the ordering observed is the real one and not the scheduling of an
   assertion's continuation.

### Digests of the changed paths

```
93fb70c468af3649e0265d6fa1905d3833ecf413f787ff7db938ebd25e78b1cd  src/host/agent-driven/created-native-source-reader.ts
6f5dd97ba9095c1cd8733b57dc75d27bd25ebd5b87fc715d567de5be8aa60b22b  src/host/agent-driven/retained-native-closure.ts
7f270b9fbb61ad0fe39646e7dc89822c4428667031adb4ef9c2664b52a89320e  tests/agent-driven/integration/created-native-source-reader.test.ts
```

The other seven released paths are byte-identical to the previous request.

Compile evidence: `n1n2-claude-resume-033-tsc-afterbatch`, argv `corepack pnpm exec tsc --noEmit`,
cwd main-integration, actual exit **0**, log sha256
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (empty log). Compile is not
behaviour evidence.

## 9. Batch N1N2-RESUME-BATCH-003 — terminal, all three commands green

| command | shell pid | start → end (UTC) | recorder exit | result | raw log sha256 |
|---|---|---|---|---|---|
| A `n1n2-claude-resume-034-batch-pure` | 1098146 | 07:13:27 → 07:13:57 | **0** | **8 passed** / 18 filtered | `2df7f22afccda8cba9a772720c125d27c34be3bee265459420a8d7e11bd37eea` |
| B `n1n2-claude-resume-035-batch-component` | 1099899 | 07:14:09 → 07:18:12 | **0** | **18 passed** / 8 filtered | `82d64e914fab5b2371dd77d22e1e5ee82f784d118cd526bab4a354a43aac7da5` |
| C `n1n2-claude-resume-036-batch-regressions` | 1106758 | 07:18:37 → 07:21:12 | **0** | **107 passed**, 3 files | `4c84e9e75dea48f0f68a07380b57bfd2003d24790b0b1c6b895429a30c50f04f` |

All three: `source_changed []` and `source_added []` — no input drift; **no unhandled error**; no
assertion was widened and none was suppressed.

The owned-resource receipt is in `n1n2-claude-resume-batch-cleanup-evidence.txt`, sha256
`5dd29dbb189292e0cb1d9b85af3e8eafd0977b266dae6cbf4837b730bf560ad1`: the launcher, the recorder and
the vitest worker of each command are absent in this shell's view, no
`ffprobe|ffmpeg|vitest|narralens|openfilm` process is present in that view, and no fixture tmpdir is
present in that view. It does not claim a global absence of processes or directories, a descriptor
leak elsewhere, or a per-resource lifetime test of the closure, the leases or the descriptors.

**Slot N1N2-RESUME-BATCH-003 is returned.**

### 9a. Metadata correction — the closure's digest I reported had a stray character

In the message that requested this batch I wrote the closure's sha256 as
`6f5dd97ba9095c1cd8733b57dc75d27bd25ebd5b87fc715d567de5be8aa60b22b` — **65** hex characters, with a
stray trailing `b` from the message body. The actual digest of the bytes that were compiled, frozen
and run is:

```
6f5dd97ba9095c1cd8733b57dc75d27bd25ebd5b87fc715d567de5be8aa60b22  src/host/agent-driven/retained-native-closure.ts
```

which is exactly what capture `033` recorded as its input. **No code changed**; the grant binds the
real 64-hex digest, and the three captures above ran on those bytes.

### 9b. What this batch establishes, and what it does not

The eight pure FS cases and the eighteen component cases pass on the reviewed bytes, and the 107
legacy assertions — including the 84 inherited ones and the missing-parser negative case — still
hold with the changed reader and closure.

It does **not** close the N1N2 gate. It is component evidence: no human acceptance, no native UI
load, no NativeAck row, no Studio session, no A-film, and the independent audit of this candidate
is still outstanding and is not mine to perform.
