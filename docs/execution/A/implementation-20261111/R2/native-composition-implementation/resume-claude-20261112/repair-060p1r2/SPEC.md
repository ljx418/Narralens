# 060P1R2：合并修复与轻量自验证，非P2

你是原Claude唯一源码实施者。P1R任务已正常交还；两位独立Codex均REQUEST_CHANGES。MAIN未接手实现。现在批准本票修复及JSON十一条轻量命令，不批准真实custodian/子进程故障/Chrome/Host/ffmpeg/probe实验。普通缺陷自行闭环，不再让用户选择逐条工程修法；任何新429立即停工并报告，不自动重试/重启/换provider或Codex代实现。

W=/mnt/c/workspace/videoworkline/Narralens-agents/main-integration
C=/mnt/c/workspace/videoworkline/Narralens/docs/execution/A/implementation-20261111/R2/native-composition-implementation/resume-claude-20261112
R=C/repair-060p1r-review；当前票C/repair-060p1r2/RELEASE.json。

## 权威、基线与写入

完整读RELEASE.json及R下两份独立custodian-review与integration-review的REVIEW.md/FINDINGS.json；读C/repair-060p1-review/ADR_060_REV3_CUSTODIAN_AND_REPAIR.md、060P1R_PRIVATE_CONTRACT.md及binding/批准记录。旧rev3合同不降格，不因修复困难另造简化架构。HEAD仍1d348d419120f23f45d958112ea8c43df5a04675，只是历史base；dirty P1R字节以本票21份start_sha256为起点，不reset/stash。适用AGENTS仍受保护。原17与ISO01..18全部保留。历史报告/快照/失败和新两次UNRECORDED承认不覆盖。

只有JSON 21个现有路径和1个新增纯Python单元文件可写；OWN docs/parallel/lane-product/A-R2-20261112/N1N2-native-source下仅新增n1n2-claude-060p1r2-*报告/映射。recorder只新增同prefix证据。实际业务var不准新建实验。不得新增其它协议模块/测试/config/包脚本/依赖/路由/公共DTO/EnginePort方法；确有缺口先具名向MAIN ask。不得git add/commit/reset/stash/checkout/push/merge。V及Approved015和formal render/source/revision/许可等原保护不变。不得全局patch Host行为。

## 合并实施包：修完整责任链，不能只修静态表达式

A. C01/C02：正常启动与exec。选定Host spawn C时detached:true，使C独立session/pgrp，并按实际child.pid/ppid/SID/PGID/startticks验证（Python不再重复setsid失败）。prctl GET参数正确指针及c_int存储；初始化seq。C fork后立即关exec_write与自己的draw fd3副本；N保留唯一CLOEXEC exec_write至exec，setup/exec失败写真实errno再exit，成功仅由CLOEXEC EOF表示。exec-status使用同一非阻塞selector与总READY截止，不能同步read阻塞C取消/回收。记录真实fork authority在N HELLO前，启动失败也有明确责任。不要弱化身份握手。

B. C03/C04/C05/C06、IR03：唯一wait owner与完整证明。C自身身份单列，不能纳入C正在证明的target-gone集合；身份表跟踪N和真实目标/被收养后代，不只在reap后想象。未知proc/read/kill errno不转gone/空组。组信号仅在N session/group建立且实际保留N父wait锚、核对完整epoch后发送；setsid前失败只处置精确未reap直属子N，不朝其继承的C/Host/peer组发信号。TERM/KILL由所有目标活动决定，N已退出而孙进程忽略TERM仍升级；N用WNOWAIT保锚，循环收集/等待收养后代，全部其他资源结束再最后reap N，证ECHILD/ESRCH/全身份gone。不能C发KILL清自己来换childClosed与空组、不能正常TERM-ignore永久held。

Host run及reconcile共用严格execution-proof：绑定协议/draw/ticket/C/N/seq/event链摘要、完整目标身份与wait记录、outcome/ECHILD/group/diagnostics、实际C退出码及exit/close/reap和新鲜核验。缺receipt/unknown/错误epoch/截断/重排/C意外死亡均不放行；N未HELLO不等于没fork。保留活着的责任owner处理未知，不以动作超时当已结束。事件分段/最终摘要必须与验证端同步真实实现，不写空字段假完整。

C. C07/C08、IR08：有界控制面与deadline。同时约束decoder partial buffer和decoded queue总字节/帧数；按阶段消费，合法metadata+最大JPEG coalesce保持有效。总READY30s从两级启动同一起点而非每步重置。GO外60s含JPEG，候选后finalize3s从候选开始，TERM3/KILL15为动作截止非完成证明；原FRAME15/JOB45/CAPTURE30不放宽。所有阶段stdout/stderr/frame洪水即锁存失败并触发回收，不只候选后检查一次。C每轮读有界不饿死selector/timer，信号/事件表有界且不丢wait authority。非阻塞写按offset保存短写尾/真实剩余字节，订阅writable；预留独立terminal帧槽及16KiB，最终receipt未flush不能默默成功退出。Host EOF仍先回收，断开的传输不成功。draw EOF当场通知C取消，不能等最终deadline。

D. C09、IR04：候选不是成功。candidate后、最终交付前任何fatal/取消/协议/close异常仍可锁存原primary；已存在真实failure不得被后来的candidate/cleanup覆盖。#holdForCleanup不得for-of遍历同一个同时push的数组；复制/有界去重并保存原错误对象。cleanup unknown必须及时形成可检视责任，不能同步死循环耗尽Host内存。

E. IR01/02/05/06/07/11：真实whole-production所有权和结束凭证。本票不允许裸布尔receipt。scope的completion只能由实际阶段代码在真实await结束后产生的私有phase receipt构成，带scope/issuer/reservation/root/generation/原outcome；公共export函数不可接受caller手工{settled:true}即可mint。独立WeakSet/WeakMap标识真实凭证，消费一次后置spent；反向wrong issuer/root/generation/未结束阶段/重复consume均拒。跨模块需传私有opaque owner/phase capability，能力在真正结束者内部发出，不是调用者自称结束。

workspace取scope后要把实际同scope/owner身份贯穿factory/supervisor；任何PRE/POST/tree close或guard失败且资源未证实结束，都保持全root barrier，不因mint=null/consume=false仍finally release。已经确定完成清理的原业务失败可以按失败凭证结束；不能用原业务失败等同未知资源。supervisor reconcile仅释放execution gate供原bridge continuation继续，父资源与tree结束后workspace才mint+consume whole completion，再原outer finally无await同步release一次；不要执行promise与wholeProduction相互等待。

责任按精确opaque draw identity映射，不按producer+root最后一条；同root A held、B已登记排队必须能找回A，parent drain事实不得给B。settled移除JPEG与大对象，只留有界摘要；held真实owner不得丢。direct bridge也持有execution+parent阶段完整scope，不得producer先release、bridge后drain；producer.close需等待其接受的全部production含parent。workspace scheduler传既有abort signal及时取消队列，获准后仍重验防late GO。现有source error≠close与destroy异常保留不退化。

F. C10：每draw owned HOME/XDG/profile/temp namespace，在launch前建立登记，子环境只白名单且指向私有目录，不读用户配置/全env/secret，不更改Host全局HOME。真实完整资源结束后才删自己的run dir；UNKNOWN保留及可检视。固定浏览器二进制如需既有已批准路径只按原固定配置显式传，不读环境发现用户安装。解释器、Node、worker/policy/py原字节完整性仍严格校验。

G. C11、IR09/10：重做有意义而安全的pilot，不在本票跑。故障helper先正确绑定GO ticket摘要；mode在HELLO前确定、foreign HELLO真的foreign；half-JPEG发送真实不完整帧非一张较小完整图。正常helper必须真实成功而非any reject；零媒体/零浏览器，不调用隐含ffmpeg fixture。ignoreTERM要真实N及孙进程、延迟收养/leader先退出，各模式可观测已触达再故障。保活用ref真实timer/handle，不能unref+未决TLA假装还活。所有创建child立即登记owner、所有expect/timeout/错误在finally精确身份处置并真正close/reap；UNKNOWN保留目录，不afterEach无脑rm。不能用Host组计数替代目标组和Z/receipt。后续Q2要求真实事件顺序/完整正常对照，默认不改upstream probe。

identity轻量门绝不再真的spawn：IR10已证原门调用/nonexistent custodian，因此历史报告“零真实进程”不实。新报告承认“启动过失败路径解释器，未运行目标custodian/prctl且PID/close未记录”，不补造。纯测试改为在会spawn的入口之前验证，或测试局部vi.mock spawn并断言精确零实际调用；不能生产加入跳过证明开关。所有真实C/exec-status/probe tests留P2a授权后运行。

## 新增纯单元门：先把普通实现错误在轻量门打掉

新增tests/agent-driven/integration/helpers/cache-custodian-unit.py，/usr/bin/python3.12 -I -S -B执行。仅标准库unittest/mock+显式绝对path import现有custodian（__main__不执行，导入无副作用）；若模块顶层有真正fork/signal/prctl改为run入口，不能单测真执行。mock内核/stdio/clock/selector边界，无实际fork/setsid/wait/signal/prctl/外部进程、无用户env/配置读取。可创建并关闭测试自有内存对象/selector本地FD，但不连接Host/网络。

测试至少分别打到：seq初始化和HELLO组门；ctypes GET参数通过其真实声明形态的转换校验（不调内核）；exec pipe所有端所有权/CLOEXEC/短读EAGAIN错误分类；短写尾与terminal reserve；自身份剔除且目标保留；N退出但孙活仍KILL与N-last wait顺序（mock序列而非只查字符串）；unknown不转gone；receipt digest/seq/outcome拒；候选后失败与cleanup数组不扩张；队列总量/阶段deadline。Python只测其职责，TS issuer/parent/receipt另在既有纯test文件用实际逻辑+局部mock断言。每项明确在旧P1R上如何失败，不要求当前回退源码跑变异（本票不准）。不要靠新增源码正则assert来替代状态/行为验证，不复制第二份实现当测试oracle。

全部新缺陷一一映射到生产行号、实际行为测试与未来P2边界。同一原因可一个修复覆盖多finding，但P1R-C01..11和IR01..11不得漏；只做注释/文案不算关闭。

## 严格执行、首次记录及交付

十一条精确命令见JSON，全部串行、默认并发/timeout不改。从第一次开发试跑就用原run-recorded.py NAME argv，prefix n1n2-claude-060p1r2-*，所有失败保留（无失败次数/AI预算上限）；不在recorder前先跑确认，不能只记录最终重复成功。生成manifest是独立许可源生成动作，使用recorder记录真实source_changed只允许integrity JSON；不能提前偷偷生成然后捕获无变化重复。运行期间冻结源码，不并行修代码/测试。前置语法/纯单元失败自行在范围内修并新name重跑；出现实际child/未知越权过程先保全报告，不自行扩大成P2。

本票禁止业务runtime、真实C/prctl/fork/setsid/wait/signal/故障child、HTTP/Host/Chrome/ffmpeg/ffprobe、fullcheck/build、联网/安装/付费/J盘、配置凭据/.env读取、headed。允许仅精确command中标准node/vitest/Python runner本身；identity不得暗带下级child。保持现有旧reader/cache P0历史结果，不重复其重型整文件。

报告OWN/n1n2-claude-060p1r2-report.md，包含两审22编号逐项修法/行号/测试/NOT_RUN；所有原始capture及失败/首次generation；真实私有owner/FD表与阶段状态流；剩余风险；建议下一安全P2a逐命令/fixture/先登记owner/失败finally与残留证明（不执行）。另新增同prefix evidence-gap说明P1旧2次+P1R新2次UNRECORDED，找不到原命令时间日志不得编造；更正IR10历史零spawn与idempotent generation说法，不覆盖原报告。

完成交还writer/资源worker_done，不自签外审/接受冻结，不进入下一接线/S01/NativeAck/Studio/A/V1。MAIN复核新字节并必要独立静态复验；安全前置通过后MAIN另发P2a真实无浏览器pilot，再P2b受影响/全量/冻结外审。当前没有开工额外预算，也不能直接拿旧pilot清单运行。
