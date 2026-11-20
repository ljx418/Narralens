# R7 条件设计修订复核

**REQUEST_CHANGES**。五项原发现中，D01、D02、D04 的条件合同已闭合。D03 和 D05 各剩一组需要改清的生产责任与直接验收条件。

| 原项 | 复核结果 | 已可复用的设计 |
|---|---|---|
| D01 | 闭合 | 调用前同步建立本次 attempt；closing、未 reserve、已接纳 parent 分别记账。失败仍查询原 attempt，未知不进 POST。执行域 reconcile 不等待依赖它的 parent。 |
| D02 | 闭合 | PRE/POST 在取得资源前有 acquisition owner；按 allocation 记录物理 close 返回，再单记观察器异常。未知额度保留，重入不重关复用整数。 |
| D03 | 部分闭合 | 未发布 prepare、父 FD 最后关闭、全局 phase-one 与逐根 dispose 的顺序已明确。剩余问题在 serving 构造失败。 |
| D04 | 闭合 | 原 operation 持责；已排队 reservation 的 deadline/abort 只结束自身，新调用按既有规则拒绝。三个分支都不启动第二个 producer。 |
| D05 | 部分闭合 | 同步提交区间覆盖 mint、activate、consume、release；consume 拒绝须同步 revoke、标记和持责。成功时核原 scope 非 live，允许同根后继获授新 scope。 |

## R7-D03

servingFor 使用已发布的 #prepared record。绑定失败时本次 flight 取得的是新 serving owner，并未取得 prepare 持有的目录或 source FD。第36行要求尝试目录/source处置，可能提前关掉已发布工作区。反过来，工厂在返回 owner 前若出现真实清理错误，仅抛带 failures 的错误；合同要求保留工厂责任引用，却没有给该分支交接入口或直接反例。

分别列 prepare 未发布、自建 serving 未注册、工厂尚未返回 owner 三种责任。servingFor 对已发布目录仅保留定位/登记，目录继续由 workspace 在允许 dispose 时处置。对工厂分支，可在调用前建立由工厂更新的私有 attempt，或明确由工厂保有可识别的原工单并给 flight 只读关联；不要把错误数组当资源凭据。

**直接验收**　已创建 owner 的绑定失败只收本 flight 新资源，原 record/目录句柄仍可由原 owner 使用或保全。增加 factory 在发布 owner 前失败的成对反例：listener 已真实关闭后诊断抛错，与真实 listener/folder disposition 未知；分别核原根、工厂 attempt、原始 cause 和处置权限，禁止普通失败泄漏槽。

文档位置：candidate/PRIVATE_SEAMS_REV2.md:34–40,63。源码依据：created-native-workspace.ts:336–357,648–665,685–709；openfilm-upstream.ts:1531–1563。

## R7-D05

D05-b 要求在真实 caller 中刚 mint 的有效 completion 由原合法边界 consume=false。成功 mint 已登记同一 scope、owner、generation 与全部 settled phases；activate 只改 witness ledger，无 await、回调或凭据替换。该原始同步路径没有让新凭据变为无效的状态迁移。另，第55行的“只有确实完整成功才release”未区分业务失败和资源结算失败，activate 拒绝但各资源已证终局时可能永久持槽，与第16行的失败归还冲突。

将 D05-b 定义成防御分支的 D1 受控返回值，用区间外预装、同步且不可重入的窄故障接缝；另给原 complete 函数真实拒绝已消费/外来凭据的 direct 对照。这两条证据分别注明强度。明确只有完整成功才交付 witness；业务失败且资源齐备可用 failed completion 消费并释放；缺凭据、消费被拒或资源未知则 revoke、标记并保留原 work。

**直接验收**　D1 受控拒绝证明原 caller 在任何可观察边界前同步撤销两种 lookup、标记并登记 held；不伪称合法新 token 自然失效。增加 activate 拒绝但物理 phase 全齐的对照，caller 收原失败、两种 lookup 均不交付本次项、failed completion 仅消费/释放一次。原成功与排队后继两项保持。

文档位置：candidate/PRIVATE_SEAMS_REV2.md:53–59。源码依据：cache-production-scope.ts:538–562,577–598,610–619；native-cache-witness.ts:161–211（沿用首轮证据）。

已独立核对修订回执五个文件的实际 SHA-256，并比较归档与当前 CASE_MAP 的全部字段。10 行只增加 required_r7_document_sub_evidence，其余字段和顺序完全相同；35 个原 ID 的状态均为 NOT_RUN。原基准清单的对应关系复用首轮独立核验。四个本轮摘读的产品源码文件摘要均与首轮相同。

startDraw、inspectAttempt、beginRetainedOpen、RootLifecycleRecord 等是目标私有接缝。R6 接受后再重锚实际签名与终局来源。本次结论仅针对修订文档，未运行产品或测试。
