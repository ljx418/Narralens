# R5E positive-owner 独立静态复审

**REQUEST_CHANGES：2 MAJOR、1 MINOR。** 本次不签 SAFE_FOR_SEPARATELY_PINNED_MINIMAL_N_PILOT，不授予运行许可，不代签 N1N2、R6/R7/R8、原17/ISO18、NEXT 或 V1。

候选是 INPUT_SNAPSHOT 绑定的当前 dirty 字节；历史 HEAD `1d348d419120f23f45d958112ea8c43df5a04675`不是新冻结提交。工具 SHA256 为 `80f3a68f7c5b828d69a6c00140a98efca1bfb1114387cfd6997647ffe0b0dfe8`，C 为 `bd06d7d7f79d6d2ccf2204a4e27ed5aba5364cbcda71785a67ac3ab887306b79`，报告为 `a0e9ca00d0406f42ee5b78235fa2bd8be5499d4152a2c5440164e7e0be1a8200`。source8、protected7、报告均匹配；另逐字节 hash 核对全部 recorded651，与六份最终 capture 输入一致。所有705份读取或摘要核对输入在结束时重验；详细路径、开始/结束完整 SHA256 和边界见 INPUTS.json。651的摘要核对不冒称651文件均逐行语义审计。

## 必须先关闭的最小缺口

**R5E-O01：manifest 仍能带显式读取错误而判绿。** `tools/native-cache-normal-pilot.ts:169`收集了所有行，但170只遍历 candidate/helper 两个名字。真实 artifactFacts:518 对 events/scenario 等文件的 EIO 写出 digest=null/error=EIO，顶层 error 仍为 null；这些行随后被忽略，judge 仍可给正常0或预期故障1及 authority=true。例如 fault 已从 events 读到同 root GO，收尾时再读该文件发生 EIO，就可走此路径。它不需要恶意 native，不声称已运行此故障。应检查所有被发布行的 full SHA/error/名称和字节数，另外要求两个必需名；若真要把某类文件设为可选，应由合同明确排除，不能把有错误的行放入“完整”manifest 后忽略。该问题延续 R5D-N02/O01。

**R5E-O02：所谓共享联合校验没有实际共享，也没有完整验链。** 工具1696的 jointQualification 只查返回资格、协议、内部 exit 相等和 hash 非 null；它根本不读实际 final/manifest/candidate，也不校验 JSON、字节数或链接。普通 failed/1 还会得到 accepted:true；普通业务失败返回1本身允许，但它不能被当成 expected-fault acceptance。legacy lifecycle:227另有一份较完整函数，读三个 JSON 的 hash，却不读/核 helper 实际文件，仅要求 helper digest 是 string，并同样忽略其他行错误。因此 helper 丢失/不可读及O01的坏证据不能由这条消费者闭环。它的 finally:394确实用该判断决定证据根可否删除。

可执行 pilot 测试668的 consumerAccepts 是**第三份**简化实现；1470的“consumer拒绝”测试调用这份副本，并未调用真实 legacy 函数或工具 jointQualification。没有运行混合 lifecycle 文件是正确权限边界，但不能把另一份相似函数的绿灯当作实际消费者覆盖。最小修法是在既有允许文件中保留一个内部 byte/protocol checker，让 actual main、legacy 和纯测试调用它，校验实际字节/hash/长度/链接、行错误及 mode/outcome；所有 mandatory read/parse 不可靠都拒绝并给3。CLI不能自证未来的 OS exit；外层 recorder/acceptor 必须另核真实退出状态，不能把内存 exit 字段称为外层退出证据。无需重写无关 workspace 或扩大到 R6/R7。

FINDINGS.json 给出可达调用链、合同、最小修法和待执行的安全反例设计：真实临时文件系统配合已守卫 supervisor/mock，在 artifact scan 注入单文件EIO；发布后让必需读取失败/内容或链接损坏；实际 checker 必须拒绝，正常0与精确 fault1保持；ordinary failed1、额外错误 fault1均不可接受。以上是静态设计，未运行、未变异旧源码，不称 captured old-code failure。

## 已修正与逐旧项处置

|旧项|处置|本次实际依据|
|---|---|---|
|R5D-N01/O04|CLOSED_STATIC|C:2130由不可变 original_worker_epoch保留原PGID证明义务，不再以 revoked 为条件；实际 _settle_domain→KernelSettlementOperations raw-edge反例2018分离空census与probe_unknown，断言原PGID被探测、无非零信号，后来ESRCH才收敛。|
|R5D-N04/O03、NOTE01|CLOSED_STATIC|TS持续 process.kill 默认拒绝、child_process mock/拒绝及独立deny ledger；Python全局OS/ctypes/signal守卫与FakeOs危险入口拒绝。原可达伪C identity路径不会透传真实kill。只关闭已审路径，不保证任意未来新增API。|
|R5D-N02/O01|STILL_OPEN|必需名缺失、必需行error/null、candidate链接错、判定前读链接已修；其余发布行错误仍O01。|
|R5D-N03/O02|STILL_OPEN|同root独占wx临时文件→完整write→close→rename已存在；不确定发布返回failed/faultfalse/authorityfalse/exit3且不覆写坏final已修。实际联合消费者残余仍O02。|
|R5D-NOTE02|STILL_OPEN / MINOR|现有digest仍未复制；见下。|
|R5D-NOTE03|披露CLOSED_STATIC|当前报告承认历史真实syscall及未知影响，004/005边界保留；不代表事故追溯已解决。|

R5C-O01/O02/O03/O04/O06保持CLOSED_STATIC：normal仅跟同一原startPromise自然结果；真正失败才cancel；fault等待accepted N、同root GO和最后无await全tuple/live核验后注入；原始Error/首次primary与one-shot CANCEL保留；两资格都查原settlement cleanup与最终diagnostic；无root不写cwd。R5C-O05/O07受上述证据缺口影响仍未全闭环。

真实 reviewed R4B reporting factory仍由固定本地动态import复用，main/runner使用同实例；callback/error路径与pending owner测试保留。harness现在保存序列化 Buffer，避免可变对象后续变化伪装已落盘事实。actual supervisor+mock ChildProcess/proc组合遵循C_HELLO→FORKED→异步N_HELLO→GO，ticket digest来自真实GO，silent无picture，最终fake C/N epoch都gone，时钟让出macrotask。它们有意义，但不是当前真实C/N内核证据。RealDestination本身_write仍同步callback；另有异步callback用例，不能混称全部为延迟真实Writable证明。

## NOTE02与捕获边界

**R5E-O03 / MINOR：报告§6仍没有实际digest字符串。** supervisor:803已算 events_digest/waits_digest/identities_digest；1913、1954的私有summary丢弃它们。报告162坦承只有计数/标志，却164宣称满足原NOTE02，未满足SPEC B4。应复制已验证的有界字符串并引用实际值；raw_segments_saved=false必须保留。不要求保存旧raw segments或R6全量重放，不伪造任何摘要。

六份最终 cmd/claim/inputs/result/exit/log 实际读取与hash核对：输入均651且等于 snapshot.recorded651、日志hash均吻合、exit均0、source_changed均空。日志记录 identity86、Python59、pilot54，以及typecheck与integrity门；这些是作者已捕获结果，本审查未重跑。final generate为幂等重复，不冒称首次变异捕获。绿色计数不能代替O01/O02的未覆盖反例。

保留真实 os.kill(200,SIGTERM)越界事件及作者ESRCH声明；事后PID不存在不能证明当时无影响。本审查未复跑该实验。004是MAIN精确停止卡住测试，不能当自然语义红；005缺exit/result仍INCOMPLETE。旧失败均保留，fixture/接口未到目标分支的旧红不能自动称为语义旧逻辑失败；没有补造PID、exit或日志。

## 下一门

当前C pin为上述bd06…，fixture pin为 `e3f4ccb1c4016a54356ce04be344b4ffff23f2f88698efe191570ad8407d03ab`，不是已跑新C/N的证明。先修本票最小两项MAJOR并复核新字节，之后才由MAIN另票逐case释放两CLI。normal必须exact1024×0x4a synthetic数据；fault必须同issued原cancel原因、同epoch GO/live、null picture、无额外错误和完整终局。两者均须实际final/manifest/candidate/必需artifact字节与hash、原结果/cleanup/freshfacts、报告结算、协议和真实外层exit联合成立。任意exit1永远不等于预期故障通过。

本票只进行了文本、摘要和静态逻辑审查，仅写本指定三份文件。reviewer测试/产品导入/CLI/C/N/fork/signal/wait/prctl/Host/HTTP/probe/media/Chrome/network全部NOT_RUN；未修改W、Git、var、配置、旧报告或capture。原17/ISO18与未来阶段保持OPEN/NOT_RUN，非冻结提交外审或业务验收。
