# M1A — D4.2.1 逐编号补证

日期：2026-10-16

状态：`INTERNAL_R3_PASS / EXTERNAL_R3_PENDING / GATE_NOT_CLOSED`

本目录补齐迁移包指出的逐编号直接证据缺口。它不以“134/134”替代冻结矩阵，也不改写 2026-10-15 的旧 Gate 历史。完整门禁在本轮真实执行，生产行为仅增加可注入测试端口；默认依赖仍是实际文件哈希、ffprobe 与 ffmpeg。

## 实际执行

| 命令 | 结果 | 产物 |
|---|---|---|
| `corepack pnpm exec vitest run tests/host/d4.2.1-migration-evidence.test.ts` | PASS，8/8 | 测试源码及全量门禁日志 |
| `corepack pnpm check` | PASS，17 files、134/134、0 skipped；TypeScript 与 Vite production build PASS | `artifacts/pnpm-check-r5.log`（冻结实现最终门禁） |
| `corepack pnpm evidence:d421-large` | PASS；64 MiB、1024 drain、RSS delta 39,915,520 < 50,331,648；32 MiB cap 返回 413；staging=0 | `artifacts/d421-large-upload-r5.json` |
| Headless Chrome 360/768/1440/1920 + native 200% | PASS；五份 artifact 均绑定 `8f7007d8df53ff15ac73fc73c70ddafb25ed5e2a`；无水平溢出、无控件裁切、axe violation=0 | D4.2.1 viewport/zoom artifacts |

## IM-01..IM-26 直接映射

| ID | 本轮判定 | 直接证据 |
|---|---|---|
| IM-01 | PASS | `d4.2.1-import-service.test.ts` 正常真实 MP4 route/import/@1→@2 |
| IM-02 | PASS | `d4.2.1-migration-evidence.test.ts` file-before-metadata 真实路由 |
| IM-03..09 | PASS | 同文件逐 variant：重复 metadata（同/异）、重复 file（同名/不同名）、多个 file、缺 part、未知 part、坏 JSON、重复 JSON key、16383/16384/16385 边界、非 multipart、缺/坏 boundary；逐例检查 staging 清空 |
| IM-10 | PASS | `d4.2.1-upload-media.test.ts` chunked overflow/client abort/backpressure；64 MiB 证据另见 JSON |
| IM-11..12 | PASS | 本轮由 ffmpeg 真实生成 audio-only 与双 video stream MP4，均 422 |
| IM-13 | PASS | 可控零帧 probe 与真实损坏容器均 422 |
| IM-14..17 | PASS | ffprobe 缺失、ffmpeg 缺失、真实子进程超时且 PID 消失、真实 stderr overflow 均 503；普通非零媒体失败为 422 |
| IM-18..21 | PASS | 真实 HTTP GET 返回 256 项有序库存、并发最大值精确为 2、单项 probe timeout 独立降级、两次 GET 间真实同长度改写 bytes 并立即降级、合法唯一第 257 项命中容量 409 |
| IM-22 | PASS | 真实 HTTP import 与 D4.0 edit 共享同项目 queue；最大活动数 1；仅 edit 令 revision 2→3 |
| IM-23 | PASS | `d4.2.1-import-service.test.ts` 启动恢复、publish-before-journal crash、精确 preimage 补偿 |
| IM-24 | PASS | materialize 路由 404，Project facts 与 Actor count 不变 |
| IM-25 | PASS | 虚构 adopt 路由 404；虚构 edit op 422 `UNSUPPORTED_EDIT`；Project facts 不变 |
| IM-26 | PASS | `d4.2.1-upload-media.test.ts` traversal/symlink/断连；`host-http.test.ts` origin/token/route 安全；本轮 route 负向项 |

## D421 冻结矩阵映射

以下条目以原编号保留；“继承”指同一冻结源码在本轮 `pnpm check` 中重跑，不是用总数替代证据。

| 冻结编号 | 本轮判定 | 证据定位 |
|---|---|---|
| D421-CONTRACT-01/04、ERRORCODE-01/02、MANIFEST-01 | PASS（继承并重跑） | `tests/contracts/d4.2.1-contracts.test.ts` |
| D421-HTTP-01/02、LIMIT-01 | PASS（新增直接项并重跑） | migration-evidence 的 IM-01..10；upload-media |
| D421-DISK-01 | PASS（继承并重跑） | import-service 的 ENOSPC/EIO/rename/fsync/readback fault cases |
| D421-MEDIA-01/02/03 | PASS（新增直接项并重跑） | migration-evidence 的 IM-11..17；upload-media 真实 CFR/VFR |
| D421-MIGRATE-01/02、IDEMP-01、CONTENT-01 | PASS（继承并重跑） | registry-journal 与 import-service |
| D421-QUEUE-01 | PASS（新增直接项） | migration-evidence IM-22 |
| D421-HYPIT-01/02、D40-REG | PASS（继承并重跑） | `d4-media-write-actor.test.ts`、import-service/registry tests；本轮没有修改 Hypit |
| D421-INVENTORY-01、CACHE-FRESHNESS-01/02 | PASS（新增 256/2/timeout/GET 直接项） | registry-journal；migration-evidence IM-18..21 |
| D421-INV-DERIVED-01、NOWRITE-01 | PASS（继承并重跑） | contracts/import-service/host HTTP；route 负向 facts |
| D421-UI-01/02 | PASS（本轮重新 Headless 执行） | 360/768/1440/1920 与 native 200% 均记录完整实现 SHA；修复并验证 tablet 双列输入裁切、grid/长 asset ID 溢出。headed/human 本轮 NOT_RUN |
| D421-SEC-01 | PASS（继承并重跑） | upload-media、host-http、既有扫描证据 |
| D421-LARGE-01 | PASS（本轮重跑） | `artifacts/d421-large-upload.json` |
| D421-ROUTE-404-MATERIALIZE/ADOPT | PASS（新增直接项） | migration-evidence IM-24/25 |
| D421-DEP-01 | PASS（继承并重跑） | lockfile/依赖合同及 `pnpm audit` 历史证据；本轮未改依赖 |
| D421-REG-01 | PASS | 本轮 `pnpm check`：134/134、0 skipped、production build PASS |

## 声明边界

- 自动化交互：本轮以隔离临时工程重新执行 Headless 100%/native 200%，无可见窗口、静音、不抢焦点；失败尝试保留且没有覆盖成功前的事实。
- Headed 自动化：本轮 `NOT_RUN`。
- 人类体验：本轮 `NOT_RUN`。
- 独立外审：必须绑定本轮冻结 commit；在 Claude Code 给出 PASS/YES 前，M1A 与 D4.2.1 均不能关闭。

## SHA256

- `artifacts/pnpm-check.log`: `5a7e5a8887d57e1d01763516ce9ef97ca379ea63c82d6a02bbdb6191218957a1`
- `artifacts/d421-large-upload-r5.json`: `823774676ba7f1aa6fbb9ce7fafc0b8520a7a1fcf28a9d3575ee7298378bc367`
- `artifacts/pnpm-check-r5.log`: `6f3b63e681fe47a53bc60d2f7dca0873d3bd9dd84da7996e57068e11d2d2776a`
- viewport 360/768/1440/1920 JSON：`880364495e27b4c003e0fe6a704855163f36516a2c8b5691f9b69d4032f22b19` / `d973f28f2a95ea22492c576154614aa9382350d6f429a077806f51d4d6de1261` / `622450e9362fa9167275c8650e7c2813f31e8204a3a98a6b57e72d24c65b3708` / `2d5a9f5778c5949156d3d0f5de4ec3626a15501b19bffdaa0e1eb7d05e25301c`
- native 200% JSON：`28c08fcee99a28d7d3e9c267154c54710a4e4ad4ab78c5077ff0d39d26e14301`

`pnpm-check.log`、`pnpm-check-r2.log`、`pnpm-check-r3.log`、`pnpm-check-r4.log` 是冻结前的历史门禁，均由 `pnpm-check-r5.log` 取代；它们只保留审计轨迹，不能作为 `8f7007d...` 的最终运行产物。
