# A05 新建工程至原生工作台：连续实施范围

基线452b4a2605381ef8d71de8cca1f539df2b2296e1，MAIN唯一writer。UI入口链已获精确bb5a29b限定独立PASS，不代表本模块或A05/A。BRIDGE/PRODUCT/MEDIA此刻只读或已结束，无Claude writer。

目标：真实owned created工程打开现有pinned Studio，使用原native editor与同一M5注入根，工作流/系统面板增量接线；证明实际loaded版本之前保持unknown/pending，不伪造migration、不重建时间轴。随后连续接Run/任务/实际assembly/受控采用/正式导出，不新增模块级人工门。

本批允许公共例外：AgentHostApplication/CreationApplication/server的受控Studio源端口与最小装配；m5 Supervisor新增仅A启用的隔离子进程支持、受控projection workspace、新created UI读模型/validator/schema/原panel增量接线及真实测试。具体源码逐实体落实，不预注册未实现capability；31条CP-A0 Agent schema保持冻结，UI读分支另显式版本化，旧migration投影/旧启动入口保留。

第一实现切面：src/host/m5/isolated-studio.ts与openfilm-studio-child.mjs，Supervisor可选isolatedRuntimeRoot与真实pinned子进程试验。子进程独立OPENFILM_HOME/OPENFILM_LIBRARY/禁更新，不改HOME、不碰用户全局Studio状态，不下载/联网/弹窗；本机key仅IPC回Host。退出必须等真实child close，父进程丢失时disconnect关闭。旧无此选项的legacy路径保持。

第二切面：committed snapshot读权威→独立native workspace，实际Studio产生的.film/id/cache只落副本，不写snapshot/author source，不视为commit或第二时间轴。UI/项目归属/source/base在准备与打开时重验；新open路径未闭环前不对外放行。

第三切面：显式created读合同允许0帧和null migration/source lineage；顶层原生Gateway/film/Host origin隔离；匿名Gateway cookie不能升级trusted_ui，owner/project/Host代际绑定的受控delegate与各origin自己的proof；原生观察不产生批准。真正版本化loaded观察接缝单列实测，无观察保持unknown。

验收：真实pinned模块/隔离root/真实启停与父失联；新工程实际HTTP创建、snapshot闭包副本、原生open/关闭重开、原始author/snapshot bytes/revision不变；错误归属/漂移/未准备/旧代际拒绝；真实headless打开native、同stores/clock、native版本观察。仅本切面实证不提前签A05/A，人类素材/中文录音、影片/双导出等整A要求不减。
