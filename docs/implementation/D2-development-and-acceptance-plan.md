# D2 统一宿主与真实提案链——开发及验收计划

版本：v1.0（2026-10-12）  
状态：Gate D2 已通过；D2.1–D2.7 实现、内部验收、真实 Runner/SSE 浏览器 E2E 与两轮外审闭环

## 1. 单一阶段目标

在一个 Narralens 页面中读取 D1 工程的真实项目/选区/预览信息，用户从 `DirectorPane` 提交导演意图，由 loopback Host 创建异步 job，并经受控 Agent Runner 生成符合项目 schema 的真实 `ProposalBundle`。D2 只展示提案，不写 Hypit Source；写入事务属于 D3。

## 2. 代码实体

| 层 | 目标实体 | D2 职责 |
|---|---|---|
| UI | `app/director/NarralensApp.tsx` | 项目头部、真实预览入口、选区摘要、DirectorPane、job 状态、Proposal 卡片 |
| UI API | `app/director/api/HostApiClient.ts` | typed fetch/SSE；不读取 vendor 内部模块 |
| Host | `host/server.ts` | 只监听 `127.0.0.1`；Origin + session token；JSON 上限；统一错误格式 |
| Project | `host/projects/ProjectCatalog.ts` | 读取显式登记的工程 descriptor；不接受任意路径 |
| Jobs | `host/jobs/JobStore.ts` | 单进程内 job/event；单调 event ID；真实阶段，不显示假百分比 |
| Runner | `adapters/openmontage/ControlledAgentRunner.ts` | `spawn` 固定 executable/args、无 shell、stdin JSON、超时/取消、stdout 上限 |
| Adapter | `adapters/openmontage/ProposalAdapter.ts` | 上游 packet/Agent 输出 → `ProposalBundle`；schema + 语义校验；写 `proposals/` |
| Hypit | `adapters/hypit/HypitReadAdapter.ts` | 只读 check/session/preview descriptor；D2 禁止修改 Source/Result |
| Contracts | `contracts/*.schema.json` + TS types | HTTP body/result/job/error 与 `ProposalBundle` 单一命名基线 |

D2.1 必须补齐并测试的 schema 清单：`session-response`、`project-response`、`proposal-request`、`job-response`、`job-event`、`cancel-response`、`api-error`，加既有 `proposal-bundle` 共 8 个。`source_packet` 明确保持 optional：D2 允许 Agent 直接依据已固定的 pipeline/schema 上下文生成镜头提案；若上游确有项目级 packet，则必须带 kind/id/hash。此可选性不得被解释为允许手工 JSON。

架构图：`docs/architecture/d2-proposal-chain.architecture.html`。Archify showcase 验证 9/9、0 error/0 warning；四种桌面视口无溢出。该图中的 `需 Provider Gate` 是真实阻断，不是装饰状态。

## 3. API 冻结

- `GET /api/session`：返回短期 session token；只允许 same-origin loopback 获取。
- `GET /api/projects/:id`：返回 project ID、revision、Run/Studio preview descriptor 和当前 selection；不暴露绝对路径。
- `POST /api/projects/:id/proposals`：`{base_revision, selection, intent, preserve}` → `202 {job_id}`。
- `GET /api/jobs/:id`：job 快照。
- `GET /api/jobs/:id/events?after=<event_id>`：SSE；重连按 ID 去重。
- `GET /api/proposals/:id`：只读返回已校验 ProposalBundle。
- `POST /api/jobs/:id/cancel`：best effort；状态区分 `cancel_requested/cancelled/completed_after_cancel`。

统一错误：400 `INVALID_REQUEST`、401 `INVALID_SESSION`、403 `ORIGIN_REJECTED`、404、409 `REVISION_CONFLICT`、422 `INVALID_PROPOSAL`/`PROVIDER_REJECTED`、529 `PROVIDER_OVERLOADED`、503 `RUNNER_UNAVAILABLE`、504 `RUNNER_TIMEOUT`。

## 4. Runner 协议与人工 Gate

Runner 配置必须是 executable 与 args 数组，禁止 shell 字符串。stdin 是受限 JSON，只含：项目摘要、当前 revision、选区帧范围、用户意图、preserve 声明、固定 OpenMontage pipeline/schema 摘要；不得发送媒体、凭据、任意本地文件或未批准资料。stdout 必须是单个 JSON，超过 1 MiB、夹杂非 JSON、schema/语义不符或 base revision 不符即失败。

首次真实调用 Gate 已由项目负责人于 2026-10-12 明确批准，冻结如下：

1. Provider/CLI：本机 Claude Code CLI，可复用本机已有登录态；模型遵循 CLI/服务端有效配置并记录实际返回元数据。
2. 不设置本地硬性费用上限或最大调用次数；服务端约束为权威边界。
3. 外传字段仅限上述结构化文本，无媒体、凭据、绝对路径或任意本地文件。
4. 422 映射为 `PROVIDER_REJECTED`，529 映射为 `PROVIDER_OVERLOADED`；D2 单个 job 不自动重试，由用户显式重试，防止重复费用与无界重试。

若 CLI/登录态不可用则返回 `503 RUNNER_UNAVAILABLE`；真实调用、真实 job event 和合法 ProposalBundle 仍是 D2 出门硬门槛。

## 5. 开发顺序

1. D2.1 monorepo/TypeScript 测试与 lint 基线；contracts schema/type 单源生成或一致性测试。
2. D2.2 loopback Host、安全中间件、ProjectCatalog、JobStore/SSE。
3. D2.3 Hypit 只读 adapter，对接 D1 fixture 的真实 Run/preview descriptor。
4. D2.4 NarralensApp/DirectorPane，保持批准原型的信息层级、键盘焦点与状态文案。
5. D2.5 ControlledAgentRunner 与 ProposalAdapter；先用协议测试 double 验证失败分支，明确标注不计入真实 Gate。
6. D2.6 经人工 Gate 后执行一次真实 Runner E2E，保存脱敏 stdin 字段清单、CLI/version、job events、原始 stdout 哈希、ProposalBundle 与费用/调用次数。
7. D2.7 PRD 检视、浏览器 E2E、凭据扫描、evidence manifest、内部/外部审计。

## 6. 测试门限

| ID | 操作 | 通过门限 |
|---|---|---|
| D2-CONTRACT-01 | 合法/非法 request、job、ProposalBundle | schema 与 TS 语义一致；非法帧范围/片段覆盖/base revision 被拒绝 |
| D2-SEC-01 | 非 loopback、错误 Origin/token、路径穿越、超大 body | 分别拒绝；响应/日志不含 token/绝对路径 |
| D2-JOB-01 | 创建、事件重连、取消、晚到完成 | event ID 单调且去重；状态不伪造取消结果 |
| D2-HYPIT-READ-01 | 读取 D1 真实工程 | 返回 900 帧、30 fps、3 个稳定 shot window；Source 哈希不变 |
| D2-UI-01 | 页面选区→输入意图→提交→状态→提案 | 键盘可完成；loading/error/empty/success/cancel 状态均可见且不只靠颜色 |
| D2-RUNNER-01 | 协议故障注入 | ENOENT/超时/非 JSON/过大/错误 schema 映射到稳定错误，Host 不崩溃 |
| D2-RUNNER-REAL-01 | 页面发起一次批准的真实 Runner | 非手工 JSON；真实 job 事件和结构化 ProposalBundle；绑定当前 base revision/selection |
| D2-NOWRITE-01 | 比较前后工程 | Hypit Author/Run/Result 哈希不变；OpenMontage/Runner 只写 proposal staging |
| D2-E2E-01 | Headless 浏览器完整路径 | 页面可见真实项目和提案；网络请求、SSE、截图与 artifact 可审计 |

## 7. 停止与出门

出现 Provider 未批准、费用/外传范围不明、Runner 需 shell、Source 被写、手工 JSON 冒充真实输出、凭据进入前端/日志，立即停止且不得声明 D2 完成。

D2 出门必须全部测试通过，其中 `D2-RUNNER-REAL-01` 不可由 test double 替代。通过只允许进入 D3 计划与审计，不表示编辑写入、锁或 revision 已实现。

## 8. PRD 追踪

| D2 子阶段 | 关闭的规格切片 | 明确不关闭 |
|---|---|---|
| D2.1–D2.2 | NFR-01/03/04 的本地 Host、错误、可观察契约基础 | 恢复 journal、生产持久化 |
| D2.3 | P0-03 的真实预览读取前置 | 播放器完整编辑、D3 写入 |
| D2.4 | P0-02/04 的项目/选区摘要与 P0-06 的单提案入口 | 100+ 镜头、多提案比较 |
| D2.5–D2.6 | P0-06 的第一条真实 ProposalBundle 链 | D4 的 3–6 提案与素材 materialize |

`D2-NOWRITE-01` 以 D1 evidence manifest 中 Author/Run/音频及 build 哈希为前置基线；D2 结束时重新核对 Source/Run，Result 只读且不得被 Runner 写入。
