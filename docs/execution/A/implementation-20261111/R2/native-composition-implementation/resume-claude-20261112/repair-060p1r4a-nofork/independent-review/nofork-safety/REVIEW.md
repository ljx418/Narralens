# R4A exact nofork independent re-review

**REQUEST_CHANGES** —1 MAJOR and2 MINOR residual findings in the two-file tool/test scope. NF03..NF06 are CLOSED_STATIC; NF01 and NF02 are substantially repaired but retain the precise issues below. The MAJOR is a real post-spawn logging ownership path, not an unmodified production/N-positive issue. The two MINOR findings alone would not justify blocking this fixed, small-transcript nofork launch.

All3 current source/test/report SHA256 and sizes and all25 protected entries matched at entry. Every inspected input is rehashed at the end in INPUTS.json. Historical HEAD `1d348d419120f23f45d958112ea8c43df5a04675` is not a new accepted freeze. Complete1301-line tool and1069-line test were read without importing/running them. No source/test/config/Git/index/old evidence was changed.

## NF disposition and remaining fixes

**NF01 remains open for asynchronous stderr errors.** The new nonthrowing wrappers correctly retain synchronous outcome.json ENOSPC, held.json EIO and final.json failures. The actual main test at802 holds the same live child through failed outcome/held writes and only returns after later exit/close/gone. Preflight evidence failure refuses before spawn. These are real improvements in actual main/runPilot wiring.

The default writeStderr adapter at853 still calls process.stderr.write(text) without an error handler or callback. In main's live HELD branch at1239, try/catch only covers a synchronous throw. A broken stderr pipe can emit EPIPE on a later event-loop turn; an unhandled Writable/EventEmitter error terminates Node and can strand the detached C still waiting for authorization. This is an expected I/O failure inside the tool's reporting route, not the expressly excluded external OOM/kill risk. The injected writer in tests only pushes a string to an array, so it cannot detect this asynchronous path.

Local installed Node stream documentation confirms write errors are asynchronous and emitted as error events; local events documentation confirms an unhandled error event throws/terminates the process. This support was read statically. No stream, child or signal experiment ran. Fix only the standalone reporting boundary and its actual main mock: handle/report errors asynchronously before C is spawned, retain the bounded error alongside the same owner, and never end live responsibility due to reporting failure. No production Host patch, global process kill or responsibility expiry is needed.

A smaller NF01 qualification gap remains at1182: outcome.json failure changes kind to failed but leaves fault_case_passed=true and unexpected_failure=null after an otherwise valid intentional fault. C has already ended in that case, so this is not an orphan issue. Clear/recompute all pass fields and preserve the evidence error in the authoritative result. Expected exit1 must not be accepted from an internally contradictory result.

**NF02 has actual failure latching now.** Child/stdio/control errors, diagnostics overflow and valid decoded-queue overflow all call noteLedgerFailure. Final identity/fault predicates require no unexpected failure and full terminal proof. The actual runPilot tests844/867 prove legal HELLO cannot wash away overflow/control error, with real-shaped terminal cleanup afterward. Valid complete-frame limits64frames/256KiB are enforced; first HELLO is retained.

The decode-error branch is still outside those queue guards: it pushes null for every subsequent failed feed, while createControlDecoder retains and grows its already-invalid buffer. Repeated malformed chunks bypass both bounds. That is a negative parser/ledger-branch defect to fix by terminally failing/resetting the decoder and retaining at most one bounded error marker; do not expand budgets. The fixed reviewed C sends only a small noauthorize transcript, so this review does not invent a real C flood or treat this MINOR as an independent physical launch blocker. Queue byte accounting also does not decrement on takeControlFrame, which is conservative overcounting rather than unbounded valid payload growth.

**NF03 is CLOSED_STATIC for the original defect.** checkTerminalProof at593 is shared by cleanup finalization, runPilot eligibility and main HELD polling. It requires real ChildProcess close plus an exit fact (exit event or the coded/signal close fact), or legitimate no-birth error+close, then fresh gone or original epoch replacement. main no longer exits merely because closePromise was already resolved: it loops with bounded waits and referenced50ms pauses until full proof; it never sends another signal in HELD. Test939 drives actual main through close-already-seen and repeated proc unknown before gone; it verifies no signal and no early return. Close code/signal as an exit fact is consistent with actual ChildProcess semantics; fake events are not evidence of real reaping. Real event ordering remains NOT_RUN.

**NF04 is CLOSED_STATIC.** Null PID no longer dereferences epoch. The runner test977 emits EAGAIN and close/no-exit on the next tick and confirms original error, no-child-confirmed and complete no-birth proof. The old generic CUSTODIAN_CLOSED error no longer overwrites that actual startup error.

**NF05 is CLOSED_STATIC.** The actual verifier explicitly checks fresh PPID against toolPid and recorded PPID at264/268, alongside HELLO parent, spawned PID, independent SID/PGID and exact startticks. Test1005 hits both verifier and runner.

**NF06 is CLOSED_STATIC.** The mandated new report corrects R4 to four failed runs001..004 plus005 green and preserves the old report/captures. MAIN_REPORT_SCOPE_ADJUDICATION explicitly confirms the report was SPEC-authorized; no source waiver, new user approval or report-scope blocker is necessary.

FINDINGS.json contains exact lines, triggers, impacts, minimal two-file corrections and actual-main/ledger counterfactuals. None is labelled a captured old-code failure or a real kernel result.

## Exact nofork authority and cleanup boundary

The tool still only accepts identity/assertion-failure plus expected C SHA; it does not accept arbitrary executable/argv/PID/group/signal. The real spawn path remains fixed Python -I -S -B, detached, fixed stdio and repository cwd. Its child environment is literal allowlisted values plus private HOME/XDG/TMP directories under one mkdtemp root; there is no user env/config read or Host HOME mutation. The fixed interpreter's bytes were read/hashed again and match the required SHA.

There is still no control-channel write call. Protected C's only N-fork admission is AUTHORIZE_FORK, which this tool never sends; it also sends no GO/CANCEL/FINALIZE/RECHECK. Therefore this is a no-N capability/identity slice. Its exact-owned TERM/KILL is permitted only under that structural invariant, and cannot be reused for production C that may own N.

Immediate shared ledger listeners preserve error/exit/close separately. Every allowed signal is to the issued ChildProcess after synchronous noauthorize/exit-code/exit-seen and fresh full epoch checks, with no await between verification and child.kill. No bare numerical PID/group signalling was introduced. PID replacement proves only that the original epoch ended; it gives no authority over the replacement. C stdout/control EOF is not used as process termination.

The reviewed C/manifest/interpreter remain compatible with a direct noauthorize HELLO: private startup hashes and detached identity are checked, SET/GET subreaper occurs before HELLO, and no vendor/browser/media module is needed. Nonzero C exit or exact-owned nofork KILL is not creative failure/success evidence. Actual kernel capability, detached behavior and Node exit/close/reap ordering remain NOT_RUN.

Do not repair or rerun any of the14 production findings to satisfy this narrowly scoped gate. The present refusal is specifically because live ownership can still be lost via the standalone default stderr error path.

## Tests and capture authenticity

main is now imported in the pure test and invoked with injected child/proc/clock/filesystem adapters; entry-guard checking prevents import autorun in the current source. The real spawn/root guard now throws before forwarding to any real implementation, fixing the old after-the-fact counter behavior. The added tests exercise actual main, runPilot, ledger and terminal proof rather than a second oracle.

They still model synchronous evidence writes and synchronous string reporting. Add the async writable error counterfactual for NF01, the already-terminal expected-fault evidence-write failure and repeated post-decode-error data. These are exact boundary tests in the same file, not a request for a real C before approval.

All8 R4A cmd/result/exit/raw-log sets were read and hashed. One recorded test001 is48/49 exit1; test002 and003 are49/49 exit0, and all5 syntax captures are exit0. Raw log hashes agree with result metadata and MAIN_CAPTURE_AUDIT. Early green records with source-input drift are historical, not proof of all current bytes; test003, check-tool003 and check-test002 have no current mismatch in MAIN's audit. Full649 captured-payload comparison remains MAIN's audit rather than a reason to read user/config material. Existing red, green and older UNRECORDED evidence is preserved; no missing historical logs were fabricated.

## Proposed commands and remaining authority

From W only, the future commands remain:

```sh
node tools/native-cache-nofork-pilot.mjs --mode identity --expected-custodian-sha256 6b8d6df32b1958b3cf53e05152e9b04abf6c010d58ae6e672fcd7fa4c9511618
node tools/native-cache-nofork-pilot.mjs --mode assertion-failure --expected-custodian-sha256 6b8d6df32b1958b3cf53e05152e9b04abf6c010d58ae6e672fcd7fa4c9511618
```

- Fixed Python: `/usr/bin/python3.12`, SHA256 `e50d468e8b0adfb05733f5b87b3cff34829c4a8c1aea50c865aa8bdfe4bb150f`.
- Current tool: `bc0a9e112431dc445bb2ac602862879d5446324903e1eee5c60afe613e79de9c`.
- Current test: `d5f426108cbc4472dcc9770c22793efa21c6503903e48f299bd64344cd585ca8`.

These are recorded command boundaries, **not runtime permission**. Correct/review the reporting ownership issue first; MAIN can then issue an exact single-slot ticket independent of production N-positive gates. Identity exit0 is only a verified identity-and-cleanup fact. Assertion-failure exit1 is expected only with the exact EXPECTED_ASSERTION_FAILURE, complete cleanup/epoch proof and no unexpected/evidence failure; arbitrary nonzero is not acceptance.

Original14 production findings,17 requirements, ISO18, full gates, N1N2 and NEXT remain OPEN/NOT_RUN. Only the three assigned new review documents were written.
