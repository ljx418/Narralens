# M2.1 内部审查记录

审查对象：M2.1 实现会话自身的冻结候选
审查人角色：实现会话（**不得**签署独立外审；见 §5）
审查方法：四视角自查 + 机械复验 + 变异测试，不依赖任何口头结论

## 1. 架构视角

检查：范围、契约锁、依赖方向、第二时间线、双引擎、adapter commit、跨阶段泄漏。

| 检查项 | 结论 | 证据 |
|---|---|---|
| 是否实现 M2.2/M2.3/M3/M4 实体 | 否 | 全仓仅新增一张表 `engine_binding`；无 SnapshotStore/CommitRecord/PersistentJob/LockService/Outbox/MigrationService |
| 是否新增第二份可写时间线 | 否 | `EngineProjection` 只在内存中由上游已解析文档映射，不落库、不参与写判定；`engine_binding` 存的是绑定不是影片 |
| 是否存在同项目双引擎 | 否 | `engine_binding.project_id` 主键；fitness 规则 14 + R-03 |
| adapter 是否自持 commit | 否 | `EnginePort` 恰 7 个成员且无 commit/lock 字段；fitness 规则 4 + MUT-A |
| 生产代码是否 import spikes | 否 | fitness 规则 3 + MUT-C |
| OpenFilm 是否裸转发 shell/URL | 否 | 只经 SHA 校验后的动态 `import()` 加载固定模块的三个具名导出 |
| 是否引入 Gemini / 第二 timeline / Remotion 全片后端 | 否 | 依赖未变（`package.json` 仅新增 script） |

发现并处理：

- **I-A-01 MINOR（已修）**：`EngineRegistry.resolve` 返回 `binding: EngineBinding | undefined`，
  导致 `src/host/server.ts` 使用了 `resolved.binding!` 非空断言。已把返回类型收紧为
  `EngineBinding`（`require` 必然返回），断言随之删除。
- **I-A-02 MINOR（已修）**：死代码面 `errorAlias()`、`entriesForOperations()`、`NATIVE_ENTRY_IDS`
  无任何调用点。已删除；`validateSourceDigestManifest` 原本也是死导出，已在 digest 套件中
  真正调用，使被哈希的 manifest 就是合同接受的 manifest。
- **I-A-03 MINOR（已修）**：`computeSourceDigest` 用 `Array.shift()` 遍历队列（O(n²)），
  且同一文件会被读两次（存在性预检一次、出队再一次），并且空闭包分支重复构造了两次 manifest。
  已改为游标遍历 + 读取缓存 + 单一 `build()`。

## 2. 实现视角

检查：失败路径、错误映射、清理、并发、类型严格度、可维护性。

- 所有 SourceDigestV1 失败路径均**抛出**，无部分 manifest、无静默跳过（§5.4.2 第 9 条）；
  `SOURCE_REFERENCE_UNRESOLVED` / `SOURCE_PATH_ESCAPE` / `SOURCE_REFERENCE_UNSUPPORTED` /
  `SOURCE_FILE_ROLE_UNKNOWN` 都有独立断言。
- `HttpError` 用于全部用户/协议错误；内部 cause 只入脱敏日志（`problems` 原文不进 HTTP 响应）。
- `stage()` 在复制任何文件**之前**做严格 base 校验，因此 stale base 不产生任何 I/O 副作用
  （对应断言：隔离根在拒绝后仍为空）。
- `stage()` 在 `rebased === true` 时删除暂存并抛 409，绝不视为成功。
- `tsconfig` 的 `strict` / `noUncheckedIndexedAccess` / `exactOptionalPropertyTypes` 全程开启，
  无新增 `any`、无 `@ts-ignore`、无未校验断言。

发现并处理：

- **I-I-01 MINOR（已修）**：`OpenFilmEngineAdapter.plan` 曾用 `void layout` 掩盖未使用参数。
  已改为显式校验 snapshot 归属后拒绝。
- **I-I-02 MINOR（已修）**：`HypitEngineAdapter.stage`/`sourceDigestFor` 直接用
  `descriptor.asset_manifest`，而它在类型上是可选的。已抽出 `hypitDigestRoots()`，
  缺 manifest 时按无效工程拒绝，而不是带着空洞去算摘要。

## 3. 测试与证据视角

检查：mock 是否关闭真实门、是否逐 case、是否存在永远绿的灯、证据是否可复现。

**关键发现（本次最有价值的一条）**：

- **I-T-01 MAJOR（已修）**：变异测试第一轮暴露**变异工具自身有 bug** —— 写回时先
  `open(path,"w")` 截断再 `read()`，等于把文件清空。因此前几轮「门会失败」的结论是假阳性。
  修正后重跑，得到真实结果。
- **I-T-02 MAJOR（已修）**：修正工具后再跑，暴露两处**真实的覆盖缺口**：
  (a) fixture 里没有任何「Host 已登记但 film.html 未引用」的资产，所以声明资产路径未被覆盖；
  (b) fixture 里所有资产的发现顺序恰好与路径顺序相同，所以「assets 保语义顺序、只排序 files」
      这条规则实际上无法被任何测试观察到。已补 `registered-only.m4a` 与
      `aaa-narration-alt.m4a`，并补对应断言。
- **I-T-03 MINOR（已修）**：`stage()` 的 stale base 拒绝此前只由真实上游探针覆盖，
  没有任何 vitest 套件覆盖。已补两条单元级用例（stale base 拒绝且隔离根为空；
  上游 `rebased:true` 永不被接受）。
- **I-T-04 MINOR（已修）**：`contracts.test.ts` 的合同数量断言由 `toHaveLength(18)` 更新为 20。
  为避免「改数字即弱化」，同时把 18 个历史 schema id 逐个断言，历史集合不得静默缩小。

Mock 使用情况（逐条声明）：

- 仅 `tests/m2.1/engine-port.test.ts` 的两条 OpenFilm 单元用例使用进程内 upstream stub，
  它们只证明**单元边界**（stale base 逻辑、rebased 拒绝逻辑），标为 `schema_unit`，
  **不关闭任何真实门**。
- 真实 Gate 的证据来自：`corepack pnpm check`（真实 Vitest + 真实 HTTP server + 真实 SQLite）、
  Python 标准库跨语言复算、以及固定 `e70d9d93...` 的真实上游探针。
- 无 `skip` / `todo` / `only`；无被删除或弱化的旧测试（134 条 D2–D4.2.1 回归保持通过）。

变异测试结果（`tools/m2.1-gate-mutation-check.sh`，6/6 门均会失败）：

| 用例 | 注入的违规 | 拥有该门的套件 |
|---|---|---|
| MUT-A | adapter 增加 `commit()` | fitness 规则 4 |
| MUT-B | registry 条目声明 `policy: "unknown"` | registry 完整性 |
| MUT-C | 生产代码 import spike | fitness 规则 3 |
| MUT-D | 摘要静默跳过已声明资产 | 闭包完整性 |
| MUT-E | 摘要对 assets 排序 | 顺序规则 |
| MUT-F | `stage()` 去掉严格 base 校验 | AC-004 |

## 4. 验收与声明视角

检查：出门声明是否越界、遗留编号是否被吞、限制是否如实。

发现并处理：

- **I-A-04 MAJOR（已修）**：初版证据与报告存在**过度声明**风险 —— 容易被读成
  「所有写入口已在网关后强制治理」。事实是：M2.1 完成**登记与判定**，但网关**尚未**位于
  任何生产写路由之前，因为本 ticket 未新开写路由；唯一存在的
  `POST /api/projects/:id/edits` 在 M2.1 之前就已由 `ProjectWriteActor` 独占提交。
  已写入 **ADR D-12**，并在计划 §12、evidence manifest `claim_limits` 中同样声明。
- **I-A-05 MINOR（已修）**：历史编号 `AT-PREVIEW-01` / `AT-SELECTION-01` / `AT-SEC-01` /
  `AT-CONTRACT-01` / `AT-E2E-01` 与新编号并列记录在 evidence manifest 的
  `historical_ids` 中，未被新编号替换（ADR D-04）。
- 声明上限锁定为 `M2_1_CONTROL_BOUNDARY_READY`。明确**未**宣称：M2 完成、Gate D4.2、
  `Gate V1-P0`、`V1-Full`。

## 5. 内部审查结论

- BLOCKER = 0
- MAJOR = 0（I-T-01、I-T-02、I-A-04 均已修复并复验）
- MINOR = 6（I-A-01/02/03、I-I-01/02、I-T-03/04，均已处置）

**实现层结论：PASS，可提交冻结候选。**

本记录由实现会话签署。独立外审**未**由本会话执行，evidence manifest 中
`review.external` 保持 `REVIEW_PENDING`，直到独立只读会话给出结论。

## 6. 残余风险（交由外审与用户判断）

1. `vendor/openfilm` 未登记为 submodule，正式纳入生产需用户批准与独立 ADR/ticket。
2. 网关的生产强制点在 M2.2/M4A 才生效（ADR D-12）。
3. 三类锁、snapshot commit、持久 Job 全部未实现，Job 仍是内存态。
4. headed 与人类体验 `NOT_RUN`；本 ticket 无任何 UI 自动化。
5. 迁移副本注入演练与回退属 M2.3。
6. 交接包内新出现的 `13_ACCELERATED_DELIVERY_STRATEGY.md`（Wave 1 = M2 全部）与本次会话
   「唯一允许范围 M2.1」的指令冲突，已记录在计划 §1.3，等待用户裁决。
