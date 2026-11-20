# 原 NativeExpected / NativeAck / Studio / Context 组合设计

状态：DESIGN_DELIVERED，实施与所有新增业务门 NOT_RUN。基线 MAIN `4f2bb06be6d26dab240e1faeed0163f3edb7c920`，上游 `e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3`；源码分析以 Git blob 为准，不以 PRODUCT checkout 或后续 MAIN tip 代替。文档不是 release、实现或生产验收。MAIN导入dd32两blob的84纯用例/tsc0只证明生命周期组件兼容；D10 bounded ACCEPT只证明其模块。

## 已存在的组合与实际缺口

| 真实实体 | 已有行为 | 本次必须补的行为 |
|---|---|---|
| CreationApplication | 同库creation/CommittedSnapshotAuthority/NativeWorkspace、原认证、原#openNative、原UI delegate | 153行Context native端口为undefined；223行entry无nativeObservation。构造一个组合、传同一选择authority，关闭前撤销所有入口并drain。 |
| CommittedSnapshotAuthority | #bind绑定已提交事务；#verifyAdoptedNative核不可变plan/adoption/source/geometry/consumer graph及实际原生clip IDs；legacy fallback保留 | 返回SnapshotClosure但关闭FD，不能单独当retained proof；将验证结果作为私有能力给Context/selection/reader复用，避免再次走legacy M4拒绝rich clips。 |
| CreatedNativeWorkspaceService | 真复制committed source，登记issued view，保留根/目录；rootFor重读旧entries | isPrepared不证完整字节，rootFor不证新增文件；增加issued-view私有lease，保留父目录、实际副本与负事实，不以root字符串授权。 |
| OpenFilmNativeExpected | 已审prove/assertCurrent/release/close、绑定baseline、晚到清理、sticky失败、批准loader | 注入真实reader；只扩loader暴露已批准015的现有parse exports，不改变proof生命周期及pin策略。 |
| NativeObservationService | 原document/四hydration/selection envelope与epoch、独立expected比较 | 缓存Ack早退与read仅检查binding，缺完整闭包复验；controlRevisionOf重读当前值不是起点；需要整轮admission/drain及事务内最终fence。 |
| NativeAckStore | 原cp_a0_native_ack、同RevisionStore/ProductSqliteRepository写入 | record事务内缺current/proof fence；MAX+1并不天然去重同一round，需私有一次性permit和每session串行round。绝不新增第二Ack表。 |
| ProjectContextService | owner检查、原run/jobs/artefact及最终DB绑定检查 | 当前先走layoutFor/engine.inspect，rich box/style/volume可能被legacy不完整拒绝；created已验证producer路径复用专用facts，legacy未知错误照旧保留。 |
| ControlledStudioAccess/Gateway/managed Studio | 原cookie/Origin/Native-CSRF、Host生成bridge ID、原Studio document/hydration/selection回调、read allowlist | 复用入口，不裸HTTP确认、不扩大native写；late open/exchange/reentrant callback与UI grant最终撤销要补审/用例，仍单timeline/selection/clock。 |

## 实体和一层依赖（拟定，不冒充现有API）

1. `CreatedNativeSourceReader`（新 `src/host/agent-driven/created-native-source-reader.ts`）实现原NativeExpectedSourcePort。直接依赖CommittedSnapshotAuthority私有facts、NativeWorkspace私有lease、RetainedNativeClosure、已批准015 loader、固定sidecar纯消费者。媒体probe作为文件内部私有实现，无HTTP根参数。
2. `RetainedNativeClosure`（新 `src/host/agent-driven/retained-native-closure.ts`）只负责源/副本FD、正负读取/目录枚举、bounded text与stream hash、同步verify和lease内probe；复用PublicationCleanup的all-attempt/sticky原则，不改原发布器。
3. `CreatedNativeSelectionMapping`（新 `src/host/agent-driven/created-native-selection.ts`）只依赖同一verified facts能力和workspace/current检查；返回原mapping端口的shot_ids/frame区间，不自己造版本，不自造timeline。
4. CommittedSnapshotAuthority增加 `acquireNativeFacts(project, transaction, principal)` 私有opaque结果；共享原#bind/#verifyAdoptedNative实现，提供geometry、解析doc/track-index、consumer graph、rights、closure及`assertCurrent/release`。接口返回必须有实际retain；旧render readSnapshot返回合同不变。bootstrap无adopted producer走现有严格fallback，不用人为过滤problems。
5. NativeObservationService负责原生会话、round、版本变化和live loaded；NativeAckStore只在同库同步事务内核permit后落原表。CreationApplication负责装配与Workspace/open原生命周期。依赖不成环：mapper读取verified facts不调用Expected/Observation；reader读取selection epoch纯同步快照不触发observe；binding.isCurrent不回调currentSelectionVersion；expected只消费reader，Ack不反向启动source读取。MAIN/BRIDGE负责selection持久epoch和Host生命周期总顺序，见CONTRACTS。

### 一次真实 readSource

A. 首先从注册workspace_ref查到唯一issued view+owner+transaction+native ID；拒绝伪对象、跨实例ref、旧generation、recovery gate及任一binding冲突。记录不可变baseline（commit/control/selection epoch/session/generation/workspace）；binding.isCurrent仅是会话检查之一。
B. 从原已提交transaction获得verified native facts；独立打开快照source与实际workspace，二者各自retain父链、文件和目录。验证完整source digest、registered media/rights、producer receipt/plan/geometry/consumer graph、实际film parser。SnapshotClosure既不是副本证明，也不是长期FD证明。现有CommittedSnapshotAuthority.#read对每个entry使用handle.readFile，包含媒体；新acquireNativeFacts不可直接调用这条无界内存路径再假称streaming，应抽出同一验证规则并用bounded stream hash取代媒体整读，保留旧render合同和其错误语义。
C. 比较快照entries与workspace的authoritative entries：relative path集合、bytes、SHA全等。source和workspace各自的inode/dev/mtimeNs/ctimeNs保留；复制后inode当然可以不同，但各自等待期间必须保持。额外native派生项按CONTRACTS精确分类。未知新增source、未知副本项、sym/hardlink外逸、路径别名均拒绝。
D. 从retained film bytes按UTF-8读取固定上游readProjectFilm对应文本/normalized value/doc；要求文本重新编码与原bytes一致（无效UTF-8拒绝），不trim/改换行/去BOM。film_sha256取原bytes；native_rev为上游revOf(text)的SHA256(text).slice(0,16)，复用已留存中/emoji/CRLF/BOM五向量。
E. 构建015 ExpectedProjectionInput：settings/markers真实读取，只有证实ENOENT才使用明确{} / []；用已批准模块的parseProjectSettings/parseMarkers规范化。clip_refs来自实际producer graph+registered media或controlled artifact receipt，不能从UI反推。media_facts来自同一实际media bytes的probe。span_facts优先numeric_source_only；非numeric/page无可验证source长度时unsupported，禁止猜span。source_manifest/rights/media/listing digest均由各自独立取得事实计算，不由浏览器摘要回填。
F. 完整枚举上游listFiles相关目录；video order是path.localeCompare(undefined,{numeric:true})后过滤video，非raw readdir/字典序/storyboard顺序。与实际Studio使用相同Node/ICU/locale，保留环境指纹；caption translation目录另保留原readdir顺序，不用video排序替代。
G. 对computeNativeEffectiveSidecars供应完整text/negative/listing/media facts。采用有限依赖发现迭代：仅补其missing中符合闭包安全路径的事实，每次校验从同一retained快照取得；上限4096项/深度/文本总量，无法闭合则unsupported而非partial。media路径只供身份事实，不读成UTF-8大字符串。结果consumed_paths/negative_lookups/directory_lookups/media_lookups逐项反查FD账本，缺一项拒绝。
H. 最后同步verifyClosure再次核原DB/owner/producer引用、实际源与副本的正负项、listing和media/probe输入。返回deep frozen facts，retained责任在Promise成功交付瞬间转移Expected；交付前任何失败reader全清理。不能返回可变facts供调用者补字段。

## Context与选择

Created Context先按真实origin选择created facts分支，用实际active commit+control+owner取同一authority；富native字段由固定parser和producer lineage证明，不再先要求legacy layoutFor成功。原legacy/migrated路径及全部unknown problems保持原失败语义。Context本身不render、不prepare、不启动Studio、不假造capabilities或Ack。最后同库current fence前，native读者同步重验loaded lease；不把先前await返回的loaded对象直接放入响应。

Selection依据实际doc track/clip membership与preparedSourceConsumerGraph，不仅拆`shot-`字符串。visual与concept同一shot去重，按真实时间/稳定shot顺序输出；narration clip无shot，纯narration/file/未知layer或不可解析loc返回null，不能选择全片充数。已证明clipId的layer/region才可映射；track必须匹配实际doc index，字幕ref必须绑定真实cue及其clip，不能按字幕文字猜shot。

时间与range使用实际fps num/den和半开区间：点t映射floor(t*num/den)的一帧，t<0/非有限/t>=片尾拒绝；range开始floor、结束ceil并限制到已证明timeline范围，不静默接受反向或空区间。显式clip refs取精确graph区间，不从probe推storyboard时长。多视觉重叠返回所有相交shot（concept去重），不任取第一项；不连续shot集合保留shot_ids，frame区间为明确bounding envelope，后续修改必须以shot_ids为准，不能把间隙隐式选中。未知混入已知refs整次拒绝，不丢弃未知项后签成功。

revision0/uncommitted：无snapshot能力，Context原创建状态/unknown，不能造native reader。revision1空bootstrap、frame_count0：Context可读但Selection=null、无伪0..1区间；真实可用选择authority可记录“已证明空基线”epoch，不能把未配置服务当0。空片Ack不在当前#profileComplete的支持范围，不通过修改它伪loaded。真实首个adoption后按实际clip选择取得loaded。

## Ack和缓存的最终线性化点

每一轮在任何callback前登记pending，捕获同一ControlRevision、session binding、sequence、view/document/hydration epochs和selection epoch。已有ack也必须走live lease验证；缓存身份相同不构成字节证明。建议保留每session最近成功Expected proof，Context read/重复observation同步assertCurrent；替换时先撤销旧live状态再release，清理不确定后不再loaded。不保留proof时必须重新prove，不能沿用现有早退。

NativeAckStore增加Host私有一次性permit（只能Observation构造/注册）并在原repository.transaction同步体执行：读同库current→核captured baseline与recovery gate→expected.assertCurrent→再次读commit/control/selection/session私有epoch（防callback重入）→无await无外部callback地分配ack_seq并insert。每session round互斥/合并同round，成功permit不可第二次落行；历史latest不是当前loaded的证据。失败整个事务回滚且不插行；落行后release失败只撤销live loaded并报告cleanup不确定，不删除已存在immutable历史事实或假称未写。

现有ProductSqliteRepository.transaction在返回Promise前同步执行atomic/scope，此事实可复用，但必须把fence显式放入事务内，不能依赖“调用紧邻”。NativeAck DTO/SQL保持原样，control/epoch只作为私有permit，不塞公共字段、不另建Ack表。

## 生命周期

CreationApplication装配次序：原creation/snapshot/workspace/assets→private reader/mapper→Expected（真实approved loader）→同库AckStore→Observation（共享selection authority）→Context。#openNative在prepare、supervisor.ensure后重验authenticated owner/generation/control/actual view，注册opaque workspace ref和nativeObservation grant，再issue原entry；readSource不得在证明时调用prepare悄悄重建副本来消除被测污染。

关闭分两层：先同步停止新native open/UI exchange/observe和业务新写入口，撤销active loaded并标close epoch；等待已受理opens/observations/reader probes及BRIDGE recoveries/adoptions完成或受控取消。等待期间assets/tasks/selection/DB仍有效；Expected.close可同步撤销，但reader晚到FD仍须被接住并清理，关闭不能因Expected接口是void就跳过Promise drain。全部清理逐项attempt并聚合主错误与cleanup错误，不重试数值FD。

随后关闭Expected持有proof、reader（等probe真实退出）、业务publisher/lease与资源使用者，再关闭assets/selection；NativeWorkspace.close只停止准备I/O，已给Studio的根保留。Host实际停止Supervisor/原生children及Gateway后才disposeAfterNative删除副本；原生停止失败时不删仍被使用的目录，报告UNKNOWN而非假全关。DB最后；MAIN当前Host先await application.close且任一异常会短路后续关闭，需与BRIDGE统一all-attempt/final DB所有权规则。没有第二个关闭编排器。

## 交付时基线差异

只读观察MAIN HEAD已前进至 `e2eff61b464d75d36598103d718cd2a75db5dfda`，相对固定4f2的非文档改动为adoption-coordinator.ts、history-service.ts、project-coordinator.ts及两个恢复/采用测试；完整路径清单在RELEASE_RECOMMENDATION.json。上述22项本设计读取的MAIN源/工具blob仍与实际字节一致，13项所读上游文件与固定e70d9d93一致。本设计没有把后续恢复所有权修复当已复审，MAIN须在N4公共装配release前与BRIDGE合并该差异；唯一原dirty仍为保护AGENTS。

## BRIDGE ctx410 联合设计对齐（msg_c59175e27004）

已读 `../host-recovery-composition-review/{REVIEW.md,ACCEPTANCE_CASES.md,CODE_MAP.json,RELEASE_RECOMMENDATION.json}`。BRIDGE基线为abf34c9，本设计仍固定4f2bb06be6d26dab240e1faeed0163f3edb7c920；Git确认两基线src差异仅openfilm-native-expected.ts，因此BRIDGE所述旧Expected生命周期必须替换为本设计已审的导入版本，不能把其“待导入”文字当当前事实。HEAD所含后续所有权过滤修复仅记差异，不在本次设计签审范围。

共同采用一个CreationApplication/RevisionStore/creation store/tasks store/PreparedDraftVerifier/native workspace registry/Observation/AckStore；恢复与正常adoption共享同一verifier、资产、selection authority及durable publication roots。先构造这些真实依赖，再完成bootstrap与专用task恢复，然后由Host捕获有限恢复集并调度；无用户或worker入口，generic边界重新分类。Legacy入口缺created依赖时仍须排除owned行并保留项目gate。恢复读取选择authority，不等待Studio打开或loaded Ack；否则startup recovery gate与native.open构成循环。

**S-01仍是未解决的合同冲突，不宣称BRIDGE已同意。** BRIDGE推荐重启无session诚实返回0、旧非零plan走原有失效/补偿；本设计推荐持久单调epoch、恢复时保留epoch而不恢复live选择/Ack。两者不能同时实施：特别是旧plan=0、新session重新从0开始，以及stale session第一次读抛错后第二次读回0，均须排除意外复授权。推荐保留持久epoch方案，但它涉及新增private DDL，与BRIDGE当前“不得DDL”范围冲突；MAIN必须单独批准准确schema/迁移/恢复语义或选择可证明无ABA的替代方案。未裁决前不发布selection/Host组合实施，不在Native ticket偷偷新增表，也不从plan回填版本。真正无session不等于配置缺失、未知或关闭。

关闭的共同契约：Host同步阻止所有新业务与native会话/观测入口，撤销对外loaded可见性，但不立即销毁恢复所需的selection读取能力；保留已受理startup全扫描及adoption/publisher的内部依赖，待它们和已受理native opens/proofs/probes实际终结后再释放资源。Expected同步close不是整个异步drain；在仍需proof的已受理操作结束前不得无差别调用导致中途依赖失效。若选择受控取消，必须先确认该操作取消且子进程退出。外部closed与内部draining必须分开表达。所有独立cleanup尝试并保留主错误；有活跃依赖则不强行关闭DB/删除根。原生进程确认停止后才dispose工作副本，DB最后；唯一Host close promise同时覆盖startup失败、正常close和重入。
