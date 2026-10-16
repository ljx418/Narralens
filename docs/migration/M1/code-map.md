# M0 真实代码地图

事实基线：`304c89134fdf9f834f7d69e3f4d5c89a68044c60`。本页记录现有实体，不把迁移包草案当成已实现 API。

| 责任 | 真实代码实体 | 当前事实 | 迁移约束 |
|---|---|---|---|
| Host 路由与认证 | `src/host/server.ts` / `NarralensHost` | loopback Origin、Bearer session、项目/资产/提案/编辑/Job 路由已存在 | M2 前不得开放 migration/materialize/adopt 新写入口 |
| 项目写入串行化 | `src/host/projects/project-operation-queue.ts` | Host 单例同时注入 `ProjectWriteActor` 与 `AssetImportService` | M2 扩展为引擎无关 Coordinator 边界，不能双队列/双写 |
| typed edit | `src/host/projects/project-write-actor.ts` | `parameter.adjust` 与 `media.replace` 受 revision、lock、journal、补偿约束 | 保留为 Host commit 所有者；OpenFilm native 写入口必须翻译或禁用 |
| 修订与 journal | `src/host/projects/revision-store.ts` | edit journal、import journal、幂等结果与 attention 已落 SQLite | M2 在此演进 snapshot/commit-record/outbox，不另建第二时间线数据库 |
| 本地导入 | `src/host/assets/asset-import-upload.ts`、`asset-import-service.ts` | 严格流式 multipart、真实媒体验证、内容寻址安装、@1→@2 事务已实现 | M1A 补逐 case 证据，不重写已通过模块 |
| 资产库存 | `src/host/projects/asset-registry.ts` | 每次 GET 重验 bytes/media，最多 256 项，并发 2 | M1A 直接证明 256、并发 2、单项失败隔离、重复 GET |
| 媒体验证 | `src/host/assets/media-validator.ts` | ffprobe + ffmpeg 完整解码；单视频流/CFR/30fps；超时与 stderr 上限 | M1A 补无/多/零流及工具故障直接证据 |
| Hypit 读写边界 | `src/adapters/hypit/hypit-read-adapter.ts`、`hypit-write-adapter.ts` | 固定 fork，expected manifest SHA 与 D4.0 typed edit 已接入 | Hypit 仅作 legacy/回退；保留合同测试和执行入口 |
| 提案生成 | `src/adapters/openmontage/*` | 真实 Claude CLI 多提案、费用/Runner 审计已通过 D4.1 | VibeMovie 只借鉴结构化提案，不引入 Gemini/完整 timeline/Remotion 后端 |
| 当前 UI | `src/app/director/*` | Narralens 工作台和资产导入 UI；不是 OpenFilm Studio | M2 后以固定 OpenFilm Studio 为原生 UI，复用一个 selection/playback/snapshot |
| 合同 | `contracts/`、`src/contracts/{types,validator}.ts` | D4.2.1 四份 runtime 合同已注册，后续合同未注册 | 包内 `migration-contracts.schema.json` 仍为目标草案 |

OpenFilm 生产适配器、`EnginePort`、EngineBinding、NativeMutationRegistry、持久 Job lease/outbox 和完整 source dependency digest 当前均不存在；其状态必须保持“待 M2”，不能因 M1B spike 存在而标记为生产实现。
