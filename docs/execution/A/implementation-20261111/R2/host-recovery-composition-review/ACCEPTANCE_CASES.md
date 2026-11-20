# Proposed acceptance — ALL NOT_RUN

No commands below executed. Require MAIN single heavy grant for real Host/ffmpeg/process tests, isolated owned runtime per case, existing dependencies and pinned vendor only, no downloads/provider/network beyond authorized local loopback. Run recorded on one frozen SHA after lifecycle import; save argv/cwd/exit/time/input manifests/raw logs/SHA256. Do not rerun until changes or failures justify it.

## Common real harness and evidence

Proposed new files: `tests/agent-driven/integration/host-recovery-composition.test.ts`, `host-recovery-crash.test.ts`, `helpers/host-recovery-child.ts`. Parent owns original launcher subprocess and an explicit inherited IPC boundary channel in test-only child; no HTTP fault route/environment shortcut in production. Use real `tools/agent-runtime.ts start --root <isolated-root> --vendor <pinned-vendor> --port 0` semantics/FD9 ownership, same root/host.sqlite on restart; new root only between distinct cases. Existing owned-runtime.test.ts launch helper is starting reference, not sufficient crash evidence.

Before killing, record hostname/kernel boot, launcher/Host/owned worker PID+start time, process tree and FD9 inode, exact DB/WAL identity, filesystem device/inode and full tree byte manifests, transaction/approval/impact/step/outbox/idempotency snapshots. At a verified actual boundary, parent SIGKILLs ONLY exact owned Host using pidfd when available; await exit and re-read exact descendant identities. Orphan descendants must be safely terminated only after identity verification, and original FD9 must be unheld before takeover. Timeout -> unknown blocker, never proof of exit. Keep immutable pre/post evidence, do not delete lock inode or restore fixture DB to manufacture recovery. Restart using same real launcher and root; observe public project/context/job/status responses, not manual recover method calls. Record generation increment and old credentials/session refusal without printing tokens.

Published result must verify same transaction and original authority consumption exactly once, revision +1 exactly once, source/pointer/snapshot consistency, Applied receipt/outbox/step/idempotency; abort result +0 and complete original bytes+identity with retained target material; attention/deferred preserve all relevant material and gates. Probe a second healthy project in every blocked-project case. Cross-device/fsync unsupported setups fail prerequisite and are NOT_RUN, not equivalent /tmp evidence for deployment root.

## Cases and failure oracles

|ID|Input and real steps|Required result/evidence|
|---|---|---|
|HC01|Actual bootstrap/task facts, three owned row families plus unknown legacy row; restart Agent and legacy entry over same DB in separate runs|One finite scheduler, fresh generic classification; owned unresolved/attention/recovering untouched by generic; unknown reaches generic; no routing input can supply exclusions|
|HC02|Known marker with corrupt wrapper/hash; wholly unparseable JSON; valid marker with wrong kind|Known handler persistent attention before resource I/O, no movement/authority consumption; unknown/wrong-kind not stolen by legacy handlers; trace DB states and resource access|
|HC03|Real expired task lease/checkpoint plus unrelated job lease; startup and periodic reaping|Dedicated recovery alone settles its task/step atomically; generic reaper excludes same IDs at startup AND timer; unrelated lease still reaped|
|HC04|Two projects, one pending recovery whose assets/caps are unavailable, other healthy; add unresolved bootstrap project|No global false ready or global freeze for ordinary per-project dependency loss; blocked project rejects writes, healthy project available; global DB/ownership failure still aborts startup|
|HC05|Actual handlers with real rows, equal timestamps and ASCII transaction tie break; interleaved projects|Observe chronological row transitions, sweep once per family, no fixed pass budget; return counts ignored; unresolved includes attention/recovering; mutation of finite set is detected and startup ingress stays shut|
|HC06|Through real normal write entrance attempt second operation while first is pending|Second write cannot create another authorized pending transaction; preserve all authority/DB facts; no manual SQL used for this proof|
|HC07|Construct documented real-producer A1-C2-H3 and H1-C2-A3-C4-H5 prehistories, each with actual base/snapshot/layout lineage|Reachability first; if valid compatible chain exists it must converge via current gate or expose concrete failing deadlock for separate core review; synthetic states cannot satisfy this case; conflicting/unprovable multiple prepared remains preserved and diagnosed|
|HC08|Real observation no session; valid selected session; revoked/stale session; closed observation; selection changes during recovery|One authority shared with adoption and Publisher; only genuine no-session returns0; invalid/closed unavailable, no plan backfill; final revalidation prevents stale commit; context remains unconfirmed until real Ack|
|HC09|Pause accepted full recovery scan before final project, request Host close, issue new write|New admission refused; entire accepted scan and publishers finish before tasks/assets/selection/DB release; no DB-after-close or leaked retained descriptors; cleanup error and primary cause both recorded|
|HC10|Fail engine/dependency construction and then cleanup before listener exists; separately fail later gateway close|Per-project capability failure retains gate; global lifecycle failure cleans safe dependencies, no orphan listener/worker; aggregate preserves primary+cleanup reasons, no claim stopped when live resources remain|
|HC11|Actual created committed receipt, then genuine later authorized Coordinator/closed-commit adoption, then reopen/replay first key|Original historical receipt valid without requiring old author as current, no new revision or authority; pointer corruption fixture explicitly insufficient|
|HC12|Real Native reader and committed mapping, original Studio report document+four hydration+selection|Same DB Ack and Context loaded only after independent expected proof; byte/inode/negative-file/session/generation/selection races refuse stale loaded; imported lifecycle tests do not replace this production case|

Scheduler-only fixtures may inject clocks for equal timestamps and fake counts to test termination. Label them component tests; actual family/Host cases must additionally use real producers. Any exact timestamp adjustment or schema corruption is explicitly adversarial, not a reachable business prestate. Unknown/malformed data fixtures may write hostile rows for rejection only.

## Actual SIGKILL matrix (HC13, each boundary independent)

Use actual producer through public change.prepare/apply once those routes and trusted approval/review bindings exist. No producer yet means BLOCKED/NOT_RUN. Internal component preparation can be a separate resource test, never HC13 success.

1. After received/preconditions/staged/validated, before publication identity: safe abort only with verified original complete closure; no publication evidence alone is insufficient.
2. After atomic prepared journal+three-tree identity, before first rename: verify original, abort+0.
3. After author→backup, before target→author: actual author missing, restore original same inode+fsync then abort.
4. After target→author, before published journal: reobserve persistent identities, append missing published fact only for matching original transaction; valid current authorization commit+1, invalid confirmed authority compensate+0.
5. After published journal, before closed commit: same valid/expired/cancelled/paused/locks/selection/rights/creative-input branches, each independent real authority mutation through supported entrance where possible; unavailable entrance is a test prerequisite, not silent SQL replacement.
6. Immediately after closed DB commit, before response/events: no rollback, same receipt/approval/outbox exactly once on reopen/retry; no new job/render.
7. During compensation after target→rollback-target, after backup→author, and after directory fsync before abort: kill recovery subprocess again, reopen same root; identity-specific continuation and original abort only, preserved target, no unnamed temporary workspaces.
8. Repeat with same-byte new inode of author/backup/snapshot/container, missing snapshot, foreign lock inode and still-live old process: preserve/refuse; new process cannot inherit old FD numbers as proof.

Existing RecoveryFiles boundary callback covers rollback seams (lines268/273/277) but Publisher exposes no equivalent asynchronous publication checkpoint in this baseline. Exact test-only constructor callbacks at journal/rename/commit boundaries require a separate instrumentation release (see JSON); do not claim sleep-based racing hits the boundary. Parent must see barrier ACK before kill, and SIGKILL must prevent normal finally. Physical power loss is NOT tested by SIGKILL.

## Proposed commands after release and grant

From MAIN integration root, use existing read-only `run-recorded.py` and unique output prefix:

```sh
python3 docs/execution/A/implementation-20261111/integration/e1-main-takeover/run-recorded.py hc-compose-001 corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/host-recovery-composition.test.ts
python3 docs/execution/A/implementation-20261111/integration/e1-main-takeover/run-recorded.py hc-crash-001 corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/host-recovery-crash.test.ts
python3 docs/execution/A/implementation-20261111/integration/e1-main-takeover/run-recorded.py hc-regress-001 corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/controlled-recovery-scheduler.test.ts tests/agent-driven/integration/controlled-recovery-families.test.ts tests/agent-driven/integration/created-source-recovery.test.ts tests/agent-driven/integration/created-source-adoption.test.ts tests/agent-driven/integration/owned-runtime.test.ts tests/m2.2/host-coordinator-integration.test.ts
corepack pnpm exec tsc --noEmit
```

These filenames/commands are proposed and new tests do not exist yet. Default single-worker configuration must remain; no concurrent heavy capture. Native browser cases need separate exact Headless grant after reader integration; film/export T20 remains a later distinct acceptance scope. Preserve failed, setup-failed and NOT_RUN results, including inability to construct a legal successor or chain.
