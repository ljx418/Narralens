# PRODUCT handoff

Base/contract `ca5b67a8285b130c79055317c6202f73cfbb99c8`; manifest
`532cd43c963a1c94de5f8ce34f3c6eb7281fded80047f74dc5dbe1a70aa65170`.
Session `4548ddcb-e870-405b-863f-a17a4a7ed683`. Branch `agent-driven/lane-product`.

**Writer: Claude Code CLI (sole writer). Codex read-only during every write window.**
The earlier CLI invocations ended by controlled TERM (exit 143), **not** by a 429: no
source edits were lost and no child process was left running.

**Repair commit: `5ae49ea321ed70cba177ff43b5f381f15d0aba8d`** on `agent-driven/lane-product`.
It contains only the lane's own source, test and document paths; MAIN's release
assignment, the Codex scratch notes and the raw CLI transcripts were left untracked. The
commit that carries this handoff follows it.

**State at the end of this session: SOURCE REPAIR batch 1 complete, source only, nothing
executed.** The PRODUCT light slot is released to MAIN, so there was no install, no `tsc`,
no test run, no browser, no Host and no ffmpeg. Every test in this lane is `NOT_RUN`.

---

## 1. The repair batch in one paragraph

The first independent acceptance was: install exit 0, `tsc` exit 2 with 8 errors, `vitest`
exit 1 with 37 passed / 15 failed / 52. This batch fixed all eight compile errors and all
fifteen failures, and addressed the seven consolidated review cases. Six of the fifteen
failures were **false**: the UI tests never cleaned the DOM between the cases, so every
query found the earlier panels as well. The other nine were real, and the biggest cause
was the test repository: it treated a mutable-state row as an append-only row, so a run
whose state advanced raised an idempotency conflict, and its `list` matched the row's key
instead of the row's own columns, so the intake confirmation was never found. The
repository was not made laxer to make the tests pass — it now enforces the foreign keys
the frozen SQL declares between the lane's own tables, the trusted-evidence triggers, the
one-active-attempt index and the immutable binding columns.

The full case-by-case record is `logs/2026-11-09-source-repair-batch1.md`. The first
failure logs (`logs/install-first.log`, `logs/tsc-first.log`, `logs/vitest-first.log`) are
unchanged.

## 2. What changed, by the review case

| Review case | What the repair does |
| --- | --- |
| 1. The types must match the frozen DTOs | `Change` has `materialization_id` and no `change_id`; the adoption uses `materialization_id` and invents no wire field. |
| 2. The guard must fail closed | `guardExecution(binding, effect, facts)` takes the durable facts as a **required** argument; `guardExecutionInTransaction(...)` reads the run, grant, attempt and gates from the lane's records and guards against them. The scope digest is recomputed, the grant's state and expiry are checked, the principal has to be the grant's, the attempt has to be the current live one, the run has to be dispatchable, and the stage's gates have to be accepted. A safe control checks the identity only. |
| 3. Creative compare-and-set | An unchanged brief does not advance the version; the brief's owner is checked; the material strategy has to agree with the brief; the style digest is recomputed. |
| 4. Run preparation | Only an `accept_content` decision on the current intake head starts a run; the closure is recomputed; a mandatory unanswered question blocks; every ref has to resolve to a real artifact; the project facts come from a **mandatory** read-only port; the definition gate starts accepted and bound to the content decision. |
| 5. Review | `chapter_pack` needs the sample **and** the first chapter; an `audio` package satisfies no gate; a reuse has to match the chapter, the input, the output and the quality; publishing the same package again is a safe replay; a package has to name the current live attempt; a decision has to be allowed and bind the current version and digests; an adoption validates the impact and names the real step and attempt; the trusted confirmation MAIN returns is checked. |
| 6. Workflow projection | The run is chosen deterministically; `observed_at` is the checkpoint's write time, not the clock at read time; `recordStepAttempt(...)` records a genuine job event for MAIN. |
| 7. The R4 surfaces | Creative stage names in the rail and the internal id in the detail; the observed time and the connection state in the collapsed bar; a focus-trapped task dialog with Escape and the focus return; a system aside that closes on Escape and returns the focus; stale, future, unreadable and expired samples shown as unknown; unmeasured metrics shown as unknown; the native sync only claimed against a matching revision, snapshot, source **and** selection; the review panel delegating playback to the host's own player. |

## 3. What was verified, and what was not

**Verified.** Nothing was executed. The only checks were reads: the frozen golden vectors,
the frozen schema, the frozen migration SQL and the frozen registry were read to make the
record shapes and the error map exact.

**Not verified.** No `tsc`, no `vitest`, no browser. The eight compile errors and the
fifteen failures are addressed **in the source**, not demonstrated green. The lane does
not claim that the A round or the module is ready, and it does not claim an independent
review — Codex has to run the type check and the tests on a new light slot.

## 4. What MAIN has to answer

MAIN's decisions on the earlier requests are **final** and are recorded in
`requests/003-idempotency-scope-and-route-ownership.md`:

- the pre-project idempotency namespace is the existing `operation_idempotency` table with
  `project_id = 'principal:' + <authenticated principal>` before the project exists and the
  real project id afterwards, `operation_kind = 'agent.v1:' + <operation>`, the receipt and
  the original response in the same transaction, and no new ledger;
- the seven sensitive `businessProducer` registry entries remain MAIN's; PRODUCT supplies
  pure domain helpers, MAIN verifies the trusted channel, the principal and the currentness
  and injects the authority inside the same transaction; the Coordinator consumes the
  adoption approval in the final commit;
- `intake.confirm` remains MAIN's trusted-UI entry;
- the gates live in `checkpoint_json`, the `ReviewPackage` body in an artifact version, the
  wire `plan_sha256` maps to `action_digest`, and the non-run events reach the outbox only;
- the bootstrap command lifecycle state is MAIN's dedicated service; the lane's surface is
  the initial append-only reservation and the read.

The one open item is `requests/004-project-fact-port.md`: MAIN has to implement the
mandatory read-only `ProductFactPort`. The lane cannot verify the project's existence,
the material rights or the registered capability on its own, and it refuses to prepare a
run without that port — by design, not by accident.

The style digest formula is the lane's proposal and is in request 004 §5 and
`INTEGRATION.md` §6.1; MAIN's brief writer has to match it.

## 5. How to pick this up

1. Read `INTEGRATION.md` first — it is the wiring document.
2. Read `requests/002-exact-record-mapping.md` next — it is the adapter contract.
3. Read `requests/003` (the final decisions) and `requests/004` (the one open item).
4. Read `logs/2026-11-09-source-repair-batch1.md` — it is the repair record.
5. Then implement the adapter and the fact port, release the resources, and run:

```sh
pnpm exec tsc --noEmit
pnpm exec vitest run --config vitest.config.ts tests/agent-driven/product --maxWorkers=1
```

The lane stays stopped until MAIN explicitly hands it back. It does not push, it does not
touch `main`, and it does not re-open a write window on its own.


## Codex acceptance intake after repair1
PID3600132 and exec59724 exit0, no remaining child; source5ae49ea321ed70cba177ff43b5f381f15d0aba8d and docsdb7241cbc36481844006e964de84b799fe371da7. Current writer Codex for docs/acceptance only. Claude stopped pending next explicit handoff. BRIDGE owns light slot; tsc/vitest repair1 NOT_RUN. Latest MAIN style/final-dispatch decisions appended request004. First FAIL logs retained unchanged.
