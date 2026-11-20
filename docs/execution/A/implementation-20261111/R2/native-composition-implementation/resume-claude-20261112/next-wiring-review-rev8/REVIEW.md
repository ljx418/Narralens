# next-wiring rev8：NW7-A01 定点文档复验

**DOCUMENT_FIXES_CLOSED**。NW7-A01在文档方向上闭合；未发现本次新方案仍有需要REQUEST_CHANGES的合同矛盾。仅关闭准备性文档发现，不给implementation-ready、N1N2/060实现通过、业务PASS或人工验收。

04:65、72及rev8末节已删除“完整release后复核”分支，选定一条有明确资源归属的终端协议：prepareFinish/prepareTerminal排空真实raw read、媒体close和异步辅助任务，保留真实S01 guard租约及全部最终依赖、FD、预算和DB；READY不能只保留valid标记。finishAndDeliver在这些依赖仍held时做新鲜guard，检查同步终端释放的每个结果，再于同一无await调用栈调用已注册Host sink。没有用已释放租约补签最后检查。

OwnedReviewDelivery携带私有ready/authority跨dispatcher await到实际agent-http-router send边界，先做原output validator再终端交付；窄路径已列入04，不改公共DTO。普通created describe不能静默走无guard原send。stream chunk仍在held阶段逐read/backpressure检查，最后response.end走终端协议。JSON/结构化caller、外部sink或ready shape都不能铸造能力。

## 反例复核

|具体反例|rev8的明确处理|
|---|---|
|零变化describe，媒体close完成后再最终交付|最终S01依赖仍实际held，不会因先release导致正常请求自我失效；正常成功对照列入PUB-RD01。|
|候选值或READY跨dispatcher await期间撤session/换包/改marker/S01失效|业务方法return不是交付；私有能力直达真实router最终send，届时在held状态复核。|
|prepare中的read/close失败，或最后同步释放失败|前者不签READY，后者不调用sink；保留原始与cleanup原因，清理未证保留owner/DB依赖。|
|取消、重复prepare/finish/abort、sink抛错|终端状态与一次settlement负责；取消后不交付，重复不重复close/write，sink失败不重试或复活。|
|真实依赖只能异步释放|明确不能假造READY或默认generic release同步；最终release前必须提供精确专用两阶段hook并独立复审。此处是发版前实证前提，不是声称现有实现已有能力。|
|外部进程在最后guard与socket写入之间改DB/文件|文档明确不承诺跨进程原子撤权或撤回在途字节；不把这一边界当作本协议已提供的保证。|

PUB-RD01/NW-API03/S01-L01/L02已要求真实held依赖、零变化成功、每步故障/取消/重复及实际最终router响应证据。06同步引用该协议，没有保留旧的失效lease复用分支。以上均为静态规格核对，运行仍NOT_RUN。

## 输入与不变量

八份Markdown均匹配manifest revision8原始字节SHA256；归档rev7八份Markdown匹配原独立INPUTS；12份引用权威摘要未变；07七份历史源码只经git show固定完整SHA `1d348d419120f23f45d958112ea8c43df5a04675`核验摘要/大小，未读dirty源码充当冻结。全部40份实际输入在结束前重读复核未变，账本见INPUTS.json。

原S01 28条整行内容与已审rev7相同。SQL与canonical detail原始字节未变，SHA256仍分别为：

- DDL：`be75d5683a25861ab2cbe14d0a12c4bbde050a342288e2f254f577a2a6623e56`
- detail：`b021a477274708f2695cd4676d1c806ddef0d5f2d25be6c5c8e9142bc01e4dce`

accepted_native_commit仍null、implementation_release=false、business_acceptance=NOT_RUN；双marker/完整namespace/原像拒绝与回退限制未改，03的00–07必读修正保留。

## 仍须完成的release前置

N1N2实际接受后，逐个把S01MediaGuardLease的真实依赖、FD/预算、prepareTerminal与同步终端动作重锚到接受提交。必须证明没有隐藏Promise、异步close或外部callback，正常请求确实可成功；async-only依赖必须新增最小受审hook，不能靠所有正常请求失败来“满足安全”。这项证据未具备前不得发实现release。

最终还需冻结私有接口/owner、agent-http-router等完整窄路径、受信sink和output验证顺序，以及精确ReleaseAssignment的argv/cwd、资源、capture、错误码、支持回退。060真实生命周期语义、原28项与HC/A/H/J/PUB运行、真实Studio/中文影片/导出/人工门均未由本报告替代。

本次没有运行业务代码、SQLite/迁移、Node导入、测试/构建、Host/HTTP/浏览器、media/probe、进程恢复或人工体验，全部NOT_RUN；未修改输入、旧报告、源码、测试、Git或运行根。FINDINGS.json记录文档关闭及后续前提，不包含新的BLOCKER/MAJOR/MINOR。
