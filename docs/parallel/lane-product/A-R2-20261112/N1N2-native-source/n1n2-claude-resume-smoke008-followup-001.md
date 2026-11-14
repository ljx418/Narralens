# Append-only follow-up to the smoke 008 diagnosis — hash corrections and the byte deviation

Child: task_5dcbe8192764 / dispatch ctx_e5e736e1846b / terminal term_b4006907-19df-46dd-ae99-34909d8de5e6
This note **appends** to `n1n2-claude-resume-smoke008-diagnosis.md`; it does not overwrite it, and no earlier mail or history is changed.

## 1. The wrong hash in my earlier mail (my error)

My message `msg_6ca1b9a3426b` carried the diagnosis document's sha256 as
`9d1cf7e2b0f9c9f4d4ee9d2f0e1b4f8bd8f2c8f36e0e4bb1a2a0b0b0b0b0b0b0`, which was a **placeholder I had typed into a message body and never replaced with a computed value**. It was not a hash of any file. The real digest of the document at the moment MAIN verified it was

```
2247df47b45f849969f3dc525bc695afc1e92663a3e1a99891a5fc383eeccedc  n1n2-claude-resume-smoke008-diagnosis.md
```

which is what MAIN computed independently. Only recomputed digests are reported from now on; the placeholder is recorded here as the mistake it was.

## 2. The document has since been corrected, so its digest moved

PRODUCT's read-only review (msg_2fd6d2987ef4) required three corrections to the *claims* of the diagnosis. I applied them to the document, so its digest changed again:

```
0bb240f060a640eccf4ccb70aadcbb0f80277b2dd268c7e432c79eed57d006bc  n1n2-claude-resume-smoke008-diagnosis.md   (current)
2247df47b45f849969f3dc525bc695afc1e92663a3e1a99891a5fc383eeccedc  n1n2-claude-resume-smoke008-diagnosis.md   (what MAIN verified)
```

What changed in the document, and nothing else:

1. **The refusal reason is now labelled as inferred, not observed.** The log of capture 008 contains `expected 'unsupported' to be 'hydrated'`; it does **not** contain the approved module's reason. The document now says plainly that the duplicate-media-fact cause is a **static diagnosis from the source**, that the exact 008 reason was not logged, and that the corrected capture will confirm or refute it and say so either way.
2. **The lifecycle claim is narrowed.** The document no longer says the descriptors, byte identity, digests and membership "were all proved"; it says the happy path's `verify()` and `verifyClosure()` passed, and that **one** happy-path verification is not a proof of the negative invariants — the R02/R03/R04/R07 drift, absence, budget and cleanup cases remain unproven and unrun.
3. **The placement question is carried forward as an open item.** Where a film states no `at` at all, the reader uses the producer plan's frame range; that implicit case must be **validated against the pinned native consumer** in R06, and the final evidence must state which of the two the reader followed. It is not settled by this capture.

## 3. The one test byte that moved after the freeze — and why

The **product code under test did not move**: `src/host/agent-driven/created-native-source-reader.ts` is still

```
858ecfdf608b39bddc303d6c3b6ae950d2bf2ceb76dbfa3a132987c7d0b47a04
```

which is the byte MAIN verified and the byte the granted slot `N1N2-RESUME-SMOKE-002` names. The **test file** changed, because PRODUCT's same review required it and I applied the requirement after the request went out:

```
0f270944d5adeb7fa5d9e1c975df31c73fce6bcec9d1a98b0cc3a1a0d2d22bb1   (what MAIN verified)
a0e7eafc0186fc0d220ce5deba82f6e6d8efadb8737802012c2c8d763f92ad1c   (current)
```

The change is confined to the test's own cleanup, and it is a **strengthening**:

- the facts are now released **all-attempt** when anything fails *before* the expected service takes them (the loader or the service construction can throw before the port is ever called, and those retained handles would otherwise be orphaned);
- the test's `finally` no longer hides a cleanup failure behind a sequential chain — every owner (the expected service, the still-owned facts, the fixture) is attempted even when an earlier one fails, and the primary failure keeps its place with the cleanup failures attached to it;
- **no assertion changed**: the four part assertions still demand `hydrated`, the diagnostic reason and input summary are still carried in the failure message, and nothing was weakened to accept `unsupported`.

The other eight released paths are byte-identical to the digests MAIN verified:

```
7421eedae0a9a4b2c028ac705adb376e64697cf0cf7ce40745dcbe4a7035d2a6  src/host/agent-driven/committed-snapshot-authority.ts
b57bed5df0ea600a2aa1a5b2dc3df2873f794389ee5274f32efb52a6f3d653ad  src/host/agent-driven/created-native-workspace.ts
19110e45a83b6d5b611b4260620ce873f923f1e5a5b907bc6176c4b734fbeed3  src/host/m5/openfilm-native-expected.ts
c5c311c99bfcdb547e3e4fc61787f26e499dfb15ec14e736eeba90fd6b85378b  src/host/agent-driven/retained-native-closure.ts
439d469032c9af2b83ceb826e0aead7cf5c2fe5c5693be7cbf18c8e67f0f615f  tests/agent-driven/integration/created-native-workspace.test.ts
bfd0c6373b254050d32a6a99e7b6f8b9827dc24b6b2587515ab4c5aad2cd9037  tests/agent-driven/integration/committed-snapshot-host.test.ts
e0b3c6985819618cb70af7970b18b8c3e993834ff5b9237af0c00b7ae8a0aa95  tests/agent-driven/integration/created-native-ack.test.ts
98c07c98b20cc4660f81f05e7713f8b97032eaa41071966a90e43a112c1c70e9  tests/agent-driven/integration/helpers/native-source-fixture.ts
```

HEAD `e2eff61b464d75d36598103d718cd2a75db5dfda`, git index clean, protected `AGENTS.md` `37300463a72a612ae16e0a5fcfb496502c57c722b83781e0e2e8c9480594542b` untouched.

The capture records the **actual** digest of every input in its own `.inputs.json`, so the bytes that really ran are unambiguous there whatever this note says.

## 4. The cleanup claim is narrowed, as required

My earlier cleanup report asserted, unqualified, that the process listing was empty and that all fixture tmpdirs were gone. That was **this shell's view at that moment**, and it is not a proof of a global absence of processes or descriptors. The corrected statement is recorded with its raw output in
`n1n2-claude-resume-smoke011-cleanup-evidence.txt`, and it is labelled exactly as observed:

- the recorded `ps` line for the run's own recorder pid and test pid shows both **absent**;
- the recorded listing shows **no** process matching `ffprobe|ffmpeg|vitest|narralens|openfilm` **in this shell's process view at that moment**;
- the recorded listing shows **no** `/tmp/narralens-*` path **in this shell's view at that moment**;
- what is **not** claimed: that no such process or directory exists anywhere on the machine, that no descriptor of the run leaked into any other process, and that the machine is free of media tools.

The same narrowing applies to the post-run evidence of the corrected capture: it will be captured raw and labelled the same way.

## 5. The pre-edit version of the diagnosis is preserved, byte for byte

MAIN asked that no earlier version be lost. The version that MAIN verified (`2247df47…`) had been edited in place before this note was written, so it is now also kept as its own file:

```
2247df47b45f849969f3dc525bc695afc1e92663a3e1a99891a5fc383eeccedc  n1n2-claude-resume-smoke008-diagnosis-2247df47.md
```

That file is the byte-exact earlier content: reversing the two claims edits on the current document reproduces exactly this digest, which is what proves the preservation is exact and not a paraphrase. The current version stays at `0bb240f060a640eccf4ccb70aadcbb0f80277b2dd268c7e432c79eed57d006bc`. Both are kept; neither replaces the other, and the earlier mail that carried the placeholder hash is left as it was sent.
