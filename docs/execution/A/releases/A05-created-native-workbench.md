# A05 新建工程至原生工作台：连续实施范围

基线452b4a2605381ef8d71de8cca1f539df2b2296e1，MAIN唯一writer。UI入口链已获精确bb5a29b限定独立PASS，不代表本模块或A05/A。BRIDGE/PRODUCT/MEDIA此刻只读或已结束，无Claude writer。

目标：真实owned created工程打开现有pinned Studio，使用原native editor与同一M5注入根，工作流/系统面板增量接线；证明实际loaded版本之前保持unknown/pending，不伪造migration、不重建时间轴。随后连续接Run/任务/实际assembly/受控采用/正式导出，不新增模块级人工门。

本批允许公共例外：AgentHostApplication/CreationApplication/server的受控Studio源端口与最小装配；m5 Supervisor新增仅A启用的隔离子进程支持、受控projection workspace、新created UI读模型/validator/schema/原panel增量接线及真实测试。具体源码逐实体落实，不预注册未实现capability；31条CP-A0 Agent schema保持冻结，UI读分支另显式版本化，旧migration投影/旧启动入口保留。

第一实现切面：src/host/m5/isolated-studio.ts与openfilm-studio-child.mjs，Supervisor可选isolatedRuntimeRoot与真实pinned子进程试验。子进程独立OPENFILM_HOME/OPENFILM_LIBRARY/禁更新，不改HOME、不碰用户全局Studio状态，不下载/联网/弹窗；本机key仅IPC回Host。退出必须等真实child close，父进程丢失时disconnect关闭。旧无此选项的legacy路径保持。

第二切面：committed snapshot读权威→独立native workspace，实际Studio产生的.film/id/cache只落副本，不写snapshot/author source，不视为commit或第二时间轴。UI/项目归属/source/base在准备与打开时重验；新open路径未闭环前不对外放行。

第三切面：显式created读合同允许0帧和null migration/source lineage；顶层原生Gateway/film/Host origin隔离；匿名Gateway cookie不能升级trusted_ui，owner/project/Host代际绑定的受控delegate与各origin自己的proof；原生观察不产生批准。真正版本化loaded观察接缝单列实测，无观察保持unknown。

验收：真实pinned模块/隔离root/真实启停与父失联；新工程实际HTTP创建、snapshot闭包副本、原生open/关闭重开、原始author/snapshot bytes/revision不变；错误归属/漂移/未准备/旧代际拒绝；真实headless打开native、同stores/clock、native版本观察。仅本切面实证不提前签A05/A，人类素材/中文录音、影片/双导出等整A要求不减。

下一实体明确允许src/host/agent-driven/created-native-workspace.ts、实际Host/SQLite/pinned Studio集成测试和CreationApplication/server的before/after native close装配。它只消费CommittedSnapshotAuthority读权威复制闭包到私有FD锚定目录，缓存不成为第二事实库、不给公开接口返回绝对路径。prepare按真实caller归属/active committed tuple，完成与resolve时重验；关服先停copy，native关完后才删除副本/关目录FD。Snapshot/author/J盘均不得作为Studio可写root。现阶段未实现Run/assembly等仍不注册capability。

第四切面：独立created-workbench@1.0纯读合同及GET /api/ui/v1/projects/:id/created-workbench，MAIN独占src/contracts/created-workbench.ts、contracts/created-workbench.schema.json、src/host/agent-driven/created-workbench-{service,http}.ts与实际Host测试。旧workbench@1/旧migration GET及31个CP-A0 Agent合同不变；明确origin=created、迁移来源null、frame_count>=0。真实projection来自当前committed resolver与pinned EnginePort，完成后复验active transaction/control/recovery；权限在资源查找前及所有await后验证。只读GET不启动Studio、不准备workspace、不产生approval/revision，preview暂为null，native_sync取真实Context unknown/pending（没有producer时不得声称loaded）。新read并不开放匿名Gateway，受限delegate仍是Gateway接线前置。
