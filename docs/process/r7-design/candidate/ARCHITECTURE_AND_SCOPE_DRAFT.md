# R7 资源闭环设计草案

**DRAFT_NOT_RELEASED**。适用于 MAIN 审票。源码基线及审查深度见 INPUTS.json。独立预审后的具体条件契约见PRIVATE_SEAMS_REV2.md（R7-D01..05，冲突时优先）。当前 Claude 独占 W 的 PROC-0 工具。R6/C09 的实际接受记录、接受 commit 及对应私有接口仍待 MAIN 绑定。

## 当前生产责任与可达分支

|入口及持有者|已读到的控制流|缺口及其影响|
|---|---|---|
|Host server 的 close → application.closeAfterNative → workspace.disposeAfterNative|先等应用 close，supervisor 正常关闭并等 gateway.close 后才调用 dispose。workspace.close 同步封准入、abort、废 ref，以缓存的 stop 等 operations 快照。produceNativeCacheEntry 单独登记 #produce 的原 work；prepare 的 #admit 会翻译非 ProductError。|allSettled 丢弃结果并非一概错误，普通拒绝应由原 caller 收到。但已经移出集合的真实清理失败及正在 settle 的失败不能只靠快照追溯。勿让 phase-one 抛错短路 Host 后续原生停止；在原 owner 保存清理终局并在合适交还边界报告。|
|disposeAfterNative，workspace 持有 root FileHandle、每个 record.directory 及 servingOwners|逐 owner catch 后依然发 serving_closed、清空注册，再按路径 rm。目录 close 或 rm 抛错会跳过余项和总 root.close；!root 早返或后发异常可掩盖早先失败；有 root 时只抛 failures[0]。|serving.close 抛错既可能来自 drain/listener，又可能只是已结束后的 lifecycle 观察器。facts.closed 在汇总异常前写入，不能单独授权删除。先按物理根确认无 live owner，逐项尝试独立项，保留未知根的定位句柄/注册。删除前以父 FD 和现有目录身份确认未被换名替换。父根只在已无依赖时关。观察回调抛错也不得跳过其他项。#leaf/#read/#copy 的 finally 也会因第一个 close 跳过 parent 或覆盖主因，需用该入口逐项覆盖。|
|RetainedNativeClosure → #closeOwned → pool|按 allocation 对象先标 released，再做一次 close；失败保存原错误、pool.release(false)，#closeAll 遍历独立持有对象并合并历史。|close/release 的 closed && rootDescriptor.released 早返绕过历史 ledger。workspace.reconcileNativeCacheCleanup 对同一 closure 再 release，随后 settle tree、忽略 finalize 返回值、删 handle、reject 原 promise 并报告 settled。首次失败可被解释为新终局。并发 reconcile 还会在 await 间读到同一 pending。应缓存同一进行中结算，并仅接受原 allocation 的新证据。不能重关已复用整数。|
|workspace.#produceWithinScope → registered.bridge.draw → witness ledger|scope 在查 preexisting 前取得；PRE 与 POST 各自 open。draw 成功返回 parent_drained，再取 POST，stage 后先释放 POST 再 PRE；最终 gate 同步重核 chain、output、deps、lease、serving，然后 activate；外层 finally 尝试 complete/release。|三张 phase lease 在入口全开。preexisting 等早拒绝发生在捕获区外，parent/tree 均未 settle。draw 已正常 drain 但抛业务失败时 drawn 为 null，parent lease 缺事实。会留下无工作却占用的 scope。若 POST/PRE release 出错且无 primary，直接 throw，缺 #holdProduction；open 自身未返回 closure 但携带 genuine cleanup 时 treesReleased 可误为 true。最终 gate 前已写 outcome=settled，gate 异常也可走成功 outcome。必须分别构造对照。|
|bridge.draw → folder.freezeAdmission/drain，及 owner.close|folder 分别跟踪 requests、source streams、frameDuration(asked) 的 promise；桥在 await started 之后冻结。即使 drain 抛错，后续也会尝试 releaseProductionScope、写 current.phase=settled、settleOnce 并删 unsettled；普通 source 错误则可能在确已 drain 后上报。|此分支不能直接证明真实 drain 会 reject。需从真实 parent producer 提供已终局失败与未终局失败两类证据并保留 handle。frameDuration 跟踪到的是上游返回的 promise；现有 frame-duration-lifetime 的 ownHelper 单独调用 execFile，不能证明具体固定 route 的 callback 与原 child close/reap 的关系。|
|reader.readSource → authority.acquire → #adopt → readFacts → delivered handles|reads 在调用绑定前登记；#adopt 的 owned 延续负责晚到 release 或收取带 genuine 标记的 rejection。最后查对应 root 在 idle，向 delivered owner 移交；reader.close 等 children.done、reads、acquisitions，已交付资源由最后 leaf 释放双树及 lease。authority 的 issued lease.release 先写 released 再 closure.close。|reader.close 是每次新建的 async 执行；两个 close 可对同一个未 close 的 OwnedChild 重发 kill，timer/error/output 另有 kill 路径。done 在 child 的 close 事件触发，exit/stdout结束不足以结算。#read catch 里的 owner cleanup 错误可只进入 failures 和 uncertain，未全部进入 reader.close 读取的 ledger。重复 leaf/authority release 的早返不能作为底层已证终局。|

## 合法迁移与私有接缝

1. 每个原 work 登记在拥有它的实例和物理根上。每阶段依次为未取得、已持有、带依据的终局。未取得可由实际未开工分支调用 phase lease 的既有 notOwned(reason) 方法。已持有只能由原 producer 确认结束；异常本身只设置业务结果。UNKNOWN 保存原 work、epoch、scope、FD 容量、PRE、root、可重查的原 handle；保持准入关闭。
2. R6 给执行域的原身份、creative eligibility、失败主因和真实终局；顺序依其目标为 raw-tree → stream disposition → wire → Host close。R7 消费既有结论。每个桥调用应在成功与失败路径都能关联到本 draw 的父侧终局。parent 先封准入，再等每个 accepted request、真实源流 close、原 probe 终局。对于执行域或 drain 仍未知，禁止 POST、释放它仍可访问的树、交还 scope 或交付 picture。
3. 已终局的失败沿原 promise 上报原错误，资源释放失败依获得顺序及阶段附加，冻结的错误也需私有 ledger 可取；现有 mergeRetainedCleanupCauses 遇不可扩展主因会抛带原主因的 wrapper；workspace 在建立 held record 前调用它，必须防止该抛出绕过持责登记。无 primary 的 genuine cleanup 失败形成 cleanup 主因。只有能独立证明安全的项继续释放。uncertain 对 fresh proof 单调锁定。Reconcile 允许晚到且绑定原 owner 的事实完成旧义务；重复或并发请求合用原 work。缺少重新证明单个 FD disposition 的合法来源时持续 held，禁止推测 FD 已关或重放 close。未签发恢复事实前不承诺可自动恢复。
4. witness 仅在 parent 确证、双树释放完成、scope 仍独占且最终身份全部复核后从 staged 进入 active；任一失败转 revoked，无恢复边。成功 outcome 在 activate 后才成立。close 的重复调用和失败后的再次观察均复用原终局；对外既有 async 包装可按 API 保持，仅在明确承诺同一 Promise 对象的 close 入口验证引用相等。底层 operation、kill、每 allocation close、scope completion、激活、rm 各至多一次。

## 拟释放范围与回退

第一批条件源码白名单为 W/src/host/agent-driven/{created-native-workspace.ts,retained-native-closure.ts,created-native-source-reader.ts}。按 CASE_MAP 的 R7 接缝，候选测试改动限 W/tests/agent-driven/integration/{created-native-workspace,created-native-source-reader,retained-source-tree,native-cache-witness,retained-native-budget,cache-serving-drain,cache-frame-duration-lifetime,cache-production-scope}.test.ts。花括号逐文件展开。其余引用为回归/跨阶段证据入口，无写权限。D01已具体定位现有缺口，拟票必须包含 src/adapters/openfilm/openfilm-upstream.ts 对应attempt/bridge/serving私有分支；R6接受后复核等价能力，精确票前仍无写权限；如 committed lease 的重复 release 本身需报告原错误，单列 committed-snapshot-authority.ts 的 issued release。均须重绑输入和直接案例。

保护 native-cache-witness 的算法/ledger 公共语义、cache-production-scope 的容量与既有 phase API、Host server、creation application、R6 C/Host/worker/policy、上游及 fixtures、Expected 与 EnginePort 七方法、既有 acceptance/历史 Gate、配置、PROC-0 工具。若原 caller 的停机顺序确须改动，提交精确差分和反例给 MAIN，禁止自行扩票。回退以新取得的 R6 接受 commit 为基线，仅撤销本票白名单变化；先核无在途输入与原 owner 已终局，保全失败 capture 与未知 root。不得 reset/stash 或用历史绿灯签当前字节。
