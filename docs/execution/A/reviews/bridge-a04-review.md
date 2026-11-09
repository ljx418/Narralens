> **冻结3476续轮结论：A04-R1/R2/R3原发现已有针对性源码修正，已只读核实际字节及MAIN证据摘要；本审查未重跑90项。创建worker/专用恢复、生产route和完整A仍未完成；existing snapshot复用时的durability再证明继续列为恢复接线门。以下最初NEEDS_WORK和旧快照保留为历史，不表示旧三个路径仍未修正。**

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

## 冻结3476差异复核（最终只读记录，2026-11-10）

MAIN实际目录仍为`/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`；本次读取前后HEAD均为 **3476b40955e1267568547f0f73d429a22a7aa217**，git status clean。仅复核旧发现相关差异、新proof factory、created reader分支和证据，不重复旧全段审查。本人没有运行测试/Host/ffmpeg，也没有修改MAIN源、索引、runtime或申请轻量槽。原BRIDGE50f4候选及其108历史证据不变。

| 冻结输入 | SHA256 |
| --- | --- |
| src/host/projects/project-creation-store.ts | `203b3b043fb6ea13064c698eade333e5e4bf36fed30dd1c877dc070aebba506b` |
| src/host/projects/creation-source-verifier.ts | `87a15a0db84ef37b5c1d8db8e2c66cd53b2383354ea49eaa2117ba21830366f0` |
| tests/agent-driven/integration/project-creation-store.test.ts | `d7e9ace31e5a954d3defcfbdf1fd49ca58b13e0c5a63dc013243ca409a512e4c` |
| src/host/projects/project-resolver.ts | `d4d4c05f9b3ba847b7eae4526d6196f2eddb6a2b7669e5c90c2b13029be31cfd` |
| src/host/projects/asset-inventory-port.ts | `25a1c17a319f067195f2d17035b10ee865961db46b4d7bd4be5bca93a2da2ea7` |
| docs/execution/A/ADR-A04-001-created-origin-and-initial-commit.md | `a2268dfd78fdb7bfa73efda115c044ebc6175710f045d3ab48b91bfe1ccb61be` |
| docs/execution/A/created-foundation-evidence.json | `05f47a0a8367db25d8cb349161d3719bddd3521d1caf4159a6360251185fa656` |
| docs/execution/A/logs/main-created-foundation-r2/capture.json | `5eb6cd38ea926c228622cca4ab30fe105fd6aa71786c5789a353ee7b43443277` |
| docs/execution/A/logs/legacy-fixture-copy/receipt.json | `b926d746498eb1f28b765e45ab164b4a0bc0c672fbc0fd8fd0457d124e2026d6` |

### 旧发现修正状态

**R1 SOURCE_ADDRESSED。** reserve/commit第一次clock在repository transaction callback内采集；reserve写预留前再次检查trusted confirmation；commit最后业务outbox后、COMMIT前再核schema/proof、fresh clock、原lease期限及trusted confirmation。新增确定性transaction admission推进clock、最后outbox边界推进lease/confirmation clock负向；原owner/attempt/cancelled与11点回滚成功对照仍保留。它们是确定性注入，不冒充真实跨进程锁竞争。

**R2 SOURCE_ADDRESSED（parse/bytes/upstream门）。** 新CreationSourceVerifier使用固定OPENFILM_UPSTREAM_SHA实际计算snapshot和author source两个闭包摘要，拒外部引用并比较两树摘要；完整asset path/hash/size集合比对；实际pinned OpenFilm inspectSnapshot核frame_count/fps/problems/source_digest。WeakMap保存内部proof记录并绑定command/project/snapshot/source/fact digest；普通JSON伪proof无记录。store的非重放commit没有verifier就拒绝，事务首尾均同步重验proof两树canonical path/bytes/hash/size，路径symlink替换即便bytes相同也拒绝。原“改900帧/fps、错upstream、伪proof、prove后改字节/替换路径”的负向均有明确新增case。

scope边界：该证明现在确实保护native parse和byte事实；资产license/source/media属性的真实受信catalog登记尚未接入，ADR明确保留该门，不能把byte闭包证明解释为权利授权已通过。新fixture将script_ref及两个narration_asset_id依法置null，符合空draft的允许路径，不伪造前项目脚本/真人旁白，不把frame_count0当A片。

**R3 SOURCE_ADDRESSED。** store记录schema_version；reserve callback、commit首尾和sourceFact读入口调用assertSchema，变化时独立核created_source_fact固定namespace，故旧实例中删trigger不再因CP-only复验而漏过。新增live-store drop trigger后commit拒绝case，原constructor拒绝case保留。

### created reader分支核对边界

新ProjectResolver.resolveCreated从bootstrap reservation+origin+initial committed transaction+active pointer+binding+snapshot/project_state/source fact交叉重建；拒未提交、错误created/migration混用、recovery gate、错snapshot/source/engine及symlink外逃。resolveActivated并未因created路径放宽原迁移激活规则。CreatedProjectView不虚构migration_id，publicView不泄漏source_root/source_fact；layout/inventory对created有独立分支，不查legacy catalog冒充new origin。新增真实Host对象重建layout/inventory的case只证明读取接缝，不等于生产project.create/worker已启用。

### 仍须在恢复接线解决的durability门

CreationSourceVerifier.prove的显式fsync循环覆盖author_root文件/目录及其project/base；snapshot树的新发布路径由既有SnapshotStore.publish负责文件、staging/rename及parent fsync，正常新发布成功路径有这条保证。但SnapshotStore.publish遇existing finalRoot会直接返回created:false，未再次fsync snapshot文件/目录/parent；Verifier也不重新fsync snapshot树。

因此专用恢复worker不能仅凭“snapshot目录存在+bytes相同+可签proof”就认定其rename durability已获证明：例如先前进程在rename后、parent fsync前被真实终止，遗留树在重试中走existing分支。当前worker/恢复未注册，此项作为**恢复接线门**，不重报新发布成功路径的parse/byte证明未修，也未运行故障实证。上线该恢复路径前应重建/重验snapshot durability（包括parent entry）或提供可验证的持久发布证明；不能靠typed PublishedSnapshot/created:false元数据代替。实际kill/power-loss耐久验证仍属于后续正式恢复实证。

### 本人只读核对的MAIN证据

读取main-created-foundation-r2：tsc exit0；7 files、90/90、90.68s。组成明确为creation33、旧resolver16/inventory14/activated8、CP schema8、helper8、media3。created-foundation-evidence.json的14个source_sha256与当前冻结字节全部匹配；capture.json的4个日志摘要也全部匹配。这些是**文件完整性核对和MAIN运行记录读取，不是我独立运行tsc或90个case**。

保留首次扩大回归80/86和后续90/90，不改写首次失败。legacy-fixture-copy receipt记录4个旧生成媒体独立copy且source/copy bytes SHA相同；其中2个visual媒体标记匹配冻结visual Manifest，2个旧wav仅copy hash一致，未宣称其在visual Manifest或变成A真人录音。原旧断言未因补齐ignored fixture而改变，不能把这批旧生成语音挪作人类音频验收证据。

### 当前出口

指定冻结字节上，A04-R1/R2/R3已针对性修正并有MAIN组件负向/成功对照记录；本次只读差异复核没有发现这三个旧路径仍然开放。完整创建worker/启动恢复及snapshot复用durability、生产project.create/job/context装配、真实授权asset catalog、created后续adopt/history source fact同事务写、M5 created交互、真实native ack/A片/双导出/T20与人验仍未完成。

本次记录只支持**组件源码修正复核**，不自签A04包完成或完整A通过。MAIN后续更改另冻新SHA；本lane仅追加此报告，原源/测试证明范围保持。


## 创建 worker / Host 接线预审（2026-11-10；未冻结）

实际只读目录为 `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`，HEAD `63d9de60809cf8697cb5daf12fbe13ac221d3e6e`，有 MAIN 未提交修改及新文件。本节是当前字节的预审，不是冻结候选的独立最终 PASS。本人没有运行测试、Host 或 ffmpeg，没有修改 MAIN。原 BRIDGE `50f4e19309d81ad0bf6ddc986494c2d34f32bea1` 源码与 108 项历史证据不变。

| 输入文件 | 本次读取 SHA256 |
| --- | --- |
| project-creation-service.ts | `a28efabdd588467181be517e7cbfabf07768dae16699e4dfb11d18be9042900a` |
| project-creation-store.ts | `39dc98931ebde7efb9e2f690780b735a54522d8856a7c57efbacf78b2fe0b4db` |
| creation-source-verifier.ts | `8182b0f5a6b69aa37de4b5cfa1ac4280bbf6545350b06521f60bc8f1b0f529fb` |
| agent-driven/creation-application.ts | `ecbc0e3c3473e51fda4e1f488bfddc334057aaca28d64a37efd3eebf49e8a311` |
| host/server.ts | `215a5a86e90650d227c87eaa7a8b3bbef2cb5fe4e1cd551b53633c5e3e4b63a5` |
| host/persistent-job-store.ts | `56dcb72f1784739ae2ebabf5d2eb8c74c76c0f1f5b6fe37432e910e4a4fdbe54` |
| project-creation-host.test.ts | `a2f606622b66886dfc3ea846962007c82286e4f08f0bae82fbfd3c55ed42eb3a` |
| host-close-lifecycle.test.ts | `54555c54dc7b1addd6787346241e2e5cf002ab9f16c9ad67c7010591965b931a` |

路径前缀分别为 src/host/projects、src/host/agent-driven、src/host 及 tests/agent-driven/integration；同名文件不指向 BRIDGE 旧副本。MAIN 后续正在修改，以上 hash 仅绑定这次读取。

### 复用 snapshot durability 差异

已读取 `ef9c255b3687247116d94046e4973e06dd4b8bed` 的实际差异。verifier 不论 snapshot.created 标志，对 author/snapshot 两树所有闭包文件、从内向外的目录、两树根、project/base 及 snapshot directory/project parent/global root 执行实际 fsync，之后才签发 WeakMap proof；observer 在实际 fsync 后调用，异常不签 proof。故上一节“复用 snapshot 仅验存在而未补 durability”的源码门为 SOURCE_ADDRESSED。MAIN 报告 tsc0、34/34，日志在 main-created-durability；这些不是本人独立执行结果。

### 已发现并定向修正的 worker 问题

**W-R1 取消无法收敛：SOURCE_ADDRESSED / 冻结实测待绑定。** 初始 service `750d8277a6d6db33f0ae01017b69da4cf056cb5c25f0fcfa44a4124daa82af8d` 把自身 cancel_requested 误作 lease lost 静默返回，启动又不能 acquire 该状态，留下 pending journal 使 listen 失败。当前 check 先辨自身 owner/attempt 的取消；store.fail 在 BEGIN 中允许自有 live cancel 以及无 owner/已过期的 orphan cancel，原子写 cancelled、aborted、command failed 和事件。queued/null lease cancel 也走 orphan 收敛，不伪称 queued cancel 已自动终态。

**W-R2 过期 lease reclaim 的竞态：SOURCE_ADDRESSED。** 初始版本在 BEGIN 外读 expired 再调用旧 reclaimLease，可能覆盖其他进程已经续租/换 attempt 的状态。当前专用 reclaimExpired 在 BEGIN 内重新读取 fresh time，SQL 同时匹配 job/state/owner/attempt/原 expiry/仍已过期；worker 不再调用旧 reclaimLease。该结论来自源码，并非真实双进程竞争实测。

**W-R3 generic reaper 抢占取消：SOURCE_ADDRESSED / 当前测试待 MAIN 回报。** 即使 W-R1 修正，Host 的通用 reaper 原来仍可能先把 expired cancel_requested 变 attention，导致专用 journal 无法收敛。当前 CreationApplication 只列真实 pending bootstrap Job，Host 把此集合传 generic reaper 并在读取 expired 集合后排除；worker drain 自行挑选并回收 expired running，取消仍专用收敛。默认未传集合的 legacy 语义未改。已见实际 Host 10ms reaper、强制 owner cancel lease 过期并等待70ms的测试源码；parent session41701在运行，本人未运行或签结果。

### 尚待收口的具体风险

**W-R4：并发 Host.close 可能提前关闭 SQLite（现有生命周期模式，P1预审）。** server.ts close 在捕获 server 后立即清空 this.#server，未共享关闭 Promise。第二个 close 看不到 server，即使等待同一 worker quiescence，也可走 `if(!server) revisions.close()`；第一个 close 此时还没等 server.close 完成已接收的 HTTP handler。确定性复现方案：认证 intake.read handler 进入后由 gate 阻塞，发起两个 close，再释放 handler；第二条关闭可使其 CreativeService 访问已关闭 DB。已见新增 host-close-lifecycle 负向源码，当前读取 server 字节尚未修正。单次 close 正确先等 creation worker 再关数据库。此缺陷属现有 Host 模式，不归咎于新 worker 本身；需幂等共享关闭及在途请求排空。若测试断言 Promise identity，async 方法包装 Promise 的语义也须考虑。此方案未由本人运行。

**W-R5：project owner marker 发布窗口（恢复终态证据缺口，非必须自动续跑）。** service publishEmptySource 先 mkdir(project)，随后写 owner.json、fsync marker/project/base。若进程在 mkdir 后、marker 写入前 SIGKILL，重启 mkdir 得 EEXIST 被吞，readFile(owner.json) 得 ENOENT；execute 把它当永久错误走 store.fail，原已确认创建从可恢复工作变 failed/aborted。部分 marker 同理。现六个 kill 边界 after_lease/after_source/after_snapshot/before_commit/after_commit/cancel_after_source 不覆盖该窗口。拒绝未知目录是正确的所有权边界；原预审建议原子 owner claim，但经恢复语义复核，允许明确失败且保留内容，并未找到冻结合同要求此内部窗口必须自动继续的条款，因此不要求新增 claim 机制，不以 fail/aborted 本身判实现错误。MAIN 将加 after_project_directory 实际 kill，核明确失败、保留原目录、无 origin/pointer；after_owner_claim 核同 Job 恢复成功。当前门是这些终态/内容保留的实证待补，不能通过接管任意空目录关闭。本项未由本人运行 kill 实验。

### 其余接缝与证据边界

源目录当前校 canonical project/owner marker，已有 source 必须是真目录且 film.html 等于固定创建模板；新 source 在独占 staging 写入并 fsync 后 rename，不覆盖未知已有 source，失败仅删除自身 staging。verifier 仍独立核全部实际源树及 snapshot，未以模板字符串代替正式 proof。除上述 marker 窗口，未在本轮发现可由 HTTP 任意路径或伪 owner 接管目录的入口。

project.create 使用 authenticated principal，拒 native_bridge，store 核 trusted confirmation/Brief/Q&A closure；job.read 先按 principal 找原 receipt，再比对 URL project，不接受只凭 job_id 的跨 project 读取。没有发现这两个 handler 的具体跨 scope 绕过。recoverBeforeGeneric 在 generic adoption/journal recovery 前收敛专用 bootstrap；有其他 live owner 或 retryable 未收敛时拒启动，未伪装 ready。worker.close 停 timer 并等待 running promise，单次关闭不会在 worker 仍执行时关 DB。

CreationApplication 当前未注册 instance/health/context/job.cancel 等完整生产入口，artifact.put 因无真实验证 port 主动不可用。MCP facade 会先作 instance handshake，因此 HTTP 创建通过尚不能证明完整 SDK→创建链可用。取消测试通过内部 PersistentJobStore.requestCancel，不证明 HTTP job.cancel 已挂载。仍需真实发现/监督元数据、context、可信 UI 写路径、取消路由和 runtime factory 启用；不得用测试 instance 元数据冒充 supervisor 就绪。

MAIN 回报 session57723 的六边界实际 SIGKILL 恢复11/11；本人只读过测试源码，没有独立重跑。当前 session41701（reaper/legacy job 回归）结果另由 MAIN 回传。冻结前仍为 PRE_REVIEW，组件/HTTP/恢复结果均不等于完整 A04、A 阶段影片、双导出或人工验收。

补充状态：MAIN 已实际执行 W-R4 负向并回报 `database is not open`，正采用共享非 async close Promise 修复；这是 MAIN 执行的复现，非本人独立重跑。W-R5 按上述恢复语义降为证据待补，未找到要求全部内部窗口自动成功的冻结条款。
