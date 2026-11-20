# PROC-0 开发与验收安排

MAIN设计/合同和样例 → 独立Codex只读PLAN_READY → 原供应商Claude单writer实现工具+direct tests → 交还清单预检 → 独立源码审查 → MAIN另票有限helper实证 → 冻结工具检查点 → 同原R6合同继续，不在每个内部小步请人类批准。

候选实现路径：tools/run-delivery.py；tests/process/test_delivery_admission.py；tests/process/fixtures/admission_helper.py；tools/check-delivery-spec.py（仅补实际cmd/cwd与允许命令绑定等缺口）；tests/process/test_delivery_handoff.py（如需要，具名release后才写）；docs/process/proc-0/OWN_*报告与case packet。无src/、公共合同、依赖、原recorder修改。canonical本包MAIN-owned，实施者只能写W对应OWN文件；没有范围外“顺便重构”。

bootstrap FIRST命令通过旧recorder录制：python3.12 -I -S -B tests/process/test_delivery_admission.py（pure mocks）和test_delivery_handoff.py（如已释放）、python3.12 -I -S -B tools/check-delivery-spec.py --self-test。元数据当前PARTIAL拒绝用其预期2捕获并明确这是流程拒绝，不是产品失败。新wrapper自证运行前需代码审及精确helper release；bootstrap不能用尚未验证的新wrapper自签完整性。

CASES.json 16项全部保留；独立审查前不能只提交工具函数存在或selftest计数。持久写入、真实入口、同run owner、异常等待职责、状态与metadata分离都要直接正反例。两客户实际争抢、真实helper actual wait、原日志/输入/hash在第二层MAIN自证，不拿fake作跨进程原子性证明。

本期旧挂起fixture当前已用tempfile，两轮drain；不重复改源自称新修复，不用file例证明真实pipe/backpressure。R6恢复时补当前guarded suite及晚输出真实票，原python003记录及source_changed保留。

新429即时停，不自动重试/重启/切供应商/Codex接手。普通实施/fixture失败应同票闭环；不为推进而删案例、加timeout或标部分主体完成。最后按原goal继续R6→R7→R8→NEXT，不在工具门完成就宣布整个goal达成。
