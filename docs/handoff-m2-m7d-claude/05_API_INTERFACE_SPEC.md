# API 与接口定义规范

## 1. 性质和版本

本文件是 M2–M7 的目标规范，不代表当前路由已存在。当前真实路由以 `docs/migration/M1/route-inventory.md` 和 `src/host/server.ts` 为准。现有语义优先兼容；新迁移接口使用 `/api/migration/v1`，是否沿用旧 `/api/projects/:id/edits` 由 M2.1 compatibility table 冻结。

每个接口定义必须有：schema version、request/response JSON Schema、TypeScript 类型、错误表、幂等规则、授权规则、状态副作用、contract tests 和至少一个负向用例。Schema 是运行时边界；TypeScript 类型不能代替运行时校验。

## 2. 通用 HTTP 规范

- JSON 使用 UTF-8，`Content-Type: application/json`；媒体导入使用现有受限 multipart。
- 所有 `/api/*` 先校验 Origin/session，再做资源查找，避免泄漏项目存在性。
- 每次响应包含 `correlation_id`；Job/事务再含 `job_id/transaction_id`。
- 写请求带 `idempotency_key`、`base_revision`、必要时 `source_digest/control_revision/impact_id/impact_hash`。
- ID 是不透明稳定字符串；不使用数组下标作为对象身份。
- 时间范围统一 `[start_frame,end_frame_exclusive)`，整数；fps 为 `{num,den}`。
- 金额用整数 minor units + currency 或经过 schema 限定的十进制定点字符串；禁止 JS 浮点累计账本。
- 时间戳为 UTC RFC3339；显示层再本地化。
- 未开放能力返回 404 `CAPABILITY_NOT_ENABLED` 或保持既有 404，不创建假 Job。

## 3. 错误判定优先级

`auth/origin → schema/capability → idempotency replay/conflict → base/source → attention/locks/rights → impact/approval → execution`。

| HTTP | 目标 code | 适用条件 |
|---|---|---|
| 401 | `AUTH_REQUIRED`/兼容 `INVALID_SESSION` | session 无效 |
| 403 | `ORIGIN_DENIED`/兼容 `ORIGIN_REJECTED`、`DATA_POLICY_DENIED` | Origin 或外传政策拒绝 |
| 404 | `NOT_FOUND`、`CAPABILITY_NOT_ENABLED` | 资源不存在或门未开放 |
| 409 | `REVISION_CONFLICT`、`SOURCE_CHANGED`、`MANIFEST_CHANGED`、`IDEMPOTENCY_KEY_CONFLICT` | base/source/manifest/幂等冲突 |
| 422 | `UNSUPPORTED_EDIT`、`INVALID_RANGE`、`MISSING_ASSET`、`INVALID_MEDIA` | 能力、范围或媒体无效 |
| 423 | `TARGET_LOCKED`、`PROJECT_ATTENTION_REQUIRED` | 锁或恢复未决 |
| 428 | `IMPACT_REQUIRED`、`IMPACT_STALE`、`APPROVAL_REQUIRED` | 缺失/过期影响或授权 |
| 413 | `INVALID_REQUEST` | 有界 JSON/multipart 超限 |
| 503 | `ENGINE_UNAVAILABLE`/兼容 `HYPIT_UNAVAILABLE`、`RUNNER_UNAVAILABLE`、`MEDIA_TOOL_UNAVAILABLE` | 本地依赖不可用 |
| 504 | `RUNNER_TIMEOUT`/`PROVIDER_TIMEOUT` | 有界超时 |
| 529 | `PROVIDER_OVERLOADED` | provider 权威过载 |

旧 code 不随意改名。M2.1 建立 alias/版本表；生产 TypeScript union、JSON Schema、HTTP tests 同提交更新。

当前 `ApiErrorCode` 还包含 `NOT_FOUND`、`INVALID_PROPOSAL`、`INVALID_PROPOSAL_SET`、`PROVIDER_REJECTED`、`INTERNAL_ERROR`、`TRANSACTION_FAILED`、`AMBIGUOUS_TIME` 等既有值，必须继续兼容；上表是迁移新增/关键语义，不是允许删除现有 union 的白名单。资产库存的 `LICENSE_NOT_CLEARED`、`COMMERCIAL_USE_NOT_ALLOWED`、`BYTES_UNAVAILABLE`、`HASH_MISMATCH`、`MEDIA_INVALID` 是 blocking reason，不得误并入 HTTP error union。

## 4. 核心 TypeScript Port

```ts
interface EnginePort {
  inspect(snapshot: SnapshotRef, ctx: ReadContext): Promise<EngineProjection>;
  capabilities(snapshot: SnapshotRef, ctx: ReadContext): Promise<CapabilityMap>;
  plan(snapshot: SnapshotRef, intent: TypedEdit, ctx: CommandContext): Promise<EngineEditPlan>;
  stage(plan: EngineEditPlan, isolatedRoot: AbsoluteServerPath, ctx: CommandContext): Promise<StagedSource>;
  validate(staged: StagedSource, ctx: CommandContext): Promise<ValidationReport>;
  preview(snapshot: SnapshotRef, ctx: ReadContext): Promise<PreviewDescriptor>;
  render(snapshot: SnapshotRef, profile: RenderProfile, ctx: CommandContext): Promise<JobRef>;
}
```

约束：`AbsoluteServerPath` 只能由 Host 构造；请求 schema 不出现它。Port 无 `commit`，不接收任意 shell/native operation，不改 revision/locks/binding。

```ts
interface CommandContext {
  correlationId: string;
  projectId: string;
  idempotencyKey: string;
  baseRevision: number;
  expectedSourceDigest: Sha256;
  controlRevision: number;
  signal: AbortSignal;
}
```

`TypedEdit` 使用 discriminated union；每种 operation 有独立 schema、capability、impact classifier、lock classifier 和 invariant validator。禁止 `type: string; payload: any`。

## 5. M2 API

### GET `/api/migration/v1/projects/:id/engine`

M2.1 结束前保持关闭；M2.1 通过后开放。返回 binding、capabilities、active snapshot、project/control revision 和 source digest。只读，无自动迁移。

### POST `/api/migration/v1/projects/:id/migrate-copy`

M2.3 前保持关闭。请求：source project/revision/digest、target engine、supported feature policy、idempotency。响应 202 Job。副作用只创建新 project/stage；永不覆盖旧项目。成功前不可激活；报告含 loss/unsupported。

### GET `/api/jobs/:id` 与 GET events

M2 将现有内存实现迁到持久 store，尽量保持现有响应字段兼容，新增 `attempt/lease/cost_status/artifacts/snapshot_id` 走向后兼容字段或版本。SSE 使用 `Last-Event-ID` 或显式 cursor；重复 cursor 不重复业务副作用。

当前 `JobState` 为 `queued/running/cancel_requested/cancelled/succeeded/failed/completed_after_cancel`。持久目标状态采用 `queued/running/cancel_requested/succeeded/failed/cancelled/attention`；迁移期必须显式映射旧 `completed_after_cancel` 为 `cancelled` 加 quarantined artifact/receipt，旧客户端读取兼容，但新写入不再把晚到结果呈现为可用成功。该映射须有数据库迁移和 contract test，不能直接删 union 造成旧记录不可读。

### POST `/api/jobs/:id/cancel`

返回取消请求状态，不承诺同步终止。终态后的重复取消幂等。晚到结果登记 quarantine，不改变 source/revision/materialization ready 状态。

## 6. M3 API

### POST `/api/migration/v1/projects/:id/proposals/:proposalId/materialize`

请求：base revision/source digest/control revision、segment bindings、profile、idempotency。Host 重读 proposal 和资产，不信任客户端 rights/hash。返回 202 Job。禁止写 source/revision。

### GET `/api/migration/v1/materializations/:id`

每次读取复核 referenced asset/rights/base 的当前性，返回 state、native plan summary、proxy tokens、lineage、blocking reasons。绝不返回真实 filesystem path。

## 7. M4 API

### POST `/api/migration/v1/projects/:id/impact`

请求只描述 typed intent/materialization ID 和 base；服务器计算并持久化规范 impact。响应含 `impact_id/hash/expires_at/summary/approvals_required`，无工程副作用。

### POST `/api/migration/v1/projects/:id/edits`

请求：base revision/source digest/control revision、impact ID/hash、typed operation、idempotency、approval refs。采用 operation 只能引用 ready materialization。响应：transaction、previous/new revision、snapshot/source digest、status、outbox/event cursor。

成功改变内容时 `new=previous+1`；unchanged 时相等；失败不增。同 key 同规范请求返回原响应；不同请求 409。

### POST `/api/migration/v1/projects/:id/history/restore`

请求：target snapshot、current base、current impact、idempotency。恢复内容但沿用当前控制策略；成功新 revision +1，不删除历史/费用。

## 8. M5–M7 API 清单与规则

以下均为目标语义，具体 route 在对应阶段的 compatibility table 中冻结，阶段前默认 404/disabled：

| Gate | 目标接口 | 请求核心 | 成功副作用 |
|---|---|---|---|
| M5A | `POST /projects` | CreativeTask version、engine=openfilm、idempotency | 初始 binding/snapshot/revision |
| M5A | `GET /projects/:id/story-projection` | snapshot/revision | 只读章/句/镜/clip 映射 |
| M5A | `POST /projects/:id/checkpoints` | selection/label/base | 保存用户检查点，不改影片内容 |
| M6.2 | `POST /projects/:id/title-candidates` | fact-summary revision、audience、approval | 持久 Job/候选，不改影片 |
| M6.2 | `POST /projects/:id/cover-candidates` | fact-summary、style、asset refs、approval | 持久 Job/候选资产登记 |
| M6.2 | `POST /projects/:id/preflights` | snapshot/profile/rule versions | 固定 revision 的 QC Job/report |
| M6 | `POST /projects/:id/renders` | snapshot/profile/idempotency | 固定 snapshot 的 render Job |
| M7A | `POST /style-profiles`、`POST .../apply` | versioned policy、impact/approval | apply 成功为受控新 revision |
| M7B | `POST /voice-jobs`、`POST /alignment-jobs` | text/audio version、provider approval | staging voice/alignment，不自动采用 |
| M7C | `POST /provider-jobs` | capability、data manifest、budget approval | staging asset/receipt/cost |
| M7C | `POST /projects/:id/feedback` | revision/shot/range/text | feedback record，不写 source |
| M7D | `GET /projects/:id/delivery-manifest` | committed revision | 只读交付资产与证据清单 |

- CreativeTask/StoryProjection 是独立资源版本，不允许一次 PUT 覆盖任意未知字段。
- Selection 是 UI 状态，只有保存为 checkpoint/feedback 时持久化。
- 标题/封面/provider/voice 请求均创建持久 Job，并携带外传/费用 approval；不在同步 HTTP 内长时间运行。
- Preflight 绑定 snapshot/revision/profile；问题含稳定 anchor 和 rule version。
- Feedback 绑定 revision/shot/range；重剪后显式 `migrated/orphaned`。
- 导出创建时固定 snapshot，不提供“latest”动态读取语义。

## 9. canonical JSON 与摘要

对象键按 ASCII 键名排序；数组保留语义顺序，只有 source files 在进入 canonical 前按 UTF-8 相对路径字节排序；路径使用 `/`，不改变大小写/Unicode；整数和 FPS rational，禁止 NaN/Infinity/浮点时间；UTF-8 无 BOM/空白。

- source：`SHA256("narralens-source-v1\n" + canonical(manifest without digest/snapshot/access time))`
- impact：`SHA256("narralens-impact-v1\n" + canonical(impact without impact_hash))`
- idempotency request：按 operation 版本使用域前缀，排除 correlation/time 等非语义字段。

每种算法必须有跨语言黄金向量：键序变化 hash 相同；语义数组顺序、文件 bytes、scope 或 rights 变化 hash 不同。

## 10. 接口变更控制

破坏性变更要求 ADR、schema major/versioned route、兼容期和迁移测试。新增 optional 字段必须有旧客户端测试；不能把缺失字段默认成可信事实。每个 route 状态在 traceability 标 `not_registered/disabled/implemented/internal_evidenced/passed`。

