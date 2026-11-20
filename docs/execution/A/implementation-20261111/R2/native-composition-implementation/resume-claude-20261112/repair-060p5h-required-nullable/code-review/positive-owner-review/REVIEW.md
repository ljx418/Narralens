# R5H required-nullable 独立受影响复审

**SAFE_FOR_SEPARATELY_PINNED_MINIMAL_N_PILOT。** R5G-O01生产实现静态关闭，未发现阻塞这两个精确synthetic pilot的剩余生产缺陷。另有1个非阻塞MINOR测试定位问题和1个报告计数NOTE，必须如实保留，不以254绿冒称全部标签均已实际覆盖。

本结论只是静态准入建议，**不授予runtime**。MAIN仍须另发当前字节pin、两条精确argv与资源范围；不是kernel/N1N2/原17+ISO18/R6R7R8/冻结/NEXT/V1通过。当前候选为dirty终态，历史HEAD1d348d419120f23f45d958112ea8c43df5a04675不是新接受提交。

## 已知缺口的实际关闭

工具152/164/172/189的四张own-field表与真实writer逐项对应。静态文本核对得到candidate19、manifest8、final27，共54个主记录key，row4；测试独立表与writer/实现表均无缺项。199的missingRequiredKeys使用Object.hasOwn并拒绝显式undefined；checker2371–2382在baseline/mode/ordinary判定前执行三份记录的统一门，继承属性或缺失不再冒充发表字段。

artifactRowProblems252首先核全部四个own key，error-free必须显式null；非null error须合法bounded error且仍使证据不可靠。2397/2610/2616的listing/reporting/manifest错误只允许null。对原R5G“删reporting_failure/manifest_error/listing_error/row.error但hash正确”的反例，现在均先拒绝3。

2514的baseline=null分支要求final snapshot为null，且候选receipt_summary、accumulator_summary、terminal_proof_observations及final terminal_proof_observations四字段明确null；它们的own存在性已经过统一门。nonnull分支不再optional跳过，全部摘要/observations均与同一次实际基线比较。合法helper拷贝后构造supervisor失败的完整ordinary1正控保留；无root先拒绝3、不读不存在的final、不把cwd当root。

原错误的规范投影/actual Error identity或direct wrapper.cause、cleanup内容顺序、图像hash/bytes/exact、terminal证明、diagnostic transport/latched/cancel provenance及实际byte/hash/length/link门未见退化。run取得一次snapshot并复用到outcome/candidate/final，唯一verifyPublishedRun仍由actual main2824与legacy273调用；没有重新引入consumer副本。核心及guard等其余六文件逐字节与R5G一致，未重开其kernel算法。

## 测试的实际覆盖与非阻塞问题

54个逐key删除用例确实通过现有tamperWith在writeEvidence/publishEvidence边缘改字节，再委托真实writer/atomic publisher，实际mapper/hash/length/links自然对应坏记录；实际checker读取它们。行error删除、合法非null失败、no-root actual main及null-snapshot完整ordinary1控制也是真实接线，非伪hash或消费替身。

**R5H-O01 / MINOR**：2966和2998两个null-baseline参数化循环忽略了标签_id。由于未变更candidate原本receipt_summary=null、accumulator_summary=null，这两个值都不是undefined，2975/3007的字段推导对三个candidate标签总选receipt_summary。因此accumulator_summary和candidate terminal_proof_observations的missing/wrong-type标签实际重复receipt_summary；final observations则选对。它们不能证明四个不同字段都被动态变异覆盖。关键nullable项显式undefined/合法非null object的独立case也尚未完整列出，不能从标签补推执行结果。

最小修法是tuple直接带真实key，变更时delete/赋data[key]，并断言目标与标签一致，再补对应控制。**这不阻塞当前最小N建议**：生产代码是显式四tuple的统一value!==null门，所有own key已核，当前并没有测试遗漏对应的生产放行分支。该测试问题保留为未完成质量项，不能自签“所有case覆盖完毕”。

**计数NOTE，不是实现阻塞**：OWN42/91将final写28、total55；实际为27/54。正确新增数量为54删除 +1行error +3真错 +9 null-baseline（含1正控）+1 no-root =68；186+68=254。实际final日志确为254，不应为修加法去改变源码或旧捕获。

## 精确pin与后续联合门

|对象|当前完整SHA256|
|---|---|
|tool|e4db3499f715d5b6b5634568677a6688cf80a897c9321c45e93cda98c6a19ebb|
|C custodian|bd06d7d7f79d6d2ccf2204a4e27ed5aba5364cbcda71785a67ac3ab887306b79|
|helper|e3f4ccb1c4016a54356ce04be344b4ffff23f2f88698efe191570ad8407d03ab|
|源码integrity manifest|7bb4bd1813987a6860bb9eb7a332ccbedb237c009a8767bc75e6418f1595c2db|
|supervisor|7706449e8f259a6e17e9ca2a40af8a5c344cef827a01c7881fc04a4a570b9b63|

仅以下两种模式属于本次静态建议范围，**下面是未来另票的argv，不是在此执行的命令**，cwd=W：

```sh
corepack pnpm exec tsx tools/native-cache-normal-pilot.ts --mode normal --expected-custodian-sha256 bd06d7d7f79d6d2ccf2204a4e27ed5aba5364cbcda71785a67ac3ab887306b79 --expected-fixture-sha256 e3f4ccb1c4016a54356ce04be344b4ffff23f2f88698efe191570ad8407d03ab
corepack pnpm exec tsx tools/native-cache-normal-pilot.ts --mode assertion-failure --expected-custodian-sha256 bd06d7d7f79d6d2ccf2204a4e27ed5aba5364cbcda71785a67ac3ab887306b79 --expected-fixture-sha256 e3f4ccb1c4016a54356ce04be344b4ffff23f2f88698efe191570ad8407d03ab
```

另票必须先核tool与完整输入pin，运行期不可变，不重生成manifest接受未知字节。normal预期外层exit0且exact1024×0x4a，只是synthetic协议，非JPEG/视频；fault预期外层exit1，但必须同时确认确切原取消Error/直接cause、同epoch HELLO/GO/live、null picture、无额外失败与真实完整终局。两者均须实际已发布final、完整manifest/candidate/artifact实际hash与长度、原结果/cleanup/freshfacts、报告结算及mode语义联合成立；源integrity manifest pin不是尚未生成的每run证据manifest摘要，后者必须由实际产物计算验链。普通失败1或任意1不能作为fault PASS。外层actual OS exit仍须独立recorder核对，工具不能自证未来退出。

## 捕获与未关闭的边界

六最终capture的cmd/claim/inputs/result/exit/log均核对，651输入等于当前快照、日志hash吻合、exit0、source_changed为空；记录identity87/Python59/pilot254/type/integrity。702份实际读/hash文件start/end/current相等，source8/protected7/report匹配，见INPUTS.json。651只做摘要绑定，未冒称全量语义审查。generate为幂等重复。

本轮21red是helper-neutralization mutant，实际日志exit1、21 failed/232 passed（253），输入不同于最终；不是exact存档R5G重放，不等同21个历史语义失败。旧26red同理，未重跑任何变异。原5s/20s超时与afterEach清表不等于原promise/timer终结的隔离局限继续留存。持续deny wrapper不移除、child保持mock，未建立真实OS逃逸的新路径；254绿不是超时根因证实。上述测试域问题不能冒充当前真实C/N已运行或已证明清理。旧os.kill事故、004 MAIN停止、005 INCOMPLETE、全部FAIL均保持，不造PID、exit、raw segments或无影响结论。

本票只新增本指定三个审查文件，未改源码/测试/Git/var/旧报告。所有reviewer测试/产品import/CLI/实际C/N/信号/fork/wait/prctl/Host/media/Chrome/network均NOT_RUN。任何最小实际试验仍由MAIN另票，不替代后续R6/R7/R8、原17/ISO18、新冻结外审、NEXT与V1。
