# PROC0 L2修订002：产物根共同错误 / 小范围WRITE_ONLY

实际owner Task task_1e803fda402b / Dispatch ctx_ab2f1ac4c732不变。B1/005已真实inner1/outer1、observer2、CLEAN、无漂移，B2/B3未执行；原件及failed-source已由MAIN保存，不删除/覆盖。原9项与16case全部保持。

已核根因：runner PROJECT_ARTEFACT_DIRNAME='process-admission'直拼project root；validate_release expected_prefix和project_artefact_root/authority_root都缺var。checker同样漏var。合同rev4要求唯一project_root/var/process-admission/authority，artifact根也只在project_root/var/process-admission之下。fixture现有路径正确，绝不能改为错误的project/process-admission求绿。

允许工具两文件仅作共同路径构造的最小局部修正；可以用统一固定parts ('var','process-admission')与joinpath保证实际产物/authority及release预检相同，不能只改一处使表面门绿。保持规范路径、链接逃逸拒绝、唯一authority、外部受信pin、无自动clear/retry等全部规则。

允许两个direct tests只新增/局部调整针对该回归的语义正反例，不重写文件，不删改其他已备16映射/身份/退出/生命周期反例：真实当前L3形状的project/var/process-admission票可进入真实mock producer与checker；project/process-admission（无var）拒绝且零Popen、不生成另一authority。精确拒绝原因和正控恢复必须核，不能只assert任意error。实际执行仍不放行。

源码白名单4条：tools/run-delivery.py、tools/check-delivery-spec.py、tests/process/test_delivery_admission.py、tests/process/test_delivery_handoff.py；helper及其余source/protected固定。OWN两报告继续追加本轮错误成因/修复/未运行事实，修正旧ticket标签l2-repair-001与bootstrap005，不能覆盖005历史失败。不得大文件重写、另建模块或框架。

WRITE_ONLY：只编辑/静态AST，不import受审模块、不运行测试/selftest/runner/helper/R6/产品命令。完成后通过Orca ask交4变更摘要与freeze请求；MAIN新票006再原FIRST B1/B2/B3，不准自行试跑修复。模型stream畸形如实记录，保持有效小工具调用；新429即停，不重启/重试/换供应商或Codex接写。不得因为本次预检挡住其他分支而声称剩余9项均已通过。
