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

## SOURCE REPAIR batch2 transfer
Independent repair1 tsc exit2 (10 diagnostics), vitest exit1 (84 passed/5 failed/89) recorded tsc-repair1.log/vitest-repair1.log; no runtime processes remain. PRODUCT light slot released to MAIN. Claude resumes same UUID for source-only batch2 with exact failures and final MAIN style-carrier/fact boundary decisions. Codex read-only until exit.

## MAIN-directed Codex implementation takeover
Repeated root causes after two actual checks triggered MAIN explicit AGENTS third-rework takeover. Newly launched Claude repair2 PID3658688/exec77491 controlled TERM exit143 before any source changes, no descendants remain. Unique implementation writer now Codex. Logs retained; next tests are internal validation only, independent review pending MAIN/nonimplementer. No further Claude implementation loop.

## Codex takeover stable implementation outcome
Common root fixes produced tsc-codex1 exit0. First internal test run 97/98 (exit1) retained in vitest-codex1.log; the remaining domain-error precedence was corrected without weakening assertion. Final vitest-codex2 exit0: five files/98 tests passed26.10s; exec51186 ended, no remaining process, light slot released to MAIN for MEDIA. Original first/rework failures untouched. Internal validation only: Codex participated in implementation, independent review REVIEW_PENDING. MAIN Host/media/browser/human acceptance NOT_RUN. Details/hashes verification-codex.json.

Selected styleRef now names kind=brief carrier, sha256 entire validated Brief, style matches selected intake fields/version/recomputed digest. MAIN must create/discover that carrier. Guard change.prepare/change.apply may target sample/first_chapter/chapters/cover only with the same durable step and required predecessor gates; this never generates finite adoption approval or consumes it, which remains MAIN/Coordinator. guardExecutionInTransaction is a checking convenience, not an effect transaction; MAIN must call readGuardFacts+guardExecution inside its actual dispatch/apply serialization boundary. Preparation facts are only pre-read, and actual capability fingerprint is still pending MAIN source decision.

## Registered capability field final alignment
MAIN accepted request005: ProductProjectFacts.capability_fingerprint required64hex, RunPrepare consumes actual MAIN-supplied value rather than hashing capability names. Missing/malformed facts fail closed. PRODUCT produces no production descriptors. Added supplied-value and invalid/missing unit cases. Source-only amendment after 98/98 green; final tsc/vitest recheck pending next PRODUCT-light admission. MEDIA may use its current slot.

## Final PRODUCT source candidate
Implementation SHA **9eb701d901cf39aa03a7ea3d04cc5a938fa3386f** (all source/tests remain frozen). Base/contract ca5b67a8285b130c79055317c6202f73cfbb99c8. Final MAIN admission ran tsc exit0(exec25124) and one-worker PRODUCT vitest exit0(exec65703), five files/**100/100** in25.47s. Both handles terminal, light slot explicitly released to MAIN. Raw results logs/tsc-fingerprint-final.log and vitest-fingerprint-final.log; hashes/commands verification-codex.json, source manifest candidate-files.json. No additional runtime/Host/browser/media/full-suite checks.

Codex implemented final fixes by MAIN-directed third-rework takeover, so these are INTERNAL results; independent nonimplementer review REVIEW_PENDING. Package/whole-A/actual film/DB/editor/browser/media/human acceptance NOT_RUN. MAIN must still mount original M5 shell, serve real review URLs, build real Brief style carriers and actual registered capability catalog, and enforce final dispatch/apply contracts in its serialized side-effect/Coordinator boundary. PRODUCT has no database or memory production fallback.

Claude trace preservation: logs/claude-session-record.json records real UUID/PIDs/handles/exits and raw+gzip SHA256. Exact-byte original JSONL traces are archived as .jsonl.gz; only redundant local raw copies were removed after comparing archive bytes and manifest hashes. Prompts are retained as CLAUDE_*.txt. No live Claude writer; no 429 fallback claimed. All source changes are within PRODUCT whitelist; protected paths untouched. No push/reset/stash. Rollback remains MAIN unmounting additive components/services while preserving original editor and project facts; no DB downgrade/reset.

## 2026-11-10 managed native observation candidate handoff

MAIN explicitly authorized Codex candidate artifacts under requests/010 and private var/managed-native-observation. No Claude/provider writer started. Exact upstream e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3 exported read-only; three observer files plus separately authorized media-queue normalization only. All source transformations replayed on exact preimages, git apply --check0; vendor status unchanged. Private dependency copy61652/PID4133326 exit0, no install/network/scripts. MAIN-admitted UI check29580 exit0 (tsc0, Vite build0), 10 output files manifest d4cb3b22dcdf5f58e94979c5220d9594514358285b97a8a06bb9f1705d555bab; slot released to MAIN. Final patch71135c54f97672d698e9d24741b67f7e98fca4900757b7484ec9d324a06c867a. No candidate/check process remains. Source/hash/scripts/raw logs/archive in requests/010. Actual DOM/browser/Host/ack NOT_RUN; MAIN production transport/session/loader and independent review remain required. This is candidate handoff, not A05/independent/human PASS.

## 2026-11-10 P2 observation fence repair

MEDIA independent review found stale fromServer GET A could re-mint fresh proof after dirty/edit B. Codex changed only candidate useFilm observation metadata: capture request-start epoch; stale response never gets proof and invalidates newer proof before unchanged native reducer replacement. Original candidate/log/archive preserved. Source replay/applycheck0; MAIN-granted exec75180 terminated0 (native UI tsc0 + freshly rebuilt Vite0). UI slot explicitly released; no Host/browser/network/install. Current patch214c629238c2635f5c6212e5e9207eab18f61d17454c08ee64ccd32be41dffa6, new distmanifest f8e4890c18c046382457b7b07f7dbb49360a854f01e769acf9b021a6c3cfa5c8; active-candidate.json selects p2 artifacts. Actual runtime race/mutation tests NOT_RUN, MEDIA re-review PENDING. Sole writer Codex, no Claude/provider, MAIN/vendor/api.ts untouched. No repair/check process remains.

## 2026-11-10 owned-project entry pure component

MAIN assigned fixed-props OwnedProjectEntry candidate, starting clean e96ca4ce06fc6515c6351844ac4375f15e481a78. Sole writer Codex; no Claude/provider/check process. Only observation/OwnedProjectEntry.tsx + independent CSS and own request011 docs added; no index/root/backend/MAIN modifications. Existing inherited theme reused; semantic responsive list, actual saved metadata and optional identifiers, empty Agent guidance, attention/busy open refusal, explicit saved≠native-loaded text. All API/auth/native opening/pagination composition remain MAIN. No TypeScript/test/build/browser/Host run; static source only, independent/A05 acceptance pending.

## 2026-11-10 hydration source candidate (no execution slot)

MAIN authorized report012 implementation; sole writer Codex/no Claude/provider. Preserved010/P2 candidate and exact pre-extension7 source files in private var/pre-hydration. 013 has full8-file upstream patch and exact extension delta; new native-hydration helper, optional host hydration protocol, read-only useFilm scope, native hook read/dirty outcomes and actual ProjectView DOM aggregation only. Original reducer/store/clock/undo/write behavior remains; helper adds approved same-epoch same-GET read-only revalidation, not native reseeding. Callback exceptions isolated, actual sources/DOM/GET/hash fenced; dirty/failed/browser fallback cannot be washed into hydrated. Exact effective shapes, event JSON schema, literal JSON hash goldens and internal contract hashes in013. MEDIA/main resource still reserved elsewhere: tsc/build/tests/browser/Host NOT_RUN, no compile/runtime/independent PASS. MAIN owns expected-value parsers/source/workspace/session/final NativeAck matching. Unknown media-decoded state remains separate. Candidate remains source-only pending resource and independent review; no production Host/vendor/OwnedProjectEntry changes.

### 013 actual UI checks / frozen handoff

After MAIN resource admission, exec24342 terminal0: private native tsc PID14883 exit0 then Vite PID15016 exit0; source commit f6c2ea23d6fe54e6f8d69251d2477df13b0f4b29/fullpatch198c8b5e6873d6cf7b3d6f2171b55c9859ca73d3bf2725b2b9da118db258d753/source9694f79084ab645b5c42eada8c61a9eebcdfd3e6777fa2a4aa448b37753162bc exactly recorded. New10-file distmanifest76cbc5e98b968f01824630dbe0295ed05c7f386b17727cd818d5cf40aa267458; archive1fa86a01d2d74fe996fc236e946832a83fb6dfec1153a3ceec592a2775aaae14 (747059B). Slot explicitly released; all processes terminal. Exact transform replay8/8 + portable apply0, vendor clean; git artifact whitespace check2 retained (unified-diff blank context lines, not altered to hide warning). Actual runtime/browser/Host/golden-helper comparison NOT_RUN, independent review PENDING. No source changes after compilation; only own evidence/manifest/log/package docs. Details in013 README/check1 and active-candidate.json. No independent/A05/human PASS self-signed.
