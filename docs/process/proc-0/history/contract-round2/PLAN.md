# PROC-0 开发与验收安排

MAIN设计/合同和样例 → 独立Codex只读PLAN_READY → 原供应商Claude单writer实现工具+direct tests → 交还清单预检 → 独立源码审查 → MAIN另票有限helper实证 → 冻结工具检查点 → 同原R6合同继续，不在每个内部小步请人类批准。

候选实现路径：tools/run-delivery.py；tests/process/test_delivery_admission.py；tests/process/fixtures/admission_helper.py；tools/check-delivery-spec.py（仅补实际cmd/cwd与允许命令绑定等缺口）；tests/process/test_delivery_handoff.py（如需要，具名release后才写）；docs/process/proc-0/OWN_*报告与case packet。无src/、公共合同、依赖、原recorder修改。canonical本包MAIN-owned，实施者只能写W对应OWN文件；没有范围外“顺便重构”。

bootstrap FIRST命令通过旧recorder录制：python3.12 -I -S -B tests/process/test_delivery_admission.py（pure mocks）和test_delivery_handoff.py（如已释放）、python3.12 -I -S -B tools/check-delivery-spec.py --self-test。元数据当前PARTIAL拒绝用其预期2捕获并明确这是流程拒绝，不是产品失败。新wrapper自证运行前需代码审及精确helper release；bootstrap不能用尚未验证的新wrapper自签完整性。

CASES.json 16项全部保留；独立审查前不能只提交工具函数存在或selftest计数。持久写入、真实入口、同run owner、异常等待职责、状态与metadata分离都要直接正反例。两客户实际争抢、真实helper actual wait、原日志/输入/hash在第二层MAIN自证，不拿fake作跨进程原子性证明。

本期旧挂起fixture当前已用tempfile，两轮drain；不重复改源自称新修复，不用file例证明真实pipe/backpressure。R6恢复时补当前guarded suite及晚输出真实票，原python003记录及source_changed保留。

新429即时停，不自动重试/重启/切供应商/Codex接手。普通实施/fixture失败应同票闭环；不为推进而删案例、加timeout或标部分主体完成。最后按原goal继续R6→R7→R8→NEXT，不在工具门完成就宣布整个goal达成。

## rev2分层准入与审查顺序（覆盖前文“交还预检”的简写）
1. L1 bootstrap direct：原recorder FIRST，不依赖新wrapper租约；16case有mock/静态设计映射，真实部分明确NOT_RUN，状态CODE_CANDIDATE_FOR_REVIEW，完整性只判L1材料齐。
2. L2独立源码安全审：审完整L1及全部16项覆盖设计；结论最多SAFE_FOR_SEPARATELY_PINNED_TOOL_RUNTIME。
3. L3 MAIN新release实际工具自证：精确finite helper/两不同客户请求→唯一winner claim与wait；request-cancel不能释放在途slot；0/指定1，不跑产品C/N。原六件套只在原recorder目录分配basename，var存sidecar/state/helper数据。
4. L4最终交还：同源L1+L3完整16项→metadata gate→独立裁决工具完成。不是R6完成；不能为解决顺序循环提前跑真实helper或把NOT_RUN调绿。

checker外部参数--release与--expected-release-sha256必需（除--self-test）。按权威case绑定命令/phase/capture/expected inner exit/evidence层，防整套替换与合法命令错case。wrapper真实outer wait与原inner exit分别记，内层-15/外层241只mock，不额外授权signals。
G1–G4全部接受，修订验收附在CASES.json；旧审查和原合同见history/contract-round1与review原件。尚未实施或运行。
