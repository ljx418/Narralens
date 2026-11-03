# M5 内部审查（四视角）

状态：`INTERNAL_REVIEWED`。本文件是**实现会话自审**，不是独立外审，也不替代人工体验门。

基线：`migration/m2.2-coordinator-persistence`，M5A 冻结候选 `205faad`（详见 `docs/evidence/WAVE3/M5/`）。
声明上限：`M5_HEADLESS_EVIDENCED`。人工体验门（UX-12）保持 `HUMAN_NOT_RUN`。

本轮审查在实现会话内完成，四个视角各自独立走查，然后合并。**BLOCKER 与 MAJOR 全部关闭后才允许形成候选**；
未关闭的条目一律记为 MINOR 并写明它的边界，不得用"后续阶段会处理"代替处置。

---

## 视角一：架构 / 单一权威

**结论：无第二时间线、无第二权威、无第二幂等表。**

| # | 发现 | 处置 |
|---|---|---|
| A-1 | workbench 可能被实现成 legacy catalog 的另一个入口 | 已关闭：`WorkbenchService` 只走 `resolveActivated → layoutFor → inspect`，并有负向测试证明 legacy 项目 404、target 与 source 不同、`target_clips`/`identity_map` 都不被读取 |
| A-2 | replay 可能成为第二个 provider 入口 | 已关闭：`ComparisonReplayService` 不引用 Runner/provider；测试断言 provider 调用数与 job/outbox 行数不变 |
| A-3 | lock 可能引入第二把锁或第二计数器 | 已关闭：锁行写在既有 `project_lock` 表，计数器是既有 `project_state.control_revision`，outbox 是既有 `outbox` 表 |
| A-4 | 幂等可能分裂成 M5 自己的表 | 已关闭：锁与 replay 都用既有 `operation_idempotency` 权威（`OperationIdempotencyStore`） |
| A-5 | 前端可能自己持有一份可恢复影片的 clip 列表 | 已关闭：`WorkbenchStore` 只持有 UI 草稿、焦点、展开状态与错误；clip 列表只来自 Host 的 workbench 投影 |
| A-6 | `clipIdFor` 被复制成字符串规则 | 已关闭：`clipIdFor` 从 migrator 导出为纯函数，migration 与 replay 共用 |
| A-7 | Gateway 可能成为第二个 Host | 已关闭：Gateway 只暴露闭合的 `StudioOperation` 集合与 registry entry id；业务服务在 NarralensHost composition 内被调用 |

**MINOR（本视角）**

- M-A1：`StoryAtlas` 在 M5 里以面板内的镜头卡片呈现，没有独立的章节事实源（`WorkbenchProjectionV1` 的冻结合同里没有章节字段）。影响：章节导航是结构视图而非语义检索。边界：不影响单一 timeline 权威；语义检索的完整形态留在 M7 的 provider 链。
- M-A2：Gateway 的读 allowlist 是逐路登记的（9 条），不是从上游 inventory 自动生成。影响：上游新增读端点时不会自动开放。边界：默认拒绝，符合"不得列举或打开任意文件夹"。

---

## 视角二：实现 / 并发 / CAS / 生命周期

**结论：锁的 CAS 是严格的，写路径的失败不留下半状态。**

| # | 发现 | 处置 |
|---|---|---|
| I-1 | 锁的 CAS 可能被"只 +1"的旧方法稀释 | 已关闭：新增 `createLockWithControlRevisionCas` / `deactivateLockWithControlRevisionCas`，比较、锁行、+1、outbox 在同一 `BEGIN IMMEDIATE` 内；测试断言 CAS 失败时 lock/outbox/计数器零变化 |
| I-2 | CAS 失败可能创建 project_state 孤儿行 | 已关闭：CAS 用 `#requireProjectRow` 要求项目已存在，不再用会创建行的 `ensureProject` |
| I-3 | owner 可能是每次启动变化的 token | 已关闭：`host_identity` 表在安装期创建并持久化；测试断言重启后 actor 不变，且 API 只公开固定 label |
| I-4 | 幂等重放可能产生第二次写入 | 已关闭：同 key 同体重放同一响应（逐字节相同），异体 409；测试断言重放后 lock 数、计数器与 outbox 行数不变 |
| I-5 | replay 可能与并发写入竞争 | 已关闭：replay 走既有 `ProjectOperationQueue`，并在同一个 idempotency 权威下判重 |
| I-6 | Studio/Gateway/Chrome 可能在失败后残留 | 已关闭：Headless harness 在 `finally` 里关闭自己启动的浏览器、Gateway、Host 与 profile；`OpenFilmStudioSupervisor.close()` 关闭 Studio |
| I-7 | 面板的原生选区可能被 Studio 的旧报告覆盖 | 已关闭：面板在发出 `select-clip` 后等待编辑器确认（最多 3 次、每次 600ms），确认前的报告被忽略 |
| I-8 | CDP 调用可能无限挂起 | 已关闭：每个 CDP 调用有 30s 超时，超时让 case 失败而不是让捕获挂死 |

**MINOR（本视角）**

- M-I1：面板的选区确认窗口是 3 秒的启发式，不是协议保证。影响：极端情况下一次点击可能被 Studio 的默认选区覆盖。边界：面板会重试 3 次；证据里 UX-03/UX-05 断言面板与原生选区一致。
- M-I2：`StudioHost` 的秒→帧转换只在 bridge 边界做，Studio 内部仍以秒表达。影响：亚帧精度由上游决定。边界：冻结 fps 为 30/1，边界帧用 `floor` 且有测试。

---

## 视角三：完整体验 / 可访问性 / 错误状态

**结论：每个受控状态与每个错误码都有渲染与下一步；没有假修复按钮。**

| # | 发现 | 处置 |
|---|---|---|
| E-1 | 失败可能丢掉草稿 | 已关闭：`WorkbenchStore` 的错误只改 `error` 与 `phase`，不动 intent、选区与已载入的比较 |
| E-2 | 粘滞 500 可能被"重试"绕过 | 已关闭：只有用户显式点"新建一次请求"才换 idempotency key（`stickyKey`），普通重试沿用同一 key |
| E-3 | permanent attention 可能给出假修复按钮 | 已关闭：`PROJECT_ATTENTION_REQUIRED` 的下一步是"需要工程处理"，面板不提供修复入口 |
| E-4 | undo/redo 可能被显示成"已撤回" | 已关闭：按钮文案是"准备撤回/准备重做"，产生的是 typed intent；恢复仍要影响与确认 |
| E-5 | 键盘可能不可达 | 已关闭：`/` 聚焦搜索框，方向键逐帧/一秒，Escape 关闭最上层弹层并恢复焦点；面板的键处理在 capture 阶段注册（Studio 自己会 stopPropagation） |
| E-6 | axe 可能只测半张页面 | 已关闭：axe 跑在 M5 面板上（`[data-narralens-panel='ready']`），整页结果另存为 `whole_page` 供人工查看 |
| E-7 | 200% 可能被 CSS/viewport 冒充 | 已关闭：原生 200% 复用 `tests/evidence/create-d421-headless-zoom-profile.mjs` 的隔离 profile 偏好，读回 DPR 与布局视口，断言无页面级横向溢出 |

**MINOR（本视角）**

- M-E1：面板的浅色/系统主题只落在文档的 `data-theme` 上，Studio 自己的主题变量不跟随。影响：面板与 Studio 的明暗可能不一致。边界：不改变可读性与对比度的断言范围。
- M-E2：UX-12（人类一分钟定位、十秒找到撤回、理解 impact 与错误）保持 `HUMAN_NOT_RUN`；自动化不得代签。

---

## 视角四：安全 / 证据 / 路径与凭据泄漏

**结论：浏览器不持有 Host bearer，上游 key 与工程绝对路径不到达浏览器。**

| # | 发现 | 处置 |
|---|---|---|
| S-1 | Gateway 可能把上游 launch key 暴露给浏览器 | 已关闭：key 只在 Gateway 进程内，用于上游 `x-studio-key`；上游 origin 被重写到 Gateway origin |
| S-2 | 工程绝对路径可能经 API/DOM 泄漏 | 已关闭：workbench 投影不含路径；Gateway 的 JSON 回答把绝对路径清空、把 film origin 重写到自己的 `/film/` 前缀；有负向测试 |
| S-3 | DNS rebinding | 已关闭：`Host` 头必须等于 Gateway 自己的 host，否则 421 且不描述自己 |
| S-4 | 跨源页面可能读取 Gateway 的回答 | 已关闭：不发任何 CORS 头；写请求要求 Origin 等于 Gateway 自己的 origin，否则 403 |
| S-5 | Host 的 Origin allowlist 可能被扩到 Gateway origin | 已关闭：没有扩；从 Gateway origin 直调 Host 为 403 且 lock/revision/outbox 零变化（有测试） |
| S-6 | 上游原生写入口可能泄漏到浏览器 | 已关闭：上游 `/edit`、`files.bring/relink/delete`、`history.commit/discard/checkout/merge` 等一律 422；开放集恰为 capability map 的四条 supported entry |
| S-7 | 未支持的原生写可能只禁 UI 不禁服务端 | 已关闭：Gateway 与 Host 两侧都按 registry 拒绝，服务端 422（有测试逐条验证 16 个入口） |
| S-8 | 凭据可能进入证据 | 已关闭：仓内 secret scan 参与捕获；捕获目录里有 `credential-scan.json` |
| S-9 | 上游 checkout 可能被改动 | 已关闭：probe 记录 HEAD、clean、逐文件 SHA256 与整个加载闭包；`openfilm-upstream-lock.json` 已扩展 Studio 的闭包与 build 输入摘要 |

**MINOR（本视角）**

- M-S1：Gateway 的会话是内存态，Host 重启后旧的 cookie 失效。影响：浏览器需要刷新一次。边界：页面会重新拿到会话；不涉及跨进程信任。
- M-S2：Studio 的 `openProject` 会在迁移副本里写自己的 `.film/` 工具目录。影响：目标目录多一个上游自己的元数据目录。边界：它不在任何声明的 source root 内，不改变 source digest，Host 的摘要与锁检查都看不到它。

---

## 汇总

| 视角 | BLOCKER | MAJOR | MINOR |
|---|---|---|---|
| 架构 / 单一权威 | 0 | 0 | 2 |
| 实现 / 并发 / CAS | 0 | 0 | 2 |
| 完整体验 / 可访问性 | 0 | 0 | 2 |
| 安全 / 证据 | 0 | 0 | 2 |
| **合计** | **0** | **0** | **8** |

BLOCKER=0、MAJOR=0。八个 MINOR 都是有边界的已知限制，写在这里而不是藏起来。

---

## 接管修复补充审查（2026-11-03）

候选：`e3a1457c018316b8499d513cf7fbb004234c00f2`。本节仍是实现会话自审，不冒充独立外审；
完整 M5 捕获尚须绑定此候选重新执行，捕获完成前不得声明 `M5_HEADLESS_EVIDENCED`。

前一候选的全量门真实执行到 `91/92` files、`1085/1086` tests 时，冻结锁测试抓到新增的可选
verification verdict 参数与旧安全断言不一致。复核没有把它当作单纯测试漂移：结构类型允许内部调用者
伪造 `available: true` verdict，会削弱「只有真实固定上游字节才能被加载」的合同。

| 视角 | 发现 | 闭环与直接证据 |
|---|---|---|
| 架构 / 单权威 | Host 启动的首次 clean-tree 检查可瞬时失败，随后迁移却能成功，造成项目已绑定 OpenFilm 而 registry 未安装 | composition 只对精确的 inconclusive clean-check 做有界重试；缺失、SHA、dirty、digest 漂移仍立即失败；专项 9 tests 及真实 composition 通过 |
| 实现 / 并发 | 同一 migration 的重试会从头执行，已到 `staged` 时触发非法状态迁移；并发首次请求可重复 plan | `MigrationService.execute()` 按持久状态边界恢复并 single-flight；Host plan+execute 进入 source project queue；migration/locks/harness 专项 37 tests 通过 |
| 安全 | 可复用 verdict 的公开字段可被结构性伪造 | verdict 由模块私有 `WeakSet` 运行时铸造并单次消费；canonical root、固定 SHA、`git_clean` 仍逐项校验；新增伪造 verdict 503 负向用例，M2.1 141 tests 通过 |
| 证据 | 候选 `a65d259...` 的全量门有一条真实失败 | 失败捕获逐字保留并明确无 overall/manifest/integrity；没有摘绿、覆盖或宣称环境失败 |

补充审查结论：上述修复未引入第二 timeline、第二 migration 状态机或浏览器可控 vendor path；重试范围
精确且有界，脏 checkout 永不重试；验证凭据不可伪造且不可重放。当前补充审查
`BLOCKER=0 / MAJOR=0`，但最终状态仍取决于新冻结提交的完整 M5 捕获。

**未做的事（不得被读成已完成）**

- 独立外审（Codex）与人工体验门均未进行；本文件不代替它们。
- Gate D4.2、V1-P0、V1-Full、M6 均未声明完成。
- 没有 headed 自动化，没有打开窗口，没有抢焦点，没有联网，没有调用 provider，没有产生费用。
