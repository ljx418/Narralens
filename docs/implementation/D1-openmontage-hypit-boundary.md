# D1 OpenMontage—Hypit 受控边界

状态：已冻结（2026-10-12）

## 结论

OpenMontage 的 `proposal_packet` 是项目级概念、制作计划、成本与批准载体；Narralens 的 `ProposalBundle` 是绑定某一工程修订的镜头级变更提案。两者不得冒充同一个对象，也不允许 OpenMontage 直接写 Hypit Author Source。

## 单向数据路径

1. OpenMontage pipeline 产出并校验 `proposal_packet`，保留其审批与成本语义。
2. Narralens Proposal Adapter 读取已批准 packet、当前工程只读快照和素材清单，生成符合 `contracts/proposal-bundle.schema.json` 的候选提案。
3. 提案以 `baseRevision` 锁定基线；过期提案必须标记 `stale`，不得静默套用。
4. 用户明确批准后，Apply Adapter 把镜头操作转换为 Hypit Author Source 变更；Hypit Source 始终是时间轴唯一事实源。
5. Hypit `check → plan → build → get` 负责验证和提交结果；OpenMontage 不接触 Result 目录。

## D1 已验证与未验证

- 已验证：pipeline manifest 可由上游 loader 校验；artifact schema 自身有效；tool registry 可发现且不调用 Provider；Hypit Author/Run/Result/Studio 为真实入口。
- 未验证：真实模型生成 proposal、自动镜头语义映射、完整 apply/rollback。这些属于 D2 及以后，D1 不作实现声明。
- D1 测试夹具无字幕流，因此 `preserve` 中的 `captions` 声明不构成字幕保留验收证据。

## 强制拒绝条件

- `base_revision` 与当前 Source 修订不一致。
- 成本预计超过 `cost.approved_ceiling`（该字段存在时）。
- 片段帧范围非法、重叠规则不明确或引用资产不可解析。
- 未经用户批准即请求 Apply。
- 试图直接改 Result、绕过 Hypit check/plan，或将 OpenMontage Agent 指令伪装为稳定 HTTP API。
