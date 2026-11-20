# Recovery-family ownership independent review

Candidate `e2eff61b464d75d36598103d718cd2a75db5dfda`, relative to `4f2bb06be6d26dab240e1faeed0163f3edb7c920`. Reviewer supplied prior architecture advice but did not implement this candidate; MAIN implemented the exact five-file delta. This review is bounded to ownership filtering and its explicitly revised regression contract, not independent approval of the entire architecture. Final verification and verdict are in RESULT.json once all commands terminate.

## Findings

No blocking implementation defect identified in the three filters or the ADR reconciliation.

- `AdoptionCoordinator.recoverOnStart`, line488: existing classifier now runs before attention counting, parsing or row mutation, and accepts only `edit` plus adoption format. The known malformed request still reaches validateAdoptRequest and original `coordinator.attention(... ADOPTION_REQUEST_UNREADABLE ...)`; the gate is not bypassed. The second JSON parse/catch is now redundant for an immutable locally classified string, but harmless and not grounds for expanding the patch.
- `HistoryService.recoverOnStart`, line466: exact history kind AND history marker precede attention counting and request parsing. The former marker-only acceptance could take an edit row; this no longer happens. Existing malformed-owned contract handling, oldest-first guard, queue and no-sweep behavior remain.
- `ProjectCoordinator.recoverOnStart`, lines344–363: classification uses freshly enumerated original DB rows locally, not externally supplied IDs or bools. Known rows are skipped even if their handler is unavailable. Unknown rows keep original generic transitions: early states become recovering with terminal_reason, later pending states enter attention. RecoveryStore gate checks all non-committed/non-aborted transactions (revision-store:2087 onward), so skip does not permit writes. Existing recovering rows are omitted by incompleteTransactions and not revived, but remain blocked by the same gate. Generic outbox replay and job reap are unchanged; this patch does not solve dedicated startup lease exclusions.
- The classifier is reused unchanged from controlled-recovery-scheduler:15–28; known format/kind is only ownership, not validated authority. No change to DDL, schema, nine-field closed commit, scheduler progress, public ignore/force, publication, compensation or old edit actor. Sweep still occurs before per-row filtering inside each family, exactly as previously; this review accepts the row-filter change, not a new claim of per-row cleanup safety or full Host resource isolation.

## ADR and regression evolution

ADR-OWNERSHIP-001 is substantively justified: total JSON parse failure gives no reliable adoption marker. Claiming every such row as M4B is incompatible with coexistence of the three owners and the original classifier's explicit unknown behavior. This is an intentional behavior change, not proof that the old corrupt-JSON expectation remained identical.

The two prior malformed-latch tests now give a readable adoption marker with missing contract fields and retain attention/ADOPTION_REQUEST_UNREADABLE assertions. A NEW real Host close/reopen test keeps the exact original `{not json at all` input and verifies generic recovering, CRASH_RECOVERY_REQUIRED in terminal_reason, recoveryGate true and no active commit. Thus safety and observability are retained while responsibility changes. The change is not equivalent to deleting a red assertion to claim the old behavior passed. Unknown recovering is not a recovered writable state, and manual/audited resolution remains outside this candidate. TX-08B's known adoption obligation is retained; cannot claim its terminal-state rule now covers every globally corrupt row.

The Host tests use direct adversarial row creation to inject invalid journal input, then real NarralensHost.listen/close/reopen on original SQLite. That is suitable for ownership rejection testing, not proof of a genuine producer crash or valid adoption workflow. The component fixtures intentionally supply minimal proxy dependencies and real SQLite/original entrypoints; they prove branch selection, order and unchanged gates, not full SOURCE_ONLY publication. The selected Host tests do not invoke the harness's synthetic materialization producer.

## Historical evidence inspected

All seven MAIN raw-log SHA256 values match RECOVERY_OWNERSHIP_MAIN_VERIFICATION.json. Old001 contains eight real assertion failures and two controls passing. Fixed002 is an explicitly preserved old-premise conflict (54 pass,1 fail); type003 is a fixture argument TS2554, host004 is a new assertion reading error_code instead of original terminal_reason (1 pass,1 fail). None is counted as a successful regression or substantive old-source counterexample except old001. Final005 is55 pass,006 is full tsc exit0,007 is2 Host restart pass; these remain MAIN evidence separately from the independent captures in this directory. Original before-files and reports are hashed in before/after manifests and not overwritten.

## Remaining bounded limits

This patch intentionally does not wire production three-family scheduler, NativeSourcePort/selection, bootstrap per-project availability, startup lease exclusion, full close lifecycle, real public review/change producers or SIGKILL. Generic preserves created unresolved rows while created handler remains unmounted, so they stay gated; no overall-ready claim follows. Full route suite, D10 matrix, PRODUCT lifecycle suite, films, exports, A/human acceptance were not rerun in this review. Existing architecture recommendations remain separate, not blockers to accepting this exact small ownership correction.

## Reproducibility

`capture.py` runs only the ticket's pure55 command, full `tsc --noEmit`, and the exact two-case Host selector serially, with raw stdout/stderr, full argv/cwd, timestamps, actual child return codes and process-group census after wait. It snapshots tracked source/tests/contracts/tools/root configuration, HEAD, Git index, protected AGENTS, and read historical evidence before/after. No source/index/config edits, workers, project copies, downloads or extra probes. Only this new canonical evidence directory is authored by the reviewer. Commands use original default concurrency and existing node_modules; actual temporary Host fixtures are those authorized by the ticket.

## Final verdict

**Bounded ACCEPT** for e2eff61. Independently reran55 component cases, full typecheck and the exact2 Host cases: all pass/exit0. Every command was awaited and its process group empty. Before/after manifests are identical, including HEAD/index/AGENTS and read historical evidence. No further commands remain running; return the reserved heavy slot and frozen source custody to MAIN. This does not approve whole Host recovery, Native, SIGKILL or A.
