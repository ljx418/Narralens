# N1N2 053 — Headless 隔离、自有进程生命周期与可复核的真实媒体证据

Writer: Claude implementation child, task `task_66a264bdb2f9`, dispatch `ctx_0ea444aa3ce7`,
terminal `term_9203894727896820d3312816d02fa8f7`（同一实施树、同一平铺工作区，未新建 writer/worktree）。
授权：`.../resume-claude-20261112/HEADLESS_REAL_EXPORT_AND_EVIDENCE_053.md` + 同名 `.json`。
cwd `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`，HEAD `e2eff61b464d75d36598103d718cd2a75db5dfda`。

**只改了一个文件**：`tests/m2.3/migration-real-export.test.ts`
（相对 053 基线 `0862247a…227f0`：**+527 / -95 行**；最终候选 sha256 `9fa42cf0d1c26980fd178466e5e44df29be8438c15c1c330d63fccb0826776cb`）。
生产代码、固定上游、其它测试/夹具、配置、pin、索引**未改**；没有 git 动作。

---

## 1. 上游事实（只读确认，未改上游）

- `packages/openfilm/bin/openfilm.mjs:205..219`：`look`/`render` 前若 `project/.film/opened` **不存在**，
  先 `open(project)`；`open()` 走 `studio/client.mjs` 的 `openInStudio` → `ensureStudio`，
  而 `ensureStudio` 以 **`detached: true`** spawn studio server（`client.mjs:150..179`）。
- `studio/server/projects.mjs:41`：`studioHome() = process.env.OPENFILM_HOME || ~/.openfilm`；
  `OPENFILM_LIBRARY` 是同族的私有库变量；`OPENFILM_NO_UPDATE_CHECK=1` 关闭更新检查；
  Studio 把自己的 `run.json`（含 pid/supervisor/origin）写进 **它自己的 studio home**。
- ⇒ **交互前置来自 CLI 的既定行为**，不是生产 `Host.close` 失效；本轮在**测试自己的临时工程**里
  抑制它，不改上游、不改生产。

## 2. 做了什么（只在授权的测试文件内）

1. **Headless 隔离**：渲染前在**本用例自己的临时工程**里写入上游自己读的标记
   `project/.film/opened`（写入前断言该工程在本用例私有根内）。该标记**只表示**
   「不要交互式打开这个工程」，**不是**人已打开、**不是**Studio 展示过、**不是**UX 通过的证据。
   同时给每个 CLI 子进程 `OPENFILM_NO_BROWSER=1`，双保险。
2. **每个子进程私有隔离**：`OPENFILM_HOME` / `OPENFILM_LIBRARY` 指向本用例私有临时目录，
   `OPENFILM_NO_UPDATE_CHECK=1`；**不设置也不改写 `HOME`**，不读写真实 `~/.openfilm`，
   不碰任何用户配置或凭据。
3. **自有进程生命周期**：CLI 子进程用 `spawn`（非 detached），记录 **pid / argv / cwd / 真实 exit**；
   Studio 的识别**基于本用例私有 home 里的 `run.json`**（因此只可能是本用例自己的进程），
   结算时**只对这些 pid** 先 SIGTERM 后 SIGKILL；**不做广域 cmdline 匹配、不按端口清理**、
   不动别人的进程；**无论成功失败都在 `finally` 结算**。
4. **可复核的真实媒体证据**：每个导出**在产生的那一刻**复制到
   `docs/evidence/N1N2/real-export-053/`（内容寻址 + capture id 命名，**不覆盖历史工件**），
   复制后**读回比对 digest**（不符即失败）；每个导出写一份 manifest，记录
   case/阶段、项目与 clip ids、真实 framecount、宽高、容器时长、音频 codec/采样率/声道/时长、
   真实 sha256 与字节数、**真实 render/probe/decode 的 argv 与 exit**、字幕与编辑前后事实、
   上游 SHA 与 CLI 文件 sha、候选 test/源文件 digest、实际 capture id；日志打印真实 sha。
5. **目标 MP4 的完整实证**：ffprobe `-count_frames` 数真实帧（900）、宽高、容器时长，
   ffprobe 音频流事实（codec/采样率/声道/时长），以及
   `ffmpeg -nostdin -hide_banner -v error -i <mp4> -f null -` 的**完整解码**（真实 exit 0）。
   源诊断媒体的音频 probe/decode **原样保留**。
6. **原有断言全部保留**：MIG-03 的两次文件 hash 不同、帧数相同、中镜**真实原生编辑**
   （`shot-002` 的 overrides，rev `91f328c7e5e80673` → `22af153f22a70eea`）、关后重开仍见 3 个 clip、
   字幕文件含「第二镜」、**源工程字节完全不变**（treeDigest 前后相等）、源仍绑 hypit、
   副本绑 openfilm；EN-05 的 rollback `verified`、源字节不变、副本保留、900 帧。

## 3. 真实命令、实际 exit、日志 SHA

| capture | argv | 实际 exit | log sha256 |
|---|---|---|---|
| `n1n2-claude-053-tsc-001` | `corepack pnpm exec tsc --noEmit` | 0 | `e3b0c442…855`（0 字节） |
| `n1n2-claude-053-real-export-001` | vitest `tests/m2.3/migration-real-export.test.ts` | 0 | `bc208240…4e81` |
| `n1n2-claude-053-tsc-002` | `tsc --noEmit` | **2** | `a63e2295…dda`（我引入的两个类型错误，见下） |
| `n1n2-claude-053-tsc-003` | `tsc --noEmit` | 0 | `e3b0c442…855` |
| `n1n2-claude-053-real-export-002` | vitest 同文件 | 0 | `29169dad…a2da` |
| `n1n2-claude-053-tsc-004` | `tsc --noEmit` | 0 | `e3b0c442…855` |
| **`n1n2-claude-053-real-export-003`** | vitest 同文件 | **0** | **`da56e09fdccf91f9cca42da96c24f474205da25e687d98cf01508ed6bdd6b5e1`** |

`real-export-003`：**2 passed (2)**，MIG-03 41.79s、EN-05 28.07s，合计 75.83s。
每次运行的 `inputs.json` 都是运行内冻结的 626 个文件；**003 与 tsc-004 结束后复核 626/626 匹配、0 漂移**；
001/002 的**唯一**漂移是 `tests/m2.3/migration-real-export.test.ts` 本身（我被授权修改的那一个文件，
sha `727834b0…` → `306413de…` → `9fa42cf0…`），**其它 625 个 guard 零漂移**。

## 4. 真实媒体工件（capture 003，独立 `sha256sum` 复核）

| stage | artifact | sha256 | bytes | 媒体事实 |
|---|---|---|---|---|
| mig03-migration-export | `mig03-migration-export-bbf30366cec4-n1n2-claude-053-real-export-003.mp4` | `bbf30366cec4268effe2e625a94eb3dda133fa2156b05a45a91a6e494bbfb8ad` | 917726 | h264 1280×720 **900 帧**，aac 48000 Hz 2ch 30.0 s，完整 decode exit 0 |
| mig03-export-first | `mig03-export-first-bbf30366cec4-…-003.mp4` | `bbf30366cec4…bbfb8ad` | 917726 | 同上 |
| mig03-export-after-middle-edit | `mig03-export-after-middle-edit-7870320dc145-…-003.mp4` | `7870320dc14505149afd161abeab7f954aae83f3716feb1aba4943c58eadcf07` | **939596** | h264 1280×720 **900 帧**，aac 48000 Hz 2ch 30.0 s，完整 decode exit 0 |
| en05-migration-export | `en05-migration-export-bbf30366cec4-…-003.mp4` | `bbf30366cec4…bbfb8ad` | 917726 | 同上 |
| en05-export-copy-after-rollback | `en05-export-copy-after-rollback-bbf30366cec4-…-003.mp4` | `bbf30366cec4…bbfb8ad` | 917726 | 同上 |

**两次导出 hash 不同、帧数相同（900）**；改动的是中镜，字幕文件 `narration.vtt` 本身**未被这次编辑改动**
（编辑前后 sha 相同 `98c2d00b…`，manifest 如实记录），真实变化在 film 文档的 overrides 与渲染结果上。

## 5. 自有资源结算（内部结算，不是事后手动 SIGTERM）

- 053-real-export-003 的日志：`studio_started=false`，`cleanup={"settled":true,"actions":[]}`
  （MIG-03 3 个 CLI 子进程 pid `3682895,3683974,3685055`；EN-05 2 个 pid `3688103,3689319`）。
  **正常路径上根本没有 detached Studio 产生**，所以不需要结算任何东西——
  这与 052 手工 SIGTERM 的情形**不同**，现在由测试自己保证。
- 运行后独立复核：**4747/4748 无监听**、**无 studio server 进程**、`/tmp` 的 `narralens-*` 计数 234
  （与 044/051/052 一致，未删未扫）。
- 机器上另有 IDE 自己的 `playwright-mcp` 与 `/mnt/c/workSpace/navia/…` 的 `node --test`，
  **不属本 lane，未触碰**。
- 全程 Headless 静音、loopback 单重型槽；未读 J 盘、未联网下载、未付费、未外传、未安装或改配置；
  **没有 429**，也没有工具格式异常。

## 6. 两个**我自己的 harness 缺陷**（已修正，证据目录里的 001/002 工件不可采信）

详见同目录 `n1n2-claude-053-evidence-incident.md`：

1. **capture 001 的 `mig03-export-first` 工件名实不符**：渲染器把 MP4 写到同一路径，
   第一版 harness 在 `finally` 才复制，被后一次渲染覆盖 ⇒ 该文件实际是**改单镜后**那份字节。
   独立 `sha256sum` 复核为 `7870320d…`，而名字声称 `bbf30366…`。已改为**当场复制 + 读回比对 digest**。
2. **capture 001/002 的 manifest 把音频写成 `null`**：ffprobe 没请求 `codec_type`，
   代码却按 `codec_type==="audio"` 找流 ⇒ 恒为 null。真实事实是导出**有** AAC 音频
   （48000 Hz、2ch、30.0 s、1407 帧），已用独立 ffprobe 复核并修正（探测加 `codec_type`，
   用例正面断言音频存在/48 kHz/>29 s）。

两份缺陷的工件与 manifest **原样保留**，未被覆盖；capture 003 的工件与 manifest 逐字节正确。

## 7. 未宣称 / 未做

- **未**跑其它 suite、full、build、mutation；**未**做任何下一阶段接线；**未**动 git 索引。
- 诊断媒体**不冒充** A 轮两条 60–180 秒中文有声作品；旧 migrator **不宣称**保留原视觉保真；
  Hypit 源**没有** fresh 付费渲染，EN-05 仍只声明迁移副本的真实渲染。
- 原 17 项、Expected 84 断言、两条反事实、全量构建、冻结独立复核：**均未宣称**，等 MAIN 另行释放。
