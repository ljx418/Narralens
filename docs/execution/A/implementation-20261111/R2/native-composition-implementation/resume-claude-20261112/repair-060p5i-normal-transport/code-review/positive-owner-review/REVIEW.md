# R5I normal transport 顺序修复独立复审

**SAFE_FOR_SEPARATELY_PINNED_NORMAL002_AND_FAULT。** 未发现本次最小源修改引入的生产安全阻塞；仅建议MAIN另票当前pin的normal002，**独立接受normal002后才可再另票fault**。本报告不授予runtime，不把normal001改成PASS，也不签N1N2、R6/R7/R8、原17/ISO18、冻结/NEXT/V1。

当前dirty候选无新接受commit；历史HEAD仍1d348d419120f23f45d958112ea8c43df5a04675。733份实际读取/摘要文件start/end/current相等，source8/protected7/report及六最终capture的651输入匹配，详见INPUTS.json。651仅作byte/hash绑定，非651逐行审计。源码tool与R5H完全同摘要，已审checker不再重开全表；原C/guard/identity/生命周期算法按不变字节核对。

## 实际修改及回调可达性

onDrawEnd2388仍先用drawClosed去重，再调用cacheDrawEndFailure(finalizeAfterOk)。未授权EOF仍锁存DRAW_EOF_BEFORE_FINALIZE，并调用原one-shot owned CANCEL。已授权FINALIZE之后，只有新增的 `if (failure !== null)` 将额外CANCEL挡住，不屏蔽任何draw/control error或child error。

**源差分有独立byte证据**：仅在内存中把当前新增说明及if块还原为原无条件requestCustodianCancel，再hash整份文本，精确得到R5H supervisor `7706449e8f259a6e17e9ca2a40af8a5c344cef827a01c7881fc04a4a570b9b63`。未写回文件、未执行模块。实际生产源因此只增加该条件与注释；其余处理字节可由此核对，而非仅信OWN“没改”叙述。

actual supervisor + protocol fake的两例均触达注册的真实onDrawEnd：

- 已授权例3530：先await正常run返回，再对同一draw emitter发end，实际control.written严格断言AUTHORIZE_FORK/FINALIZE两条、没有CANCEL，同时检查ok、exact图像与terminal proof。它验证的是**已结算后的EOF回调行为**，并非完整重放FINALIZE在途→receipt/close的所有窗口，也没有独立证明closed ack先于FINALIZE。
- 未授权例3549：silent fixture保证没有candidate，接受hello/授权fork后发end，再明确fake close；实际control含CANCEL且无FINALIZE，结果failed/无图/有原失败。所有控制写来自真实supervisor，不是另写predicate。fake close只是本例明确的mock终局，非内核证据。

现有FINALIZE授权在完整candidate验证后同步记录；新增判断仅复用同一标志，并未新增放行身份、group、receipt或cleanup条件。#requestCustodianCancel仍one-shot；#fail/unknown保留原责任，未杀C或改变sole wait owner。

## genuine error 不降级的证据范围

child.error2241、draw/control.error2263仍无条件保存transport envelope并latch CUSTODIAN_ERROR/CHANNEL_ERROR，未以finalizeAfterOk忽略ECONNRESET/EPIPE。receipt/domain清理之后还有最终latched failure检查；物理清理证明仍不能把已锁存失败变成图片成功。原cause、replacement PID、revoked authority、无root、预算及当前tool/checker语义未变。

这属于精确源差分支持的**静态nonregression**。既有真实Writable reporting EPIPE、stub transport-failure和child-error测试不是“实际control/draw socket在candidate后报错”的同一动态入口。未找到本轮直接注入该时序的对应新断言，不能用计数或reporting例代称genuine late socket-error覆盖。可将其留作后续具名pure/fault门；本次没有发现修改后的任何吞错条件，故不据此新增无关生产返工或扩大kernel范围。细分边界见FINDINGS.json的NOTE02。

## normal001失败证据及MAIN纠正

读取保留normal001的FAILED_ACCEPTANCE、POST_COMMAND、OBSERVER和runtime-artifacts镜像，并核对原root六个文件与镜像hash一致。实际CLI捕获outer exit1、CHANNEL_ERROR/read ECONNRESET、无图，source_changed为空；C/N出生tuple有独立历史观测，后来原epoch不存在、原组signal0 ESRCH的结论来自已保存MAIN材料，不是本审查新探测。原root、失败日志及证据全部保持。

candidate/final/manifest链接匹配；final保留failed/1、transport failure、recorded CANCEL和physical terminal proof。helper events只有scenario/go/answered，没有finalized。**这些不能证明Host未发FINALIZE**：Host向C的control通道发FINALIZE，helper的事件来自另一draw通道；C也可因FINALIZE或CANCEL收尾，receipt+exit0不唯一识别触发命令。未保存raw controlframes，不能补造历史完整帧序列。

OWN1.1/1.2的“没有helper finalized ⇒ Host从未发FINALIZE ⇒ 候选未完成 / C必被那次CANCEL终止”推论过强，按MAIN_EVIDENCE_BOUNDARY_CORRECTION纠正。本报告与该MAIN纠正共同作为当前权威证据边界，不要求为措辞重开实现票。ECONNRESET方向、实际normal001的完整成因、旧5s/20s mock超时原因仍未证实；当前源修复消除一个明确冗余命令路径，不保证normal002已能成功。

## mutant与264的准确含义

oldlogic-red-002实际exit1，1失败/263通过，失败恰是额外CANCEL断言；日志显示AUTHORIZE_FORK/FINALIZE/CANCEL三条。记录输入与终态只在supervisor及integrity manifest两个路径不同，test字节相同；mutant supervisor SHA为 `10c1d4f9dd5343b02fd149e240f05d43b5e640b97e8c46236ed74d3daae45070`，manifest仍为旧R5H版本。

作者称只恢复旧无条件调用；所读捕获没有完整mutant源/patch，不能仅从摘要签“该mutant逐字节只差一个条件”。本审查尝试两种纯文本还原均未匹配该mutant摘要，故保留这一限制，不猜造差分。这不影响前述**当前生产源相对R5H最小差分**的精确摘要证明，也不把该mutant当normal001历史帧转录。旧条件控制写的反事实证据仅按实际捕获强度表述。

六最终捕获实际cmd/claim/input/result/exit/log均核：651相同、日志摘要吻合、exit0、source_changed为空，记录identity87、Python59、pilot264、type/integrity。generate最终为幂等重复，manifest实际首变异仍是独立历史。264是作者已捕获pure结果，不是reviewer重跑或当前真实N通过。

R5H-O01 MINOR现已静态关闭：2954的tuple直接带四个真实field，所有回调先断言id=where.field，再按field执行delete/undefined/string/非null object；四字段×四类实际目标一致，真实FS writer/publisher及actual checker路径保留，显式null ordinary1对照未变。54主key/final27勘误也已在新报告记录。旧5s/20s、未决fake promise清表不等于结算的局限仍留存；新增describe的beforeEach清fake身份缓解已记录串扰，不等于全部旧超时已诊断。持续deny与mocked child仍在，未建立新真实OS逃逸路径。

## 新pin与后续顺序

|对象|完整SHA256|
|---|---|
|supervisor|c697636065d6f9c88c806f23eb5cd75d88c1bd9b70ea61b385da41382ff7b755|
|C|bd06d7d7f79d6d2ccf2204a4e27ed5aba5364cbcda71785a67ac3ab887306b79|
|tool|e4db3499f715d5b6b5634568677a6688cf80a897c9321c45e93cda98c6a19ebb|
|helper|e3f4ccb1c4016a54356ce04be344b4ffff23f2f88698efe191570ad8407d03ab|
|源码integrity manifest|c39d7e47d67f7d19a0fb9303271c4e3ad6e06dbe1c3dbc375107e8d88dba071a|
|pure pilot test|63a5a2e25f618f634ec1c5f59583ecc413b1d86a62c4330850731c301439e2a4|

MAIN若另票normal002，必须绑定**更新后的supervisor+manifest及全输入**，不能以C/helper参数没变为由重跑旧R5H sourcepin。未来argv形态（未执行，cwd=W）：

```sh
corepack pnpm exec tsx tools/native-cache-normal-pilot.ts --mode normal --expected-custodian-sha256 bd06d7d7f79d6d2ccf2204a4e27ed5aba5364cbcda71785a67ac3ab887306b79 --expected-fixture-sha256 e3f4ccb1c4016a54356ce04be344b4ffff23f2f88698efe191570ad8407d03ab
```

独立normal002接受须联合实际exit0、ok、exact1024×0x4a synthetic图、无transport/report/cleanup错误、原scope终局、fresh C/N epoch/group、已发表final/manifest/candidate/artifact实际hash/长度及完整事实契约。只有这条新门通过，MAIN才可另票同pin的 `--mode assertion-failure`，预期exit1但须确切原取消cause、同epoch GO/live、null image、无额外失败、完整终局及证据链；普通failed1绝不当fault通过。normal002若失败仍保留失败/root，不跳过，不把清理完毕当成功。

本票只写指定三个审查文件。reviewer测试/产品import/真实CLI/C/N/信号/fork/wait/prctl/Host/media/Chrome/network全部NOT_RUN；未改W/Git/运行root/旧证据。normal001仍FAIL，normal002和新fault均NOT_RUN，N1N2/R6R7R8/17+18/冻结/NEXT/V1没有据此通过。
