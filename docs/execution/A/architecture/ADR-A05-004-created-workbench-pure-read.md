# ADR-A05-004：新建工程的原生只读展示

本次为已授权A05的增量实现，不改变31个CP-A0 Agent合同，不改变旧迁移workbench@1合同/路由。

## 决策与代码实体

- contracts/created-workbench.schema.json、src/contracts/created-workbench.ts 定义独立created-workbench@1.0。明确origin=created、migration/source lineage为null、允许0帧、history使用真实project_transaction.kind（创建实际为snapshot_publish/base0→revision1），不发明迁移或虚构creation journal。
- CreatedWorkbenchHttp 在同一Host的/api/ui/v1/projects/:id/created-workbench只开放GET。Host/Origin/重复安全头/真实trusted_ui cookie及origin proof在资源访问前核对；不接受driver/native_bridge。未知query/body拒绝。实际异步读取完成后重新验证原session/owner，撤销不返回私有投影。无CORS、no-store、错误统一且无路径。
- CreatedWorkbenchService 先真实owner→resolveCreated→layoutFor→固定EnginePort.inspect；随后检查active commit/snapshot/source/control/recovery和投影闭包完整性。一切来自当前工程，不使用legacy catalog或migration身份猜测。
- GET不ensure Studio、不准备native副本、不触发任务/审批/采用；preview=null，native_sync=unknown，写能力blocked。当前接口没有native loaded证据，不能升级真实Context或签NativeAck。
- 当前任何sound只能证明存在音轨，旁白返回unknown；无sound且完整projection时absent。真正旁白绑定及质量/许可仍需实际producer。
- 原M5后续只能显式union/纯视图适配，不能把新DTO强转旧合同。Gateway跨origin读取和操作之前，另须owner/project/nativeID/Host代际/workspace身份受限delegate，匿名旧cookie无权提升。

## 风险及回退

当前GET仅供owned Host UI读取，不代表原生面板已挂载，不代表真实影片/Run/Task/正式交付完成。原生观察、受限Gateway、实际工作流与片段组装为后续连续实现。history超过256时本读模型fail closed，不暗中截断而声称完整历史，后续定义窗口消费。移除CreationApplication的纯读HTTP委托即可关闭新入口，不删除author/snapshot/历史。

## 实际验证

类型检查r1曾失败：Ajv默认类型推断不足，改为compile<CreatedWorkbenchProjection>并在校验成功后直接返回值，避免双重断言。r2类型通过，4测试中1失败：初始工程原生包含track_0/track_1两条空轨道，原测试错误期望tracks=[]；保留实际projection并修正预期，未删除空轨道。r3类型和3files17tests通过；之后预审sound语义由present改unknown，最终源码复验另记，不以此前结果冒充增量通过。自动化均Headless/无窗口/无外传，无人验签署。

最终r4：同一最终源码类型检查0、3files17tests/35.00s全过、Host与M5两套生产bundle构建0、固定规则扫描0命中。保存r1/r2/r3失败与早期结果，不覆盖；仅限定纯读链内部验证，独立外审及整个A仍未完成。
