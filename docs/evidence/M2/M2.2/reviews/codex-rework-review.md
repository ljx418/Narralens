# M2.2 Codex 返修内部复审

日期：2026-10-18  
结论：`PASS_INTERNAL_CHECKPOINT`  
声明上限：`M2_2_INTERNAL_EVIDENCED`；完整 M2 独立外审延后到 M2.3 后的 Wave 1 组合候选。

## 1. 原候选为何不能通过

原候选虽然局部测试全绿，但生产 `/edits` 仍直接调用 actor，持久 job 的真实 runner 未取得 lease，
旧 worker callback 未绑定 lease attempt，snapshot 未复制 manifest 引用的视觉资产，锁与 control revision
没有完整共用生产队列/事务。旧冻结证据保留，不覆盖其历史结论。

## 2. 返修闭环

- Host 生产 `/edits` 经唯一 `ProjectCoordinator`；Coordinator、actor、import、lock 共用同一
  `ProjectOperationQueue`，actor 使用 coordinator-only 入口避免嵌套队列死锁。
- 启动执行 coordinator recovery、outbox replay、lease reaper；运行期定时 replay/reap，关闭时先停止
  controller/timer 再关闭数据库。
- 生产 provider job 在 runner 前取得 `owner + attempt` lease；callback 用相同身份 CAS，旧 worker
  晚到结果只写 quarantine。Job 状态和 event 在同一 SQLite 事务内写入。
- snapshot 使用 engine 在 mutation 后生成的完整 `SourceDigestV1` 闭包，包含 manifest 引用资产；
  重用既有内容寻址 snapshot 时，后续失败不会删除旧 active snapshot。
- revision、committed source baseline、active commit、idempotency fallback 与 outbox 一致推进；幂等
  重放不产生第二 transaction/snapshot/outbox。request hash 已显式贯穿 Coordinator 到 commit。
- 锁增删经过同一项目队列；lock row、control revision、`lock.changed` outbox 同事务；edit 在 commit 前
  再检查 control revision。
- 新增真实 Host HTTP 组合测试、完整 snapshot closure、启动 lease 回收、stale worker、锁/编辑竞争、
  snapshot fsync failure→attention 与 outbox event-id 去重验证。

## 3. 四视角结论

| 视角 | 结论 | 证据重点 |
|---|---|---|
| 架构 | PASS | 单 actor、单队列、单 RevisionStore；生产路由有 Coordinator 强制点 |
| 代码 | PASS | lease CAS、状态/事件事务、snapshot created 语义、幂等 hash 均有回归 |
| 体验 | N/A/受限 | 本阶段无 UI 改动；Headless/Headed/Human 均不冒充执行 |
| 验收 | PASS_INTERNAL | 全量 check、专项、合同、黄金向量、变异、真实上游探针在新冻结点重跑 |

BLOCKER=0，MAJOR=0。M2.2 可按压缩流程进入 M2.3，但不能单独声明完整 M2 或外审 PASS。

## 4. 明示边界

1. legacy Hypit 仍先由 actor 就地提交 author source，再捕获 immutable snapshot；这不是完整 AC-005。
   M2.3 必须用迁移副本打通 isolated stage→snapshot→single pointer，M4A 再把采用路径纳入该模型。
2. M2.2 没有可改变 narration/duration 的 typed edit；两类锁只有分类器证据，集成层为
   `NOT_APPLICABLE_APPROVED`，不得解释为完整用户路径已经验证。
3. `render`/`snapshot_publish` 尚无业务 runner；本阶段只证明 store/lease/event/recovery/NOWRITE。
4. `materialize`、`adopt`、`impact`、`migrate-copy`、`history restore` 仍关闭；M2.2 不开放新 UI。
5. headed 与 human 为 `NOT_RUN`。自动验收保持 Headless、静音、无窗口、不抢焦点。

## 5. 下一门

允许进入 M2.3：迁移副本与可验证回退。M2.3 完成后必须在同一组合冻结 commit 上重跑
EN/TM/JB、旧 D1–M1 回归、真实 Hypit/OpenFilm 重开/编辑/导出和回退，再做一次独立 Claude Code
外审；任何组合门失败都在 Wave 1 内修复，不回头重复签署已无变化的模块。
