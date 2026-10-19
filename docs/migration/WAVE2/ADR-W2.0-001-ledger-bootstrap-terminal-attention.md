# ADR-W2.0-001：`asset_ledger_bootstrap` 的终态边

状态：`APPROVED_BY_DOCUMENT_OWNER`
日期：2026-10-18
文档所有者裁决：2026-10-19
适用范围：`docs/migration/WAVE2/02_ARCHITECTURE_AND_CONTRACTS.md` §4 持久模型（`asset_ledger_bootstrap`）
实现提交：本文件随 W2.0 correction 一同提交

本文件是**追加**裁决，不修改任何已冻结文件。`02_ARCHITECTURE_AND_CONTRACTS.md` 与
`06_DOCUMENT_FREEZE.md` 保持原样，因此冻结收据里记录的 SHA256 与当前文件不再一致；
这是有意的，变更以本 ADR 追加而非静默覆盖。

## 1. 触发事实

W2.0 首版为了让 ASSET-02 可实现，把 `active -> attention` 加进状态机。
同一版实现的 `reverify()` 又允许 `attention -> active`。Codex 独立复验判定为
生产路径假绿：`attention` 既能被进入又能被自动退出。

这不是风格问题。如果一个 ledger 可以自己从 attention 恢复：

- 操作员看到 423 之后无法依赖它持续存在，下一次读请求可能就变成 200；
- 进入 attention 的原因常常是"这份许可是否可接受"这类需要人判断的事实，
  自动恢复会用重新推导的字节事实覆盖那个人工判断；
- 任何以 attention 为输入的锁、impact 或审批都会看到一个不稳定的门。

## 2. 决定

状态机只有三条边，且 `attention` 是终态：

| from | to | 用途 |
|---|---|---|
| `prepared` | `active` | bootstrap 成功 |
| `prepared` | `attention` | bootstrap 证据不足，直接落 attention |
| `active` | `attention` | 已证实的声明被后来事实推翻，撤回该声明 |

明确禁止：`attention -> active`、`attention -> prepared`、`active -> prepared`，
以及任意自循环。

`reverify()` 与 `bootstrap()` 只能把 ledger **推进** 到 attention，永远不能移出。

## 3. 与冻结文档的关系

`02_ARCHITECTURE_AND_CONTRACTS.md` §4 写的是"只允许 prepared→active/attention"。
本 ADR 不静默修改该句，而是补充两条裁决：

- 照字面执行会让 ASSET-02（"source manifest/target bytes/license 变化进入 attention"）
  无法实现：一个 active 的 ledger 永远到不了 attention，就会持续断言已经不再为真的事实。
  因此批准 `active -> attention`，**仅为**让已失效的声明可以被撤回。
- 同时批准"禁止自动退出 attention"作为补偿约束，使该边成为 `active` 的唯一出路，
  而不是一条可以被 `reverify` 往回走的双向通道。

原句的其余部分（表结构、主键、UNIQUE 约束、写入时机、"不得由请求懒触发"）未被修改。

## 4. 明确未实现的部分

"如何显式地、经审批地退出 attention"属于后续阶段，本次**不提供实现**。
它需要独立操作、base/control revision、以及可审计的记录。
在设计冻结前凭空造一个退出路径，正是本 ADR 要消除的那类风险。

当前阶段的 fail-closed 行为是：留在 attention，相关能力保持关闭并返回 423。

## 5. 受影响的 AC / case

| 项 | 影响 |
|---|---|
| AC-015 不保存第二份 timeline | 无影响；attention 不涉及任何时间轴事实 |
| AC-002 Host 拥有 commit | 无影响；attention 是 Host 事实，不是 adapter 行为 |
| ASSET-02 | 本 ADR 是其可实现的前提 |
| ASSET-03 | bootstrap 的 prepared→active 必须在单事务内完成，见同批 correction |

## 6. 验证

`tests/wave2/w2-ledger-attention.test.ts` 断言：

- 三条允许边成立；
- 五条禁止边被拒绝（`attention->active`、`attention->prepared`、`active->prepared`
  及两个自循环），并断言拒绝后状态未变；
- 从当前状态之外发起转移被拒绝；
- 恢复原始 target bytes 后连续三次 `reverify` 仍为 `attention`；
- 恢复原始 licence 后 `reverify` 仍为 `attention`；
- 已在 attention 时再次漂移不覆盖原 reason；
- control_revision 每次真实转移恰好 +1，无变化时不递增；
- `bootstrap()` 不能绕过 attention。

## 7. 文档所有者批准记录

2026-10-19 批准本 ADR，并作为
`02_ARCHITECTURE_AND_CONTRACTS.md` §4 的追加权威裁决。批准范围仅限：

- 允许 `active -> attention`，用于撤销已被后续事实推翻的资产/许可/字节声明；
- `attention` 保持终态，禁止 `reverify()`、`bootstrap()` 或读请求自动退出；
- 未来如需恢复，必须另行冻结带 base/control revision 和审计记录的显式操作。

本批准关闭 `ARCHITECTURE_DEVIATION_BLOCKED`，M3 可建立在该状态机上。
