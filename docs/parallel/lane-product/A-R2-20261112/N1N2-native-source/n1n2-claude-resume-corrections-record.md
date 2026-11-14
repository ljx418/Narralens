# N1N2 resume — the three released corrections and the minimal product fix

Writer: Claude implementation child, task `task_5dcbe8192764` / dispatch
`ctx_b4086093cd96`, terminal `term_d383bb87-4e85-4090-a651-e24d730f642b`, coordinator
`term_c42901ca-2c06-452f-8f59-085ab98adb8a`. Sole writer of the two released paths.
MAIN is the sole reviewer and document owner.

Every source and test tool ran with cwd
`/mnt/c/workspace/videoworkline/Narralens-agents/main-integration` (WSL).

## 1. The release this child executed

- `resume-claude-20261112/USER_AUTHORIZED_RESUME_AFTER_429.md` — read and ACKed
  (message `msg_293f4f1e8cf3`, answered by MAIN in `msg_2be85db9bded`).
- `resume-claude-20261112/RESUME_PRODUCT_CLEANUP_CORRECTION_RELEASE.md` — the minimal
  additional release of `src/host/agent-driven/retained-native-closure.ts`, read
  before editing.

Baseline, verified by this child before any write:

| item | value |
|---|---|
| HEAD | `e2eff61b464d75d36598103d718cd2a75db5dfda` |
| git index | empty (`git diff --cached` empty) |
| `AGENTS.md` sha256 | `37300463a72a612ae16e0a5fcfb496502c57c722b83781e0e2e8c9480594542b` (protected, untouched) |
| ten released paths | all equal to `NEW_429_STOP_20261112_1008.json` |

No reset, no stash, no checkout, no index write, no commit, no push. The four tracked
dirty files and the six untracked new paths were preserved exactly.

## 2. The three released test corrections

Only `tests/agent-driven/integration/created-native-source-reader.test.ts` was written
for the corrections. No Expected body, no public API, no budget and no other
production file was touched by these edits.

### 2.1 R02 — the refusal of the Expected service is a reason, not a `code`

`src/host/m5/openfilm-native-expected.ts:795` throws
`new Error('NATIVE_EXPECTED_CLOSURE_MOVED')`: the old interface states the reason in
the **message** of the refusal and states no `code` field. The case demanded
`rejects.toMatchObject({code:'NATIVE_EXPECTED_CLOSURE_MOVED'})`, which is why 094
failed with *"expected Error: NATIVE_EXPECTED_CLOSURE_MOVED to match object { Object
(code) }"*.

The assertion is now the exact reason of the old interface: the thrown value is
captured, it is an `Error`, and its message is exactly
`NATIVE_EXPECTED_CLOSURE_MOVED`. It is **not** loosened into "any throw", and the
Expected service was not changed.

### 2.2 F05 — the evidence is bound to every field of its preimage

The old last line was

```ts
expect(digest).not.toBe(media!.proof_digest.replace(/.$/,'0'));
```

which is a **no-op when the last hex digit already is `0`** — it compared the digest
with itself. That was the false failure of 094.

The case now:

- hashes the **actual media bytes** itself, independently of the reader, as a
  **64 KiB stream** (`streamingSha256`, never the whole file in memory), and asserts
  that this digest is the digest of the **returned fact** (`media.source_sha256`) and
  of the **committed fact** (`facts.entries`);
- keeps the real digest equality: the evidence recomputed from the concrete tool
  version, the concrete argv, the concrete input digest and bytes, the concrete file
  identity and the concrete normalised result is the returned `proof_digest`;
- mutates **each** of the seven fields of the real preimage separately — `tool_version`,
  `argv_profile`, `input_sha256`, `input_bytes`, `ledger.dev`, `ledger.ino` and the
  `normalized` preimage — and asserts that every single mutation changes the digest,
  and that the seven mutated digests are pairwise distinct.

### 2.3 R07 / P07 — the named primary and EVERY cleanup cause of a real failing unpack

New pure case, title **`P07 keeps the named primary and every cleanup cause of the
real unpack path`**. The title contains no `R0` substring, so the pure and the
component filters stay mutually exclusive.

It drives the **production** failing path (`RetainedNativeClosure.open` → ancestry →
enumeration), never a hand-made error:

- the **named primary** is the syscall failure that stopped the walk (an injected
  `EIO` with its own message) at the walk's child directory;
- the **child's own release really fails on the nested unwind** — the case does *not*
  let it succeed in order to avoid the defect it is about;
- the ancestry release and the root release fail as well, so **three independent
  cleanup failures** are injected, each at a **named allocation**, each **after the
  real descriptor was closed** (`closeSync` first, the failure afterwards), so no
  descriptor number is left open and none is closed twice.

Asserted:

- the thrown refusal is the production one (`NATIVE_CLOSURE_UNSUPPORTED_TYPE`) and
  the **named primary keeps the first place** in `cleanup_errors`, by identity, with
  its own code `EIO` — it was neither replaced nor overwritten;
- **every** cleanup cause is kept, each by identity, **in the order the releases
  failed**;
- every allocation that was taken was released **exactly once**: the successful opens
  and the releases are matched by the real path of each descriptor, so a number the
  operating system hands out again for another allocation is not mistaken for a retry;
- the **sticky uncertainty**: a failed release latches the closure, `verify()` becomes
  false, a later `retainFile` is refused with `NATIVE_CLOSURE_UNCERTAIN`, and a
  repeated release neither retries the failed allocation nor reports the failure twice.

## 3. The minimal product fix (MAIN released)

`src/host/agent-driven/retained-native-closure.ts` — only the three cleanup catches,
no budget, no media, no public interface, no Expected, no other production entity:

- a new private helper `mergeCauses(error, causes)` merges the cleanup causes into
  the primary with the **existing** `attachCauses` (so the causes that were already
  there are kept) and, when the primary cannot carry them at all, falls back safely:
  the primary becomes the **first** of the causes and the refusal states that the
  release did not finish;
- `#enumerate`'s **recursive** catch no longer replaces the primary with a new
  `NATIVE_CLOSURE_CLEANUP_FAILED`: the failure of the child's own release is merged
  into the primary, which is rethrown as it is;
- `#directoryRecord`'s catch and `retainFile`'s catch no longer overwrite the existing
  causes with a raw `Object.defineProperty`: they use the same merge helper.

The reported asymmetry was confirmed by MAIN (`msg_2be85db9bded`) before this edit.

## 4. Compile evidence (recorded, serial, standing grant)

| capture | argv | exit | log sha256 | note |
|---|---|---|---|---|
| `n1n2-claude-resume-096-tsc-corrections` | `corepack pnpm exec tsc --noEmit` | **2** | `19ea8c2a8adf30260a719cede9cf18d2fde88c45ccd5f51e0f5843874c6effb9` | **real failure of this child**: a brace was misplaced in the F05 edit (`' (another tool)')}` instead of `' (another tool)'}`), a pure syntax error of my own making. Preserved, not overwritten. |
| `n1n2-claude-resume-097-tsc-corrections` | `corepack pnpm exec tsc --noEmit` | **0** | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | empty log; `source_changed []`, `source_added []` — no input drift during the run |

Both captures ran through the unchanged `run-recorded.py` with the unique
`n1n2-claude-resume-` prefix, in the canonical cwd, with the inputs frozen while the
command ran. The failed capture 096 is preserved under its own name.

## 5. Fresh ten-path hashes after the edits

| path | sha256 | changed |
|---|---|---|
| `src/host/agent-driven/committed-snapshot-authority.ts` | `f8470afddb8e8732edb112379902c3e28f51892a0104d6182f13207d473906c9` | no |
| `src/host/agent-driven/created-native-workspace.ts` | `b57bed5df0ea600a2aa1a5b2dc3df2873f794389ee5274f32efb52a6f3d653ad` | no |
| `src/host/m5/openfilm-native-expected.ts` | `19110e45a83b6d5b611b4260620ce873f923f1e5a5b907bc6176c4b734fbeed3` | no |
| `src/host/agent-driven/retained-native-closure.ts` | `b89bd38baa2f7e89b91f91cd7082700ae12672245da5b11a126ba4dba7022ba1` | **yes** — the minimal product fix |
| `src/host/agent-driven/created-native-source-reader.ts` | `b386615cb4036f0ce3d2bc65a5d9aa99ee8bc9c191f3468eb15baf65b2a33aa1` | no |
| `tests/agent-driven/integration/created-native-workspace.test.ts` | `439d469032c9af2b83ceb826e0aead7cf5c2fe5c5693be7cbf18c8e67f0f615f` | no |
| `tests/agent-driven/integration/committed-snapshot-host.test.ts` | `bfd0c6373b254050d32a6a99e7b6f8b9827dc24b6b2587515ab4c5aad2cd9037` | no |
| `tests/agent-driven/integration/created-native-ack.test.ts` | `5f50db85c7c07a2ecf4faefc20ec2ec6c7ad4910fafe549c2edc76bbad729c7c` | no |
| `tests/agent-driven/integration/created-native-source-reader.test.ts` | `bf1a7e3394142a07aa08ea3799fbe9ed3e2e9276ecbc0f6786e945ea40f72b6b` | **yes** — the three corrections |
| `tests/agent-driven/integration/helpers/native-source-fixture.ts` | `19cb73cb9d69394e550699d3363128a4ea60e96a3f28f22e1ea4fce01c6dda0a` | no |

`AGENTS.md` is still `37300463a72a612ae16e0a5fcfb496502c57c722b83781e0e2e8c9480594542b`.
HEAD is still `e2eff61b464d75d36598103d718cd2a75db5dfda` and the git index is still empty.

## 6. The pure / component partition of the test file

The file holds **52** cases. The two filters of MAIN's release stay **mutually
exclusive** and cover **the whole set**:

| filter | cases |
|---|---|
| pure `P0\|F01\|F10 lists\|F10 keeps` | **18** (17 of 093 plus the new case) |
| component `R0\|F02\|F03\|F04\|F05\|F06\|F07\|F08\|F09\|F10 shows` | **34** |
| in both | **0** |
| in neither | **0** |

## 7. What is NOT claimed

Not a completion of N1N2, not an independent review, not a NativeAck, not a Studio or
native-UI readiness, not an A-film result, not a human acceptance. The legacy
regression files are still `NOT_RUN` on these bytes. No business acceptance is
claimed and none is signed by this child.

## 8. Errata of this record (appended)

**Erratum A — a transcription error of mine in the log digest of 097.** In the
messages I sent to MAIN, and in the table of section 4 above, the digest of the
**empty** log of `n1n2-claude-resume-097-tsc-corrections` was typed with
`...4c8896fb...` instead of the actual `...4c8996fb...`. The capture itself was
never wrong: `n1n2-claude-resume-097-tsc-corrections.result.json` records
`"log_sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"`,
and `sha256sum n1n2-claude-resume-097-tsc-corrections.txt` gives the same value
(it is the digest of the empty string, because the log is empty). The table above
now carries the actual value. MAIN pointed this out in `msg_104758de390c`.

**Erratum B — the identity of the 094 writer.** The receipt
`n1n2-claude-resume-094-cleanup-evidence.txt` names the writer of the 094 capture
wrongly in its first paragraphs; those paragraphs are **preserved as they were
written** and an **appended erratum** below them carries the correction: the writer
was dispatch `ctx_e5e736e1846b` on terminal
`term_b4006907-19df-46dd-ae99-34909d8de5e6`, read from `BATCH_010_GRANT.json`,
`NEW_429_STOP_20261112_1008.json` and `CLAUDE_RESUMED_BY_MAIN.json`.
`ctx_283e4028fc76` is the earlier `retry_of` dispatch of the same task.
Current sha256 of that receipt:
`d21e7a508d8d5d414db018b0bb23735e29744e31691ac46e22ef1f0ac2b7ceb5`.

The digest of the 096 log, for the record:
`19ea8c2a8adf30260a719cede9cf18d2fde88c45ccd5f51e0f5843874c6effb9` (exit 2, the
misplaced brace of my own making).

## 9. The deduplication fix and the granted sequence (appended)

**The duplicate cause.** The 098 pure gate failed on the new case with **EXPECTED 4,
RECEIVED 5** (my earlier report had the direction backwards; corrected, and the
correction is appended to the 094/098 receipt too): the refusal's cause list carried
ONE AND THE SAME cleanup failure object twice — once merged into the primary by
`#enumerate`'s recursive catch, and once returned by `#closeAll()` from the closure's
own `#cleanupFailures` ledger, where `open()`'s catch merged it in again through
`attachCauses`. MAIN confirmed the root cause and released the fix
(`N1N2-RESUME-DEDUPE-012`).

**The one line** — the existing `attachCauses` helper of
`src/host/agent-driven/retained-native-closure.ts`, identity based, NOT a message or
code comparison:

```ts
const merged=Array.isArray(existing)?[...existing,...causes.filter(cause=>!existing.includes(cause))]:[...causes];
```

The result is exactly the digest MAIN predicted:
`ab6697759a85c4a0b787ad00ce57b2a25680c5fb9630cf6a7797a10aa775a48e`. The other nine
released paths and `AGENTS.md` are unchanged. No assertion was weakened.

**The granted sequence** (all serial, all through the unchanged `run-recorded.py`,
sources frozen from the one edit to the end of the cleanup):

| capture | argv | exit | result | log sha256 |
|---|---|---|---|---|
| `n1n2-claude-resume-099-tsc-dedupe` | `corepack pnpm exec tsc --noEmit` | **0** | empty log, no input drift | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `n1n2-claude-resume-100-gate-pure` | `vitest run --config vitest.config.ts … -t "P0\|F01\|F10 lists\|F10 keeps"` | **0** | **18 passed**, 34 filtered out | `62c7c84b039019dc1a411e55ca7f3892c641982052456955d90453e97a339a9c` |
| `n1n2-claude-resume-101-gate-component-focused` | `vitest run --config vitest.config.ts … -t "R02 invalidates the old proof\|F05 binds the probe evidence"` | **0** | **2 passed** (the two cases that failed in 094), 50 filtered out | `18857c1d892cc3f8a5e191ac6b560d3c7c1b02853b12ea13c3784b9dc8261fb5` |

Every one of them reports `source_changed []` and `source_added []`: no input drift
while the command ran. The own cleanup receipt of the sequence is
`n1n2-claude-resume-100-101-cleanup-evidence.txt`.

**Ten-path hashes after the whole sequence** — the closure carries MAIN's predicted
digest, the other nine are unchanged:

| path | sha256 |
|---|---|
| `src/host/agent-driven/committed-snapshot-authority.ts` | `f8470afddb8e8732edb112379902c3e28f51892a0104d6182f13207d473906c9` |
| `src/host/agent-driven/created-native-workspace.ts` | `b57bed5df0ea600a2aa1a5b2dc3df2873f794389ee5274f32efb52a6f3d653ad` |
| `src/host/m5/openfilm-native-expected.ts` | `19110e45a83b6d5b611b4260620ce873f923f1e5a5b907bc6176c4b734fbeed3` |
| `src/host/agent-driven/retained-native-closure.ts` | `ab6697759a85c4a0b787ad00ce57b2a25680c5fb9630cf6a7797a10aa775a48e` |
| `src/host/agent-driven/created-native-source-reader.ts` | `b386615cb4036f0ce3d2bc65a5d9aa99ee8bc9c191f3468eb15baf65b2a33aa1` |
| `tests/agent-driven/integration/created-native-workspace.test.ts` | `439d469032c9af2b83ceb826e0aead7cf5c2fe5c5693be7cbf18c8e67f0f615f` |
| `tests/agent-driven/integration/committed-snapshot-host.test.ts` | `bfd0c6373b254050d32a6a99e7b6f8b9827dc24b6b2587515ab4c5aad2cd9037` |
| `tests/agent-driven/integration/created-native-ack.test.ts` | `5f50db85c7c07a2ecf4faefc20ec2ec6c7ad4910fafe549c2edc76bbad729c7c` |
| `tests/agent-driven/integration/created-native-source-reader.test.ts` | `bf1a7e3394142a07aa08ea3799fbe9ed3e2e9276ecbc0f6786e945ea40f72b6b` |
| `tests/agent-driven/integration/helpers/native-source-fixture.ts` | `19cb73cb9d69394e550699d3363128a4ea60e96a3f28f22e1ea4fce01c6dda0a` |

HEAD is still `e2eff61b464d75d36598103d718cd2a75db5dfda`, the git index is still
EMPTY, and `AGENTS.md` is still
`37300463a72a612ae16e0a5fcfb496502c57c722b83781e0e2e8c9480594542b`.

Still NOT run and NOT claimed: the full component gate of BATCH_010, the legacy
regression files (NOT_RUN on these bytes), any build, browser, network, provider or
J-drive access. No business acceptance, no independent review, no NativeAck.
