# R4B exact nofork residual independent review

**STATIC_SAFE_FOR_EXACT_NOFORK_IDENTITY_AND_ASSERTION_FAILURE** for the two exact commands below, at the bound dirty bytes only. No substantive residual or new reachable safety regression was found in this slice. This is static permission-readiness advice to MAIN, **not runtime permission, runtime PASS, production acceptance or a new accepted freeze**. Historical HEAD remains `1d348d419120f23f45d958112ea8c43df5a04675`.

The complete tool and test were read as text, with the authorized report, release/spec, snapshot/audit and prior R4A review. All3 bound current source/test/report hashes and sizes match the snapshot; all25 protected entries and AGENTS match release protection. All61 inspected or hash-checked inputs have identical entry/end hashes and byte sizes in INPUTS.json. Protected files other than the relevant C startup/integrity path were hash-checked only; this review does not re-review production lifecycle. No source, tests, config, Git/index or existing reports/evidence were changed.

## Assigned residuals

**R4A-NF01-A CLOSED_STATIC.** `main` at1378 first constructs `createReportingBoundary`; its persistent stderr error listener at917 is installed before any spawn. REAL_DEPENDENCIES supplies the actual process.stderr stream and a two-argument write callback adapter at1013. The boundary handles both asynchronous error events and write callbacks, deduplicates the same error object, retains the first bounded failure plus at most8 failure summaries, and stops writing after failure. It does not recursively report or retry broken logging. Pending callbacks are awaited before final qualification.

The actual HELD main branch at1439 continues waiting on the same ledger/close promise/root despite EPIPE or outcome/held evidence errors. Reporting failure cannot itself end live ownership; no listener is removed and no extra signal is sent. The new test at1112 uses the same actual boundary through actual main with a Writable-shaped emitter, delayed callback and actual emitted error, rather than only an array writer. It asserts main remains pending and the root/TERM-KILL history unchanged, then injects exit+close+freshgone before failed return and verifies final EPIPE retention once. This is a valid branch counterfactual, not captured old-code failure or real EPIPE/kernel evidence.

**R4A-NF01-B CLOSED_STATIC.** At1354 an outcome-write failure now clears identity_proved, fault_case_passed and evidence_published, sets failed and records unexpected evidence-write while preserving the exact original assertion failure and cleanup proof. The test at1164 runs actual runPilot and main in an already-terminal intentional-fault case with outcome ENOSPC. A failed write no longer leaves the returned fault flag true.

**R4A-NF02-A CLOSED_STATIC.** Decoder180 terminally fails/reset-releases its invalid buffer; later feeds return empty before retaining new chunks. Ledger498 queues at most one failure marker, retains the first failure and keeps existing valid queue budgets64frames/256KiB. takeControlFrame544 decrements queued bytes. Tests1212 and1234 exercise actual decoder/ledger with3000 post-fatal chunks and real queue consumption. The fixed small C HELLO decode path remains possible without expanded budgets.

NF03..06 retain CLOSED_STATIC. The shared full-terminal predicate, async no-PID spawn-error handling, fresh actual-parent identity checks and prior four-failed-R4-captures correction were not regressed. No production-N defect is introduced as a prerequisite for this nofork-only stage.

## Ownership and exact boundary

The standalone argv parser still admits only identity/assertion-failure and expected C SHA, with no executable/PID/group/signal override. Spawn remains fixed Python -I -S -B, repository cwd, detached and fixed private allowlisted HOME/XDG/TMP environment. Root is registered before spawn; child/error/exit/close/stream listeners and one close promise are installed immediately before the first wait. There are no AUTHORIZE_FORK/GO/control write calls.

Protected C starts its selector/signal setup, verifies its integrity, validates detached SID/PGID, then SET/GET subreaper and emits C_HELLO. Its N-fork path requires AUTHORIZE_FORK, which this tool never sends. Thus exact-owned C TERM then KILL is legitimate here even if no-N C recovery persists; this gives no production C-kill authority. Only the issued ChildProcess is signalled, after full fresh PID/startticks/PPID/PGID/SID and live/exit-code checks without an intervening await. No process-name/global/group-number kill is added.

Cleanup, result qualification and HELD recovery still share full checkTerminalProof: actual ChildProcess close, an exit fact or legitimate error+close no-birth, and fresh original epoch absence/replacement. Replacement proves absence only, not authority over the new process. EOF/error is not process end. Unknown retains actual owner/root/close promise indefinitely with referenced bounded polling, not a busy loop or responsibility expiry. No new real-default post-spawn I/O exception route that discards this owner was found. External OOM/forced destruction of the runner remains outside this harness's guarantee.

## Result qualification and artifacts

MAIN must apply its stated combined validator. Identity requires exit0 and kind ok, proven identity, complete matching cleanup/terminal proof and no unexpected/evidence/reporting failure. Assertion-failure uses exit1, but only the exact EXPECTED_ASSERTION_FAILURE with fault_case_passed, full proof and no unrelated failure qualifies. Arbitrary exit1 is failure, and HELD recovery ending1 is failure rather than an expected-fault pass.

A late reporting error can leave an earlier candidate outcome.json looking green; main clears in-memory eligibility, writes best-effort **reporting.json**, and returns1. This is not a live orphan. **There is no positive report.json file in this implementation.** final.json is the HELD recovery record. outcome.json also does not serialize evidence_published/evidence_errors/reporting_failure, so the report's in-memory predicate must not be misquoted as on-disk fields that were observed. Validate all actual artifacts, capture/exit and reporting state together; contradictions, failed/missing required publication or incomplete proof are not acceptance. Never infer an accepted expected fault from candidate outcome alone. A partial candidate after a failed write is retained historical evidence, not a committed proof. No production rewrite is needed for this qualification.

## Captures and limits

Existing four R4B cmd/claim/result/exit/log sets were hash-checked and their metadata read. Both test logs say53/53, all four exits0 and source_changed/source_added empty; raw log hashes match result and MAIN audit. test001 binds the prior test SHA378e3e5d… rather than final test bytes and remains historical. test002 and both syntax captures bind the final tool/test/C hashes. Only the selected source/C input receipts were independently compared; MAIN's full649-input audit was read, without opening config/user payloads.

The prior R4A final log's49 case names are all present in the53 current actual test cases; the four new cases exercise actual main/runPilot/ledger/decoder. Real spawn/root guards throw before forwarding, and entry guard prevents main autorun on import. These53 are **pure boundary mocks**, not53 kernel experiments. Old failures and UNRECORDED admissions remain historical; this review neither fabricates missing logs nor claims new green counts repair them.

## Exact future ticket

From `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`, only after MAIN separately releases the ticket:

```sh
node tools/native-cache-nofork-pilot.mjs --mode identity --expected-custodian-sha256 6b8d6df32b1958b3cf53e05152e9b04abf6c010d58ae6e672fcd7fa4c9511618
node tools/native-cache-nofork-pilot.mjs --mode assertion-failure --expected-custodian-sha256 6b8d6df32b1958b3cf53e05152e9b04abf6c010d58ae6e672fcd7fa4c9511618
```

- Tool SHA256: `73fed24c66ec310ccd811fdd7e4dfb51be6d22875ce81a50e1a86a47072fe00d`.
- Test SHA256: `feb9786b4f38044382ab6ac2ca8435f3bdf89ae83c0882b47177573136deb5ce`.
- Report SHA256: `fb2bbc264c529b096eb96865ce6735f566ca5921774e7f0e0b3956bb5cdb5902`.
- C SHA256: `6b8d6df32b1958b3cf53e05152e9b04abf6c010d58ae6e672fcd7fa4c9511618`.
- Fixed Python `/usr/bin/python3.12` SHA256: `e50d468e8b0adfb05733f5b87b3cff34829c4a8c1aea50c865aa8bdfe4bb150f`.

Fresh pre-execution hashes, one run/root at a time, no added control writes, actual identity/exit/close/freshgone observation, retained root/artifacts, and combined result validation are the scope boundary. An unknown must remain owned, never be reported as ended because a timer elapsed. Real detached/kernel/prctl/C/Node close ordering/stderr EPIPE and the two CLI commands remain **NOT_RUN by this reviewer**. No tests, imports or child experiments were run. Production14 remain OPEN; original17, ISO18, N1N2, full gates and NEXT remain OPEN/NOT_RUN as applicable.
