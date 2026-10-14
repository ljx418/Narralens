# Narralens V1 规格—架构—开发—验收追踪矩阵

版本：v1.0  
状态：实际开发已批准；Gate D1、Gate D2、Gate D3、Gate D4.0、Gate D4.1 已通过；D4.2 总体文档方向和子阶段边界已通过内外审；D4.2.1 文档整改后通过第二轮外审，允许进入实现守门，生产实现未开始。
事实日期：2026-10-14

## 1. 使用规则

每个需求必须同时具备责任实体、开发阶段、测试编号和出门证据。`planned` 不能被解释为 `implemented`；D1 只实现真实底座夹具、探针和契约，业务实体仍未开发。

## 2. P0 追踪

| PRD | 责任实体 | 阶段 | 验收测试 | 必需证据 | 当前状态 |
|---|---|---|---|---|---|
| P0-01 项目创建/任务包 | `IdeaWorkspace`、`CreativeTaskSchema`、`ProjectActor` | D2 | `AT-IDEA-01` 导入合法/非法包并重开 | 工程目录、校验日志、重开截图 | not-started |
| P0-02 章节/脚本/镜头 | `ChapterNavigator`、`SelectionCoordinator` | D2–D3 | `AT-NAV-01` 三种入口定位同一对象 | stable ID/时间范围对照 | partial：D2/D3 三个稳定 shot 与单镜选区可用；章节与三入口仍待后续阶段 |
| P0-03 真实播放器/时间码 | `RealPreviewSurface`、`HypitAdapter` | D1–D2 | `AT-PREVIEW-01` 帧时间往返 | 真实 Run、时间码/抽样帧 | partial：D2 真实 descriptor/900 帧/30fps/预览入口；完整播放器待后续 |
| P0-04 全片/局部时间轴 | `TimelineSurface` | D2–D3 | `AT-TIMELINE-01` 缩放不改变选区 | 120 镜头 trace、选区日志 | not-started；D1 前置已清除 |
| P0-05 镜头/区间/逐帧 | `SelectionCoordinator` | D3 | `AT-SELECTION-01` `[start,end)` 边界 | 首尾帧样本、契约测试 | partial：D3 单镜稳定选区/边界已通过；区间与逐帧 UI 待后续 |
| P0-06 3–6 提案 | `DirectorPane`、`ProposalCompare`、`ProposalComparisonAdapter` | D2–D4 | `D41-CONTRACT/COUNT/DIVERSITY/DURATION/REF/TRUST/STAGING/REV/NOWRITE/CANCEL/PROVIDER/RUNNER/UI/A11Y/SEC/REGRESSION` 全族 | Runner 审计、ProposalComparison、结构签名、工程 SHA、Host 写调用计数、浏览器证据 | done：D4.1 生产实现、80/80、真实 CLI 三案、浏览器/NOWRITE 与内外实现审查通过；不包含 P0-07 采用 |
| P0-07 分项锁 | `ProjectWriteActor`、`LockPolicy` | D3–D4 | `AT-LOCK-01` UI/Agent 同时被阻止 | 423 响应、资产哈希不变 | partial：仅 D3 visual 服务端主动锁这一项通过；D4.2 计划复验 visual lock，但 narration/duration 主动锁与完整 P0-07 仍待后续 |
| P0-08 素材/来源/许可 | `AssetRegistry`、`AssetImportService`、`MaterializeService` | D4 | `D42-IMPORT/LICENSE/MAT/SEC` | import/ffprobe、manifest v2、lineage、422/428、许可清单 | partial：D4.0 本地 cleared 清单、来源/许可展示与真实替换已验；D4.1 已展示每案素材需求；D4.2 本地导入、derived lineage、实体化与审批仅 docs-only，外传/provider 不在本阶段 |
| P0-09 局部差异确认 | `ImpactPreview`、`EditTransaction` | D3–D4 | `AT-DIFF-01`、`D42-APPROVAL/ADOPT` | before/after diff、impact SHA、帧数/边界帧 | partial：D3 fit before→after、精确 Source 与全 item 不变量通过；D4.2 当前只有采用影响确认计划 |
| P0-10 版本/撤回/恢复/冲突 | `RevisionService`、journal | D3–D5 | `AT-REV-01` 409、恢复产生新 revision | event log、重开记录 | partial：D3 monotonic revision/409/journal/启动恢复通过；用户历史恢复待 D5 |
| P0-11 重开与 MP4 | `HypitAdapter`、`RenderService` | D1、D6–D7 | `AT-EXPORT-01` 双导出、重开、改一镜 | MP4、ffprobe、工程哈希 | D1 30 秒夹具通过；真实母项目待 D6–D7 |
| P0-12 标题/封面 | `DeliveryWorkspace` | 第 2 周 | `AT-DELIVERY-01` 8 标题/4 封面、正文一致性 | 候选记录、人工选择 | not-started |
| P0-13 发布前检查 | `PreflightChecklist` | D6–D7 | `AT-PREFLIGHT-01` 黑帧/字幕/音量/来源 | 报告、抽样帧、许可清单 | not-started |

### D4.2 子阶段测试映射

| 子阶段 | 总体 D4.2 测试族 | 子阶段测试/证据 | 边界 |
|---|---|---|---|
| D4.2.1 | `D42-IMPORT`、`D42-LICENSE-01`、`D42-HYPIT-01`、`D42-SEC-01` 的导入/登记部分 | `D421-CONTRACT/ERRORCODE/HTTP/LIMIT/MEDIA/MIGRATE/IDEMP/QUEUE/HYPIT/INVENTORY/CACHE/NOWRITE/UI/SEC/LARGE/ROUTE/DEP/REG` | 只登记与库存；不 materialize、不 adopt、不写 Source/revision |
| D4.2.2 | `D42-MAT`、`D42-FRAME`、`D42-JOB`、`D42-SYNTHETIC` | segment binding、recipe、composite、lineage、真实帧抽样与只读 NOWRITE | 只读实体化；只到“已准备采用” |
| D4.2.3 | `D42-APPROVAL`、`D42-ADOPT`、`D42-ATOMIC`、`D42-E2E` | impact SHA、428、typed media.replace、revision +1、补偿/attention、build/restart | 唯一允许把已批准 composite 写入 Source 的子阶段 |

因此 `D421-*` 只关闭相应 `D42-*` 的前置子集，不得据此把 P0-08、P0-09 或 Gate D4.2 标记为完成。

## 3. 非功能追踪

| PRD | 架构控制 | 测试 | 门限 | 当前状态 |
|---|---|---|---|---|
| NFR-01 本地优先 | loopback Host、受控 Runner、AssetRef 审批 | `AT-SEC-01` Origin/token、路径穿越、锁定版本 gitleaks 或等价扫描器 | 无凭据进入前端/JSON/日志；记录工具/版本/规则集/时间与 `docs/evidence/<phase>/security/credential-scan.json`；外传逐任务记录 | partial：D2 loopback/Origin/token/路径/外传清单通过；AssetRef 审批待 D4 |
| NFR-02 可恢复 | ProjectWriteActor + journal + append-only event log | `AT-RECOVERY-01` 在四个 journal 状态注入崩溃 | 重启恢复到最后提交 revision，主 Source 不损坏 | partial：D3 prepared/target/committed/attention 路径通过；D4.1 只保证 comparison 原子可见且如实声明在途任务可丢失，不推进本项；完整任务/历史恢复待 D5 |
| NFR-03 可观察 | Job state + SSE + correlation ID | `AT-OBS-01` 断线重连/晚到/取消 | 无重复事件；费用与“已请求取消”如实显示；无假百分比 | partial：D2 event replay/live、取消状态、correlation ID 与 Runner audit 通过；持久事件待 D5 |
| NFR-04 可测试 | schema/contract/fixture/ffprobe/frame sampling | `AT-CONTRACT-01`、`AT-E2E-01` | 每个 phase 的 evidence manifest 完整 | partial：D4.1 达到 80/80、真实 CLI/浏览器/NOWRITE/evidence manifest；V1 全阶段未完成 |
| NFR-05 性能 | Timeline virtualization + async jobs | `AT-PERF-01` 120 镜头 reference fixture | 选择反馈 p95 ≤100ms；无 >100ms UI 长任务；机器与 trace 已记录 | not-started |
| NFR-06 可访问 | focus management、键盘映射、reduced motion、文本状态 | `AT-A11Y-01` axe + keyboard + 200% text + 人工审查 | 无阻塞级问题；全部核心路径可用键盘完成 | partial：D4.1 axe-core 4.10.3、键盘提交/切换、四视口、200% 重排与人工对比度通过；V1 其余路径待验 |

## 4. 阶段证据清单

### Gate DOC（当前）

- `01_PRD.md`、`03_Architecture.md`、`04_Development_Plan.md`、`05_Acceptance_Plan.md` 与本矩阵概念一致。
- `Narralens-V1-Development-GAP.drawio` 7 页全部可渲染，并准确标明未开发状态。
- `architecture/v1-target-system.architecture.html` showcase 9/9、浏览器四视口通过。
- 内部审计无未关闭的致命/重大规格或架构矛盾。
- 外部审计结论、问题关闭状态与复审结果落到 `14_V1_External_Document_Audit.md`；外审通过不替代实际开发批准。

### Gate D1

- `docs/implementation/D1-environment-audit.md`。
- 固定的两个上游 commit SHA、许可证原文路径、依赖锁与实际 CLI 帮助。
- 30 秒真实项目：第一次 MP4、重开后修改一镜的第二次 MP4、ffprobe、帧样本、工程哈希、命令日志。
- Hypit Source/Run/时间模型/扩展点和 OpenMontage pipeline/产物 schema 的事实记录。
- 结果：2026-10-12 通过；证据索引为 `docs/evidence/D1/evidence-manifest.json`。无字幕夹具、有限 Studio UI 手势覆盖和未配置 Provider 均作为限制保留。

### Gate D2

- `docs/evidence/D2/artifacts/real-runner-e2e.json`：真实 Claude Code CLI、模型/费用/耗时、job events、严格 ProposalBundle 与 NOWRITE。
- `docs/evidence/D2/artifacts/browser-e2e.json` 与 `ui-real-runner-success.png`：Headless Chrome 真实点击成功态及无横向溢出。
- `corepack pnpm check`：24 tests + TypeScript + production build；Runner 故障、字符串 result、超大 body、UI 529 与排队/取消路径包含在内。
- 结果：两轮独立外审闭环，第二轮 `IMPLEMENTATION_EXTERNAL_REVIEW=PASS`；Gate D2 通过，只允许进入 D3 计划审计。

### Gate V1

- 真实 10–15 分钟母项目与 3–5 分钟精修切片。
- 20+ 镜头；至少 3 个位置具有 ProposalBundle、采用事务、revision、真实预览和导出证据。
- 409/422/423/428/503、写入失败、崩溃恢复、重开、锁定复用、性能、可访问性证据。
- 媒体重关联缺失引用为 0，并记录总耗时、重试次数、失败率及 D6 前冻结的性能预算。
- 交付包：MP4、字幕、来源/许可、标题、封面、版本与生成记录。

## 5. 变更控制

1. 任何实现提交必须至少关闭一个表内测试编号，不得以“搭架子”声称完成 P0。
2. D1 事实导致契约改变时，同时更新本矩阵、架构文档、Draw.io 与相关 schema。
3. 任何需求没有证据路径时视为文档缺陷；任何证据没有对应需求时视为范围漂移。
4. 阻塞项未关闭时，对应状态只能是 `blocked`，不能写 `ready` 或 `done`。

