# R5G 私有结果事实契约与验收矩阵（实施前审查）

MAIN负责本轮完整结果契约，ClaudeCode随后仍是唯一实现者。当前PLAN_REVIEW_ONLY：不改W、不运行测试；不是新产品范围、不是公开API升级，仍为原八existing路径。R5F共享架构、全行哈希、原group/guard及digest闭环保持；剩下的是原R5E-O02的结果一致性，不重开kernel或R6/R7。R5F owner 702项输入已核验无漂移；startup审查实际account/read路由发现超时后进程回到shell，已精确guarded stop，NOT_REVIEWED而非PASS。

## 1. 信任顺序及一个事实投影

- 真实 run 所持有的 originalFailure / settlementFailure 对象与实际原 snapshot 是事实来源；JSON不能创造Error对象同一性或cause关系。
- 维持唯一 verifyPublishedRun，actual main/legacy/pure tests继续使用它。保留现有实际字节/hash/长度/原子发布/all-artifact校验。
- PositivePilotOutcome增加一个必需的内部 readonly diagnosticSnapshot: CacheDiagnosticSnapshot|null。runner返回当次终局已经取得并冻结的snapshot；不重新采样、不重建第二时间点、不暴露socket/handle/token、不另造持久权威。只在已允许tool与纯测试fixture中适配，不改Host/publicDTO/EnginePort。supervisor算法保持。
- 在工具既有文件建立一个私有、有界的结果事实投影及校验函数；用同一规范映射 actual outcome、candidate、final。已发表的各字段仍保留，不新增第二个可绕过它们的truth blob。对比明确字段值/形态，不用JSON.stringify(Error)（会丢name/message/cause），也不依赖不同字段顺序。
- 所有下表mandatory字段必须有自己的property；undefined/缺失、数组冒对象、字符串冒error均为协议不可靠3。显式null与合法record严格区分。不能把isRecord失败自动变null。

## 2. 逐字段规范（各项均需负向覆盖）

|行|事实/位置|存在与类型|一致性与接受门|
|---|---|---|---|
|F01|root/mode/kind/authoritative/protocol/internal exit/fault flags|使用现有v2合法集合；outcome.mode必须normal或assertion-failure；candidate authority=false、final/outcome发布authority=true才可信|三记录root/mode与outcome匹配；final.kind_of_run/exit/fault与outcome及publication匹配；非法组合或跨记录矛盾→3。有效ok/0/false只normal；fault-observed/1/true只fault；一致failed/1/false是ordinary，不accepted。|
|F02|candidate.original_failure、final.original_failure、outcome.originalFailure|null或合法bounded Error record，序列化record必须有name/string<=128、message/string<=1024、code/null或string<=64|canonical boundedError(actual original)与两记录逐项一致；缺失、错型或不相等→3；normal成功必须实际original===null。|
|F03|candidate.settlement_failure、final.settlement_failure、outcome.settlementFailure|同F02，显式null合法；未知actual异常按已有boundedError归一化|candidate/final必须匹配actual settlement的规范化事实。fault acceptance另需 actual settlement===actual original 或 settlement.cause===actual original；空对象、无关Error、同文案不同对象均不构成关系。合法wrapper-cause必须保留。|
|F04|candidate.cleanup_facts、final.cleanup_facts、outcome.cleanupFacts|必需array，每行合法bounded failure，沿现有producer上限；对比全部内容而非只length|三者规范化内容/顺序一致；任何跨记录不一致→3。可接受normal/fault需空数组。真实且一致的非空cleanup属于ordinary failure1，不accepted。|
|F05|candidate.terminal_proof、final.terminal_proof、outcome.terminalProof|必需boolean，不能null/string/缺失|三者一致。可接受两模式都须true，且actual snapshot终局证明非null/proven=true；candidate/final终局observations字段与actual snapshot.terminal_proof一致（存在、类型、有限时间、有界数组按已有私有类型）。只是同true不能替代原证明事实。这里不增加R6新的内核语义。|
|F06|candidate.expected_image、candidate.actual_image、final picture_*、outcome picture*|expected是既有1024/0x4a摘要常量；actual为显式null或sha256/bytes/is_the_exact_one合法record；final/outcome的sha/bytes显式null或fullsha/safe count，exact标志必需boolean|各实际图像事实一致；normal acceptance须现有精确常量且actual exact=true；fault acceptance须所有实际图像/bytes为null、exact=false。不接受只null hash但非null bytes，或candidate有图而final说无图。|
|F07|final.diagnostic_snapshot、outcome.diagnosticSnapshot|必需null或既有CacheDiagnosticSnapshot合法私有record；不可把错型当null|runner当前actual frozen snapshot是唯一基线。final snapshot的全部可序列化实际事实须与该基线一致；candidate已有receipt_summary/accumulator_summary/terminal_proof_observations也须与同一基线一致。校验result-critical已知字段的存在与类型，不能只deepEqual两份缺字段伪对象就通过。普通setup早失败可一致null；接受两模式必须非null。|
|F08|snapshot.cleanup_failures/cleanup_facts、transport_failure、latched_outcome|这些都是mandatory，明确null/合法record；cleanup count安全整数，failure数组有界；latched kind=none/candidate/failure，code/message/native_phase依现有类型必需nullable|normal acceptance必须无transport failure、latched.kind!=failure、raw与snapshot cleanup均无失败；fault acceptance无transport、latched.kind=failure且code=DRAW_CANCELLED。actual snapshot若有额外失败而final声称ok/fault-observed，是协议矛盾3；相同事实若producer也如实kind=failed/1则ordinary。|
|F09|snapshot.cancel_provenance|mandatory nullable；非null须具code/message/error_name/error_code/accepted_as_primary/superseded_by_earlier_failure，类型及长度遵现有CacheCancelProvenance|fault acceptance须实际原Error.code=EXPECTED_ASSERTION_FAILURE、cancel accepted=true/superseded=false，provenance.code遵producer现有DRAW_CANCELLED规范，error_name/error_code/message依现有截断规则绑定同一原Error。final snapshot必须等于actual snapshot；不能只看两个boolean。normal如有记录按actual一致保存，不凭空删事实。|
|F10|report/evidence/publication错误及所有manifest行|沿R5F已经闭环的必需字段与实际读取规则；错误null与缺失区分|任何mandatory I/O/parse/schema/field mismatch/hash/link/publish/report故障→unreliable3，保留root；普通业务failure不能被当evidencefailure或PASS。|

最终acceptance判定必须同时满足字节链有效+全表schema/一致性+mode语义。缺字段/错型/跨记录矛盾统一reliable=false/accepted=false/3；完整可靠但真实业务失败reliable=true/accepted=false/1；合法normal为true/true/0；确切fault为true/true/1。入参拒绝2保持。CLI只验内部协议；外层实际OS exit仍由recorder/MAIN核对。

对于ordinary failed，不能要求snapshot或Error必须是成功shape，否则会把本来合法的业务失败1偷换3；但实际存在的字段仍须类型合法且三方一致。未实现的unknown结果不伪装成功，当前producer不产出的kind组合按协议拒绝。某个更严格约束与实际producer冲突时，提出具体对应字段与样例给MAIN，不能用默认null或放宽谓词裁决。

## 3. 必须的实际实现反例矩阵

在原pure pilot测试文件参数化覆盖表F01..F10：每个适用mandatory字段至少删除、错类型、合法类型但跨记录不一致三类；可复用参数化用例但不能只挑顶层mode/link后声明全部。所有用例调用actual唯一checker；关键case通过actual main。

使用已守卫supervisor+真实临时FS、实际writeEvidence/publishEvidence委托：只在write candidate或publish final边缘复制并改一项字段，让真实mapper/hash/length/links自然对应真实坏字节。不得自造hash oracle或另写consumer副本。

- C01 candidate原error EIO、cleanup非空、缺settlement/terminal → main/checker 3，root留存。
- C02 final original/settlement删除或string/array/{} → 3；明确null不与缺失混淆。
- C03 normal final diagnostic EPIPE、latched failure（其余green）→3；actual outcome诊断基线不变，证明跨记录校验。
- C04 改actual outcome.cleanupFacts或图像bytes而记录不变→3；final/outcome kind/exit/fault冲突→3。
- C05 故障final settlement改无关EPIPE或{}→3；cancel error_code/name/message每个单改→3。
- C06 actual outcome original/settlement换成同文案不同对象、错cause；若与记录文本仍一致也绝不accepted。actual关系不满足而记录却声称fault-observed属于语义不可靠3，不是expected pass。
- C07 合法wrapper.cause===original控制可接受fault1；普通真实一致failure（正常及fault模式）仍可靠、不接受、1；producer阶段extra transport如实failed1也保留。
- C08 候选和final摘要/terminal observations合法hash但互相矛盾或错型→3；actual frozen snapshot重复读取不会变化。
- C09 normal0、精确fault1、参数拒绝2、mandatory read/publish EIO3正控继续全部通过；legacy保持薄调用，不执行混合kernel suite。
- C10 老5s超时仅记真实失败。20s当前是harness预算调整，根因未证实；禁止报告为“机器繁忙已证实”。不为求绿继续加预算，不改生产deadline/断言。若再挂住，保留阶段信息/handle，按实际状态诊断而非timeout包裹recorder。该问题不能冒充内核活性证明。

首跑全部recorded；新增反例在旧逻辑的安全红灯可使用依赖边缘与实际旧checker证明，不恢复危险guard版本，不需要实际C/N。当前保持原八路径与六种录制轻量命令，保护七文件/旧证据/Git索引保持；本文件未发实现许可，须独立文档复核后MAIN发正式RELEASE。

## 4. 剩余流程与停止边界

先由独立owner审本契约和测试矩阵能否完整覆盖已知R5F-O01/O02及同类缺失/错型/矛盾；补齐文档后一次发Claude完整实现+自验证票，不要求每小例等审批。再对最终精确字节受影响复核；通过后另票最小真实normal/fault N，再R6/R7/R8原17+ISO18与新冻结外审，重锚NEXT开工包后停止。任何新429立即停、保全，不自动重试/切换/接手。更早失败与NOT_RUN不擦除，不能宣称N1N2或V1完成。
