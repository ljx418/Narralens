# M1B OpenFilm spike 结果

状态：`OPENFILM_SPIKE_PASS / M1B_CLOSED`。固定上游、真实中文独立旁白/字幕、可编辑 30 秒三镜工程、两次真实导出、关闭重开、单镜修改、native stale-base 与严格 409 探针均完成。自动化全程 Headless；headed 自动化与人类体验分别记录为 `NOT_RUN`，不冒充人工验收，也不作为本技术 spike 的替代证据。

## 已通过的直接事实

- 上游固定到 `e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3`；frozen lock 安装和 OpenFilm typecheck 通过。
- 工程为 30 秒、30 fps、三个独立 `<iframe>` 原生 clip，加独立 WAV 音轨和中文 WebVTT；不是扁平 MP4 迁移。
- 中文旁白由本机离线 `Microsoft Huihui Desktop (zh-CN)` 生成，原始语音 22.298 秒，静音补齐为精确 30 秒、48 kHz 单声道；无云端 TTS、无付费、无外传。
- 首导出与改镜后再导出均为 900 帧、H.264 320×180、AAC 48 kHz、30.000 秒。两个 MP4 和 15 秒帧 SHA 均不同。
- 关闭首次启动的隔离 Studio 后，通过新 Node 进程读取工程、对第二镜应用原生 DOM override，再次 headless 导出。
- 原生 `editProjectFilm` 对 stale base 返回 `rebased:true` 并继续写入；临时 Narralens 严格网关探针在调用 native mutator 前返回 409，`film.html` SHA 保持不变。
- 三个 clip ID 在修改后仍为 `shot-01/02/03`，第二镜文字与位置仍通过 native override 可编辑。
- 上游源码第一轮全量测试为 905 passed、1 failed、4 skipped；同名并发 import 失败项隔离复跑 1/1 通过。第二轮完整重跑为 906 passed、0 failed、4 skipped、退出码 0，确认第一轮是可恢复的间歇性挂载文件系统竞态；失败历史与两轮日志均保留。

## 分类结论

| Case | 状态 | 证据/缺口 |
|---|---|---|
| OF-01 | PASS | `first-export.mp4`、ffprobe、中文画面/VTT、离线真实中文独立旁白、三个原生 clip |
| OF-02 | PASS-HEADLESS | 隔离服务关闭、重读、原生改一镜、二次导出均通过；headed/人工另记 NOT_RUN |
| OF-03 | PASS-SOURCE | `native-mutation-inventory.md`；生产 translate/block 待 M2 |
| OF-04 | PASS-SPIKE | `edit-and-stale-probe.json`；生产网关仍待 M2 |
| OF-05 | PASS-SPIKE | 三 clip 保留，DOM text/translate/color override 可编辑，二次帧视觉已核对 |
| OF-06 | PASS | `upstream-lock.json` 与固定依赖/许可/运行环境 |

## 上游门禁结果

| 命令 | 结果 | 证据 |
|---|---|---|
| `corepack pnpm --dir vendor/openfilm install --frozen-lockfile` | PASS | 固定 lockfile，无 `latest` |
| `corepack pnpm --dir vendor/openfilm --filter openfilm typecheck` | PASS | 本地执行 |
| `corepack pnpm --dir vendor/openfilm --filter openfilm test` | FAIL：905 pass / 1 fail / 4 skip / 910 total | `evidence/openfilm-test.log` |
| 并发 import 失败项隔离复跑 | PASS：1/1 | `evidence/openfilm-files-concurrency-rerun.log` |
| 同一固定 SHA 第二轮完整测试 | PASS：906 pass / 0 fail / 4 skip / 910 total | `evidence/openfilm-test-r2.log` |

## 自动化类别

- Headless：两次真实渲染、ffprobe、帧抽样、stale-base/409 探针已执行。
- Headed 自动化：`NOT_RUN`，遵守项目“自动交互必须无声、无窗口、不抢焦点”的约束。
- 人类体验：`NOT_RUN`，没有冒充人工验收。

M1B 技术门可签署 `OPENFILM_SPIKE_PASS`。这不等于 M2 已实现，也不等于原生 Studio 人工体验通过；M2 只能在 M1A 独立外审也通过后获得开工资格。后续若进行人类体验，应由用户显式启动；headed 自动化仍非默认路径。
