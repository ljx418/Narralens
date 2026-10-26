# ADR-W2.0-007：M4C 恢复事实与错误语义对账

状态：`ACCEPTED`  
日期：2026-10-26  
增补：`ADR-W2.0-006` 的 D-05、D-06；其余决策不变。

## 1. 背景

M4C 实现后，独立审查发现接受态 ADR 与生产实现存在三处未裁决字面差异：不可变恢复事实比 D-06 示例多五类
事实、恢复时所需锁列表必须在发布后仍可读取、D-05 的错误码与全仓既有错误码不一致。继续保留两套说法会让
恢复实现、测试与下一阶段 UI 各自选择不同合同，因此本 ADR 把真实且已验证的设计锁定为唯一解释。

## 2. 决策

### D-01 不可变事实的完整字段

`history_restore_fact` 可以且必须在 D-06 原字段外持有 `project_id`、`impact_id`、`impact_hash`、
`rights_digest` 与 `required_locks_json`。这些字段都是 prepared 时已经成立的不可变事实，不是状态；表仍没有
state，`project_transaction.state` 仍是唯一状态机。表继续由 UPDATE/DELETE trigger 保证只增不改，不得写绝对
路径、原始请求体或第二份 revision/pointer。

### D-02 plan hash 与锁事实的绑定

`required_locks` 是 `HistoryRestorePlanV1` canonical preimage 的字段，因此 `restore_plan_sha256` 绑定它；
`HistoryService` 在一个执行流中从同一 plan 同时写入 hash 与锁列表，并与 `validated→prepared` 在同一
`BEGIN IMMEDIATE` 完成。发布后 current source 已等于 target，无法安全重建差异计划；恢复必须读取这份不可变
锁事实，并用 impact 的 `native_plan_sha256 == restore_plan_sha256`、impact id/hash、rights digest 共同证明授权。
恢复不得从 `affected_ranges` 猜测锁类型，也不得把锁事实当作可变策略表。

### D-03 错误码

D-05 所述“不支持的多文件”以及已识别但不受 M4C 支持的恢复拓扑统一返回 HTTP 422
`UNSUPPORTED_EDIT`。请求本身缺少可构造计划的必需事实（例如 projection `problems[]`、缺 roots、字幕集合
不一致、无差异、超过上限或缺 consumer）属于请求不能形成有效计划，仍返回 HTTP 422 `INVALID_REQUEST`。
两者均 fail closed：前者表达“能力不支持”，后者表达“输入不能形成冻结计划”，不得互相伪装。
这与已冻结错误码 union、schema、M4B publisher 和客户端处理保持一致；旧文中的
`CAPABILITY_NOT_ENABLED` 不再是 M4C wire code。

### D-04 transition 边界

当前 `EngineProjection` 没有 transition 实体或字段，固定 OpenFilm adapter 遇到不能一一映射的 clip/track/override/
未知字段会写入 `problems[]`，planner 随即 422 fail closed。因此 TX-04C 的 transition 项为
`NOT_APPLICABLE_APPROVED`，不是 `CLOSED` 能力。未来若引入 transition，必须先扩展 projection、canonical digest、
consumer/lock 分类与黄金向量，不能裸转发或用全项目锁掩盖未知差异。

## 3. 恢复与回退

本 ADR 不增加新写入口或数据库权威，只锁定已存在的 additive 字段与行为。部署回退仍是关闭 restore impact arm、
restore route 与 history translator；保留不可变事实、snapshot、transaction、outbox 和证据。内容回退只能再执行
一次受控 restore，禁止手改 pointer、删 snapshot 或 git reset。
