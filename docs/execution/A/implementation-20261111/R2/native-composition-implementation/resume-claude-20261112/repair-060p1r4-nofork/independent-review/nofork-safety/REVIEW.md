# Exact nofork harness independent safety review

**REQUEST_CHANGES** for the two proposed standalone commands. There are3 MAJOR safety/result-proof defects,1 MINOR startup-path bug and2 nonblocking notes. This review does not reopen the production lifecycle design: all14 entries in OPEN_PRODUCTION_FINDINGS.json stay OPEN, and the legacy mixed lifecycle harness is not the proposed execution.

The complete988-line tool and733-line test were read. All3 bound new files and all25 protected files matched entry SHA256 and byte count; end equality for every inspected input is in INPUTS.json. No source/test/config/index/Git/old evidence was changed, and no tests, imports of the tool, target child, signal or kernel experiment ran.

## What is already correct for this exact slice

The module has an explicit entry-point guard. Its actual CLI only accepts identity/assertion-failure and a custodian digest; it offers no executable/PID/group/signal option. The real runner checks cwd against the tool's repository root, hashes the fixed Python and fixed C path before spawn, then uses exactly `/usr/bin/python3.12 -I -S -B <W>/src/adapters/openfilm/cache-process-custodian.py`, detached with fixed stdio. Its child environment is constructed from constants and owned root paths, without copying user environment/config or changing Host HOME.

The noauthorize invariant is supported by actual source: there is no channel.write/control-frame sending call in the tool. It reads fd4 and never sends AUTHORIZE_FORK, GO, CANCEL, FINALIZE or RECHECK. The raw socket naturally has methods, so “read API only” is a source-use boundary rather than a sandboxed object capability; for these exact fixed commands, no writer call exists. Protected C only calls _authorize_fork upon an AUTHORIZE_FORK message in _run_loop. Therefore N is not created by this slice.

The new ledger attaches ChildProcess error/exit/close and stdout/stderr/control data/end/error listeners before the first await. It keeps one tagged persistent closePromise and one cleanupPromise, records close-before-cleanup, and avoids the old void===true bug. Cleanup uses the issued ChildProcess.kill only; no process.kill or group signalling exists. Before each signal it checks the noauthorize invariant, recorded/ChildProcess exit state, and a synchronous fresh PID/startticks/PPID/PGID/SID comparison with the recorded epoch. There is no await between that check and child.kill. No-await does not prevent OS scheduling, but Node's retained direct-child handle plus no previously observed exit is the relevant authority; this is not arbitrary numerical signalling.

A verified nofork C may be TERM/KILLed by this harness because it never owns N. That narrow permission does not transfer to production C. Roots/evidence are retained rather than deleted. Decoder partial bytes and diagnostic tails have limits, strict UTF8/JSON/HELLO protocol/seq/subreaper checks are present, and proc startticks remain exact strings.

## Remaining actual defects

**NF-01: a post-spawn evidence error can drop a live owner.** After cleanup returns unknown, outcome.json is written outside the protected try/finally. main likewise writes held.json before waiting for close. ENOSPC/EIO/EACCES there rejects runPilot/main into the uncaught top-level await. A detached nofork C can still be alive waiting for authorization. This is an expected I/O-error branch inside the tool, not an excluded external OOM/kill scenario. Every post-spawn evidence/logging failure must retain the same child, closePromise, root and primary error until terminal proof; a best-effort report failure must never remove ownership.

**NF-02: recorded errors do not affect eligibility.** stdout/stderr overflow sets diagnosticsLost; stream and control errors are stored. None is wired into a first failure latch or the final identity/fault-case predicate. With legal HELLO and genuine cleanup, identity can still return ok/exit0 or assertion-failure can set fault_case_passed after one of those known failures. The exact protected C has a small normal nofork transcript, so I do not invent an external producer flood, but the actual event-entry/result path violates the specified failure behavior. Decoded frame queue storage also needs a bounded policy; the current partial buffer limit alone does not bound queued complete frames. Identity success should explicitly require the complete terminal facts, not only primary===null.

**NF-03: HELD later accepts close alone.** main waits closePromise, writes closed-after-held and returns1 without rerunning fresh epoch-gone or checking exit/no-birth consistency. When unknown was caused by unreadable proc after an already observed close, that promise is already resolved and main leaves immediately while its full proof is still unknown. Ordinary Node close normally follows process exit; this is not the old false claim that stdio close by itself closes a live child. The precise contract nevertheless requires fresh original-epoch confirmation before this owner ends, and the current path does not do it. Polling for the missing proof must retain the same owner without a finite responsibility expiry or signalling a reaped child.

**NF-04:** actual runPilot sets epoch=null for a no-PID async spawn failure, then dereferences epoch.presence before the error can arrive. The resulting TypeError masks EAGAIN/ENOENT and bypasses its otherwise useful no-child-confirmed route. The existing test exercises cleanupChild with error/close already emitted, not this real runner ordering.

NF-05 notes the missing fresh.identity.ppid==toolPid check in the identity verifier; the later signal validator does compare fresh PPID to recorded epoch. With this fixed direct nofork child, no foreign-parent exploit is claimed. NF-06 is only a capture-count correction. FINDINGS.json gives actual lines, minimal changes confined to the two new files and actual-runner mock counterfactuals for each item.

## C startup and environment compatibility

Reviewed C is `6b8d6df32b1958b3cf53e05152e9b04abf6c010d58ae6e672fcd7fa4c9511618`. The fixed manifest agrees with that digest and with Python `e50d468e8b0adfb05733f5b87b3cff34829c4a8c1aea50c865aa8bdfe4bb150f`; this reviewer independently read/hashed the Python executable,8020928bytes, with the same hash. No binary was executed.

C _setup installs its signal/selector handling; verify_own_integrity hashes its interpreter/script against the adjacent manifest; it checks its own independent identity and SET/GET subreaper before seq1 C_HELLO. The tool's private directories and Python -I -S -B fit those startup requirements. No vendor, browser or media module is needed or imported for HELLO. After TERM, no-N C may report NO_WORKER and exit nonzero, or retain local recovery if its no-child proof is unknown; the exact owned KILL route remains available to this noauthorize tool. Neither creative exit0 nor any production receipt success is required for this kernel identity slice.

## Tests and existing captures

The tests inject child/proc/clock/spawn/filesystem boundaries and call the actual ledger, cleanup and runPilot functions. They are not merely a copied cleanup oracle. However, **main is not imported/tested**, so its HELD ownership/terminal path is absent. Stream error/overflow tests assert ledger fields only, and close tests often emit fake close without exit; they do not establish the required combined terminal proof.

The “real spawn guard” increments a counter then forwards to the real implementation if reached; it is a final assertion, not a fail-before-spawn fence. Current explicit injected calls and entry-point logic avoid that route, but the next tests should make accidental real spawn throw before side effects. Its installation after static import also cannot prove import safety by itself; import safety here is supported by reading the entry guard. None of these mocks proves actual detached/prctl/signal/reap/close behavior.

Read-only audit of all7 existing cmd/result/exit/raw-log sets agrees with MAIN_CAPTURE_AUDIT.json: test001..004 are four failed runs (30/38,30/38,37/38,37/38), test005 is38/38 exit0, and both syntax checks are exit0 with empty-log SHA256. Raw log hashes match metadata. The report's “five failed captures” is incorrect; it is a nonblocking evidence note, not a code safety blocker. All failed captures remain untouched. Earlier failed-input drifts do not certify final source bytes; the final green/syntax records bind the current files according to MAIN's audit. I did not read all649 captured payload paths or user/config inputs to repeat that broader audit.

## Exact future boundary

The following remain proposed commands only, from W; they are **not approved to run by this review**:

```sh
node tools/native-cache-nofork-pilot.mjs --mode identity --expected-custodian-sha256 6b8d6df32b1958b3cf53e05152e9b04abf6c010d58ae6e672fcd7fa4c9511618
node tools/native-cache-nofork-pilot.mjs --mode assertion-failure --expected-custodian-sha256 6b8d6df32b1958b3cf53e05152e9b04abf6c010d58ae6e672fcd7fa4c9511618
```

Correct only the new tool/test ownership, error eligibility and fresh terminal proof; do not require production/N-positive fixes first. Re-review the exact bytes, then MAIN may separately release these two single-slot commands with recorded roots and expected outcomes. Identity may report successful fact-checking only after complete cleanup; assertion-failure must retain the exact EXPECTED_ASSERTION_FAILURE plus full cleanup/epoch proof. Its current CLI returns1 for fault-observed, distinct from identity exit0; future receipts must say that explicitly rather than calling every nonzero an unexpected failure or calling it creative success.

Actual C/prctl/signals/close/kernel semantics remain NOT_RUN. Production findings, original17, ISO18, N1N2 and NEXT are unchanged. No runtime, source implementation or takeover authority is supplied.
