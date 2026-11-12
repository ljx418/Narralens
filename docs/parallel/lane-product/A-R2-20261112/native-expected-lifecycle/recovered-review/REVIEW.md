# Recovered PRODUCT lifecycle supervision — CHANGES_REQUIRED

Task task_61570c14c644, resumed dispatch ctx_4d693c4345da. No new Claude launched; no implementation/source/test/index writes. This is parent supervision, not an independent review signature or NativeAck/A pass.

## Exact candidate and checks

HEAD a809f8d7e53fb90dbd1f56aa956c48c9600d508f. Source SHA256 dd458df139cfcf913b76e4d8050291ab84fdcb3fe4723c569f8327650b5b04c5; test SHA256 329def412b417fb69408382c0fdd5807bebe20044bf74860d700d396a5ddb382. Both equal MAIN reboot archives and remain unchanged after checks. All 42 PREFLIGHT protected files match. Index is clean. Exact dirty/untracked inventory, commands, exit statuses and hashes are in RECEIPT.json.

Current exact test file: 73/73 pass; tsc --noEmit exit 0. Historical round3 logs show 5 failed + 67 passed on candidate2, then 72/72 passed on corrected candidate; they do NOT establish a historical 73-test same-byte pair. The extra current case checks a binding changed during prove, not one changed during assertCurrent. The preserved corrected3 source archive also differs from current source: current adds final HELD_FACTS identity and instance checks; archive source SHA256 f7e85d02b92aba5e8b179bfe6236100583e59fd17b14475de0ee63b7d3ef0cc3, archive test SHA256 47965687189b237baa5155327d1ca4348f58409e3a062360858a6c48de21b640. Thus historical 72-pass evidence cannot be relabeled as the current candidate. Original baseline and earlier failure logs remain intact; no old-source swap was performed during this review. Historical round3 command/input attestation is incomplete after interruption; do not invent missing exit/hash receipts from log success text.

## Blocking findings reproduced on this candidate

1. P1 — src/host/m5/openfilm-native-expected.ts:730 reads facts.verifyClosure AFTER the terminal closed/fault guard. A property getter can call service.close() before the new proof is registered. prove then resolves a newly registered proof on the closed service, with close count 0 and its real fd still open. A later explicit cleanup in the probe closes it, but the original close did not own/clean the late-registered proof. Capture this callback before final private admission; allow no external getter/callback after admission.
2. P1 — src/host/m5/openfilm-native-expected.ts:770–791 checks the binding snapshot only BEFORE external verifiers. Each of isCurrent, verifyClosure and the last retained-file verify can mutate project_id from p1 to p2 and return true. assertCurrent then returns the p1 projection while binding is p2, with no error. Recompare binding fields after external work and before the terminal private guard as MAIN reentrancy design explicitly requires. Account for getter side effects in ordering; do not simply add external reads after the private guard.

Review-only reentrancy-probe.mts uses controlled loader/source ports (unsupported projection), six real temporary file descriptors, and cleanup in finally. Its exit 1 is expected evidence of four reproductions across the two defects, not a production test failure claim. Positive controls verify closure-callback release is rejected as PROOF_RELEASED and last-file-callback close is rejected as CLOSED; those fd closures are verified. No mocks are represented as upstream runtime/NativeAck evidence.

## Ownership and limits

MAIN supplied same-host kernel-reboot proof for predecessor death; old429 dispatch is stopped/exited. No PRODUCT Claude was running in the local census. Available lifecycle logs contain no 429 match; this is not proof of historical absence across missing terminal output. No provider/config/credentials read, no retry, no source fallback, no Host/browser/media/build/install/network run. Keep candidate and all failures; no freeze/PASS requested for this defective candidate. MAIN must consolidate the third-correction root cause and explicitly transfer source ownership before any further Claude implementation. Codex remains source/index read-only.
