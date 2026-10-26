# M5 开发前审查闭环与旧设计取代清单

状态：`FROZEN_DECISIONS`

本文件关闭 `m5-document-review-claude-round1.md` 的 3 BLOCKER、12 MAJOR 与 15 MINOR。若本文与同目录 01/02
冲突，以本文的接口和边界为准；实现不得自行选择第三条路线。

## 1. D-01：原生 OpenFilm Studio 采用受控 Gateway，不直连上游端口

M5A 新增 `OpenFilmStudioSupervisor` 与 `OpenFilmStudioGateway`。Supervisor 只从固定且 clean 的 OpenFilm
`e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3` 启动 `startStudio({port: 0, advertise: false,
openBrowser: noop, stays: true, editorDir: <M5 build>})`；扩展 `openfilm-upstream-lock.json`，记录 `startStudio` 实际加载
闭包、Studio UI build 输入、package/lock/license SHA256。任一 HEAD、clean、文件摘要不符即 503
`ENGINE_UNAVAILABLE`，不降级到系统 `latest`。

Gateway 绑定独立的随机 loopback 端口，是浏览器唯一可见的 Studio origin；上游 raw origin、launch key、工程绝对路径
永不进入 WorkbenchProjection、DOM、日志或截图。Gateway 具备 DNS rebinding/Host 校验、随机 HttpOnly SameSite cookie、
Referrer-Policy `no-referrer`、CSP；Narralens Host 只把当前 Supervisor 实际登记的精确 origin 加入 Origin allowlist，
不会放开任意 loopback 端口。`preview.url` 指向 Gateway 的 target 页面，不再指向当前恒 404 的 Host 占位。

M5 build 使用固定上游 `StudioHost` v1 接缝：`onSelection(StudioSelection)` 回传原生 clip/range/playhead，
`onCommand(StudioCommand)` 接收 seek/select/range；seconds 只在 bridge 边界用冻结 rational fps 转成整数半开帧。
每条消息携带 `project_id/snapshot_id/revision`，旧 snapshot 消息丢弃。Narralens 的 DirectorPane 是
`data-studio-host-panel`，原生 OpenFilm App/timeline/player 仍是唯一剪辑视图。

Gateway 对原生 API 使用“读 allowlist、写 deny-by-default”：

- GET/HEAD/WebSocket 只代理显示当前 target 所需的项目、film、frame、media、events；不得列举或打开任意文件夹；
- `POST .../edit` 先把每个 upstream op 映射到 `NativeMutationRegistry`，再经过 `NativeWriteGateway`；M5 只开放现有
  typed `set_visual_fit`、`replace_visual_asset`、`adopt_materialization`、`restore_snapshot`，并通过
  `ProjectOperationQueue/Coordinator` 提交；
- trim/move/split/speed、任意 inspector/style、subtitle/audio/settings/import/relink/delete、upstream history、provider、
  CLI、export 等未受控入口在 UI disabled 且 Gateway 服务器端返回 422 `UNSUPPORTED_EDIT`；未知入口同样拒绝并记录；
- upstream raw `/edit` 永不直接触达 author source。成功提交后 Gateway 重读 WorkbenchProjection；stale native base
  仍按 Narralens 严格 409，upstream `rebased=true` 不能绕过。

因此 M5 的“同页原生精修”仅表示在原生 player/timeline 中完成已报告为 supported 的有限操作；它不承诺 M6 的完整
后期操作集。该设计满足“不建立第二 timeline”和“所有原生写入口 translate/block”。

## 2. D-02：comparison 采用无 provider 的不可变 replay

新增 `POST /api/migration/v1/projects/:target_id/comparisons/replay`。请求：

```ts
interface ComparisonReplayRequestV1 {
  format: "narralens.comparison-replay-request@1.0";
  source_comparison_id: string;
  base_revision: number;
  idempotency_key: string;
}
```

Host 必须证明 target 的 terminal migration；源 comparison 的 `project_id` 必须等于
`ActivatedProjectView.migrated_from`；源 `selection.shot_id` 必须通过 `MigrationReportV1.target_clips[].source_id` 唯一映射
为 target `clip_id`，且帧范围在目标 clip 内。服务端逐字段复制 proposal 内容与原始 `generation_audit`，创建新的
target-owned comparison/id，并追加不可变 lineage `{source_comparison_id, source_project_id, migration_id,
source_sha256}`。它不调用 Runner/provider、不改变 source/revision/active snapshot/ledger。相同 key+digest 重放同一响应，
异体 409；映射缺失/重复为 422。UI 必须显示“已录制提案（原始生成审计）”，不得写成“本次 AI 新生成”。

M5 Headless E2E 中真实的是：既有 D4.1 comparison 的可核验 replay、真实 ffmpeg proxy/media events、真实 impact/adopt
revision +1；不是新的付费生成。新的想法→实时 provider 提案属于 M7，不在 M5 偷跑。

## 3. D-03：字段级身份和 route authority

| M5 字段 | 唯一来源 | 约束 |
|---|---|---|
| `project_id` | `ActivatedProjectView.project_id` | target；页面和所有 Wave 2 写路由使用 |
| `source_project_id` | `ActivatedProjectView.migrated_from` | 必须非空且等于 `MigrationRow.project_id` |
| `migration_id` | `ActivatedProjectView.migration_id` | 对应 terminal report |
| `clip_id` | `EngineProjection.clips[].clip_id` | target selection |
| `source_shot_id` | `MigrationReportV1.target_clips[source_id→target_id]` | 仅 comparison lineage/搜索锚点，不用于 target 写路由 |

Workbench 的 projection 接缝固定为 `ProjectResolver.resolveActivated(target)` →
`ActivatedProjectionService.layoutFor(view)` → `EnginePort.inspect()`；不得调用 legacy catalog，也不得调用对迁移 target
恒 404 的旧 `GET .../engine` 路由。asset 的公开 label 由 target ledger/inventory 的安全 label 生成，绝不回传
`EngineAssetReference.path`；旁白存在性来自迁移 report 的 narration fact，无法证明时为 `unknown` 而非 false。

路由归属：legacy proposal 创建只使用 source；comparison replay、materialize、impact、adopt、history、locks、workbench
全部使用 target。SelectionContext 同时携带 target `clip_id` 与只读 `source_shot_id|null`，禁止把二者互换。

## 4. D-04：PublicLock、稳定 owner 与严格 CAS

闭合枚举：`lock_type = visual|narration|duration`；`scope = project|shot`；`reason_code = preserve_visual |
preserve_narration | preserve_duration | user_review | approved_content`。

```ts
interface PublicLockV1 {
  format: "narralens.public-lock@1.0";
  lock_id: string; project_id: string; lock_type: LockType; scope: LockScope;
  target_id: string | null; start_frame: number; end_frame_exclusive: number;
  owner_label: "本机操作者"; reason_code: LockReasonCode;
  control_revision: number; created_at: string;
}
interface LockMutationResponseV1 {
  format: "narralens.lock-mutation-response@1.0";
  project_id: string; lock: PublicLockV1; active: boolean; control_revision: number;
}
```

V1 是单操作者模型。owner 不是每进程随机 token，而是 SQLite `host_identity` 表中安装时创建并持久化的 actor UUID；
API 只公开固定 label，不公开 UUID/token。任何持有当前有效本地 Host session 的调用方都可释放本项目锁；跨项目 id 404。

`base_control_revision` 必须等于当前 `project_state.control_revision`，否则 409 `REVISION_CONFLICT`。比较、lock 行变更、
control_revision +1 与 `lock.changed` outbox 必须在一个 `BEGIN IMMEDIATE` 事务内；CAS 失败零 lock/outbox 变化。
这要求新增 RevisionStore CAS 变体，不能复用当前只做 `+1` 的方法。LockControls 必须显示 type/scope/range、
`owner_label/reason_code`、创建时 control revision 与显式释放动作。

## 5. D-05：Story Atlas、路由与取代关系

Story Atlas 是“章节/语义卡片 + 目标 clip 锚点”的结构导航视图；不得以帧为 X、轨道为 Y 绘制轨道网格，不得支持
剪辑/拖拽/重排。帧×轨道只由 OpenFilm 原生 timeline 渲染。`SelectionCoordinator` 是 SelectionStore 的唯一写入口，
属于 RefineWorkspace 服务层而非第二 store。

M5 URL 使用 `#/idea` 与 `#/refine/:target_project_id`；`#/delivery-preview/:target_project_id` 仅展示 M6 尚未开放。
本节取代早期 `/projects/:id/{idea,refine,delivery}` 文字，但保留 target id。布局、字号、断点以 01 §7 为准并明确取代
`prototype-v1/index.html` 的 230px/1100px/720px 数值；视觉语言与信息架构仍继承已批准原型。

旧 `docs/handoff-m2-m7d-claude/04/05/10` 是迁移规划输入。本包明确取代或延期：

- `POST /projects`/ProjectCreationService 延至 M6/M7 的空白想法链；M5 只打开/迁移已存在事实项目；
- `story-projection` 合并入 target `workbench` read model；`checkpoints` 本阶段不持久化；
- ContextDrawer/DecisionBar 分别由 InspectorHistoryDrawer/DirectorPane actions 承担；
- `EngineProjectionStore` 改名 WorkbenchStore（不保存 author timeline），`CommandGateway` 由
  HostApiClient + NativeStudioGateway 承担；
- 900 秒真实长片质量证据仍属 M6/M7；M5 使用 3–5 分钟真实媒体 fixture + 120 clip 结构压力 fixture；
- 旧“六类候选”在 M5 只展示 capability，只有已实现的视觉 proposal 可操作，其余 disabled + 原因。

## 6. D-06：路由 fitness 的唯一授权扩展

M5A 可把 `tests/architecture/m2.2-fitness.test.ts` 的精确 `/api/migration/v1` 白名单从 12 条扩为 16 条，仅新增：

1. `projects/:id/workbench`；
2. `projects/:id/locks`；
3. `projects/:id/locks/:lock_id`；
4. `projects/:id/comparisons/replay`。

Studio Gateway 使用独立 loopback origin，不占 `/api/migration/v1` route。同步更新 `docs/03_Architecture.md` 的旧
“只挂载 engine 只读路由”为“只挂载阶段明确授权的精确白名单”。必须新增/更新 mutation gate，逐条删除或增加未授权
route 都会红；不得删除、改为 `contains` 或放宽其他断言。“旧 1040 测试不删不弱化”仅允许上述受控前向扩展。

## 7. D-07：Headless、fixture、200% 与 BLOCKED_ENV

M5C 新增一个仓内 browser harness：发现本机 Chrome（允许显式 `NARRALENS_CHROME_PATH`），用 `child_process.spawn`
固定 argv 启动 `--headless=new --mute-audio --remote-debugging-port=0`、临时 profile 与随机 loopback；捕获真实端口，
测试结束在 `finally` 关闭自己启动的 Chrome/Host/Gateway 并删除临时 profile。不得依赖用户手工启动 CDP，不新增会联网
下载浏览器的依赖。若未来新增 Playwright，必须另有 ADR、精确版本、许可证、lockfile 且只使用已有本地二进制。

原生 200% 复用 `tests/evidence/create-d421-headless-zoom-profile.mjs`：在同一隔离 profile 写入
`partition.default_zoom_level.x = ln(2)/ln(1.2)`，读回 DPR=2、布局视口约为 100% 的一半并断言无页面级横溢出；
不得用 deviceScaleFactor、缩小 viewport 或 CSS transform 冒充。

体验 fixture 由固定 OpenFilm 上游和本地 ffmpeg 确定性构建 3–5 分钟、20+ clip、至少三路可解码 proxy；允许重复已
验真实片段来验证系统交互，但必须标注“不证明内容质量/长片体验”。120 clip/6+章是结构压力 fixture，同样不冒充
长片质量证据。两者都记录生成命令、上游 SHA、媒体 SHA256、ffprobe 与完整 decode。缺固定 checkout、Chrome、ffmpeg
或 fixture 时合法终态是 `M5_BLOCKED_ENV`：不得启动人工体验门，不得声明 `M5_HEADLESS_EVIDENCED`，也不得用 mock
替代后宣称 E2E。

## 8. D-08：外审遗留、安全和报告

Wave 2 组合外审权威路径为
`docs/evidence/WAVE2/reviews/wave2-combined-external-review-claude.md`。M5 必须逐项关闭：生产锁 API + owner 展示；
undo/redo 文案为“准备恢复意图”；同页状态不得依赖 legacy `pnpm recover`（它是独立 legacy queue/catalog）；
permanent attention 与粘滞 500 必须解释，只有用户明确“新建请求”才换 idempotency key。

不得读取或使用仓库根未跟踪 `narralens-d1`，不得读取 `J:\`，不得联网/provider/付费。HTML 报告至少包含：基线和
冻结 SHA、逐 case 状态、命令/exit/原始日志索引、截图索引、DOM/a11y/performance JSON、浏览器/硬件/profile/zoom、
媒体/ffprobe/decode SHA256、NOWRITE/事务差异、失败捕获、内外审状态、回退步骤、限制与 `NOT_RUN`。
