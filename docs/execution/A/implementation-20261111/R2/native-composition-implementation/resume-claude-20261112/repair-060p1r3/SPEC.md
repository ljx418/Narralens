# MAIN 060P1R3 — 定点生命周期修复，十一轻量门

你是原Claude唯一实施者。060P1R2正常交付但两份独立复验仍REQUEST_CHANGES；既有启动/exec管道/privateenv/部分scope改动保留，不重写已通过模块。MAIN负责方案与验收，不接手源码。当前批准本票源码修复及原十一轻量命令，不准真实C/内核/故障child/Host/HTTP/媒体/Chrome/完整门；新429立即停，不自动重试/重启/换provider或Codex接手。

W=/mnt/c/workspace/videoworkline/Narralens-agents/main-integration
C=/mnt/c/workspace/videoworkline/Narralens/docs/execution/A/implementation-20261111/R2/native-composition-implementation/resume-claude-20261112
先完整读本RELEASE.json/SPEC、C/repair-060p1r2/independent-review/custodian-review与integration-review的REVIEW.md和FINDINGS.json，原C/repair-060p1-review/ADR_060_REV3_CUSTODIAN_AND_REPAIR.md及060P1R_PRIVATE_CONTRACT.md、C/repair-060p1r2/SPEC.md。本票补充具体修法，不降低原17/ISO01..18或预算。原HEAD仅历史base1d348d4，当前22文件以本JSON rawsha为起点，不reset/stash；AGENTS保护/index空，所有旧报告/失败/UNRECORDED不覆盖。

## 一次合并修复九组，逐编号均需映射

### 1. R2-C04/N02、R2-I06：UNKNOWN必须持有活的wait owner和N锚

真实Custodian→KernelSettlementOperations路径的group_members/direct_children/identity/wait读错必须显式UNKNOWN传入状态机，不得None→[]、Z跳过后推无资源；Z也是尚需reap的资源。KILL动作截止或枚举/wait异常时，不得最后reap N或退出C，更不能Host超时KILL唯一C。所有post-fork异常包括set_blocking/selector注册都进入原责任清理分支，不绕main return2丢owner。

采用明确状态RUNNING→SETTLING→RECOVERY_HELD→SETTLING→RECEIPT_FLUSH→EXIT；UNKNOWN保留原fork事实、活C、未reap N锚、控制通道与可检视原failure。动作有界，但证明不充分只进入持责恢复，不叫已结束。C保持可处理取消/恢复/EOF与有界重查，不busyloop；Host-only原issued handle reconcile能唤醒/请求该真实C重查，而不是只能等C已close后检查尸体。Host/run责任handoff与原continuation保持，不能promise自等。恢复后完成原失败，不变成成功。

正常TERM-ignore仍须实际完成KILL+收养wait+Nlast，不能用永久held替代；未知异常恢复另行证明。Host不以ChildProcess close未到证明PID未reap；已观察exit/reaped的C绝不再按旧pid发信号。不得对外部数值PID/组盲杀。ECHILD检查不得在N仍需保锚时waitpid(-1)把N提前reap。后代未全终结/收养wait不充分时禁止Nlast。必须修真实adapter，不只FakeOperations。

### 2. R2-C06：execution-ended与result-success分开

C内部真实stdout/stderr/事件/身份预算违规须锁存有界原failure，即使之后raw domain全reap也不能候选成功。receipt包含完整C/N父身份epoch、exec状态、锚/wait序列、目标枚举与最终gone、诊断丢失/各bytecount/原failure；Host共用验证同时检查结构、真实绑定和语义，不能只自洽event digest。要求Nlast前全部其它已知wait终端、fork/preexec事实一致，不能空wait数组或错SID/PGID也放行。

保留资源已结束与创作失败两个独立事实：清理证明可以成立而业务失败仍拒绝，不能因此永久held。C的协议/清理结束正常exit与业务原failure分列；真正基础设施/传输缺证exit非正常不得签成功。所有成功资格必须检查诊断完整/预算/原failure，不靠回收成功洗白。

### 3. R2-C08：完整分段receipt和真正flush状态

两端同步实现有界sequenced segments：每段严格<16KiB，明确定义draw/C/N/段序/count/hash，最终小summary只含总量/摘要/状态与必要绑定。Host按序收、增量摘要、严格聚合上限/身份512/去重；丢失/乱序/多余/truncated failclosed，不能整份events/waits/identities硬塞最后16KiB。复用现有文件不引入第二份协议模块。

C本地rawreap后进入RECEIPT_FLUSH，EAGAIN/短写等未来writable再继续，并在真实有界deadline内flush；不能立即两次flush后exit4。保留独立terminal帧槽/16KiB预留，receipt写不会阻断之前kill/wait。Host断开则本地先清理、传输非成功再exit；资源全reap后可结束，不因无法通信永久孤C。必须覆盖run/selector真实调用，不只ControlWriter类。

### 4. R2-C09/N01/N03、R2-I05：真实事件入口+总finalize截止

spawn返回后立即装ChildProcess error与两个私有socket error监听，记录异步ENOENT/EAGAIN/EPIPE/ECONNRESET；区分从未出生与born/unknown，error不当exit/close。原error对象有界包络保留，走统一持责清理，不触发未处理EventEmitter error崩Host。

候选后的draw消息继续与C控制收据并发处理：closed:false/fatal/protocol/budget/取消都调用原锁存，不能排在drawQueue无人消费；worker closePageFrames失败应带有界error envelope而非只false丢错误。FINALIZE前draw EOF须锁存具体失败且零witness，FINALIZE后正常EOF对照允许。不能等待永不结束wrapper才启用ownedtermination，仍有原3s候选起截止。

同一个candidate时间deadline传到receipt到达、C真实exit/close与最终fresh proof，不能receipt2.9s后再独立等15s当成功。过3s锁存失败，owned cleanup在TERM/KILL动作截止内继续；迟到真实close可完成失败清理，不能迟到成功。所有post-candidate错误先于交付的优先级用真实orchestration分支验证，不仅latch helper。

### 5. R2-I01：区分NOT_OWNED普通拒绝与真实UNKNOWN，保原promise

workspace在PRE前失败（preexisting output、排队后stale、无资源准入拒绝）没有取得parent/tree资源，须由真正取得者的私有phase capability记录NOT_STARTED/NOT_OWNED事实，原业务失败清理完释放scope，下次可准入；不能伪造settled:true，也不能三个lease空挂永久held。

一旦真实取得资源，tree/parent close未知必须保原closure、原资源对象、真实wholeProduction promise与scope到fresh reconcile，不能先reject原operation再让dispose删根；close/dispose等该责任，inspect/reconcile能触达真实tree/parent未结束者（不只是supervisor browser）。已结束但返回原错误的分支与资源仍UNKNOWN分开，结束后仍返回原error，不新成功。完成所有实际阶段后私有completion消费一次且原finally同步release一次。hold不是只有scheduler计数；不能用过期ref恢复创作权。

### 6. R2-I02/I03/I07：精确责任可恢复、拒绝历史有界、终端目录回收

bridge保存所有未结draw的issued opaquehandle→责任映射，inspect能列出真实held/active、按稳定原handle reconcile；A held时同bridge B排队不得遮住A。保每draw局部current供continuation，crossbridge/foreign/stale授权严格拒。历史settled bounded，但真实held不可被剪。

factory准入拒绝/timeout/cancel在无未知资源并完整清理后也明确terminal+prune；不是只resolve promise而phase仍queued。call计数仅对真正计入的调用减，不能负数。保留最多8份settled有界摘要，拒绝压力不无限留controllers/root/JPEG。

held后真实reconcile结束，同owner更新cleanupRequired终端状态，并在所有相应资源结束后一次清私有run目录。rm失败保原cleanup对象/可检视，不静默成功，不把已结束永久当UNKNOWN。run finally已结束时也要有继续这一步的真实owner，不能依赖未来第二次finally。

### 7. R2-C11、R2-I04、R2-N04：安全pilot是首门，不是先跑再补清理

重做现有lifecycle首个最小case：reserve/start立即登记真实handle+owner/C/N身份/close promise，所有await/expect在try/finally；启动时不加入removable，只有真实全部proof后才标可删。UNKNOWN加入kept并保场景/事件/root及活owner，上报而非5s race正常return。故意中途assert失败/kill异常/延迟close必须不会删活根。probe reapHelper也必须等真实close/reap；deadline只触发unknown保全而非清理成功。禁止以testframework timeout自动跳finally后rm，或只杀C来当无遗留。

firstpilot分①Cidentity（不发AUTHORIZE_FORK）②最小N正向synthetic protocol往返；不要整文件混故障/Chrome。首case本身失败也须安全。现有helper场景/事件改为每次独占runtime根（测试复制已受审helper原字节及其scenario/events并记录sha/path；一次单slot），禁止共享tests源码旁events或两个pilot互踩。复制只测试fixture、校验固定hash，不绕生产固定worker pin。准备用var下唯一pilot目录，具体runtime动作以后票据准许，现在只实现不运行。

leader-first孙进程stdio采用不会因父读端关闭EPIPE自行退出的owned sink/ignore；显式记录同epoch PPID=C、TERM后仍活/已触达才KILL，错误提前exit必须打红adoptioncase。正常1024x0x4a仅synthetic protocol，不能称真实JPEG/媒体解码；真正浏览器/帧在P2b。保上游Q2 probe不改，真实事件后才决定窄owner。

### 8. 真实分支轻量验证（既有文件内扩充）

继续十一条JSON命令，不增真实child。Python cache-custodian-unit.py 用stdlib mock实际Custodian._settle_domain→KernelSettlementOperations→proc/wait/selector层，至少持久unknown、N为Z/子枚举EIO、KILL后未terminal、fork后selector失败、收养稍后到达：禁止Nreap/Cexit，恢复后孙先N后；run/selector EAGAIN至后续writable→flush，最大receipt分段，断开先reap后非成功。不要只给FakeOperations自行live=[]。

TS既有identity/scope纯门用局部mock实际supervisor pump/消息监听与workspace/bridge真实阶段调用，覆盖nexttick ChildProcess error、socketerror、candidate+closedfalse/fatal、pre/postFINALIZE EOF、receipt2.9close4过期、错误diagnostic/wait/epoch/exec receipt、同bridgeAheld/Bqueued、无资源拒绝下次准入、unknowntree原promise/dispose仍pending、反复queue拒绝bounded/计数、reconcile目录一次清。测试若暂时无法直接触达真实owner需最小Host-private test接缝，不能公共绕过proof，也不修改vitest/config/新增文件；确需新路径先ask具名申请。

每项证明当前旧P1R2会在哪个断言失败，未来kernel证据保持NOT_RUN。类存在/字符串正则不是行为证据；mock不能证明内核实际reap，报告明确区分。

### 9. 运行、原始证据与交还

只准JSON22既有路径，无新增源文件，OWN只新增n1n2-claude-060p1r3-*报告/映射。首次试跑之前就原recorder，prefix n1n2-claude-060p1r3-*；包括语法和每次失败，不再先跑node--check确认。十一命令串行、default并发/预算/timeout不改；generation独立recorder只改integrityJSON，原source在runtime冻结。无失败次数/AI预算上限，范围内自行修，不挑绿不覆盖。

无git变更操作、无网络/下载/付费/J盘/用户窗口、无用户env/.env/凭据配置读改、无实际C/prctl/fork/wait/signal/故障child/Host/HTTP/媒体/Chrome/全量/build。Node/vitest/Python runner仅执行许可纯单元，真实子进程mock，源文件导入不准偷偷执行run。固定V/正式render/Approved015/EnginePort/事务/公开合同不改。旧所有失败及四次UNRECORDED和上轮未记录node--check仍保留，声称exit0仅作者承认不是独立日志。

交付OWN/n1n2-claude-060p1r3-report.md和实际ACK：逐R2-C04/C06/C08/C09/C11、N01..N04、I01..I07（有重叠合并但每ID映射），精确生产行号/实际分支测试/capture/NOT_RUN；资源状态机、Host-C-N FD/receipt分段schema与大小上限、UNKNOWN控制/恢复入口/原promise责任表；原始失败/最后十一门、唯一generation、源码sha/剩余风险；下一最小Cidentity→normalpilot精确单case.argv/cwd/root/先登记owner/故意断言失败cleanup方案。不要运行提议pilot。

完成worker_done交还writer/资源；MAIN定点复核真实安全门，再发最小P2a。不得自签外审/ISO/A04/N1N2/NativeAck/Studio/A/V1。不要只是逐条改注释声称全闭环。
