# Claude Code 下一阶段完整提示词（Wave 1）

以下提示词授权 Claude Code 连续完成 Wave 1，即 M2.1→M2.2→M2.3。模块检查点通过后自动继续，不等待逐模块人工批准；正式审核集中在 Wave 1 组合候选。

```text
你是 Narralens Wave 1 的迁移实现负责人。仓库为 https://github.com/ljx418/Narralens。你的目标不是只完成一个小 ticket，而是在一个连续开发波次内高质量完成完整 M2：受控双适配器、持久运行时、三类锁、迁移副本与真实回退，并形成一个可独立审核的组合 commit。

【现场先核对】
报告基线：分支 migration/m1-m0-m1a，HEAD 1eec29062156356d29e5adc5016b5403a4e3002d，origin/main 304c89134fdf9f834f7d69e3f4d5c89a68044c60；D1–D4.1 历史 Gate 保留；M1A D4.2.1 已关闭；M1B 固定 OpenFilm e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3 spike 已通过；M2 尚未实现。

先只读核对完整 SHA、branch/status/remote、用户改动、源码、合同、测试和 evidence。若不一致，报告差异并保护用户工作；禁止 reset、stash、force push、覆盖或删除 legacy。

【必读】
按顺序完整读取：
1. docs/handoff-m2-m7d-claude/00_README.md
2. 13_ACCELERATED_DELIVERY_STRATEGY.md
3. 01_MASTER_ROADMAP.md
4. 02_ARCHITECTURE_L0_L1.md
5. 03_M2_M4_MODULE_DESIGN.md
6. 05_API_INTERFACE_SPEC.md
7. 06_ARCHITECTURE_CONTRACT_LOCK.md
8. 07_CODE_STANDARDS.md
9. 08_TEAM_DEVELOPMENT_WORKFLOW.md
10. 09_TEST_ACCEPTANCE_PLAN.md
11. 10_TRACEABILITY_MATRIX.md
12. 14_WORKFLOW_REGISTRY.md
13. 11_THREE_PASS_REVIEW.md

再读 docs/01_PRD.md、docs/03_Architecture.md、docs/11_V1_Traceability.md、docs/migration/M1/{CR-MIG-001.md,code-map.md,route-inventory.md}、docs/migration/M2/M2-kickoff.md，以及当前真实 route、worker/job、state/store、adapter、package scripts、tests 和 evidence。冲突按 00_README 权威层级处理；先落 ADR/差异，不静默裁决。

同时完整读取：
- docs/migration/M2/ADR-M2.1-001-contract-reconciliation.md
- docs/migration/M2/M2.1-development-and-acceptance-plan.md

这两份文件的 D-01..D-06、历史 AT/D42 编号、兼容规则、入口清单和 M2.1 具体验收义务继续有效；它们形成时的“唯一允许 M2.1 / 不进入 M2.2”是旧流程停点，已被用户最新四波次授权替代。不要修改或抹掉其历史。开工前新增一份 Wave 1 总计划/兼容补充，逐项引用这些裁决，并补齐 M2.2/M2.3 的承接关系；不得借“节奏更新”改变技术合同。

【Wave 1 推进方式】
一次性制定 Wave 1 开发/验收计划并冻结跨模块接口：EnginePort、EngineBinding、NativeMutationRegistry、TypedEdit、SourceDigestV1、SnapshotRef、CommitRecord、ProjectCoordinator、三类 Lock、Job/Event/Lease、MigrationReport。目标是让 M2.1 的接口可直接承接 M2.2/M2.3，禁止临时接口反复返工。

先打通一个最窄真实垂直链：固定 OpenFilm fixture → 受控 inspect/plan/stage/validate → immutable snapshot/commit record → restart/replay → migrate-copy/rollback。链路通后再扩展全部入口、并发和故障矩阵。

模块检查点只做增量测试、架构 fitness、受影响回归和 evidence 追加。通过后自动进入下一模块，不等待独立外审或用户批准。普通类型、编译、局部测试、可复现 race、adapter 差异由你自动修复和复验。

【M2.1：受控引擎边界】
- EnginePort 只暴露 inspect/capabilities/plan/stage/validate/preview/render；port 不 commit、不增 revision、不改锁、不接受任意 shell/path/URL。
- EngineBindingStore 强制每项目只绑定 hypit 或 openfilm；迁移创建新副本，禁止双写。
- HypitEngineAdapter 包装现有 adapter，保留所有 legacy 合同、入口和测试。
- OpenFilmAdapter 只使用固定 e70d9d... 接缝；production 不 import spikes；native rebased 不能绕 Narralens strict 409。
- NativeMutationRegistry/Gateway 覆盖 timeline trim/move/split/speed、Inspector、subtitle/audio、asset import、history/undo/redo、provider、CLI、autosave/export、file watch、rename/delete/import/template；每项 translated/blocked/read_only，unknown 默认拒绝；直接 HTTP/CLI 绕过同样拒绝。
- SourceDigestV1 覆盖 film.html、引用 scene/html/js/css、字幕、设置、字体和引用资产内容，按规范 canonical 化并提供 TS/Python 黄金向量。
- 时间使用整数半开帧和 rational fps；首门只声明已验 30/1。

M2.1 检查点：EN-01/02/04/06、TM-01/02/03 的适用自动化、contracts、架构 fitness、旧回归通过。通过后直接继续 M2.2。

【M2.2：一致提交、持久任务与三类锁】
- 在现有 ProjectWriteActor/ProjectOperationQueue/RevisionStore 上演进为唯一 ProjectCoordinator；不要建立第二 actor 或第二 timeline。
- isolated stage → validate → immutable snapshot → single active commit record；reader 只读已提交 snapshot；多文件不能混合 revision。
- journal/outbox 与 revision/idempotency 在同一持久事务；commit 后事件失败只重放 outbox，不重复 commit。
- 持久 Job/Event 状态、CAS lease owner/attempt/expiry、单调 event seq、SSE cursor replay、cancel_requested、quarantined late result、unknown cost；兼容读取 completed_after_cancel。
- visual/narration/duration 三类锁由服务端根据 TypedEdit、范围和共享消费者计算；锁更新和写入进入同一项目队列，commit 前复核 control revision。
- 导出创建时绑定 committed snapshot。

M2.2 检查点：JB-01..06、三类锁、snapshot 混读、journal 边界、并发、重启、旧回归全部通过。Job 若仍以内存为事实、commit 不确定却猜成功或 native 可绕 Coordinator，必须修复后再继续；通过后直接继续 M2.3。

【M2.3：迁移副本与可验证回退】
- 只迁移已盘点支持的 fixture/项目副本；保留旧项目 bytes、Manifest@2、来源/许可和 legacy 执行入口。
- 生成 MigrationReport：old/new ID、engine/SHA/revision/digest、stable identity map、supported/unsupported/loss、资产/字幕/声音映射、验证与回退。
- 迁移后仍为原生多 clip 可编辑项目，不以 flattened MP4 通过。
- 旧、新工程分别真实关闭重开、导出；新工程再改一镜并导出；旧项目 hash 不变。
- 注入 scene、字幕、设置、引用资产外部修改，digest 改变并进入 conflict/attention；执行 crash/restart 和 rollback drill。
- 回退是停止新写、隔离在途任务、重新激活旧配置/项目并跑旧导出；保留新结果，不用 git reset，不承诺反向自动转换。

M2.3 完成后在组合候选上重跑 EN-01..06、TM-01..03、JB-01..06、D1–M1 全量回归、TypeScript、production build、真实 OpenFilm/Hypit smoke 和安全扫描。

【M2 禁区】
整个 Wave 1 不实现 M3 materialize 或 M4 adopt；materialize/adopt 路由保持 404，虚构 adopt operation 保持 422。不得引入 Gemini、第二完整 timeline、Remotion 全片后端、插件市场，不删除 Hypit，不产生未经批准的费用/外传，不上传秘密/私有素材。

【证据与测试】
先写 schema/type/状态机/黄金向量/失败测试，再实现。逐 case 记录，禁止用“共 N tests”代替。证据统一放 docs/evidence/WAVE1/，可按 M2.1/M2.2/M2.3 分子目录，但只有一个组合 evidence manifest 和一个最终报告。记录完整 repo/upstream SHA、环境、fixture hash、真实命令、exit code、日志、断言、SHA256、失败尝试和状态。

自动 UI 全程 Headless、静音、隔离 profile、无窗口、不抢焦点，结束清理进程。headed 与人类体验标 NOT_RUN；Wave 1 不为 headed 停工。mock 只能证明局部边界，不能关闭真实 Gate。

【审查压缩规则】
M2.1/M2.2 模块结束不启动独立外审。完整 M2 组合测试通过后，做一次内部四视角审查（架构、代码、体验、验收），修复全部 BLOCKER/MAJOR，冻结一个组合 commit；再启动一次独立干净 Claude Code 会话只读外审并复跑关键 Gate。外审不可用则 REVIEW_PENDING，不能自签。

外审修复若没有改变 AC、schema major、DB 持久格式或用户承诺，只重跑受影响 case、组合 smoke 和外审复验项；若改变上述契约，重新执行 Wave 1 全量组合验收。

【自动继续与停止】
正常情况下持续工作直到 CONTROLLED_OPENFILM_READY，不在小模块完成时停下。只在以下情况停止并向用户报告：双写/第二 timeline/native 绕过；数据损坏、commit 或回退不确定；未经授权费用/外传/秘密风险；真实 Gate 连续两轮失败数没有减少；422/429/529 等外部限制；需要用户高风险选择或真实输入。

【最终出门】
Wave 1 只有在完整 M2 组合 commit 的 EN/TM/JB、旧回归、真实重启/双引擎导出、回退、内审和独立外审全部满足后才可声明 CONTROLLED_OPENFILM_READY。然后停止，不进入 Wave 2；只生成 Wave 2 开工包。

最终报告必须输出：current_wave/module_checkpoint、branch/worktree、repo/upstream full SHA、组合 commit、implemented/not implemented、逐 case PASS/FAIL/NOT_RUN、命令/exit code、evidence、AC deviations、内部/外部审查、rollback、next_allowed_wave、blocked_actions、用户动作。不得宣称 D4.2、V1-P0 或 V1-Full 完成。
```

