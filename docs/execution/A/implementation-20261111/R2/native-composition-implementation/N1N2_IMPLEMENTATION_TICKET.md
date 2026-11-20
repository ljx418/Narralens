# N1N2：真实NativeSourcePort及retained source/workspace事实实现

MAIN已授权本阶段实际实施，唯一代码writer为PRODUCT Codex管理的Claude子节点。当前base与十个精确路径见同目录N1N2_RELEASE.json，必须先读MAIN_DECISIONS.md和实际MAIN AGENTS。不要在过期PRODUCT checkout写或测，实际每条源码/测试命令cwd均 /mnt/c/workspace/videoworkline/Narralens-agents/main-integration。原Task e115789b的D10写入前检查点属于历史任务，不恢复D10旧candidate；本任务以精确release为准。保护原AGENTS dirty与PRODUCT原用户dirty，用户授权最新429STOP优先于旧goal自动接手。

## 结果和范围

完整实现设计四文档中的N1+N2，而非只写接口或手填expected facts：实际同库committed authority+两真实树保留闭包+原生读取事实/正负listing+同FD真实媒体probe+固定消费者/015真实loader→现有NativeExpectedSourcePort。N1N2不接生产HTTP/Studio/Ack/Context，不实现selection表，不能把组件通过宣称NativeAck/影片/A通过。保留原rich created lineage检查与legacy未支持拒绝，旧render SnapshotReadPort原形不变。

先读 canonical R2/native-source-composition-design/{DESIGN.md,CONTRACTS_AND_OWNERSHIP.md,DEVELOPMENT_AND_ACCEPTANCE.md,RELEASE_RECOMMENDATION.json} 和 R2/native-reader-preflight/READER_BOUNDARY.md、verification.json、listing-semantics.json；再读原源相应方法和固定上游。读代码核对base/hash不是把文档当已执行验证。

## 实体/合同锁

1. 新RetainedNativeClosure：由Host固定安全根取得/保留父链、两棵树各自file/dir身份，正项流式hash、缺失项最近存在父FD+负lookup、listing含空目录与实际顺序。每个component O_NOFOLLOW、regular file/O_NONBLOCK、目录O_DIRECTORY；拒绝symlink/FIFO/socket/device/别名/逃逸。源全membership、workspace authoritative entries与具体允许native cache精确集合；mtime/size相同仍核ctime/FD/hash与根/父链。同步verify不能async或默认true。复用原cleanup原则而不改发布器/RetainedSourceTree。
2. CommittedSnapshotAuthority新增Host-private opaque VerifiedNativeFactsLease，复用原bind/verified created producer/source/rights/clip graph规则并实际retain。拒绝clone/跨owner/project/transaction/过期commit能力；不能拿旧readSnapshot返回的JSON closure当FD证明，也不可先无界readFile大媒体再宣称流式。旧render合同保持且真实legacy问题不删除。
3. NativeWorkspace增加issued-view/ref登记与private acquireExpectedLease，workspace_ref由Host生成并在本实例登记，绑定owner/project/transaction/snapshot/revision/source/nativeID/generation。任意root/ref字符串不能造能力；不在readSource中调用prepare自动洗掉dirty副本。新prepare/旧view失效后已持proof失败、新lease拒绝，已有Studio根仍保留到原native停止确认，不提前删除。
4. 新CreatedNativeSourceReader实现现有readSource({binding})形状。用immutable baseline+实际DB/owner/producer与两retained闭包；film原UTF8 bytes/hash/native rev按上游revOf(text)精确复现，不trim/BOM/换行重写。entries保持committed source entries，workspace cache不写source_digest。expected_input、style/captions由真实retained正负文本、原native listings、实际媒体事实经固定消费者生成，不能观察UI摘要自证。
5. 015 loader最小扩实际NativeExpectedLibrary/已验证loader暴露同一approved module的parseProjectSettings、parseMarkers并校验类型；不能直接import tools绕过批准/改pin或artifact。现有OpenFilmNativeExpected.prove/assertCurrent/release/close及已独立修复的baseline/late cleanup/sticky主体保持原字节，loader调整所必需类型/夹具可扩但不能弱化84条断言。实际approved artifact缺export为BUILD_UNSUPPORTED交MAIN，禁止fallback。
6. 私有接口可在上述闭合实体间按设计细化并在动手前写进自己TASK.md；公共DTO/EnginePort/SQL namespace/shape冻结。所有private token有原owner注册检验及同步current fence，不从request根路径/structural true取信。

## 真实事实与资源

F01已由MAIN_DECISIONS批准：仅lease产生/proc/<parentPid>/fd/<fd>给本机固定ffprobe，输出/时间/并发有限，持有FD到child真实exit；绝非/proc/self/fd或普通可换位pathname。规范化逐字段同上游derived.probe/factsOfProbe：duration、first video stream、fps/rotation/audio与capsule来源具体绑定。真实probe失败不能用字幕末尾/trim/metadata填补。用现有工具/原私有资源策略，不下载/联网/安装/读CLI配置。

保留每个source及workspace资源对象，不能按同relative_path去重FD；资源责任在readSource Promise成功交付时转给Expected，交付前由reader全attempt清理。构造/verify/close/重入/Abort/晚到probe路径保留primary+全部cleanup，sticky清理不确定拒新proof，不能重试数值FD。目录/negative等lease必须在最后leaf关闭后正确全attempt释放，不能空retained漏资源。

consumer依赖发现为有限安全路径迭代，所有consumed/negative/directory/media lookups反查同一retained账本；不混epoch。video order精确numeric locale路径排序后filter，caption目录原readdir顺序另存，记录Node/ICU/locale证据。正常原生派生cache逐项按原producer/key配对，未知项拒绝并报告，不编造必要cache白名单。

## 自验证与真实层级

R01–R07和全部N1/N2要求按设计逐项case映射，不以总数替代。必须：真实原bootstrap+SOURCE_ONLY producer+受控adoption生成已提交源，再由真实WorkspaceService prepare/issued lease/reader读取；rich clip/概念、原rights/lineage验证，原legacy未知仍拒绝。测试可通过原业务服务配合法定测试UI authority准备，但明确为组件业务fixture，不假称实际人验/公开路由已接通。

文件/根/父目录换位、同bytes新inode、same-size/恢复mtime、source/workspace任一漂移、新style/settings/markers/字幕translation/缺失空目录出现、listing变化、伪cache/probe、closed/foreign/copied proof、base/control/owner/workspace/generation等待中变更、预算/EMFILE/EIO/ENOMEM、构造与cleanup首项失败/重入、child取消真实exit后才释放FD均要会失败的用例。新实体不存在不算旧代码业务反例；已有行为反例与setup失败分开保存。

同bytes probe工程门可用自有tmp由固定ffmpeg生成的真实诊断视频/声音，实际运行ffprobe，标明不是授权中文影片或人声。实际A两条60–180秒中文有声影片仍单列NOT_RUN，不因本阶段缺用户素材就用彩条/正弦音频冒充。

新增capture使用现有MAIN run-recorded.py与唯一n1n2-claude-前缀，保留完整argv/stdout-stderr/actual exit/输入SHA；运行中src/tests/tools/config/index冻结。不能从碰巧绿的多次里挑选。源码编辑与测试串行；单元调试结束后冻结候选再跑真实门。SOURCE_ONLY和render/export/NativeAck是不同事实，不造browser/loaded/全片可用声明。

允许命令基线：corepack pnpm exec tsc --noEmit；vitest精确受影响文件（new source-reader、workspace、committed-snapshot-host、native-ack），按文件实际是否Host/ffmpeg归入唯一heavy slot，需先问MAIN获精确argv批准。pure closure/contract unit可独立跑；不跑全量、build、browser、迁移旧Gate写、J/provider/付费/下载/安装/配置。不修改package scripts/lock。

## 唯一writer和交回

PRODUCT Codex负责细化TASK/合同/审查、管理可见Claude窗口与自验，不同时改同一源/索引或并行测试；Claude具体写允许路径并自验证。源码仅此十路径及自身evidence根，超出提交精确请求，不越界。Git索引/提交由MAIN独占，双方不git add/commit/reset/stash/checkout/push。所有旧成功/失败证据保留。

任何Claude429立即停止、保全调用/源码/日志与进程状态、通知MAIN；不自动重试、换provider/凭据、重启或Codex接手。常规缺陷自行修到文档范围真实通过，超过两次返工由MAIN核对原writer已停后接共因（429除外）。未解决高风险/能力缺失给具体证据，不无穷扩写替代实现。

最终交实际文件diff/hash、逐case通过/失败/NOT_RUN、真实命令/日志/产物SHA、已有行为保护与回退、全部自有进程/FD/占槽交回、内部状态上限N1N2_INTERNAL_EVIDENCED。ROOT冻结后由未参与实现者复核；不能自签独立或A完成。本阶段完成或精确真实阻塞才交回，不能只写设计接口或空实现就报done。
