# R5C positive-owner 独立静态复验

**REQUEST_CHANGES**：6 MAJOR、1 MINOR。本轮不签 `STATIC_SAFE_FOR_EXACT_N_NORMAL_AND_ASSERTION_FAILURE`，不授予运行许可，不是最终R8冻结提交外审，也不签业务/内核/N1N2 PASS。

实际绑定为R5C handback **msg_0e1f69a0c119 / task_e200d7c555da / ctx_3f37cd7eb6c5**；历史HEAD **1d348d419120f23f45d958112ea8c43df5a04675**不作为新接受提交。起始核对snapshot的8源、7保护、OWN报告均吻合；结束再次核对，完整SHA/bytes、所读合同/报告/依赖/捕获元数据见 INPUTS.json。所有reviewer业务runtime均NOT_RUN，仅文本、stdlib哈希和Orca协调命令。

## 精确入口反例

**R5C-O01：normal会主动取消自己。** 实际supervisor.start1522调用异步#run并返回原pending settlement。工具930调用start后，normal在935没有任何正常生产等待，马上进入finally950。continueToTerminal678发现尚未settled，就683请求cancel(DRAW_NOT_SETTLED)。这不是一个资源结束判据，也不是实际业务失败；精确normal CLI因此通常在C/N握手完成前便锁存取消。通过的normal stub在start168同步settled，掩盖真实顺序。须把正常等待放进同一个owner continuation；finally仍负责失败取消和全部真实终局，但不能以“尚未同步完成”为失败。

**R5C-O02：故意失败在等待HELLO前就拒绝。** 工具771的acceptedWorker立即判空，772–776取消并返回；此时真实C/N的异步HELLO不可能已在同一JS调用栈完成。waitForLiveWorker只有已有worker后才会调用，无法等待初始null→accepted。须先等同issued draw的accepted N，再等本root的GO摘要，最后保持无await的fresh全tuple/live→cancel。测试的snapshot从构造时就提供worker，未覆盖真实启动窗口。

这两条经实际调用链独立核验，尚未执行反例。MAIN稍后消息msg_783eb7ad512e也指出normal及cleanup资格问题；该消息只是并行线索，本结论依据实际源码，未把消息当运行证据。

**R5C-O03：重复cancel改写primary历史。** 生产supervisor首次取消保存原Error与accepted_as_primary=true，但第二次同Error取消走1754–1764，覆写为accepted=false/superseded=true。工具finally683在未终局时会再次取消。直接用真实私有API reserve→cancel(E)→cancel(E)→start即可无child反证，故不依赖先修O02才认定API有缺陷；工具后的故障资格问题当前被O02遮住。stub第二次cancel却保持原provenance。最小修法是primary取消记录不可被同一幂等请求或后来请求改写，而非放宽judge。

**R5C-O04：cleanup未参与资格。** 原startPromise的picture/error现在确实被读回，但cleanup仅720记数量，随后丢弃；judge996–1017既不检查原cleanup，也不检查snapshot.cleanup_failures。额外清理失败仍可能被判断为normal ok或fault-observed；例如private run目录rm在#settle之后失败，只能在最终诊断看到，而工具也忽略它。保留原raw结果/cleanup，区分精确故意失败与其它清理失败，两模式均需拒绝其它失败。

**R5C-O05：报告边界已真实接线，最终证据提交仍早于报告完成。** 工具终于复用固定R4B实际factory，default stream=stderr、callback式write、main/run同实例和无旁路均成立。但summary/outcome1052先保存通过与reporting_failure=null，main1125才写最终报告；回调EPIPE后1141仅返回1，不修改/撤销磁盘资格。对expected-fault而言，这仍是预期exit1：磁盘的fault_case_passed=true+terminal_proof=true+reporting_failure=null与exit完全可以把报告失败误作预期故障。应在所有必要callback完成后持久化最终资格/报告失败记录，明确候选非权威。现有EPIPE测试仅正常、已settled stub、null stream+延迟callback，未证明真实Writable/error事件、未知期间pending及故障模式最终落盘一致性。

**R5C-O06：root分配失败时证据落到W根。** createRoot882抛错后root仍为空串，finally仍1052/1053调用writeEvidence。真实实现265–266的join('',name)等于cwd的summary.json/outcome.json。var路径不可写而W可写时，会在授权run根外创建或覆盖文件。无真实root时只能走受保护报告/无root状态，不能用cwd替代。已有prepareRoot失败测试发生在假root已分配后，不覆盖allocate失败。

**R5C-O07（MINOR）：产物证据仍不完整。** timeline terminal-proof只有detail:null，原cleanup只计数，诊断摘要未保存实际最终fresh C/group/known-ID观察值和时间；artifact列表在summary/outcome写前取得，不含这些输出的hash。所需list/hash失败被空数组/null隐藏。补最后的实际观察与文件manifest；不要求把R6完整rawsegments提前实现，也不把摘要冒充原转录。

每条具体路径/行号、前提、合同、最小修法与直接actual-branch mock在 FINDINGS.json。所有反例均为静态推演，**不是 captured old-code failure**。

## 旧项逐条复验

|R5B旧项|本次结论|具体依据|
|---|---|---|
|O01|STILL_OPEN|partial entry、root即时登记、prepare与allocate分开、构造/reserve/start置try、finally跟随原promise与held恢复均有实际改进；但正常路径立即自cancel、无root写入仍O01/O06。|
|O02|STILL_OPEN|首次原Error与cause身份比较已修，late原结果也确实回收；重复取消provenance与raw cleanup资格仍O03/O04。|
|O03|CLOSED_STATIC|实际全tuple+非Z/dead、GO pid+本draw摘要、最后同步guard无await已经接线。新O02是异步阶段等待缺口，不能据guard正确宣称故意失败入口可用。|
|O04|STILL_OPEN|真实R4Bfactory与默认Writable接线的子问题CLOSED_STATIC；最终报告/磁盘资格/expected exit1一致性仍O05。|
|O05|CLOSED_STATIC|无worker的一刀切改成原birth/authorize ledger，late noBirth/noAuthorize真实supervisor mock现在能恢复原promise；freshunknown保持held，已AUTHORIZE缺证明不放行。限原指定分支，不等同所有startup或kernel验收。|
|O06|CLOSED_STATIC|legacy使用明确C pin、真正close/runner receipt、移除Host组数与timer旁证；其positive仍依赖本工具未修入口。mixed文件仍NOT_RUN，非本票运行授权。|

重点S03/S04/S06仍STILL_OPEN，具体残留见新O01..06；并非要求先修无关workspace R7。S01 raw-dispatch权限gate、不可逆epoch/anchor撤销和持续动作债源码已有改进，原adapter mock确实进入KernelSettlementOperations；本owner审查不代替并行startup-reaper独立结论，不据52例签全部authority/内核通过。R5A C01/C03不被重开。

## 测试、配置与实际证据

完整读新工具和28例断言，核对supervisor/custodian相关实际分支及legacy调用，而非只读diff。75/52/28是真实保存的mock门计数，不是N runtime证据。原始28用例没有真正延迟初始HELLO的正常/故障控制；held测试在几次mock poll后自动恢复，没有在unknown窗口明确断言原tool promise仍pending；EPIPE测试没有真实Writable/stream事件，也仅在原生产已settled后出错。需要在真实orchestration上补异步正常结果、null→HELLO、重复真实cancel、带cleanup的原结果和仍held时报告错误，不用更多同步boolean断言替代。

项目package.json为type=module、tsx4.20.5，tsconfig ESNext/Bundler；工具自entry guard与固定相对mjs动态import、nofork模块自guard静态核对，无autorun旁路。supervisor引用cache-production-scope仅有模块内表/AsyncLocalStorage初始化，未见import时spawn。以上只解释预期加载边界，**未执行tsx CLI**；OWN“vitest28例证明tsx也实测加载”的说法不成立。不把tsc成功当真实CLI通过。

当前拟用的新C pin为 **36387d5287ee6977ee1625e9a6ebbe61f2f8992fa4502c19310d11548d9503d7**，fixture pin仍 **e3f4ccb1c4016a54356ce04be344b4ffff23f2f88698efe191570ad8407d03ab**。两条拟定mode normal/assertion-failure CLI均 **NOT_RUN / 不获本次安全签字**。修复后须重绑实际字节、重审并由MAIN另发精确票；正常应exit0+精确1024×0x4a+真实原结果+完整终局+无其它失败，故障应仅同issued原因/同epoch live+GO+null image+完整终局且最终报告与证据一致才qualify exit1。1024合成协议不是JPEG/视频。

只读核对20份R5C complete result/log SHA：7份失败、13份exit0；final六门均exit0且source_changed=[]，final generate是幂等重复，generate-001的实际delta仅manifest。旧R5B python-001 INCOMPLETE没有补造exit/PID，旧报告与失败均保留；没有运行旧capture或重新制造历史红门。651记录输入由MAIN绑定，本审查核所读路径、8源/7保护/report，不宣称逐行审完651个文件。

末尾输入SHA重验一致，输出仅本目录3文件。真实C/N、kernel/FD/wait/reap/signal/prctl、Host/HTTP/probe/media/browser、fullgates、原17/ISO18/N1N2/NEXT及R6/R7仍未验未接受；历史HEAD未伪装成新freeze。读/hash工具本身执行过，不称零进程。
