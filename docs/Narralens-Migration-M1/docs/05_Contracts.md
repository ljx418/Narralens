# 合同、状态机、事务、时间与错误语义

## 1. 本包合同的性质

`contracts/migration-contracts.schema.json` 是 **拟议的 Narralens migration/1 合同**，不宣称仓库现在已有这些路由/字段。本地Codex首先把现有D4.1、typed media.replace、import/manifest合同做映射，保留错误码与兼容客户端；新增命名空间使用 `/api/migration/v1/...`。已存在语义不新建同义接口。OpenFilm内部路由必须从固定SHA登记后调用。

## 2. 必须区分的版本

| 名称 | 意义 | 改变条件 |
|---|---|---|
| repo_commit | 开发代码版本，如用户报告304c891 | 代码提交 |
| project_revision | 影片已提交编辑版本，单调递增 | 一笔真实成功编辑/恢复一次+1 |
| source_digest | source依赖闭包SHA256 | film/scenes/字幕/设置或引用资产改变 |
| asset_manifest_revision | 资产库存版本 | 导入/登记；不会因此自动+project_revision |
| control_revision | 锁/许可/预算等控制策略版本 | 策略变更；旧impact需复核 |
| proposal/job_revision | 提案/任务状态 | 不等于已采用影片变更 |

OpenFilm自身短rev仅是native适配器的内部信息；不得覆盖Narralens的project_revision。所有幂等键按project、operation、请求摘要定位；同key同payload返回原结果，不重复commit；同key不同payload→409 IDEMPOTENCY_CONFLICT。

## 3. EnginePort目标接口

```ts
interface EnginePort {
  inspect(snapshot: SnapshotRef): Promise<EngineProjection>;
  capabilities(): Promise<CapabilityMap>;
  plan(snapshot: SnapshotRef, intent: TypedEdit): Promise<EngineEditPlan>;
  stage(plan: EngineEditPlan, isolatedRoot: string): Promise<StagedSource>;
  validate(staged: StagedSource): Promise<ValidationReport>;
  preview(snapshot: SnapshotRef): Promise<PreviewDescriptor>;
  render(snapshot: SnapshotRef, profile: RenderProfile): Promise<JobRef>;
}
```

不是给任意shell command的接口。commit由Host拥有，port不自增revision、不改锁；Hypit和OpenFilm各自实现。真实模块落点由M0填code-map，类型以已存在合同扩展。

## 4. Proposed API和能力开关

| 新语义（建议路由） | 输入/输出 | 禁止副作用 |
|---|---|---|
| GET /api/migration/v1/projects/:id/engine | binding/capabilities/snapshot | 不自动迁移 |
| POST .../:id/migrate-copy | 旧snapshot＋target engine → job | 不覆盖旧项目 |
| POST .../:id/proposals/:pid/materialize | base＋bindings＋idempotency → job | 不写author source/revision |
| POST .../:id/impact | typed intent/ready materialization → server impact | 不采用，不生成付费资产 |
| POST .../:id/edits | base＋impact id/hash＋intent＋idempotency → revision | 不越过锁/范围；复用现有edit语义 |
| POST .../:id/history/restore | target snapshot＋current base＋impact → new revision | 不倒退revision、不绕锁 |
| GET .../jobs/:id / events | 状态、递增event seq；cursor恢复 | UI重复事件不能引起重复commit |

在M1A阶段 materialize/adopt 仍按旧冻结规范不可达（404），虚构operation为422。迁移新路由也默认关闭；M3才能开放materialize，M4才开放adopt。直接绕UI发HTTP必须得到相同结果。

## 5. 时间模型

所有选择/segment使用 `[start_frame,end_frame)`；fps为有理数num/den，源视频保留真实timebase/PTS，不默认源也30fps。`t=frame*den/num`，写入OpenFilm秒单位后重新解析，round-trip误差不能超过半个目标帧，最终边界必须回到相同整数帧。首个门只启用30/1目标规格；其他帧率在capabilities标未验，不静默重采样。

例如镜头 `[1800,2100)`，选区 `[1932,2100)`；三镜方案为56+56+56帧，前132帧保持；采用后镜头数变化但全片帧数不变。每个segment保留独立source span和assetId，不能只剩一条合成视频。镜头不足时禁止隐式循环、冻结帧或变速填满；有意改变需在提案中声明。

## 6. source_digest 与影响快照

source manifest按规范化相对路径排序，记录role/path/sha256/size；覆盖film.html、被引用scene/html/js/css、字幕、设置、字体与实际媒体内容哈希。未引用候选/缓存不进入author digest。锁、rights、asset绑定版本单独纳入impact摘要。外部依赖必须vendor到固定资源或形成可校验的固定引用；未固定网络资源不允许声称可复现输出。

impact由服务器从当前snapshot计算：目标范围、消费者、前后引用、允许操作、preserve项、expected_total_frames、base_revision/source_digest、control_revision、相关资产/许可摘要、费用授权引用、adapter版本、expiry。请求仅传回impact id/hash，不能相信客户端自己声称“影响为零”。全局asset库存追加无关素材不必使全部提案失效；被引用asset内容/许可改变必须拒绝或重审。

### 摘要算法与恢复边界的冻结规则

新增schema的摘要采用本项目明确的canonical规则，而不假称是上游协议：对象键按ASCII键名排序，数组保持语义顺序；files数组预先按UTF-8相对路径字节序排序；路径统一`/`但不改大小写、不擅自改Unicode文件名；UTF-8 JSON不含空白，所有合同数值为整数，FPS用有理数，不允许NaN/Infinity/浮点时间。source manifest摘要输入排除source_digest、snapshot_id和访问时间，只包含engine、engine_sha及每个已排序的path/role/sha256/bytes；加域前缀`narralens-source-v1\n`后SHA256。影响摘要另加`narralens-impact-v1\n`，排除impact_hash自身，包含server保存的完整规范化影响内容。M2提供TS/Python一致的黄金向量；既有摘要算法不破坏，必要时新增digest_version。

恢复只恢复创作内容，不恢复过去的锁/许可/预算控制状态。当前控制策略持续生效；恢复也要重新计算受影响消费者和impact。运行中的导出固定旧snapshot并可继续，新编辑提交只影响下一次导出；不应把旧导出挂成新revision的结果。

## 7. 采用事务

`received → preconditions_checked → staged → validated → prepared → committed`；失败分支为 `aborted/recovering/attention`。

1. 进入统一ProjectActor，查幂等结果；核对项目引擎、revision、完整digest、impact、控制状态和受影响锁。
2. 为本次snapshot生成隔离stage；native apply只改stage。实现帧范围、共享对象、素材和字幕等不变量检查。
3. 运行真实parse/look/必要preview样本；执行时间上限和取消检查。commit前重新确认active base与授权未过期。
4. 保存prepared不可变snapshot与journal；写单一持久commit-record，包含new revision、snapshot和可重放outbox。reader只通过已提交record选择源。
5. 发布事件和刷新投影；无论请求重试/晚回调，revision恰好+1。发布事件失败不反向重复commit，重启从outbox续送。

多文件修改不假称一次rename能原子完成全部源和metadata。通过不可变snapshot＋一份active commit-record提供一致读取；metadata store若是数据库必须同事务提交revision/outbox。文件实现则原子替换单个commit-record且先fsync所需snapshot，平台支持在M2实测；不能确认durability则attention并阻止进一步写入。

崩溃在prepared前：主工程不动，stage保留供审计或安全清理。prepared后、commit前：校验base仍一致后可恢复或放弃；不得无授权自动继续收费。commit后事件前：重放outbox，已提交状态不重复采用。commit不确定：attention，不猜成功也不自动覆盖。

## 8. Materialize 与任务状态

提案：`proposed → comparing → bindings_ready → materializing → ready_for_adoption → adopted`；可转 `stale/failed/cancelled`。materialize产物含native segment plan和proxy、lineage、source/selection/base hashes。完整组合中的每个片段均需范围匹配；artifact内容哈希固定。

Job：`queued/running/cancel_requested/succeeded/failed/cancelled/attention`，CAS lease owner与attempt；事件seq持久单调。取消不等于立即停止。取消成功后晚到结果可作为quarantined artifact登记，但不能改变source或显示ready-for-adoption。外部服务未知完成态不得自动重发收费请求；记录provider receipt并待核对。

最低持久Job/Event/lease/cancel先在M2完成，M3才能使用。模型调用、proxy准备、正式生成、最终渲染分别记job kind；浏览已有proxy不是一次新模型调用。

## 9. HTTP与错误优先级

先认证/Origin，再结构校验与能力，再幂等结果，再revision/digest，再控制锁/许可，再impact有效性，最后执行；同一个请求同时有多个错误时按此顺序稳定返回。

| HTTP | 新设计错误语义 | 条件 |
|---|---|---|
| 401/403 | AUTH_REQUIRED / ORIGIN_DENIED / DATA_POLICY_DENIED | 原有安全合同优先，不泄露工程信息 |
| 404 | CAPABILITY_NOT_ENABLED/未开放路由 | 不泄露待上线写路径 |
| 409 | REVISION_CONFLICT / SOURCE_CHANGED / IDEMPOTENCY_CONFLICT | source/base/请求重用冲突 |
| 423 | TARGET_LOCKED / PROJECT_ATTENTION | 对象锁或恢复未决 |
| 428 | IMPACT_REQUIRED / IMPACT_STALE / APPROVAL_REQUIRED | 缺少/过期影响确认或授权 |
| 422 | UNSUPPORTED_EDIT / MISSING_ASSET / INVALID_RANGE | 类型/范围/能力无效 |
| 503 | RUNNER_UNAVAILABLE / ENGINE_UNAVAILABLE | 工具缺失；不降级成假成功 |

错误码名称为目标建议；M0不得打破现有兼容路由。差异以API compatibility表决定alias、新版本或保留旧码，不为“统一”随意改旧HTTP行为。
