# D10 created 原生发布专项恢复实施与验收

状态：MAIN 已授权实现范围内的详细设计；实现未开始，全部 RCV-D10 case NOT_RUN。原 D10/T20/CP-A0 编号含义及历史 Gate 不改。不得据此开放生产写入口。

## 实体、权威及先后顺序

- CreatedSourceAdoptionService：同项目 Coordinator.controlledWrite、真实预检/只读能力、不可变 adoption/prepared_authorization、原 transaction(kind=edit, operation=agent.created_source.apply@1)、Publisher 与原 closed commit。发布发生但提交失败时保留 prepared，不把所有可恢复中断直接写 terminal attention；确证不一致才 attention。
- CreatedSourcePublisher：增加 Host-only 恢复验证入口。依据真实 journal、固定 author 根、原 backup FD、目标 author/snapshot FD、原 SOURCE_ONLY Job/原生 plan/许可重新签发仅本实例可用的 publication proof。不能将 journal JSON/一个 hash 变成可伪造 proof；不能以新 inode 同字节代替原备份身份。重新取得的 FD 必须对照移动前持久身份事实，不能冒称持有崩溃前 FD。
- 新 CreatedSourceRecovery（MAIN）：在 created bootstrap/task 的必要存储打开后、generic actor/Coordinator recovery 前执行。只识别精确 created apply transaction，旧 Hypit/M4/history 不接管。通过原 controlledRecovery 项目队列与原 transaction state 收敛；不建第二状态机。
- RevisionStore：如需针对该操作新增原事务恢复/中止原语，仍是本类唯一状态 writer；检查精确前态/操作/项目/不可变 fact，不能裸 SQL 重置 attention/state/pointer。原 active commit / revision 不得人工改写。
- CreationApplication：待真实恢复/selection/native观察依赖装配完成，再启用原 change.prepare/apply/兼容 approve 路由。当前入口未开。close 先关接收/等待已接收写，再释放 Reader/Publisher/verifier/registry，最后 DB。

## 只相信 Host 派生的位置

Author 根必须由配置 createdRoot + 已验证 project_id + source 派生并校验创建来源，不能信 journal 的 author_root。Publication workspace 必须在配置 privateRoot/project_id 下、满足原 publication-UUID 名字；backup/staging 必须是同一已验证 workspace 的固定子目录。拒绝 symlink/根重叠/替换/不受控路径。prepared root 从原 job.stage_token + prepared lease_attempt 派生，继续 D02；不从客户端/任意 JSON 找文件。Journal 与派生位置不符即保全并 attention，不移动其他目录。

## 恢复决策（每步都有实际字节、身份及 fsync 证据）

|观察事实|恢复动作|业务结果|
|---|---|---|
|事务已 committed，原 receipt/指针/快照/来源事实一致|仅验证并读回原事实；不再次发布/编码/消费|revision 不再+1|
|received/prechecked/staged/validated/prepared，无 publication journal，author 完整等于原 committed closure|中止未发布事务；保留准备材料/快照/失败证据|原 revision/source；不消费批准|
|prepared journal 存在，但 author 仍为原完整闭包、没有已移动 backup|校验并中止未发布事务；不把已暂存 target 自动当已采用|原 revision/source|
|author 缺失、backup 为完整原闭包（两次 rename 之间）|以持有 guard 的 backup 原子移回固定 author，目录 fsync，验证完整闭包后中止|原 revision/source；不消费批准|
|author 为完整目标，backup 为完整原闭包，snapshot 完整，原授权/Run/锁/许可/输入仍有效|恢复 Publisher 验证并签发新实例 opaque proof，原 closed commit 收敛同 transaction|恰+1、同消费/step/outbox/receipt|
|同上但取消/暂停/过期/锁或许可已不允许完成|将已验证目标移到本 workspace 独立隔离目录保全，backup 移回 author；目录 fsync 后中止|原 revision/source；不绕过新授权|
|author/backup/snapshot 不符、位置或闭包/身份不能证明|保全全部材料并进入原 attention|拒绝新写，不伪称回退成功|
|确证可重试 I/O/资源不足或另一合法恢复顺序先占用|本次不改内容；返回真实 deferred/启动仍未就绪；不能让 generic 改为误导的 terminal attention|不开放写、不假恢复完成|

禁止只还原 film.html。文件补偿属于未提交发布恢复；若 DB 已提交，恢复旧内容必须走新 revision 的原受控 history restore。恢复不重新发起 provider/付费/编码，不因晚到或取消自动采用。

## 验收矩阵

每项同时断言 author/backup/staging/snapshot 完整文件 hash、revision/active pointer、transaction/approval/impact、step/checkpoint/event/outbox/idempotency，临时目录与进程各自有证据。无可触达边界不计 PASS。

- RCV-D10-01：在 begin/fact/prepared/isolated copy/target snapshot/journal-before-rename 逐边界中断；无作者写路径必须原闭包安全中止。
- RCV-D10-02：journal prepared 后、原 source 已到 backup、目标尚未到 author，真实进程 SIGKILL；新进程补偿完整旧树。
- RCV-D10-03：目标 rename 后、目录 fsync 后、published journal 后、DB commit 前真实进程中断；授权有效时完成同 transaction，恰+1。
- RCV-D10-04：published 后到恢复前分别使授权到期、Run paused/cancelled、三类锁占用、许可/输入变化；不能越权完成，能证明时还原原闭包。
- RCV-D10-05：DB commit 后/响应前/释放前中断；重开同请求只读原 receipt，revision/消费/outbox 各恰一次。
- RCV-D10-06：backup/author/metadata/snapshot 同字节不同身份、缺失/篡改、路径符号链接/越界、伪 journal，必须 fail closed 并不伤其他工程。
- RCV-D10-07：恢复自身在移动隔离 target/恢复 backup/fsync/中止或提交前再次崩溃；下一次启动仍可收敛，不能丢两边。
- RCV-D10-08：两项目/同项目旧 prepared 行及不同代 lease、并发同 key/异 body、旧 legacy/history pending 混合，按依赖顺序恢复，不越过其他 gate。
- RCV-D10-09：关闭与验证/发布/提交并发，等待属于自身的实际进程/句柄，清理故障不抹平，数据库最后关闭。
- RCV-D10-10：真实 Host.listen 调用专项恢复且在 generic 前；只用公开生产调用/轮询证明，无测试手动调用 recover 冒充生产接线。

异常抛出故障矩阵与真实进程丢失分列。必须有真实进程测试，不用 finally 正常跑过的异常代替 kill。先闭环类内/恢复原语审查，再实际崩溃/重开+宽回归，最后独立冻结复审。重型串行预约、静音 Headless、无 provider/J/额外外传。尚无实际 case 证据，本设计不算业务验收。


## 持久文件身份补充（内部设计，未实现）

当前 journal 只记录路径与 hash；它不足以证明跨进程后的 backup/target 与移动前是同一目录/文件身份。为满足本计划的“不拿同字节新 inode 重新建立信任”，增加同库 immutable created_publication_identity 附属事实：transaction_id/project_id、format/version、原 author 与 target staging 的完整目录/文件 dev+ino（十进制字符串）、相对路径集合、清单 hash。没有 state/ready/approved 字段，CP-A0 namespace/冻结 wire/原 journal DDL 不变。

Publisher 在持有原 author 和隔离 target 的 RetainedSourceTree 后，从实际已校验 FD 生成身份事实；与 prepared journal 同一数据库原子事务提交，之后才允许任一 rename。尚无此事实的旧未发布行只能经完整 base 证明安全中止；已移动且缺失跨进程身份的旧行诚实 attention，不伪称具备新证据。原字段或 schema 冲突 fail closed，追加表须做同库重开/不可变触发器/逐字段验证/未知版本拒绝测试。

恢复用新 FD 独立复核完整 hash、canonical 路径和持久 dev+ino，排除 inode 重建或替换；只保存源根内的目录/文件身份，不把原父目录的名字变化误当内容变化。FD 数字永不持久或跨进程重用。迁机/重新复制 runtime 后 inode 改变时不能静默继续旧 pending；保全并报告需审计恢复。Git 代码迁移不等于搬迁未完成发布的文件事务。

identity 是关闭与 rename 恢复的事实，不是新的 Approval/publication proof；恢复 proof 仍须由当前 Publisher 重验全部权威后私有签发。此处为明确设计裁决，待独立设计核对与实际实施，不计任何 RCV case 通过。
