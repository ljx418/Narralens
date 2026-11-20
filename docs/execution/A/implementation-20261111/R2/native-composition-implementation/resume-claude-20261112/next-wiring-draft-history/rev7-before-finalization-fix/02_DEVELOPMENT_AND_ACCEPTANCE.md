# 下一阶段实施与验收草案

DRAFT_NOT_RELEASED；以下施工包编号只用于计划分段，不替换原case编号。所有新业务case NOT_RUN。一次大阶段统一冻结审查，模块自验不重复冒充阶段外审。

## 施工包与依赖

|包|实施范围|完成后行为|前置/验证|
|---|---|---|---|
|W1 持久选择权威|新增S01模块；原ProjectCreationStore初始化绑定；显式启动迁移|新bootstrap同事务epoch0，重放只读，重启无ABA，损坏不回0|N1/N2验收；S01-M01/M02、B01/B02及原S01全部存储case|
|W2 真实观察/Ack/Context|native mapper/Observation、Expected binding、Ack私有permit/Context最后围栏|选择与剪辑状态一致；四part不足不loaded；晚到拒绝|W1；本包先做component证据；S01-P01、A01–A05完整生产验收等待W3，不在W2虚报关闭|
|W3 正常入口与生产前史|CreationApplication/dispatcher装配既有FactsReader/Change/Adoption/Publisher；可信review绑定|通过原HTTP/MCP真实prepare→批准→apply，exactly-once revision+1|W1+W2组件就绪；按04的preview→impact→package/receipt/bind→trusted decision/approval→apply生产链；W2/W3合验，不用直接method/灌表代替|
|W4 Host恢复与关闭组合|server/CreationApplication/scheduler/reaper/owned runtime|启动顺序有限、无native会话也可证明恢复、健康项目不受局部失败拖累|W1/W3真实前史；HC01–HC12、J01–J05|
|W5 统一端到端与冻结|真实原Studio headless、原API、SIGKILL同库同根恢复、旧门回归|可加载/选择/改单镜/重开并核对实际Ack/Context；真实崩溃后原结果收敛|W1–W4；S/A/H/J/HC适用项，HC13每边界单独证据；正式影片另门|

W1–W4可连续实施，但同文件一次仅一个writer，公共装配不分给并发写者。MAIN合同/架构/审查，Claude具体实现/自验证；各领域Codex只负责具体设计与只读复核，未启动的Agent不写成已启动。新429立即停止，不重试/换provider/Codex接手。

## 原编号与真实断言

S01全部case从冻结ACCEPTANCE_AND_RELEASE.json原样带入，不重编号；下面附录保留精确ID/步骤/期望。S01/S02为原native组合验收编号，与S01-M01等不是同一个case，报告必须写完整ID及来源。

A01：真实document/四hydration未齐→unknown/pending+Ack0。A02：每await精准改变commit/control/owner/session/generation/workspace/selection及事务末端permit→Ack0。A03：并发/重放只插一次，成功后cleanup失败保留历史但撤live loaded。A04：无UI新事件也能从Context识别source/sidecar/inode/control/uncertainty漂移。A05：auth/Origin/CSRF/跨owner/伪ref与晚到exchange拒绝，无泄漏绝对路径或token。

HC01–HC06/09/10/12按原真实Host场景执行。HC07要先以真实producer证明多prepared前史可达；HC11要真实合法后继，指针破坏fixture不等价。HC08按01合同真实持久epoch取代无session=0。J01–J05分别证明S01恢复ABA、无Studio恢复、close交叉、同DB同实例、scheduler/reaper路由所有权。

HC13：父进程只SIGKILL确切自有Host，不是异常throw/finally。实际IPC边界ACK后kill，核PID+start/FD9、DB/WAL、原根identity和真实事务事实；同库同根重启，commit+1恰好一次或compensate/abort+0且原字节/身份可证，target保留；不能以新临时根或伪receipt代替。所有原HC13 publication/rename/commit/compensation边界逐项执行；无法构造合法前史则NOT_RUN，不能算通过。

H01–H04严格保留真实人类/授权素材/Studio路线；诊断media只可作组件与自动化接线证据，不冒充60–180秒中文片、人工创作确认或V1。A影片/双导出/T20仍需原全部真实门。

## 测试组织和证据

1. 实施前冻结实际base/目录/签名/DDL/差异与case清单，内部审查原规格闭合后开始。每次修改有类型检查和最小有判别力测试，测试必须证明目标路径被命中。
2. 精确pure/sqlite/Host/media/browser/SIGKILL分区，记录实际case数，不硬凑历史数。全量/多Host/media/browser独占MAIN slot；不改默认并发/超时掩盖真实问题。
3. 命令通过既有run-recorded.py，唯一capture保留完整argv/cwd/HEAD/输入前后hash/actualexit/rawstdoutstderr；产物SHA256、DB行与前后字节/目录/PID/FD证据可追溯。失败不覆盖，不因后一次成功删旧记录。
4. 全部headless静音loopback；无安装、下载、provider/付费/J盘、凭据/config变动。确需新资源先列真实前置，不用桩变成成功。
5. 大阶段末同一真实commit完整验收+未参与实现者独立审查；修复后按影响重验、重新冻结，不自签外审。PASS不是“未发现问题”，每项原要求都须有匹配范围的直接证据。

## 进入与退出

进入：00门全部满足；014 accepted commit+最终接口逐项绑定；S01冻结合同无未裁决冲突；精确ReleaseAssignment及唯一writer/资源已记录。当前本草案不满足accepted commit条件，禁止开工。

退出：W1–W5实际承诺范围全证、原受影响门通过，缺口/NOT_RUN不被隐藏；SIGKILL与异常注入、headed与headless、人验分开；现有工作台真实可读说明+截图/中文HTML报告具备；原A人验仍独立待人类签署。回退必须保持S01保护：不兼容旧binary下，受影响created bootstrap/prepare/apply/recovery授权/Context/native loaded均明确read-only或unavailable，不能撤新挂载后悄悄恢复旧默认0。只允许经审计的兼容binary使用原账本恢复。Hypit/migrated legacy原模式与已真实提交receipt保留；不做down migration、不手改pointer、删除账本或reset/stash。

## 附录：原S01冻结验收清单（当前全部NOT_RUN）

|完整ID|层级|原始步骤|原始期望|状态|
|---|---|---|---|---|
|S01-M01|real SQLite|Empty independent migration marker and private namespace under valid owned original DB; migrate twice; interrupt joint DDL/private+external receipt transaction then reopen|Exactly complete schema+two validated receipts or all absent; definitions/detail fingerprint validated; repeat no changes to applied_at or other rows|NOT_RUN|
|S01-M02|real SQLite|Seed extra namespace trigger, wrong receipt, partial schema, float/text epoch, wrong bootstrap binding, deleted row after schema installed|Explicit unavailable/corrupt; no DROP/repair/INSERT0, no source/approval/Ack changes; healthy project row corruption remains project-local|NOT_RUN|
|S01-B01|actual bootstrap plus SQLite|Real verified new bootstrap commits and initializes0 in same transaction; fail each original commit boundary|Both original commit and selection row present or both rollback; exact bootstrap permit retries do not reset; unrelated pending blocks initializer|NOT_RUN|
|S01-B02|negative migration fixture|Old created pending has no ledger, both unpublished and published layouts; also force EIO vs confirmed absent|No plan/session/Ack-derived epoch; only original independently proved early safe abort may run; published unknown preserved and explicit reconciliation diagnostic; neither counts RD05 success|NOT_RUN|
|S01-E01|real SQLite + trusted observation|Initialize0, sessionA open, mappingA, session close, sessionB open, same mappingA, reopen again|Epoch strictly advances at session/invalidation and first mapping; no reset0, no old lastMapping dedup; duplicate active session delivery no-op|NOT_RUN|
|S01-E02|real SQLite + mapper barrier|Accept same-session duplicate mapping event; suspend mapper before completion; attempt business read and Expected epoch read|Expected reads valid epoch and can begin proof; all original business consumers refuse pending; completion same effective mapping leaves epoch unchanged and CAS token advances; no decrement|NOT_RUN|
|S01-E03|real SQLite + async mapper|Accept A then B while A suspended, complete B then A; independently repeat on project2|Only latest issued sequence/profile/token may CAS; lateA changes0 rows and no Ack; other project epoch unchanged|NOT_RUN|
|S01-E04|real SQLite|A-to-B-to-A effective mapping with valid same-session callbacks; repeat A without change|Two increments for two semantic transitions; duplicate increment0; old prepare version cannot ABA|NOT_RUN|
|S01-E05|real SQLite + original consumers|Hold accepted selection pending while FactsReader/change prepare, normal apply, Publisher final closedcommit and Recovery try old numeric version|Each existing business face refuses pending even if epoch equal; no permission consumption/commit/compensation from pending503; only after completion and fresh checks may proceed|NOT_RUN|
|S01-D01|actual observation/Expected|Open session (mapping null,no pending event), deliver real document/hydration before selection; then map and finalize proof|Readable epoch allows Expected to start; no loaded/selection claim before map/proof; new-session bootstrap never requires prior Ack; all DTOs unchanged|NOT_RUN|
|S01-D02|actual observation|Invalidate document/view/workspace; replay duplicate invalidation; supersede pending map via newer hydration/doc|One increment per real invalidation identity, repeat no-op; old mapper/Ack cannot resurrect; new proof round can start; ordinary hydration alone no bump|NOT_RUN|
|S01-C01|real SQLite scope|Take read permit then accept mapping pending or change baseline before NativeAck record/context final return|Same-db final permit compare refuses stale CAS/binding inside append transaction; no new cp_a0 row or loaded; no epoch-column addition|NOT_RUN|
|S01-C02|real original commit|Successful adoption changes baseline, then next Context/prepare; separately fail reconciliation afterward|Reconcile exact actual commit/control once before new admission; old live mapping invalidated; original committed receipt remains true; never mutate epoch within publication final proof|NOT_RUN|
|S01-R01|real subprocess + SQLite|SIGKILL owned child immediately after pending acceptance COMMIT before mapper result; reopen same DB under original ownership; reopen a second time|First reopen atomically epoch+1 clears pending/session/map with restart_unfinished; second no increment; no fabricated mapping; old plan stale and ordinary recovery can progress without opening Studio|NOT_RUN|
|S01-R02|real subprocess + SQLite|Kill before CAS COMMIT and after CAS COMMIT, both same-mapping and changed-mapping finishes; reopen|SQLite yields old pending or committed finish; no partial token/epoch; pending branch invalidates once; clean finish does not blanket bump on reopen|NOT_RUN|
|S01-R03|real subprocess + SQLite|Kill idle Host with nonzero epoch and no pending; reopen with no native session|Validated nonzero epoch retained, live map/Ack null; new actual session increments; cannot use retained mapping_digest as live selection|NOT_RUN|
|S01-L01|real Host lifecycle|Admit recovery + mapper/proof, start graceful shutdown, send new events and sessionClosed(host_shutdown)|New admission denied; accepted readers keep dependency until drained; admitted mapping may invalidate accepted write via true final check; no blanket epoch bump/false Ack; authority closes before DB only after quiescence|NOT_RUN|
|S01-L02|real SQLite + failure injection|Mapper EIO then fail cleanup/pending settlement; close with drain still active|No old mapping restored; pending durable or honest single invalidation; unresolved cause retained, DB not closed under work, no claim finally on SIGKILL|NOT_RUN|
|S01-N01|real SQLite numeric edges|Validated epoch MAX_SAFE_INTEGER-1 then required bump; next new event; corrupt numeric forms|Max remains precisely readable; further necessary transition refused without wrap/saturation; no new event admitted if completion cannot increment|NOT_RUN|
|S01-X01|legacy regression|Run existing legacy/migrated observation flow without created authority and created flow with absent authority|Legacy semantics unchanged; created missing authority fails explicitly rather than taking legacy default0|NOT_RUN|
|S01-I01|real SQLite + scoped transaction|Race two CAS with same token, rollback winner transaction, issue forged owner/event/scope token|One actual winner per committed token; rollback reverts; forged opaque objects rejected; no arbitrary cross-DB scope or HTTP epoch accepted|NOT_RUN|
|S01-P01|actual ownership + public workflow|Real runtime/bootstrap/prepare/approval/apply/recovery/native round with shared instance identity instrumentation|One DB and one epoch owner; actual public approvals remain separate; process barriers and trusted facts, no SQL fake success; blocked until N3/N4/public producer release|NOT_RUN|
|S01-M03|real SQLite and scoped bootstrap / child crash where named|Four independent DB fixtures: external marker absent/present x namespace absent/complete; repeat with partial namespace|Only absent+absent installs; exact present+complete opens without mutation; present+absent/partial and absent+present reject without repair; no project row created|NOT_RUN|
|S01-M04|real SQLite and scoped bootstrap / child crash where named|Drop whole private namespace keeping external marker; delete only marker keeping private schema; alter marker from/to/detail/digest; insert unknown higher selection migration id|Distinct mismatch/unsupported errors, no regeneration or marker backfill; unchanged unrelated receipts and all project business facts|NOT_RUN|
|S01-M05|real SQLite and scoped bootstrap / child crash where named|Inject failure after DDL, after private receipt, after external receipt, after verification before COMMIT; actual child kill before and after COMMIT then sameDB reopen|Atomic both receipts+namespace or all absent; precommit rollback preserves other receipts; postcommit reopen validates all; SIGKILL not physical power loss|NOT_RUN|
|S01-M06|real SQLite and scoped bootstrap / child crash where named|Corrupt/miss schema_migration after original store-open prerequisite; EIO/BUSY on reads; change marker DML without schema_version change|S01 does not create/rebuild table or treat error as absent; marker freshly checked each operation; no cached-valid bypass|NOT_RUN|
|S01-B03|real SQLite and scoped bootstrap / child crash where named|Real bootstrap: mint at after-origin scope, forge crossDB/crossproject token, call after scope return, reuse permit, fail before/after init and final proof/expiry|Only original active scope can initialize; faults roll back epoch0+original DB facts; published files preserved per original bootstrap policy, no fake delete|NOT_RUN|
|S01-B04|real SQLite and scoped bootstrap / child crash where named|Commit bootstrap with ledger then replay original request; repeat after adversarial ledger removal/corruption|Original committed receipt path stays read-only, no remint/INSERT0; selection authority unavailable on corruption, no rewrite of true committed result; new admitted bootstrap after rollback obtains new permit|NOT_RUN|

## 独立审查修订关联

S01-E02/E05/R01/D01及A02明确包含pending COMMIT先于mapper被调用的barrier和崩溃证据。S01-P01、H01/H03、HC06/07/11/13及J04依赖04的真实生产链，W2组件通过不算这些case通过。S01-C02/R01-R03/L01-L02、HC01/03/09/10/13及J01–J05执行05依赖序。S01-X01/B04验证不兼容回退不会重开旧0。既有case编号保持。

## rev7：媒体授权接线验收补充（原编号不变）

W3路径与私有read-scope以04 rev7、06 rev7为准。PUB-RD01在真实binding/scope/open/read/backpressure/descriptor close/异步release窗口逐项撤session、换包/运行/rights、改marker，正常对照必须成功。检查scope issuer不能由caller JSON伪造、原scope失效后不能换session复活、不新增陈旧交付、GET零写零render、raw read/close真实排空、S01读资源与DB关闭顺序。映射PUB-DB02/NW-API03/S01-L01/L02；原S01 28条与其他门不删，全部新运行NOT_RUN。实现前仍需accepted N1N2及最终ReleaseAssignment。
