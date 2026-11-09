# IT-A06 MEDIA → MAIN 接线请求

本文件是MEDIA泳道交给MAIN的具体接线请求。全部条目只涉及MAIN拥有的路径（`src/host/server.ts`、`src/host/projects/`、`src/contracts/`、`contracts/`、注册与DDL），MEDIA不自行修改。生产实现未在本文完成；本文件描述的是**接线**，不是验收。

合同：`ca5b67a8285b130c79055317c6202f73cfbb99c8`。上游固定：`e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3`。

> R1修订：端口签名、原子发布模型、下载就绪门、取消语义与引用id规则都已改变，下面是**当前**的形状。第一版请求里的 `commitReady(request, hooks)`、`SnapshotClosure` 字段与 `RenderRequest` 字段已经过时。

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
| `expected_frames` | 影片的帧数 | **必须给出**：QC用它判断交付物是不是被截短的影片。这是快照里原生文档的事实，不是渲染器的自述 |
| `expected_duration_seconds` | 影片时长（秒） | 同上；缺了则时长检查不执行（帧数检查仍执行） |
| `native_root` / `native_entry` | 原生工程目录与入口文档（`film.html`）相对路径 | 指向**不可变字节**，不是用户当前工程目录 |
| `entries[]` | 闭包内每个文件的 `relative_path` / `absolute_path` / `sha256` / `bytes` / `kind` / `rights_ref` / `role` | `kind` ∈ `native_source` / `asset` / `supplement`；`asset`与`supplement`必须有`rights_ref`；**`supplement`必须有`role`**（例如 `rights`、`subtitles`） |
| `rights[]` | 每个素材的许可事实 | `status` ∈ `cleared` / `restricted` / `unknown`；`commercial_use` |

MEDIA侧会做四件事，MAIN不必重复：逐文件重新计算SHA-256并与快照记录比对；把闭包复制进本次attempt自己的staging后再渲染（**绝不渲染当前工程或客户端路径**）；渲染后再次校验复制件未被改动；打包时按**快照提交的摘要**核对附属件（不用副本自己的摘要 redefining expected）。MAIN仍必须保证闭包本身是已提交快照的闭包——这是MAIN的事，MEDIA无法从文件系统反推。

### 1.2 `AttemptFencePort`

```ts
export interface AttemptFencePort {
  claimAttempt(attempt: AttemptIdentity): Promise<boolean>;   // 已被别的attempt占用时返回false
  checkAttempt(attempt: AttemptIdentity): Promise<"proceed" | "cancelled" | "superseded">;
  releaseAttempt(attempt: AttemptIdentity): Promise<void>;
}
```

- `claimAttempt` 必须在同一`(project_id, job_id, attempt)`上唯一；返回false时MEDIA不启动任何渲染。
- `checkAttempt` 被问三次：渲染前、发布前、**提交前**。取消或被取代的attempt不得发布、不得记录。
- `releaseAttempt` 无论成败都要调用；MEDIA把它当best-effort，抛错不会把已完成渲染变成失败。**唯一例外**：渲染被取消但子进程组未能确认结束时，MEDIA不会释放attempt，而是把 `requires_reconciliation` 置真——此时必须由MAIN持久化一条“待收敛”事实并保持attempt被占用。

### 1.3 `DeliveryCommitPort`

```ts
export interface DeliveryCommitPort {
  commitReady(request: DeliveryCommitRequest, hooks: RenderBoundaryHooks): Promise<void>;
}
```

- **一个事务**：durable receipt + `ready`状态 + 业务outbox事件，全成或全不成。MEDIA不写任何持久状态，也不假定它写成。
- **事务内必须再查一次attempt fence**：MEDIA在提交前查过一次，但“检查”真正要紧的是在让记录变持久的那一个事务里。取消若发生在发布之后、提交之前，MAIN的事务必须拒绝这次提交（此时包已发布、记录未写，是可恢复状态：按key找到已发布包再补记录）。
- `request.manifest` 是**合同精确DTO**（`DeliveryManifest`），MEDIA已用冻结schema校验过；MAIN落库前应再校验一次。
- `request.attempt` 是**产出已发布字节的那次attempt**（并发时可能是胜者的），`request.execution` 是**正在写记录这次attempt**的绑定；`request.package_id` / `request.object_id` 让MAIN能按名对账已发布包。MAIN决定对账/记录语义，MEDIA不替MAIN决定。

### 1.4 `DeliveryRecordPort`（读模型）

定义在 `src/host/delivery/delivery-service.ts`。MAIN提供持久delivery行；MEDIA只投影成合同`Delivery` DTO并校验。读取**不触发渲染、不触发发布**（T20-H）。若记录为`ready`但已发布包不存在，或记录与已发布包的manifest不一致，MEDIA抛`DeliveryContractError`而不是谎报ready。

**下载走同一个端口**：`DeliveryService.download({project_id, job_id, download_ref, range_header})` 会先读MAIN的记录，只有记录为`ready`、qc为`passed`、`download_ref`一致、且记录的manifest与已发布包的manifest**逐项相同**时才返回字节。因此MAIN的下载路由必须带`job_id`（例如 `/api/agent/v1/projects/:id/delivery/:job/download/:ref`）。

---

## 2. 路由与作业接线

| 入口 | MAIN的动作 | MEDIA的模块 |
|---|---|---|
| `task.prepare`（`kind=render_snapshot`） | 校验snapshot已提交、render_spec非空、ExecutionBinding完整，落job | 只准备，不渲染 |
| render job 执行 | 构造`SnapshotRenderService`并调用`render(request)` | `src/host/render/render-snapshot.ts` |
| `delivery.read` | 读`DeliveryRecordPort` → `DeliveryService.read()` | `src/host/delivery/delivery-service.ts` |
| 二进制下载 | `DeliveryService.download()` → 200/206/416；响应结束后调用 `response.close()` | `src/host/delivery/download.ts` |

`RenderRequest`（`src/host/render/ports.ts`）需要的字段：`project_id` / `job_id` / `snapshot_id` / `source_digest` / `render_spec` / `execution` / `attempt` / `qc_dispositions` / `required_supplements` / `signal`。

- `qc_dispositions` 是**MAIN已持久化的**用户对warn级检查的处置（检查id列表）。它**不是客户端字段**：客户端不能提交它，MAIN从自己的持久事实里取。MEDIA遇到warn且无处置记录时按block处理（不静默通过）。
- `required_supplements` 是这次交付**额外**承诺的角色列表。A固定要求的两个角色（`subtitles`字幕、`rights`许可文件）**始终**被要求，请求只能加、不能减：MEDIA的preflight与QC都会把`MANDATORY_A_SUPPLEMENT_ROLES`（`["subtitles","rights"]`）与请求的角色合并后检查。快照闭包里缺任何一个角色就block。A还没有"这一项不适用"的持久理由模型，因此不存在可以声明不适用而放行的路径——MAIN若要支持不适用，需要先有那样的持久模型，再由MEDIA接上。
- `signal` 由MAIN的job.cancel接到；MEDIA会**等待子进程组真正退出**后才返回取消结果。

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
- MAIN的钩子若抛异常，MEDIA的渲染立即中止。

**诚实说明**：钩子抛异常只是让渲染中止，**不等于**真实T20-E。真实T20-E要求在四个点**真实杀死进程**（含encode后/QC前、publish前、rename后/DB前、DB后/events前），重启后必须收敛为可恢复/明确失败/完整已发布之一。真实进程终止验收仍`NOT_RUN`。

## 5. 固定上游、离线守卫与pin

- 受信上游根：`/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm`（只读）。路径由MAIN配置传入，MEDIA不硬编码。
- **网络隔离不是注释**：MEDIA在固定上游的`host.mjs`前面装了一个**离守卫**（`src/host/render/openfilm-offline-wrapper.mjs` + `openfilm-offline-hooks.mjs`，由Node的module hooks在加载时替换，**不改动上游任何字节**）。守卫强制：`FilmPage.open(..., {offline:true, network:{allow:[]}})`（页面只能加载自己的origin，别的请求被拦并记录）、浏览器代理指向关闭端口且回环直连、`--host-resolver-rules` 阻断非回环DNS、`serviceWorkers:"block"`、`seekable:false`（不再用ffmpeg为源视频做快进副本）。守卫的摘要与worker的摘要都在pin里；**守卫没装上时worker拒绝渲染**（`OFFLINE_GUARD_NOT_INSTALLED`）。
- **请求MAIN把四个上游摘要并入 `contracts/openfilm-upstream-lock.json`**（该文件属MAIN保护路径，MEDIA不得写）：`packages/openfilm/src/render.mjs`、`timeline.mjs`、`seekable.mjs`、`overrides.mjs`，以及worker与守卫的摘要（见 `src/host/render/openfilm-render-pin.json`；改动这些文件必须同步更新摘要）。在并入之前，MEDIA用同一pin文件作为lane内pin；两条pin的模块摘要当前逐字节一致。
- 探针：`pnpm exec tsx tools/agent-driven/media/verify-render-pin.mjs`（缺失checkout报`NOT_RUN`退出0，漂移报`FAIL`退出1）。

## 5b. 包里那份"原生源"到底是什么（诚实的范围）

包里带两样原生相关的东西：`native_film.html`（快照里影片自己的入口文档的字节）与`native_source.json`（原生清单）。清单里的字段说明了范围，请照此理解，MAIN的对外文案不要写成"导出了可编辑工程"：

- `scope: "document_and_closure_reference"`、`editable_project_complete: false`；
- `copied`：真正在包里的文件（目前是入口文档）；
- `referenced`：快照闭包里其余文件（素材等）——**它们不在包里**，快照才是权威的可编辑源。

也就是说：交付包的MP4是原生工程的一份导出物，原生工程本身仍在快照里；包里带的是它的文档与闭包清单，用于核对这份导出物来自哪一个快照。MEDIA不写回原生工程，也不把原生工程换成MP4。

## 6. 运行根配置

MAIN为每个worktree配置独立的交付根（不得共用、不得复制可写运行根）：

```
<delivery_root>/published/    # 已发布包的receipt（每个包一个普通文件，硬链接发布）
<delivery_root>/objects/      # 已发布包的完整对象（不可变，只增不改）
<delivery_root>/staging/      # 本attempt自己的staging
<delivery_root>/quarantine/   # 被取消、被拦下或读取失败的attempt产物（隔离，不删除）
```

构造：`new PublishedPackageStore({ root })`（`src/host/delivery/published-package-store.ts`）。发布分两步：

1. 对象目录`objects/<uuid>`由store**自己生成名字并独占创建**（`mkdir`不带recursive，已存在即拒绝，绝不接管别人的目录），完整的文件用硬链接链进去；
2. receipt用**硬链接**发布到`published/<package_id>`——链接在名字被占用时失败，所以**同名只发布一个**，败者只删**自己创建**的那个对象，**从不触碰canonical路径**。

receipt是发布标记：没有receipt的对象只是没人认领的产物，不是交付。**receipt一旦链上，它指向的对象就不再被删除**——即使之后的目录fsync失败，失败会向上抛，但对象与receipt都留着，等MAIN的恢复按key对账（这正是T20-E"rename后/DB前"崩溃要留下的状态）。

## 7. MAIN需要的其他依赖

- `ffprobe` 与 `ffmpeg` 必须在PATH上（QC的容器探测与**完整解码**用真实工具；失败即block，不做替代）。QC的解码参数固定：`-xerror`、`-map 0`（映射全部流）、`-threads 1 -filter_threads 1 -filter_complex_threads 1`、`-protocol_whitelist file,pipe`；ffprobe同样限制协议为本地。
- 上游渲染还需要上游checkout里已安装的 `playwright-core` 与其Chromium。
- 无网络、无付费、无外部写、无J盘：守卫把渲染的浏览器关在回环里，上游渲染只服务`127.0.0.1`。

## 8. 尚未证明的事（不得当作已通过）

MEDIA的模块测试是**模块级检查**（渲染器与解码器是替身；真实网络拒绝探针未跑）。真实T20-A..H（真实encode、真实ENOSPC、真实截断/坏帧、真实并发、真实取消、**真实杀进程**的四个崩溃点、真实篡改、真实新revision、真实重启后重复下载、**真实网络拒绝**）全部`NOT_RUN`，需要MAIN的全机资源预约与真实媒体/录音授权。逐项对应见 `docs/parallel/lane-media/A06-MODULE-NOTES.md`。

`tools/agent-driven/media/render-delivery.ts` 里的fence/commit/hook是**harness的内存实现**，只用于模块证据，**不是生产的Job store**，其结果不得当作生产记录。
