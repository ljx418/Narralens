# M5 交付报告（M5A → M5B → M5C）

声明上限：**`M5_HEADLESS_REVIEW_REPAIR_PENDING`**。旧自动证据经 UX-12 前置阶段审计被语义降级；
返修代码冻结 `63492d1...`、正式捕获 `ff807c3...` 已完成 16 PASS / 0 FAIL / UX-12 NOT_RUN，三路独立
复审中架构与 PRD 两路 PASS，测试证据路要求补充 preview Document/WebSocket 生命周期直接证据。
人工体验门（UX-12）保持 `HUMAN_NOT_RUN`。本报告不构成 Gate D4.2、Gate V1-P0、V1-Full 或 M6 结论。

---

## 1. 基线与提交序列

| 项 | 值 |
|---|---|
| 仓库 | `/mnt/c/workspace/videoworkline/Narralens` |
| 分支 | `migration/m2.2-coordinator-persistence` |
| 起点（交接基线） | `68a558a326fbbfbf78509ca548b1b075150fd5a4` |
| M5A 冻结候选 | `205faad`（workbench / locks / replay / Studio Gateway） |
| M5B+M5C 原候选 | `a9718ae`（同页闭环、Headless harness、证据工具） |
| preview/Gateway 返修代码冻结 | `63492d1e02548cfec9cb3b83fc020b0a22bcc10e` |
| 当前捕获 commit | `ff807c332eab04f0a28c03f78734da7b73bc802d`（将由生命周期断言返修后的新捕获取代） |
| 固定 OpenFilm 上游 | `e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3` |

`origin/main` 未被改动；没有 push、没有 force push、没有 reset、没有删除任何 Wave 1/Wave 2 证据。

## 2. 逐模块交付

### M5A：生产接缝（`205faad`）

- **合同**：`WorkbenchProjectionV1`、`PublicLockV1`、`LockMutationResponseV1`、
  `ComparisonReplayRequestV1/ResponseV1`，各带 runtime JSON Schema（`additionalProperties: false`）、
  注册与合同测试。schema 说不出的规则由 validator 兜住：source ≠ target、shot 锁必须点名一个 clip、
  project 锁不得点名、帧范围不得为空。
- **workbench 读模型**：`ProjectResolver.resolveActivated(target)` →
  `ActivatedProjectionService.layoutFor(view)` → `EnginePort.inspect()`。
  不用 legacy catalog 解析 target，不读 report 的 `target_clips`，不读 plan 的空 `identity_map`；
  `preview` 由 serializer 整体替换为 Gateway descriptor。
- **锁 API**：`base_control_revision` 严格 CAS；比较、锁行、`control_revision +1` 与
  `lock.changed` outbox 在同一 `BEGIN IMMEDIATE`；CAS 失败零 lock/outbox 变化；
  owner 是安装期持久化的 `host_identity` actor，API 只公开固定 label；跨项目 lock id 404；
  同 key 同体重放同响应、异体 409。
- **comparison replay**：把既有 D4.1 已录制 comparison 复制成 target-owned 的不可变 comparison +
  lineage；映射用 migrator 导出的 `clipIdFor` 纯函数与当前 target projection 互证；
  不调用 provider，不改 source/revision/snapshot/ledger。
- **Studio Supervisor**：先探测固定 checkout —— HEAD、clean、逐文件 SHA256、整个加载闭包（63 个文件）、
  `startStudio` 的真实选项、`StudioHost` v1 的 `onSelection/onCommand` —— 探测结果落
  `docs/evidence/WAVE3/M5/upstream/studio-seam-probe.json`，并扩展 `contracts/openfilm-upstream-lock.json`。
- **Studio Gateway**：127.0.0.1 随机端口、Host 头校验（DNS rebinding）、随机 HttpOnly SameSite cookie、
  `no-referrer`、`default-src 'self'` CSP、无 CORS；读 allowlist 逐路登记，写 deny-by-default，
  开放集恰为 capability map 的四条 supported entry；上游 `/edit` 等原生写入口一律 422；
  Host 的 Origin allowlist 不含 Gateway origin（直调 403 且零副作用）。

### M5B：同页闭环（`a9718ae`）

面板即 StageRouter：`#/idea`（草稿与打开）、`#/refine/:target`（工作台）、
`#/delivery-preview/:target`（明确说明 M6 未开放）。三个 store 与 `SelectionCoordinator`：
面板不持有任何可独立恢复影片的 clip 列表。原生 StudioHost bridge 双向同步选区，
编辑器确认前不采信它更早的报告。DirectorPane 覆盖：已录制提案（标注「已录制提案（原始生成审计）」）、
素材化状态、服务端 impact、显式确认、受控采用、锁控件、历史抽屉；撤回/重做只产 intent，
恢复仍要 impact 与确认。

### M5C：Headless、fixture、200%、报告（`a9718ae`）

仓内 launcher 自启本机 Chrome（`--headless=new --mute-audio`、随机调试端口、隔离 profile），
`finally` 关闭自己启动的浏览器/Host/Gateway/profile；不需要人工 CDP，不开窗口、不抢焦点。
CDP 客户端基于 Node 内置 WebSocket，不新增浏览器依赖，每个调用有界。
fixture：3 路真实 proxy、3 分钟 24 clip 系统片、120 clip / 6 章结构压力片，
由本地 ffmpeg 从仓库已验证媒体确定性合成，记录命令、SHA256、ffprobe 与完整解码。
原生 200% 复用 `tests/evidence/create-d421-headless-zoom-profile.mjs` 的隔离 profile 偏好并读回 DPR 与布局视口。

## 3. 逐 case 状态

见当前 `docs/evidence/WAVE3/M5/captures/ff807c332eab04f0a28c03f78734da7b73bc802d/summary.json` 与
`cases/*.json`。该捕获为 16 个自动 case PASS；UX-12 保持 `HUMAN_NOT_RUN`。preview 生命周期直接断言
返修后必须产生新 capture，旧 ff807c 继续保留但不作为最终放行依据。

## 4. 命令、退出码与测试数量

见 `docs/evidence/WAVE3/M5/captures/ff807c332eab04f0a28c03f78734da7b73bc802d/*.cmd|.txt|.exit`
（19 条命令原始 stdout/stderr 与退出码；最终以返修后的新 capture 为准）。

## 5. 内部审查

`docs/evidence/WAVE3/M5/reviews/internal-review.md`：四视角，**BLOCKER=0、MAJOR=0、MINOR=8**。
八个 MINOR 都是写明边界的已知限制，没有一个被"后续阶段会处理"代替处置。

## 6. 回退

关闭 M5 的 workbench/replay/locks 路由与 Studio Gateway，并恢复旧 `NarralensApp`，即可回到 M4C 的界面；
不重置数据库、不删除 Wave 2 的表、snapshot 或迁移副本。回退不需要回滚任何数据写入：
M5 的写路径全部走既有 Host 服务（adoption / history restore），它们留下的 revision 与 history
是普通提交，回退界面不会让它们消失。

## 7. 明确未声明的范围

- `M5_HUMAN_ACCEPTED`、Gate D4.2、Gate V1-P0、V1-Full、M6 完成：**都没有声明**。
- 没有做 headed 自动化，没有打开窗口，没有抢焦点，没有联网，没有调用 provider，没有产生费用。
- 没有读取 `J:\`，没有读取或使用仓库根未跟踪的 `narralens-d1`。
- fixture 只证明系统交互，不证明长片内容质量；120 clip / 6 章是结构压力用例。
- 架构/代码与 PRD/阶段两路独立复审 PASS；测试证据复审因 preview 生命周期证据不足为 NOT PASS，
  返修后必须重新复审。人工体验未进行，本报告不代替它。
