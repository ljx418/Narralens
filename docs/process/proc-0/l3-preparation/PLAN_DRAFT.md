# L3有限实际工具验收准备（DRAFT / NOT_RELEASED）

此文只做MAIN验收设计，不授权执行，不改变候选9c2f6237f997c27e3f2d013fec48107a56f862ba，不代替独立L2结果。若L2修源，全部输入重新锚定，受影响L1重新验证。

## 释放前门
L2明确SAFE_FOR_SEPARATELY_PINNED_TOOL_RUNTIME且无未闭环当前阻塞；原16 case层级不减；W真实HEAD/source/保护项及原recorder/outerPython重新核；无源码writer、无在途冲突验证。L3票列全16 case，DIRECT-only复用已核L1，不强制为其另造helper。全部实际步骤唯一command/capture/run与原六件套，原FIRST规则保持，helper/状态/sidecar只写具名var根。MAIN现场验收driver也须有具体源码及保护SHA并先经过只读审查，不借未审wrapper自签。

## 目标与最小实际矩阵
1. 成功helper：精确Python admission_helper.py pass，inner0/原recorder实际wait0/原六件套/副证/原组CLEAN；不只打印字样。
2. 指定失败helper：specified-fail，inner1/原recorder实际wait1；原日志实际出现TOOL_HELPER_EXPECTED_FAILURE，凭据绑定该case、该capture全摘要、该run/command/source/保护项及真实cleanup。这条是工具指定负例合格，不是产品失败通过。
3. 两实际客户重叠争抢：A执行barrier并创建具名held；MAIN观察到held且A真实句柄仍运行后，B以不同获准run请求同project同state槽。B必须在新原claim/Popen之前拒绝；A保持唯一原claim/Popen/wait责任。B自身CLI进程不是原recorder，分别计数。只观察一次赢家不足，须记录B真实拒绝及其分配六件套均不存在。
4. 在A仍持有barrier且真实句柄运行时request-cancel同run。核持久cancel_requested=true，A责任不释放；再次不同请求C仍拒绝。MAIN写该helper自有release文件后由A自然返回并由原owner实际wait，原六件套inner0、终局保留cancel_requested=true。不对recorder/组发信号，不杀wrapper。取消请求不冒充产品已取消。

三种helper精确argv与全部需要的客户端CLI请求、ticket owner、generation、state root、run/command/capture表须在正式票明示。不能让worker临时加argv、换根或无限重试。pass/fail各一次；争抢拒绝请求仅按明确名单，预留capture未用不强制执行。若仅有意拒绝返回2不生成capture，保存其外部实际argv/exit/stdout及状态前后，不能伪造原六件套。

## 安全与观察边界
MAIN driver为一次性验收仪器，不是新增产品调度器。保持Popen对象，同一实例实际wait；任一异常不丢所有已创建客户端句柄，不自动重启。有限barrier上限只产生helper自然失败3，不证明资源消失；未等到held或错误结果即保留事实，后续无授权步骤停止。遇到异常始终核真实句柄/owner后必要保全，不用另一个timeout包装。

需要两类记录：原recorder原件，由runner唯一生成；MAIN观察/CLI请求结果，由driver如实生成并标明非原件。不得把外部driver退出码当内层helper退出码。状态history/sidecar/journal/原claim关联按release核对。无网络、模型、Host、Chrome、fork实验、prctl、信号、产品C/N；真实wrapper死亡注入NOT_RELEASED。

## 交还与后续
L3结束后仅在原owner actual waits、已观察组资源状态清楚、原始输入和保护项无漂移时汇总。合并L1原003与本L3获准票；FINAL_METADATA外部根显式批准阶段path/SHA/phase/source/保护差异，16项逐required slot交还。L4 metadata只是送审准入，另取独立裁决后才可声明PROC0工具门完成。R6/原17+ISO18/R7/R8/NEXT仍继续，不由本票调绿。
