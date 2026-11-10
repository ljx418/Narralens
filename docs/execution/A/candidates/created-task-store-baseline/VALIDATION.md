# Created task-store candidate — author internal validation

**INTERNAL_STORAGE_VALIDATED**, not independent acceptance or production A03/A05/A. Exact base7b48bc17fb65d966d6239c537f856ff240846766, unchanged modulef7c4c74c86a8e38c74673ab9656f751162436cba2325bfeb82ad1dd9639b8012. Tests strengthened only; new test92a560a51594e37da8ee347090f5da2e2058232dd3f15c57c0744f900e29359c. Source-v1 inputs preserved under history/source-v1. New current patch and candidate-manifest bind both actual files.

Prepared own0700/tmp from fixed Git archive+two overlay files; no MAIN dirty source input. Initial offline install60992 failed due default Linux cache missing SDK1.26.0, raw failure retained. Explicit existing mounted offline store/copy install39626 exited0/downloaded0/no scripts; no new install during testing.

Actual sequential execution, every argv/cwd/environment/stdout/stderr/exit retained:

| Round | Handle | Typecheck | SQLite test |
|---|---|---|---|
| R1 original source fixture |15050 terminal0|exit0,5.20s|19/19 exit0, runner0.99s|
| R2 tests strengthened |60630 terminal0|exit0,5.19s|21/21 exit0, Vitest601ms (tests269ms), runner1.05s|

No source compile/test failure was hidden or assertion weakened. Module code did not require repair. R2 adds actual same-connection fixture gate SELECT/revoke/restore and actual PersistentJobStore lease CAS→reap→attempt2, with old worker rejected/new worker positive; swallowed FK failure now occurs after ALL reserve effects. Only diagnostic stderr is Node experimental SQLite warning. COREPACK_ENABLE_NETWORK=0, CI=1, max/minWorkers1. No Host/browser/render/ffmpeg/media/network operation ran.

What this actually demonstrates: one real RevisionStore connection; atomic job/input/original ledger/event/outbox/fixture-link reserve and post-write rollback; original accepted replay after actual job success/correlation change; changed request conflict and unique execution-attempt job binding; distinct attempt storage positive; explicit policy required; revoked fixture gate blocks before writes/replay and restored row permits; FK failure poisoned even when hook swallows; async hooks rejected with revoked delayed statements; actual SQLite file close/reopen keeps stage token/accepted; current actual lease owner/attempt/time/cancel/terminal fencing; actual CAS refuses simultaneous second owner and accepts reacquisition after expiry; immutable prepared fact and final-clock expiry rollback; relative closure rejection and runtime namespace tamper refusal. Prepared success leaves job running. Namespace uses only created_task_* and old operation ledger/job/event/outbox; no CP DDL/state or Coordinator commit changed.

Scope limits: fixture_task_gate/fixture_task_link are **test-only rows**, not production Run/grant/owner/review/step/checkpoint authorization. fixture proof is object identity only, not a real retained-FD/source/rights verifier. No CP step CAS/Run checkpoint integration, full execution guard, filesystem stage verification, worker/recovery/JobRead/event registration/Coordinator publication or HTTP behavior has been proved by these tests. Required MAIN ports remain MAIN-PORTS.md. Candidate never marks jobs/steps succeeded or creates commits. Immutable prepared lease_owner/attempt is recording provenance, not current lease authority; callers must use current existing job state.

Before/after all6,599 original base files have identical SHA256, module/test final SHA equals R2 test input. Node_modules/.vite is derived output; no original package/lock/contracts/source altered. Final hashes in validation-r2/final-hashes.json. Exact final files copied to persistent author archive/candidate-files and patch before own temp cleanup; original Git archive retained for reproduction. Cleanup evidence will follow under preparation-r1/cleanup-result.json.

All handles15050/60630 are terminal. SQLite slot was explicitly released immediately after60630 exit; subsequent work is own hash/documentation/owned-temp cleanup only. Do not describe this author module evidence as external/frozen overall PASS or replace missing MAIN ports with fixture success.

Cleanup terminal: ownership-checked cleanup executed exit0; exact own/tmp/narralens-bridge-task-7b48-uf80hr16 no longer exists (preparation-r1/cleanup-result.json). Persistent own author source/candidate-files/base archive and all raw evidence remain. No MAIN or other worktree path was removed.
