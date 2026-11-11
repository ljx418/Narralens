# M1 first independent repair

Review ctx6afb/msg_d7427719171c requested fail-closed consistency for supplied files that native listing discovery never consumes. Repair source/test commit: `9e14cbc7cd3348f0c1895e1715089e60d9cf6756`. Original source remains immutable at `25b417556a617267a79b276acb7d39ab516edd00`.

The adapter now compares every supplied file fact whose direct parent directory was queried against that exact listing: a present value must be listed; a null absence must not be listed. It retains existing consumed/media checks, never sorts/reorders listings, does not infer translations from supplied bytes, and does not inspect nested children as if they were direct members. No native algorithms, source pin, license, ts-nocheck, oracle or vectors changed. The docs generator wrapper received the same adapter repair so future generation cannot undo it.

## Exact old failure / new pass

The new tests ran before production edits. SIDECARS_M1_OLDFAIL.json records equality of working production bytes to original25b source, source SHA256 c59ae0d2fa197f4439bb5da883a5674740894981424f37e0fea7e6df1ede15ce, test SHA256 c5f9dd1918370791ab96aadd373a52f63516448d26e02da7231a73c02b82757b, command, exit1 and raw log hash. Result: 2 failed, 25 passed. The two failures were present English translation omitted only from listing, and listed null unrelated direct child not discovered by native code. A third boundary case for nested/unqueried children passed.

The identical test bytes then ran against frozen9e14cbc production: 27 passed, exit0. Final oracle regenerated all13 vectors in memory from actual pinned Git blobs and compared them to the unchanged stored vectors, exit0; project tsc and separate oracle tsc exited0. SIDECARS_M1_VALIDATION.json records full commands, starts/ends, exits, log hashes and all four input hashes before/after, unchanged throughout capture. No validation processes remain from these synchronous completed commands.

These new negatives test the adapter input contract, NOT native parity. Native filmCaptions discovers only names in its virtual listing, so the original oracle accurately computes captions without omitted English; that behavior cannot certify contradictory-input refusal. The adapter must independently refuse inconsistent supplied facts, and now does. Actual oracle algorithms and fixtures remain unchanged.

## Limits and scope

Only the released production/test paths and own ticket docs changed; old failures/evidence/untracked work remain. No child, Host/listener/browser/ffmpeg/build/full suite/probe/network/config/credential/provider/J activity occurred. Existing ts-nocheck caveat remains: tsc does not check generated pinned JS or adapter internals. Pure data output is not source provenance, ExpectedProof or NativeAck; MAIN must still verify/retain inputs, integrate and obtain real acceptance evidence. This is a component repair awaiting independent re-review, not a self-signed pass or full A result.
