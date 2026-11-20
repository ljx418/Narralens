# R5D targeted startup/reaper independent review

**REQUEST_CHANGES.** Four MAJOR findings remain: the original group proof is still dropped after signal revocation; required hash errors can leave final qualification green; final-write failure leaks a green returned result to the real legacy consumer; and a current purported pure identity test can reach real process.kill on synthetic PID4242. Fix/guard the last item before rerunning that pure command. No experiment was run to confirm it and no historical recipient/effect is inferred.

All8 source/test hashes,7 protected hashes and the report match the R5D handback snapshot. All91 inspected/hash-checked inputs have identical start/end SHA256 and byte counts in INPUTS.json. Historical HEAD1d348d419120f23f45d958112ea8c43df5a04675 is not a new freeze. Only these new review documents were written. Tests/imports/C/N/CLI/fork/wait/signal/prctl/kernel/Host/media/browser/HTTP/network/install/env/credentials were **NOT_RUN by this reviewer**.

## Current raw test isolation is not fail-closed

The Python200 incident is real out-of-scope runtime, not a pure semantic counterfactual. red-python-002 attempted real os.kill(200,SIGTERM); the author says ESRCH. Later absence of PID200 does not retrospectively establish no effect, and this review did not repeat the call. Its current raw fixture installs both fake_os.killpg and fake_os.kill, repairing that exact omitted route.

A **separate current TypeScript path is reachable**. In cache-process-identity.test.ts1151, the no-FORKED case creates FakeChild4242, returns matching synthetic /proc text and accepts C_HELLO, then waits for cleanup-held before later emitting exit/close. The real supervisor's #terminate3057 sees no exit/close and #custodianIsStillThisProcess consumes the fake matching epoch, so it invokes **real process.kill(4242,SIGTERM)**. Only spawn and filesystem reads are mocked. There is no process.kill spy/deny implementation in that file or the companion positive-pilot test, and the read project Vitest config has no setup guard.

That is a concrete tested call path, not a generic warning about hypothetical future tests. A real unrelated PID4242 could receive it; otherwise it can fail with ESRCH and the negative test can still look green because the production catch stores the error. No claim about a historical recipient is made. Add raw deny/injected signal boundaries before any supervisor execution, including signal0 and all nonzero/group forms. Check no-FORKED, late-close, held and transport failure cases without forwarding synthetic identities to the OS. Do not use real PID existence probes as a workaround.

Python _FakeOs.__getattr__ also still forwards unlisted operations such as kill/fork/exec to real os. The new raw fixture explicitly overrides kill/killpg, and other reviewed adapter classes override both signal wrappers and waits, so a second current Python leak was not established. Nevertheless deny-by-default for unmocked dangerous raw edges is required hardening after the incident; default synthetic ESRCH should not silently replace a missing mock. No actual fork/wait/prctl/signal probe should be used to test this guard.

## R5C-N02/N03/NOTE01 are statically closed

requestCancel now preserves the first accepted Error and immutable primary provenance. Later same/different cancels become bounded secondary facts; cancelSent still makes control CANCEL one-shot. Actual supervisor tests cover repeated reserved cancel and started/held cancellation, and the real pending runner combination uses cancelIssued. This fixes N02 without changing issuer/public/MCP authority.

The unbound C branch now queries the issued born ChildProcess PID after genuine exit/close. Fresh gone can settle the original failed no-authorize handle; unknown or known without a bound epoch stays held. Bound same epoch, **including Z**, is refused. Verified HELLO fallback and authorize-sent/missing-proof refusal remain. Actual start/reconcile EIO→late exit/close→ENOENT and known/unbound negatives were read. This closes N03 and NOTE01. It does not claim that fake close/Z events demonstrate a real kernel orphan.

The added terminal observation copies arise in #proveDomainGone itself with timestamps rather than being fabricated in the tool. Raw cleanup facts and final diagnostic cleanup_failures now participate in both normal and fault qualification; rmSync-failure testing uses the actual supervisor edge. This closes the prior raw-cleanup note for its specific predicate.

## R5C-N04: evidence continues, but original group obligation still disappears

TargetSettlement no longer returns forever merely because authority_lost is set. It continues census/reap/ECHILD and reports anchor_state from actual facts, fixing the old hardcoded held anchor and proof-starvation mechanism. Raw dispatch still checks original wait/epoch authority and cannot reacquire a replacement PID/group. Ordinary owned TERM-ignore retains a one-KILL convergence path.

However, _settle_domain2131 still establishes its **proof group** only while signal_authority!='revoked'. Once revoked, it passes group_established=false/group0 into TargetSettlement. At948 the latter substitutes group='gone' and never calls raw group_state for the immutable original PGID. Revoking a signal capability cannot remove that proof obligation.

A direct counterexample uses actual mock waitpid consuming N, post-reap authority refusal, then group_members=[] while raw killpg(originalPGID,0) remains EIO. Census enumeration and group ESRCH are separate obligations. Current code can return group_esrch=true without querying the original group. This is a concrete false-proof branch, not a claim that every such execution physically retains a process. Identified-N Host checks add protection, but C receipt proof is also used before an accepted N HELLO. Derive original group evidence from immutable epoch irrespective of signal permission; keep every dispatch guard irreversible.

The updated raw Python case does now pass through mock waitpid consuming the zombie N, rather than only setting anchor_reaped. That is an improvement. Its unknown_group flag, however, couples group enumeration and group probe together, and later clears both. It checks that nonzero signals are absent but never proves a final killpg(0) query happened after revocation. Separate those raw outcomes in the counterexample.

## R5C-N05: retained refusal storage is bounded

_record_signal retains32 first plus32 recent facts and a total, sets saturation/failure conservatively and preserves the existing first failure. Sent alone consumes TERM/KILL debt; refusals leave it owed without a responsibility timeout. The current raw EPERM fixture tests the real signal wrapper's errno handling rather than replacing only the wrapper, and later allowed local cleanup converges. This closes the original unbounded-string history defect statically. It is not full R6 receipt/overflow semantics acceptance or evidence that a real TERM-ignore/EPERM kernel scenario ran.

## Asynchronous modes and final publication

The previous immediate normal cancellation and fault pre-wait refusal are fixed: normal pending is ordinary progress, the original start promise is observed from creation, and fault first waits for accepted N before bound GO plus the final synchronous full-epoch/live check. Actual CacheProcessSupervisor + FakeCustodian/proc protocol tests now yield macrotasks with Date.now/setTimeout, so they no longer rely solely on synchronous stub success or a starving microtask clock. All-path original-promise terminal continuation remains active through errors/held cleanup.

The reviewed R4B factory is still actually shared by main/runner; real callback/error-shaped Writable tests include late EPIPE and pending original settlement. Root-allocation failure no longer writes evidence at empty-root/cwd. Candidate is explicitly not authoritative, report callbacks precede final publication, and manifest/final exclusion avoids a self-hash cycle. These are real corrections.

Two qualification gaps still matter:

1. **Required per-file hashes are not enforced.** artifactFacts315 writes each null digest/error but returns top-level error:null. judge only receives that top error. The final candidate_sha256/manifest_sha256 are also reread after the judgement and may become null without disqualification. Thus final can claim ok/fault_case_passed while its manifest has an errored required artifact or a required link hash is missing. Propagate row errors and validate required links before judging. Existing test overrides top-level listing error; it misses the actual mapper behaviour.

2. **Final-write failure does not revoke the returned qualification.** writeEvidence(final.json) errors set authoritative=false, but finalKind/finalExitCode/faultCasePassed still come from the earlier green judgement. Direct runPositivePilot can therefore return normal ok/0 or fault-observed/true after failed final publication. The real legacy normal consumer at lifecycle254 checks those fields, image and terminal boolean, but never authoritative or the final/manifest chain; it can pass. main does reject !authoritative by exit1, yet expected-fault exit1 is also1. If a failed write leaves a full-looking green final JSON (e.g. error after visible writes), expected exit alone cannot distinguish the known publication failure.

Revoke all returned eligibility on final-publication failure, make that failure externally distinguishable from the expected fault, and update actual consumers to require the joint artifact protocol. A test should serialize the bytes of final before throwing EIO and read that snapshot; retaining a live object reference lets later evidenceErrors mutations masquerade as bytes already persisted. This is evidence/result integrity after resources are terminal; no orphan is alleged.

The report's instruction to read final **or** exit is wrong for this gate. Acceptance requires final + complete error-free manifest and matching candidate + original settlement/cleanup + actual fresh terminal facts + matching outer exit. Arbitrary exit1 is never proof of an expected fault. Receipt summary currently persists counts/flags but not the computed event/wait/identity digest strings; raw_segments_saved=false is honest, but do not claim a saved digest-reproducible transcript. Copying existing bounded digest facts is a narrow evidence correction, not a demand for R6 full segment replay.

## Recorded facts and limits

Read RELEASE/SPEC/MAIN adjudication, handback snapshot/report, prior R5C review, rev3 contract/ADR and MAIN implementation-phase records. MAIN_ZOMBIE clarification correctly says same original Z must be reaped/gone. MAIN_RED_FIXTURE_CAUSALITY distinguishes missing interface/fixture reachability from semantic red; this review does not count every red as proof of an old defect.

MAIN004 records show exact owned pidfd cleanup of the hung mock-test worker and subsequent actual recorder exit1; that is test cleanup, not business/kernel acceptance. MAIN_MICROTASK_STARVATION explains the fake-clock/timer failure. 005 retains its claim/cmd/inputs/log and **no exit/result**, with MAIN's in-flight observation separate from any eventual status; no outer timeout code is substituted. R5B's earlier INCOMPLETE remains historical.

Final six cmd/claim/result/exit/log sets were read/hashed: all exit0, logs report identity84, pilot43 and Python54, and raw hashes agree with result metadata. MAIN_PRELIMINARY_FINAL_CAPTURE_AUDIT binds651/current source8/protected7 with no drift; this review attributes full651 comparison to MAIN rather than opening config/user payloads. Counts prove recorded unit/type/generation results, not real C/N semantics. In particular the current TS raw-signal escape prevents certifying the entire identity run as purely mocked from the author label alone.

No new real C/N pilot or kernel experiment ran. This review also did not repeat the leaked Python call or the newly found TS route. Source reasoning is not a captured failure.

## Minimal next action and exact future boundary

Fix the original-group proof bypass, hash/publication qualification and actual legacy consumer; isolate the concrete raw TS signal route and add raw deny guards before any next purported pure test. Re-review the same bound bytes and affected counterexamples. Do not add C-KILL, global kill, responsibility expiry, public APIs or an unrelated backend. R5A/R4B closed subbehaviours remain preserved; R6/R7/17/ISO18/N1N2/NEXT and final R8 freeze review remain OPEN/NOT_RUN.

The two proposed commands remain **unreleased** by this review, from W:

```sh
corepack pnpm exec tsx tools/native-cache-normal-pilot.ts --mode normal --expected-custodian-sha256 30583caab4024b3e4131183e19d60635b1711735892640c5dc7d7e0db34c34f2 --expected-fixture-sha256 e3f4ccb1c4016a54356ce04be344b4ffff23f2f88698efe191570ad8407d03ab
corepack pnpm exec tsx tools/native-cache-normal-pilot.ts --mode assertion-failure --expected-custodian-sha256 30583caab4024b3e4131183e19d60635b1711735892640c5dc7d7e0db34c34f2 --expected-fixture-sha256 e3f4ccb1c4016a54356ce04be344b4ffff23f2f88698efe191570ad8407d03ab
```

Current supervisor SHA04948931…/tool SHAa9e343cc…/C SHA30583caa… are dirty handback bytes, not an accepted commit or old nofork-validated C. Python was hash-read only and still matches e50d468e8b0adfb05733f5b87b3cff34829c4a8c1aea50c865aa8bdfe4bb150f. Future normal requires exactly1024x0x4a synthetic payload and full original cleanup/fresh proof; expected fault requires the exact same accepted original cancel cause, no picture/no unrelated failures, valid final chain and matching outer status. Both actual commands remain NOT_RUN.
