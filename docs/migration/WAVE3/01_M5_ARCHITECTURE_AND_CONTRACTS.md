# M5 同页 OpenFilm Studio：架构与合同锁

状态：`REWORKED_CANDIDATE_FOR_INDEPENDENT_REVIEW`
声明上限：`M5_HEADLESS_EVIDENCED`；人工体验签署后才可 `M5_HUMAN_ACCEPTED`。

强制补充合同：`04_M5_REVIEW_CLOSURE_AND_SUPERSESSIONS.md`。它冻结 Studio Gateway、comparison replay、身份映射、
锁 CAS/owner、fitness 前向扩展、Headless/fixture 与旧 handoff 取代关系；实现不得只读本文而跳过 04。

## 1. 用户结果与范围

用户在一个页面完成：打开已迁移 OpenFilm 项目 → 章节/镜头/语义/时间码定位 → 真实预览与原生 timeline 同步 →
比较 3–6 个已有 D4.1 提案 → 绑定/素材化 → 查看 server impact → 显式确认采用 → 关闭重开 → 精修中镜 →
从 history 生成恢复意图并再次 impact/确认恢复。

M5 不承诺：从空白想法自动下载全部素材、生产 render route、标题 8 个/封面 4 个、preflight、发布包、真实 provider
新调用、10–15 分钟长片性能。这些属于 M6/M7。Idea 页在 M5 保存本地草稿并选择/迁移已有事实项目，不把草稿
冒充已生成项目。

## 2. 零层架构

```text
Hash StageRouter: idea | refine | delivery-preview
        │
        ├─ WorkbenchStore（只持 UI 草稿、焦点、展开状态）
        ├─ SelectionStore（唯一 selection：project/snapshot/clip/range/script anchor）
        ├─ PlaybackClock（整数帧权威；HTML media seconds 仅投影）
        └─ HostApiClient（session + typed contracts + idempotency + SSE/poll）
                         │ exact registered loopback origins only
                         ▼
NarralensHost ─ WorkbenchProjection / Lock routes（M5A 新增）
              ├─ ProjectResolver + ActivatedProjectionService
              ├─ MigrationStore（source↔target 映射）
              ├─ LockService（三类真实持久锁）
              ├─ Proposal/Materialize/Impact/Adoption
              └─ History intent/Impact/Restore
              └─ OpenFilmStudioSupervisor / Gateway
                  ├─ fixed upstream Studio + StudioHost v1 selection/command bridge
                  ├─ read allowlist / native writes translate-or-block
                  └─ exact-origin session, raw upstream key/path never exposed
                         │
                         ▼
Pinned OpenFilm Studio / preview（唯一原生 timeline 与播放器）
```

不得在 React store、Canvas、Story Atlas 或候选卡中保存一份可独立恢复影片的完整 clip 列表。UI 投影丢失后必须能
由 Host + OpenFilm source 重建；`revision/source_digest/control_revision/snapshot_id` 永远来自 Host。

## 3. 项目身份与一条时间线

同页体验隐藏技术切换但不混淆身份：

- `source_project_id`：既有 Hypit/D4.1 proposal 的来源，只读生成与迁移输入；
- `project_id`：迁移后的 OpenFilm target，是 materialize/impact/adopt/history/locks 的唯一目标；
- `migration_id`：证明二者映射的不可变事实；
- 页面 URL 永远使用 target `project_id`；API 请求不得靠 UI 猜 source id。

字段必须按 04 §3 的表绑定：target `project_id` 来自 `ActivatedProjectView.project_id`；source 来自
`migrated_from` 并与 `MigrationRow.project_id` 互证；clip 与 source shot 只能经 report target_clips 唯一映射。

M5A 的 workbench read model 必须由 MigrationStore/ProjectResolver 证明映射，不能由 query string 自报。若项目没有
terminal migration、binding、active commit 或 ledger，页面显示明确 blocked 状态，不降级到 legacy 编辑器冒充成功。

## 4. M5A Host 合同

### 4.1 Workbench read model

新增 `GET /api/migration/v1/projects/:id/workbench`，只读返回：

```ts
interface WorkbenchProjectionV1 {
  format: "narralens.workbench@1.0";
  project_id: string;
  source_project_id: string;
  migration_id: string;
  revision: number;
  control_revision: number;
  source_digest: Sha256;
  active_snapshot_id: Sha256;
  fps: { num: number; den: number };
  frame_count: number;
  engine: "openfilm";
  engine_upstream_sha: string;
  tracks: readonly WorkbenchTrackV1[];
  clips: readonly WorkbenchClipV1[];
  history: readonly HistoryEntryV1[];
  active_locks: readonly PublicLockV1[];
  capabilities: readonly WorkbenchCapabilityV1[];
  preview: { kind: "openfilm-studio"; url: string; bridge_version: 1 };
}
```

接缝固定为 `ProjectResolver.resolveActivated(target)` → `ActivatedProjectionService.layoutFor(view)` →
`EnginePort.inspect()`，不得走 legacy catalog 或旧 `/engine` route。`WorkbenchTrackV1/ClipV1` 是无路径只读投影，
保留 target clip id、唯一映射的 source shot id（无则 null）、kind、整数帧范围和 track 顺序。字幕来自 projection；
旁白存在性来自 migration report（无法证明为 `unknown`）；资产公开 label 来自 ledger/inventory，绝不回传 path。
禁止绝对路径、session token、adapter 类名、SQLite 文案或 author source bytes。
响应必须通过 runtime JSON Schema、TS 类型和 validator；额外字段拒绝。

### 4.2 用户锁合同

新增：

- `POST /api/migration/v1/projects/:id/locks`
- `DELETE /api/migration/v1/projects/:id/locks/:lock_id`

请求只能带 `format`、`base_control_revision`、`lock_type`、`scope`、`target_id`、半开帧范围、受限 `reason_code`、
`idempotency_key`。闭合枚举、`PublicLockV1`/response 形状、稳定安装 actor 和事务 CAS 见 04 §4。owner 由 Host
持久身份派生，客户端不得自报；项目级锁 target 为空但范围必须覆盖当前影片，
shot 锁 target 必须是当前 projection clip 且范围在 clip 内。创建/释放经过 `ProjectOperationQueue` 并 CAS
`control_revision`；跨项目 lock id 一律 404；同 key 同体重放相同响应、异体 409。V1 锁持久存在直到显式释放，
不伪造 lease/自动过期。

### 4.3 Comparison replay（无新 provider）

新增 `POST /api/migration/v1/projects/:target_id/comparisons/replay`，严格执行 04 §2：只把已验证的 source D4.1
comparison 复制成带 lineage 的 target-owned immutable comparison；不调用 Runner/provider、不改 revision/source。

### 4.4 OpenFilm Studio Gateway

Studio 启动、固定上游校验、exact-origin、`StudioHost` selection/command bridge、read allowlist 与所有 native write
translate/block 规则以 04 §1 为唯一合同。当前 adapter `preview()` 的 404 是待替换接缝，不得冒充已实现。

### 4.5 既有路由不改语义

M5 只消费既有 migration/proposal/materialize/impact/adopt/history 路由。`undo/redo` HTTP 200 只表示成功生成 typed
restore intent；UI 文案固定为“准备撤回/重做”，随后仍需 impact 与确认，绝不能显示“已撤回”。`asset.import` 保留其
专用 Host transaction，不为了形式统一重写 Wave 2 已通过模块。

## 5. 前端状态与组件边界

```text
NarralensApp
├─ AppShell / StageRouter / ThemeControl / GlobalStatus
├─ IdeaWorkspace
│  ├─ CreativeTaskDraft
│  └─ ProjectOpenOrMigrate
├─ RefineWorkspace
│  ├─ ChapterNavigator / SemanticSearch / ShotRail
│  ├─ OpenFilmPreviewSurface
│  ├─ StoryAtlasSurface（投影，不是 timeline 权威）
│  ├─ NativeTimelineBridge
│  ├─ DirectorPane
│  │  ├─ ProposalCompare / CandidateFocus
│  │  ├─ MaterializationStatus
│  │  ├─ ImpactReview / ApprovalDialog
│  │  └─ LockControls
│  └─ InspectorHistoryDrawer
└─ DeliveryPreview（只说明 M6 未开放及当前阻塞，不提供假导出）
```

`SelectionStore` 的唯一形状：

```ts
type SelectionContext = {
  project_id: string;
  snapshot_id: Sha256;
  clip_id: string;
  source_shot_id: string | null;
  range: { start_frame: number; end_frame_exclusive: number };
  script_anchor?: string;
};
```

所有组件通过 `SelectionCoordinator` 读写它；timeline/player/章节/搜索互相驱动时必须防循环、保持同一 snapshot。
revision 改变后，旧 selection 只在 clip identity 仍存在且范围合法时重定位，否则保留草稿并要求用户重新选择。

`SelectionCoordinator` 是 RefineWorkspace 的服务层，也是 SelectionStore 唯一写入口，不是第二 store。StoryAtlas 是
章节/语义卡片导航，不绘制帧×轨道网格、不支持拖拽剪辑；唯一 timeline 是原生 OpenFilm timeline。

## 6. 完整交互状态

受控状态词：`proposal_only`、`bindings_required`、`materializing`、`preview_ready`、`approval_required`、
`ready_for_adoption`、`adopted`、`stale`、`failed`、`cancelled`、`attention`。

- 409：显示 base/current，保留草稿，动作是重新加载并重新计算；
- 422：展示缺素材/不支持能力/无差异，绝不展示可采用；
- 423：展示 visual/narration/duration、owner/reason，允许有权限者显式释放；
- 428：展示 impact 过期或缺批准，重新计算，不静默复用；
- 500 粘滞失败：同 idempotency key 重放同一失败；UI 明示失败已绑定本次请求，只有用户明确“新建一次请求”才生成新 key；
- 503：草稿保留、手动重试；瞬时错误不显示 permanent drift；
- attention：终态、不可自清；M5 没有后端恢复能力时显示“需要工程处理”，不得给假修复按钮。

## 7. 视觉与 CSS 基础

- 现有深色暖黑/琥珀主色作为默认，补齐浅色与 system；主题切换必须保存偏好。
- 4px 基础 spacing；文本至少 12/14/16/20/28px 层级；焦点环不依赖颜色变化。
- 本节的尺寸与断点明确取代批准原型 HTML 中的 230px/1100px/720px 实现数值，但不取代其信息架构与视觉语言。
- 桌面 1440×900：左导航 240–300px，中预览自适应，右面板 340–420px，底部 timeline 180–260px；无页面级横溢出。
- 1024–1439：右面板可折叠为 drawer；768–1023：左导航和 inspector 互斥 drawer；小于 768 只提供审阅/轻操作，
  原生精剪明确要求更宽视口，不把控件压成不可用。
- 动效 180–240ms，Story Atlas 展开不超过 420ms；播放头不缓动；`prefers-reduced-motion` 关闭装饰动画。
- 新代码采用组件级 class + CSS custom properties；禁止随意内联颜色/间距。除非有 ADR、固定版本、许可证和 lockfile
  证据，否则不新增 UI 依赖；优先使用现有 React 和原生语义元素。

## 8. 可访问性与键盘

- `/` 搜索；左右逐帧，Shift+左右一秒；J/K/L 可配置但默认启用；I/O；F；本波新增 Escape 关闭最上层弹层并恢复触发点焦点。
- Cmd/Ctrl+Z 只撤销未提交 UI 草稿；已提交内容必须走 history intent→impact→confirm restore。
- tablist、dialog、listbox、status/live region 使用正确语义；焦点不会落入卸载/虚拟化项目。
- 所有自动测试 Headless、静音、隔离 profile、无窗口、不抢焦点。200% 机制与读回断言严格复用 04 §7：隔离 profile
  的 native default zoom + DPR/布局视口读回；不得用 deviceScaleFactor、viewport 缩半或 CSS transform 冒充。

## 9. 性能合同

真实系统体验 fixture：3–5 分钟、20+ clip、至少 3 路真实 proxy，按 04 §7 由固定上游与本地 ffmpeg 构建并完整解码；
它证明系统交互而不冒充内容质量。结构压力 fixture：120 clip、6+ 章，可由本地确定性
生成但必须标注不是长片质量证据。selection/pan/zoom/chapter 各 100 次，event→paint p95≤100ms；保留所有原始样本、
硬件、浏览器、编码、冷/热启动、首帧、丢帧和内存峰值。渲染/AI 延迟不得混进交互 p95，也不得删掉慢样本。

## 10. 安全与回退

仅 loopback + bearer session；前端不持久化 token、绝对路径、source bytes 或 provider secret。Preview URL 必须由
受控 Supervisor 生成且为已登记 loopback Gateway。不得读取或使用未跟踪 `narralens-d1`。关闭 M5
workbench/replay/locks 与 Studio Gateway 并恢复旧 `NarralensApp` 即可回退 UI；不得 reset 数据库、删除 Wave 2
表、snapshot 或迁移副本。

## 11. 架构 fitness 前向演进

M5A 唯一授权的旧门变更是按 04 §6 把 migration route 精确白名单由 12 扩为 16，并同步 mutation gate 与主架构文字；
除此之外旧测试不得删除、跳过或放宽。新路由少一条、多一条或拼写漂移都必须使门变红。
