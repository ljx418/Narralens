# PROC0接回R6的兼容缺口：固定外层，精确内部argv

MAIN检查原R6 RELEASE_CONTINUATION允许的六命令，包含corepack pnpm tsc/Vitest、node integrity generate/check及固定Python helper。PROC-0当前command_run把command.argv[0]当作outer recorder的python，并要求其是absolute python3.12。因此同一已签MAIN白名单的corepack/node无法进入recorded；这是原合同承接主线的功能缺口，不是本轮新增产品功能。

## 最小修复
- 原recorder外层解释器固定为已批准/usr/bin/python3.12（源码常量/既有固定pin，当前实际release已在protected_inputs绑定该二进制SHA），不从内部argv派生，不增加任意CLI解释器/路径/环境配置。
- 内部command.argv仍只能来自外部MAIN SHA绑定的command_id白名单，array/nonempty/type/cwd/phase/source/capture检查保留。原recorder的argv后缀逐字传递内部命令，Popen仍shell=False/不拼接shell字符串；caller无原始argv/--shell/任意cwd入口。
- 对MAIN已签corepack/node命令的pure mock正例必须断言：真实runner Popen外层为固定Python -I -S -B+原recorder+capture，内层是原精确argv，实际cmd/claim是内层；不执行真正Node/corepack/R6命令。
- 旧test_proc0_01把已签MAIN票改成/bin/sh再签成可信，却要求因“不是Python解释器”拒绝，混淆了外层与内层。保持原未知command/坏SHA/空项/未知CLI参数等拒绝断言；将shell反例改为caller请求未授权命令或--shell/--argv注入、外部SHA未匹配的命令替换，Popen不得调用。不是把未授权shell放开，也不能继续以内部命令是Python作为信任判断。
- 这只修承载能力；当前仍只有WRITE_ONLY。所有actual新runner/corepack/node/R6/helper运行均未释放。未来MAIN要先明确write lease中的生成操作，再固定新输入验证幂等性；不能放宽source_changed规则求绿。

本票仅tools/run-delivery.py、tests/process/test_delivery_admission.py和OWN报告；repair-002已冻结的checker/handoff及helper/recorder/产品/旧证据保护。给新两SHA后ask MAIN，bootstrap-003将绑定这次合并候选并重跑B1/B2/B3。当前无测试/编译/生成/运行许可，源码不合Git、不自签L1。新429立即停不重试接手。
