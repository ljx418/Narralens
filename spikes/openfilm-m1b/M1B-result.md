# M1B OpenFilm spike 结果

状态：`TECHNICAL_SPIKE_PARTIAL / GATE_NOT_CLOSED`。固定上游、可编辑 30 秒工程、两次真实导出、重开、单镜修改、native stale-base 与严格 409 探针均完成；但本轮没有执行 headed 自动化或人工体验，且离线音轨是三段合成提示音而非中文语音，因此不把 OF-01/OF-02 完整签为 PASS。

## 已通过的直接事实

- 上游固定到 `e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3`；frozen lock 安装和 OpenFilm typecheck 通过。
- 工程为 30 秒、30 fps、三个独立 `<iframe>` 原生 clip，加独立 WAV 音轨和中文 WebVTT；不是扁平 MP4 迁移。
- 首导出与改镜后再导出均为 900 帧、H.264 320×180、AAC 48 kHz、30.000 秒。两个 MP4 和 15 秒帧 SHA 均不同。
- 关闭首次启动的隔离 Studio 后，通过新 Node 进程读取工程、对第二镜应用原生 DOM override，再次 headless 导出。
- 原生 `editProjectFilm` 对 stale base 返回 `rebased:true` 并继续写入；临时 Narralens 严格网关探针在调用 native mutator 前返回 409，`film.html` SHA 保持不变。
- 三个 clip ID 在修改后仍为 `shot-01/02/03`，第二镜文字与位置仍通过 native override 可编辑。
- 上游源码全量测试实际结果为 910 项：905 passed、1 failed、4 skipped。失败项是同名并发 import 在 WSL 挂载文件系统上间歇报告 `assets/pic.png is not a path inside the project`；该项隔离复跑 1/1 通过。由于全量命令退出码仍为 1，本门不把上游测试宣称为全绿。

## 分类结论

| Case | 状态 | 证据/缺口 |
|---|---|---|
| OF-01 | PARTIAL | `first-export.mp4`、ffprobe、中文画面/VTT、独立音轨；缺真实中文语音 |
| OF-02 | PARTIAL | 隔离服务关闭、重读、改一镜、二次导出已通过；headed/人工未执行 |
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

## 自动化类别

- Headless：两次真实渲染、ffprobe、帧抽样、stale-base/409 探针已执行。
- Headed 自动化：`NOT_RUN`，遵守项目“自动交互必须无声、无窗口、不抢焦点”的约束。
- 人类体验：`NOT_RUN`，没有冒充人工验收。

因此当前 M1B 不能签署 `OPENFILM_SPIKE_PASS`，M2 仍为 `NO_GO`。下一次需补真实中文旁白、稳定复现或消除上游并发 import 全量失败，并在用户显式启动的人类体验阶段核对原生 Studio 路径；不需要重做已经通过的 headless 渲染和 stale-base 事实。根据本项目约束，headed 自动化不是默认业务门，若后续确需执行必须另行显式记录并避免抢占用户桌面。
