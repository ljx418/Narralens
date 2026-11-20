# R5F positive-owner 受影响独立静态复审

**REQUEST_CHANGES：2 MAJOR。** 两项均为原R5E-O02的结果协议校验义务，没有新开kernel工程。本票不签 SAFE_FOR_SEPARATELY_PINNED_MINIMAL_N_PILOT，不授予运行许可，不代签N1N2/R6/R7/R8、原17/ISO18、NEXT或V1。

本候选是INPUT_SNAPSHOT绑定的dirty当前字节，不是新接受提交；历史HEAD为 `1d348d419120f23f45d958112ea8c43df5a04675`。当前工具SHA256 `bb5ab8dfa788629cbcd0762302cb1c595412d9a15d54381e70b92ab4b5207afa`，supervisor `7706449e8f259a6e17e9ca2a40af8a5c344cef827a01c7881fc04a4a570b9b63`，C `bd06d7d7f79d6d2ccf2204a4e27ed5aba5364cbcda71785a67ac3ab887306b79`，报告 `4af853798dd39eba287f97bb43207b01ce2fad168898947ea8aaffdade06e686`。source8/protected7/report均匹配；651记录输入另外逐字节hash核对。全部702份实际读取/摘要核对输入结束时相等，完整start/end/current SHA与scope见INPUTS.json；651摘要核对不冒充651逐行语义外审。

## 逐旧项处置

|R5E项|处置|实际路径|
|---|---|---|
|O01 全行artifact门控|CLOSED_STATIC|工具241遍历全部行，181校验简单名/保留名/完整SHA/安全字节数，去重并要求两个必需名，另核candidate链接；真实mapper及1880的第三文件scenario EIO用例走真实read边界，不是替换整份artifactFacts。|
|O02 唯一真实byte/protocol checker|STILL_OPEN|唯一verifyPublishedRun已经读实际三主记录与全部artifact，main2230、legacy273和pure测试均实际调用它，旧两份消费副本已删；但其结果/schema检查仍有下述normal/fault漏洞。|
|O03 既有digest落盘|CLOSED_STATIC|supervisor682及1971/2007复制既有三个digest至frozen私有摘要，实际supervisor/mock协议断言与重复snapshot检查存在；报告§2列出具体字符串。raw_segments_saved=false保持。|

默认FS依赖→artifactFacts/fileFacts→evidenceProblemsOf→judge→同根wx temp/write/close/rename→outcome→actual main/verifyPublishedRun→legacy accepted/根删除条件的真实接线已读。普通业务失败的现有正向测试确实返回evidenceReliable=true、accepted=false、exit1；新的mandatory read拒绝路径也实际返回3。共享架构和读取修复成立，不再以“仍有三份副本”阻塞。

## 最小阻塞

### R5F-O01：normal仍能接受缺失/矛盾的结果证据

工具1979仅核candidate的kind/root/mode/authority/raw_segments_saved，不核原失败、settlement、cleanup、terminal或image。2062将final的任何非对象original_failure/settlement_failure——包括缺字段、字符串、数组——都当null。2070的noExtraFailure只核final.cleanup_facts为空和snapshot.cleanup_failures为0；normal分支忽略最终snapshot.transport_failure与latched_outcome=failure，也不比较candidate/outcome原cleanup。

**直接设计反例，无需改任何hash oracle**：使用已有受守卫normal mock和真实临时FS，只在writeEvidence(candidate)把original_failure改为EIO记录或删settlement_failure，再交实际writer；随后真实mapper/链接自然对这些字节生成正确hash。final/outcome仍保持成功，checker仍accept0，因为它没读candidate这些事实。另在真实publishEvidence前复制final并把diagnostic_snapshot.transport_failure改EPIPE或latched_outcome改failure，cleanup_failures仍0，交实际atomic publisher，返回digest完全匹配；normal仍accept0。删除/错型final的两个error字段也会被当null接受。

这是本票明确要求的“合法hash但坏JSON/原事实不一致”故障模型，不是声称真实正常producer会凭空生成错误，也不是公共JSON权限或内核清理漏洞。actual main与legacy都使用这份checker，影响真实退出判定及证据根删除。缺字段/错类型/相互矛盾的协议证据必须unreliable3；不能降为ordinary1或accept0。

最小修正是对当前v2结果字段做必需且有界的类型校验（显式null与合法error分开），核candidate/final/outcome规范化原事实、raw cleanup与terminal/image一致，normal复用producer现有transport/latched失败门。合法且一致的普通业务failed1仍保持可靠、不接受、exit1。无需引入新公共API或扩展R6/R7。

### R5F-O02：fault的settlement只要非空对象就能通过

工具2130只要求final.settlement_failure !== null；即使是空对象或不相干EPIPE记录也通过。2113的cancel provenance只检查两个布尔标志，不绑定error_code/name/message到原取消。2120的agrees不核outcome.originalFailure/settlementFailure的对象或cause关系，也遗漏pictureBytes/raw cleanup；candidate的对应字段仍未比较。

**直接设计反例**：用已有silent fault mock与真实FS，保持原EXPECTED_ASSERTION_FAILURE和所有已通过epoch/terminal/nullpicture事实，只在publishEvidence把final.settlement_failure换成无关EPIPE对象或{}，再交真实atomic publisher。实际字节hash和返回值相符，candidate/outcome仍保留原expected Error，但checker仍accepted=true/exit1。只把cancel_provenance.error_code改成OTHER、name/message改成别的错误，保留accepted/superseded布尔值，也不被拒绝。

producer的judge1514原本检查settlementFailure===originalFailure或精确cause关系；checker不能退化成“非空”或从JSON code重建对象身份。最小修正是核实际outcome的原Error/精确cause关系，对candidate/final序列化的bounded事实与实际outcome逐项比较，并绑定cancel provenance到原Error；合法wrapper-cause仍须保留。跨记录矛盾为协议3，真实且一致的普通失败仍1但不accepted。不可用任意exit1当预期故障PASS。

两个finding的精确位置、触发条件、合同、影响、最小修复和待执行pure设计在FINDINGS.json。它们独立于当前kernel算法；本审查没运行测试、没修改字节、没制造captured old-code failure。

## 测试与证据边界

新的纯测试确实调用唯一checker，而非consumer副本；第三文件EIO在node:fs readFileSync边界，只在scenario scan发生，实际mapper写行error且top listing_error为null。真实FS publisher后的read EIO/丢失与合法hash但mode/protocol/link/长度错误也有实际共享checker测试。

但现有extra-error fault例在producer阶段就注入transport failure，producer已判kind=failed，因此无法证明checker独立拒绝“保留fault-observed标志但settlement/cancel不一致”的记录。当前合法hash变异只覆盖少数顶层mode/protocol/link/长度，缺上述candidate结果、normal diagnostic、缺字段/错类型、fault原cause反例。这是明确覆盖缺口，不以69绿替代。

digest修复读取实际accumulator与receipt，格式有界，摘要frozen，候选与final保留同一snapshot摘要。报告中的空集合digest `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` 和单wait digest `ed8e31ae409545cb792e2ee0499e7924f858a75a54f6c09799b49e706a916022`对应mock协议用例的已执行断言；不是新C真实运行的收据，不伪造未保存raw segments。

final2六份cmd/claim/inputs/result/exit/log均已读取/摘要核对：每份651与快照一致、日志hash吻合、exit0、source_changed为空。记录identity87、Python59、pilot69及type/integrity，不是reviewer重跑。final2 generate是幂等重复，首变异仍另有历史capture。

另读旧final-pilot实际日志：normal异步supervisor例在5000ms超时，真实exit1，68通过/1失败，日志hash与result吻合；其输入确实不是final2，旧失败原样保留。当前262只把两个mock-supervisor case的Vitest预算改20000ms，生产deadline未在本票改动，语义断言未因此删除。这可解释为何测试预算需要独立于生产清理deadline，但“机器繁忙导致”尚是作者解释，日志没有阶段耗时证实；两次重跑或最终绿不能证明该原因，更不能证明内核liveness。没有据此新增无关阻塞，也不把预算变动当真实N证据。

原组证明/信号权限算法和Pythonguard/test未变，不重开已关闭kernel逻辑。取消主因、晚到N、replacement PID、防无root写cwd、原startPromise/finally、真实R4B报告factory及同根原子发布边界在受影响链中保持。旧os.kill越界事件不称合规pure或已证明无影响，004为MAIN精确停止，005仍INCOMPLETE；不造PID、exit或历史失败日志。

## 交还与下一门

最小行动仅是补齐这一个共享checker的normal/fault结果契约与实际纯反例，重新绑定受影响字节后复核；当前不建议释放两真实N CLI。CLI不能观察自己未来OS exit，最终外层recorder仍必须核actual exit，normal0与精确fault1均须有效原结果/cleanup/freshfacts、报告结算和完整实际字节链联合成立。

reviewer全部业务runtime（测试、产品导入、真实CLI/C/N/fork/signal/wait/prctl/Host/HTTP/probe/media/Chrome/network）NOT_RUN。只写本指定目录的三个新文件；未改W/Git/运行根/旧证据。当前为dirty安全受影响复核，不是冻结commit/业务/kernel验收，原17/ISO18/R6/R7/R8/N1N2/NEXT/V1保持OPEN/NOT_RUN。
