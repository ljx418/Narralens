# M0 HTTP 路由清单

观察提交：`304c89134fdf9f834f7d69e3f4d5c89a68044c60`。所有 `/api/*` 路由先执行同源检查；除 session 外均要求 Bearer session。

| Method | 路由 | 状态 | 写入所有者/副作用 |
|---|---|---|---|
| GET | `/api/session` | 已实现 | 只返回短期 session |
| GET | `/api/projects/:id` | 已实现 | 只读项目、revision、Hypit 投影和 eligible assets |
| GET | `/api/projects/:id/assets` | 已实现 | 每次重验完整公开库存；不写 Source/revision |
| POST | `/api/projects/:id/assets/import` | 已实现、D4.2.1 候选 | `AssetImportService` 写 media/manifest/import journal；不写影片 revision |
| POST | `/api/projects/:id/proposals` | 已实现、D4.1 | 创建内存 Job，调用受控 Claude Runner；不写影片 Source |
| POST | `/api/projects/:id/edits` | 已实现、D3/D4.0 | `ProjectWriteActor` 唯一 typed edit 入口 |
| GET | `/api/jobs/:id` | 已实现 | 读取当前内存 Job |
| GET | `/api/jobs/:id/events` | 已实现 | 内存 SSE replay/live |
| POST | `/api/jobs/:id/cancel` | 已实现 | best-effort 取消当前 Runner |
| GET | `/api/proposals/:id` | 已实现 | 只读单提案 |
| GET | `/api/proposal-comparisons/:id` | 已实现 | 只读 D4.1 比较并复核 current revision |
| POST | `/api/proposals/:id/materialize` | 未注册，预期 404 | M1A 必须直接证明无 Job/Source/revision 副作用 |
| POST | 任意 proposal adopt 路由 | 未注册，预期 404 | M1A 必须直接证明 |
| POST | `/api/projects/:id/edits` + `adopt_materialized_proposal` | operation 未注册，预期 422 | M1A 必须证明无工程变化 |
| ALL | `/api/migration/v1/*` | M2.1 起仅一条只读路由开放 | 仅目标草案；M2 以后按 ticket 逐条开放 |

## M2.1 追加（基线提交 `16add72` 之后的增量，不改写上方 M0 观察）

| Method | 路由 | 状态 | 写入所有者/副作用 |
|---|---|---|---|
| GET | `/api/migration/v1/projects/:id/engine` | **M2.1 已实现，只读** | 返回该项目唯一 engine binding、capability map 与只读 `EngineProjection`；不写 source/revision/lock，无自动迁移 |
| POST | `/api/migration/v1/projects/:id/materializations/...` | 仍未注册，404 | M3 才开放 |
| POST | `/api/migration/v1/projects/:id/impact` | 仍未注册，404 | M4A 才开放 |
| POST | `/api/migration/v1/projects/:id/edits` | 仍未注册，404 | M4A 才开放 |
| POST | `/api/migration/v1/projects/:id/history/restore` | 仍未注册，404 | M4B 才开放 |
| POST | `/api/migration/v1/projects/:id/migrate-copy` | 仍未注册，404 | M2.3 才开放 |

非 HTTP 写入口治理：`NativeMutationRegistry` 已登记 M1B 清单 10 行 + audio 维度，
每条为 `translated`/`translated_host_service`/`blocked`/`read_only`，未登记操作默认拒绝并记录安全事件。
证据：`docs/evidence/M2/M2.1/evidence-manifest.json`（EN-02）。

非 HTTP 写入口：当前 Hypit Studio server 的 native mutation、Hypit CLI/文件系统、history/undo/redo 等由 M1B 盘点；M0 不把包内推测当实证。

## M4B 追加（当前实现，不改写上方历史观察）

| Method | 路由 | 当前状态 | 写入所有者/副作用 |
|---|---|---|---|
| POST | `/api/migration/v1/projects/:id/edits` | **M4B 已实现；只接受 `narralens.adopt-request@1.0`** | `AdoptionCoordinator` → `NativeWriteGateway` → pinned `OpenFilmEngineAdapter` → Host-only `AuthorSourcePublisher` → `RevisionStore.commitAdoption`；revision 恰好 +1，impact/idempotency/projection/ledger/outbox 同事务 |
| POST | `/api/migration/v1/projects/:id/history/restore` | 仍未注册，404 | M4C 才允许开放；M4B 不提供 restore/undo/redo |

M4B 不改变 legacy `/api/projects/:id/edits` 的既有 typed-edit 所有权，也不开放任意 native op。当前唯一新增写入口由项目队列串行化，发布前重查 source/control/rights/impact/锁；恢复先于通用 journal recovery。

## M4C 追加（当前实现，不改写上方历史观察）

| Method | 路由 | 当前状态 | 写入所有者/副作用 |
|---|---|---|---|
| GET | `/api/migration/v1/projects/:id/history` | **M4C 已实现；只读** | `HistoryStore` 读模型：该项目已 committed 的 snapshot 引用，按 revision 排序；不写 source/revision/lock/pointer，不返回路径 |
| POST | `/api/migration/v1/projects/:id/history/restore` | **M4C 已实现；只接受 `narralens.restore-request@1.0`** | `HistoryService` → `NativeWriteGateway`（`history.restore`）→ pinned `OpenFilmEngineAdapter` stage/validate → Host-only `AuthorSourcePublisher` → `RevisionStore.commitHistoryRestore`；revision 恰好 +1，result snapshot id 复用目标的内容地址，impact/idempotency/projection/outbox 同事务 |
| POST | `/api/migration/v1/projects/:id/history/undo` | **M4C 已实现；只返回 typed intent** | `HistoryCommandTranslator` 解析当前 commit 的前一个 committed snapshot，返回 `narralens.history-intent@1.0`；**不写任何东西**，仍需新 impact 与显式 approval 才能落地 |
| POST | `/api/migration/v1/projects/:id/history/redo` | **M4C 已实现；只返回 typed intent** | 同上，但仅当**当前 commit 本身是 committed history restore** 时才从其不可变 restore fact 解析 source-before snapshot；否则 422 fail closed |

M4C 不改变 M4B 的 `/edits` 所有权，也不开放 `checkout/merge/discard/commit` 等裸 history 操作——它们在
`NativeMutationRegistry` 中仍为 `blocked`。恢复发布到 active root 的变化被 ADR-W2.0-006 D-05 限死为两类：
原子替换 `film.html`，以及安装目标引用而 active root 缺失的内容寻址资产；旧的未被引用的资产不删除。
M4C 不开放生产 render route，headed/human 体验为 `NOT_RUN`。

## M5 追加（当前实现，不改写上方历史观察）

| Method | 路由 | 当前状态 | 写入所有者/副作用 |
|---|---|---|---|
| GET | `/api/migration/v1/projects/:id/workbench` | **M5A 已实现；只读** | `WorkbenchService`：`ProjectResolver.resolveActivated(target)` → `ActivatedProjectionService.layoutFor(view)` → `EnginePort.inspect()`；只用 durable facts 证明 target 与 source 的映射；不读 report 的 `target_clips`、不读 plan 的空 `identity_map`；`preview` 由 serializer 整体替换为 Gateway descriptor；不写 source/revision/lock/outbox/ledger，不返回路径 |
| POST | `/api/migration/v1/projects/:id/locks` | **M5A 已实现** | `LockMutationService` → `RevisionStore.createLockWithControlRevisionCas`：`base_control_revision` 严格 CAS，比较、lock 行、`control_revision +1` 与 `lock.changed` outbox 在同一 `BEGIN IMMEDIATE`；CAS 失败零 lock/outbox 变化；owner 是安装期持久化的 `host_identity` actor，API 只公开固定 label；同 key 同体重放同响应、异体 409 |
| DELETE | `/api/migration/v1/projects/:id/locks/:lock_id` | **M5A 已实现** | 同上的 CAS 变体：`RevisionStore.deactivateLockWithControlRevisionCas`；跨项目 lock id 一律 404；重复释放 409 |
| POST | `/api/migration/v1/projects/:id/comparisons/replay` | **M5A 已实现** | `ComparisonReplayService`：把既有 D4.1 已录制 comparison 复制成 target-owned 的不可变 comparison + 不可变 lineage；映射用 migrator 导出的 `clipIdFor` 纯函数与当前 target projection 互证；不调用 Runner/provider，不改 source/revision/active snapshot/ledger；base revision 与 migration plan 的 source revision 不符时 409 |

M5 另外开放一个**不在本表**的 origin：OpenFilm Studio Gateway。它固定绑定 `127.0.0.1` 的随机端口，
是浏览器唯一可见且顶层打开的 Studio origin，不占用 `/api/migration/v1` 路由。它的读 allowlist 逐路登记，
写 deny-by-default，开放集恰为 OpenFilm capability map 报告 supported 的四条 entry
（`timeline.adopt_materialization`、`history.restore`、`history.undo`、`history.redo`）；
上游自己的 `/edit`、`files.bring/relink/delete`、`history.commit/discard/checkout/merge` 一律 422，
raw upstream origin/key/工程绝对路径不进入 API、DOM、日志或截图。Host 的 Origin allowlist 不加入
Gateway origin，从 Gateway origin 直调 Host 为 401/403 且零副作用。M5 不开放生产 render route，
不建立第二 timeline，headed/human 体验为 `NOT_RUN`。
