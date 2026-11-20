# R5D positive-owner 独立静态复验

**REQUEST_CHANGES：4 MAJOR。** 不签 `STATIC_SAFE_FOR_EXACT_N_NORMAL_AND_ASSERTION_FAILURE`，本报告不授权运行、不签kernel/N1N2/业务PASS，也不是最终R8提交外审。

候选绑定 **msg_1747b61422de / task_e1899cd17d6a / ctx_4a9291435449**，历史HEAD **1d348d419120f23f45d958112ea8c43df5a04675**不冒充新Gitfreeze。起始核snapshot的8源、7保护、报告摘要一致，所读输入末尾再次核对；完整SHA与范围见 INPUTS.json。reviewer未运行测试、CLI、目标模块或任何真实C/N/内核实验；文本/hash工具确实执行过，不称零进程。

## 本轮最小阻塞

**R5D-O01 — artifact hash失败仍可给绿final。** 真实artifactFacts在文件hash失败时把错误放入单条artifact.error、digest=null，但顶层error仍null；1294的judge只看顶层facts.error。1316–1317在判定之后求candidate/manifest链接hash，null也不回写失败。实际正常case因此可以exit0、final.authoritative=true而manifest不完整；故障case同样可留下通过标志。严格外层验链能拒绝，不能替代生产者自己的失败资格。需逐项验证必需artifact、摘要及链接hash，再统一判定；现有测试仅覆盖目录listing error，不覆盖单条文件hash或最终链接hash失败。

**R5D-O02 — final写失败后的内存结果与实际consumer不一致。** 1321失败被writeEvidence捕获后，authoritative=false，但1325–1327照抄此前kind/exit/faultCasePassed。main会检查authoritative，然而legacy positive case直接调用runPositivePilot，只断言kind/exit/image/terminal，未核authoritative、final/manifest/candidate链；所以final根本没有生成也可能通过该consumer。expected-fault main的拒绝仍是1，不能独立当作预期故障通过。直接写authoritative:true的final还存在“完整字节已写出、随后write/close报错”的模糊提交窗口：不得留下可被接受的绿final而只在内存记失败。最小修法是失败后撤销返回资格、分阶段发布final、更新所有直接消费者并要求外层联合验链，不能只改报告解释“final或退出码”。

**R5D-O03 — 当前pure test有可达真实process.kill。** identity1151的case伪造pid4242/C_HELLO与匹配/proc，等waitUntilHeld后才发exit/close。真实supervisor在缺FORKED的失败清理窗口进入3037的terminate；3055用伪造/proc核验通过后会执行真实process.kill(4242,SIGTERM)。测试只mock spawn/fs，无process.kill拦截。若该号码属于真实peer便可能触达它。这里是**当前源码的可达反例**，不声称本审查重跑过或证明历史Node信号效果。Python事故class虽补了kill mock，_FakeOs.__getattr__仍可把未脚本化的危险调用透传real os。先补默认拒绝/显式脚本化的OS边界与调用账本，断言任何未登记调用在副作用前失败；仅throw却被生产catch吞掉不够。不要重跑事故或用固定PID发送信号调查。

**R5D-O04 — revoked signal permission仍消除了原group证明义务。** C的_settle_domain2131仍在signal_authority!='revoked'时才传入原group；revoked后新TargetSettlement收到false/0，948直接把group设为gone，跳过原group_state。取消了“权限丢失立即return”是改进，但尚未真正保住原group义务。直接反例应把原N实际fake waitpid消费、权限撤销后“proc census已空”与“raw原group probe EIO”分开：现在可能无需raw组证明就ok。现有测试把两种unknown用同一开关控制，无法反证此分支。需将不可变原domain/group取证义务与破坏性信号权限分开；仍不能信号替代进程。Host可能另外拒绝，不等于C可以提前签group_esrch或退出。这是本票SPEC D的原N04，不是新增R6全量要求。

具体位置、可达前提、合同、最小修正和直接反例见 FINDINGS.json。以上未执行旧代码变异或新的故障实验，不称新发现有captured old failure。

## R5C-O01..O07逐条

|原项|本轮状态|实际证据与边界|
|---|---|---|
|O01 normal pending自取消|CLOSED_STATIC|continueToTerminal仅真实originalFailure且未cancel才发取消，normal自然跟随原promise；有actual supervisor+mock child/proc异步对照。|
|O02 fault初始无HELLO早拒绝|CLOSED_STATIC|waitForAcceptedWorker等待null→accepted，之后boundGO、最后同步full tuple/live guard。早失败/期限拒绝仍进原finally。|
|O03重复cancel覆写primary|CLOSED_STATIC|首次provenance保留，secondary有界，消息cancelSent只写一次；实际reserved/started分支断言已核。|
|O04 cleanup只计数|CLOSED_STATIC|原settlement回收cleanupFacts，normal/fault同时核raw及最终snapshot.cleanup_failures；直接反例保留。|
|O05 late报告/最终资格|STILL_OPEN|真实factory+同实例Writable/callback接线与report-before-final已改；hash/read与final publication/consumer仍D01/D02。|
|O06无root写W根|CLOSED_STATIC|entry.root=null时不writeEvidence，无cwd替代；allocate失败与prepare失败两支有区分。|
|O07直接观察/hash证据|STILL_OPEN|实际#proveDomainGone就地记录C/N/group/known-target及time/truncation，raw_segments_saved=false诚实；非循环引用方向已设计，但完整hash/失败发布与consumer仍D01/D02。|

“CLOSED_STATIC”仅指定源码分支关闭，真实C/N与内核结论均NOT_RUN。revoked原组证明缺口D04不能被上述owner表关闭。R5A C01/C03、R4B真实factory、原epoch不可逆signal guard等已通过子行为不因本审查重新全量展开。

## 实际测试质量与实施期事实

完整读取实际工具编排、新产物协议、相关supervisor/custodian与测试调用，而非只读diff或报告计数。新增FakeCustodian遵循C_HELLO(seq1)→AUTHORIZE→FORKED(seq2)→异步N_HELLO→GO；GO摘要从真实ticket计算，silent不回picture，close时C和N都从fake proc去除。realDeps使用Date.now/setTimeout让出macrotask，未为测试放宽生产身份/收据门。actual supervisor组合说明43门比旧同步stub更有意义，仍然不是目标kernel执行。

真实Writable测试确实使用reviewed factory、callback/error route；pending case在20ms error时原settlement仍未结束，同owner继续并后续reconcile。然而RealDestination._write直接调用callback，不能把这个类本身称为“延迟callback”证明；另有callback-only setTimeout测试。当前缺单文件hash/链接hash失败、final写入失败与legacy验链负例。特别是hash测试deps给非custodian文件固定摘要，typeofstring断言不能证明实际序列化字节链一致。

已读取MAIN_ZOMBIE、RED_FIXTURE_CAUSALITY、PRE_HANDOFF、ACTUAL_SUPERVISOR_FIXTURE_ORDER、MICROTASK_STARVATION等记录。004的真实hung mockworker由MAIN确切pid/start/pidfd收口，实际recorder exit1不是自然业务失败；005外层timeout终止recorder，缺exit/result保持INCOMPLETE，不用外层状态伪造子测试exit。红Python最初fixture未触达TERM→N wait消费不能叫语义红；后续003/004语义红与最初记录区分保存。

**历史raw signal事故是范围越界，不能称纯mock/合规runtime。** 作者承认red-python-002到达real os.kill(200,SIGTERM)，并称ESRCH；本报告保留该声明，不用事后PID不存在证明历史无影响，不制造PID/exit/效果日志。报告§0/5/6的“没有真实signal”须以此明确例外纠正；MAIN合法pidfd清理004也是实际信号操作，角色/授权与开发试跑越界应区分。当前TS可达raw call是新的静态风险，不冒充已捕获的历史事故；应先堵边界再重跑获授权pure gates。

六份最终capture由MAIN核同源651/保护7；本审查读取实际cmd/result/log并复验log SHA与所读源摘要。final generate是幂等重复，final-generate-001的实际delta仅manifest。84/54/43只证明所存type/mock结果，绝不抵消漏mock或新反例，也不签CLI已运行。

## 下一门与产物联合规则

当前C pin **30583caab4024b3e4131183e19d60635b1711735892640c5dc7d7e0db34c34f2**、fixture pin **e3f4ccb1c4016a54356ce04be344b4ffff23f2f88698efe191570ad8407d03ab**仅绑定本候选；本次不批准两CLI。修上述最小阻塞后需新摘要/静态复核，再由MAIN具名释放normal与assertion-failure逐case；不要求先补R6/R7全工程。

预期故障exit1独立不能证明通过：必须一起核有效已发布final、完整manifest实际hash、candidate/raw原结果与cleanup、真实fresh observations/time/truncation、原同issued cancel cause、同epoch GO/live/null image、报告结算与外层状态。normal应exact1024×0x4a及exit0；这只是synthetic protocol，不是JPEG/视频。final排除自hash可由外层核，但不能借此跳过其它必需摘要或接受未成功发布的final。rawsegments未存的限制保留，不冒称全转录。

package ESM/tsx及固定local reporting import/entry guard仅静态核对，未执行CLI；不以tsc代tsx运行证据。当前源码/报告属于dirty handback，非新Gitfreeze。结束所读输入hash重验一致；只新增本指定目录REVIEW/FINDINGS/INPUTS。所有reviewer业务runtime与真实Npilot、Host/HTTP/probe/media/Chrome/全量、原17/ISO18/N1N2/NEXT及R6/R7保持NOT_RUN或OPEN，不伪造验收。
