# BRIDGE：共享选择authority精确私有合同与迁移设计

你已交回恢复职责过滤独立bounded ACCEPT；此为新的只读架构/合同设计，不是source/DDL实施。MAIN已经决定采用项目级持久单调epoch方向，裁决见同目录MAIN_DECISIONS.md，不能再推荐重启默认0，不能自行实施或派Claude/子Agent。

固定源基线MAIN e2eff61b464d75d36598103d718cd2a75db5dfda，目录 /mnt/c/workspace/videoworkline/Narralens-agents/main-integration。PRODUCT Codex正按MAIN精确release管理Claude N1N2十路径reader实施；你只读该基线Git blobs，不能取正在变化的working tree作已冻设计输入，不能运行任何tests/Host/media/browser/network/provider/J/配置或改索引、既有文档/用户dirty。

阅读你的Host组合四文档、PRODUCT native-source-composition-design四文档、MAIN_DECISIONS.md（优先）、原NativeObservation/Context/Change/FactsReader/Publisher/Recovery与原SQLite连接/guard/typed contracts。给MAIN可直接发N3共同实现的精确方案，不能只列选项让人类选常规技术细节。

关键必须闭环：项目单调safe integer计数的唯一同库DDL、迁移指纹、CAS及事务内current/read，原DTO/cp_a0/九字段commit/批准语义不变；所有created consumers共享一authority，Legacy/Migrated语义不被改造。只允许原可信Observation/Host生命周期写，不接受HTTP给epoch/root/force。

区分“已知epoch、mapping待证（selection null、loaded撤销）”与“authority本身缺失/损坏/I/O/未初始化/已关闭（unavailable）”，避免新session先invalidate为unknown→read版本throw→Expected/Ack无法启动的循环。取得一个有效版本绝不代表实际选镜或已loaded。接口中分别建模epoch read和live mapped selection，不能用status编码偷偷使unknown authority返回0。

首次0仅原verified bootstrap+同库无适用pending可证，新session/workspace与实际mapping变更的单调失效、重复同一active mapping不推进、新session首次映射不能被old lastMapping digest误判重复。定义真实Native事件/session/document/hydration/selection如何线性化、失效后迟到事件拒绝、原session-local event sequence如何与project epoch分离，跨project不串。

重启读持久epoch不复活live selection/Ack，也不无故回0；要明确普通UI关闭、新session、失效view/commit/control、Host优雅停机和SIGKILL分别是否推进epoch，以及已受理恢复/观察在关闭期间的读取/提交条件，防先把authority关掉再等使用者。已有historical created pending无ledger不能抄plan猜版本，给具体验证/诊断/安全保全、升级/对账策略及何时需要真实人工高风险核验；不能用永久defer假闭RD05。对全新正常生产路径必须无该升级阻塞；未知项目不能停全部健康项目。

所有源/data scope限定设计：只写新canonical R2/shared-selection-authority-design/ 两文档 CONTRACT.md、ACCEPTANCE_AND_RELEASE.json。CONTRACT含完整拟DDL/版本与migrate判定、私有interface签名/opaque owner、时序和失败矩阵；JSON给精确源码/测试白名单、依赖、真实SQLite断电/重开/ABA/并发/CAS/损坏/I/O/close/late callback验收输入步骤与期望、命令需求、所有NOT_RUN及回退保全。SOURCE读到的具体文件/blob/hash记录，建议新实体名created-native-selection-state.ts；MAIN单独冻结后才可实施，不混N1N2 reader票。

完成worker_done给MAIN真实设计交付与仍需定案的具体风险。所有命令终止后交回，无源writer/重型grant/实现或A通过。
