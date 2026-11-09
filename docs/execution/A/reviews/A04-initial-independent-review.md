# A04 ProjectCreationStore独立只读审查

结论：**NEEDS_WORK / 组件装配未完成**。发现租约/授权时间采样窗口（A04-R1，MAIN已给源码修正候选，待测）、source fact/engine version与真实snapshot的证明绑定缺口（A04-R2）、长寿命实例的内部DDL漂移检查缺口（A04-R3）。均是源码推导及确定复现方案，**本审查没有运行测试/SQL/Host/ffmpeg，也没有编辑MAIN文件**。store尚未进入生产project.create handler，不称线上漏洞或A04通过。

审查人Codex `/root/a_bridge_lead`，未实现本次MAIN store；写入仅本lane报告。BRIDGE候选50f4e19309d81ad0bf6ddc986494c2d34f32bea1保持不变。

## 实际输入与动态修正快照

目录始终是`/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`，读取HEAD为`218c40cb9a90b6a33359c5d0f556991166002eef`。store、ADR、test为未跟踪工作文件，namespace helper为dirty，所以不能只靠HEAD重放本审查。

| 输入 | SHA256 |
| --- | --- |
| project-creation-store.ts，R1发现时复读快照（含origin/forProject reader新增，时钟仍在事务外） | `9d0330cc3c7e0cd1f22f907f04c3ca2c7567c36d36dcfaf19e697b01f03c73c2` |
| project-creation-store.ts，MAIN随后移入时钟/末尾复核候选，已只读复读 | `001093d955c890fddcdad60270d4b6d721bdd259cf065c7b90367474ff6d9d16` |
| docs/execution/A/ADR-A04-001-created-origin-and-initial-commit.md | `16f30f0ed3cb340742bc7f0c978adbc69fb9b8b24773e8ae4ef028be722a4f1b` |
| tests/agent-driven/integration/project-creation-store.test.ts，含constructor namespace guard新增 | `1be2fd4202b46537c656d36ced333db8bf8886f1f803c9d20f34b4c8c1bc6c3e` |
| src/host/agent-driven/agent-schema-definition.ts | `581974592352a9fd6da2affa47afe722274581933d1cbbf569f6c94b18e6a46d` |
| src/host/projects/snapshot-store.ts | `2ad01b1340e80c3fef5f65922bc1a5c884f85d34dc9d2f5998a11f3de808cc32` |
| src/host/projects/revision-store.ts | `fea46b6310be044d2c90b6c846b07e04600da286643411a53313680230978dae` |
| src/host/creative/creative-closure.ts | `d55c1a06ef542eaf1d1d1bf697231676d6f9e1819f312b4ddaf9329a3467b800` |
| src/host/creative/product-repository.ts | `f071a02f1ed691e70a7f7cc774c6f4b5948c088e4a8411491fb51adb7affc3b7` |

MAIN先报告tsc0+18/18。本审查只读`logs/main-creation-store-r2/typecheck.exit`及`tests.exit`均0，tests.txt为1文件18/18、9.61s；不是本人独立重跑。该记录不能自动绑定之后新增的namespace guard、时钟修正或未来proof实现；最早first目录仍留有typecheck exit2，未删掉初失败。

## A04-R1 — P1：事务准入前采样now可认可临界区内已失效的lease/确认

发现版本9d0330…：reserve在repository.transaction前采now，commit也是`const fact=...,now=this.now()`后才进入BEGIN IMMEDIATE。确认expiry、lease_expires_at比较和completeCallback时间参数均沿用旧now。若另一个真实SQLite writer让BEGIN等待，等待期间lease或trusted confirmation到期，当前代码仍会用准入前时间认可该worker并提交。即使无另一进程，长同步检查或末尾故障钩子推进时钟也暴露“提交前到期但继续成功”的相同窗口。

确定复现方案（未执行）：准备真实published snapshot、running lease期限T+1000ms；让另一个连接持写锁直到T+2000ms后释放，再于T调用commit。或用已有可替换clock及RevisionStore.atomic入口包装，确定地在事务准入后推进clock到lease边界。原版本仍看T，所以租约条件通过。confirmation expiry同理。成功对照必须是不跨期限的同owner/attempt；owner/attempt/cancelled原有负向保留。

MAIN随后候选001093…已经只读检查：reserve/commit在transaction callback内首次采now；reserve最后重新confirmed，commit在outbox/fault边界之后采finalNow，核原job lease期限并重新confirmed，任何失败逃出callback触发完整回滚。该控制流针对根因，状态**SOURCE_ADDRESSED / NEEDS_TEST**，不把当前18项既有日志当新时间用例证据。应补事务准入clock推进和最后outbox边界clock推进两类确定负向，并明确它们不是实际跨进程抢锁实证。

## A04-R2 — P1接线证明门：CreatedSourceFact与snapshot/upstream没有共同证明绑定

当前001093…，commit的snapshot检查仅核project/engine、digest格式、snapshotIdFor以及prepared transaction中的snapshot_id/source_digest_after；fact只过结构检查，随后以自算SHA入created_source_fact。PublishedSnapshot返回值本身不包含用于digest计算的engineUpstreamSha或manifest，fact.frame_count/fps/roots/资产bytes/SHA/许可没有和真实published bytes/parse结果关联验证。

确定复现方案A（未执行）：沿现tests.prepared()真实发布空film.html，保持真实PublishedSnapshot、正确lease/attempt/确认及prepared transaction不变，仅把合法fact.frame_count由0改900，或fps由30改60；validateCreatedSourceFact仍接受，commit会将该不一致事实永久存入不可变表。还可给fact.roots添加不存在的relative asset并附自洽结构的asset fact，现store也无manifest核验。

方案B（未执行）：用真实SnapshotStore.publish，但传不同engineUpstreamSha（例如另一40hex），然后以它的真实snapshot_id/source_digest完成prepared元数据。返回的PublishedSnapshot仍满足当前commit检查；commit却把binding写死为当前OPENFILM_UPSTREAM_SHA。SourceDigestV1明确把engine_upstream_sha纳入digest，最终Binding与snapshot摘要的版本依据不一致，恢复/重读可能失败。旧pending创建跨版本恢复是实际应处理的来源，不必假设wire能直接构造PublishedSnapshot。

这不是声称一个内部store方法必须在SQLite锁内做文件I/O，也不是将其参数误认为已暴露MCP。具体发布阻断是：**不能将这些当前可接纳的DTO仅因“名叫fact/PublishedSnapshot”就当实际parse/bytes/rights/upstream证明**。A04 Service应在事务前用pinned reader+真实snapshot closure+登记资产事实生成可重放证明；把proof/snapshot digest/配置及upstream明确绑定在prepared命令和commit输入间，store至少拒绝与该证明不符的fact/version。若设计由受信调用者承担，必须显式写成前置条件，并用真实service负向证明它确实被执行；当前组件18/18不覆盖这件事。生产handler启用前该门不能延期成“成功metadata”。

## A04-R3 — P2：created_source_fact namespace只在构造时核验

当前001093…构造器检测namespace并用固定DDL核现schema，优于CREATE IF NOT EXISTS自动补trigger。新增测试证明drop trigger后**重建store**会拒绝。

但长寿命实例后续reserve/commit/sourceFact没有复核该namespace。内部ProductSqliteRepository会在schema_version变化时核cp_a0_*，不会核created_source_fact。确定复现方案（未执行）：建立fixture及store后DROP created_source_fact_no_update；不new第二store，沿原store完成prepared和commit。namespace缺陷不会命中constructor，CP schema比对也不包含它，store仍可提交事实，随后其不可变性已无DB trigger保证。

此项成立于运行中DDL漂移/恢复故障模型，不是假设普通HTTP请求能执行DDL。建议给内部namespace加schema_version驱动复核或在关键写/读取证明入口核验；发生DDL变动应停写而非悄悄在旧实例继续。补同实例漂移拒绝与未漂移commit成功对照；不能仅用constructor负向关闭此门。

## 本轮核到的正确边界

- reserve在一个ProductSqliteRepository事务内登记project_state revision0、原job、transaction和cp_a0_bootstrap_command，未写origin/active commit/engine binding，也没有伪migration。command/project/job/transaction ID一组固定，principal+operation+key作用域与异输入digest冲突明确。
- response_json为{accepted,result}，accepted保存原POST queued/attempt0，result从null变BootstrapResult；重复POST读原accepted，receiptForJob用真实Job状态/attempt/result投影，不另建Job状态机。correlation字段不参与语义digest重放，符合原请求回执要求。
- confirmed检查当前intake owner/head/version，trusted_ui confirmation的principal/purpose/brief digest/未来issued及过期；Brief自洽且重算digest；creativeInputClosure包含当前全部question heads及current answers，无answer拒绝，commit比较reservation closureDigest，从而拒绝reservation之后发生的Q/A变更。确认本身只绑定冻结Brief输入，不能将该创建确认解释为媒体执行grant。
- commit正常路径BEGIN内核lease owner/attempt/running/期限、prepared交易、base0、无其他recovery gate/active pointer/binding，revision条件更新恰0→1且control0；同一次事务写binding/snapshot/committed transaction/pointer/source fact/origin/Brief immutable version+head/command结果/Job完成事件/outbox。异常逃出时整体回滚，11个fault点均位于同SQLite边界。
- committed重放分支只返旧result并校snapshot/digest/fact一致，未再次推进revision/outbox。native_state始终unconfirmed/ack=null，未用Host revision伪填loaded。

## 未关闭的测试与实际交付门

当前已有真实SnapshotStore.publish + SQLite测试是有效组件证据，但11次throw不是实际进程kill；read/reopen是DB重开，不是已挂生产handler的关闭服务/恢复创建。当前没有看到Q/A在reserve后变更的专门负向、preparation各文件阶段真实终止/owner staging清理、realpath/pinned parse证明和snapshot/fact/upstream错误输入负向；这些不能由Happy-path metadata替代。

CreatedProjectView新reader分支、通用Coordinator前的bootstrap恢复接管、实际project.create/job.read/context消费、旧UI原生打开和后续采用/恢复同样记录新snapshot fact，均须在同一冻结组合SHA接线验收。本store还未被生产project.create启用，故本报告不签A04整体PASS，更不签A阶段影片/双导出/人验或B准入。

本报告仅留在BRIDGE lane reviews；MAIN源未改，测试未跑、轻量槽未申请。R1修正候选已注明，R2/R3仍待设计落实及真实负向/成功对照。后续新字节另行绑定，不能以本文自动覆盖。
