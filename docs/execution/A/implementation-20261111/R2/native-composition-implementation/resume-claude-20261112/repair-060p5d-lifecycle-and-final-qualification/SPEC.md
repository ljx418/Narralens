# R5D：完整异步生命周期与最终资格，一次合并修复

本票承接R5C已交还候选，不重写已通过模块，不重置历史。先读本RELEASE.json/MAIN_COMBINED_ADJUDICATION.json/START_INPUT_BINDING.json、原R5C两份独立FINDINGS/REVIEW、原R5C SPEC和rev3私有合同/ADR，再读实际八路径。两审重叠意见按10根因组合并；不把作者旧“全部关闭”当事实。HEAD为历史1d348d4、dirty当前字节以start_sha为准。保护七文件不动；8既有源路径无新增源，OWN新n1n2-claude-060p5d-report.md明确授权。新429立即停止并报告，不自动重试/换provider/Codex接手。

## 实施责任与流程

你是唯一ClaudeCode源码writer；MAIN已完成两独立审查合并并核61/149输入与651捕获输入一致。普通工程设计由你落实，公共合同/路径不足先ask MAIN，不找用户重复裁决。先写直接反例，在未改生产的旧实现上记录真实红灯，再成组修复；不得把静态推演写成实际跑红。旧测试/失败/INCOMPLETE和R5A/R4B已通过子行为保留。若新测试需要修改原断言，解释旧断言不成立的真实合同，不删负例或提高超时保绿。每个命令第一次都经原recorder、唯一n1n2-claude-060p5d-*名字，不覆盖。运行时源冻结。

只允许RELEASE列6命令形式的type/pure/generate/check，禁止执行mixed生命周期文件。禁止真实C/N/fork/prctl/wait/signal、两pilotCLI、Host/HTTP/Chrome/Q2/媒体/全量/build/网络/下载/付费/J盘/凭据env/用户配置。Pythonunit仅mock内核边界，不fork。读取日志/文本/hash及本票编辑允许，不能把Node导入探针伪装文本检查。禁止git add/commit/reset/stash/checkout/push/merge/索引操作，不开新worker/窗口、不搬目录。超过现有八路径才能实现则先ask停止该越界部分。

## A. 两模式共享生命周期，启动不能当错误

normal在supervisor.start后等待同一原startPromise的自然结果；不会因为inspect尚未settled就发DRAW_NOT_SETTLED。保持完整owner registry和真正finally：正常/异常都等待原settlement和freshproof，但“继续持有等待”和“需要取消”必须分离。若cleanupRequired则同handle reconcile，不只await一个无法自行恢复的promise。正常推进中禁止凭未完成推失败，不设责任到期，不替换handle/promise或再spawn。

fault模式首先有界等待实际accepted N epoch，期间worker=null是启动状态，检查真实早失败/观察期限；然后匹配同root、同draw ticket_digest、同N的GO，最后同步fresh pid/startticks/ppid/pgid/sid及非Z/死态，与注入cancel间无await。期限只决定是否注入，不当作资源结束。任何真正错误仍走同ownerfinally清理，不得冒充预期故障。

新反例至少：normal初始pending+nullworker，后续C_HELLO/FORKED/N_HELLO/GO/result，等待期间cancel数0，结果精确1024x4a；fault初始nullworker后来HELLO/GO/live才注入，缺GO/早nativefailure/真正deadline不误注入。除忠实deferred stub外，必须有实际supervisor加ChildProcess/proc边界mock的编排对照，证明eventloop顺序真实可达；正常stub start同步settled不是充分证明。保持最终同步epoch防复用检查。

## B. 取消方法自身幂等，保首因和首次primary事实

实际requestCancel第一次接受primary时原Error对象和primary provenance不可变；同Error或不同后续cancel不能变成superseded_by_earlier_failure、不能覆盖原cause、不能重复CANCEL写入。若真的有更早native/transporterror，primary依然是旧错误而不是取消。可用有界secondary事实计数，不能无界追踪。工具finally避免不必要重复，但生产方法仍须独立证明幂等。

反例：实际supervisor在reserved和启动后未结算两种状态分别重复同Error/不同Error，证明原Error、primary标记、一次结算和不重复cancel消息；更早nativeerror的对照必须保留。再组合实际runner delayedcleanup进入finally，不能由stub与生产不同的else分支自证。

## C. 启动身份未绑定时真实gone可恢复

真实born child有issued ChildProcess PID事实；未AUTHORIZE，初始/proc未知且无verifiedC_HELLO，实际exit+close后对原PIDfresh读取：gone可收敛原失败；unknown持续held；known但无原epoch不能猜replacement。不能在epoch=null之前就永不查询。epoch已绑定时只有freshgone或真正不同epoch可证原generation结束，sameZ仍不是gone。已AUTHORIZE但无fork/domainproof仍hold。verifiedHELLO fallback保留。

用实际supervisor初始EIO、无HELLO/noAuthorize、lateexit+close、freshENOENT正例；freshknown/unbound、freshunknown、sameZ负例；授权后缺proof不释放。不得凭mock impossible close宣称真实kernel orphan；只证明合同判定逻辑。

## D. 撤销signal权限仍能证明原域结束

保原forkepoch+waitauthority rawdispatchguard不可逆，reap/ECHILD后不能rebind/瞄替代PID/group。撤销signal权限与收集终局证据分离：TargetSettlement不能因authority_lost永久跳过原targetcensus/reap/ECHILD/group/已知原epochfresh检查。保留已发生的真实N wait与原group义务；不能因current_group=0把原group不知改成gone。所有原义务真实终局后可失败结算；unknown/live继续hold。anchor_held/reaped输出按真实状态，不硬编码。

必须直接走实际_settle_domain→KernelSettlementOperations→raw OS-edge mocks：TERM结束N→waitpid实际消费N→ECHILD/group暂未知→欠KILL被权限拒绝→后续原target/group全部gone。断言postreap raw kill/killpg=0且同责任最终settled；replacement出现不能signal，原group未知不得被跳过。不能只是手设anchor_reaped再断言hold。原正常TERMignore要能在权限还真实拥有时KILL收敛，不能全部改永久held。

## E. 长期未知的库存有界

实际raw os.kill/killpg EPERM/refusal反复发生时不消费未投递债、不重置动作grace、不加责任超时。signals、events、receipt字段须有界；用固定首/近记录和明确饱和计数，不保每轮无限字符串。明确截断且不把它冒充完整成功proof。保原首错误；后续合法投递恢复仍可收敛。

反例须触及raw errno处理（不是patch上层signal函数）：多轮持责记录长度受固定上限约束，未投递状态正确；laterallowed能收敛，仍未知继续持有。

## F. 原settlement/清理失败与资格

保原settlement及原Error对象，新增有界可序列化cleanup事实；不能仅在timeline写cleanup.length。normal和fault均核rawcleanup以及终局diagnostic.cleanup_failures，任何非预期cleanup/transport/native/evidence/reporterror均不取得通过。fault另需同一精确原cancel确被primary接受、sameepoch injection、nullpicture及完整终局；任意error或exit1不叫通过。

直接反例：normal精确image但rawcleanup=[E]不绿；fault精确cancel+nullimage但rawcleanup=[E]不绿；rawcleanup空而最终cleanup_failures>0不绿。加实际supervisor目录清理fs-error边界对照，不把资源已消失等同清理过程无错误。

## G. 报告完成后才能提交最终资格

保留固定本地R4B工厂真实export及同实例默认Writable callback/errorlistener；不得再仿造dummy或复用nofork kill权限。等待必要报告callback后才将最终资格持久化。此前summary/outcome如保留必须显式candidate/not-authoritative；迟到EPIPE要在最终记录中fault_case_passed=false/reporting_failure有值，即使exit仍是1。后续不能再做会影响资格的必需报告却不撤销该记录。报告目的地失败不循环重试，不退出仍unknownowner。

由你提出并落实一个明确非循环产物协议：候选事实、报告结算、最终qualification与artifactmanifest的写入/引用顺序，明确哪个最终文件是准入权威。禁止selfhash循环；manifest排除自身/最终record自引用时明确列表，最终record由外层recorder/MAIN另核hash。任何必需read/list/hash/write失败必须显式不绿，不能当空/null正常。未生成有效最终记录/完整manifest则不接受；不能只凭expectedexit1与候选artifact签字。不要把底层error后“已写出的旧绿文件”仍称最终证据。

反例实际main+真实reviewedfactory+真实异步Writable：有效fault随后最终reportcallback+error EPIPE→最终文件明确不通过；还要在原settlement仍pending时触发error证明同ownerbarrier不丢，不仅postterminal normalcallbackstub。必需evidence写/读/hash故障同样拒绝；一次性root无旧文件，候选必须标记不能被下游误认。

## H. root与直接证据

createRoot抛EACCES且无root时绝不能writeEvidence('',...)，也不能fallbackcwd/临时另root；只走受控有界拒绝报告，无phantomsupervisor/handle，无仓库根summary/outcome。原root已分配但prepare失败是另一种有所有权失败，保留其证据。新反例assert无root时writeEvidence0调用且实际路径不能落W根。

现有diagnosticSnapshot允许新增Host-private有界只读terminal proof observations，必须从实际#proveDomainGone分支复制当时C/N/group/known-target原epochfresh结果与时间，不能在工具里事后硬造或只写terminal-proof=true。不暴露rawticket/FD/可变能力/绝对路径到公共DTO。不增加EnginePort方法或公共服务。

持久化原settlement/cleanup、有界最终观察、实际/参考图片分离、receipt summary/segment digest事实以及已存在必需产物hash。rawsegments没保存必须明说没有，不写全转录。hash清单在相关文件存在后生成，list/hashEIO应记录。最终qualification链见G，不循环自引用。与原R6完整wait/segment审计区分，本票只满足首个真实N门证据。

## 交付与复审

修复完成后按原六类命令做最终同源recorded捕获；generation仅改清单，其他捕获输入不变。现legacy explicitpin若C字节变了，仅在八路径内按新固定sha显式更新，混合生命周期文件仅typecheck不执行；不能动态selfpin。

OWN新报告逐N/O/NOTE→实际callsite→新增反例旧实现真实红capture→修复绿capture→限制；原7失败及R5B无exit的incomplete原样保留。本轮新增红/incomplete不得补造exit。列8最终sha/保护7/空index、资源无真实C/N及未执行范围、新CLI精确新pin（只列不跑）。未实际跑红的项诚实注明，不把静态评估写执行。交还使用本轮Orca注入task/dispatch，避免陈旧worker_done。

MAIN交还后按修改及关联不变量做独立复核；两安全门过才另票新pin实际N正常/故意失败。R6/R7/原17/ISO18/N1N2/NEXT及最终新commit独立验收不减。当前不进入下一接线，不签A/V1，不接管429。
