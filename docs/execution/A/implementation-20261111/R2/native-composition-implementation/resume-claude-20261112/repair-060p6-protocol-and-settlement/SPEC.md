# R6 当前源码差距核对与整批实施设计输入（仅只读）

本票是主Agent制定R6整批计划所需的当前事实核对，不是生产实现、运行或验收放行。此前R5I源码冻结，真实normal002与fault001最小基线已被MAIN接受。禁止再依据旧R3行号直接重写已经修好的模块；逐项核当前实体与实际消费者。

## 目标及架构约束（MAIN决定）
- R3-C06：CacheReceiptAccumulator→domain validator→result eligibility，须分别约束segment的draw/ticket/顺序与数量、wait实际终态、完整epoch对应、N恰一次且N-last、已收养/parent-reaped类别。摘要一致不能替代语义。发现当前已修项只记录，不重复实施；failed-exec原始错误+已证明资源结束不能被要求creative success。
- R3-C07：Custodian/KernelSettlementOperations→settlement/recovery→final drain/receipt，所有阶段同一有界stdout/stderr总量及EOF事实，不忙等或饿死控制/回收；读失败如实失去成功资格。边界数值取当前定义，不擅改预算。实际channel error不降级。
- R3-C08：预算/库存/事件溢出永久拒绝图像成功；raw ownership直到有真实独立终局才结束。不因flag永恒拒绝已经证明reap的失败收敛，也不能清flag或责任超时冒充结束。须明确bounded证明何时足够、何时仍unknown；不扩大PID/group权限。
- R3-C09：TERM-ignore/adopted handler-ready→真实收养→TERM后同epoch仍活→KILL→收养wait→N-last的可达屏障。现在受保护fixture保持不变；若现有事件/纯测试无法闭环，具体列最小待授权fixture变更，不自行改fixture或执行mixed lifecycle。
- C仍sole wait owner；不能KILL forked C，不能凭超时/旧group/复用PID/延迟测试close推断结束。现有strict gate、no-birth、exec failure、cause、snapshot、reporting、publication-v2、控制流顺序保持。

## 任务
1. 先只读核当前HEAD/branch/index及source8/protected7/current651摘要；绑定R5I复审和normal002/fault001实际记录。不签全阶段PASS。
2. 审核两次最小运行材料的证据边界：normal002初始observer NameError不得抹去，只读补验并未重跑产品；fault001 outer1必须指定失败且真实终局；真实出生观测和新鲜终局不是raw协议录制。
3. 阅读原R3 C06..09 findings及当前TS/Python/测试调用链，输出每条ALREADY_IMPLEMENTED_STATIC / NEEDS_IMPLEMENTATION / NEEDS_DIRECT_TEST / NEEDS_REAL_RUNTIME，不能把旧审查问题全记仍未修，不能计数代验收。R5C旧组的OPEN状态仅提醒不能静默全部签绿。
4. 为MAIN提供精确函数/生产调用者/实际反例/最小文件集合/相关回归/真实运行前置门；对四项给出一份合并依赖顺序，避免逐条返工。R5H NOTE genuine late channel error、旧5s/20s mock隔离缺口按实际关联列入，不假称修复。
5. 本轮只写本票目录下 REVIEW.md / FINDINGS.json / INPUTS.json。INPUTS逐个记录实际read起止SHA，区分hash-read与语义审查。R6源实施/测试运行均NOT_RUN。返回给MAIN具体可开工范围及需要先锁定的合同决策，不自行发Claude实施。

## 阅读入口
- R5I code-review/positive-owner-review/{REVIEW.md,INPUTS.json}、MAIN_EVIDENCE_BOUNDARY_CORRECTION.json
- pilot-060p5i-real-n/MAIN_MINIMAL_BASELINE_ACCEPTANCE.json 与normal-002、fault-001全部独立验收/outer recorder/log/原运行root和镜像（勿输出大块base64或原始敏感内容）
- repair-060p1r3a/independent-review/custodian-review/{REVIEW.md,FINDINGS.json}、repair-060p5a-native-positive/REMAINING_EXECUTION_PLAN.md
- DELIVERY_BATCH_REGISTER.json、N1N2_ACCEPTANCE_PLAN_CURRENT.json、W源码与pure tests、固定受保护fixture，只读。

不得执行产品import、测试、tsc、编译/生成、C/N/Chrome/Host/网络/信号/fork/wait/prctl。不得修改W、Git/index、旧报告/捕获、运行root、当前输入快照或源码。不得调用额外Agent。此票完成后worker_done，等待MAIN制定实施release；仅本文档目录三份输出可写。
