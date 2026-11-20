# next-wiring rev7 独立文档复验

**REQUEST_CHANGES**。NW6-A02已在文档关闭；NW6-A01的大部分补充成立，但最后释放/交付门仍有1项MAJOR合同缺口（NW7-A01）。这是文档准备性结论，不是implementation-ready、N1N2/060实现通过或业务PASS。本次只读复验全部rev6→rev7差异，没有扩大为实现审计。

## 已关闭的修改

04:58–77已把review-media-http.ts、dispatcher、CreationApplication纳入窄接线路径。请求能力由真实HTTP/dispatcher认证后经私有WeakMap签发，绑定真实AgentPrincipal/session/channel/project；结构化caller或JSON不能铸造。scope明确覆盖session/owner/run/package/part/object/receipt/rights、双marker/namespace和S01授权；原resolver无caller不能替代此能力。异步binding/acquire/open/read/backpressure/descriptor close以及scope release窗口均加入PUB-RD01，且正常对照、同owner换session不能复活旧请求、raw drain/DB最后关均保留。

03:5已改为必读00–07，并区分06的W3目标与07未接受候选，NW6-A02关闭。04明确DB与socket没有跨进程原子事务、已经写入socket的字节不可撤回，这一诚实边界不是缺陷。

## NW7-A01：最终化资源合同仍未闭环（MAJOR）

来源：04:63–65、72，06:143。scope.assertCurrent依赖“持有S01租约的最终有效性”，scope.release又明确释放该租约。describe要求await release后最后同步复核，同时禁止借用已释放lease；但是私有合同没有定义可供这一步使用的authority方法或delivery能力、仍持有的真实依赖及其最后释放者。“实现可将异步资源close与最终失效标记分开”是方向，尚未明确拆分的是实际租约/FD等资源，还是仅一个逻辑有效标志。

零变更反例：正常describe得到候选descriptor，handle.close成功，再await scope.release成功。此时真实S01租约按合同已释放。调用目前唯一已定义的scope.assertCurrent会因不再持有有效租约而拒绝，正常对照无法交付；跳过租约检查、只比较捕获facts及新鲜DB行则没有实现同一S01授权检查。若另行异步acquire，会重新引入最后一次await和释放，不能默认为已有的同步复核入口。固定历史workspace.ts:80–83、934–935也明确lease release会使该lease失效；这里只用来核对租约语义，没有要求057实现未来W3。

最小修订是在04选定两阶段finalization，而不是继续列开放选择：异步prepare/drain排空media close及异步辅助清理，但明确保留最终检查所需的原请求能力、真实S01 guard lease及全部依赖、预算和DB；随后由Host最终transport调用一次性同步finish/commitDelivery，在真实依赖仍held时复核，完成可同步检查结果的终端动作，再沿同一无await路径交付。写明重复finish/release、取消、失败和DB关闭归属。若真实S01租约不支持所需同步终端动作，明确最小受审hook或独立仍有效的delivery能力，不能在已完整release后靠标志/旧facts自证。候选descriptor跨dispatcher await时也须保留Host私有最终交付能力，直达response边界，不把业务方法return误作最终交付。无需修改公共DTO、SQL或底层renderer。

这不是断言该目标不可实现；它要求在实现前选择一条明确可执行的生命周期合同。PUB-RD01/NW-API03/S01-L01/L02增补：零变更最终化成功；prepare/drain期间最终依赖仍实际held；各异步窗口撤session/换包/改marker/使S01授权失效不新增交付；最终guard/终端动作一次，重复close与失败不提前关DB。全部NOT_RUN。机器条目与精确来源见FINDINGS.json。

## 不变量与边界核验

8份Markdown均匹配manifest revision7实际SHA256；归档rev6八份Markdown逐字匹配原rev6独立INPUTS；12份原合同/验收/MAIN决定的摘要未变；07七份历史源码由git show完整SHA `1d348d419120f23f45d958112ea8c43df5a04675`读取字节核验，7/7匹配。没有将W dirty源码当冻结输入。

原S01 28条整行内容与已审rev6逐字相同，没有删项。06的SQL及canonical detail字节均未改，摘要分别仍为：

- DDL：`be75d5683a25861ab2cbe14d0a12c4bbde050a342288e2f254f577a2a6623e56`
- detail：`b021a477274708f2695cd4676d1c806ddef0d5f2d25be6c5c8e9142bc01e4dce`

双marker、六列原schema_migration、完整namespace含异名附着对象/隐式index、逐操作marker新鲜读取、旧binding无原像拒绝及支持回退规则没有被此次修订弱化；本轮不重复签SQL执行证明。accepted_native_commit仍null、implementation_release=false、business_acceptance=NOT_RUN。最终接受commit、060真实owner/接口重锚、ReleaseAssignment精确路径/argv/资源/错误码/回退仍是正常待办，不因它们未完成新增缺陷。

输入结束时全部重读校验未变，实际摘要见INPUTS.json。SQLite/迁移执行、生产Node导入、测试/构建、Host/HTTP/浏览器、media/probe、进程恢复、影片/导出与人工体验全部NOT_RUN。没有修改原rev6报告、草案、源码、测试、Git索引或运行根；060P0及N1N2均未获本报告验收签字。
