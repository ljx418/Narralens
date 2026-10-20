# M4A 开工包三轮独立文档复审

状态：`PASS_FOR_CLAUDE_CODE_IMPLEMENTATION`
日期：2026-10-20
审查对象：ADR-W2.0-004、08_M4A_DEVELOPMENT_GATE、09_M4A_CLAUDE_HANDOFF 及其引用的真实源码
声明边界：这是实现前文档门，不是 M4A 代码验收，不关闭 Wave 2、Gate D4.2 或任何 V1 Gate

## 1. 方法

三轮使用互不复用结论的检查表；每轮重新从源码事实出发，并以“出现 BLOCKER/MAJOR 就修订后从该轮重跑”
为规则。审查不以测试总数、旧报告或未来实现者承诺代替直接代码证据。

## 2. 第一轮：架构与真实代码可实现性

结论：修订后 PASS，BLOCKER=0，MAJOR=0。

核对了 `openfilm-composition.ts`、`openfilm-engine-adapter.ts`、`project-resolver.ts`、`migration-store.ts`、
`migration-service.ts`、`migrated-asset-ledger.ts`、`engine-port.ts`。

发现并关闭：

1. 生产 composition 只注册 adapter，`registerLayout()` 仅在测试/探针使用，重启后的 activated target 无法
   inspect。增加 M4A-0/`M4A-P01`，要求 Host 从 terminal migration、active commit、plan、target snapshot facts
   与 ledger 重建 layout；缓存可丢弃且不成为 authority。
2. migration plan 在复制前冻结，`identity_map=[]`；report 的 `target_clips` extras 不持久。删掉依赖二者恢复
   clip 的错误设计，改由 pinned upstream 解析 `film.html`；Host frame count 继续取 durable
   `target_total_frames`。
3. adapter projection 的 snapshot id 由 digest 派生，revision/control revision 为兼容占位 0。明确 Impact 的
   identity/base/control 只能取 `ActivatedProjectView`，ConsumerGraph cache 键使用 Host active commit snapshot。
4. adapter 当前会静默跳过无 id/src/未知扩展的 clip。新增 projection completeness 门：upstream 节点必须
   一一映射；未建模字段、override、transition 线索或任何 skip 必须进入 problems/拒绝 impact。

约束复验：EnginePort 仍恰好七方法；没有第二 DB、第二 timeline、adapter commit 或请求路径输入；M4A 只读
当前 active source，历史 snapshot inspect 不足时 restore intent 保持 blocked。

## 3. 第二轮：合同、身份、锁与事务边界

结论：修订后 PASS，BLOCKER=0，MAJOR=0。

核对了 `wave2-types.ts`、impact/adopt/restore schema、validator、LockService、ProjectOperationQueue 和 Wave 2
架构契约。

发现并关闭：

1. 初稿把 impact 视为“无 content commit 所以无需幂等”，但它会持久化授权 row，违反项目统一 POST 写请求
   规则。`ImpactRequestV1` 增加 1..200 的 `idempotency_key`；同 project/operation/key+digest 完整重放且不续期，
   异 digest 409，过期后须新 key。
2. native plan 的新 `clip-<segment>` id 不是当前 visual lock target。规定 plan range 与当前 projection visual
   clip 求交，`affected_ranges.clip_id` 使用当前 clip id并规范合并，否则会绕过既有 shot/visual lock。
3. 冻结 `locks_checked` 为本次读取的全部 active locks 稳定快照（最多 64）；真实冲突 423 且不落 row；
   `approvals_required=["human_confirmation"]`，不代表费用或外传授权。
4. 明确 impossible race 边界：最终检查前变化不得落 active row；insert 后外部 bytes 才变化时，下一次
   replay/requireCurrent 必须 CAS stale 并 428。任何 M4B 消费不得只读 active flag。
5. 最终交叉核对发现 C-04 已冻结 `operation_idempotency` 为 Wave 2 唯一权威，初稿却在 impact 表增加第二个
   key 唯一约束。已删除双权威：固定两个 impact operation kind，复用通用表，并要求 impact row 与完整 response
   在同一 `RevisionStore.atomic` 事务提交；两侧任一故障均不得留下 orphan，M3 行为必须回归不变。

规范复验：request 不含 range/consumer/rights/lock/hash/path/URL/shell；hash 包含所有服务端事实和 expiry；
TTL 边界 `now>=expires_at`；state 只有 active→consumed/expired/stale；仅允许同一 SQLite 事务内的 impact row
与通用 operation-idempotency response row。

## 4. 第三轮：完整体验与验收可判定性

结论：PASS，BLOCKER=0，MAJOR=0，MINOR=2（均为明确声明边界）。

逐项从用户动作“对 ready materialization 请求影响说明”反推 HTTP、失败反馈、重试、重启和回退：

- adopt impact 新建及同 key/同 digest 重放返回 201 完整同一 spec；stale/locked/attention/ambiguous 均有确定
  状态码且没有 author source/revision/pointer/job/outbox 副作用；
- fresh Host 必须通过真实生产 composition 重建投影，不能靠测试 hook；
- M4A-NW01、M4A-P01/C01/DB01/H01/TTL01/R01 和 TX-02A..05A 均有正向、负向或竞争证据要求；总测试数
  不能替代逐 case 映射；
- 自动化仅 Headless、静音、隔离、无窗口、不抢焦点；本阶段无 UI，headed/human 明确 NOT_RUN；
- 回退只关闭 impact route并保留 additive table/证据，不 reset、不删除历史。

MINOR/边界：

1. restore intent 的请求合同可冻结，但当前没有 immutable historical layout 读取能力，因此 M4A 必须 capability
   blocked；M4C 才能开放，不能拿 active source 冒充。
2. `MEDIA_TOOL_UNAVAILABLE` 对单个 M3 materialization 的终态语义保持不变；M4A 只接受重新验证后的
   `ready_for_adoption`，不在本阶段扩大修复。

## 5. 最终裁决

文档已足以让 Claude Code 在不猜测核心合同的前提下实现 M4A。允许开工，最高声明
`M4A_INTERNAL_EVIDENCED`，完成后必须停止在 Codex 复核点。禁止提前进入 M4B/M4C 或声明
`WAVE2_COMBINED_REVIEW_PENDING`、`WAVE2_EDITABLE_ADOPTION_READY`、Gate D4.2、Gate V1-P0、V1-Full。
