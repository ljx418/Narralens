# Independent scoped transport review

**PASS — scoped transport only. BLOCKER: 0; MAJOR: 0; MINOR: 0.** No reproducible source defect was identified in this bounded review. This is not approval of application producers, frontend experience, all R0/A work, or human acceptance.

Reviewed frozen commit: `cca95020ee4ede16ef133ecd6e08b6a27632adaa`.
Comparison input: held PRODUCT commit `df32311ce86193aa91db4535776d833358680013`.
Checkout: `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`.
Date: 2026-11-11. Independent reviewer task: `task_3c9a957f1215`; dispatch: `ctx_1869a3ba7f26`.

This context did not implement the transport change. I inspected the three specified files, their exact diff against the held bytes, relevant unchanged native paths, and the frozen evidence directory. HEAD was the requested commit and Git status was empty at start and final verification. Git object bytes equal the inspected working files. No source/index/branch changes, tests, builds, Host/browser/media processes, credentials/config reads, external calls, or helpers were used. Only this canonical report was written.

## Source conclusions

- **Purpose and owner isolation:** native and UI proofs use separate maps, cookie names/secrets and header names. UI minting checks project, owner-session and generation against the native grant. UI authentication rejects native credentials and bearer substitution, validates Host/origin and duplicate security headers, and checks its own live delegate. A stale native revision does not revoke a still-current UI delegate. The closed call envelope/registry rejects unknown operations; a conflicting string project_id is rejected before invoke. Remaining DTO validation, actual principal authority and ownership of opaque media refs belong to the trusted Host delegate, not to client claims. This review does not infer those production delegates exist or are correct.
- **Post-await revocation:** invokeUi checks before and after the delegate call. openUiMedia checks before opening and after the awaited result; a rejected post-open check closes the unreturned reader. The returned read wrapper checks before and after each asynchronous read. Gateway additionally checks before sending each chunk, after reads, and before HEAD/end. Revocation during a pending first read produces refusal before media headers; revocation after an earlier valid chunk causes an incomplete response rather than a falsely complete body. Previously transmitted authorized bytes cannot be recalled.
- **Cancellation and ownership:** request abort, premature response close and Gateway close feed the media AbortController. awaitUiOperation rejects a cancelled consumer without abandoning a late open result: the late reader is closed, not read or returned. In-flight read completion/rejection remains observed after consumer cancellation. The returned close wrapper memoizes one promise, so repeated closure cannot invoke the underlying close twice. Gateway finally releases an obtained reader and removes listeners/tracking. Late-open cleanup is eventual when the provider resolves; the implementation does not claim to force an unresolved provider to finish or retry a failing provider close.
- **Bounded streaming:** the old chunks array/Buffer.concat path is removed. The loop requests at most UI_MAX_READ_BYTES per read, validates the returned byte length, writes one chunk and waits for drain when write returns false before requesting another. There is bounded chunk/copy/socket buffering, not an entire-object accumulator. Drain listeners are removed on drain, error or abort. Descriptor byte count/hash/ETag are checked before headers, and Range/HEAD use the same descriptor. The transport trusts the verified reader for content authenticity; ETag shape checking is not independent whole-object hashing.
- **Truncation:** a bad first read fails before media headers. A later wrong-size read, revocation or read error unwinds through reader close and #accessFailure destroys an already-started response. The advertised full Content-Length is not silently reduced to the bytes already sent, and no error JSON is appended to a partial media body. This is the appropriate observable failure for streaming.
- **Old native behavior:** the diff against df32311 changes the UI media operation and cancellation/streaming helpers plus Gateway media cancellation on close; it does not widen the old native API/write/read-token or film-origin paths. Existing native grant rechecks and project/native-ID enforcement remain separate. Recorded affected regression adds evidence for capacity, real native entry and child replacement behavior without expanding this review into the underlying application.

## Test assertions and evidence

I read the 28-test transport file and the recorded command/result/log artifacts, without rerunning them. The first 21 cases retain separate-credential, real duplicate-header socket, origin, stale-native/live-UI, revoked UI, closed envelope/registry, project conflict, DTO forwarding, exact bytes/ETag, range and late-revocation-close assertions. Seven added cases exercise read-time revocation before headers, truncation after a prior chunk, late-open disconnect cleanup, disconnect during a pending read, shutdown/listener closure, HEAD without reads, and early first-byte delivery/disconnect on a virtual 64-MiB object. Deferred promises control the lifecycle boundaries; these are more specific than success-only HTTP assertions.

Recorded results, with log SHA256 recomputed and matched to the frozen result records:

| Evidence | Recorded result | Meaning |
|---|---|---|
| transport-main-run1 | 28/28, exit 0, inputs unchanged | Real loopback HTTP transport with stub Studio and fixture delegates/media |
| native-affected-regression | 34/34 in 3 files, exit 0, inputs unchanged | Includes the same 28 plus 2 capacity and 4 existing native-entry tests; not 34 additional tests |
| negative-old-implementation | Exit 1, 2 failed / 26 skipped | Old df32311 returns 200 instead of 409 after read-time revocation and reads all 64 chunks before first delivery; both causal regressions are detected |
| typecheck-result | Recorded tsc --noEmit terminal exit 0 | MAIN typecheck evidence; this separate record does not itself contain input hashes, so it is not an independently reconstructed exact-byte run |

The negative-control record binds the old production-file hashes, keeps the expected nonzero result, and records exact restoration. The subsequent affected-regression record binds both current source files and the current test hash, matching this frozen commit. MAIN_ROOT_CAUSE_REVIEW retains the earlier 1/1/1/0 fixture history and states implementation/self-validation separately from independent review.

Coverage limits are explicit: the virtual video uses fixture descriptor metadata and proves flow, not content integrity. The final transport suite has no dedicated wrong-size-read case or repeated-wrapper-close assertion; those branches were source-reviewed, not claimed as newly demonstrated runtime cases. The backpressure test proves delivery starts before reading the whole object and stops after disconnect, not a measured heap ceiling. The shutdown test checks aggregate gateway.isListening and probes refusal at the editor endpoint; it does not separately probe the film endpoint. cleanup-observed records absence of specified test PIDs and terminal commands, not absence of unrelated machine services. None of these limits establishes a source counterexample or a new release gate.

**Disposition:** the frozen transport correction passes this independent bounded source/evidence review. No corrective work is required by this review. Actual BRIDGE dispatcher/MEDIA reader integration, frontend UI behavior and A acceptance remain outside this PASS. Changes to the three bound files require an appropriate delta review.

## Exact reviewed file hashes

| File | Frozen SHA256 | Held df32311 SHA256 |
|---|---|---|
| `src/host/m5/controlled-studio-access.ts` | `8d8825ea2392dec02040e728579abd522d202bb4fe56a027fba9515c0fa68ac6` | `9f10ba2748a77a66d0537d0915f272c80ed0913ebbfb28a4aa647a22e5d89b70` |
| `src/host/m5/openfilm-studio-gateway.ts` | `451e0ba8e8c2013f2eff429b66e57a2d62659b97d86e9fff809e32f50a11f2a2` | `8be50e04acaf0993f8f0b1c8cf917982ff455f3bff5f54a4cba16065c8d6865b` |
| `tests/agent-driven/integration/created-native-ui-transport.test.ts` | `45ff1305610632ed0870e5c6cb96242737dc6a123fe3300012dd5eb1c2307fd1` | `64821d8052a81fabbbffcda8b4f9d2ad4d295ae22f71c41e6c6866a4dcdd3be7` |

## Frozen evidence hashes

| Artifact | SHA256 |
|---|---|
| `MAIN_ROOT_CAUSE_REVIEW.md` | `76648c4d4c4888f8ffc86cdd5e0a4d69d50ccd5d43aee3dea0ef321494d860c0` |
| `TAKEOVER.json` | `0a0348e8e97627889349844856b8611c15d0997b4a1084c5570d72833cba8de3` |
| `cleanup-observed.json` | `852b3b8f239b182f5977eadecb2d953c2144e7d2415d206bc1498f4a165fb7c9` |
| `inputs.json` | `dd2ed2151787c43f64082e2a78cf6f99072b84670a9cd9a07a5eeb98364dcd06` |
| `native-affected-regression.cmd.json` | `320c2ef611889cdf28c929b2784be3bb0f742bcb4b947ff6c1465111099b2e64` |
| `native-affected-regression.result.json` | `4e09a09ec606df0706db0349e73d673640310931c9ea6ce995e78aa0408b0ef5` |
| `native-affected-regression.txt` | `2b565d4ae653729c028ac0561432a6e66a062703b7872a1e3abdf9b626e2962b` |
| `negative-old-implementation.result.json` | `12c8a3d7ba80021bb1fe912e329fc6dcd91cc8b21d5a5d07eadf15bda7501b94` |
| `negative-old-implementation.txt` | `cdf2926705d394a6771322221f22af651b4d3aca43dd4c96b4fb916355a4b403` |
| `transport-main-run1.cmd.json` | `ff46604134c9ad57449f37d8f22d7f05bd9f47971edc775a84ef4eaf199dcccd` |
| `transport-main-run1.result.json` | `f36d532bf0d173bd2a54a2819a8e91c410157153485cf1d430d07ef7e9ca2734` |
| `transport-main-run1.txt` | `25197a8c42d30df8d0b8503233f1d71f02911dd64bbf07d87b19e5ac12025799` |
| `typecheck-result.json` | `3523977802b48d0555ffdc7737f4939c9e5298338a2538f07599013a230d750e` |
| `verification-status.json` | `43ac4b3baf14ac35349eda4b7148053a4b9c01afc78bd28f39fdf91227bbf714` |
