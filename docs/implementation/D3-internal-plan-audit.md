# D3 开发计划内部独立审查

版本：v1.1（2026-10-12）  
状态：通过；首轮问题修订完成，第二轮外审确认 12/12 CLOSED

## 审查范围

以 `01_PRD.md`、`03_Architecture.md`、`04_Development_Plan.md`、`05_Acceptance_Plan.md`、`11_V1_Traceability.md`、D1/D2 证据、固定 Hypit Studio 源码与真实 `/__studio/session` 快照为事实基线，审查 `D3-development-and-acceptance-plan.md` 和 D3 Archify 图。未审查尚不存在的 D3 实现。

## 结论

首轮内部审查未发现未关闭致命或重大问题，允许提交外审，但外审通过前不得实现 D3 生产代码。

## 独立核查结果

| 维度 | 结论 | 依据/约束 |
|---|---|---|
| PRD 范围 | 通过 | 只承诺单镜视觉 fit 写入；明确 D4 才闭环缺素材 Proposal 采用，不虚增规格 |
| 上游事实 | 通过 | 使用真实 `parameter.adjust`、session revision 与 authored ID；不臆造 Hypit API |
| 身份模型 | 通过 | 业务 shot ID 显式映射 authored ID；运行期 opaque ID 不出 Adapter |
| 原子性 | 通过 | Hypit 内部回写 + Narralens journal/补偿/启动恢复；第三状态进入 attention |
| revision | 通过 | Narralens 与 Studio revision 分离；成功仅在 metadata commit 后可见 |
| 锁 | 通过 | Host 强制 visual lock；不以 UI disabled 代替安全边界 |
| 不变量 | 通过 | 帧数、窗口、非目标 fit、旁白 item/资产 hash、Run hash均逐项验证 |
| 错误语义 | 通过 | 409/422/423/503/500 的触发与不变性门限明确 |
| 可验收性 | 通过 | 正向真实写入、重开、正常事务恢复 baseline、失败/崩溃注入均有硬门限 |
| 安全 | 通过 | 登记 loopback origin、禁止客户端 URL/路径、响应脱敏 |

## 已在首轮关闭的问题

1. **提案与写入能力混淆**：当前 D2 提案不可渲染且需 materialize，已禁止 D3 将自然语言/segments 猜成 fit；阶段出门改为明确的用户选择型写入原语。
2. **双 revision 歧义**：已把跨进程 Narralens revision 与进程内 Studio revision 分开命名和校验。
3. **mutation 后 metadata 失败窗口**：补充 before value、补偿 mutation、启动恢复三态判断与 attention 阻断。
4. **shared frame 误伤风险**：不写共享 `space:Frame`；只写目标 `visual:Clip` 自身的 `fit` 参数。
5. **测试清理伪造**：真实 E2E 必须通过第二个正常事务恢复 baseline，禁止手工覆写或 git checkout。

## 仍需外审重点

- SQLite 与 Hypit 文件系统之间无法形成单一 ACID 事务时，journal 三态恢复是否足够确定。
- no-op 不递增 revision 是否与幂等、审计和用户预期一致。
- Hypit Origin 策略与 descriptor 固定 preview origin 是否还存在 SSRF/跨工程风险。
- D3 对 P0-07/P0-10 的“部分关闭”措辞是否足够保守。

## 外审后内部复核

Claude Code CLI 首轮给出 `EXTERNAL_REVIEW=PASS`、致命/重大 0，但同时提出 12 个进入实现前必须修订的一般问题。内部复核认为这些问题虽不改变主路线，仍会造成错误码歧义、恢复边界不完整或图文不一致，因此没有直接开工，已逐项修订：

- 移除架构图中不属于 D3 的 Host staging/check 前置链；重建后 Archify showcase 9/9、0 error、0 warning。
- 区分 `REVISION_CONFLICT` 与 `IDEMPOTENCY_KEY_CONFLICT`，补 401/403/attention。
- 冻结 Hypit 5xx 失败关闭规则和 control/options/type 预校验，禁止基于错误字符串猜映射。
- 为 descriptor、operation、request、success/error response 增加规划 JSON Schema。
- 明确 Studio 不可达、journal 损坏、补偿失败/不确定均进入 attention；补偿关联与判定顺序已冻结。
- 明确 D3 只提供 visual 主动锁，narration/duration 只是 preserve + hash 不变量。
- 固定 `shot-2 fit=cover` baseline、两次正常事务与 revision/hash 证据链。
- 冻结 descriptor `studio_origin` 白名单来源、无重定向/无客户端覆盖和 descriptor 安全扫描。
