# R5B：失败启动的真实终局与最小N工具持责（源码与纯门）

原Claude唯一实施，新429立即停、不重试/换provider/Codex接手。读本RELEASE、R5A MAIN_REVIEW/REVIEW.json及REMAINING_EXECUTION_PLAN.md；原R3-C04/C05、R3-C02/I05 finding见repair-060p1r3a/independent-review两审。R5A两故障仅CLOSED_STATIC，旧C的actualnofork两case为历史，不替代新源。所有R6/R7及原17/ISO18仍需完整实现验收。

W=/mnt/c/workspace/videoworkline/Narralens-agents/main-integration；C=/mnt/c/workspace/videoworkline/Narralens/docs/execution/A/implementation-20261111/R2/native-composition-implementation/resume-claude-20261112。写前核JSON原sha/HEAD/index空/保护7文件。仅6既有源/测试/manifest与2新增工具/纯test路径，OWN新增n1n2-claude-060p5b-report.md明确授权，其他Helper/配置/包脚本/合同/EnginePort/路由/源码不动，确需额外路径先具名askMAIN。

## A. R3-C04：资源已结束不要求创作exec成功

修actual supervisor failed-start路径，不是只改exportedvalidator。区分：
- spawn同步抛错或异步error无PID+真实close（可无exit）：真实no-birth，保原EAGAIN/ENOENT，完成失败settlement，不永held；不能error本身当close。custodianBorn实际参与proof，未出生绝无child epoch或N授权。
- C已出生但未AUTHORIZE：必须真exit/close+fresh原C epochgone；没有N不虚构worker/receipt，不变成功。C被外部signal异常仍明确失败，不凭noHello假定无fork。
- 已AUTHORIZE/已fork但exec失败或N无HELLO：支持原issued handle的reconcile，不worker==null就永拒。完整C绑定、真实fork authority、失败exec/status及N真实终端wait、ECHILD/群与已知epochgone/段摘要均需证明，不能删掉worker证明一律放行。exec.ok=false可证明“失败cleanup已结束”，**永不可创作成功**；成功eligibility仍要求exec.ok=true、有效N完整epoch与原全部条件。
- AUTHORIZE已发但FORKED/receipt缺失或矛盾仍UNKNOWN且保活C/原promise，不据worker==null当结束。run与reconcile共用proof，失败保持原error，scope只结束execution，不乱清wholeparent。

可在accumulator/state里增加**有界的实际wait facts**以核真实forkPID对应terminalwait，不能只用waits>=1；保持R5A非破坏snapshot。这里至少证明失败启动的特定N wait、父authority及status，完整任意多后代语义/overflow仍R6，不提前宣称全部C06关闭。协议若需增量字段在C与Host同步明确shape/错误码，不另加第二套事务或弱化旧成功proof。

## B. R3-C05：初始读不到N identity也必须持责并能升级

目标存在事实从记录的fork worker_pid开始，不以worker_identity是否已有来决定census是否看N。UNKNOWN显式传，Z仍待reap。C的exact unreaped直属child是bootstrap authority；只有核实N独立SID/PGID和完整epoch/锚后才能group signal。未建组时只能合法exact unreaped child PID，不能朝继承C/Host组kill，失去wait authority绝不猜数值PID。

未知→恢复后仍活TERM-ignore时继续原monotonic termination action state：已发TERM则保TERM截止，尚欠KILL必须在同一owned lifetime升级，不能每次resignal=false假定KILL已做；已做KILL不乱重复/重置权限，fresh后收养先N最后。动作deadline只是UNKNOWN/恢复，不能有限弃责。actual KernelSettlementOperations测试worker_identity=None/forkPID存在→暂不可读→恢复为liveTERMignore，核C/N锚、信号/组身份与wait顺序，不只FakeOperations自给live=[]。

## C. 内部owned控制/诊断面（禁止新公共API）

新增requestCancel(issuedHandle, originalError)：严格本supervisor issuer、同步锁存最早原Error并请求既有C CANCEL；重复调用幂等不覆盖primary、不自己等wholeSettlement防自锁。reserve后未start取消应让start拒绝spawn并完成真正无birth失败；已fork只由存活C清N，不KILL C、不裸kill组。终端不重新变失败。foreign handle在任何副作用前拒绝。

新增diagnosticSnapshot(issuedHandle)：仅Host-private只读/有界JSON副本，供工具保存C/N完整epochs、fork/exec/actualCexit+close、已知targets、receipt_summary+accumulator计数摘要、原outcome和freshcleanup观察；不得返回rawticket/token/socket/process句柄/可变内部authority。不伪称有全rawsegments（R6进一步语义证据要补）。它不是publicDTO/MCP/HTTP/EnginePort方法，七方法不变。

## D. 一个独立最小positive工具，不再靠Vitest失败timeout留owner

新增tools/native-cache-normal-pilot.ts及对应native-cache-normal-pilot.test.ts。standalone计划用corepack pnpm exec tsx tools/native-cache-normal-pilot.ts（本票不运行）。明确入口guard，测试import不autorun，不编译/安装依赖。

两个mode normal / assertion-failure，CLI只收mode+expectedCsha+expectedFixtureSha，不接受任意可执行/PID/argv。固定W及当前custodian/Python和固定已受审helper，检查sha后复制helper到自有var/native-cache-positive-pilot/run-*/，场景/events在副本旁，root创建立即登记，constructor/reserve前异常同样在finally里。helper不改，normal用normal场景，expectedfault用silent场景；silent已有HELLO+GO事件且ref保活，不需要新拍脑袋delay。

register唯一registry项{root,supervisor,reservedHandle,startPromise,originalFailure,state}：每个对象创建即同步纳入，不能try前expect/reserve丢根、不能只root/boolean。reserve/start在私有场景composer，vendorRoot等只是测试固定配置，不冒充真实OpenFilm producer。normal必须真成功、picture==1024个0x4a及精确SHA，而不是length>0；这是synthetic protocol，不是JPEG/视频解码。

故意失败case要**实际观测同一N epoch已HELLO+GO、真实live**才注入EXPECTED_ASSERTION_FAILURE，调用requestCancel同issued handle和原Error。任何早期异常都原finally请求ownedcancel（已终局不重复），等rawsettlement/完整fresh C+N/groupgone/receipt；failure不能anyreject过门。工具永不调用nofork工具的Ckill能力、不自己kill C/任何组。UNKNOWN保原supervisor/handle/原promise/root和实际C，按本owner inspect/reconcile有界轮询至真实proof，不超时丢owner或顶层throw；迟到结果结束原失败、不自动采纳picture。

复用R4B已审createReportingBoundary的**报告边界**即可（允许从固定本地.mjs类型检查后动态import，禁止ts-ignore/任意路径；不复用noforkcleanup/信号能力），或等价小typed边界，无globalHostpatch。所有postbirth evidence/async日志异常保原责任、资格fail。写root内summary/outcome/原failure/readonly诊断与SHA产物清单，真终局后保留证据，不按计时删根。normal0，故意失败预期1只有精确fault+原cancel错误+完整终局无其它unexpected时才case_passed。主工具自己的reporting failure不得藏在绿候选后。

同existing cache-custodian-lifecycle.test.ts把两旧unsafe入口最小接到受审独立owned runner，不删除原case含义：nofork用当前R4B实际main路径，Npositive用新runner。不能在本票运行该mixedlegacy文件，它仍有真实kernel动作。若TS声明/loader边界超范围，先具名ask，别绕严格类型或引入第二份owner框架。

## E. 六纯门、完整记录和交还

只准JSON六命令：tsc；identity纯Vitest；Python unit；新normalpilot纯Vitest；manifest generate；manifest check。所有首次试跑前包原recorder，fresh n1n2-claude-060p5b-*，每个红新名保留，不直接预跑确认。generation实际首变更仅JSON，源冻结duringruntime。纯test真spawn guard先throw、OS/clock/fs/child边界注入；至少驱动actual supervisor start无PID error→close无exit、失败exec domain与successeligibility差异、无workerHELLO reconcile、ownedcancelforeign/未start/nooverride、actual kernel未知identity→恢复欠KILL，以及actual新工具constructor/reserve/expect/startheld/evidencefail/cancel/freshproof。不要纯helper字段assert替代真实orchestration。

本票不运行CLI/N/C/fork/prctl/目标wait/signal/Host/HTTP/media/Chrome/Q2/legacy整文件/fullcheck/build；不Gitadd/commit/reset/stash/push、无网络/付费/J盘/用户env凭据读取。新429立即停、不重试/换provider/接手。

报告每目标finding真实callsite/mockcapture/NOT_RUN、2新工具/6改动hash、原保护不变、所有红绿命令、privatecancel/diagnostic契约及失败终局truth表、精确下一Nnormal+故意失败两CLI（只建议不跑）。原remaining plan继续R6/R7/R8，不用R5B签所有12finding/原17/ISO18/N1N2。worker_done交还writer，MAIN独立审启动及newpositiveowner安全，再另票逐case真实N。
