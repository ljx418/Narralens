# R6 当前源码事实核对与合并实施设计输入

结论：**CURRENT_SOURCE_GAPS_CONFIRMED_FOR_MAIN_CONSOLIDATED_R6_PLAN**。四项均“部分已实现，仍需实现＋直接测试＋另票真实运行”，不是旧R3问题全盘未修，也不能全部关闭。这里交付MAIN可制定精确release的设计输入，不是实现release或运行许可。C06/C07/C08保留MAJOR；C09是后续场景准入MINOR，受保护fixture本票不放行。

本审未参与实现，仅只读文本、metadata、摘要和已有证据。全部本审tests/产品CLI/C/N/kernel/Host/media/Chrome/network **NOT_RUN**；只运行文本/hash/只读Git工具。历史HEAD为1d348d419120f23f45d958112ea8c43df5a04675，branch agent-driven/main-a-integration，index无staged路径；工作树仍有用户AGENTS与大量既有dirty/untracked，未要求clean、更未覆盖。当前651/source8/protected7匹配R5I绑定；725份实际读取/摘要输入首尾一致，详见INPUTS.json。651只是hash-read，不冒称651逐行语义审查。

## 已接受最小基线及证据边界

R5I REVIEW摘要b15539f34cb58093c07002d800b02e665b09230168aad3b3a222e8f31cf54156与本次pilot INPUT_BINDING一致。当前supervisor=c697636065d6f9c88c806f23eb5cd75d88c1bd9b70ea61b385da41382ff7b755；C=bd06d7d7f79d6d2ccf2204a4e27ed5aba5364cbcda71785a67ac3ab887306b79；manifest=c39d7e47d67f7d19a0fb9303271c4e3ad6e06dbe1c3dbc375107e8d88dba071a；tool=e4db3499f715d5b6b5634568677a6688cf80a897c9321c45e93cda98c6a19ebb；protected fixture=e3f4ccb1c4016a54356ce04be344b4ffff23f2f88698efe191570ad8407d03ab。

normal002原capture outer0、日志摘要2b21a7cb5c7b1032bb8085d60743fdbfd5966c88affed59e076343757be91cad；root run-eLLk2O。normal原observer在产品结束后因snap未定义NameError退出1，FAILED_ACCEPTANCE保留；独立补验同一root，无重跑产品。C/N实际出生观测及新鲜消失、原组ESRCH来自保存的MAIN观察，而非本审新探针。normal记录1024字节0x4a合成buffer的精确摘要d592c3cbaf5d17852d9cff7fd0002db9a336e3d41acee2456689b86b5521b238；不是JPEG/视频。

fault001 outer1、日志摘要c3725312344e2d448c0b5d000c6204cd2670dd18ff70f4509ae9332be5fa859f；root run-wHALdm。原错误/settlement为同一指定EXPECTED_ASSERTION_FAILURE的序列化事实，cancel accepted_as_primary=true且无secondary，null picture、空cleanup/transport/report/evidence失败、真实C/N终局；MAIN已接受。JSON不能重建JS对象identity/cause，那个检查来自已审CLI；任意business failure1绝不能代替。

本审独立重算两capture的inputs均等于当前651、保存日志摘要、candidate/manifest在final的实际bytes/hash链接、manifest四artifact的digest/bytes/error、镜像与原root六文件逐字节相等。未再执行产品checker。两份candidate均raw_segments_saved=false：新鲜出生/终局、counts/digests不是原始wait/segment/control录制，不能关闭C06语义或C09收养。normal001仍是历史失败；MAIN_EVIDENCE_BOUNDARY_CORRECTION的双通道因果限制继续适用。旧os.kill越界/004停止/005 INCOMPLETE/旧mock5s与20s失败不抹去，也不推定事故无影响。

## 当前真实调用图

1. created-native-workspace.ts:981 produceFrame内registered.bridge.draw → openfilm-upstream.ts:1704 bridge.draw；beginDraw、issued.pageFrame；后续freezeAdmission/drain/endDraw与workspace PRE/POST/tree/scope仍属原owner，R6不能让execution证明直接代签这些阶段。
2. openfilm-upstream.ts:617 pageFrame同步登记责任 → scope → :662真实CacheProcessSupervisor → reserve → :691 await同一start；settlement.error优先返回，direct phase lease/parent drain保持现有责任。私有bridge reconcile :1698调用原supervisor的同一handle。R7问题不在本票重写。
3. supervisor #run实际spawn C，pumpControl :2333 → cacheInterpretControlMessage :915 → CacheReceiptAccumulator.take :771；segments在此累积且不进入普通queue；DOMAIN_REAPED进入同一facts。#proveDomainGone :2936在实际C exit/close后调用validateCacheDomainReceipt :1029并补fresh epoch/group/known-target观察；#receiptEligibility :2851调用validateCacheExecutionReceipt :1180；run与reconcile共享该domain判定。
4. Python Custodian.run → _run_loop :2304 → _settle_domain :2085 → TargetSettlement.run :857 → KernelSettlementOperations →实际proc/信号/wait边界；unknown → _recover :2333/_wait_for_recovery :2406 →同一settlement/actions；确实终局后_receipt_items :2466/_send_receipt :2536/flush → C exit。C唯一wait owner与原epoch不可逆撤权不变。
5. tools/native-cache-normal-pilot.ts →实际supervisor；publication-v2 →唯一verifyPublishedRun →main与legacy lifecycle共同消费者。R6若新增receipt语义/诊断字段，须同步真实diagnosticSnapshot/summary映射和必要验收字段，不另造第二权威checker。

## 四项事实矩阵

|原ID|ALREADY_IMPLEMENTED_STATIC|仍缺实现/直接测试|真实运行缺口|
|---|---|---|---|
|C06|global seq、segment顺序/digest/items4096/identity512、重复PID拒绝；summary binding/full C/N epoch；snapshot copy；failed-exec的N终态wait与creative拒绝分离|每segment protocol/draw/ticket绑定、bounded count/终端阶段；成功exec实际N恰一次且最后、终态status、wait-epoch/category对应；producer identity仅pid/ticks，wait仅pid/status，需共同扩展|两baseline仅一个N，无adopted/parent-reaped/N-last完整直接记录|
|C07|RUNNING按每stream/每round64KiB读；每stream全量64KiB/尾8KiB；已发现洪水latch；Host侧C stdout/stderr全期handler；真实writer.fd可写等待|settlement/recovery/final drain连续同一账本、EOF/EIO事实、公平servicing与EOF unregister；真实late channel-error回调覆盖|无late TERM输出/实际背压/断管场景证据|
|C08|bounded retained event256/identity512、sticky flag、signal饱和失败；diagnostics_lost可domain终局但不得creative；unknown不设责任expiry|identity overflow永久挡_known_targets_gone；event truncation C可exit而Host永久挡domain；两种overflow首次未锁存预算失败并立即cleanup；wait/receipt列表需有界终局策略|无真实overflow压力终局/unknown对照|
|C09|child写独立events-file、不继承坏pipe，真实引用timer；normal/silent owner与最小正反基线已接受|child ready→N离开→C收养→TERM后同epoch活→KILL→adopted wait→N-last屏障；当前fixture立即return/exit|没有该链实际可达证据；Chrome lineage更未执行|

### C06的最小反例与修复边界

当前take不查segment.protocol/draw_id/ticket_digest；pump也在检查这些字段前直接解释segment。将真实形状成功receipt的一个wait改成PID999/status.kind=unknown，identity改成错误ticks，同时重算各digest/count，保留正确summary epoch与gone事实：成功exec分支只要求waits>=1，静态可满足domain与execution。N-before-adopted、重复N或无N同理。这是private fault seam，不是公共HTTP可伪造权限断言。

已有tests/cache-process-identity.test.ts:524..850真实调用accumulator/validator，覆盖顺序、摘要、重复identity、failed exec与diagnostics分类；其segment helper本来就不带draw/ticket/protocol，不能当绑定语义已通过。failed-exec修复保留：当前exec未成功通常不会生成adopted树，不能把“failed exec前先有256后代”虚构成实际生产触发。扩展成功语义时，应专门跟踪N终态与有界epoch状态，不能沿用静默256条wait_facts截断作为完整proof。

MAIN需先锁定私有字段：完整原epoch/当前收养parent observation/terminal wait类别与parent-reaped类别。parent-reaped后代没有C自己的wait是合法可能，需分类为确实观察该epoch消失，不能虚构C wait；只报wait count也不够。按epoch而非仅PID去重，N恰一次/N-last、摘要段终结和failed exec/无birth分支共同设计。_echild :2049在N之后发现并wait意外child时，不能静默仍称N-last；应显式失败/证明分类，仍保留真实清理。

### C07/C08共同根因

_drain_worker_streams :1405只在_run_loop调用，OSError与EOF均break而未记失败/EOF；KernelSettlementOperations.sleep :1027是time.sleep，_reap_worker也纯sleep。recovery忽略stdout/stderr selector key，无最终drain即发receipt。因此TERM handler的late数据可能漏算；反复readable EOF还能使recovery select立即返回，叠加持续不收敛proof形成忙循环。Host正在统计的是C标准流，不能补N->C pipe漏读。

_record_target :1459到513后sticky overflow，_known_targets_gone :2066无条件false，即使actual waits/ECHILD/原group ESRCH/保留epoch消失也永久held。event超过256：发送保留events但summary仍全链digest/count，Host :1058拒绝truncation；C可能已exit，原Host continuation再无完整新receipt可取。不能简单删除Host检查或清flag。两端需共同增加**仅失败终局**的有界证明形式：永久不可creative，原预算错误latch并主动cleanup；只在独立真实kernel/wait/stream终局足够时结算。缺失关键归属/原group/epoch事实仍unknown。不能只凭ECHILD/空census或新超时断言树已结束。

建议统一OwnedStreamLedger保存每路累计count、tail、EOF、read-error；各阶段以bounded round轮询，不饿死control/reap，EOF注销。每路64KiB、尾8KiB、既有TERM/KILL/queue预算不变。raw tree证明、diagnostic完整性、creative eligibility分别判；EIO可使业务失败但不能跳出sole owner主循环丢活资源。overflow终局证书需MAIN先选定具体义务和private kind，不让Claude自行移除原门。全量wait/event采用streaming digest/counters及有界必需状态，不能先积攒无界list再分段。

### C09及protected fixture的最小待授权范围

fixture :236的child handler异步安装；:322 ignore-term-adopted立即return，末尾process.exit，EOF可先引发cleanup。已有child-alive只含pid/ppid，不含完整epoch；仅靠events顺序/睡眠不是同epoch TERM-survival。

本票fixture保持原SHA。另票至少需：owned ready ack（per-run pipe/file，不含真实ticket）；完整child epoch与当前PPID；ready确认后才允许N退出；C-side确实观察收养在TERM之前，TERM handler记录后仍同epoch活，再实际KILL/wait，N最后。当前TargetSettlement在首次census前发TERM，故只加child-ready还不足以证明“收养→TERM”的顺序；MAIN应选定最小pre-signal观测/明确测试屏障，不以拉长grace或公共hook兜底。未ready/过早exit/未收养都须场景失败且同一owner清理。现有Python抽象ops顺序测试、lifecycle的nofork+normal两case不能代替这条链。

## 一次合并实施的建议依赖顺序

1. **MAIN锁合同再release**：确定epoch/wait/category成功完整transcript与overflow失败terminal证书、stream EOF/EIO归类，列明确字段/有界状态/缺失即unknown条件；不扩PID/group权限，不改变public pageFrame/close/EnginePort，不放行fixture。
2. **同步producer和消费者**：Python Custodian/KernelSettlementOperations/TargetSettlement、TS accumulator/control state/domain validator/eligibility/proof与reconcile同批改。先有底层stream及bounded semantic ledger，再接最终receipt；不先让Host接受新字段却仍发旧证明。
3. **实际分支直接mock**：Python guarded raw edges＋真实Custodian/KernelSettlementOperations/recovery/flush，TS actual pump＋validator＋原promise；正向单N/adopted/parent-reaped、failed exec/no-birth、late output/EIO/EOF、overflow all-ended与unknown保留对照；state inspect不破坏、原cause/oneCANCEL/lateN/replacementPID/protected-no-root原回归一起保留。旧mock未决promise/timer必须显式所有权与teardown断言，不能以timeout扩到20秒声称根因关闭。
4. **publication受影响映射**：新summary字段若进入snapshot/publication，修改唯一真实mapper/checker与参数化负向；保留完整mandatory-null/error/hash链，不重新拆出copy consumer。
5. **独立静态核对和精确新pin**：最小production集合是cache-process-custodian.py、cache-process-supervisor.ts、cache-worker-integrity.json；直接tests为cache-custodian-unit.py、cache-process-identity.test.ts、native-cache-normal-pilot.test.ts（仅真实接缝所需）；normal-pilot.ts和lifecycle文件仅在新摘要/新C pin/实际消费者需要时列入release。不必为此改workspace/upstream算法或R7资源owner。
6. **另票真实运行**：新C改变后先固定新pin的正常/指定失败对照，再小规模late-stream/backpressure/unknown恢复，最后overflow/TERM-adopted。C09若不能由现有fixture证，明确单列fixture/场景文件/recorder输入的新授权，不挪用受保护旧pin。每个真实case保存有界原始segment/wait或足够直接日志、完整epoch/动作/终局、raw输出hash、old/new inputs与原始失败；不能只存counts/digests却签C06。Chrome/Q2、peer、真实源/父FD及原17/ISO18全部按原台账仍待后续精确票，非本审补签。

建议最小范围与上述顺序是设计输入；作者/MAIN下一步仍须精确ReleaseAssignment与唯一writer/heavy-slot交接。本审不向Claude下实施命令。R6/R7/R8、原17/ISO18/N1N2、新冻结commit、NEXT/V1保持未接受。
