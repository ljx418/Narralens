# R7 开发验收草案

**DRAFT_NOT_RELEASED**。CASE_MAP.json 每行保留原入口、触发/对照、断言、层级和候选文件。下列是其中关键项的最小增量反例；实施后必须把每个分支绑定真实测试名与独立 capture。不能用同一文件内其他断言替代。以下均未运行。

|原要求 / 测试文件（integration 目录）|生产输入、观察点|成功或失败时必须观察|
|---|---|---|
|cleanup_uncertainty / created-native-workspace.test.ts|经 prepare 建两份 held record；分别使第一目录 close、第一 rm、某个 serving drain、单独观察器、总 root close 出错；同时一项失败加另一项失败。正控所有原 owner 终局。|对独立可清理项逐 allocation/owner 一次尝试。未知根的目录名、dev/ino、必要定位 FD 保留；仅成功身份核验且已无依赖的根能删。普通请求拒绝不污染 close。双错都留在原错误链；close/dispose 重入不重复 rm 或覆盖原因。若共用同一不可证明的父路径，两者均保全。|
|cleanup_uncertainty / retained-source-tree、native-cache-witness.test.ts|在 production 自己的 descriptorOps 按 phase、allocation id、次序注入 open/stat/verify/close，区分 syscall 前失败、实际已 close 后观察器失败和未知 disposition。覆盖 PRE open 自清失败无返回对象、业务失败叠加 PRE+POST close 失败、候选成功仅 cleanup 失败。|不以全局第 N 次无身份调用替代实际命中；记录原业务对象、每错、真正尝试集合和 pool。原 production、workspace.close 以及同根后继在未知窗口仍 pending；两个 inspect/reconcile 并发及稍后重复均无重复 close、无提前 completion、无 witness。确有绑定原资源的新鲜事实后才允许单次原失败结算；没有这种能力则保留 UNKNOWN。|
|per_allocation_fd_lifetime / retained-native-budget、retained-source-tree.test.ts|临时目录 walk 结束后再打开 retained leaf，记录同一整数被不同 allocation 使用；对照独立 fd 与 busy 同步 close。|按 generation 观察每次底层 close，不能用 set(fd) 统计。busy 时工作完成后仍可释放；首次不确定后连续 close/release 不清 ledger，池中不确定额度不归还。|
|drain_and_delivery、child_lifetime / created-native-source-reader.test.ts|真实 readSource 等待 authority 原 promise 时 close 两次；分别交普通拒绝、带 genuine 标记失败、成功 late lease、late.release 抛错。另经 reader 自身 spawn 运输接缝登记 OwnedChild，交错 timeout/error/output 与并发 close，先 exit 或管道关闭，最后才给 child.close。|caller 可先 aborted。两个 close 都等底层 acquisition 和 child.done；late 成功只 release 一次，普通拒绝不污染 ledger，每个 genuine 失败在 owner close 可见。确证收回前不释放 child 输入。对照已交付 facts 的最后一个 leaf 才归还 source/workspace/negative guard。D1 运输事件不签 D2 原进程回收。|
|ISO-06/07/10/11/15 / native-cache-witness、cache-production-scope.test.ts|同根排队观察 preexisting 早拒绝、无 draw 的 PRE 失败、draw 已 drain 后业务拒绝、draw 活着、parent 尚活、POST 失败、最终 gate 换源。成功正控固定输出与最终 consumer lookup。|未启动阶段只在实际分支记 never-started；已结束失败释放 scope，真实未知保留。stage 后至最终 gate 全程 lookup 为空；gate 失败时 revoke 且 scope outcome=failed。成功在双树释放后 activate，再归还 scope。伪 handle / 无新事实不得改变旧 promise；已证明原失败的生产仍失败。|
|ISO-12/13/14 / cache-serving-drain、cache-frame-duration-lifetime.test.ts|独立实证票经实际 folder route 观察请求、response abort、source FD、父 probe 身份、worker 结束、freeze 与下一次 reopen；区分 upstream memoized promise 的 file/version 与 reader 自己的 ffprobe。|分别记录响应 close/源 close/源错误、父 callback/child close/原 epoch 终局和 drain 时间序。冻结边缘新请求没有任何新源访问；旧请求可结束。独立 helper 的事件序、替换外层 drain 或返回 stub 均只能作为局部对照。|

## 内部交付顺序

1. 先用已接受 R6 的执行域结果定义三种输入。普通业务拒绝且未开工或全部资源已终局，可立即按原业务错误结束；真实失败但已终局，保留原 cause 和 cleanup errors 后归还容量；UNKNOWN 只记录失败并阻止重用。MAIN 需裁定失败 draw 如何交还 parent disposition、无 closure 返回的 open 如何持有 allocation 责任、未知 FD 有无可独立采用的新证据、停机失败如何按根区分观察器/仍存活的 owner。未决分支不得用布尔 success 填平。
2. 同一个 Claude writer 连续完成 allocation 与 reader 交付、workspace 逐根处置、scope 与 witness 最终门三个小闭环。每一环以真实 caller 贯通，先受控负例再正控；通过后继续依赖环。在 R6 freeze 后按实际接口核接线和文件范围。生成/改通用框架、调整 Expected/公开类型或引入系统操作 hook 均需另审。
3. 由 MAIN 在 PROC-0 准入后预约逐文件/逐测试的原 recorder 命令、工作目录、owner、slot、精确 argv/输入及唯一 capture。D1 使用受控窄接缝；涉及实际文件描述符/进程、服务、Chrome、媒体的命令须另票分层，无内核/真实媒体证据的行保留 NOT_RUN。无外层 timeout，运行期间不改输入，超时或未知保留原测试及持责记录并停止冲突动作。任何新 429 立即停并报告。
4. 每个已释放 case 交实际测试名/改动、输入与日志产物 SHA、实际 exit、触发边界与独立观测。全部适用断言和正反控齐、受影响回归同源、无未处置未知 owner、范围及保护摘要复核后，才可送绑定候选 commit 的独立审查。故障负例的 held 状态必须有隔离、真实终局或获准的保全交还；挂起不能当测试成功。元数据检查仅准入。R8 原17与 ISO18、真实影片/人验和 NEXT 继续按原计划。回退及保护见架构草案。
