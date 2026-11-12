# D10 原业务恢复实施票（MAIN设计 / BRIDGE监督 / Claude唯一实现）

## 当前范围及唯一writer

基线 45377c9d0c13264d9f7af7da4f1db56cd6679fe2，MAIN worktree `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`。本票为新任务，不是429后的Codex接手授权。Claude额度由用户报告恢复；必须新建可见Orca Claude任务，不能恢复旧429子调用。MAIN及BRIDGE在Claude实现期间只读生产源和索引；所有实现仅一个Claude写入者。出现429立即停止此任务并保全报告，不重试，不让Codex/MAIN接手；只有用户明确授权此次接手才能继续。其他失败可在原Claude授权任务内修复；源冻结期间不改输入。不得读CLI配置、凭据，换供应商/模型/权限或调用provider。

只释放以下路径：
- `src/host/agent-driven/created-source-recovery.ts`（新）
- `src/host/agent-driven/created-source-adoption-service.ts`（只调整在线错误与关闭/恢复衔接）
- `tests/agent-driven/integration/created-source-adoption.test.ts`（真实fixture支持完整持久ApplyChange及追加业务恢复用例；保留旧50例）
- `tests/agent-driven/integration/created-source-recovery.test.ts`（新，若复用fixture可增加一个仅测试的helpers模块，须先向MAIN列出精确路径）
- 自己的 `docs/parallel/lane-bridge/A-R2-20261112/D10-business/` 实施日志和报告。

禁止改Publisher/RecoveryFiles/RevisionStore/Coordinator/Host/CreationApplication/contracts/DDL/依赖/配置/旧测试期望，也不启用任何路由。需要这些改动则精确请求并保留现场，不绕过。

## 先读与已证明基础

先读AGENTS最高429新规、D10_RECOVERY_IMPLEMENTATION_PLAN.md全RD01..06、D10_BUSINESS_RECOVERY_RELEASE.json、D10_REISSUE_M1_REPAIR.md、D10_FAMILY_ORDER_REPORT.md。cfee567 issuer修复独立 msg_84faabd371d9 bounded ACCEPT，原创建队列/权威/磁盘证明依然是必要前提；完整A尚未完成。旧47绿不能替代后增反例。真实资源helper和issuer已存在，禁止再实现一份copy/rename/Approval/proof。

## 服务接口与业务决策

实现Host-only `CreatedSourceRecovery`，构造绑定真实单例 `host`（原RevisionStore/Coordinator/SnapshotStore）、`creation: ProjectCreationStore`、`tasks/assets/verifier/selection`及固定 `createdRoot/privateRoot/stageDomainRoot`。`recoverOnStart()`处理本family原行，`recoverTransaction(transactionId)`便于同请求重入/实际测试，`close()`停止接收并等待本身已接收恢复和资源释放。返回只含事务ID、真实outcome及必要内部receipt/错误分类，不新增wire DTO/持久state。

1. 只识别真实原库中kind=edit、精确operation=`agent.created_source.apply@1`的行。分类不是写授权。完整request wrapper必须有且仅有operation/input；input用原ApplyChange validator验证，contentDigest(input)须等于原request_hash，项目/base/execution/impact/approval须匹配真实原immutable adoption和prepared授权。先校验再读/移受控路径。旧仅marker/损坏request不得当合法请求；未知kind/operation不归此service。
2. owner从真实 `creation.ownerOf()`、`forProject()` 与 `origin()`读取，拒绝缺来源。路径只由Host固定根+已验证project_id派生。不能相信request/journal的任意绝对路径。继承RecoveryFiles完整三树/owner/DB与持久身份校验。
3. 调原Coordinator.controlledRecovery同项目队列。使用实际数据库行构造ALL三family可忽略pending IDs；不允许客户端ID或全局无条件skip。顺序 `(created_at,transaction_id)`，队列前后都重读并用 `hasOlderControlledPending` 拦更老未决行；unknown/import/legacy无关pending保持原gate。不能伪造terminal进展或在单次无进展时busy loop。attention/recovering不重置，保留为未决。
4. received/preconditions_checked/staged/validated及无publishedjournal的prepared：无journal时可能尚无adoptionfact。必须独立证明原 committed base/revision/源完整闭包与真实owner，retained guard保持至中止，才走原Coordinator.abort；不是仅比较film.html。缺原base/资源/未知身份不得安全中止。原active snapshot可能已为同project的后续采用，读取真实R1 sourceFact，不能只假定最初snapshot。源变化→attention，明确瞬时读取资源错误→deferred。
5. 有prepared journal+identity：使用真实 `CreatedPublicationRecoveryFiles.inspect`/layout。published且当前许可仍可能有效时，用真实Publisher.recoverPublished，随后原 `RevisionStore.commitPreparedCreatedSource` 精确9字段完成同transaction，revision恰+1，不建新transaction/job/snapshot/编码。真实Producer/SOURCE_ONLY、immutable plan、当前Run/批准/输入/锁/selection/rights均重验，最终原closedcommit是唯一提交决定。
6. original/rename_gap/rollback_gap/restored等原资源helper布局走完整 `restoreOriginal` +同步 `assertOriginalRestored` 然后原abort，保留全部target/staging/snapshot。published在确证取消/暂停/过期/新锁/selection/许可或输入已不允许提交时亦补偿后abort，不把旧授权永久冻结。注意Publisher将多类失败汇成REVISION_CONFLICT；不得把所有409、CAPABILITY_UNAVAILABLE或任意Error归为同一授权失效，也不得按人类文案模糊匹配。可基于独立实际权威事实和原closedcommit精确机器失败标记分类；未知错误/ENOMEM/EIO/资源不足/cleanup不确定应保留prepared并deferred/reconciliation，不碰terminal。资源身份/闭包/来源确定不符才attention并保全。
7. 已committed只读取并严格验证原同key/digest/transaction/owner/fact/Applied的持久receipt，不新签发proof、不重消费、不+1。后续合法revision存在时不可要求旧target仍是current author。aborted/attention/recovering不复活；请求重复/并发返回真实已有结果。任何failed operation不产生假Applied，也不制造空source_digest冒充有效wire回复。
8. 原AdoptionService错误分支不能把可恢复prepared发表中断一概terminal attention；保留原prepared给专用恢复和原gate继续阻写。cleanup不确定必须sticky并完整清理，不能抹掉原错误或回滚已经committed的结果；阶段/无journal异常也要真证明再abort，不能凭journal空断言未改作者。关闭先拒新、等所有本服务pending+Publisher+RecoveryFiles，DB留给Host最后关。
9. 当前原closedcommit拒绝任意其他prepared行，不得为让同project合成链变绿绕过该条件；如碰到该边界，保留真实deferred并向MAIN提出精确设计问题。不能改旧核心、偷偷忽略未知pending、扩大可写权限。

## 实施与验证要求

先记录baseline SHA/status/唯一writer及实际Orca Claude task/dispatch/terminal。可用原node_modules，不install/下载或连provider。只可纯FS/SQLite测试与tsc；真实Host/ffmpeg/浏览器/大fixture/全量均须MAIN单重型槽逐次预约。实际fixture先复用现有50例所在真实bootstrap→SOURCE_ONLY→publisher链，将request变成完整合法ApplyChange并匹配原hash，不允许手工空publication proof/伪Producer替代业务链。不要将错误捕获的候选称PASS。

测试至少覆盖：未知operation不接管、完整wrapper/原hash/owner/fact绑定、early未发表+0、published有效同transaction+1+持久receipt重放、无journal不得猜、缺publishedjournal真实补录、expired/cancelled/paused/三类锁/selection/rights/creative输入分别拒绝并可证补偿、外部篡改/新inode/缺snapshot保全attention、瞬时资源错误不终态、原队列/老少tie-break/unknownpending、关闭等待/清理不确定。组件模型与真实Host用例逐case区别，真实SIGKILL本票不冒充执行，后续Host装配单独验。

每个新增重要回归解释旧实现为何会失败；先最小验证，再适当完整回归，不反复无意义重跑。命令要保存完整argv/cwd/exit和原始日志，保存输入前后SHA256。源捕获期间不得改src/tests/tools/配置/index。旧失败日志不能覆盖。报逐case实际状态、未做范围、原工作树与SHA256和回退方式。Claude不自签独立外审，BRIDGE若参与实现亦不可自签；MAIN集成后另取独立上下文。

不要git add -A/commit/reset/stash/push；实现结束先报告精确dirty文件，等BRIDGE/MAIN冻结。若超过两次返工或遇架构不明先报告，不自动Codex接手429，也不放宽合同。新service未接Host不能声称RCV-D10-10或A通过。
