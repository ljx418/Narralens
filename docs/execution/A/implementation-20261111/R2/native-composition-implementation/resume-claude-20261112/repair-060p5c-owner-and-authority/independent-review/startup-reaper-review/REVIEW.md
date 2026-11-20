# R5C targeted startup/reaper independent review

**REQUEST_CHANGES.** Current bytes are not ready for either exact minimal N pilot. Real signal dispatch now has an irreversible wait/epoch guard and the old late-close blanket rejection is removed, but the normal/fault tool cancels or refuses ordinary asynchronous startup before it can exercise N. There are also remaining convergence and cancellation-provenance defects on the actual paths. These findings are source reasoning, **not executed failures or a claim that missing runtime evidence is itself a blocker**.

The8 reviewed source/test files,7 protected hashes and authorized report match the handback snapshot at entry/end. All61 inspected/hash-checked inputs have full start/end SHA256 and byte counts in INPUTS.json, with no drift. HEAD `1d348d419120f23f45d958112ea8c43df5a04675` remains historical; this dirty candidate is not a new freeze or R8 external acceptance. Only these new review documents were written. No test, product import, Python module, child, signal, wait, fork, prctl, Host, HTTP, media, browser, network, config or credentials operation ran.

## Exact next gate has an actual source-order regression

At tool930, `supervisor.start` starts real #run but returns a pending promise. Real #run yields on C_HELLO at supervisor2303; it cannot accept an N or settle a normal result synchronously before child events occur.

For **normal**, there is no mode wait after start: the try ends at938 and immediately enters finally. continueToTerminal679 interprets any unsettled inspection as a reason to requestCancel with DRAW_NOT_SETTLED. It cancels pending normal work before the positive exchange, so the required synthetic success path is not reachable with ordinary real asynchronous startup.

For **assertion-failure**, runTheDeliberateFailure771 first requires acceptedWorker synchronously, before any await. Real N_HELLO cannot already have been processed. A null worker immediately becomes WORKER_NOT_OBSERVED and cancel; the later waitForLiveWorker never runs. Both exact commands can therefore fail before the intended N exercise. This does not imply an orphan: the new continuation can clean the prematurely cancelled C. It does mean the planned positive controls cannot work.

The positive mocks hide the problem: StubSupervisor.start marks a normal draw settled synchronously, and diagnosticSnapshot presents a worker from the initial scripted behaviour. A faithful asynchronous returned-child/supervisor branch is required: start pending, later HELLO/FORKED/N_HELLO/GO, then normal result. Normal must not cancel merely because it is still pending, and the fault mode must wait for accepted N before bound GO/live checks. Keep the single owned finally; do not solve this by weakening identity checks or making every producer fail closed.

## S01: signal safety improved, terminal convergence still incomplete

Actual KernelSettlementOperations978/984 calls _authorise_signal before forwarding to signal_group/signal_pid. That authorizer uses WNOWAIT wait authority, permanently refuses reaped/ECHILD authority, rejects unknown bound identity and mismatching original startticks, and verifies the original independent group/leader. Original epoch and current observations are separate; _signal793 no longer falls back to a cached group when fresh group selection fails. The previous replacement-PID/group **dispatch** hazard is CLOSED_STATIC as a subclaim. Initial epoch-unreadable bootstrap is limited by actual unreaped direct-child wait authority and permits only exact PID, not a blind group. Ordinary known original TERM-ignore still has a path to one owed KILL, adopted waits, N last and ECHILD.

However, TargetSettlement847 conflates permanent loss of **signal permission** with permanent loss of the ability to **prove settlement**. A concrete actual path is: TERM ends N; _reap_worker consumes N; a later group/ECHILD probe is temporarily unknown; recovery encounters continued uncertainty and attempts the still-owed KILL; the raw adapter correctly refuses the reaped authority and actions.authority_lost becomes true. Even if all later observations become fresh gone, every subsequent run returns _held before census/ECHILD/group/known-ID proof. C can never complete. _held even says anchor_held=true although this path has already reaped it.

Keep signal revocation irreversible, while allowing conservative terminal evidence collection to continue. Retain original group/known-ID obligations and actual N terminal wait facts; never reacquire replacement authority and never expire responsibility. The author's statement that reap/replacement necessarily means a draw must be permanently held is not the contract. It is a retained unknown **until proved**, not a prohibition on all later proof.

Delivery debt is correctly consumed only on actual sent now. The persistent EPERM/failed-delivery path nevertheless appends each attempt into Custodian.signals2084 without a cap. Recovery has no lifetime expiry, so this history can grow indefinitely despite bounded event logs. Use bounded first/recent/counter/debt facts and controlled fresh-authority retries. Do not spend unsent debt or abandon the actual owner. This is a MINOR assigned refusal-path issue, not a claim that the normal/silent fixture naturally changes credentials or causes EPERM.

The new authority tests call real _authorise_signal and KernelSettlementOperations via _settle_domain, which is useful. Their replacement-PID case manually sets anchor_reaped and bound state; signal wrappers above raw os.kill/killpg are replaced. The tests do **not** traverse real adapter mock waitpid consuming N, a post-reap probe EIO, replacement epoch and recovered terminal proof. No raw-errno/debt-history bound is demonstrated. These limitations support the concrete branches above; they are not a request for every R6 negative case before the minimal pilot.

## S02 and S05: late-close ledger fixed; totally unbound C still cannot finish on fresh gone

The old worker=null/forkedPid=null blanket rejection is gone. reconcile1628 chooses a fact-based no-birth/no-authorize/forked/unknown ledger. Actual new tests drive start into held, then late no-PID error+close or bound-epoch no-authorize exit+close/ENOENT and reconcile the same original failed promise. AUTHORIZE-sent with no fork/receipt proof remains held. This closes S02's original guard defect without guessing no N from missing HELLO.

Bound C epoch with fresh unknown now explicitly rejects, closing S05's original unknown-falls-through defect. Verified C_HELLO can also provide an original epoch when the initial spawn observation was unavailable.

The fully unbound startup case remains wrong: immediate spawn identity read is unknown, C fails before a verified HELLO, then actual C exit/close occur and its issued PID becomes fresh ENOENT/ESRCH. At2760 the proof returns false for epoch=null **before querying that PID**, so neither run nor reconcile can ever use the later genuine gone evidence. SPEC2 permits fresh gone; only fresh-known without an original epoch must remain unable to prove replacement. Query the issued born child PID after real exit/close, accept genuinely gone, hold unknown or known/unbound, preserve original failure and keep authorize-sent requirements intact.

New2774 also exempts a known same epoch in Z from rejection. Contractually Z is not gone. Genuine Node close normally follows reaping, so this review does not invent a physical lingering-C orphan from fake impossible close events; this is a nonblocking normative/proof note, not the main rejection. Tests should not use fake close/Z combinations to justify real fresh-gone claims.

## Other prior items and cancellation interaction

S03's old postbirth exception abandonment is CLOSED_STATIC: partial entry/root preparation is registered incrementally, exceptions reach the same finally, and the active continuation follows the original start promise through held reconciliation and reads its original result. The new N01 mode-order problem must still be repaired.

S04 is CLOSED_STATIC: the actual protected R4B reporting export is dynamically imported from a fixed local specifier and shared as the same boundary instance between main/runner before resource creation. Default stream and callback writer are wired; report paths use the boundary and pending callbacks enter final qualification. No nofork kill/cleanup ability is reused. The old unused lookalike factory/direct stderr bypass is removed.

S06 is still open despite stronger exact Error identity, matching full N epoch/live state and bound GO checks. After an intended first requestCancel accepts the original Error and records accepted_as_primary=true, the finally observes asynchronous cleanup pending and calls requestCancel again with that same Error. Production's else branch1754 overwrites the accepted provenance with accepted_as_primary=false/superseded_by_earlier_failure=true. The final qualifier requires true, so a valid delayed intended fault becomes ineligible. The exact original Error remains preserved; its proof metadata is what loses idempotence. Keep primary provenance immutable once accepted and record later requests separately if needed. Tests must exercise actual supervisor twice and actual delayed runner cleanup; the current stub omits this production overwrite branch.

The raw settlement cleanup array is also reduced to a timeline count, while the expected-fault predicate does not inspect actual cleanup errors/cleanup_failures. The report overstates no-unrelated-cleanup qualification. Preserve actual original settlement/cleanup evidence and apply the intended qualification when repairing the mode/cancel interaction; this does not request R6's complete receipt audit.

## Evidence and limits

Accepted R5C handback is msg_0e1f69a0c119/task_e200d7c555da/ctx_3f37cd7eb6c5. Release, SPEC, MAIN adjudication, snapshot, report, prior R5B review and rev3 ADR/private contract were read. The precise safety gate is before actual N runtime, not overall14-finding, original17 or ISO acceptance.

Six final recorded cmd/claim/result/exit/log sets were independently read/hashed. They report tsc0, identity75, Python52, pilot28, generation0 and integrity-check0; raw log hashes agree with results, selected actual supervisor/C/tool/test input digests match current bytes and each final result has source_changed/source_added empty. MAIN's full651-input comparison remains its own audit; this review did not open config/user payloads. The mock counts are authentic recorded counts, not proof that the real startup sequence can pass.

Existing reds remain historical. R5B python001 remains INCOMPLETE with no invented PID/exit/result; no new record repairs that absence. R5C's report says its own attempts had no INCOMPLETE. It also says dynamic import was verified in both Vitest and tsx, but the cited capture is a Vitest pure test and the actual tsx CLI remains NOT_RUN; do not elevate that sentence into a runtime claim.

## Disposition and next boundary

FINDINGS.json provides5 concrete findings, actual paths, prerequisites, minimum fixes and direct future counterexamples. Old S02/S03/S04 are CLOSED_STATIC for their precise old defects; S01/S05/S06 remain open for the described residuals, with old peer-dispatch and bound-unknown subfixes explicitly acknowledged. R5A C01/C03 are not reopened. R6/R7/17/ISO18/N1N2/NEXT remain OPEN/NOT_RUN.

The report's proposed commands, **not authorized by this review**, are from W:

```sh
corepack pnpm exec tsx tools/native-cache-normal-pilot.ts --mode normal --expected-custodian-sha256 36387d5287ee6977ee1625e9a6ebbe61f2f8992fa4502c19310d11548d9503d7 --expected-fixture-sha256 e3f4ccb1c4016a54356ce04be344b4ffff23f2f88698efe191570ad8407d03ab
corepack pnpm exec tsx tools/native-cache-normal-pilot.ts --mode assertion-failure --expected-custodian-sha256 36387d5287ee6977ee1625e9a6ebbe61f2f8992fa4502c19310d11548d9503d7 --expected-fixture-sha256 e3f4ccb1c4016a54356ce04be344b4ffff23f2f88698efe191570ad8407d03ab
```

C SHA36387d52…/supervisor SHA1d069b38…/tool SHA2dad75da… are current dirty candidate bytes, not old nofork-validated bytes. Python was read/hashed only and still matches e50d468e8b0adfb05733f5b87b3cff34829c4a8c1aea50c865aa8bdfe4bb150f. After named fixes and fresh independent reviews, MAIN must separately release any actual pilot. Normal requires exact1024x0x4a synthetic result and full original C/N/group terminal proof; expected exit1 requires the exact observed fault, same accepted original settlement/cancel cause, no unrelated failure and full proof. Neither current command nor any new C/N/kernel action was run here.
