# R6 私有合同与整批开发验收草案独立审查

**REQUEST_CHANGES。** 2 MAJOR、1 MINOR；需一次合并补齐终局分支/生产顺序，不需要架构重写、公共API或额外生产文件。此结论仅文档可实施性，不宣称当前正常/指定失败最小基线不安全，也不授予Claude实施或任何runtime。

本审全文阅读两份MAIN草案，核MAIN_DRAFT_INPUT_BINDING及651当前输入，按实际生产函数推演；没有修改W/MAIN草案/旧证据，没有执行产品、测试、编译、生成、C/N/kernel/网络/信号/Host/Chrome，也未派生Agent。全部本审runtime **NOT_RUN**。历史HEAD仍只是1d348d419120f23f45d958112ea8c43df5a04675，非新冻结commit。输入实际摘要及结束复核见INPUTS.json；651是hash-read，非651逐行语义审计。

## 可以保留的已选方向

complete-v2绑定完整语义transcript；failed-terminal-v1只允许原失败资源终局、永不creative；receipt_version:2无旧fallback。这一分层正确，不应因overflow收敛而删掉complete检查。首预算错误锁存、较早cause保留/预算作为secondary、snapshot与唯一publication mapper联动、private actual late channel-error tests和原预算值都在同批合理范围。

专用C在fork前已成为subreaper，整个生命周期只有原N根且无其他wait消费者，原N实际wait后同C实际ECHILD，再结合原组gone、保留epochs新鲜gone，能够在所声明的根所有权前提下支持有界失败终局；不是只凭ECHILD，也不是恶意native/cgroup级隔离保证。若scope前提确实丢失，继续held是正确边界。需要补的是这些前提在真实producer入口如何单调成立和被直接测试，不能把wire true当生成机制。

parent-reaped-observed-gone的限定诚实：只证明已知归属原epoch消失/被另一epoch替代，不伪造C wait、父wait或退出码。不能把unknown/Z当gone。C09明确仍需另票新fixture pin/真实屏障，当前受保护fixture不改，R6仅C06..08内部交付不冒充整项完成，这些边界正确。

## MAJOR 1：startup各分支尚无法同时满足统一必需门

来源MAIN_PRIVATE_CONTRACT_DRAFT.md:13、18、22、26–28、39；验收草案:21。第18行将failed-exec/no-worker合写并要求自己的forked_pid terminal wait；第26行却允许no-fork worker_wait:null，第27行仍统一要求N wait之后的ECHILD，complete又统一N-last。未建立group的分支未给确切wire值，未打开stream的分支没有可诚实填写的EOF/read-failed disposition。每segment非空/count正整数也未说明无fork空transcript。

这不是纯假设：当前supervisor.ts:2936实际proof区分child未返回、异步spawn未birth+真实close、C已birth但未authorize；:3033只有authorizeSent才要求receipt。C的draw/ticket在cache-process-custodian.py:1558收到AUTHORIZE后才锁入，未authorize的C根本不能产生正确draw/ticket绑定receipt。accepted authorize后os.fork失败则Host已authorizeSent但没有N；setsid/exec失败又是确实有N但未N_HELLO的不同分支。当前exec-status管道classify_exec_status:455/_exec_fail:1064只传errno，同errno不能证明究竟setsid未建立还是execve失败。

最小一次修订：增加明确discriminated startup表，逐分支写必需key/null/type/证明入口，而非“另行定义”：

- Host无C/未birth：保持真实error+close等现有事实门，不要求不存在的C receipt/epoch/N wait。
- C已birth但未收到authorize：保持原Host no-authorize close/exit/fresh检查，不反向要求C从未知ticket生成receipt。
- C已接受绑定但fork确定失败无child：bound no-fork证书；fork状态、forked_pid/N epoch/worker_wait及post-worker ordinal有明确null分支，使用C自身实际无children事实。只有真实无FD才填not-opened；部分已分配FD仍需真实closure。
- 原fork存在但setup/exec失败：原N actual terminal wait/errno必需，未知epoch明确null，独立group已建立/未建立/unknown要有确切区分和来源；不得探Host继承组或要求成功N_HELLO。可在同一.py内部exec-status通道补setup-stage证据，不碰固定N helper；无法证明的义务仍unknown。
- 明确空transcript允许零段的特定分支，或定义实际发生的必需非空event；不许为凑完整proof虚构wait/EOF。C06-EXEC增加每分支writer→真实Host parser/domain/eligibility对照，而非只stub一个bool。

## MAJOR 2：根证书及EIO结束需要明确单调生产门

来源合同:25、31–32、39；验收:27–28。现有_run_loop（.py:2304/2321）在outer loop才检查_terminated；同次read的[CANCEL,AUTHORIZE_FORK]仍会执行后者。[AUTHORIZE,AUTHORIZE]也会再次进入_authorize_fork:1558，改draw/ticket并覆盖原worker_pid与pipe字段。正常已审Host实际只发一次AUTHORIZE；这里是本票所审私有协议fault seam，不声称公共JSON能发这些命令。

草案要求“原N唯一根/no_new_fork_after_termination是实际生产事实”，并正确要求失root held，但尚未明确这里必须先改的C入口状态机/对应直接反例。仅在结尾填true、或覆盖原字段后才发现false，不能保存原责任。建议明确：第一次合法authorize在任何fork前封存不可变binding/executable inputs、消耗唯一fork attempt；重复authorize和termination之后authorize锁存协议失败，不能再次分配/fork/覆盖原PID/FD；fork失败也不隐式重试。C证书只从同一原始registry派生。增加实际_read_control/_run_loop/_authorize_fork路径两种同batch反例，raw fork边界deny/脚本记录，检查第一次责任从未被替换；合法[AUTHORIZE,CANCEL]只拥有一个N。

EIO分支还有阶段依赖需明示：第39行“所有资源已独立终结后关闭EIO reader”若按包含reader的最终resource_proof_complete理解，会自己等自己；若等待Host C-close，则C尚未发receipt更形成环。最小修订不是新架构，而是明确三步：
1. C活着时先生成本地raw_tree_terminal证明：真实wait/no-fork分支、最后actual wait之后的新鲜ECHILD、原组/retained epochs义务；不依赖receipt交付、Host C-close或stream reader已closed。
2. 消费该本地证明完成stream ledger，EIO reader实际close一次且eof=false/disposition=read-failed-and-reader-closed；未知raw tree不得以关闭reader冒充结束。
3. 组合最终资源证书→发送/flush receipt→C exit/close→Host最终fresh检查。保留N专用terminal/ordinal与后续wait计数跨recover，不重复记wait，不重获signal权限。

验收同时走actual settle→reader finish→receipt→Host终局；raw-tree unknown、reader close未证的反对照保持原promise pending，正常EOF对照可完成。无需改变任何责任时限或PID/group权限。

## MINOR：修正C08-FORGE取值文案

验收草案:30把“falsecreative”列为拒绝项，但合同:24要求合法failed-terminal恰为creative_eligible:false。请直接写“creative_eligible:true / missing / wrong-type拒绝；false合法正控”，并把其他必须true的proof布尔false单列。不要让测试作者把合法失败证书反向判错。

## 合并修订与后续边界

两份草案同轮加入startup表、C-side唯一authorize/fork gate、raw-tree与stream/final分层顺序；对应补C06-EXEC/BIND/ORDER、C07-EIO、C08-END/HOLD/LATEWAIT/FORGE的直接case。其余full epoch语义/首cause/bytes预算/publication唯一消费者/六条FIRST门均可保留。现有八文件足以实施这些接口与直接测试，未使用文件不改；不需要upstream/workspace/closure/公共合同/新依赖，也不放开fixture。

本报告不要求本票完成C09或真实P2，但C09及原17/ISO18仍保持OPEN，不能靠normal002/fault001或草案文字签绿。MAIN修订合同并再绑定后才决定精确源码release；源码交还/独立安全后，真实normal/fault与递进场景仍逐票授权。本审没有向Claude发实施令，也没有给N1N2/R6/R7/R8/冻结/NEXT/V1通过。
