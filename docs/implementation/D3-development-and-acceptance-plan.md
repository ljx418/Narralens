# D3 真实选区写入——开发及验收计划

版本：v1.1（2026-10-12）  
状态：内部审查与两轮 Claude Code CLI 外审闭环；允许进入 D3 实现

## 1. 单一阶段目标与边界

D3 只交付一个可证明、可恢复的局部写入原语：用户在真实 `d1-30s` 工程中选择一个稳定镜头，明确选择视觉适配值（`contain` 或 `cover`），Host 在验证 `base_revision` 与分项锁后，经 Hypit Studio 的真实 `parameter.adjust` mutation 修改该镜头的 `fit` 参数，刷新真实 Run/预览，并单调提交 Narralens revision。

本阶段不把 D2 的自然语言 Proposal 自动翻译成源码，也不宣称完成“采用缺素材提案”。D2 的真实 Proposal 为 `requires_materialization=true/renderable=false`；D4 才闭环 3–6 提案、素材审批/materialize 与采用。D3 证明的是 D4 必须依赖的安全写入事务。

## 2. 已验证事实基线

- 固定 Hypit commit：`85e01c76716498e6ec5b8bdfb6b374ca67f0195a`（OpenMontage 为 `9327439db69021ab4b0e2776729bf3b58fdb5a87`）。
- `GET /__studio/session` 的真实快照显示 30 fps、900 帧、视觉 authored IDs `shot-1/shot-2/shot-3` 和旁白 `narration`；快照与 `authors/main.svml` 均确认 `shot-2` 初始 `fit="cover"`，其窗口为 `[300,600)`。
- 三个视觉 item 均公开可写 inspector `fit`，允许值为 `contain/cover/fit-width/fit-height/native/scale-down/stretch`；本阶段只开放 `contain|cover`。
- Hypit 公开的完整 Studio mutation 词汇只有 `timeline.adjust` 和 `parameter.adjust`。D3 使用后者；禁止正则、字符串位置和数组下标修改 Source。
- `POST /__studio/mutation` 已具备 Studio revision 冲突检查、patch preimage、重新编译、结果校验和失败回写；冲突返回 409，编译/结果拒绝返回 422。
- Hypit Studio revision 是进程内写入 revision，Narralens project revision 是跨进程业务 revision；二者不得混作一个字段。

## 3. 冻结契约

### 3.1 工程映射

`narralens.project.json` 的每个 shot 增加 `authoring_id`，例如稳定业务 ID `shot-002` 映射到 Hypit authored ID `shot-2`；并登记唯一 `studio_origin`，D3 只接受带明确端口的 `http://127.0.0.1` origin，禁止 hostname/DNS、path/query/userinfo。它是 Host 唯一的 Hypit 请求目标与 Origin 白名单来源，不接受 API 请求覆盖或首次运行自动信任。UI/API 只暴露 `shot_id`；绝对 item ID、源码路径、`authoring_id` 和 inspector ID 留在 Hypit Adapter 内，通过当前 session 快照解析。映射缺失、重复、范围不一致、origin 缺失/变化均失败关闭。规划 schema 见 `docs/contracts/d3-project-descriptor.schema.json`。

### 3.2 EditRequest

```json
{
  "base_revision": 2,
  "idempotency_key": "d3-e2e-fit-shot-002",
  "selection": {
    "shot_id": "shot-002",
    "start_frame": 300,
    "end_frame_exclusive": 600
  },
  "preserve": ["narration", "duration"],
  "operations": [
    {"op": "set_visual_fit", "shot_id": "shot-002", "value": "contain"}
  ]
}
```

D3 限制：恰好一个 operation；operation shot 必须等于 selection shot；selection 必须逐字段等于已登记镜头；`preserve` 必须同时包含 `narration` 与 `duration`；value 必须同时满足 D3 schema 的 `contain|cover` 与当前 Studio inspector `options`，并匹配 `select` control/string 类型。额外字段、空范围、未知 shot、跨镜、时间轴操作、未 materialize proposal 和任意路径均返回 422，且 Source 不变。规划 schema 见 `docs/contracts/d3-edit-operation.schema.json` 与 `d3-edit-request.schema.json`。

### 3.3 EditResponse 与错误

成功返回 `200`：`transaction_id/project_id/previous_revision/new_revision/operation/status/changed/source_sha256/run_sha256`。相同 `idempotency_key` + 相同 canonical request hash 返回已提交结果，不重复 mutation；同 key 不同 canonical request hash 返回 409 `IDEMPOTENCY_KEY_CONFLICT`，不得混称 revision 冲突。规划 schema 见 `docs/contracts/d3-edit-response.schema.json`。

- 401 `INVALID_SESSION`：缺失、失效或不匹配的 session token。
- 403 `ORIGIN_REJECTED`：浏览器请求 Origin/Host 不在 Host loopback 同源规则内；不得与 Host→Studio 的登记 origin 混用。
- 409 `REVISION_CONFLICT`：Narralens base revision 过期，或 Studio snapshot 在事务内变更。
- 409 `IDEMPOTENCY_KEY_CONFLICT`：同一 key 被不同 canonical request hash 复用。
- 422 `UNSUPPORTED_EDIT`：契约有效但能力不支持、映射不唯一、Hypit 拒绝编译/校验。
- 423 `TARGET_LOCKED`：`visual` 锁定；UI 禁用不能替代 Host 强制拒绝。
- 423 `PROJECT_ATTENTION_REQUIRED`：journal 已进入 attention，项目所有写接口保持阻断。
- 503 `HYPIT_UNAVAILABLE`：Studio/session 不可达，或 descriptor 未登记有效 Studio origin；未发生 mutation 时不创建 attention。
- 500 `TRANSACTION_FAILED`：本地 journal/metadata 提交失败且已完成或需要启动恢复；不得返回成功。

所有错误沿用 `correlation_id`，不得返回绝对路径、token 或源码正文。

Hypit 端普通参数错误当前可能返回 500，而不仅是 422。Host 必须在 mutation 前完成 schema/control/options 检查；若仍收到 Hypit 5xx，禁止按错误消息关键字降级为 422：mutation 前可证明未写入则映射 `TRANSACTION_FAILED`，mutation 结果不确定或 mutation 后发生 5xx 则写 journal `attention` 并返回 `PROJECT_ATTENTION_REQUIRED`。只有 Hypit 明确 422 才映射 `UNSUPPORTED_EDIT`。

## 4. 代码实体与职责

| 层 | 实体 | D3 职责 |
|---|---|---|
| Contracts | `edit-request/response.schema.json`、TS types/validator | 结构和上述语义门限 |
| UI | `FitControl` / `ImpactPreview` | 显示目标镜头、before→after、保留旁白/时长、锁状态；明确点击后才提交 |
| API | `POST /api/projects/:id/edits` | 鉴权、body 上限、契约解析、分发 actor；不直接写 Source |
| Actor | `ProjectWriteActor` | 每工程 FIFO 单写者；revision、lock、idempotency；事务期间拒绝并发写 |
| Policy | `LockPolicy` | D3 只实现服务端 `visual` 主动锁；narration/duration 是请求必填 preserve 断言与后置 hash 不变量 |
| Adapter | `HypitWriteAdapter` | 拉 session、解析 authored ID/item/fit parameter、提交 `parameter.adjust`、复读验证 |
| Transaction | `EditTransaction` | before hashes/值、journal 状态、mutation、校验、metadata commit、补偿/恢复 |
| Persistence | `RevisionStore` / `TransactionJournal` | SQLite 事务保存 revision、locks、idempotency 与 append-only journal；不保存第二条时间轴 |

架构图：`docs/architecture/d3-write-transaction.architecture.html`。D3 不设 Host 侧 Source staging，也不在 mutation 前另跑 CLI check/plan；这些旧图元素已移除。原子 Source patch、preimage、重新编译与失败回写由 Hypit Studio mutation 提供，Host 负责 journal 和后置不变量；真实 `check/plan` 是出门验收步骤。v1.1 图已重新通过 Archify showcase `validate/deliver`（9/9、0 error、0 warning；spec SHA `d68a5707...b3335833`，HTML SHA `a7de8bd2...ae6b2cf`）；其 Chrome DevTools pipe 在当前 WSL→Windows Chrome 环境不可用，不能声称 canonical visual-check 通过，需另做人工/截图感知检查并保留限制。

## 5. 事务与恢复算法

单工程 actor 内严格执行：

1. 规范化请求并计算 request hash；查询 idempotency。
2. SQLite `BEGIN IMMEDIATE` 校验当前 Narralens revision、visual lock，创建 `prepared` journal，记录 request hash、目标业务 identity、before fit、Source/Run/旁白资产哈希；提交数据库事务。
3. 拉取 Studio session，验证 authored ID 唯一、帧范围整数且 `0 <= start < end <= frameCount`、selection 与 item 范围一致、fit inspector 可写、control 为 `select`、目标是 string 且属于 inspector options；记录 `studio_revision_before` 与内部 opaque IDs。
4. 发送同源 loopback `parameter.adjust`。只允许 descriptor 登记且完成格式校验的 loopback `studio_origin`；请求 URL 固定为 `${studio_origin}/__studio/mutation`，Host 设置完全相同的 `Origin`，禁止重定向、禁止客户端提供 URL、禁止 hostname 解析到非 loopback。
5. 复读 session，断言目标 fit 等于 requested value、frame count/目标窗口不变、非目标 shot 的 authored ID/帧范围/fit 逐字段不变、旁白 item/资产哈希不变、Run 哈希不变。更新 journal 为 `source_validated`。
6. SQLite 原子提交：Narralens revision `r→r+1`、idempotency result、append-only revision/event、journal `metadata_committed`。仅此后响应成功。

若请求是 no-op（before 等于 after），仍经映射/锁/revision 校验，但不调用 mutation、不增加 revision，返回 `changed=false` 并保存幂等结果。理由：revision 表示工程内容修订，不为无内容变化制造版本；审计锚点由 idempotency key、canonical request hash、transaction ID 与 `changed=false` 事件保留。revision 只在真实 mutation 后单调增加，补偿也必须记录而不能倒退数字。

失败处理：

- Hypit 在返回非 2xx 前自行恢复 Source；Adapter 仍复读并比对 before hash。
- mutation 已成功而后置验证失败时，使用最新 Studio revision 发送同一 parameter 的 before value 作为补偿。补偿不是新的用户 edit，不复用客户端 idempotency key；它使用同一 `transaction_id`/`correlation_id`，journal 追加唯一 `compensation_attempt` 序号和 request hash。只有补偿返回 2xx 且 Source hash、fit 与所有不变量回到 before 才标记 `compensated`；非 2xx、响应丢失、部分恢复或复读失败一律 `attention`。
- Host 在 mutation 后崩溃时，启动恢复扫描非终态 journal：复读 authored identity/fit/hash；若已达到 target 且所有不变量成立，则完成一次 metadata commit；若仍是完整 before 状态则标记 `aborted`；若为第三种状态则尝试上述补偿，仍不能确定则标记 `attention`。恢复先对已有 idempotency 结果做 request hash、content state 与 current revision 三方一致性合并；一致则关闭重复 journal，不一致进入 attention，禁止依赖数据库主键冲突。恢复期间 Studio/session 不可达、返回 5xx、descriptor origin 不匹配、journal 行损坏/校验失败或补偿失败，也都进入/保持 `attention`，阻断该项目后续写入，绝不猜测成功。
- mutation 请求若抛出网络/解析异常，立即复读：只有 Source、fit、Run、旁白和 semantic 全部仍为 before 才标记 aborted 并返回原失败；只要已变化或无法复读，就标记 attention。任一项目存在非终态 journal 时，后续写入视同 attention，不能创建第二条并发 journal。
- SQLite/磁盘失败不能通过 UI 成功；`attention` 只能由可审计恢复步骤关闭。

## 6. 开发顺序

1. D3.1 契约、descriptor authoring identity、SQLite migration 与 store 单测。
2. D3.2 HypitWriteAdapter snapshot 映射与 mutation client；先用 HTTP protocol double 覆盖错误，再接真实 Studio。
3. D3.3 ProjectWriteActor、LockPolicy、EditTransaction、幂等和恢复注入点。
4. D3.4 Host endpoint 与 UI `FitControl/ImpactPreview`；UI 不直接接触 Hypit IDs。
5. D3.5 真实工程 E2E：以已冻结 baseline `shot-002 fit=cover` 执行 `cover→contain`，验证预览/Source 持久、重启 Studio 后仍为 contain，再以第二个正常事务 `contain→cover` 恢复 baseline；记录两次 Narralens revision 增量（各 +1）、每次 Studio session revision 与完整 hash 链。
6. D3.6 失败注入、PRD 检视、安全扫描、evidence manifest、内部实现审计和 Claude 外审。

## 7. 测试与验收门限

| ID | 操作 | 硬门限 |
|---|---|---|
| D3-CONTRACT-01 | 合法/额外字段/跨镜/多操作/未知值 | 非法请求 422；0 次 Studio 调用 |
| D3-MAP-01 | stable shot→authored item→fit parameter | 唯一映射且范围一致；绝对 ID 不出 API |
| D3-REV-01 | 旧 base revision、Studio stale revision | 409；Source/metadata revision 不变 |
| D3-LOCK-01 | UI 与直接 API 在 visual lock 下写入 | UI 禁用且 API 423；旁白/Source hash 不变 |
| D3-IDEMPOTENCY-01 | 同 key 同/异请求 | 同 hash 不重复写；异 hash 返回 409 `IDEMPOTENCY_KEY_CONFLICT` |
| D3-TXN-01 | `shot-002 cover→contain` | 新 revision 恰增 1；真实 session/source 为 contain；Run 可 check/plan；预览刷新 |
| D3-INVARIANT-01 | 写入前后逐字段比较 | 900 帧、三个窗口、非目标 fit、旁白 item 与音频 SHA、Run SHA 均不变 |
| D3-ROLLBACK-01 | Hypit 422、后置验证失败、metadata 失败 | 主 Source 回到 before hash；无假 revision；journal 可解释 |
| D3-RECOVERY-01 | prepared / mutation 后 / metadata commit 后崩溃；Studio 不可达/journal 损坏/补偿失败 | 重启后确定性 abort/finalize/已提交；不确定状态 attention 且所有写接口 423 |
| D3-UI-01 | 用户选镜→看影响→切 fit→确认→成功/冲突 | 键盘可操作、明确 before/after、无假百分比、错误可恢复 |
| D3-REAL-E2E-01 | 真实 Studio、关闭重开、回写恢复 | 非 mock；修改持久；最终夹具恢复 baseline；证据含 hashes/session/check/plan/截图 |
| D3-SEC-01 | Origin/token、路径、日志、build/descriptor 扫描 | evidence 登记实际 Studio origin；未登记 origin/路径拒绝；扫描 descriptor 在内且 0 个凭据/绝对路径泄漏 |

真实 E2E 的 Source 变化必须只落在目标 `visual:Clip` 的 `fit` 属性；测试结束后通过第二个正常事务恢复到 `cover`，不能用 git checkout 或手工覆写冒充回滚。两个事务都保留证据，最终 revision 继续单调增加。

## 8. 出门与停止条件

以下全部满足才可标记 Gate D3 通过：所有测试全绿；真实 Studio 写入、重开、check/plan 与预览证据齐全；失败注入证明无主 Source 损坏；内部审计和 Claude 外审无未关闭致命/重大问题；evidence manifest 明确限制。

出现 authored identity 不唯一、Studio mutation 无法稳定调用、补偿/恢复存在猜测、锁只在 UI、旁白或非目标区变化、绝对路径泄漏、用 mock/手工改文件替代真实 E2E，立即停止并报告，不进入 D4。

## 9. PRD 覆盖声明

D3 部分关闭 P0-05（单镜选择）、P0-07（仅 visual 服务端主动锁）、P0-09（局部差异确认）、P0-10/NFR-02（revision/journal 基础）和 NFR-04。narration/duration 在 D3 只是 `preserve` 必填断言和 post-write hash 校验，不是可由用户主动设置的 LockPolicy；其主动锁、撤回/恢复历史 UI、跨镜编辑、多提案采用、素材审批、完整播放器/时间轴或 MP4 交付仍由 D4–D7 关闭。
