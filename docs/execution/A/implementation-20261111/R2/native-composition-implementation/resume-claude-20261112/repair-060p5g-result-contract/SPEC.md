# R5G 完整结果契约单批实施
你是原ClaudeCode唯一实现者，继续R5F当前dirty字节；不reset/stash/覆盖旧实现，不新建替代项目。MAIN已对本票完整结果契约完成独立文档闭环，不是再发两条模糊finding让你自行猜合同。

先读本目录 RELEASE.json、RESULT_CONTRACT_AND_CASE_MATRIX.md（F01..F10/C01..C10全文）、MAIN_PLAN_REVIEW_AUDIT.json、plan-review/REVIEW.md 与 FINDINGS.json（实施注意点），再读START_INPUT_BINDING.json与release.findings的R5F代码审查。正式合同SHA 493f86e334b25a4d2fa240b2248f485c910f379747b9c7e1e91ec4b82f124319。原R5F reviewer 2MAJOR仍未在代码闭环；本票按表完整实现，不仅补两个具体if。

范围：RELEASE.allow_existing原八文件+RELEASE.report自身报告，无新source。已批准内部PositivePilotOutcome必需readonly diagnosticSnapshot只返回runner已一次取得的同一冻结snapshot；producer/candidate/final/outcome按已审规范逐字段一致，actual Error identity/direct cause不从JSON虚构。actual main/legacy/pure继续使用唯一verifyPublishedRun，保持全行实际字节hash/长度和原子publish。参考plan-review的注意点：transport envelope不是小三字段error、raw与diagnostic cleanup分别绑定原事实不强求两个数组彼此相同；mock成功终局fixture需显式适配，不为旧stub放宽proven门；合法wrapper cause与早期null snapshot普通失败沿原协议保持。

全部F01..F10/C01..C10在同一实施批完成；缺字段/错型/记录矛盾为3，不把普通完整一致业务failure1算PASS或偷改成3；正常0、确切fault1、参数2、证据不可靠3正控都保留。参数化覆盖每个适用结果mandatory字段的删除/错型/合法型矛盾，测试经实际writer/publisher委托自然生成正确hash，再驱动actual checker/main，不伪hash、不复制consumer。必须输出逐F/C到actual producer/checker/consumer/test/capture映射；不可用总数替代。所有新增counterexample只pure安全mock，不执行任何真实C/N。

允许runtime仅RELEASE六种FIRST-recorder命令形式。recorder路径/sha不变，capture_prefix唯一n1n2-claude-060p5g-，所有首跑有capture、不覆盖、不timeout包裹。执行期间651源输入固定；generate只能改integrity JSON，最后完整六命令同源。已批准raw guards/逐case脚本/ledger finally不得弱化，原group/reaping/authority/cancel算法不得重写。只做必要内部结果投影、字节checker与现有测试fixture改动；不扩大公共DTO/API/MCP/EnginePort/DB/引擎。

5s失败和20s当前mock预算原样保留并如实记为根因未证实，不继续加预算/改生产deadline或断言求绿；若当前例再挂，保留阶段事实和handle，做根因诊断。安全旧逻辑red也必须首跑recorded，不恢复危险guard版本。早期os.kill越界/004 MAIN精确停止/005 INCOMPLETE/旧FAIL全部保留，不能事后宣称无影响或改写exit。

禁止Git add/commit/reset/stash/checkout/push/merge，保护user AGENTS/protected7/Approved015/旧captures/reviews；禁止读改配置/凭据、网络/费用/J盘、Host/Chrome/media/Q2/full/build、混合kernel lifecycle文件运行。该文件可改为薄调用并typecheck，纯测试运行实际同一checker，不冒充混合真实验收。

普通实现错误/测试失败在同批内自动修复，无需为已决字段/报告格式反复等MAIN；确实与审定合同冲突或原八范围不能实现时，ask给出具体字段/最小路线，不自行退化或扩大。新429立即停上报，禁止自动重试、重启/换供应商/配置、Codex接手。完成全文矩阵+六同源捕获后worker_done交还，不自签独立审查或真实N/N1N2/V1；MAIN受影响代码复核通过后另发两真实N票，R6R7R8/原17+ISO18/冻结审查/NEXT目标保持。
