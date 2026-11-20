# PROC0 L2修订001：合并根因票 / WRITE_ONLY

唯一writer ClaudeCode，实际Task task_1e803fda402b / Dispatch ctx_ab2f1ac4c732，Orca窗口 term_8ce0fd38495e75583c94e69607edc5da。MAIN设计、验收、独立外审，未接写源码。W=/mnt/c/workspace/videoworkline/Narralens-agents/main-integration；起点9c2f6237f997c27e3f2d013fec48107a56f862ba，原R6 WIP不变，不能reset/stash。

## 本票只做什么
完整读取原review/FINDINGS的9项，逐ID闭环；唯一设计为CONTRACT rev4 §7（不减少v3原16义务）。允许五文件见RELEASE与OWN_L2_REPAIR_REPORT.md、OWN_L2_REPAIR_HANDOVER.md新增报告。不改其他src/contracts/包配置/依赖/原recorder/MAIN observer/旧证据/合同与案例；不建新框架，不切引擎。所有修订是工具薄层的责任修复。绝对pin仅MAIN明列文件，不接受packet任意文件；state_root为产物根，项目authority根为固定一个。

## 共因闭环顺序
A. L2-01/02/03/06/07同一生命周期事务：唯一project authority、完整state校验/绑定、锁内最终source/capture预约、已Popen即贯穿finally同owner wait、完整epoch与物理/持久/交还三类事实分离、pending不覆盖。先画自身调用路径及状态表再写，不逐finding打补丁却保留旁路。若同一事实不明确，拿具体调用点向MAIN询问，不猜改合同。
B. L2-04/05：producer→sidecar/credential→真实已提交terminal receipt/journal→checker完整slot链。路径必须先规范与归属核实再读取；每后缀实际canonical也核。不准换成先读取出错后累计拒绝。以无害fixture读取日志证明越界零读。指定失败必须实际日志触达指定assertion才签资格。对合法JSON非dict必须明确拒绝。
C. L2-08/09与真实形状：helper根/标记/有限时长；外部Python与observer pin正反例；TOOL_RUNTIME mock实际command_run生产产物喂生产checker，覆盖成功、指定失败及错事实，不再只用BOOTSTRAP fake链。实际新工具/helper依旧NOT_RUN。

## 不可退化的直接反例
1. 日志close在返回child后报错、identity任意可预期读取错误、_persist_running抛异常/返回失败：原child一Popen一wait，永不NO_CHILD；真实Popen未返回才NO_CHILD。对每个catch说明哪些错误可能跨出而漏wait。不要用吞所有错并READY解决。
2. wrapper身份/boot缺失不spawn；recorder identityNone或session不符，wait仍真实调用但UNKNOWN/BLOCKED。完整对照能落盘CLEAN，checker原件inner/outer和epoch核对；不硬写真布尔。
3. 两受信票改artifact根仍同一authority；旧UNKNOWN/pending/WRITING/空state都拒。旧票/owner/generation/end-write lease pin错拒；合法改源后stale必须显式rebind，不容run绕过。
4. 两控制mock客户都预检后，另一run完整结束或一次write lease闭合再放行滞后请求：第二Popen不可发生。既有任何capture suffix皆拒。锁不跨wait。
5. RUNNING/cancel/terminal的state replace成功journal失败分别注入，保原event/pending；后续不能清旧pending或报READY；sidecar/credential/receipt写失败和terminal提交失败CLI非成功并保实际wait，不伪造内存admission已提交。终局收据与已提交journal实际事件相互绑定且保原件hash。
6. 正确多slot正控上逐一只改：alias换总票内另一同型阶段、allocation无该case、phase错、空required_evidence、空evidence、sidecar inner/outer自洽却不同于原件、cleanup.source不同、指定assertion日志未触达、sidecar/credential为[]。每项明确拒绝原因且恢复正控通过。不能只assert任意problems非空掩盖读错路径。
7. packet路径外部/escape symlink/内层credential sidecar/错误capture逐项零内容读取。用无害哨兵，禁止读真实配置证明。
8. 精确受信绝对Python pin与observer pin真实L3票形状经TOOL_RUNTIME production→checker mock，错误SHA拒，recorded_source仍相对，不解禁caller rawargv。
9. helper纯验证根逃逸/已有held与release/NaN/inf/非正时长，未创建进程；清理失败不是默默成功。helper无fork/network。

保留既有全部25/24 direct及selftest语义，不硬保计数，不删case、无弱化pure guard、无拉长超时、无变更原recorder。测试错误名/断言必须指向拒绝原因与持久事实；正控前后恢复；错误发生在fixture本身不算语义反例。启动本票先重新ACK原报告中代码存在不等于完整语义。

## 源码写入与验证分时
本票先WRITE_ONLY，不准运行任何测试、selftest、受审CLI/newrunner/helper、corepack/node、R6/C/N、Host/Chrome/model/fork/wait/prctl/信号或产品命令。可用编辑脚本和标准库AST解析做静态语法核查，不import项目/受审模块，不暗跑测试。未完成不要worker_done；代码与direct测试写完后以Orca ask请求MAIN冻结本次源并给B1/B2/B3原recorder FIRST精确票，然后结束该轮等待，不自行生成运行授权。MAIN只读核scope/source，原observer后续按新票运行pure mock。任何红灯保留、停后续输入写入至实际结束，再由MAIN退回WRITE票。L1全绿+全16交还齐才候选冻结、独立L2复审；L3另票，R6未解禁。

OWN报告逐L2-01..09、原16case、代码入口、确切测试名、源码前后SHA、未决风险、实际命令与NOT_RUN、失败原件；不靠新增测试计数宣称结论。完整交还包最终MAIN协助生成但实施者仍须提供可核实映射。不自签外审或runtime PASS。

新429立即停，不自动重试重启/换供应商/Codex接写；保留源码与真实责任。普通代码修订在同票闭环，发生模型stream解析错误可如实记录但不擅自改供应商/配置；无法继续就报告实际错误与任务状态。
