# PROC-0 执行预约与交还门合同 v4

本包是流程工具工作包，简称PROC-0；不是PRD优先级P0或Gate V1-P0。用户新active goal明确恢复全A/N1N2主线，第一步先完成本工具门。原R6/R7/R8/17+ISO18/NEXT范围保持。本文先独立文档审查，未发实施release、未运行产品。

## 1. 当前事实与最小范围
W=../Narralens-agents/main-integration，branch agent-driven/main-a-integration，观察HEAD 9bde8c4584e3d13bcad474564caccfcbce2ced6f，clean；旧Claude ctx_17cf94883a53经worker-show为stopped/liveness exited。只读/proc扫描未发现本项目run-recorded进程，不将该扫描声称全机/历史进程绝对不存在。
原run-recorded.py SHA88cd47ec732a340f54cdd4bb05b05878887697eebb0ddc94b1ccd7d0e434fd10保持不变。tools/check-delivery-spec.py已存在，但仅metadata admission，当前PARTIAL packet拒绝是正确行为。旧python003挂起与MAIN精确终止/source_changed原件保留；当前helper已改用tempfile与两轮drain，仅静态看到，不把它当真实pipe/backpressure验收。

## 2. 实体与工具边界
新增tools/run-delivery.py，标准库实现薄执行包装；新增tests/process/test_delivery_admission.py和最小fixtures/admission_helper.py（工具自证，不是产品替身）。可按直接需要修tools/check-delivery-spec.py及补其direct tests；不改原recorder，不改src/、产品contracts、R6协议算法/fixture、包依赖或配置。工具状态、wrapper旁证与helper自有数据仅W/var/process-admission/；原recorded六件套按§2B唯一新basename例外；正式交还材料在本包指定OWN目录，原历史日志不动。源码分配仍唯一Claude，MAIN只写合同/验收包与实际验收，独立Codex审实现。

CLI最小命令：status、begin-write、end-write、run、request-cancel、rebind。所有写状态入口都校验release路径+MAIN期望SHA（--expected-release-sha256必需）、project root、owner task ID、格式/必需类型。source pin含原recorder、允许工具与全部实际recorded输入、保护项；真实源码路径逐项核对，不只对影子目录算SHA。
run只接受release的command_id枚举及唯一capture，不接受原始argv/--shell/任意cwd/未知flag。release中每条精确argv、runtime_class、expected exit、source inventory、recorder pin、capture prefix、state root都必需。命令值严查array of nonempty strings，不经shell拼接；原recorder通过绝对Python3.12 -I -S -B启动，cwd只能release绑定的W。禁止额外timeout包装；run同步等待原recorder结束，原日志.cmd/.inputs/.claim/.exit/.result由原recorder唯一生成。任何existing suffix即拒绝，不能覆盖或复用capture。
此工具是合作式命令/资源准入，不是对恶意同用户的安全边界；预期release SHA与文件owner约定由MAIN/工具权限共同维护。不能声称阻止所有原始Bash或OS级编辑。违规绕过仍须停工记录；不篡改CLI配置/凭据去强行实现权限限制。

## 2A. 输入绑定与原记录器相容
release分开 `recorded_source`（原recorder实际扫描的全部路径→SHA）、`protected_inputs`（例如AGENTS/计划/固定helper/二进制、完整路径→SHA）与 `commands`。不能把原recorder不扫描的AGENTS强塞进其.inputs后宣称相等。原recorder文件与.inputs都不可补写；额外pin的真实pre/post核对进wrapper自己的旁证。packet.source只包含实际recorded输入，protected单独核；source inventory不能仅列有利子集。

运行前/后完整发现原固定recorder范围内的实际文件集合，严格等于recorded_source路径集且逐SHA吻合；新加工具/测试文件也须显式重绑，不沿用旧651数量。原始.cmd/.claim/.inputs/.exit/.result/.txt任何缺失都不补造。Bootstrap grants与将来的真正run grants分别产生；RELEASE_SHAPE.json只是字段样例，无任何执行许可。

## 3. 预约与生命周期
project root只有一个持久state目录（真实路径、不能由CLI任意覆盖），O_EXCL/mkdir或经过实测的本机跨进程原子机制获取短事务锁。并发只允许一个修改事务；锁失败不能退回无锁写，也不删除不认识的锁。状态写入临时同目录unique文件→真实flush/close→atomic replace，追加有界单条journal/event记录保留历史；不覆盖旧run结果。
区分两个维度：phase=IDLE/WRITING/STARTING/RUNNING/TERMINAL/UNKNOWN；admission=READY/BLOCKED。运行exit非0是结果不是资源仍活；源码漂移/证据坏是admission BLOCKED，不可伪装进程仍活或自动通过。unknown进程则phase UNKNOWN且BLOCKED，无新验证/写入许可。

|入口|准入与单调事实|输出/禁止|
|begin-write|仅无活动/unknown验证及无别人write lease；锁内记录task、随机nonce、generation、原release pin|WRITING逻辑许可；明确不代表OS强制写保护，也不能用逻辑lease当实际Agent存活证据|
|end-write|原owner/nonce/generation完全一致，重新核输入并记录实际变更|解除逻辑写许可；因改源旧runtime pin失效，MAIN更新release再run，不能工具自行批准新source|
|run|无写lease/活动或unknown运行；原release+source+命令+capture全部校验后，在Popen前持久STARTING与wrapper完整epoch|只有一个command；失去短锁不允许执行；Popen成功后立刻保存recorder真实pid/start_ticks/ppid/pgid/sid与boot身份|
|status|只读实际/proc与保存的原epoch，不读取env或配置|文件state或PID存在都不是存活充分证据；PID reuse/Z/读不明如实报告，不能仅凭时间清锁|
|request-cancel|同一run_id/owner且实际未终局|只记录CANCEL_REQUESTED事实，不发产品信号、不杀recorder/组、仍阻止下一次run；请求不等于取消完成|
|终局|对同一Popen实际wait，核原capture exit/result/log/inputs，保存已观察自有后代及原组实际状态|已观察资源若仍live/Z/unknown则UNKNOWN持责；已结束但坏证据为TERMINAL/BLOCKED；干净可回IDLE/READY（只允许同release源与下一唯一capture）|
|rebind|必须有显式新MAIN release SHA、无活动/unknown资源及无别人write lease；核旧证据保全|可解除纯metadata阻塞或更新改源后pin，保留旧记录。不能据旧PID缺失/过时锁就清unknown；未知清理需MAIN提交实际终局事实并另裁决，不实现自动资源回收|

wrapper身份完整tuple加boot_id（仅读/proc/sys/kernel/random/boot_id）；record PID和known descendant epoch只来自实际该次Popen链，不从外部任意PID输入取得信号权限。可为原recorder建立独立session/group并作只读signal0探测；不能向组发TERM/KILL。本票不新增通用kill/reaper/强制unlock/责任超时。原recorder和测试命令仍可能派生工具子进程；采样的known descendants必须明确不是完整历史fork transcript，不能用它签R6/D2。
wrapper异常或死亡：STARTING已持久但recorder身份未存为UNKNOWN，禁止自动重跑；RUNNING而wrapper已死也不得自动释放，因recorder/后代可能还活。Popen失败需要确切无child事实，已返回child后的metadata写失败仍保原child责任，不抛出后丢手柄。真实运行中异常优先记录，再保同一wait责任，不重新启动原命令。
测试命令正常退出但有known child未清理，不可先解除slot再补清理。无可靠完整进程树隔离保证，工具只能核自己实际观察到的epoch和原owned group，报告观察局限，不能把工具层可调度当产品资源证明。

## 4. 交还metadata门补强
权威release清单与packet required cases/source/contract逐项相等。只接受自己真实存在的capture全套、cmd/cwd符合该release允许命令、current source与capture输入一致、log bytes/hash、exit/result一致且无source drift。0为METADATA_READY_FOR_REVIEW，2为拒绝；均不是业务PASS。明确expected nonzero还需case实际资格证明及source绑定，不能仅self-report case_passed就覆盖原业务验收。工具不验证全部测试语义，MAIN/独立复核仍判断direct可达性。
不要将历史已passed但受改源影响的capture作为current evidence，不删除required IDs。对当前R6的packet只能保持PARTIAL/NEEDS_REVALIDATION；不得在PROC0把它调绿。

## 5. 自验证与运行许可分层
首阶段只准类型/语法与工具direct tests：mock实际Popen/持久状态/文件系统/identity接口，但断言调用真实runner入口，不能另写predicate；持续deny未声明的os.kill/killpg/fork/waitpid/prctl/产品spawn。工具的Popen边界测试用mock，不能偷跑R6 suites或实际C/N。
独立源码审查后，MAIN另发精确自证票：只允许该工具自己的有限Python helper（pass/fail/owned-file barrier），正常返回与双客户争抢验证；临时根属于var/process-admission/selftest唯一root，helper不fork、无网络/声音/Host/模型。故障/超时只让helper真实退出失败，绝不拿计时器当进程消失；由原owner实际wait。取消/丢wrapper对照可先mock；如需实际wrapper死亡注入，另具名精确PID/epoch票，当前未释放。不得为metadata工具重建另一套C/subreaper架构。
真实R6 C/N命令直到独立安全审+新pin+专用release仍禁止。整个PROC0通过也不签R6/N1N2/V1；原R6剩余内容必须继续。

## 6. G1–G4修订后的精确约定（优先于上文简写）

### 6.1 单一MAIN信任入口与case归属（G1）
执行与最终交还使用同一份MAIN release；不是由packet选择信任源。runner与checker的真实CLI均要求外部传入 --release <MAIN文件> --expected-release-sha256 <MAIN给定摘要>；checker另收--packet。缺失信任参数（除纯--self-test）必须拒绝，不允许从packet.release取代。默认拒绝替换release与packet整套的攻击；攻击者同时改CLI信任值超出合作式工具边界，不声称OS安全。
release固定format、release_id、phase、owner_task、generation、project_root、state_root、recorder={path,sha256}、recorded_source、protected_inputs、commands、required_cases、case_bindings、capture_allocations、contract。release.phase为BOOTSTRAP_CODE或TOOL_RUNTIME或FINAL_METADATA，各自范围明确，不互相升级；后续阶段使用MAIN新release，并保留前期源一致的证据绑定。
commands按command_id固定精确argv/cwd/runtime_class/expected_inner_exit与允许阶段。case_bindings为每个required_case固定允许command_id列表、证据层D0/D1/TOOL_RUNTIME、预期内层退出及expected_failure_requirement；只能精确等于权威case集合。多个case可明确共用同一套件capture，不能把任意合法命令给任意case。
capture_allocations绑定command_id、唯一ASCII basename、原recorder目录、阶段、可覆盖case集合及runtime run_id；不能临时换cwd/argv/capture。MAIN可一次预分配若干具名basename以容纳局部失败与最终捕获；用尽需补票，不让实现者生成无限执行许可。
packet.source是release.recorded_source的相同路径/摘要列表，protected_inputs另比对；packet.release/contract必须与外部MAIN入口一致，所有case一一齐全。核原claim.name/argv/runner_version=3、cmd.argv/cwd/runner_version、capture真实绝对路径等于分配目录+basename，原.inputs键集合和值精确等于该运行批准的全部recorded_source（含额外键拒绝），原exit/result一致、source_changed/added空、loghash和实际wait旁证。
wrapper旁证绑定release SHA、run_id、command_id、capture、source、protected pre/post、原recorder实际wait及状态。bootstrap由MAIN精确票授权原录制器直启：单列BOOTSTRAP旁证与actual recorder wait，由该直接调用的owner记录，不伪造wrapper已经执行；checker按release.phase和case层接受其明确来源，不能把bootstrap旁证用于TOOL_RUNTIME。
expected nonzero凭据必须绑定case_id/capture basename及全套原件摘要、command_id/run_id、实际source/protected、具体断言触达/原原因与清理证据引用。自报case_passed只作必要字段，不是充分业务证明。错次运行/错断言即拒，MAIN/独立审查仍核语义。

### 6.2 原capture位置与分层审查（G2）
原recorder脚本目录W/docs/execution/A/implementation-20261111/integration/e1-main-takeover仅允许为本票分配的unique basename新增.claim.json/.inputs.json/.cmd.json/.txt/.exit/.result.json。这是var限制的具名例外，原recorder本身/旧日志不变。basename必须逐字符属于ASCII [A-Za-z0-9_-]且非空；禁止slash、dot、绝对路径、Unicode近似字符。六suffix任一已有即在Popen之前拒绝；wrapper sidecar仅var绑定目录，不能补写原六件套。
层L1=BOOTSTRAP_CODE：Claude写工具/direct tests后冻结该次输入，由原recorder FIRST直接运行pure/mock tests；无需尚未审定工具给自己发租约。所有16项都必须有direct mock或静态设计映射，但PROC0-04/09/13的真实排他/取消在途/实际wait以及其他标注TOOL_RUNTIME者保持NOT_RUN。交还状态只能CODE_CANDIDATE_FOR_REVIEW；L1 metadata预检按该阶段精确case层验证，不允许READY_FOR_REVIEW总工具完成。
层L2=独立源码审查：核L1同源全部材料、16项mock覆盖和未知风险，可给SAFE_FOR_SEPARATELY_PINNED_TOOL_RUNTIME，不给总PASS。无真实跨进程证据不阻碍这个明确有限的源码安全审查；未释放真实证据不冒充通过。
层L3=MAIN另发TOOL_RUNTIME release：固定冻结源码、有限helper与两客户实际争抢、pass0/指定fail1、运行中request-cancel不假释放。原录制器所有真实六件套、不同请求ID、唯一实际Popen/claim、winner wait及资源状态都需记录。finite helper不fork/不联网/无产品，实际wrapper死亡或信号注入不在本层默认许可。DIRECT-only已有源一致材料可复用，不强制重跑。
层L4=最终工具完整交还：合并L1/L3（每份精确phase/release/source均核），16项各层要求全满足，checker只可METADATA_READY_FOR_REVIEW，独立审查与MAIN仍签工具结论；不签R6/N1N2。若两层source不同，旧受影响证据重验，不能合并不同源凑齐。
当前R6 PARTIAL packet保留原字节，使用新checker缺信任入口/陈旧源必须拒绝，不修它冒充本工具case通过。原17/ISO18及C09等全部继续。

### 6.3 state单权威与短锁事务（G3）
state.json是唯一准入权威；journal是审计投影，不能从一条journal猜state已提交。state包含monotonic sequence、run_id/generation、phase/admission、cancel_requested sticky、pending_audit与本条event_id。每次变更锁内重新读真实state，核owner/run_id/generation，合并已有cancel_requested=true，不能用旧内存快照覆盖。
run事务：短锁内全部准入核对，原子提交STARTING+slot后释放短锁；只有创建该slot的唯一owner执行一次Popen，等待和读取不持短锁。Popen后身份读取/落盘均try/finally保同一Popen.wait责任；无论读取/proc失败还是持久写失败，不能丢掉已返回child，也不再启动一次。记录失败保存在owner实际结果和独立旁证；无法可靠持久化时后继按STARTING/缺证据UNKNOWN拒绝。
每次状态落盘：锁内new unique tmp→flush/close→atomic replace state(pending_audit=true,event_id)→append journal(event_id)并flush/close→atomic replace state(pending_audit=false)。journal重复ID可核同内容，不据其生成第二执行；任何途中失败保持/报告BLOCKED，pending_audit未清不准新执行。替换前失败保旧权威state；替换后journal失败保新state+pending，不回滚成可运行。state最终写失败不能宣称已落盘TERMINAL，即使本地wait已结束；status将物理wait事实与未完成准入持久化分别显示。未持久化的state不能用空journal或时间回IDLE。损坏/未知锁/state须MAIN具体事实裁决，工具不自动删锁/回收。
request-cancel拿短锁重读同run，单调置true并保留请求事件；终局拿锁重读合并该事实，若请求晚于terminal则如实ALREADY_TERMINAL而非撤回已完成。并发两种顺序均不丢事实。终局保存实际wait/内层元数据/资源观察/准入结果，不能先释放slot再核子资源。
end-write用原release的owner/nonce/generation身份关闭租约，不要求允许改动的工具文件仍等于写前pin，否则合法写无法结束；必须核不允许改动项/protected，记录全部实际diff/新增及post hashes。成功关闭租约后admission BLOCKED_STALE_PIN，不能自动以自己修改后的源码更新授权。顺序只能begin-write→合法修改→end-write→MAIN新release rebind；WRITING尚未结束时rebind拒绝，不能用新release抹原owner。越权改动记录并阻塞，不能通过end-write洗白。

### 6.4 内外退出码的定义域（G4）
release expected_inner_exit指测试命令的subprocess.returncode；原.exit与.result.exit也为此域，必须严格同一整数，不从记录器外层结果反推。wrapper另保存recorder_wait_returncode，指原recorder这个Popen实际wait。
在本票Linux/POSIX且原recorder完整正常结束时：内层为0..255或负信号整数（合法信号范围），记录器执行sys.exit(inner)的外层编码应为inner & 255，例如-15对应241；先核完整原件和唯一该capture再比较编码。241本身不能证明SIGTERM；expected -15也不代表授权发送信号。本票真实helper只0与指定1，-15/241只mock反例。
若recorder_wait_returncode<0（记录器自身被信号结束），或缺result/exit/日志、无法核该capture，则metadata拒绝，保留实际outer wait，不编造inner。实际recorder已结束不等于后代清理完成；资源状态独立判。外层正常0/内层非0、外层241/原件inner1、预期1但原因不符等均不能通过。可知资源终局但metadata坏为TERMINAL/BLOCKED，未知实际资源为UNKNOWN/BLOCKED。

### 6.5 最终票批准历史阶段与多份必需证据（R2-01）
FINAL_METADATA以外部MAIN release路径+SHA为唯一根。其approved_stage_releases按别名明确列每份可用历史stage release的真实path、SHA、phase、recorded_source和protected_inputs。checker先验证该文件实际摘要/phase/授权字段与最终票一致，再检查其捕获；不能信任packet自行提供的新历史票，即使源相同也拒绝。历史release相同源精确集合是必要非充分条件；保护项如确因仅文档变更由MAIN显式逐项裁决，不可忽略。
case_bindings每原case改为required_evidence数组：每个slot_id分别固定approved_stage_release别名、command_id、capture_basename、run_id、level、expected_inner_exit与expected_failure_requirement。全部slot必须恰一次满足，无隐式任选；alternatives为空默认无备选，只有MAIN显式给出同slot合格备选时才可择一。shared suite仍必须分别获准用于各case/slot。capture预留名不等于必交slot，未使用不要求伪造或执行。
packet每case.evidence数组逐slot引用历史票、原六件套、wrapper或BOOTSTRAP旁证、失败凭据；最终checker同时核根票、获准阶段票、case-slot与精确运行、每次全部同源输入/受保护事实及实际inner/outer退出，不能只核某一条绿色。L1单阶段票也用同一required_evidence结构（每case一个或多个L1 slot），不保留第二套歧义字段；旧release/packet格式缺必需slot默认拒绝，不修旧R6 PARTIAL原件求绿。
最小落盘样例见samples/：PROC0-13必须有L1_DIRECT+L3_SUCCESS(inner0)+L3_EXPECTED_FAILURE(inner1且指定原因/清理凭据)三份；分别漏任一份、用成功替失败、同源未获准历史票全部拒绝。示例无运行许可且SYNTHETIC_ONLY是非生产占位，不宣称仅此形状可被真实checker准入；direct tests需要填入完整真实临时元数据fixture后验证正反分支。完整16项及其L1/L3各层义务保持。

## 7. L2修订的实现约束（rev4；2026-11-20，MAIN裁决）
本节闭环L2-01..09，不减少原16 case、不扩产品范围。v3保留于history/l2-candidate-9c2f6237及Git 9c2f6237；原003/004仅历史候选L1，修订后完整同源L1另录，不能混绿。

1. 项目准入权威固定为真实project_root/var/process-admission/authority，只有该处state.json、lock、journal决定phase/admission/write lease；真实项目绑定不可经票面state_root变化重置。票面state_root仅为该项目var/process-admission之下的本票产物根（logs/sidecars/credentials/终局收据），不能再是独立准入权威。当前从未运行实际新runner，故无生产旧权威迁移许可；遇到真实既存矛盾状态先拒绝并交MAIN，不搜索删除或隐式合并旧根。损坏/空/字段不全state绝不initial READY。普通写状态入口必须匹配已绑定release SHA/owner/generation；改源end-write严格关闭原lease后保持STALE，只有显式新票rebind可更新pin。status只读不重绑。
2. 先取得完整wrapper epoch/boot及自有身份才预约，未知即不spawn。Popen一旦返回，日志close/identity/持久化或其他错误都不能当NO_CHILD；贯穿的同owner finally负责对这个对象wait恰一次，不重启。recorder身份保存与identity_verified分别记；pid/start_ticks/boot/PPID/session/group不完整或不符原创建链，wait照做但UNKNOWN/BLOCKED，不以空group或inferred tuple代证。
3. source完整preflight可在锁外；最终预约须在同一项目权威短事务核generation/sequence没被期间write/rebind改变，且再次核capture六suffix均不存在。不得在持有wait期间占事务锁，不得借NO_CHILD或stale例外重入。两种真实竞争分别有可控mock：预检后别的run已完整结束，或别的写租约已闭合；滞后请求都不能第二Popen/用旧pin启动。
4. 所有状态事务先校验原state schema、slot/run身份和未完成pending_audit；存在旧pending不能以新事件清掉。实际wait事实与持久化/交还资格分离；sidecar、指定失败凭据或terminal提交任一必需落盘失败，CLI必须明确非成功、admission BLOCKED/UNKNOWN而非未提交内存READY。保留旧pending/event和真实child责任，不自动repair journal。
5. TOOL_RUNTIME的终局需要可核的实际提交事实：正常路径先生成有精确SHA的sidecar/资格凭据，再在项目权威事务提交绑定run、原件摘要、inner/outer、资源事实与产物SHA的terminal事件，旧pending不得覆盖；提交成功后产生本票唯一不可覆盖的per-run terminal receipt，绑定该event_id/sequence和原产物SHA。checker须从外部阶段票导出终局收据/权威journal位置，核同事件实际存在及提交完成事实，不能只信sidecar.metadata_ok或一个自报persisted布尔。receipt写失败也不报准入成功；不可撤销的真实wait保留。receipt可在后续正常状态更新后被核，不要求current mutable state仍恰等于当时整个文件SHA。此为合作式工具证明，不声称防同用户任意改文件；不新增第二调度状态机/签名体系。
6. 读任何packet产物前，从外部已批准stage及该allocation导出唯一原件目录与basename、state_root固定命名的sidecar/credential/terminal receipt；校验规范路径和每个实际后缀canonical目标，越界或不符立即停止该项，不能先读再累计错误。bootstrap旁证在获准state_root/bootstrap/<run_id>.json，runtime在state_root/sidecars与credentials；凭据只能引用同一已核sidecar。run_id与capture一样只允许非空ASCII[A-Za-z0-9_-]且各自唯一；不读真实敏感文件做反例，只在fixture用无害哨兵记录零内容读取。
7. slot完整非空且逐stage alias、case、phase、command/capture/run/level/expected exit归属一致；指定成功或失败证据不能互换。原件inner、sidecar inner/outer、实际wait/cleanup与资格凭据必须同一事实链。非对象JSON明确错误；预留allocation不是必交slot。producer必须从实际日志核指定断言确已触发才签case_passed，否则只记真实CLEAN与exit，不签资格。
8. recorded_source继续只能仓内安全相对路径。protected_inputs允许MAIN精确列出的仓内相对项及必要绝对pin（固定Python与MAIN observer等），两者均核实际pre/post，不能变成packet任意文件读取许可。精确票明确列完整path/SHA；以真实L3形状做TOOL_RUNTIME producer→checker pure/mock正反例，实际helper仍未放行。
9. helper barrier只在当前项目真实var/process-admission/selftest下的新具名根，拒绝越界/链接逃逸/已有held或release、非有限或非正时长；标记独占创建，清理失败诚实失败。只用pure验证测试，不为修订跑实际helper。不得借此增加通用文件清理器或计时责任释放。
