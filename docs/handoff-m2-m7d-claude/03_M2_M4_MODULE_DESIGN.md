# M2–M4 模块详细设计

## 1. M2.1：引擎抽象与原生写入治理

### 1.1 EnginePort

目标路径：`src/host/engine/engine-port.ts`。接口只包含 `inspect/capabilities/plan/stage/validate/preview/render`。每个方法接收明确类型和 correlation context；不接受任意 command/path/URL。`stage` 只能写由 Host 分配的隔离根；`render` 只能读已提交 snapshot。

`EngineProjection` 至少提供：engine identity、snapshot/revision/digest、fps rational、frame count、稳定 clip/track/subtitle ID、整数帧范围、asset 引用、可编辑能力、preview descriptor。它是只读投影，不是另一份 author timeline。

`CapabilityMap` 以稳定 operation code 表达 `supported | blocked | read_only | unverified`。生产写入口不允许 `unverified`；UI 对 blocked 显示原因，服务端仍拒绝绕过请求。

### 1.2 EngineBindingStore

目标路径：`src/host/engine/engine-binding-store.ts`。必须在创建/迁移时写入，普通 edit 不改变。唯一约束：一个 project ID 一条 active binding。加载项目时 binding 缺失或与 source 不匹配进入 attention，不猜默认引擎。

### 1.3 两个 adapter

- `HypitEngineAdapter` 包装当前 `HypitWriteAdapter/HypitReadAdapter`，先保持旧测试不变，再逐步实现 port。
- `OpenFilmAdapter` 使用 M1B 固定上游 SHA 的明确函数；production 代码不可 import spike。所有 native operation 先规范化为 TypedEdit，再由 Host 决定是否执行。

### 1.4 NativeMutationRegistry/Gateway

注册维度：入口 ID、transport（HTTP/WS/IPC/CLI/filesystem/provider）、native operation、typed intent、影响类别、锁类型、策略、理由、测试 ID。必须覆盖 timeline trim/move/split/speed、Inspector、subtitle/audio、asset import、history/undo/redo、provider/CLI、autosave/export、file watch、rename/delete/import/template。

网关行为：known+translated → TypedEdit；known+blocked → 422/能力错误；read_only → 无副作用；unknown → 默认拒绝并记录安全事件。仅禁用按钮不算治理。

### 1.5 SourceDigestV1

目标路径：`src/host/engine/source-digest-v1.ts`。生成 dependency manifest 时解析真实引用闭包，路径统一 `/`，拒绝绝对/穿越/symlink 逃逸；files 按 UTF-8 相对路径字节序排序；对象键 ASCII 排序；UTF-8 无空白；加 `narralens-source-v1\n` 域前缀再 SHA256。提供 TS/Python 黄金向量。

### 1.6 M2.1 最小提交序列

1. 类型、schema、黄金向量、架构 import 测试；
2. EngineBinding 与 Hypit wrapper，旧回归；
3. OpenFilm inspect/capabilities/read path；
4. Native registry 与全部入口默认 blocked；
5. 逐个开放已能 translation 的入口；
6. Source digest 与外部变更检测；
7. EN/TM 自动化证据。

## 2. M2.2：一致提交、持久任务和三类锁

### 2.1 ProjectCoordinator

从现有 `ProjectWriteActor + ProjectOperationQueue` 演进，不创建并行第二 actor。所有项目级 source、binding、lock、history、import commit 必须经过同一项目序列。读操作可并发，但读 active snapshot 必须先解析单一 commit record。

事务状态：`received → preconditions_checked → staged → validated → prepared → committed`；失败为 `aborted | recovering | attention`。每次转换在数据库中校验允许前态；禁止任意 update state。

### 2.2 SnapshotStore/CommitRecord

stage、snapshot、commit record 分离。snapshot 内容不可变，创建完成并 fsync 后才能准备 commit。单一 active commit record 保存 project/revision/snapshot/source digest/engine/transaction；数据库在同一事务更新 revision、record、idempotency、outbox。若文件系统 durability 在 Windows/WSL 不能证明，进入 attention 并记录平台限制。

### 2.3 LockService

锁对象包含 scope/target/range/type（visual/narration/duration）、owner/reason/control revision。服务端从 TypedEdit 和 consumer graph 计算受影响锁，客户端传来的 `preserve` 只是意图，不能替代检查。锁更新与 edit 同队列；commit 前复核 control revision。

### 2.4 PersistentJobStore/Event/Lease

Job 状态：`queued/running/cancel_requested/succeeded/failed/cancelled/attention`。`completed_after_cancel` 旧状态只作为兼容输入，目标归一为 cancelled + quarantined artifact/receipt，不显示可采用。

字段至少含 kind、payload digest、state、lease owner/expires/attempt、provider receipt/cost status、created/updated、terminal reason。事件使用每 Job 单调 seq 或全局稳定 cursor；SSE 重连按 cursor 补发且 UI 去重。worker 以 CAS 获取 lease；未知 provider 完成态不自动重试。

### 2.5 Outbox

commit 与 outbox 记录同事务。发送失败只重放 outbox；consumer 以 event ID 幂等，不再执行 commit。Job callback 只能登记产物/状态，不能直达 Adoption。

## 3. M2.3：迁移副本与回退

`MigrationService` 只支持 M0 inventory 中明确的 fixture/能力；不做通用 Hypit DSL 编译器。流程：一致旧快照 → 新 project/binding → feature inventory → stage conversion → validate → preview/render/reopen/edit/rerender → MigrationReport → 激活副本。

`MigrationReport` 必含 old/new ID、engine/SHA/revision/digest、stable identity map、supported/unsupported/loss、asset/字幕/声音映射、验证和回退结果。未知项阻止激活。

回退停止新项目写入并隔离在途任务，重开旧 Hypit 项目并跑旧短 fixture 导出；保留新 snapshot，不做反向自动转换，不使用 git reset。

## 4. M3：只读素材化

### 4.1 BindingService

对每 Proposal segment 保存 asset ID、source span、目标整数帧范围、fps/timebase、rights digest、binding revision。素材须 cleared/commercial，bytes/MIME/hash 可用且足长；不足不得自动 loop/freeze/speed。

### 4.2 MaterializationSpec

规范输入为 proposal/base/source digest/control revision/bindings/tool versions/profile。canonical digest 决定幂等和 stale。binding/base/control/asset 改变使旧结果 stale。

### 4.3 NativePlanBuilder

产出三个层次：native segment plan（正式可编辑目标）、proxy plan（比较播放）、lineage（审计）。三镜方案必须有三个独立 clip spec 和稳定 ID；proxy 即使是单文件也不能取代 native plan。

### 4.4 ProxyRenderer

通过 PersistentJobStore 执行有限并行 ffmpeg；固定 argv/profile/工具版本；输出无意外音轨、精确帧数和内容 SHA。成功只写 derived/lineage/job/materialization read model；不得调用 Coordinator commit。

### 4.5 Materialize API 状态

M3 之前仍 404。M3 打开后响应 Job；`ready_for_adoption` 只能在所有 segment、proxy、lineage 和重新验证通过后出现。取消/晚到/重启按 M2 Job 契约处理。

## 5. M4：impact、采用、历史与恢复

### 5.1 ImpactService

服务器从当前 snapshot 计算目标范围、消费者、before/after 引用、operation、preserve、expected frames、base revision/source digest/control revision、asset/rights/cost approval、adapter version、expiry。保存完整规范内容，仅把 ID/hash 发给客户端。摘要使用 `narralens-impact-v1\n` 域前缀。

### 5.2 AdoptionCoordinator

复用 ProjectCoordinator：幂等 → engine/base/digest → locks/rights → impact → stage native plan → validate → commit 前复核 → snapshot/commit/outbox。成功恰好 +1；同 key 同 payload 返回原结果；同 key 不同 payload 409；任何失败 revision 不增。

必须验证三镜仍是三个可编辑 clip、总时长与批准 impact 一致、旁白和相邻区域不变。OpenFilm native `rebased=true` 不能覆盖 Narralens 409。

### 5.3 ConsumerGraph 与 HistoryService

ConsumerGraph 描述 narration/subtitle/audio/transition/shared asset 的消费者。任一相关锁阻止影响共享对象的操作。History restore 选择旧 snapshot 内容，但以当前锁/许可/预算重新计算 impact，并提交新 revision；原生 undo/redo 转为此操作，不允许 git checkout 或直接换 active 指针逃避 revision。

### 5.4 RecoveryOrchestrator

启动顺序：打开 stores → 恢复/判定 journal → 重放 outbox → 回收过期 lease → 只在无 attention 后开放写路由。prepared 前可安全 abort；prepared 后按 base/digest 判断恢复或放弃；commit 后事件未发只重放；commit 不确定进入 attention。

### 5.5 M4 真实出口

至少一条真实链：D4.1 proposal → M3 binding/materialize → server impact → adopt → native timeline 独立精修 → render → 关闭 Host/Studio → 重开 → 再 render。保存 source manifest、revision、音轨/字幕/相邻区、ffprobe/帧样本和两次导出证据。

