# IT-A06 MEDIA 模块说明（交Codex复核）

状态：**R1修复后的实现，未运行**。本文是模块说明与验收对照，不是验收结论。所有命令`NOT_RUN`（MAIN A-BASELINE-CHECK exec62928 RUNNING：只允许源码编辑与读取）。本泳道的实现候选由Codex冻结SHA后独立读取代码并重跑；MAIN集成后重跑真实组合链。

合同：`ca5b67a8285b130c79055317c6202f73cfbb99c8`。上游固定：`e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3`。

---

## 0. R1修复对照（Codex的十条）

| # | Codex的指出 | 这次怎么改的 |
|---|---|---|
| 1 | `render-profile.ts` 对象字面量里的`readonly`是非法TS，编译阻断 | 去掉字面量里的`readonly`，用`Object.freeze`固定；全仓再读一遍接缝 |
| 2 | 败者会把**活着的赢家目录**当“不完整发布”quarantine掉；发布必须不可覆盖 | 改成两步：对象在自己的staging里建完整→整体`rename`进`objects/<uuid>`；**receipt**用硬链接发布到`published/<package_id>`。链接在名字被占用时失败，败者只删自己的对象，**从不触碰canonical路径**；canonical路径上有非receipt内容或畸形receipt→失败关闭不替换；所有文件与目录都fsync，fsync失败不吞 |
| 3 | 只靠注释说“没有网络”不算 | 加了**离线守卫**：Node module hooks把固定上游的`host.mjs`换成一个带守卫的模块（不改上游字节）。守卫强制`offline:true`+`network.allow:[]`、代理指向关闭端口、`--host-resolver-rules`、上下文`serviceWorkers:"block"`、`seekable:false`；守卫与worker都在pin里；守卫没装上worker拒绝渲染。**允许正小数scale**（原来整数倍限制会挡住合法缩放） |
| 4 | QC不完整：没比对帧数、流、超帧率 | 解码固定`-xerror`、`-map 0`、`-threads 1`三条、协议白名单`file,pipe`；ffprobe同样限协议；**帧数与时长与不可变原生文档比对**（快照提供`expected_frames`/`expected_duration_seconds`）；流的个数必须与spec一致；帧率按有理数**值**比较 |
| 5 | 空的supplements也算通过 | 请求带`required_supplements`；preflight要求闭包里确有该角色且许可已清；QC再查一次；附属件按**快照提交的摘要**核对；包里带**原生可编辑源**（`native_film.html` + `native_source.json`），不会把扁平MP4冒充工程 |
| 6 | preflight的发现被丢掉，低空间warn静默通过 | preflight的每一项都进入交付的`qc`清单；warn没有MAIN记录的处置→block（`applyDispositionGate`单独可测）；处置字段是host-only（MAIN从持久事实取，客户端不能提交） |
| 7 | 下载会在未ready时泄露字节；同尺寸篡改不失败 | 下载前必须读MAIN的持久记录：ready、qc passed、ref一致、**记录与已发布包的manifest逐项相同**；包内**每个**文件按receipt校验（形态、路径名、id唯一、与manifest每个ref对应）；打开用`O_NOFOLLOW`、**用同一个描述符哈希并从它流出**，同尺寸篡改失败 |
| 8 | 取消：预取消仍会起worker；QC子进程没收到signal；worker退出不等于子孙退出 | 预取消**不起worker**；QC的ffprobe/ffmpeg收到signal并被等待；取消后**等进程组真的消失**（`groupExists`轮询），没消失则`requires_reconciliation`为真、**不释放attempt**；stdout/stderr有界；升级信号前先确认组还在、组被回收后清掉定时器（避免PID复用误杀） |
| 9 | `media`/`ffprobe`引用id在所有交付里撞车 | 引用id带交付身份：`d_<32hex>_media`、`d_<32hex>_ffprobe`…；索引/manifest/QC证据一致；去重时核对project/snapshot/source/config，并保留**胜者的attempt**，不把胜者的attempt与败者的ExecutionBinding混用 |
| 10 | 证据不诚实 | HANDOFF更正中断主体（Codex负责人，非用户）、记录exec/PID/无429；本文明确：**钩子抛异常不是真实T20-E**，真实杀进程未跑；harness的内存fence/commit是demo，**不是生产Job store** |

## 1. 模块地图

| 文件 | 职责 |
|---|---|
| `src/host/render/ports.ts` | MAIN要实现的三个端口 + `RenderPort` + 边界钩子 + `RenderOutcome` |
| `src/host/render/render-profile.ts` | 固定渲染选项与配置摘要（MAIN也用它算`RenderSpec.config_digest`） |
| `src/host/render/openfilm-render-pin.json` | 上游渲染模块、离线守卫与worker的摘要 |
| `src/host/render/upstream-pin.ts` | 校验上游checkout：commit、干净树、模块摘要、守卫摘要、worker摘要 |
| `src/host/render/openfilm-offline-wrapper.mjs` | **离线守卫**：包装固定上游的`FilmPage.open`与`launch` |
| `src/host/render/openfilm-offline-hooks.mjs` | Node module hooks：把守卫装到固定上游前面 |
| `src/host/render/openfilm-render-worker.mjs` | 无shell固定argv worker：校验请求与pin、装守卫、调用上游`render(args, opts)` |
| `src/host/render/native-renderer.ts` | 拉起worker；取消按进程组停止并**等到组消失**；超时；失败分类 |
| `src/host/render/snapshot-copy.ts` | 快照闭包的不可变复制与摘要复校；拒绝链接与越界路径 |
| `src/host/render/render-snapshot.ts` | 编排：preflight → 复制 → 渲染 → 复校 → QC → 组包 → 原子发布 → MAIN记录 |
| `src/host/preflight/preflight.ts` | 渲染前事实：快照身份、闭包、许可（含附属件）、完整性、spec、配置摘要、上游pin、空间 |
| `src/host/delivery/qc.ts` | 真实ffprobe + **完整解码**（全部流、严格、单线程、限协议）；帧数/时长/流/帧率比对；附属件 |
| `src/host/delivery/manifest.ts` | 精确`DeliveryManifest` / `Delivery` DTO，用冻结schema校验 |
| `src/host/delivery/package-layout.ts` | 包内文件名、**带交付身份的引用id**、delivery/package/download id派生 |
| `src/host/delivery/published-package-store.ts` | 对象+receipt两步发布（硬链接、不可覆盖）、receipt校验、隔离 |
| `src/host/delivery/download.ts` | 单range下载：200/206/416、ETag=真实SHA、无重定向、跨项目拒绝、`O_NOFOLLOW`同描述符哈希 |
| `src/host/delivery/delivery-service.ts` | 读模型：只读不渲染；下载要MAIN的持久记录说ready |
| `tools/agent-driven/media/render-delivery.ts` | 模块harness（**内存fence/commit，只是demo，不是生产Job store**） |
| `tools/agent-driven/media/verify-render-pin.mjs` | pin探针：缺失→`NOT_RUN`(exit 0)，漂移→`FAIL`(exit 1) |

测试：`tests/agent-driven/media/`（12个文件，含support.ts共享夹具）。

## 2. 交付路径（顺序即约束）

```
claim attempt
  → 读已提交快照（MAIN）
  → preflight（身份/闭包/许可/完整性/spec/配置摘要/pin/空间）  任一block → blocked，不发布
  → 复制闭包到本attempt staging（逐文件校验摘要）
  → 渲染（固定argv的worker；守卫装好才跑；取消=进程组停止并等到组消失）
  → 复校复制件未被改动
  → 边界 encode_finished
  → QC（真实ffprobe + 完整解码 + 帧数/时长/流比对 + 附属件摘要）  任一block → blocked，不发布
  → 边界 qc_finished
  → fence复查（取消/被取代 → 不发布，产物隔离）
  → 组包（media/ffprobe/decode/附属件/原生文档/原生清单）
  → 发布（对象整体移入 objects/，receipt 硬链接到 published/）
  → 边界 package_published
  → fence复查（取消 → 包已发布、记录未写，交MAIN对账）
  → MAIN的commitReady（receipt+ready+outbox一个事务；事务内再查fence）
  → 边界 ready_committed / events_published 由MAIN发
  → 释放attempt（除非取消未收敛）
```

## 3. T20-A..H 对照（模块级 vs 真实）

**下表的“模块级”是MEDIA的单元/边界检查；“真实”是必须由MAIN在全机资源预约下、用真实ffmpeg/浏览器/真实媒体完成的验收，全部`NOT_RUN`。模块级检查不是真实进程崩溃验收。**

| case | 模块级已覆盖 | 真实（NOT_RUN） |
|---|---|---|
| T20-A 磁盘满/写失败 | 渲染失败按`RENDER_OUT_OF_SPACE`分类为可重试；不发布、不提交 | 真实ENOSPC（隔离故障文件系统或可审计I/O注入），不填满系统盘 |
| T20-B 非零/截断/坏帧 | QC用替身解码器复现非零退出与错误行→block；帧数少于原生文档→block；未QC完不发布 | 真实ffmpeg非零、截断文件、坏帧的真实完整解码 |
| T20-C 并发同key/预置同名 | 真实文件系统上的并发publish：恰好一个`published`、一个`already_published`；败者只删自己的对象；canonical路径上是畸形receipt→失败关闭且原样保留；canonical路径上是别人的receipt→`PACKAGE_CONFLICT` | 两个真实进程并发、真实预置同名输出 |
| T20-D 取消与晚到 | 预取消不起worker；fence在发布前与提交前各查一次；取消产物隔离不删除；子进程组未确认消失→`requires_reconciliation`且不释放attempt | 真实取消后注入晚到成功回调；真实子进程与lease停止 |
| T20-E 四个崩溃点 | 边界钩子可中止渲染（**这不等于真实崩溃**）；发布与记录之间失败→`COMMIT_FAILED`（包已发布、可按key对账） | **真实杀进程**：encode后/QC前、publish前、rename后/DB前、DB后/events前 |
| T20-F 权利/QC/附属篡改 | 许可未清→block；附属摘要不符→block；承诺的附属件缺失→block；warn无处置→block；同尺寸字节篡改→下载失败 | 真实QC block后修复重试、真实附属文件缺失/摘要不符 |
| T20-G 渲染中新revision | manifest绑定请求给的snapshot/source_digest/attempt，与当前revision无关 | 渲染中真实提交新revision，旧job仍绑定旧snapshot |
| T20-H 重复读/重启 | 读模型只读；重复读同一份；同key第二次发布→同一delivery_id/download_ref；下载只给MAIN记录说ready的交付 | 真实重复GET、重启后再下载、digest/bytes/manifest相同 |

另有一项不在T20编号内但同样重要：**真实网络拒绝探针**。守卫的强制选项与浏览器参数已在模块层被检查，真实“渲染时尝试访问外网并被看到失败”的探针属于重型验收，`NOT_RUN`。

## 4. 边界与失败语义（写给验收者）

- **block vs failed**：preflight/QC的`block`是事实判定（输入/产物不合格），`failed`是执行失败（渲染器失败、超时、取消、记录失败）。两者都不发布、不提交。
- **warn**：QC当前不产出warn；preflight可能产出（如空间偏紧）。warn没有MAIN记录的处置即block。
- **同名不同字节**：发布按delivery key（project+snapshot+配置摘要）定位。先发布者胜出；后者在`already_published`里拿到**胜者的receipt与manifest**并按它记录（交付物与记录一致），**不覆盖**。胜者的attempt保留在manifest里，败者的ExecutionBinding只用于“谁在写记录”。
- **被占用的名字**：`published/<package_id>`若被非本Host发布的内容占用，发布失败并**原样保留**（不删不改）。
- **隔离**：`quarantine/`保存被取消、被拦下或读取失败的attempt产物；清理只动本attempt的staging与自己的object。
- **requires_reconciliation**：取消后子进程组未能确认消失时为真。MAIN必须持久化一条“待收敛”事实并保持attempt被占用；MEDIA不会自动恢复它。

## 5. 安全性质

- 无shell：worker以固定argv（worker路径 + 请求文件 + 响应文件）启动；请求内容逐字段校验。
- 无网络：离守卫在固定上游前面（`offline:true` + `network.allow:[]` + 死代理 + DNS阻断 + `serviceWorkers:"block"` + `seekable:false`）；守卫没装上就不渲染。守卫与worker都在pin里。
- 环境白名单：worker只得到列出的环境变量（`NODE_OPTIONS`不在其中）。
- 路径封闭：请求的film与输出都必须在staging根内；上游根不得在staging内；文件名必须是纯名；相对路径不得含`..`/绝对路径/反斜杠；符号链接不是文件。
- 不渲染当前工程：渲染对象永远是快照闭包的复制件；复制件在渲染前后各校验一次摘要。
- 不用客户端路径：所有路径来自MAIN的快照闭包或本Host自己的staging/published/objects根。
- **原生可编辑源保持原生**：渲染读的是快照里的原生工程，MP4只是它的**导出物**；包里同时带原生文档与原生清单（`native_film.html` / `native_source.json`），不会把扁平MP4当成可编辑工程。
- 没有第二个库、没有持久作业状态机：本模块只写文件；作业状态、delivery行、业务事件全在MAIN。

## 6. 已知限制（不隐藏）

1. 上游渲染需要其checkout里已安装的`playwright-core`与Chromium；缺任一项时worker失败，交付为`failed`，**不会**退回到简单concat。
2. 渲染尺寸必须与原生舞台同形：上游按`scale`缩放，宽度定`scale`、高度必须精确等于`stage.h × scale`，否则worker拒绝（`ASPECT_MISMATCH`）。不会交付比例不同的影片，也不会拉伸或裁切。
3. 上游的画面稳定性依赖其自身的合成；MEDIA只保证容器/编码/尺寸/帧率/帧数/时长/完整解码这些可核事实，不对画面美学做判断。
4. 帧数/时长的“期望值”来自MAIN的快照（原生文档的事实）。MEDIA信任快照在这件事上的诚实，因此`expected_frames`缺失时preflight直接block，而不是跳过检查。
5. 模块测试用替身渲染器与替身解码器；它们证明**编排与边界**的行为，不证明真实编码，也不证明真实网络拒绝。
6. `quarantine/`与未被receipt引用的`objects/`会累积，需要MAIN的恢复流程定期清理（MEDIA不自动删已发布或未被认领的数据）。
7. 上游的ffmpeg helper没有协议白名单；MEDIA不改动上游字节，因此协议限制落在**输入侧**（上游的`fileOf`把影片里引用的路径解析为影片目录内的本地文件，外部URL解析不到本地文件）并在QC侧对本地路径加`-protocol_whitelist file,pipe`。这是比"改上游"弱一层的保证，已如实记录。

## 7. 待MAIN释放后执行的命令（当前全部NOT_RUN）

```sh
corepack pnpm install --offline --frozen-lockfile
corepack pnpm exec tsc --noEmit
corepack pnpm exec vitest run tests/agent-driven/media --maxWorkers=1
corepack pnpm exec tsx tools/agent-driven/media/verify-render-pin.mjs
# 需要资源预约与真实媒体后：
corepack pnpm exec tsx tools/agent-driven/media/render-delivery.ts \
  --project <原生工程> --upstream /mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm \
  --delivery-root <隔离交付根> --width 1920 --height 1080 --fps 30
```
