# Independent custodian static review — REQUEST_CHANGES

Bound to current P1R INPUT_SNAPSHOT bytes (all 22 source/report entries verified at start and end), historical HEAD `1d348d419120f23f45d958112ea8c43df5a04675`. This is not a new frozen implementation acceptance.

There are reachable ordinary-startup failures and unsafe settlement paths. I read the complete 1012-line custodian, supervisor lifecycle/protocol, worker/policy, factory/parent drain connection, prior contracts/reviews and written pilot helpers. No production imports, tests, child/probe/browser/Host/media, prctl/fork/wait/signal, network, compilation, installation, Git mutation or W source writes were executed. Only this review directory is written.

**Verdict: REQUEST_CHANGES. Do not release the report-proposed P2a commands unchanged.** Syntax/type/decoder-unit results cannot prove this program starts or reaps. The report correctly says real runtime NOT_RUN, but its per-finding “closed/implemented/static proven” claims are contradicted by actual source.

## Findings

### P1R-C01 — BLOCKER: Three independent startup defects prevent every normal rev3 handshake

Location: `src/adapters/openfilm/cache-process-custodian.py:465`; `src/adapters/openfilm/cache-process-custodian.py:368-395`, `src/adapters/openfilm/cache-process-custodian.py:517`, `src/adapters/openfilm/cache-process-supervisor.ts:825-828`, `src/adapters/openfilm/cache-process-supervisor.ts:982-988`.

Trigger/reachability: Any normal draw on the required Linux baseline: prctl.argtypes declares argument2 c_ulong but GET passes ctypes.byref(value); after correcting that, first _send increments absent self.sequence; after both fixes, Host spawn omits detached:true and Python never setsid itself, while handshake insists C.pgid=C.sid=C.pid. factory.pageFrame -> supervisor.start/#run -> Python Custodian.run -> enable_subreaper -> _send(C_HELLO). These are mandatory ordinary paths, not synthetic producer behavior.

Impact: GET conversion raises ctypes.ArgumentError before the kernel GET call; self.sequence is never initialized and would raise AttributeError before HELLO; C inherits Host group/session and is rejected by its own parent even if HELLO is emitted. No normal positive draw is available.

Minimal correction: Correct ctypes GET pointer conversion/signature and storage type; initialize sequence explicitly; make C actually obtain its independent SID/PGID before HELLO with an explicit single selected approach and preserve Host/N separation. Do not weaken the identity checks.

Decisive counterfactual (NOT_RUN): First pure structural checks, then exact no-browser authorized C startup: actual GET=1, seq1 HELLO, child.pid=HELLO.pid, ppid=Host, sid=pgid=C.pid; assert no N fork before GO-for-fork. Each current defect must fail its own control, not merely a broad rejection.

### P1R-C02 — BLOCKER: Exec-status pipe blocks the custodian forever and erases exec failures

Location: `src/adapters/openfilm/cache-process-custodian.py:726`; `src/adapters/openfilm/cache-process-custodian.py:624-628`, `src/adapters/openfilm/cache-process-custodian.py:648-653`, `src/adapters/openfilm/cache-process-custodian.py:668-685`, `src/adapters/openfilm/cache-process-custodian.py:687-707`, `src/adapters/openfilm/cache-process-custodian.py:929`.

Trigger/reachability: After fixing C01, first AUTHORIZE_FORK reaches _read_exec_status. Parent C still owns exec_write returned from _spawn_worker and never closes it. N closes every fd>3 before exec, including exec_write, so later _exec_fail cannot report an execve error. C control selector directly calls synchronous _authorize_fork; os.read(exec_read,64) is blocking before FORKED and outside the selector/deadline loop.

Impact: On successful exec the read cannot get EOF because C holds its own write end. C cannot consume CANCEL/Host EOF or enter its cleanup loop; its TERM handler only sets a flag while the read is restarted. Host eventually KILLs its reaper and can strand N. On exec failure an empty status is also treated as success and OSError is converted to empty bytes.

Minimal correction: C closes its exec_write immediately after fork; N preserves that descriptor through setup and only CLOEXEC closes it on successful exec; failure writes errno then exits. Consume exec status nonblocking in the same cancel/deadline selector, retain known/unknown errors and actual child wait ownership.

Decisive counterfactual (NOT_RUN): Authorized non-browser normal exec, missing worker entry, pre-exec setsid failure, child stalled before exec, Host EOF while waiting: verify exact status and C remains able to clean/reap. Test must fail current retained-writer deadlock and cannot pass on a READY timeout alone.

### P1R-C03 — MAJOR: Custodian puts itself in the target gone proof, so a successful receipt is impossible

Location: `src/adapters/openfilm/cache-process-custodian.py:905`; `src/adapters/openfilm/cache-process-custodian.py:375`, `src/adapters/openfilm/cache-process-custodian.py:601-610`, `src/adapters/openfilm/cache-process-custodian.py:841-850`, `src/adapters/openfilm/cache-process-custodian.py:878-890`.

Trigger/reachability: Every C run records C identity at905; _known_identities_gone later iterates that same identity map while C is alive and building its final receipt. Normal finalize -> _settle_domain -> _known_identities_gone. Current startup issues mask but do not remove this mandatory contradiction.

Impact: known_ids_gone is always false for C itself; even a fully reaped N tree produces outcome unknown/exit4. C must be outside the target execution domain; Host observes C exit afterwards. The map also never records live Chrome/adopted identities before reaping them.

Minimal correction: Separate custodian identity from target resource identities and gather/check target/adopted identities under bounded records. C may certify only the N domain; Host independently waits C. Do not drop genuine target records to make the counter zero.

Decisive counterfactual (NOT_RUN): Authorized normal helper with no descendants and then one adopted descendant: expect target gone receipt while C is still alive, followed by actual C close; no self-identity in target gone predicate.

### P1R-C04 — MAJOR: Leader exit suppresses KILL for live TERM-ignoring descendants; reaper exits early

Location: `src/adapters/openfilm/cache-process-custodian.py:865`; `src/adapters/openfilm/cache-process-custodian.py:770-821`, `src/adapters/openfilm/cache-process-custodian.py:826-839`, `src/adapters/openfilm/cache-process-custodian.py:872-886`, `src/adapters/openfilm/cache-process-custodian.py:976-978`, `src/adapters/openfilm/cache-process-custodian.py:939-942`.

Trigger/reachability: N exits on TERM or already died, while an actual child in N group ignores TERM. _wait_for_worker_exit returns true, so KILL is skipped even though that child lives. _final_reap reaps N immediately after one adopted sweep. Normal cancel/finalize of the real process topology; mandatory ISO09 orphan variant. It does not require malicious native escape.

Impact: C releases the anchor before all target members are terminal, checks ECHILD only once, and returns4/exits with the child still alive or newly-zombie. Adoption races can similarly produce unknown rather than another wait/reap cycle. The surviving reaper that was meant to close normal ISO09 is voluntarily destroyed.

Minimal correction: Drive TERM/KILL by the entire verified target group/owned adopted-child state, not only N exit. Retain N WNOWAIT anchor until every other execution/reap is complete; continue collection/reaping through adoption races, reap N last and verify ECHILD repeatedly. C must not exit while owned work is live; genuine inability keeps it as responsible owner.

Decisive counterfactual (NOT_RUN): Actual N exits TERM plus real grandchild ignores TERM; actual N ignores TERM plus child; N spontaneously exits before finalization; delayed adoption. Require KILL of remaining owned work, waitpid of every adopted identity before N final wait, then C close and zero residual including Z.

### P1R-C05 — MAJOR: Group signal chooses unverified current pgrp and can signal custodian/Host group

Location: `src/adapters/openfilm/cache-process-custodian.py:858`; `src/adapters/openfilm/cache-process-custodian.py:638-641`, `src/adapters/openfilm/cache-process-custodian.py:709-730`, `src/adapters/openfilm/cache-process-custodian.py:754-760`, `src/adapters/openfilm/cache-process-custodian.py:863-868`, `src/adapters/openfilm/cache-process-custodian.py:221-248`.

Trigger/reachability: N fails setsid or stops before it, so it still belongs to C group (and with current non-detached C to Host group). Cleanup reads this pgrp and immediately signals it. Unknown identity likewise falls back to a bare worker_pid group without proving a valid target session/anchor. PreHELLO/setsid failure is an explicit rev3/P2a failure boundary. Cleanup calls happen even when N handshake was never accepted; current startup defects mask the branch until individually fixed.

Impact: TERM may hit C or Host/peer group instead of just N; signal results are discarded and no complete PID/startticks/SID/PGID + retained-parent authority gate is checked for each signal. group_exists converts miscellaneous OSError to false and direct_children read errors to empty, contrary to conservative unknown rules.

Minimal correction: Commit a target group only after actual setsid/session verification under the unreaped child authority. Before that, terminate/reap only the exact unreaped direct child. Every group signal must verify the recorded full target epoch and retained anchor; preserve errors/unknown instead of guessing gone.

Decisive counterfactual (NOT_RUN): Authorized controlled bootstrap setsid failure/stall and untrusted HELLO: capture signal targets and assert C/Host/peer receive none; actual direct child is reaped. Inject proc EACCES/EIO and killpg non-ESRCH errors; no success receipt or foreign signal.

### P1R-C06 — MAJOR: Execution can settle without any valid reaping receipt or preHELLO target proof

Location: `src/adapters/openfilm/cache-process-supervisor.ts:1223`; `src/adapters/openfilm/cache-process-supervisor.ts:698-742`, `src/adapters/openfilm/cache-process-supervisor.ts:1180-1185`, `src/adapters/openfilm/cache-process-supervisor.ts:1230-1253`, `src/adapters/openfilm/cache-process-supervisor.ts:910-914`, `src/adapters/openfilm/cache-process-supervisor.ts:1290-1303`.

Trigger/reachability: After a candidate C sends DOMAIN_REAPED outcome unknown/false ECHILD/diagnostics_lost and exits4 while the observed group happens to be gone; parent only checks kind and fresh group. Or C is killed during FORKED wait before facts.worker is set, and a real preHELLO fault child has closed its inherited draw endpoint but remains alive (so C close is observable despite live N). Normal return and held reconcile both reuse incomplete proof; #terminate itself can KILL C. In the preHELLO case facts.worker=null skips every target check.

Impact: facts.receipt is stored but never validated by #proveDomainGone or reconcile: no protocol/draw/C/N identity/seq/event digest/outcome/ECHILD/exit status checks. With worker=null, C close alone makes true even if C already forked N. PRE/scope can be released without a live reaper or complete execution proof.

Minimal correction: One shared strict execution-proof function must validate bound final receipt/event chain, actual C exit/close, all target identities and known/unknown status. Maintain fork-authority facts before N HELLO; missing receipt or unexpected C death holds responsibility, not child-only success. Avoid automatically KILLing C before owned tree is reaped.

Decisive counterfactual (NOT_RUN): Actual C dies after fork before N HELLO; refused/foreign/truncated/unknown receipt; receipt seq/digest mismatch; nonzero C exit; known escaped identity; held reconcile. All must keep PRE/scope until full legitimate proof, even if one sampled group is empty.

### P1R-C07 — MAJOR: Budget enforcement is bypassed by decoded-frame queues and flood-drain loops

Location: `src/adapters/openfilm/cache-process-supervisor.ts:874`; `src/adapters/openfilm/cache-process-supervisor.ts:869-885`, `src/adapters/openfilm/cache-process-supervisor.ts:851-859`, `src/adapters/openfilm/cache-process-supervisor.ts:1134`, `src/adapters/openfilm/openfilm-cache-worker.mjs:135-173`, `src/adapters/openfilm/cache-process-custodian.py:575-597`, `src/adapters/openfilm/cache-process-custodian.py:377`, `src/adapters/openfilm/cache-process-custodian.py:964-965`.

Trigger/reachability: A real fault worker continuously emits valid small frames while the current stage has no consumer, or emits stdout continuously and ignores TERM. Decoders empty bytes into unbounded controlFrames/drawFrames; C loops reading stdout until EAGAIN and appends one signal string per excess chunk. ISO08 is an explicit private fault boundary, not a public network exploit. The production listeners receive every chunk from their actual worker.

Impact: Overall queued frames/bytes are unbounded even though decoder tail is bounded. Host stdout overflow only sets flooded and is checked once after JPEG; later/pre-result floods do not immediately clean. C stream loop can starve selectors/CANCEL and never escalate KILL, while signals/waits grow and final receipt is unsegmented. Worker receiving no waiter likewise has no aggregate bound.

Minimal correction: Bound both decoded queues and partial buffers by phase/count/bytes; active failure/cancel latch on every diagnostic/decoder event. Limit per-loop reads to allow timers/wait processing; flood enters one monotonic termination state and escalates to KILL. Use bounded segmented event receipts with digest, not unbounded arrays.

Decisive counterfactual (NOT_RUN): Actual valid-frame flood without waiter, metadata+max JPEG positive control, pre-result and post-candidate stdout/stderr flood, TERM-ignore flood. Assert bounded peak queues and actual C/N reaping, not just rejection or log tail.

### P1R-C08 — MAJOR: Nonblocking control writer drops partial-frame tails and final receipts

Location: `src/adapters/openfilm/cache-process-custodian.py:504`; `src/adapters/openfilm/cache-process-custodian.py:511-515`, `src/adapters/openfilm/cache-process-custodian.py:487-490`, `src/adapters/openfilm/cache-process-custodian.py:976-978`, `src/adapters/openfilm/cache-process-custodian.py:668-685`.

Trigger/reachability: Under real control-channel backpressure os.write returns 0<sent<len(body). _flush_control removes the entire frame and subtracts its full length. On EAGAIN at final receipt it immediately returns from run and exits instead of draining the reserved final output. C also retains its draw fd3 copy after fork. All control HELLO/FORKED/final receipts use this writer. Backpressure/Host EOF are required P2a cases; not an arbitrary external writer.

Impact: Host sees corrupted length framing or misses the final proof; C staying on Node draw socket prevents true N EOF. Reserved bytes do not reserve a frame slot, so a full16-frame queue can drop terminal receipt. Claims of single-owner EOF and bounded final receipt are not implemented.

Minimal correction: Track per-frame offset and decrement actual bytes only; retain unsent suffix, watch writable events without blocking wait/kill, and finish bounded receipt transmission or explicitly report non-success EOF. Reserve terminal frame capacity separately. C closes fd3 immediately after passing it to N; no stale socket duplicates.

Decisive counterfactual (NOT_RUN): Pause Host control reads and force short writes/EAGAIN with real pipes, then resume: exact seq/frame/digest transcript must survive. Exit N while C lives: Host sees real draw EOF. Disconnect Host: C still reaps before non-success exit.

### P1R-C09 — MAJOR: Candidate freezes failure latch and cleanup holding can loop forever on its own array

Location: `src/adapters/openfilm/cache-process-supervisor.ts:763`; `src/adapters/openfilm/cache-process-supervisor.ts:765`, `src/adapters/openfilm/cache-process-supervisor.ts:781`, `src/adapters/openfilm/cache-process-supervisor.ts:797-798`, `src/adapters/openfilm/cache-process-supervisor.ts:910-914`, `src/adapters/openfilm/cache-process-supervisor.ts:1139-1156`, `src/adapters/openfilm/cache-process-supervisor.ts:1168-1172`.

Trigger/reachability: After valid JPEG sets latched.kind=candidate, a later timeout/protocol/cleanup failure calls #latchFailure, which returns without recording it. If #proveDomainGone pushes a failure, #holdForCleanup(facts,facts.cleanup) iterates that same array while pushing into it. Post-candidate finalization and real unknown-cleanup branches of factory production; not just diagnostic methods.

Impact: Later known failure is ignored instead of overriding an unadopted candidate; exit observations are only strings and never decide success. With any cleanup failure the self-extending for-of does not terminate and can synchronously exhaust Host memory, preventing the promised pending barrier or cleanup inspection.

Minimal correction: Permit transition candidate->failure until final delivery; latch exit/protocol/cancel/budget failures at observation. Copy/deduplicate cleanup causes rather than append while iterating the same live array; keep genuine objects and bounded diagnostics.

Decisive counterfactual (NOT_RUN): Valid JPEG followed by fatal/late flood/timeout/pre-finalize abnormal exit must produce zero picture/witness. Actual cleanup-unknown with one genuine failure must return an inspectable held state promptly, preserve failure once and later reconcile to original failure.

### P1R-C10 — MAJOR: Per-draw private HOME/XDG run root and safe cleanup are absent

Location: `src/adapters/openfilm/cache-process-supervisor.ts:805`; `src/adapters/openfilm/cache-process-custodian.py:349-357`, `src/adapters/openfilm/openfilm-cache-worker.mjs:390`, `src/adapters/openfilm/openfilm-upstream.ts:526-533`.

Trigger/reachability: Every draw copies Host HOME/TMP/XDG values into C, which copies them into N unchanged. No per-draw owned directory is constructed or passed; worker only sets NARRALENS_OPENFILM_ROOT. Ordinary child environment construction before all fixed module/browser activity.

Impact: Children use shared/user namespace instead of the private contract run root; no owned directory record or settled-vs-UNKNOWN retention/deletion path exists. I did not read actual environment/user configuration and do not claim an observed secret leak.

Minimal correction: Create an owned private run directory before launch, pass only approved child env rooted there (without mutating Host env), record responsibility and clean only after full execution/parent settlement; retain on unknown. Cover child profile/temp/runtime namespaces actually used by fixed dependencies.

Decisive counterfactual (NOT_RUN): Authorized environment-inspection helper reports only safe owned path metadata, not env dump: two draws have independent child roots; normal/error cleanup removes only own path after actual close; unknown preserves it; user home untouched.

### P1R-C11 — MAJOR: Written P2a pilots neither prove reaping nor guarantee failure cleanup

Location: `tests/agent-driven/integration/cache-custodian-lifecycle.test.ts:65`; `tests/agent-driven/integration/cache-custodian-lifecycle.test.ts:53-79`, `tests/agent-driven/integration/cache-custodian-lifecycle.test.ts:85-115`, `tests/agent-driven/integration/helpers/cache-worker-fixture.mjs:150-220`, `tests/agent-driven/integration/helpers/cache-probe-fixture.mjs:82-95`, `tests/agent-driven/integration/cache-frame-duration-lifetime.test.ts:68-93`.

Trigger/reachability: Lifecycle normal test starts nativeSourceFixture (which calls real ffmpeg through preparedDraftFixture) but actually runs FIXTURE_PATH and expects any rejection, not a positive real worker. Helper result uses go.ticket_digest though GO contains ticket; foreign-hello scenario never changes HELLO; half-jpeg sends a complete shorter frame. Probe live modes unref their only timer and await an unresolved top-level promise, so they need not stay alive as claimed. These are exactly the report-suggested initial non-browser P2a commands; current normal startup failures can satisfy broad rejects without reaching any desired fault boundary.

Impact: No successful baseline, no actual adopted grandchild in ignore-term, no waitid/waitpid/domain receipt assertions. Test assertion/timeouts can skip cleanup because kills are after expects rather than in finally; afterEach deletes directories despite unknown/live processes. Probe tests do not record parent error/exit/close/callback kernel order and omit live signal-error/real ffprobe cases. Running proposed suite as-is is not safe or decisive pilot evidence.

Minimal correction: Prepare an explicit no-media positive helper baseline using the real C protocol and correct digest; make fault mode observable before intended boundary; keep helpers genuinely alive; use real child+grandchild TERM-ignore, event/identity receipts and peer controls. Register owners immediately, use finally cleanup with precise identities and actual close/reap, preserve unknown dirs. Split fixture-only P2a from Host/media/Chrome lanes.

Decisive counterfactual (NOT_RUN): Before grant, static-check helper mode/ticket wiring and cleanup paths. Then tightly authorized positive baseline followed by each deliberate fault with exact expected primary and complete C/N/adopted wait receipts; prove current broad-rejection tests would not pass a never-forked worker. Probe test must survive failed assertion without leaving helper.

## Prior findings are not automatically repaired

- **P1-F01**: Basic PID/state bug visibly changed in TS/Node/Python; not whole runtime acceptance. New mandatory C startup defects C01/C02 prevent success; exact decimal startticks still converted through JS Number.
- **P1-F02**: TS gone/known/unknown and actual custodianClosed boolean added; full proof still unsafe (C03/C04/C05/C06), Python errno handling remains lossy.
- **P1-F03**: Issuer/held/run-handover checks added; reconcile still skips receipt and complete domain facts (C06).
- **P1-F04**: Responsibility/handle wiring exists, but post-candidate failure latch and cleanup-held infinite append not closed (C09); no operational lifecycle demonstrated.
- **P1-F05**: Two-tier normal field comparison added but C group never established; C cleanup can target unverified pgrp and preHELLO proof is incomplete (C01/C02/C05/C06).
- **P1-F06**: JPEG wait now uses outer deadline; READY restarted independently three times, blocking C exec-status bypasses all timers; cleanup hold loop can hang Host (C02/C09). No actual timeout loop closed.
- **P1-F07**: Bounded decoder tail exists; total decoded queues, worker receiver, all-phase flood handling and partial writes remain broken (C07/C08).
- **P1-F08**: Synchronous responsibility registration and queued abort/draining recheck visibly added; full owner lifecycle still blocked by execution findings; not accepted by this focused static review.
- **P1-F09**: Not repaired: candidate prevents later failure latch; C/N exit/protocol/final receipt not validated (C06/C09).
- **P1-F10**: Source error no longer settles close promise, error/destroy failures retained; actual source/probe/drain runtime still NOT_RUN and custom source error-to-destroy behavior needs affected review.
- **P1-F11**: Pilot now reads actual self.identity.pgid; change present, actual detached/C group proof absent. New pilot quality defects C11 remain.

## Exact prerequisites for a non-browser P2a ticket

1. Existing unique Claude writer must repair the static blockers and unsafe ownership branches, preserve all old candidates/captures and freeze a new complete raw-byte snapshot; independent static recheck must confirm C startup topology, ctypes pointer ABI, initialized seq, closed parent exec writer, nonblocking deadline/cancel loop, correct child-only pre-setsid cleanup and retained-anchor group signals. No implementation authorization comes from this report.
2. End-to-end execution proof must use a bound complete DOMAIN_REAPED event chain/receipt, real C exit/close/reap, target ECHILD/group ESRCH/all identities including Z, and conservative unknown propagation. Candidate cannot mask later failure; failure holding must be bounded/inspectable rather than the self-appending loop. C cannot be killed as a normal replacement for reaping N.
3. Repair IPC/backpressure/FD ownership, private run HOME/XDG and real cleanup retention. Verify total queued bytes/frames, terminal receipt reservation and no copied draw/control endpoints. Keep raw FRAME15/JOB45/CAPTURE30 and original ADR budgets; one READY deadline must cover the two-tier chain rather than three fresh30s waits.
4. Rewrite the initial pilot so it imports/executes no nativeSourceFixture/ffmpeg/browser/Host path unless separately named in its grant; use only the explicit Node fault helper plus real C. Positive candidate/control baseline first, then real TERM-ignore grandchild/adoption, early leader exit, preHELLO/exec failure, EOF/backpressure, peer, custodian-death failclosed. Every test owns and cleans child/custodian in finally with actual identity/close/wait receipts; unknown work/directories are preserved and escalated, never swept.
5. MAIN must issue exact files/cwd/argv, fixed Python and Node hashes, resource slot, timeout/stop and bounded unique capture paths. The proposed current broad rejects and afterEach directory deletion are insufficient safety controls. No runtime was attempted to discover already-deterministic startup bugs.
6. Q2 default upstream probe stays unchanged until a correct decisive event pilot establishes need for a separately named narrow owner. The written helper must actually remain live, register parent error/exit/close/callback before acting, verify live identity at observation, distinguish injected errors and real ffprobe, and unconditionally reap in finally. No global Host monkey patch or new full backend is justified.
7. P2a does not close original17/ISO01..18, actual Chrome/noescape, raw input FD/stream/probe proof, affected/full gates or human acceptance. Those remain NOT_RUN. Only after staged real evidence and a new frozen SHA may implementation acceptance be reconsidered.

## Input and authority limits

W AGENTS and existing applicable parents were checked read-only; no nested AGENTS was found along the inspected adapter/test paths. The explicit review allowlist is the only write scope. Fresh Claude429 means stop/preserve/report, never a grant to implement. This reviewer has authored earlier design advice but did not implement/edit the candidate; these findings are independent static verification of its current actual bytes, not self-signed runtime evidence. All findings distinguish immediately mandatory failures from downstream branches masked by them; no hypothetical public remote exploit is claimed. INPUTS.json binds every inspected file and the start/end equality.
