# 060P1 独立静态代码复核

**REQUEST_CHANGES**。发现1项BLOCKER、9项MAJOR、1项MINOR及2项NOTE。绑定MAIN `INPUT_SNAPSHOT.json`的20份P1实际未提交字节，全部摘要/大小匹配；`1d348d419120f23f45d958112ea8c43df5a04675`只是历史base，不是P1已接受提交。未运行任何测试、业务模块、Host、Chrome、媒体、进程探针或故障实验，也未修改W。

## 首要阻断

P1-F01：supervisor:245–256与worker:91–102都在最后右括号后对fields[0]调用Number作为PID。这个字段是Linux进程状态S/R/Z，必得NaN，两处identity都返回null。真实worker在HELLO前就失败；组枚举也把所有真实成员漏成空。普通draw、连续两帧与poster没有成功路径。现存P2测试identity断言可以检出，但P1没有运行它；本结论来自标准字段位置和逐行逻辑，未捏造执行失败。

## 其余代码发现

|ID/级别|精确反例与最小修复方向|
|---|---|
|F02 MAJOR|supervisor:236/269把不可读proc归空，871–896还允许child.close截止未完成后以组空settle。区分确定消失与UNKNOWN，所有结算必须真实child close+确定组空+记录身份消失；未知不能释放PRE。当前parser缺陷立即扩大此问题。|
|F03 MAJOR|206/409的WeakMap是全模块共享，other supervisor认得foreign handle；457–475没有held状态门，仅组空就settle，跳过记录身份和close，可与run竞争。绑定issuer并对真实held状态使用同一个完整fresh证明/父drain责任。它是Host-private生命周期接口缺陷，不是公共HTTP可铸造权限。|
|F04 MAJOR|工厂433–441只保留draw promise，内部reserve handle和supervisor无真实owner账本可供reconcile；scope:324对cleanup_required永久拒绝release，生产无清除方法。#fail在hold前不锁存原primary，reconcile还可能丢失败或把被拒candidate变成功。须由真实生产owner保存同一handle/scope/父drain责任，完整证明后解除同一barrier并一次释放，原失败不可改写。|
|F05 MAJOR|supervisor:704–721没对比child.pid且先赋leader；942–953在leader已非ours但组非空时仍TERM。错误HELLO/leader提前死亡可误信号peer或旧数字组。验证spawn身份后才采纳，TERM/KILL都需完整owned锚，未知保全。当前由F01遮住，修parser后属于必须修的潜在故障路径。|
|F06 MAJOR|780的JPEG await和813的closed消息await没参加deadline；worker:409 closePageFrames卡住会让finalizeMs永远未启动。完整候选接收和finalize各阻塞阶段需deadline/取消驱动真实清理，不能只resolve一个无人等待的timer。|
|F07 MAJOR|635先无限Buffer.concat，长度只在有waiter时核验；worker同样。stdout/stderr洪水只设flag，794只在完整candidate后检查一次。需要增量总buffer/协议阶段预算及全生命周期超限清理；不是截尾诊断后继续等待或成功。|
|F08 MAJOR|factory:429 await scope之后445才登记calls；close:456可能先返回，稍后排队获准再spawn，且无第二次draining检查。应同步登记包括排队的完整受理责任，close取消未GO reservation并等待；workspace准入也应传其已有abort。该顺序缺陷不依赖worker运行，F01不能掩盖。|
|F09 MAJOR|669只记exit字符串，807仍无视FINALIZE前已观察异常exit；813–828把异常closed/fatal只记cleanup，域消失仍成功。必须按ADR A04单调真值表锁存原失败，候选+组空不能补签成功。|
|F10 MAJOR|folder:782–785将source error当close完成，798吞destroy异常，drain随后只见空集合。error本身不独立证明FD close；即使常规fs某错误路径已关FD，原error/close不确定原因仍被丢。分开原error与真实close，保留ledger/cleanup原因，未证不释放scope/PRE。|
|F11 MINOR|settlement test:62–66假定process.pid就是PGID；vitest继承组时不成立。枚举实际identity.pgid，detached组另用真正detached worker断言。|

worker:389只传原错误name/message，supervisor:775–777又只取message造通用PRODUCER_FAILED；F04同时要求保留有界原错误事实/cause，不能假称跨进程同一JS对象仍被保存。每项的具体触发、路径、合同、影响、最小修复及有意义的后续用例在FINDINGS.json。F02–F10中部分正常/故障分支被F01遮住；明确列为修parser后的静态可达路径，没有声称当前真实实验已经触发。尤其HELLO/foreign-handle故障来自私有worker/supervisor边界，不误报为公开HTTP攻击能力。

## 接线中成立的部分及局限

workspace:675在PRE前取得共享scope，整个#produceWithinScope包含preexisting输出检查、真实bridge await、POST、两tree release和最终witness激活，外层finally才release。reader:578与681确实在对应root做准入/交付忙态拒绝，没有把同root生产直接塞进generic lease的assertCurrent造成自锁。调度2活跃/32全局/8同根/30秒以及dev/ino别名索引已写，direct factory与workspace共用同模块/ALS。worker policy只在worker内安装，复用原media policy，拒绝fork/exec/execSync、封出生，未patch共享Host。

这些静态结构不能抵消上述结算问题。现有B0-2断言只关闭没有工作的一方再等peer图片，并不证明A与B两个真实worker并存且清理A时B成功。P2 settlement文件完整阅读后可见：只拒绝{}、null、数字lookalike，没有other supervisor真实handle、真正held reconcile、全异常窗口断言；这不是用未跑本身造缺陷，而是对应代码问题的后续用例应补齐。

## Q1/Q2与真实证据

Q1：当前没有subreaper/已审强回收方案，不能静态保证TERM-ignore→KILL后所有Z已回收；worker自身会被组KILL，单在worker内做subreaper也不能自动证明worker死后的reap完成。普通超时主动回收目标不能退化为永久CLEANUP_REQUIRED并自称完成。具名方案应由MAIN按真实故障与资源归属另审，不在本报告授权新helper/native依赖。

Q2：固定V host.mjs实际hash匹配清单，frameDuration:162–164在execFile回调error时done(null)。所给本机Node源码同时存在close→exithandler、error→errorhandler→exithandler以及kill throw→exithandler。报告“忽略TERM且只关闭stdio就使child仍活时发生close”的论证没有由此成立；应纠正。正常exit/close与error/kill失败提前回调分别需要真实child证据，不把错误假设当作改公开路由/owned probe seam已必要或已获授权。不得口头把所有callback等同reap，也不得反向捏造close-with-live-child实验。

## 捕获与原要求

七条初始捕获的实际log摘要、exit文件与result一致：generate/typecheck/两syntax/integrity/scheduler/m2.1均exit0；scheduler日志10/10，m2.1日志60/60。capture.inputs中的已覆盖P1快照源码摘要匹配，generate唯一许可变更是integrity manifest；其余source_changed=[]。这些是既有捕获事实，本审查没有重跑，60/60只针对旧lock静态门，不覆盖新spawn或结算。工具默认check、generate固定单路径及manifest不自引用的代码方向成立。

报告§3/§7承认两次开发期失败没有原命令/exit/log/input留存；现存七条成功捕获无法恢复它们。记录UNRECORDED/UNKNOWN，不制造旧失败日志，后续反事实只能算新捕获。

原17条及ISO-01..18的逐项静态映射写在FINDINGS.json；原要求未减，历史“十文件/84”不能限制后续已授权范围，也不能当当前验收。生产链/独立树/authority/完整依赖/探针/字节顺序/FD生命周期/legacy Expected等未受本轮完整重验的要求保持P1_SCOPE_LIMITED_NOT_REACCEPTED；NEXT仍pending-after-N1N2-acceptance。本次没有自签P2、N1N2、NativeAck、Studio、A片或V1通过。

全部输入摘要见INPUTS.json，末尾重验未变。结论需要Claude按新精确release修复后再冻结静态复核及授权P2真实门；没有源码修改或运行授权由本报告产生。
