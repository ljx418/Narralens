# IT-A06 MEDIA → MAIN 接线请求

本文件是MEDIA泳道交给MAIN的具体接线请求。全部条目只涉及MAIN拥有的路径（`src/host/server.ts`、`src/host/projects/`、`src/contracts/`、`contracts/`、注册与DDL），MEDIA不自行修改。生产实现未在本文完成；本文件描述的是**接线**，不是验收。

合同：`ca5b67a8285b130c79055317c6202f73cfbb99c8`。上游固定：`e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3`。

---

## 1. MAIN必须实现的三个端口

定义在 `src/host/render/ports.ts`（MEDIA所有，MAIN只消费）。

### 1.1 `SnapshotReadPort`

```ts
export interface SnapshotReadPort {
  readSnapshot(request: {
    readonly project_id: string;
    readonly snapshot_id: string;
    readonly source_digest: string | undefined;
  }): Promise<SnapshotClosure>;
}
```

`SnapshotClosure` 给出：

| 字段 | 含义 | MAIN的责任 |
|---|---|---|
| `project_id` / `snapshot_id` / `source_digest` | 快照身份 | 必须是**已提交**的、属于本项目的快照；`source_digest` 与请求不符时拒绝 |
| `project_revision` | 快照提交时的revision | 不是项目当前revision（T20-G） |
| `native_root` / `native_entry` | 原生工程目录与入口文档（`film.html`）相对路径 | 指向**不可变字节**，不是用户当前工程目录 |
| `entries[]` | 闭包内每个文件的 `relative_path` / `absolute_path` / `sha256` / `bytes` / `kind` / `rights_ref` | `kind` ∈ `native_source` / `asset` / `supplement`；`asset`与`supplement`必须有`rights_ref` |
| `rights[]` | 每个素材的许可事实 | `status` ∈ `cleared` / `restricted` / `unknown`；`commercial_use` |

MEDIA侧会做三件事，MAIN不必重复：逐文件重新计算SHA-256并与快照记录比对；把闭包复制进本次attempt自己的staging后再渲染（**绝不渲染当前工程或客户端路径**）；渲染后再次校验复制件未被改动。MAIN仍必须保证闭包本身是已提交快照的闭包——这是MAIN的事，MEDIA无法从文件系统反推。

### 1.2 `AttemptFencePort`

```ts
export interface AttemptFencePort {
  claimAttempt(attempt: AttemptIdentity): Promise<boolean>;   // 已被别的attempt占用时返回false
  checkAttempt(attempt: AttemptIdentity): Promise<"proceed" | "cancelled" | "superseded">;
  releaseAttempt(attempt: AttemptIdentity): Promise<void>;
}
```

- `claimAttempt` 必须在同一`(project_id, job_id, attempt)`上唯一；返回false时MEDIA不启动任何渲染。
- `checkAttempt` 在**发布包之前**再问一次：取消或被取代的attempt不得发布（T20-D）。
- `releaseAttempt` 无论成败都要调用；MEDIA把它当best-effort，抛错不会把已完成渲染变成失败。

### 1.3 `DeliveryCommitPort`

```ts
export interface DeliveryCommitPort {
  commitReady(request: DeliveryCommitRequest, hooks: RenderBoundaryHooks): Promise<void>;
}
```

- **一个事务**：durable receipt + `ready`状态 + 业务outbox事件，全成或全不成。MEDIA不写任何持久状态，也不假定它写成。
- `request.manifest` 是**合同精确DTO**（`DeliveryManifest`），MEDIA已用冻结schema校验过；MAIN落库前应再校验一次。
- `request.attempt`/`delivery_id`/`download_ref`取自**已发布的那份manifest**（并发时可能是胜者的），MAIN记录什么，交付物就一致。

### 1.4 `DeliveryRecordPort`（读模型）

定义在 `src/host/delivery/delivery-service.ts`。MAIN提供持久delivery行；MEDIA只投影成合同`Delivery` DTO并校验。读取**不触发渲染、不触发发布**（T20-H）。若记录为`ready`但已发布包不存在，MEDIA抛`DeliveryContractError`而不是谎报ready（这是“DB ready却缺包”必须暴露的情形）。

---

## 2. 路由与作业接线

| 入口 | MAIN的动作 | MEDIA的模块 |
|---|---|---|
| `task.prepare`（`kind=render_snapshot`） | 校验snapshot已提交、render_spec非空、ExecutionBinding完整，落job | 只准备，不渲染 |
| render job 执行 | 构造`SnapshotRenderService`并调用`render(request)` | `src/host/render/render-snapshot.ts` |
| `delivery.read` | 读`DeliveryRecordPort` → `DeliveryService.read()` | `src/host/delivery/delivery-service.ts` |
| 二进制下载 | `DeliveryService.download()` → 200/206/416 | `src/host/delivery/download.ts` |

`RenderRequest`（`src/host/render/ports.ts`）需要的字段：`project_id` / `job_id` / `snapshot_id` / `source_digest` / `render_spec` / `execution` / `attempt` / `qc_dispositions` / `signal`。

- `qc_dispositions` 是MAIN已记录的**用户对warn级检查的处置**（检查id列表）。MEDIA遇到warn且无处置记录时按block处理，不静默通过（合同：warn不得当静默通过）。
- `signal` 由MAIN的job.cancel接到；MEDIA会**等待子进程真正退出**后才返回取消结果。

## 3. `RenderSpec.config_digest` 的计算规则

MAIN必须用MEDIA的同一函数计算，否则preflight会block（这是有意的：spec声称的配置必须等于实际使用的配置）：

```ts
import { computeRenderConfigDigest } from "./host/render/render-profile.js";
const config_digest = computeRenderConfigDigest({
  render_spec,
  upstream_sha: RENDER_PIN.upstream_sha,     // e70d9d93…
  worker_sha256: RENDER_PIN.worker_sha256,   // 见 src/host/render/openfilm-render-pin.json
});
```

摘要覆盖：`engine_id`、`engine_version`、`width`、`height`、`fps_numerator`、`fps_denominator`、`container`、`video_codec`、`audio_codec`、固定选项`workers=1/samples=1/shutter=0.5`、上游commit、worker摘要；用仓库受限JCS规范化后SHA-256。

## 4. 边界钩子与T20-E的四个杀点

`RenderBoundaryHooks.onBoundary(boundary, context)`，boundary取值与顺序固定：

`encode_finished` → `qc_finished` → `package_published` → `ready_committed` → `events_published`

- 前三个由MEDIA发出。
- **`ready_committed` 与 `events_published` 必须由MAIN在`commitReady`内部发出**：`ready_committed` 在事务提交之后、`events_published` 在outbox事件落地之后。MAIN的crash探针就在这两个点`process.exit`。
- MAIN的钩子若抛异常，MEDIA的渲染立即中止（这正是“用真实终止而不是throw模拟”的机制）。

## 5. 固定上游与pin

- 受信上游根：`/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm`（只读）。路径由MAIN配置传入，MEDIA不硬编码。
- **请求MAIN把四个新摘要并入 `contracts/openfilm-upstream-lock.json`**（该文件属MAIN保护路径，MEDIA不得写）：`packages/openfilm/src/render.mjs`、`timeline.mjs`、`seekable.mjs`、`overrides.mjs`，以及worker摘要 `ea5e9099f440b2cd3ab21a4153971e3f6d8be968f5c58245477c1f1917d94e2c`（worker文件 `src/host/render/openfilm-render-worker.mjs`，改动worker必须同步更新摘要）。
- 在并入之前，MEDIA用 `src/host/render/openfilm-render-pin.json` 作为同内容的lane内pin；两条pin的模块摘要当前完全一致（`host.mjs`/`shared.mjs`/`film-doc.mjs`/`media-links.mjs`与MAIN现有lock逐字节相同）。
- 探针：`pnpm exec tsx tools/agent-driven/media/verify-render-pin.mjs`（缺失checkout报`NOT_RUN`退出0，漂移报`FAIL`退出1）。

## 6. 运行根配置

MAIN为每个worktree配置独立的交付根（不得共用、不得复制可写运行根）：

```
<delivery_root>/published/    # 已发布包
<delivery_root>/staging/      # 本attempt自己的staging
<delivery_root>/quarantine/   # 被取消或被拦下的attempt产物（隔离，不删除）
```

构造：`new PublishedPackageStore({ root })`（`src/host/delivery/published-package-store.ts`）。发布是**一次目录rename**，因此已发布包整体出现，不会出现半包；同名只发布一个，败者不动胜者的数据。

## 7. MAIN需要的其他依赖

- `ffprobe` 与 `ffmpeg` 必须在PATH上（QC的容器探测与**完整解码**用真实工具；失败即block，不做替代）。上游渲染自身还需要上游checkout里已安装的 `playwright-core` 与其Chromium。
- 无网络、无付费、无外部写、无J盘：MEDIA的worker只允许环回，上游渲染只服务`127.0.0.1`。

## 8. 尚未证明的事（不得当作已通过）

MEDIA的模块测试是**模块级检查**（渲染器与解码器是替身）。真实T20-A..H（真实encode、真实ENOSPC、真实截断/坏帧、真实并发、真实取消、**真实杀进程**的四个崩溃点、真实重启后重复下载）全部`NOT_RUN`，需要MAIN的全机资源预约与真实媒体/录音授权。详见 `docs/parallel/lane-media/A06-MODULE-NOTES.md` 的逐项对应表。
