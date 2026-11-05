# Narralens V1 规格—架构—开发—验收追踪矩阵

版本：v1.0  
状态：实际开发已批准；Wave 2 组合外审结论保留。旧 M5 自动证据已降级并保留为失败历史；返修后的
返修后正式捕获 `4b2e168c3d3024e5e96832e00bcbd2d8610dd3fe` 为 16 个自动 case PASS、0 FAIL、UX-12 NOT_RUN，
三路独立复审均 PASS，当前为 `M5_HEADLESS_EVIDENCED`；UX-12 仍为 `HUMAN_NOT_RUN`；
Gate D4.2、`Gate V1-P0`、`V1-Full`、M6 与 M7 均未关闭。
事实日期：2026-11-05
<!-- M2.1_REWORK_BASE_SHA=ee58ab5c6a9d4bbdf05e8ac8a394fd75218cae59 REVIEW_STATUS=PASS -->

## 1. 使用规则

每个需求必须同时具备责任实体、开发阶段、测试编号和出门证据。`planned` 不能被解释为 `implemented`；D1 只实现真实底座夹具、探针和契约，业务实体仍未开发。

## 2. P0 追踪

| PRD | 责任实体 | 阶段 | 验收测试 | 必需证据 | 当前状态 |
|---|---|---|---|---|---|
| P0-01 项目创建/任务包 | `IdeaWorkspace`、`CreativeTaskSchema`、`ProjectActor` | D2 | `AT-IDEA-01` 导入合法/非法包并重开 | 工程目录、校验日志、重开截图 | partial：M5 Idea 草稿可编辑、不会冒充工程，并可打开/迁移既有事实项目；从空白想法创建生产项目仍属 M6/M7 |
| P0-02 章节/脚本/镜头 | `ChapterNavigator`、`SelectionCoordinator` | D2–D3 | `AT-NAV-01` 三种入口定位同一对象 | stable ID/时间范围对照 | partial：D2/D3 三个稳定 shot 与单镜选区可用；章节与三入口仍待后续阶段 |
| P0-03 真实播放器/时间码 | `RealPreviewSurface`、`HypitAdapter` | D1–D2（时间模型 M2.1） | `AT-PREVIEW-01` 帧时间往返 | 真实 Run、时间码/抽样帧 | partial：M5 已用原生 OpenFilm player/timeline/inspector 证明同一 selection/clock/snapshot，并通过帧↔秒冻结时间模型；完整“空白想法→成片”播放器体验仍待 M6/M7 |
| P0-04 全片/局部时间轴 | `TimelineSurface` | D2–D3 | `AT-TIMELINE-01` 缩放不改变选区 | 120 镜头 trace、选区日志 | partial：M5 原生 timeline 与 120 clip 结构压力、四类操作各 100 样本已通过；生产长片与完整编辑操作仍待 M6/M7 |
| P0-05 镜头/区间/逐帧 | `SelectionCoordinator` | D3（区间语义 M2.1） | `AT-SELECTION-01` `[start,end)` 边界 | 首尾帧样本、契约测试 | partial：M5 已证明镜头卡/时间码/原生 timeline 定位同一 target clip、半开范围与 source lineage，并通过键盘逐帧；完整生产长片仍待 M6/M7 |
| P0-06 3–6 提案 | `DirectorPane`、`ProposalCompare`、`ProposalComparisonAdapter` | D2–D4 | `D41-CONTRACT/COUNT/DIVERSITY/DURATION/REF/TRUST/STAGING/REV/NOWRITE/CANCEL/PROVIDER/RUNNER/UI/A11Y/SEC/REGRESSION` 全族 | Runner 审计、ProposalComparison、结构签名、工程 SHA、Host 写调用计数、浏览器证据 | done：D4.1 生产实现、80/80、真实 CLI 三案、浏览器/NOWRITE 与内外实现审查通过；不包含 P0-07 采用 |
| P0-07 分项锁 | `ProjectWriteActor`、`LockPolicy` | D3–D4 | `AT-LOCK-01` UI/Agent 同时被阻止 | 423 响应、资产哈希不变 | partial：M4/M5 已以真实 LockService、control-revision CAS 与 Gateway 绕过测试证明受支持范围的 project/shot 锁；完整 V1 内容类型仍待 M6/M7 |
| P0-08 素材/来源/许可 | `AssetRegistry`、`AssetImportService`、`MaterializeService` | D4 | `D42-IMPORT/LICENSE/MAT/SEC` | import/ffprobe、manifest v2、lineage、422/428、许可清单 | partial：本地导入、账本、真实 proxy/native plan/lineage、impact/adopt 与 M5 同页能力展示均有证据；在线下载/provider 与完整交付素材链仍待 M6/M7 |
| P0-09 局部差异确认 | `ImpactPreview`、`EditTransaction` | D3–D4 | `AT-DIFF-01`、`D42-APPROVAL/ADOPT` | before/after diff、impact SHA、帧数/边界帧 | partial：M4/M5 已证明 server impact/hash、锁、许可、幂等、成功 revision +1/失败 +0 及同页确认；完整生产项目链仍待 M6 |
| P0-10 版本/撤回/恢复/冲突 | `RevisionService`、journal | D3–D5 | `AT-REV-01` 409、恢复产生新 revision | event log、重开记录 | partial：M4C/M5 已证明 history、undo/redo typed intent、受控 restore +1、重开与冲突；完整长片交付后的历史体验仍待 M6 人工验收 |
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

### 迁移 Gate 映射（CR-MIG-001）

| 新 Gate | 目标 | 当前状态 | 出门约束 |
|---|---|---|---|
| M0 | 现场 SHA、代码/路由/阈值、备份与变更单 | observed | 不改变业务 Gate |
| M1A | D4.2.1 冻结矩阵逐 case 真实证据与独立外审 | passed（实现 `c0f101b...`；R4 YES） | Headless PASS；headed/human NOT_RUN；不扩张为 D4.2 总 Gate |
| M1B | 固定 OpenFilm SHA、可编辑 30 秒链路、native 写入口清单与 stale-base 实证 | passed-spike（OpenFilm `e70d9d9...`） | 不写生产 Hypit；可编辑三 clip；生产 translate/block 已由 M2.1 落地为 `NativeMutationRegistry`/`NativeWriteGateway`，M2.1 未提供任何 OpenFilm 写路径 |
| M2 | EnginePort、单引擎绑定、写入治理、三类锁、持久 Job/SSE/lease、snapshot/journal、迁移副本与回退 | **Wave 1 组合外审 PASS，`CONTROLLED_OPENFILM_READY`**：冻结代码 `e2dec5c...`，证据捕获 `fd64762...`，21 case 为 20 PASS + 1 `NOT_APPLICABLE_APPROVED` | migrate-copy/report/rollback 已实现；AC-005 legacy edit 仍为事后 snapshot，headed/human NOT_RUN |
| W2.0–M3 | 目标工程解析、资产账本、素材化、真实 proxy/native plan/lineage | **M3 独立外审 PASS**：候选 `fa08fe4...`，捕获 `f2a41ff...`；ACT/ASSET、PR、MT 全部关闭 | materialize POST/GET 已开放；NOWRITE；impact/adopt/history 仍 404；M3 不等于 D4.2 完成 |
| M4A–M4C | server impact、采用与历史事务 | **M4A、M4B、M4C 独立外审及 Wave 2 组合外审均 PASS；`WAVE2_EDITABLE_ADOPTION_READY`**。唯一 adopt/restore 路由、原子 source 发布、revision/impact/projection/ledger/outbox/idempotency 同事务、崩溃恢复、真实 900 帧双渲染与中镜原生编辑均有直接测试 | 组合候选 `a038e4a...`；允许进入 M5，Gate D4.2 仍未关闭 |
| M5 | 同页原生 Studio UX | **`M5_HEADLESS_EVIDENCED`** | Gateway 返修代码 `63492d1...`、生命周期证据返修 `4b2e168...`；正式捕获 `4b2e168...` 为 16 PASS / 0 FAIL / 1 HUMAN_NOT_RUN，完整性门 exit 0；三路独立复审 0 BLOCKER/0 MAJOR，允许进入 UX-12，尚未人工签署 |
| M6 | `Gate V1-P0` | not-started | 不等于 V1-Full |
| M7A–D | P1 与完整长片证据 | not-started | P0/P1 全绿后才可声明 V1-Full |

### M5 / Wave 3 逐 case 追踪（实现后证据）

| Case | PRD / NFR | 实现实体 | 证据门 | 当前状态 |
|---|---|---|---|---|
| UX-01 | P0-01/P0-02 | M5 面板的 idea 阶段（StageRouter） | 草稿不冒充工程；真实 source→target 映射 | automated-pass |
| UX-02 | P0-02/NFR-04 | WorkbenchProjectionV1、ProjectResolver | 关闭重开重建 projection/revision/history | automated-pass |
| UX-03 | P0-03 | 面板镜头卡、SelectionCoordinator | 章/镜/时间码定位同一 target clip 与 source lineage | automated-pass |
| UX-04 | P0-03 | 面板镜头搜索 | 无数据 blocked；不伪造搜索命中 | automated-pass |
| UX-05 | P0-03/P0-08 | OpenFilmStudioGateway、StudioHost bridge | player/timeline/inspector 同一 selection/clock/snapshot | automated-pass |
| UX-06 | P0-03/NFR-02 | PlaybackClock、rational time model | 帧/秒互转与缩放不写 source | automated-pass |
| UX-07 | P0-04/P0-05 | ComparisonReplay、三路真实 proxy | 原始 audit/lineage + 三路真实 proxy media event | automated-pass |
| UX-08 | P0-08/NFR-05 | NativeWriteGateway、capability 展示 | unsupported UI disabled 且服务端绕过 422 | automated-pass |
| UX-09 | P0-06/P0-07 | materialize/impact/adoption orchestration | 成功 revision +1，失败 0，NOWRITE 不跳步 | automated-pass |
| UX-10 | P0-08/P0-09 | 受控采用、History drawer | undo/redo 只产意图；restore +1 | automated-pass |
| UX-11 | NFR-01/NFR-03/NFR-06 | 键盘/焦点/主题/zoom | Headless axe、reduced motion、native 200% 读回，并证明 preview 实例无重载风暴 | automated-pass；独立复审待完成 |
| UX-RESP | NFR-05/NFR-06 | M5 responsive panel | 1440/1024/768/360 实际 viewport 与窄屏边界 | automated-pass；独立复审待完成 |
| UX-12 | P0-03/P0-09 | 全页体验 | 项目负责人一分钟定位/比较、十秒找到恢复 | HUMAN_NOT_RUN |
| PF-01 | NFR-02 | 面板交互采样 | 真实 120 原生 clip/6 章，四类操作各 100 样本 p95≤100ms | automated-pass；独立复审待完成 |
| PF-02 | NFR-02/NFR-04 | 三路 proxy 与音频焦点 | 三路真实 proxy、唯一音频焦点、12 轮 heap 序列 | automated-pass；独立复审待完成 |
| PF-03 | NFR-04 | launcher/reopen harness | 冷/热重开、首帧、掉帧、媒体关联、内存 | automated-pass；独立复审待完成 |

证据：`docs/evidence/WAVE3/M5/captures/4b2e168c3d3024e5e96832e00bcbd2d8610dd3fe/`；逐 case 的断言、事实、
截图、性能样本与失败断言
都在里面。`automated-pass` 只表示**自动门**通过，人工体验门（UX-12）仍然是 `HUMAN_NOT_RUN`。

## 3. 非功能追踪

| PRD | 架构控制 | 测试 | 门限 | 当前状态 |
|---|---|---|---|---|
| NFR-01 本地优先 | loopback Host、受控 Runner、AssetRef 审批、`SourceDigestV1` | `AT-SEC-01` Origin/token、路径穿越、锁定版本 gitleaks 或等价扫描器 | 无凭据进入前端/JSON/日志；记录工具/版本/规则集/时间与 `docs/evidence/<phase>/security/credential-scan.json`；外传逐任务记录 | partial：D2 loopback/Origin/token/路径/外传清单通过；M2.1 已补 `AT-SEC-01` 的引用闭包与凭据扫描部分（固定规则集扫描器，0 命中，`docs/evidence/M2/M2.1/security/credential-scan.json`；上游固定 SHA 校验后才动态加载，绝对路径/穿越/symlink 逃逸/外部引用全部拒绝）；AssetRef 审批待 D4/M3 |
| NFR-02 可恢复 | ProjectWriteActor + journal + append-only event log | `AT-RECOVERY-01` 在 journal/迁移边界注入崩溃 | 重启恢复到最后提交 revision，主 Source 不损坏 | partial：D3 四状态恢复保持通过；M2.2 持久任务/lease/outbox 恢复已接线，M2.3 迁移 9 个崩溃边界可收敛；用户历史恢复仍待 D5 |
| NFR-03 可观察 | Job state + SSE + correlation ID | `AT-OBS-01` 断线重连/晚到/取消 | 无重复事件；费用与“已请求取消”如实显示；无假百分比 | partial：D2 既有链保持；M2.2 已实现持久 Job/event/SSE/outbox、owner+attempt lease、晚到隔离与 replay；render/snapshot_publish 业务 runner 尚未实现 |
| NFR-04 可测试 | schema/contract/fixture/ffprobe/frame sampling | `AT-CONTRACT-01`、`AT-E2E-01` | 每个 phase 的 evidence manifest 完整 | partial：D4.1 达到 80/80、真实 CLI/浏览器/NOWRITE/evidence manifest；V1 全阶段未完成 |
| NFR-05 性能 | Timeline virtualization + async jobs | `AT-PERF-01` 120 镜头 reference fixture | 选择反馈 p95 ≤100ms；无 >100ms UI 长任务；机器与 trace 已记录 | partial：M5 PF-01 已以 120 clip、四类操作各 100 样本通过 p95≤100ms；10–15 分钟生产长片性能仍待 M6/M7 |
| NFR-06 可访问 | focus management、键盘映射、reduced motion、文本状态 | `AT-A11Y-01` axe + keyboard + 200% text + 人工审查 | 无阻塞级问题；全部核心路径可用键盘完成 | partial：M5 UX-11/UX-200 已通过 Headless axe、键盘、焦点、reduced motion、主题与原生 200% 缩放；UX-12 人工判断未运行 |

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

### Gate M2.1（已通过第三轮独立复审）

- 历史外审：第一轮候选 `fc3efb4a53e19bca5ad939bd93e40b1af50a428d` 为 2 BLOCKER/5 MAJOR；第二轮候选 `971d02aac88b8f6f1513cbfa52b91923dd033d56` 的核心代码问题已大部关闭，但独立 Codex 又发现 R2-M-01/R2-M-02 两项 MAJOR。
- 返修实现基线：`ee58ab5c6a9d4bbdf05e8ac8a394fd75218cae59`；Git clean 无法证明时已 fail closed，并覆盖不可执行、非零退出、超时、dirty/clean 分支；其后第三轮独立复审已在冻结点 `ca7dbf3...` 通过。
- 证据索引：`docs/evidence/M2/M2.1/evidence-manifest.json`，20 个 case（含 `ER-*` 外审返修 case）逐条记录
  命令、exit code、stdout/stderr、环境、repo/upstream full SHA、fixture hash、断言与 artifact SHA256；
  不使用测试总数替代逐 case 状态。
- 全量回归：`corepack pnpm check` exit 0，26 files / 254 tests，`tsc --noEmit` 与生产 `vite build` 通过；
  134 条 D2–D4.2.1 旧回归保持通过。
- 真实上游：`e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3` 隔离 worktree 探针 12 项通过，含 tamper 负向探针
  （篡改隔离副本被 `ENGINE_UNAVAILABLE` 拒绝，原 checkout 仍可加载）；生产代码无 `vendor/` 静态 import。
- 外审返修：B-01/B-02/M-01..M-05 各自的修复提交、失败测试与复验证据见 manifest 的 `ER-*` case；
  外审的两个复现实验现为可执行脚本 `tools/m2.1-external-review-repro.mts`，断言的是修复后的行为。
- 第二轮证据封装提交：`4f2dfea`（证据捕获提交 `172321c831793e4674bbd157468068c16c13bfe7`，
  证据日志目录 `docs/evidence/M2/M2.1/logs/172321c/`，捕获时工作树干净）。
  完整性四项检查全通过：26 个被引用文件存在/被跟踪/未被 ignore/摘要一致；捕获环境独立记录干净；
  冻结提交之后无任何 `src/ tests/ contracts/ tools/ package.json` 变更。
- 证据按捕获提交分目录保存且永不覆盖，历史捕获保留在 `logs/d535591/`。
  历史候选 `fc3efb4a53e19bca5ad939bd93e40b1af50a428d` 与 `905c4335e3c7a7838d3a2d4132f732707f9a6a08`
  保留不改写。
- 变异测试：原 11 条 MUT-A..K 保留；新增 MUT-L，专门证明 Git clean 检查不可用时若退回 fail-open，门禁会失败。
- 证据完整性：`node tools/m2.1-evidence-integrity.mjs` 与 `tests/m2.1/evidence-integrity.test.ts` 断言每个
  被引用文件存在、被 git 跟踪、未被 git-ignore 且摘要仍一致，并断言冻结提交之后无任何
  `src/ tests/ contracts/ tools/ package.json` 变更。
- 限制：headed 与人类体验 `NOT_RUN`；`vendor/openfilm` 未登记为 submodule，真实接缝依赖隔离 worktree。
- 外审：第一轮 2 BLOCKER/5 MAJOR 与第二轮新增 2 MAJOR 均已返修；第三轮独立复审通过，冻结点
  `ca7dbf38ae9cd401b84f4bb7fe4e2ec3d0f0c523`，允许进入 M2.2，但不外推为完整 M2。

### Gate M2.2–M2.3 / Wave 1（已通过组合独立外审）

- M2.2 已把生产 `/edits`、启动恢复/outbox/reaper、owner+attempt CAS、完整引擎 digest 闭包、锁事务与
  control revision 复核接入真实 Host；M2.3 已实现确定迁移计划、隔离 stage、三原生 OpenFilm clip、
  snapshot/bind/report、9 个崩溃边界恢复、幂等、外改 attention 与可验证回退。
- Wave 1 冻结代码为 `e2dec5ca03ee881b55f92b920ee6df2c676aeb26`，证据捕获提交为
  `fd64762dbcff4e1577529a00991049b59bf2c1e7`，首次组合 manifest 封存为 `44b294d...`。
- 独立外审结论 PASS（BLOCKER=0、MAJOR=0、MINOR=2、NOTE=2）；两条 MINOR 已在冻结代码中关闭。
  证据见 `docs/evidence/WAVE1/`：38 files / 383 tests，完整性 6/6 PASS，21 case 为 20 PASS +
  1 `NOT_APPLICABLE_APPROVED`。
- 当前允许声明 `CONTROLLED_OPENFILM_READY`。已知边界：legacy Hypit edit 仍先就地提交再捕获 snapshot；
  duration/narration 锁集成层为 `NOT_APPLICABLE_APPROVED`；render/snapshot_publish 无业务 runner；
  headed/human `NOT_RUN`；只实测 900 帧短片。不得扩张为 Gate D4.2、V1-P0 或 V1-Full。

## 5. 变更控制

1. 任何实现提交必须至少关闭一个表内测试编号，不得以“搭架子”声称完成 P0。
2. D1 事实导致契约改变时，同时更新本矩阵、架构文档、Draw.io 与相关 schema。
3. 任何需求没有证据路径时视为文档缺陷；任何证据没有对应需求时视为范围漂移。
4. 阻塞项未关闭时，对应状态只能是 `blocked`，不能写 `ready` 或 `done`。

