# IT-A06 MEDIA 模块说明（交Codex复核）

状态：**实现完成，未运行**。本文是模块说明与验收对照，不是验收结论。所有命令`NOT_RUN`（MAIN A-BASELINE-CHECK exec62928 RUNNING：只允许源码编辑与读取）。本泳道的实现候选由Codex冻结SHA后独立读取代码并重跑；MAIN集成后重跑真实组合链。

合同：`ca5b67a8285b130c79055317c6202f73cfbb99c8`。上游固定：`e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3`。

---

## 1. 模块地图

| 文件 | 职责 |
|---|---|
| `src/host/render/ports.ts` | MAIN要实现的三个端口 + `RenderPort` + 边界钩子类型 |
| `src/host/render/render-profile.ts` | 固定渲染选项与配置摘要（MAIN也用它算`RenderSpec.config_digest`） |
| `src/host/render/openfilm-render-pin.json` | 上游渲染模块与worker的摘要（lane内pin；并入MAIN lock的请求见requests） |
| `src/host/render/upstream-pin.ts` | 校验上游checkout：commit、干净树、模块摘要、worker摘要 |
| `src/host/render/openfilm-render-worker.mjs` | 无shell子进程worker：校验请求与pin后调用上游`render(args, opts)` |
| `src/host/render/native-renderer.ts` | 以固定argv拉起worker；取消时按进程组停止并**等待退出**；超时；失败分类 |
| `src/host/render/snapshot-copy.ts` | 把快照闭包复制进本attempt的staging；逐文件校验摘要；拒绝链接与越界路径 |
| `src/host/render/render-snapshot.ts` | 编排：preflight → 复制 → 渲染 → 复校 → QC → 打包 → 原子发布 → MAIN记录 |
| `src/host/preflight/preflight.ts` | 渲染前能查的事实：快照身份、闭包、许可、render_spec、配置摘要、上游pin、空间 |
| `src/host/delivery/qc.ts` | 真实ffprobe探测 + **完整解码**（`-xerror`）+ 附属文件摘要；产出`QCItem[]` |
| `src/host/delivery/manifest.ts` | 构造并用冻结schema校验精确`DeliveryManifest` / `Delivery` DTO |
| `src/host/delivery/package-layout.ts` | 包内文件名、引用id、delivery/package/download id的派生规则 |
| `src/host/delivery/published-package-store.ts` | staging / 原子发布（一次rename）/ 读取 / 隔离；不覆盖、不删他人数据 |
| `src/host/delivery/download.ts` | 单range下载：200/206/416、ETag=真实SHA、无重定向、跨项目拒绝 |
| `src/host/delivery/delivery-service.ts` | 交付读模型：只读不渲染不发布 |
| `tools/agent-driven/media/render-delivery.ts` | 模块harness：对本地原生工程跑真实渲染+QC+发布并打印证据（**不写持久记录、不清权**） |
| `tools/agent-driven/media/verify-render-pin.mjs` | pin探针：缺失→`NOT_RUN`(exit 0)，漂移→`FAIL`(exit 1) |

测试：`tests/agent-driven/media/`（9个文件，含support.ts共享夹具）。

## 2. 交付路径（顺序即约束）

```
claim attempt
  → 读已提交快照（MAIN）
  → preflight（身份/闭包/许可/spec/配置摘要/pin/空间）   任一block → blocked，不发布
  → 复制闭包到本attempt staging（逐文件校验摘要）
  → 渲染（固定argv的worker；上游render(args,opts)；取消=进程组停止并等待退出）
  → 复校复制件未被改动
  → 边界 encode_finished
  → QC（真实ffprobe + 完整解码 + 附属摘要）                任一block → blocked，不发布
  → 边界 qc_finished
  → fence复查（取消/被取代 → 不发布，产物隔离）
  → 组包（media/ffprobe/full_decode/supplements/index/manifest）
  → 原子发布（一次rename；同名只发布一个）
  → 边界 package_published
  → MAIN的commitReady（receipt+ready+outbox一个事务）     边界 ready_committed / events_published 由MAIN发
  → 释放attempt
```

## 3. T20-A..H 对照（模块级 vs 真实）

**下表的“模块级”是MEDIA的单元/边界检查；“真实”是必须由MAIN在全机资源预约下、用真实ffmpeg/浏览器/真实媒体完成的验收，全部`NOT_RUN`。模块级检查不是真实进程崩溃验收。**

| case | 模块级已覆盖 | 真实（NOT_RUN） |
|---|---|---|
| T20-A 磁盘满/写失败 | 渲染失败按`RENDER_OUT_OF_SPACE`分类为可重试；不发布、不提交 | 真实ENOSPC（隔离故障文件系统或可审计I/O注入），不填满系统盘 |
| T20-B 非零/截断/坏帧 | QC用替身解码器复现非零退出与错误行→block；未QC完不发布 | 真实ffmpeg非零、截断文件、坏帧的真实完整解码 |
| T20-C 并发同key/预置同名 | 真实文件系统上的并发publish：恰好一个`published`、一个`already_published`；预置非包目录→拒绝且不动它 | 两个真实进程并发、真实预置同名输出 |
| T20-D 取消与晚到 | fence复查：取消→不发布；取消产物隔离不删除 | 真实取消后注入晚到成功回调；真实子进程与lease停止 |
| T20-E 四个崩溃点 | 边界钩子可中止渲染；发布与记录之间失败→`COMMIT_FAILED`（包已发布、可按key对账） | **真实杀进程**：encode后/QC前、publish前、rename后/DB前、DB后/events前 |
| T20-F 权利/QC/附属篡改 | 许可未清→block；附属摘要不符→block；warn无处置→block | 真实QC block后修复重试、真实附属文件缺失/摘要不符 |
| T20-G 渲染中新revision | manifest绑定请求给的snapshot/source_digest/attempt，与当前revision无关 | 渲染中真实提交新revision，旧job仍绑定旧snapshot |
| T20-H 重复读/重启 | 读模型只读；重复读同一份；同key第二次发布→同一delivery_id/download_ref | 真实重复GET、重启后再下载、digest/bytes/manifest相同 |

## 4. 边界与失败语义（写给验收者）

- **block vs failed**：preflight/QC的`block`是事实判定（输入/产物不合格），`failed`是执行失败（渲染器失败、超时、取消、记录失败）。两者都不发布、不提交。
- **warn**：QC当前不产出warn；若将来产出，没有MAIN记录的处置（`qc_dispositions`）即按block处理。
- **同名不同字节**：发布是按delivery key（project+snapshot+配置摘要）定位的。若两次attempt产生**不同字节**且key相同，先发布者胜出，后者在`already_published`里拿到胜者的manifest并按它记录（交付物与记录一致），**不覆盖**。这意味着真实编码器的非确定性会让败者采用胜者的产物，而不是产生第二份包。
- **被占用的名字**：`published/<package_id>` 若被非本Host发布的内容占用，发布失败并**原样保留**（不删不改）。
- **隔离**：`quarantine/` 保存被取消、被拦下或读取失败的attempt产物；清理只动本attempt的staging。

## 5. 安全性质

- 无shell：worker以固定argv（worker路径 + 请求文件 + 响应文件）启动；请求内容逐字段校验。
- 无网络：worker只校验并加载上游模块；上游只服务`127.0.0.1`；`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`。
- 环境白名单：worker只得到列出的环境变量（`NODE_OPTIONS`不在其中）。
- 路径封闭：请求的film与输出都必须在staging根内；上游根不得在staging内；文件名必须是纯名；相对路径不得含`..`/绝对路径/反斜杠；符号链接不是文件。
- 不渲染当前工程：渲染对象永远是快照闭包的复制件；复制件在渲染前后各校验一次摘要。
- 不用客户端路径：所有路径来自MAIN的快照闭包或本Host自己的staging/published根。
- **原生可编辑源保持原生**：渲染读的是快照里的原生工程（`film.html`及其clip），MP4只是这份原生源的**导出物**。MEDIA不写回原生工程、不把原生工程换成MP4、不生成扁平化母版；原生源仍在快照里，仍可逐镜编辑。交付包里的`media.mp4`是快照的一个派生物，与`source_digest`/`snapshot_id`绑定。
- 没有第二个库、没有持久作业状态机：本模块只写文件；作业状态、delivery行、业务事件全在MAIN。

## 6. 已知限制（不隐藏）

1. 上游渲染需要其checkout里已安装的`playwright-core`与Chromium；缺任一项时worker失败，交付为`failed`，**不会**退回到简单concat。
2. 渲染尺寸必须与原生舞台同形：上游按`scale`缩放，宽度定`scale`、高度必须精确等于`stage.h × scale`，否则worker拒绝（`ASPECT_MISMATCH`；`scale`非正数为`SIZE_NOT_A_MULTIPLE`）。不会交付比例不同的影片，也不会拉伸或裁切。
3. 上游的画面稳定性依赖其自身的合成；MEDIA只保证容器/编码/尺寸/帧率/完整解码这些可核事实，不对画面美学做判断。
4. 模块测试用替身渲染器与替身解码器；它们证明**编排与边界**的行为，不证明真实编码。
5. `quarantine/` 里的产物会累积，需要MAIN的恢复流程定期清理（MEDIA不自动删）。

## 7. 待MAIN释放后执行的命令（当前全部NOT_RUN）

```sh
corepack pnpm install --offline --frozen-lockfile
corepack pnpm exec vitest run tests/agent-driven/media --maxWorkers=1
corepack pnpm exec tsc --noEmit
corepack pnpm exec tsx tools/agent-driven/media/verify-render-pin.mjs
# 需要资源预约与真实媒体后：
corepack pnpm exec tsx tools/agent-driven/media/render-delivery.ts \
  --project <原生工程> --upstream /mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm \
  --delivery-root <隔离交付根> --width 1920 --height 1080 --fps 30
```
