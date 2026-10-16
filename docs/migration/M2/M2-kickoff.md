# M2 开工包：受控 OpenFilm 基础设施

日期：2026-10-17

决策：`GO_M2`，但 `M2_NOT_STARTED`。本文件只授权下一阶段按 M2.1→M2.2→M2.3 实施，不授权提前开放 materialize/adopt，不代表 OpenFilm 已进入生产路径。

## 1. 冻结输入

| 输入 | SHA / 状态 |
|---|---|
| 原始 main / origin main | `304c89134fdf9f834f7d69e3f4d5c89a68044c60` |
| M1A 冻结实现 | `c0f101b964f9cfe492095440eba1bb9b0edad42d` |
| M1A 外审证据 | `5b5c5d67ef2fae7fa4efc52840071d1cddb8b3cf`，Claude Code R4 `ALLOW_M1A_CLOSE=YES` |
| M1B 来源分支 | `6e9bdeeb49093a4b830c4bc4337f012662c3e89d` |
| OpenFilm 上游 | `e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3`，0.1.7，MIT，固定 lock |
| 组合候选 | `5210ec87fac4d6241c4771b672a8232f51f69db8` |

组合候选相对 M1A 证据提交只新增 `spikes/openfilm-m1b/**` 与状态文档；没有引入 `vendor/openfilm`，没有修改生产 Hypit、Host、合同或 UI。组合提交上重新执行 Narralens 17 files / 134 tests、TypeScript、production build，全部通过；另以组合树中的三 clip 工程执行真实 native 写入冒烟，revision 改变、三个 clip 保留，旧 base 经严格网关返回 409 且 bytes SHA 不变。

## 2. M2.1：EnginePort 与原生写入网关

交付实体：

- `EnginePort`：只暴露 `inspect/capabilities/plan/stage/validate/preview/render`；port 不提交、不增 revision、不改锁。
- `HypitEngineAdapter`：包装现有 `HypitAdapter`，保持旧合同和 legacy 执行入口。
- `OpenFilmAdapter`：只面向固定 SHA 的明确接口；不得裸转发任意 native operation、shell、provider 或 URL。
- `EngineBindingStore`：每项目只绑定 `hypit` 或 `openfilm`；迁移产生新副本，不改变旧项目绑定，不允许双写。
- `NativeWriteGateway`：timeline、Inspector、import、history、undo/redo、provider、CLI 每个入口必须 `translated` 或 `blocked`；未知能力默认拒绝。
- `SourceDigestV1`：摘要闭包至少包含 `film.html`、被引用 scene/html/js/css、字幕、设置、字体与引用资产内容；不能只哈希一个入口文件。

先写合同和失败用例，再写实现。M2.1 出口要求 EN-01、EN-02、EN-04、EN-06、TM-01..03 的自动化部分通过；不支持的 UI 操作需禁用并由 HTTP/CLI 绕过测试证明仍拒绝。

## 3. M2.2：一致提交、三类锁与持久任务

交付实体：

- 统一 `ProjectCoordinator`/现有 Actor 串行边界；native rebase 结果不得替代 Narralens 严格 base/source 409。
- 三类锁：visual、narration、duration；共享消费者和范围交叉必须服务端计算，锁更新与编辑进入同一项目队列。
- 不可变 snapshot、单一 active commit record、journal、outbox；reader 只读取已提交 snapshot，不能看到多文件混合 revision。
- 持久 Job/Event：`queued/running/cancel_requested/succeeded/failed/cancelled/attention`，CAS lease owner/attempt，SSE 单调 seq 与 cursor 重放。
- 取消后的晚到结果只能 quarantine；不得自动采用。费用未知不得按 0，也不得自动重试付费调用。
- 所有导出绑定已提交 snapshot；提交后事件失败只重放 outbox，不重复 commit。

M2.2 出口要求 JB-01..06 与对应 recovery/concurrency/negative tests 全绿。Job 仍为内存、commit 不确定时猜成功、或任一原生入口绕过 Coordinator 都是 NO_GO。

## 4. M2.3：副本迁移与可验证回退

交付实体：

- 只迁移已列明 fixture/项目副本；保留 manifest@2、来源/许可与旧项目 bytes，生成逐项 loss report。
- 迁移后工程保持原生多 clip 可编辑，不以扁平 MP4 冒充成功。
- 旧、新工程各自真实重开与导出；旧项目 hash 不变，新结果保留。
- 注入 scene、字幕、设置、引用资产外部修改；digest 必须变化并进入冲突/attention，不自动同步。
- 完成 crash/restart、rollback drill，并记录目标项目、旧绑定、操作者、回退步骤和输出 SHA256。

M2.3 出口为 `CONTROLLED_OPENFILM_READY`：EN-01..06、TM-01..03、JB-01..06 全部逐 case 有真实证据，旧回归保留，且只允许显式迁移副本激活 OpenFilm。新建项目默认 OpenFilm 要等 M4 可靠性闭环；旧项目不得自动迁移。

## 5. 明确禁区

- M2 不实现 M3 素材化；materialize/adopt 路由继续 404，虚构 operation 继续 422。
- 不恢复旧 D4.2.2 的顺跳开发，不引入第二份 timeline、Gemini 服务、Remotion 全片后端或插件市场。
- 不 vendoring `latest`，不覆盖/删除 Hypit，不双写，不 force push。
- 自动 UI 验证默认 Headless、静音、无窗口、不抢焦点；headed 与人类体验必须单列，不能互相冒充。
- M2 通过不等于 Gate D4.2、Gate V1-P0 或 V1-Full。

## 6. 开工顺序与停点

1. M2.1 合同/黄金向量/入口清单/失败用例审计通过。
2. M2.1 实现与逐 case 验收通过后，才进入 M2.2。
3. M2.2 的持久性和故障边界全部通过后，才进入 M2.3。
4. M2.3 真实迁移副本与回退演练通过后，才允许提出 M3 开工包。

本轮停在此处，等待下一阶段指令。
