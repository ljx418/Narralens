# D10 后续生产接线：本轮只读事实

尚未实施，不是通过声明。MAIN 原目录当前事实：

- server.ts listen() 先调用 agentApplication.recoverBeforeGeneric()，再固定 history/adoption/history，最后 generic Coordinator。CreationApplication.recoverBeforeGeneric() 仅恢复 creation worker/tasks，未装配 CreatedSourceRecovery。
- ControlledRecoveryScheduler 已有同连接真实 row 观测、原始有限集合、ASCII timestamp/transaction 排序和三族 handler，并拒绝集合/身份回退变化。应复用它，不能增加固定重试轮数循环。
- ProjectCoordinator.recoverOnStart() 当前遍历 incompleteTransactions 全集，无受控 unresolved exclusions。仅先调 created recovery 不足：其暂时失败/attention/pending 行随后仍会被 generic 抢走。必须由 MAIN 在同一启动序列提供精确三族真实行集合并保留 unknown generic 入口；外部请求不能提供此集合。
- 当前 CreationApplication.closeSequence 先 worker/tasks，再 localAssets/nativeWorkspaces；Host 在 application close 后才关闭 DB。新增 recovery 需要纳入其已受理工作等待，并在其使用的 assets/tasks 资源关闭前完成；不能只挂 listen 而不挂 close。

后续单独 release 与验证：按已有 D10_MULTIPREPARED_BOUNDARY 及恢复开发计划，实际原 runtime 排它锁、三族启动、精确 generic 排除、相同创建时间顺序/多项目/真实可达兼容链、未知/冲突保全、真实子进程 SIGKILL 与同库同根重开、合法 successor receipt。不能以本轮服务方法测试替代。若 strict nine-field closed commit 对真实可达链存在冲突，保留证据另行精确修核心，不能静默传 ignore 或放宽 CAS。


## 后续接线依赖：实际 selection，不能从计划回填

只读源码核对：NativeObservationService.currentSelectionVersion 的真实实现位于 native-observation.ts:559，明确无 session 返回0、失效 session 抛错，存在 session 则返回实际已观察版本。MAIN 当前生产树未构造 NativeObservationService，CreationApplication 的 Context 仍传 undefined；恢复 fixture 使用的可变/常量 selection 是诊断端口，不能复制进生产。

因此恢复、正常 adoption、Publisher 和 native observation 必须共享同一真实选择 authority。不能用 plan.selection_version 冒充 current，不用固定()=>0 让测试变绿，不在恢复时发明持久选择表。下一 MAIN 公共接线 release 需一起审查这条依赖与 PRODUCT lifecycle 导入/真实 NativeExpected reader 的装配边界：实际服务未就绪时显式 unavailable/deferred 并保持 gate；已有 session 失效不能降为0，shutdown 时 recovery 必须先于 observation/资产资源停止。服务重开没有 session 的事实与故障中的未知事实分别测试；若原选择已不可证明，应沿原补偿/待核对语义，不自动补批或将旧选择当新选择。

这项核查不授予当前审查期间的源码写入，不宣称已有真实选择/NativeAck/Host接线。独立复审的输入仍冻结1349636。
