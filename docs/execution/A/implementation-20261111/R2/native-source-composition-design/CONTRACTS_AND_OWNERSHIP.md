# 私有合同、保留资源与唯一所有权

全部拟定接口必须由MAIN精确release确认；本文不修改冻结CP-A0 schema/SQL、NativeAck/Context/Selection DTO、七方法EnginePort、原wire envelope或原Studio写入边界。

## 已有与拟定接缝

| 接缝 | 4f2bb06真实状态 | 拟定实现约束 |
|---|---|---|
| NativeExpectedSourcePort.readSource({binding}) | 已存在，仅接口；facts含entries/film/expected_input/style/captions/retained/verifyClosure | 不改公共形状。新reader返回仍打开的资源，failure自行清理；returned entries是committed authoritative entries，不把workspace cache混进source digest。 |
| NativeExpectedRetainedFile | relative_path/sha256/bytes/verify():boolean/close():void | 对外无fd/path。每个真实源与副本leaf为独立资源对象；source/workspace可同relative_path但不能按path去重资源。verify失败false，禁止异步；close先标释放、allattempt、sticky失败。目录与negative资源由reader私有lease共同持有，随最后leaf close释放；film必存在，不能靠空retained数组漏放目录。 |
| VerifiedNativeFactsLease | **新增** CommittedSnapshotAuthority方法，opaque注册对象 | geometry、真实doc/track-index、consumerGraph、snapshot closure、rights/producer digest是只读值；assertCurrent同步核当前授权及retained闭包；release唯一所有者。不能公开任意root，不能用结构形状仿造token。旧SnapshotReadPort不变。 |
| NativeWorkspaceLease | **新增** NativeWorkspace登记ref与acquireExpectedLease(issued view) | workspace_ref由Host生成且仅在本实例登记；owner+project+txn+snapshot+revision+source/nativeId绑定；`isPrepared`仍只是轻量liveness，不能替代lease。旧view在新prepare后立即拒发新lease，已持有者验证失败并最终释放。 |
| 015 loader解析器 | tracked expected-projection.mjs已export parseProjectSettings/parseMarkers，loader返回接口未暴露 | 最小扩NativeExpectedLibrary及loader返回值：从同一已验证module取得这两个函数并校验类型，不能直接import tools绕过验证，也不需改015已批准字节。若实际批准artifact无对应export，停止为BUILD_UNSUPPORTED，另审pin而非fallback。 |
| NativeAck commit permit | **新增** Host私有一次性对象 | 一次round绑定current baseline、Expected proof和Observation私有状态；record仅同库同步scope消费，不接受HTTP callback或客户端assertCurrent；无第二Ack表/queue。 |
| NativeContextPort | 当前仅异步read返回值 | 增加Host私有assertCurrent(project,facts)或同等opaque read lease，在Context最终同步fence调用；不扩大wire DTO。loaded必须能验证 retained proof；unknown/pending不具写能力。 |
| Shared selection authority | 当前Observation本地session版本，normal/recovery消费者接端口 | 按下节MAIN裁决落地，所有created prepare/apply/publisher/recovery使用同一个实例/账本。PRODUCT mapper不自建counter，BRIDGE不得复制plan.selection_version或默认0。 |

## retained闭包：正、负、目录和大文件

新RetainedNativeClosure借鉴原RetainedSourceTree的fd-anchored父链和同步stream hash，但不扩大原发布器类的接口/风险。所有component使用O_NOFOLLOW，目录O_DIRECTORY，leaf O_NONBLOCK+regular file校验，检查真实路径与持有dev/ino；持有父链至Host已固定根。snapshot与workspace两棵树分别建立。拒绝symlink、socket/FIFO/device；同字节替换inode、父目录整体移走再同名创建、相同size/mtime但ctime或hash改变均失败。闭包安全根也必须核identity，不能只验证末级。

每个正file记录size/hash/dev/ino/mtimeNs/ctimeNs，bounded 64KiB buffer流式散列，不readFile大视频。每个相关目录记录实际names（caption保序）及name→type/identity；对negative记录最近存在父目录FD+缺失尾路径；sync验证重新lookup确认仍ENOENT。ENOTDIR、EACCES、ENOMEM、EIO、JSON损坏不能伪装missing/default。目录缺失的caption依赖可供应已证明空listing，但必须登记missing-dir事实；以后创建空目录也算闭包变动。

源全树membership必须核对；workspace有效文件+允许派生文件组成精确集合。先取得目录/FD，再读、再枚举/验证；中间发生新增/删除只能重试整个新round，不混用两次epoch事实。任何consumer返回依赖都在账本里；目录不允许通过“只重读manifest既有entries”自证。sync verify流式重hash全部相关源/副本media，开销受预算限制；不以stat缓存绕过所需byte proof。若真实影片预算不能承受，必须另审只读封存机制与proof语义，不能暗改verify只看mtime。

建议实施预算（私有可配置且配置由MAIN批准）：4096路径/目录项每表、单文本8MiB、文本总64MiB、media流式缓冲64KiB、每proof最多2个probe并发、单probe30s、stdout4MiB/stderr256KiB；budget溢出CAPABILITY_UNAVAILABLE/unsupported且无Ack，不截断成成功。FD总量先估算，超过实例预算拒绝，禁止raise默认并发掩盖EMFILE。预算不是A素材长度降级，60–180秒真实素材必须实际跑过。

交付前失败由reader清理所有已打开资源；交付后Expected负责close，reader不得再关同一FD。一个close失败立即latch，继续attempt剩余项，将原错误与全部cleanup错误保留内部不可枚举cause，对外不泄露绝对路径。reader.close停止admission，等待所有probe和read；已交付资源仍在Expected账本，不争抢关闭。late read成功交付Expected若已关，会走既有allattempt清理。FD数值不可重试；child还活着不关闭其输入lease。

## 派生副本策略：逐项白名单，不泛忽略 .film

固定上游文件证据：projects.mjs:101–145首次open产生`.film/id`及`.film/.gitignore`；derived.mjs:54–101以rel/size/roundedmtime生成probe cache；derived.mjs:100–142生成posters/frames/waves；pageframes.mjs:58–109生成pageframe三件及film缓存；proxies.mjs:47–55生成proxy。原Gateway controlled模式拒绝原生POST/PUT，允许GET media/poster/history/settings/markers/subtitles，故不能假定GET没有磁盘副作用。

| 路径/类别 | 源权威及workspace规则 |
|---|---|
| film.html、producer metadata/draft-plan、页面/字体/注册media、原manifest所有条目 | 快照与workspace精确相等；任何新增/缺失/内容改变拒绝loaded。自带HTML/字体不由浏览器加载成功自证合法。 |
| .film/settings.json / markers.json / subtitles.json、media旁`.vtt`与语言translation | 如果源有则副本一致；源无则必须副本仍无，才能证默认。新建这些不是“合法cache”；在受控native编辑后保持dirty/unconfirmed，走原影响/采用/新快照再重开，不直接Ack副本。 |
| .film/id | 仅实际supervisor.open返回的native_project_id加换行，校验上游允许格式和唯一issued workspace；记录真实字节/identity。不能从此文件反向授予project ownership。 |
| .film/.gitignore | 上游固定`*\n`；只允许实际派生副本，retained验证字节；不能忽略整个.gitignore变化。 |
| .film/cache/probe/<20hex>.3.json | 不是trusted事实。若存在，按上游rel/size/mtime规则绑定key，内容与独立同bytes probe的native normalized字段一致才允许；缺失为负事实，新出现则旧proof失效、新round核对。不能用此cache喂独立expected。 |
| .film/cache/posters/<20hex>.jpg、frames/<20hex>-<ms>-<width>.jpg、waves/<20hex>.json | 仅上游实际已绑定media key及相应参数，有限regular files，无link；不是expected/source authority。创建/替换使当前proof membership/identity失效，下一round允许经分类稳定后的派生物。wave duration不得当probe来源。 |
| .film/cache/pageframes/<24hex>.jpg/.json/.stamp、film-duration.json/film-poster.jpg（pageframes.mjs:125/170固定常量） | 页面preview派生项，json引用路径必须闭包内，不能被reader用于填未证span/duration。只可按固定上游配对规则接受；实例无法证明来源/配对则unsupported，不追加宽泛glob。 |
| .film/cache/proxies、audio、export、commits、history-files.json；.film/history/chat/logs | 默认不授本阶段写/忽略。只有实际read路径确需时，MAIN在phase A冻结各producer+filename+dependency规则后逐项加入；不得把目录名本身当允许任意文件。受控POST代理/导出不因设计变成开放入口。 |
| unknown、.git、外部/符号链接、任意新增metadata | fail closed；缓存临时`.<12hex>.tmp`遵循atomic.mjs也只视为正在变化，当前round拒绝/稍后重试，不能忽略全局*.tmp。 |

这一严格策略可能在缓存生成期间短暂pending，允许完成后新round验证；不允许不断重建workspace删除未知文件再宣称原污染从未发生。精确cache实际需求是release前核定项，当前未跑Studio故不能宣称枚举已穷尽；真实路径case必须暴露任何遗漏，不得为调绿放开 .film。

## 同bytes媒体probe接缝（需MAIN明确批准）

拟定内部 `probeRetained(mediaLease, signal)`，无HTTP/public DTO。传给execFile的路径仅为lease闭包里生成的`/proc/<parentPid>/fd/<fd>`，绝非`/proc/self/fd`（child的self不是Host）；不得让客户端传fd/root/path。保持对应FD、父目录与named identity直到child真实exit/close被确认。启动前/退出后/同步final guard核完整bytes和路径绑定；取消须终止自有child并等待回收，再释放FD。proc不可用则unavailable，不回退可换位普通路径。

命令语义复现上游derived.probe：ffprobe -v error -print_format json -show_format -show_streams <heldPath>；允许执行的二进制由Host固定工具配置提供，不安装/联网/更换。以format.duration及首video stream/是否audio、avg_frame_rate四舍五入两位、rotation交换宽高等上游规则规范化，再映射015 factsOfProbe约定的duration_ms/fps/audio（workspace-resources.ts:118–120：正duration取Math.round(duration*1000)，不能自行多次round）。caption用同一次probe的duration秒/audio。输出错误、缺字段/非finite按实际格式分类；不能因有字幕末尾/trim/metadata.duration而补成功。page/still确定时长仅在已验证producer明确数字语义下使用host_deterministic_source，不能把浏览器截图当probe。

不复用上游unbounded ffmpeg PCM waveform作权威，也不先将整视频readFile再写临时拷贝。内部probe证据digest绑定工具版本、argv profile、输入sha/bytes、normalized result与ledger identity；媒体许可证/登记digest仍独立来自真实资产事实。

## selection与BRIDGE Host恢复的唯一共享决定

最低安全条件：配置缺失、构造失败、关闭、未知/过期owner不可返回0。已装配服务“已证明未发生选择”的零是实际状态，不是兜底。session-local版本重置可能让旧plan值偶然相等，直接把当前Observation.currentSelectionVersion接给恢复不够。

**推荐MAIN在精确公共票中增加单一private selection epoch账本**：拟新`src/host/agent-driven/created-native-selection-state.ts`，独立`created_native_selection_state`表（不是cp_a0 namespace，不是第二Ack表），字段project_id PK、selection_version安全整数、last_mapping_digest可空、binding_revision/snapshot/source、status(known/empty/unknown)。写入只由原受控Observation或Host显式invalidate生命周期，数字单调递增，CAS同库；无新HTTP DTO。首次仅由verified committed bootstrap初始化0；已有历史prepared plan而无账本不能自动初始化0，应明确迁移/对账策略。

正常映射变化推进epoch；重复同mapping不推进。新native session/workspace/文档invalidated推进unknown epoch并撤销loaded，旧plan自然stale；纯同session view重载可保留lastMapping用于确定重复，仍先撤销hydration/Ack。Host重启恢复持久epoch而不凭空推进、不恢复live selection或Ack；没有新的原生session时该epoch仅表示“自最后受理选择之后无新事件”，供原历史plan比较，并不声明浏览器loaded。新开session立即推进，所以其后旧plan不会误匹配。损坏/缺记录/未知升级状态应返回unavailable，不能猜。

MAIN必须与BRIDGE确认这套**恢复语义**：可验证持久epoch允许原published恢复继续原闭提交；若实际epoch变化则按既有selection-changed补偿；未知需持久诊断/对账入口，不能无限defer同时禁止打开导致死锁。选择账本不授予批准、不能更改closed commit既有检查。若MAIN拒绝新增private表，必须先给同等持久、重开无ABA的实际authority方案；不能以当前session计数或plan值替代。此决定是后续组合release阻塞项，不是要求本设计阶段跑迁移或降低真实验收。

所有consumers（CreatedSourceChangeService、正常Adoption、Publisher、CreatedSourceRecovery、Context/Observation）引用同一选择authority；BRIDGE唯一实现/装配owner，PRODUCT mapper仅贡献真实映射。server.ts/creation-application.ts由MAIN单写，两个设计不得各复制一套服务或各自改close顺序。

## 与BRIDGE的精确重叠与唯一所有者

以下是实施release建议，不是已存在接口或当前写权限；MAIN发放时逐路径选唯一writer，不允许两份任务同时取得同一文件。

|路径/实体|交叉需求|唯一责任与处理|
|---|---|---|
|src/host/agent-driven/creation-application.ts|BRIDGE recovery/adoption共享依赖、PRODUCT reader/Observation/Context/grant|MAIN统一装配；同一构造函数内创建一次，提供内部能力引用，两个lane只交契约|
|src/host/server.ts|startup scheduler/admission、native drain/stop/DB关闭|MAIN唯一生命周期编排器；统一startupPromise/closePromise，禁止各自finally关闭DB|
|src/host/agent-driven/start-runtime.ts|FD9、durable roots、startup失败清理|MAIN/BRIDGE独立精确release；Native ticket保持只消费，不能改launcher或加第二锁|
|src/host/m5/native-observation.ts + proposed created-native-selection-state.ts|真实映射及加载证明、所有恢复/发布使用的选择authority|MAIN裁决S-01；一个authority实现，PRODUCT mapper不维护第二版本计数器；private DDL需单列授权|
|proposed created-native-source-reader.ts、retained-native-closure.ts、created-native-selection.ts|BRIDGE prerequisite中另一组新文件名表达相同职责|统一使用本设计三个名字；不另建created-native-expected-source.ts或created-native-selection-mapping.ts重复服务|
|src/host/m5/openfilm-native-expected.ts|真实reader/approved loader及晚到FD|以4f2导入生命周期为底；Native writer最小扩展，BRIDGE仅消费异步外围drain，不恢复abf旧实现|
|tests/agent-driven/integration/created-native-ack.test.ts|84项继承与组合|Native writer保留原断言；Host交叉case在各自新test文件，避免同时编辑本文件|
|src/host/projects/project-coordinator.ts、src/host/adoption/adoption-coordinator.ts、src/host/history/history-service.ts|三项ownership过滤缺口|MAIN另票修复/验证；本设计不改、不以旧缺陷认定最新HEAD仍坏；新release先核对差异|
|created-source-recovery/adoption-service/publisher.ts、project-creation-service.ts|恢复、真实生产入口、bootstrap可用性、crash barrier|BRIDGE/MAIN另票；Native不扩allowlist，不改原闭提交、授权和补偿算法|

根目录共享合同：MAIN从原owned runtime绑定createdRoot=`<runtime>/projects`、taskRoot=`<runtime>/projects-tasks`、snapshots=`<runtime>/snapshots`、建议createdPublicationRoot=`<runtime>/created-publication`；正常adoption与recovery必须传同一private/stage域，实际每project join约定须按既有Publisher核定一次，不能双加project_id。旧adoption-stage保持独立。Native工作副本可generation-scoped，但必须来自Host已注册opaque workspace能力，不能拿durable publication根当Studio根，也不能让journal/HTTP选择根。拒绝symlink、危险重叠、设备不匹配；不移动历史pending目录迁就新默认值，保全后报unavailable/attention。FD9保持原launcher协议，Native reader只拥有自己的FD/probe children。

建议内部能力边界（名称待MAIN最终票冻结）：Host提供共享selection authority、注册workspace能力、固定roots和admission guard；Native提供readSource、map、session绑定、同步loaded撤销与可await的操作drain；BRIDGE提供整个startup recovery Promise及业务操作drain。Host将同一selection能力传入change/adoption/Publisher/recovery；native无权调用任意recovery或绕过gate。拒绝新公开DTO、ignore-ID列表、force标志或用loaded Ack作为恢复前提。
