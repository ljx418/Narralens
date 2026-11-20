# R3 + R3A independent targeted custodian re-review

**REQUEST_CHANGES** — 1 BLOCKER, 7 MAJOR, 1 MINOR. The current nofork identity harness is not yet safe as written; the normal-N path also has a deterministic static blocker. This does not release runtime. Historical HEAD `1d348d419120f23f45d958112ea8c43df5a04675` is not a new accepted freeze. All25 dirty snapshot SHA256 and byte lengths matched at entry; all inspected inputs are bound and rechecked at the end in INPUTS.json.

The narrow R3A repair is real: **R3-MAIN-01 is CLOSED_STATIC**. There is no RECOVERY_SECONDS60 responsibility expiry. _recover only returns an ok settlement, and Host EOF/selector EIO switches to paused local recovery instead of authorizing exit. Its new tests call actual _recover -> _wait_for_recovery -> _settle_domain -> KernelSettlementOperations with proc/wait/clock/selector boundaries mocked, including elapsed mock time beyond60seconds. They are useful actual-branch tests, not real kernel evidence. No old-code runtime failure was captured by this reviewer.

Other real improvements include production child/socket error listeners, no Host KILL of the reaper, separated domain/eligibility validation, segmented receipts, postcandidate terminal processing for queued and later frames, a single deadline passed to C-close proof, worker close error envelopes, and copied per-run fixture roots. These do not make the report's complete-closure claim true.

## Findings affecting the actual path

| ID | Material remaining defect |
|---|---|
| R3-C01 BLOCKER | CacheReceiptAccumulator.state calls digest on live Hash objects. Normal proof reads state, then success eligibility reads it again and throws; inspection can consume hashes even before later segments arrive. Error cleanup reads them again and can leave the issued promise pending. |
| R3-C02 MAJOR | endChild races timers and returns without proved close; its close promise resolves void but is compared with true. The nofork case sets settled=true regardless, and has no async child/channel error listener. Positive-stage finally does not cancel/reap the domain. |
| R3-C03 MAJOR | Real _wait_writable references nonexistent self._control_write. EAGAIN reaches AttributeError rather than a later writable wait; the unit mock replaces this exact method. |
| R3-C04 MAJOR | Failed exec is incorrectly disallowed as an ended-domain proof. Its real resources can all be reaped, yet Host remains held forever and preHELLO reconcile refuses worker=null. Async no-child spawn similarly never emits the exit event the proof requires; custodianBorn is recorded but unused. |
| R3-C05 MAJOR | With forked N but no readable/accepted worker_identity, census skips N entirely. TERM-ignore can go straight to a wait timeout without KILL; restored readability cannot initiate the missing KILL because all recovery calls suppress signals. |
| R3-C06 MAJOR | Segment digests/counts/full summary epochs are checked, but actual wait semantics are not: one arbitrary wait can replace N-last, statuses/order/identity correspondence are not validated, and individual segment bindings are not checked. |
| R3-C07 MAJOR | N stdout/stderr are drained in _run_loop only. Settlement and recovery stop servicing them, so TERM-handler/late output is absent from final counts and can evade the cumulative budget. |
| R3-C08 MAJOR | Identity overflow irreversibly forces known-targets-gone=false even after every actual wait/ECHILD/group ESRCH, leaving an empty C forever rather than a resource-ended failed outcome. Event truncation similarly makes the final domain proof irreparable. |
| R3-C09 MINOR | File/ignore stdio fixes the helper's EPIPE issue, but adopted TERM-ignore mode still exits the leader before any child-ready/adoption/TERM-survival barrier. This concerns later fault scaffolding, not a missing runtime result or the nofork stage. |

FINDINGS.json gives actual path:line, reachable trigger, impact, minimum correction, actual-branch mock and future decisive runtime for each. In particular, R3-C03 happens after raw settlement, so I do **not** call its receipt crash a live-child orphan. I do **not** claim that the current code still has the rejected60s responsibility exit or that ordinary well-observed TERM-ignore necessarily fails.

## Exact normal protocol and semantic limits

Both peers use @3 and4-byte length framing. C emits seq1 C_HELLO, seq2 FORKED, then consecutive RECEIPT_SEGMENT frames and a final DOMAIN_REAPED summary. Host pump interprets segments immediately rather than queueing them ahead of the expected final summary. The ticket/raw-ticket digest and normal C/N full summary epochs line up statically; Host checks actual child PPID/session/group before GO. No N is forked by the direct identity test because it never writes AUTHORIZE_FORK.

For existing item schemas, canonicalization is compatible: event items use the exact event string plus LF; wait/identity items use recursively sorted compact JSON plus LF. Python's sort_keys output and Host's recursive key sort agree on current ASCII key/status strings and decimal PID/starttick values. Python escapes Unicode JSON strings differently from JSON.stringify, but current wait/identity schemas have no such free-text value; that hypothetical future extension is not a current blocker. Raw event values are decoded before hashing, so wire escaping does not itself create a normal digest mismatch.

Normal small frames fit the declared segment/final budgets. However, **a small normal roundtrip cannot currently finish** because state() consumes the digest on its first read. Proposed correction must preserve repeated read-only observations and updates, not merely cache the first incomplete digest. Domain proof, eligibility and inspection need consistent snapshots from the same live accumulator.

Counts and a cryptographic digest only attest the received bytes. The current accumulator does not retain/check which terminal wait is N, N-last order, status shape, or the relationship to target epochs. It accepts a real-shaped summary with a recomputed digest over a wrong wait value. This is a concrete private fault seam/contract counterexample, not an asserted public forgery attack. Exact failed-start cleanup must be representable without falsely requiring successful exec; successful creative delivery must still require the successful exec and all original eligibility checks.

The actual terminal pump now sees closed:false/fatal after JPEG, including frames queued in the same chunk before afterCandidate is set. EOF before FINALIZE now latches failure. Worker transmits close error detail. Host interpretation currently retains only generic failure code/message/native phase rather than the complete received name/code/stack/cause envelope; retain this limitation for affected error assertions. Finalize's deadline is now shared with close wait; synchronous processing/fresh checks still need to respect the same original3s ceiling in a real pilot, without increasing it.

## Actual ownership and recovery cases

Normal known N: C signals its owned N group, repeatedly collects real group/direct children, reaps adopted children individually, retains N until live/unknown census clears, then waits N and asks ECHILD/group ESRCH/known epochs. N is separate from C and C is separate from Host. Actual group killing/waiting and inherited FD properties remain NOT_RUN.

UNKNOWN census/wait: the real adapter now carries enumeration/reap errors rather than turning them into an empty list. R3A keeps C alive and does not send a final unknown receipt after a timer. The new recovery tests genuinely cover that control path at mocked OS boundaries. They seed worker_identity with a zombie, however, and their fake waitid returns None. They do not cover a fork known solely from worker_pid, unreadable identity followed by a live TERM-ignoring worker, or successful real WNOWAIT before final receipt. Those are the precise R3-C05/receipt issues, not a demand to run kernel tests prematurely.

Post-fork setup/selector registration exceptions inside _run_loop now enter the broad run handler and normal settlement. The unit named “failure after fork” replaces _run_loop with an OSError and _settle_domain with an ok lambda; it proves dispatch through the handler, not real fork registration cleanup. Settlement/recovery remain outside that handler; I have not invented an uncaught live-owner exit from a merely hypothetical Python exception. The identified writable AttributeError is actual, and specifically occurs after raw cleanup.

Host EOF/cancel/selector EIO no longer expires responsibility. Control is unregistered, local polls pause and the same wait owner retries until actual cleanup. C may then exit non-success if no proof can be delivered. A live N omitted from census or a bookkeeping overflow that permanently prevents terminal proof is a separate progress defect; removing the60s expiry must not be reversed to hide either. N's existing60s worker-finalize wait is not the rejected C responsibility expiry: C remains its owner, so those two timers must not be conflated.

The normal/failed resource-ended branches then remain subject to Host proof. In particular exec.ok=false currently makes that proof inadmissible even though C actually reaped the failed child, and worker=null cannot reconcile. This is a real failure-path dead end with a dead C, rather than safety-preserving temporary uncertainty.

## Minimum boundary for the first nofork pilot

The first nofork identity stage can be isolated from the broader N/receipt gate. It does not need a successful N exec, segmented normal receipt eligibility, a browser, media, HTTP or a broad whole-production test.

Before MAIN grants it, fix R3-C02 in the exact harness: register child/error/exit/close and channel facts immediately after spawn; retain one close promise/facts across cleanup; attach bounded diagnostics/control handling; distinguish no child from child born; make close result truthful; never turn a timer or kill exception into ended; retain owner and evidence on unknown. A nofork C may be ended by the exact-owned harness under an explicit no-authorize invariant, but never reuse that as permission to KILL a C that may already own N. Do not signal an already exited/reaped child, and do not rely on a new close listener after close already occurred.

The pilot must be one exact nofork case under an explicit argv/cwd/runtime-root/recorder/single-slot ticket, including an intentional assertion failure after HELLO. Record actual C pid/ppid/pgid/sid/startticks, seq1/subreaper assertion and actual exit plus close; error/EOF must be observed. Close promise completion is proof, its deadline is only an action/unknown trigger. C's expected no-worker error/nonzero exit is not a creative success, and no N/media claim follows.

**Current verdict for that exact existing harness is NOT SAFE AS WRITTEN**, not a blanket rejection of the architecture. Once its precise ownership flaw is corrected and statically reviewed, MAIN can independently decide a tightly owned nofork ticket without waiting for all later fault/Chrome cases. This review itself supplies no runtime authority.

Before minimal positive N, also correct the deterministic accumulator and writable-field blockers and the failed-start/retained-owner routes that its finally may need. Register the supervisor, issued handle and real C/N/domain facts in the owner registry; its current finally merely inspects. Verify exact synthetic result digest/bytes and all receipt/exit facts. The1024x0x4a payload remains synthetic protocol bytes, not a decoded JPEG. Only after that positive and intentional-failure cleanup work should TERM-ignore/adoption/flood/late-birth/peer/Host-loss cases be released one by one. Mixed settlement.test.ts still contains real media/browser paths even under a “NON-BROWSER” describe, so a name/filter is not permission to run the whole file.

Q2 remains unchanged: normal ChildProcess close requires process exit and stdio closure; execFile's error/kill-error callback is a different route. Probe harness now returns false and preserves directories on its5s unknown race, which improves the old false cleanup claim, but does not establish a continuing precise owner or actual final reap on timeout. Keep that staged pilot separate; no narrow probe replacement is approved here.

## Evidence, immutability and remaining gates

R3's evidence-gap admits a broad interval of direct developer trials, approximately10 failed runs; these are UNRECORDED, with approximate counts and recalled explanations rather than original captured argv/time/log/input. Later green captures do not repair that provenance gap. R3A preserves that admission and explicitly rejects the old60s claim; its report lists one recorded unit failure, a later38-test green, one actual generation and integrity check. Those are author's recorded prior executions, not runtime run by this reviewer. No missing historic log or “captured old-code failure” was fabricated.

All review operations were static reads/hashes and new review-document writes. No product import, test/build, target process, prctl/fork/signal/wait experiment, Host/HTTP/browser/probe/media/network/user environment/config/credential/J-drive/Git mutation occurred. INPUTS distinguishes byte-binding coverage of all25 paths from targeted lifecycle source inspection; this is not a whole integration or capture audit.

Original17, ISO01..18, actual kernel/FD/reaping/Chrome, real films, full gates, human acceptance and N1N2 acceptance remain NOT_RUN/unaccepted. NEXT remains pending after N1N2 acceptance. No budget or hard responsibility expiry was added or requested.
