# A04一般工程创建：专用worker与Host生命周期

状态：实现中，尚未冻结外审；不代表A轮验收通过。

## 事实与边界

沿用已批准的nullable draft：初始Brief允许没有脚本引用和录音资产。创建只生成固定版本的空原生OpenFilm工程，不生成影片、不冒充已有授权素材，不使用迁移ID。后续素材、真实录音、脚本及分镜必须在生产运行采用前完成事实闭包。

一个Host、一个RevisionStore连接、一个ProjectOperationQueue和既有ProjectCoordinator不变。ProjectCreationStore使用同库bootstrap command预约稳定project/job/transaction ID；operation为agent.project.create@1，job.kind仍为snapshot_publish，不扩大冻结枚举。

## 写入及恢复

1. scoped authenticated调用project.create；同owner、同Intake版本及当前trusted_ui确认由Store重验，普通内容确认无执行权限。
2. 首次请求持久预约并返回原始queued receipt。重放不改project/job ID、不把当前结果混入原始POST响应。
3. Host启动后专用worker取持久Job，持有owner/attempt/expiry租约并续租，经Coordinator项目队列写固定初始source。
4. 每个工程有绑定command/transaction的owner.json；只清理本次UUID staging，不覆盖已有不同source。
5. SnapshotStore发布、真实固定上游解析、source/snapshot及父目录fsync，获得不外传的不透明proof。
6. 单数据库事务写revision=1、snapshot/binding/pointer/transaction、origin、Brief、Job结果与outbox；最终重新检查批准、租约和字节。Job成功仍为native未确认。
7. 专用恢复在generic journal恢复前执行。回收只在BEGIN内fresh读取，并用owner、attempt、原期限、当前过期条件CAS；不得调用仅按job ID回收的旧通用方法。
8. 运行期generic lease reaper排除专用模块真实pending Job集合；专用worker负责其过期运行及取消收敛。不得因取消任务失租而错误置项目attention。
9. 取消与真正失租区分：当前owner取消，或无活跃owner的取消，原子落aborted/cancelled/failed command，保留诊断source，不发布origin/pointer。已有commit不能被取消路径回退。
10. Host关服先停止专用调度、等待在途工作退出，再关SQLite；关闭过程中未提交工作释放租约，重开仍恢复同一Job。

## 实证范围

首轮HTTP/关服/存储/原Host组合39项已通过，日志main-creation-host-r4。随后专用HTTP恢复11项通过，含五个正常边界及一个取消边界的真实子进程SIGKILL，日志main-creation-recovery-first。取消与generic reaper交互的新组合仍在复验，结果以对应.exit/.txt为准。

这些只证明一般工程创建。尚未证明真实短片、MCP生产发现、创建工程的原生工作台加载、完整工作流执行、正式导出和T20全链。缺失producer继续返回不可用，不能写ready占位响应。初始空工程不是A短片交付。

## 本批组合复验

main-creation-recovery-r3：类型检查0，5文件71项全部通过。含14项Host/进程恢复、36项创建存储、19项旧持久Job、原Host/MCP一项及并发关闭一项。Host关闭已合并共享Promise；旧实现真实复现database is not open，原失败日志main-host-double-close-before保留。真实kill共八点：after_project_directory明确失败不接管目录，其余正常边界恢复同Job；cancel_after_source收敛cancelled。仍不关闭A04整模块或A轮。
