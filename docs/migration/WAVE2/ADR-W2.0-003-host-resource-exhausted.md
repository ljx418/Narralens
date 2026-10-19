# ADR-W2.0-003：`HOST_RESOURCE_EXHAUSTED`

状态：`RATIFIED_BY_INTERNAL_REVIEW`
日期：2026-10-20
适用范围：`ApiErrorCode`、`contracts/api-error.schema.json`、`src/host/engine/error-alias.ts`
实现提交：随 W2.0 修复一并提交

本文件是**追加**裁决，不修改任何已冻结文件。`docs/03_Architecture.md` 的错误码表保持原样，
本 ADR 说明为何该表需要一条新的含义，而不是让一个既有 code 承担两种语义。

## 1. 触发事实

M3 收口过程中，`normalizeError` 把一组 Node 瞬时错误码
（`ENOMEM`、`EMFILE`、`EBUSY`、`EIO` 等）映射为
`503 MEDIA_TOOL_UNAVAILABLE`，理由是它们都表示"这台机器现在做不了这件事，请重试"。

架构视角的复审指出这违反了 `docs/03_Architecture.md` 的错误码表：该表把
`MEDIA_TOOL_UNAVAILABLE` 定义为 **ffprobe/ffmpeg 缺失、启动失败或 Host 级超时**。
把"宿主内存不足"塞进这个 code，等于让同一个 code 在同一个版本里表达两种相反的含义 ——
而 `06_ARCHITECTURE_CONTRACT_LOCK.md` §4 明确禁止
"同一 code 在不同版本表达相反语义"，一个版本内同时表达两种含义同样不可取。

## 2. 决定

新增 `HOST_RESOURCE_EXHAUSTED`（503），语义为：

> Host 因宿主级资源瞬时不可用而无法完成请求（内存、文件描述符、繁忙的文件系统）。
> 调用方可以原样重试；这不是"事实被推翻"，也不是"工具坏了"。

与既有 code 的区别（已写入 alias 表，可被 fitness 断言）：

| code | 含义 |
|---|---|
| `MEDIA_TOOL_UNAVAILABLE` | ffprobe/ffmpeg 缺失、启动失败或超时 —— 工具本身坏了 |
| `HOST_RESOURCE_EXHAUSTED` | 工具正常、Host 正常，但这台机器此刻资源不足 |
| `PROJECT_ATTENTION_REQUIRED` (423) | 事实已被证明为错或无法验证，需要人处理 |

`details.recoverable: true` 随 `HOST_RESOURCE_EXHAUSTED` 一起返回，M3 的
`MigratedAssetLedger`、`MaterializeService` 与测试客户端都信任这一个字段，
不再各自维护一份错误码清单。

## 3. 为什么不是"更新文档表"

把 `MEDIA_TOOL_UNAVAILABLE` 的含义扩写成"任何暂时做不了的请求"会污染一个已经被
D4.2.1 冻结并在证据中引用的 code：它的历史用例（ffprobe 缺失）语义会被稀释，
而 AC-019 要求历史行为与证据不被追溯改写。

按 W2.0 已有的先例（`IMPACT_REQUIRED` / `IMPACT_STALE`），新增一个 code 并在同一提交里
同步 TypeScript union、JSON Schema enum 与机器可读 alias 表，是这条路径上唯一不牺牲
既有语义的做法。

## 4. 与重试语义的关系

`HOST_RESOURCE_EXHAUSTED` 使"未能验证"与"已证明为错"在整条链路上只有一个含义：

- 账本遇到瞬时读失败 → 抛出该 code，账本**不动**；
- `MaterializeService` 见到 `details.recoverable === true` → 保持行原样，
  `finally` 释放 lease 使 job 回到 `queued`，下一轮重试；
- 真实的 drift（读到了、且不一致）→ `stale` / `attention`，且 `attention` 依
  ADR-W2.0-001 仍是终态。

若不区分这两者，一次内存抖动就会把项目永久锁死 —— 这正是本波最初捕获到的失败链：

```
materialize.stale  reason=PROJECT_ATTENTION_REQUIRED:SOURCE_TREE_UNREADABLE:ENOMEM
```

## 5. 受影响项

- AC-019：无历史 route 或 code 的行为被改写，只是新增。
- 错误码数量：29（M2.1）→ 31（W2.0 前两次）→ 32（本次）。
- `tests/architecture/m2.1-fitness.test.ts` 的双向相等断言与"新码列表"断言同步更新，
  等价性检查本身未放宽。

## 6. 验证

`corepack pnpm evidence:wave1:historical` 仍 exit 0；`test:contracts` 与架构 fitness 全绿。
`HOST_RESOURCE_EXHAUSTED` 与 `MEDIA_TOOL_UNAVAILABLE` 的区别由 alias 表的
`distinguishes_from` 机器可读，并由 fitness 断言其非空且长度大于 20。
