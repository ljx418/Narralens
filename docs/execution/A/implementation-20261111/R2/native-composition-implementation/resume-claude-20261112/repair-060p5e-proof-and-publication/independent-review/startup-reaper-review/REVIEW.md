# R5E independent startup/reaper static re-review

**SAFE_FOR_SEPARATELY_PINNED_MINIMAL_N_PILOT** — recommendation for the separately released two synthetic N pilots only. This is neither runtime authorization nor kernel/business acceptance. Historical HEAD `1d348d419120f23f45d958112ea8c43df5a04675` is not a new frozen candidate; the reviewed dirty bytes are bound by INPUT_SNAPSHOT.json SHA256 `32cd03c8aabbfd21f5ca8093777330fafc5897edfbf208ff479a7c61f8e7e233`.

Reviewer task `task_32be669a8e69` / dispatch `ctx_a168b1218e41` was independent of implementation. Only text, metadata and hashes were inspected. No tests, imports of product code, real pilot/CLI, child launch, wait/signal/prctl, browser, Host, HTTP, media or network was run. INPUTS.json records 95 unique inspected/hashed files, their full start/end SHA256 and equality; no drift was found. The eight source/test inputs, protected seven and report match the snapshot. Supporting host-module hashes also match the generated integrity manifest. Other manifest entries/upstream/runtime binaries were not executed or independently revalidated here.

## Safety decision and original findings

The former material defects in R5D-N01/N04 and overlapping O03/O04 are CLOSED_STATIC. The publication/hash defects N02/N03 and overlapping O01/O02 are also CLOSED_STATIC for their concrete old triggers. Findings.json records exact paths, actual calls, premises and future decisive tests. This does not claim that a mock gate proves Linux identity, adopted reaping, process groups or Chrome behavior.

* **Original group proof:** at cache-process-custodian.py:2130, immutable original_worker_epoch now determines the proof obligation even after destructive authority was revoked. _settle_domain passes that original group to TargetSettlement. Its final group_state is a real raw probe through KernelSettlementOperations; empty census/ECHILD cannot replace it. EIO remains held; later ESRCH can complete the same responsibility. Nonzero signal dispatch still passes _authorise_signal each time, so this change does not restore permission after reap/ECHILD or aim at a replacement.
* **Actual counterexample:** the new Python test drives _settle_domain and the production kernel adapter under explicit raw-edge mocks. A mocked raw TERM produces Z; mocked waitpid actually consumes N. A later uncertain phase revokes permission. It then independently makes census/children empty and raw original-group probe EIO, asserting that proof remains false and the original raw signal0 was attempted; changing only that probe to ESRCH completes without any new destructive raw call. This checks the former bypass rather than a duplicate state-machine oracle.
* **Pure boundaries:** both TS suites intercept process.kill before cases, default-deny unregistered calls and retain the wrapper for pending callbacks. child_process launches are mocked/denied. The independent denial ledger is asserted even when production catches a refusal, with script/ledger cleanup in finally. The old actual-supervisor held/no-FORKED synthetic4242 route now uses an explicit mock signal script. Python globally guards the reached os signal/fork/exec/wait edges, ctypes loaders and signal registration; _FakeOs no longer forwards dangerous omissions or defaults all groups to gone. These guards are for these tests and reached calls, not an adversarial native sandbox.
* **Publication:** required candidate/helper names, row errors/null hashes and candidate/manifest links are considered before final qualification. The default writer uses an exclusive same-root temporary file, full write, successful close and rename. A failure revokes returned kind/fault/authority and gives exit3 while preserving original draw/cleanup facts. main waits reporting and enforces publication-v2. The real legacy caller now reads serialized bytes and their links and keeps evidence on failed joint qualification. Its local predicate is separate code; the mixed lifecycle file was typechecked but not executed, and the consumer-shaped pure test is not execution coverage of that exact predicate.

R5D-NOTE-01 is CLOSED_STATIC by the fail-closed Python boundary. **R5D-NOTE-02 remains open as a non-blocking evidence item:** snapshot summaries still omit computed events_digest/waits_digest/identities_digest strings (supervisor.ts:1927,1958; tool.ts:1527). Counts/flags and raw_segments_saved=false are honest but do not fulfill the requested bounded digest copies. OWN section6's minimum-closure claim is therefore too strong. Copy validated bounded immutable digest strings in the later evidence slice or explicitly keep the note pending; full raw segments/R6 are not requested by this note.

Cancellation primary/secondary, one CANCEL, accepted late N and reserved-handle ownership remain on the byte-identical supervisor baseline. The runner retains the same start promise, does not cancel normal pending work, guards fault injection with bound GO and a fresh full live epoch, continues cleanup until actual terminal facts, and never substitutes cwd for a missing root. No new concrete safety regression in these affected paths was established.

## Capture authenticity and limits

I read the six final claim/cmd/inputs/result/exit/log artifacts and checked each log hash against its result and the snapshot audit. All six captured input maps equal the snapshot's same 651-entry recorded map; every result records empty source_changed/source_added and exit0. This comparison is against recorded metadata, not an independent audit of all 651 current payloads. The final command cwd and argv match the release. Logs report identity86, Python59 and pilot54 cases; these counts are evidence metadata, not contract coverage.

The final tsc log is empty with its correct empty SHA256. Generation reports integrity SHA256 `9860bcb1b5888bf66636592464fc02f24453abaab8dd3245ac1d96995afe8a7b`; check reports checked8. I did not rerun either command.

The oldlogic-red capture records two ordinary assertion failures: the original raw group probe is absent and a supposed terminal third pass incorrectly returns true. The Python test source digest equals the final test digest. Its C input is `2c4998e29d930c8da397c808d4d4388cc8d2b0d5c3886d8f363b0a1819d67033`, not the final C. Other TS/manifest inputs also differ from the final capture. There are no syntax/import failures in this log, but without archived old C bytes I do not certify a literal single-line-only mutant. The current source and independent probe controls provide the static basis.

Historical red-python-002 remains a real unauthorized raw-call incident; reported ESRCH or later PID absence does not prove no historical effect. fix-pilot-004 remains MAIN's exact-stop outcome, not a semantic red. fix-pilot-005 still lacks result/exit and is INCOMPLETE. No old evidence was overwritten or fabricated. Earlier greens and failures do not authorize a new C/N runtime.

## Exact separately released next scope

Working directory: `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`.

Reviewed pins:

| Input | SHA256 |
|---|---|
| Custodian | bd06d7d7f79d6d2ccf2204a4e27ed5aba5364cbcda71785a67ac3ab887306b79 |
| Supervisor | 049489317e8f4f37be77556a90698c82027c8d8d4bf0ee51d15c15862b26d553 |
| Pilot tool | 80f3a68f7c5b828d69a6c00140a98efca1bfb1114387cfd6997647ffe0b0dfe8 |
| Synthetic helper | e3f4ccb1c4016a54356ce04be344b4ffff23f2f88698efe191570ad8407d03ab |
| Integrity manifest | 9860bcb1b5888bf66636592464fc02f24453abaab8dd3245ac1d96995afe8a7b |

The manifest declares /usr/bin/node and /usr/bin/python3.12, Python SHA256 `e50d468e8b0adfb05733f5b87b3cff34829c4a8c1aea50c865aa8bdfe4bb150f`. That is the manifest pin, not a fresh binary hash measured in this static review. Linux /proc, actual subreaper behavior and the separately reserved unique runtime root are environmental prerequisites; no cross-platform claim is made.

Proposed exact commands, **NOT_RUN and requiring MAIN's separate release**:

```sh
corepack pnpm exec tsx tools/native-cache-normal-pilot.ts --mode normal --expected-custodian-sha256 bd06d7d7f79d6d2ccf2204a4e27ed5aba5364cbcda71785a67ac3ab887306b79 --expected-fixture-sha256 e3f4ccb1c4016a54356ce04be344b4ffff23f2f88698efe191570ad8407d03ab
corepack pnpm exec tsx tools/native-cache-normal-pilot.ts --mode assertion-failure --expected-custodian-sha256 bd06d7d7f79d6d2ccf2204a4e27ed5aba5364cbcda71785a67ac3ab887306b79 --expected-fixture-sha256 e3f4ccb1c4016a54356ce04be344b4ffff23f2f88698efe191570ad8407d03ab
```

Normal must have actual external exit0, final kind ok, exact 1024 bytes of 0x4a, original successful settlement and complete fresh terminal proof. Fault must have actual external exit1 **and** final fault-observed/fault_case_passed=true, exact EXPECTED_ASSERTION_FAILURE as the original error/cause, primary DRAW_CANCELLED, no image, no unrelated transport/report/evidence/cleanup failure and full terminal proof. Arbitrary1 is failure.

MAIN's recorder/validator must jointly verify actual final bytes/hash, candidate/manifest links and every required artifact's real digest, protocol positive-pilot-publication-v2, original settlement/cleanup and fresh terminal observations, reporting success and outer exit. No file alone, returned kind alone, elapsed time or exit code alone qualifies. Exit2 is refusal; exit3 is unreliable publication/evidence and never an expected fault. Unknown ownership retains the same root/handle/promise and continuing responsibility; no deadline authorizes resource abandonment or C killing on N-positive paths.

This is a synthetic no-browser admission recommendation, conditional on the companion owner review and MAIN's exact ticket. Real N kernel proof, original17/ISO18, R6/R7/R8, N1N2, NEXT and V1 remain OPEN/NOT_RUN. No accepted new commit, runtime PASS or final acceptance is signed here.
