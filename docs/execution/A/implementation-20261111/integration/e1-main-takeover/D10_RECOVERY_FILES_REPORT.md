# Created 发布中断的文件恢复层候选

基线b0238eb，MAIN精确四路径释放，尚未接入生产恢复/启动。新 CreatedPublicationRecoveryFiles 只处理原 prepared transaction 的资源：从固定 created/private/snapshot 根及project id派生位置，核对原 creation owner 标记、immutable adoption/plan/journal/identity、当前原 committed base，保留原始/目标/snapshot/source及container FD并复算完整源摘要。journal不能决定任意author/backup路径，JSON克隆不持有活租约。

六种实际位置包含：未移动、两次发表rename之间、目标已发表、补偿两次rename之间、原源已还原，以及原源仍在而未使用staging已清理。目标隔离固定rollback-target，备份完整还原，不删任一源/快照/证据。每步保持原FD跨rename，目录项变化的两个父目录逐次fsync；只有完整原源与耐久门完成后同步assertOriginalRestored允许调用者再沿原事务中止。该类本身不写业务state/revision/pointer/Approval/impact/outbox。

## 防止恢复路径自身越界

MAIN自审发现异步pathname rename/fsync会留下祖先替换间隙。新增 RetainedSourceTree.moveTo/syncDirectory，依实际已持有父目录FD执行同步rename/fsync，不裸露FD；拒绝已有目标（包括空目录）、错误parent、partial source及跨device。当前原Publisher没有改用这些新方法，已有行为保持。所有合法写仍须在实际Host运行根独占和同项目Coordinator队列；这些资源方法不授予写授权，也不宣称抵御拥有同一OS账号权限的任意并发篡改。未知位置/内容/身份拒绝保全，不猜测清理。

每个已获得guard都归原清理器管理，inspect失败/部分获得、lease释放、关闭与补偿并发均尝试全部资源，原始错误和清理错误同时保留；不重试原始FD数。close等待自己在途任务，关闭中断留下下一实例可判定的固定位置。

## 逐类实际证据

- recovery-files002：19PASS，真实目录/完整文件/原SQLiteschema/rename/fsync。没有业务批准、真实Host启动或原生视频声明。
- recovery-files003：22PASS，增加伪journal路径（修改后恢复原immutable schema）、active base漂移、inspect原错+close错且所有guard都尝试释放。
- recovery-files004：初版持久身份比较置空，5FAIL17PASS；字节/源摘要仍匹配，但新inode被错误接受，测试确实失败。
- recovery-files005-anchored：三文件47PASS（恢复22、retained10、identity15），加入FD锚定原语与既有身份回归。
- recovery-files006-anchored-control：最终FD锚定版本仅去掉持久身份相等检查，同字节替换5FAIL17FILTERED；测试不变，实际counterfactual代码也单独保全。
- recovery-files007-restored：精确恢复最终源码后47PASS。typecheck52exit0；两份捕获的全部四个发布路径hash与封存前一致，source_changed/source_added均空。
- recovery-files001的19项均在fixture建立阶段因复制黄金计划control_revision与新impact不一致失败；未达到资源业务断言，不当作实现缺陷或环境噪声。typecheck50因误用snapshotWasCommitted方法名退出2，改用真实snapshotIsCommitted；失败原样保留。typecheck51为FD锚定前版本exit0，只将typecheck52用于最终源。

47PASS是组件组合，不能代替业务RCV。测试中的committed base/creation identity/plan是明确合成数据，文件与DB操作是真的，未证明真实ProjectCreationStore→Host装配。故障边界用异常中断并新对象重开，不是进程SIGKILL/断电。上述限界不能由测试计数掩盖。

## 待完成（仍属原A目标）

CreatedSourceRecovery需接同项目controlledRecovery及真实creation identity；有效授权时Publisher恢复私有proof并沿原closed commit完成、取消/过期等确证不再许可时调用本层补偿并原状态中止，可重试I/O正确defer。在线Service eager attention需与可恢复prepared区分。之后实际generic排除/Host进展调度/运行根独占、真实SIGKILL、全量/原生Studio/NativeAck/正式双导出和人工门。所有RCV-D10业务case仍NOT_RUN，不宣称A/V1验收通过。新资源实现独立审查仍PENDING。
