# M4C 独立外部审查（Codex）

审查日期：2026-10-25  
审查对象分支：`migration/m2.2-coordinator-persistence`  
冻结候选：`62b804e8f6beab1d1dc2676fdcc4b0ce86881e4d`  
证据捕获提交：`b7242eab1c402e60351c920872db8683ec68f90a`  
审查结论：**NOT PASS — BLOCKER=1 / MAJOR=5**

本文件是独立只读外审结论，不是实现会话自签。审查期间未修改生产代码、合同、测试或既有证据，也未进入 M4D/M5。

## 1. 结论摘要

M4C 已形成较完整的历史读取、restore、undo/redo 翻译、原子提交和真实媒体回归链；候选中的 M4C 专项测试、证据完整性门和架构 fitness 在本次独立复跑中全部通过。但这些绿灯不能支持 `M4C_EXTERNAL_REVIEW_PASS`：

1. 历史 snapshot 的 `source/` 可以是指向项目目录外的符号链接，resolver 会读取并接受外部字节。这是恢复权威边界逃逸，属于 BLOCKER。
2. redo 没有确认“当前 commit 就是 restore”，会在 restore 后又发生采用/编辑时继续返回过期 redo 目标。
3. restore plan 对 clip 边界变化没有生成冻结 ADR 要求的 `visual project` 锁。
4. 生产 `HistoryRestorePlanV1` 与已锁定 ADR 的接口形态不一致，且没有架构偏差裁决。
5. 崩溃与 NOWRITE 证据没有覆盖冻结门要求的逐边界故障矩阵，却把相关 case 记为关闭。
6. 三份权威项目文档仍写着 M4C 未实现、history route 404，违反 M4C-6 的同步出门条件。

因此当前最高可信声明保持为 `M4C_INTERNAL_EVIDENCED`；M4C 外审、Wave 2 组合外审、`WAVE2_EDITABLE_ADOPTION_READY`、Gate D4.2、V1-P0、V1-Full、M5/M6、headed/human 均不得声明通过。

## 2. 独立验证范围与结果

本次从干净工作树核对了 branch、完整 SHA、capture commit、M4B 第十轮外审结论、M4C manifest/case/review、ADR、开发门、生产实现与测试。

独立执行：

```text
corepack pnpm test:wave2:m4c
  PASS — 5 files / 54 tests

corepack pnpm evidence:wave2:m4c:integrity
  PASS — 20 checks

corepack pnpm test:wave2:fitness
  PASS — 3 files / 45 tests
```

证据捕获中的 `pnpm check` 为 81 files / 970 tests 全绿，且 M4C 真实媒体链记录了固定上游 render/decode 900 帧。本次没有在发现决定性 BLOCKER 后再次消耗资源重跑整个 `pnpm check`，所以该全量结果只记为“捕获证据已核对”，不冒充本审查会话独立复跑。

完整性门证明 manifest、日志、case、向量和声明之间自洽；它不证明测试集合已覆盖冻结规格，也不能推翻下列可独立复现的实现缺陷。

## 3. 阻塞与重大问题

### B-01：snapshot `source/` 符号链接可逃逸项目根目录

严重度：**BLOCKER**  
涉及：`src/host/history/historical-snapshot-resolver.ts:184-207`、M4C-03、ADR D-02

`#sourceDirectory()` 对 snapshot 根目录做了 `realpath` 和项目根 containment 检查，但随后只执行：

```ts
const source = join(canonical, "source");
const info = await stat(source);
return source;
```

`stat()` 会跟随 `source` 符号链接；代码没有再对 source 本身执行 `realpath`，也没有确认 canonical source 仍位于 canonical snapshot 根内。后续 source digest 把逃逸后的外部目录当作自己的 root，因此其内部 containment 检查仍会通过。

本次用临时目录构造 `snapshotRoot/source -> outsideDir`，为 outsideDir 生成匹配 digest，并提供同项目 committed snapshot/projection fact。resolver 成功返回了 snapshot 下的表面路径，而实际读取的是 outsideDir 字节；没有 fail closed。

影响：攻击者或异常磁盘状态可以让“恢复历史快照”读取项目 snapshot 权威域外的文件，并把这些字节带入受控恢复链。这直接违反“不得恢复外部目录/任意用户路径”和 M4C-03 的逃逸负向门。

必须修复：对 `source` 使用 `lstat`/`realpath` 的明确策略，并验证 canonical source 位于 canonical snapshot root 内；目录树中每个实际读取项仍须保持既有 root containment。补充真实 symlink/junction 负向测试，断言 revision/source/pointer/impact/outbox/idempotency 均无越权写入。

### M-01：redo 使用“最近一次 restore”，而不是“当前 commit 是 restore”

严重度：**MAJOR**  
涉及：`src/host/history/history-store.ts:254-272`、ADR D-08、开发门 §3.4

`redoTarget()` 扫描项目的全部 transaction，选择最近的 committed history transaction。它没有读取并证明当前 active commit/transaction 就是该 restore。

因此路径“restore A → adoption/edit B → redo”仍会返回 A 的 `source_before_snapshot_id`。冻结合同要求 redo 仅在当前 commit 是 restore 时成立，否则必须 422 fail closed。现有测试只覆盖“从未 restore 时 redo 422”和“restore 后立刻 redo”，没有覆盖中间插入新的 committed 写事务。

必须修复：从当前 committed revision/pointer 唯一解析当前 transaction，并要求该 transaction 为 committed history restore 且 fact 一致；增加 restore 后 adoption/edit 再 redo 的生产路由测试，预期 422、revision +0。

### M-02：边界/时长变化缺少 `visual project` 锁

严重度：**MAJOR**  
涉及：`src/host/history/history-restore-plan.ts:319-407`、ADR D-04、TX-03C

冻结 ADR 要求 clip 增删、重排、边界或总帧数变化同时生成 `visual project + duration project`。当前实现对 visual clip 变化生成 `visual shot`，range 变化再生成 `duration shot`；只有整体 visual extent 变化时生成 `duration project`，从不生成 `visual project`。

独立构造同一 visual clip 从 `[0,10)` 变为 `[0,12)` 的 plan，实际锁为：

```text
duration/project + duration/shot + visual/shot
```

缺少冻结规格要求的 `visual/project`。即使当前 LockService 的匹配算法可能让某些 project lock 偶然阻挡 shot candidate，canonical plan/hash 和审计事实仍没有表达必需锁范围，不能以运行时偶合替代合同。

必须修复：按 D-04 明确生成 project-scope visual/duration locks，并为边界、重排、增删、总帧变化分别加正反用例；若产品决定改变锁模型，必须先正式修订 ADR、开发门、向量和验收 case，不能静默偏离。

### M-03：`HistoryRestorePlanV1` 与冻结接口不一致

严重度：**MAJOR**  
涉及：`src/host/history/history-restore-plan.ts:62-90`、ADR D-03

ADR 锁定的 plan 包含 `current_projection_sha256`、`target_projection_sha256`、`affected_ranges`、`affected_consumers`、`target_roots`、`target_subtitles`、`target_frame_count` 等字段。生产类型改为 `current_source_digest`、`target_source_digest`、`entry_root`、`roots`、`assets`、`subtitles`、`clips`、`consumers` 等不同形态。

新形态可能携带更多细节，但没有落盘的偏差裁决证明它与冻结合同等价；尤其 affected ranges 是在 plan 之外由 RestorePlanner 再计算，冻结接口所承诺的“真实影响范围受 plan hash 绑定”不再按原合同直接成立。

必须修复：选择并只保留一个权威合同。要么让实现符合 ADR；要么先形成明确 ADR supersession，逐字段说明等价性、删改原因和安全影响，然后同步开发门、TS/schema/validator、双实现黄金向量、impact hash 与完整性门。不得只修改文档字面量让现有实现被动变绿。

### M-04：崩溃矩阵与 M4C-17 证据不足且存在过度声明

严重度：**MAJOR**  
涉及：`src/host/history/history-service.ts:65-68`、`tests/wave2/m4c/history-crash-and-race.test.ts`、开发门 §6、TX-08C、M4C-17

冻结门至少要求 stage copy 中/后、snapshot publish 前/后、asset install 前/后、film temp fsync 后、rename 前/后、active inspect 后、数据库 transaction 各语句前/后、response 前等边界，并对每条失败路径记录 source/revision/pointer/impact/outbox/idempotency/temp/snapshot 差异。

当前 service 只有 11 个较粗 fault seam；测试主要覆盖 6 个 publish 前 service seam、`after_prepared` 和 `after_published`。没有 M4C publisher 的 fsync/rename/asset-install 边界注入，没有逐 DB statement 故障注入，没有 response-before 故障，也没有完整 active-inspect crash 矩阵。

此外，M4C-17 的代表性失败发生在 transaction 创建之前，测试没有断言 idempotency row，却把“每个失败路径”以及 failure idempotency 差异整体记为已证明。当前证据最多证明选定边界的子集，不足以关闭 TX-08C/M4C-17。

必须修复：按冻结表生成可枚举 fault-point registry，逐项注入并输出结构化 before/after facts；测试和 case manifest 必须一一映射，不得用少量代表用例替代“每个边界”。无法或不应支持的边界需先形成批准的合同变更，而不是标绿。

### M-05：权威架构、追踪与路由清单仍停留在“M4C 未实现”

严重度：**MAJOR**  
涉及：`docs/03_Architecture.md`、`docs/11_V1_Traceability.md`、`docs/migration/M1/route-inventory.md`、M4C-6

三份权威文档仍分别声明 M4C 生产实现未开始、history restore 未实现/404、M4B 外审待签；从 M4C 开工基线到冻结候选，这三份文件没有同步变更。这与真实路由和 M4B 第十轮外审 PASS 不一致，也直接违反开发门 §7 M4C-6 的“同步 architecture/traceability/route inventory”要求。

必须修复：仅按真实实现和本轮 NOT PASS 状态同步文档。应写明 M4B 外审 PASS、M4C 已实现但外审返修中、实际 route/contract/限制、未关闭 case 和禁止声明；不能提前写 M4C PASS、Wave 2 ready 或 Gate D4.2 关闭。

## 4. 复审后的准入门

下一次 M4C 候选只有在以下条件全部满足后，才值得重新提交独立外审：

1. B-01 有真实 symlink/junction 逃逸负向回归，并证明零越权写入。
2. redo current-commit 语义有 restore→adopt/edit→redo 的路由级负向测试。
3. 三类锁与冻结 ADR 完全一致，或已完成正式、可审计的 ADR supersession。
4. plan 的唯一权威 shape 被合同、实现、向量、impact hash 和文档共同锁定。
5. §6 的每个 fault point 都有直接映射；TX-08C/M4C-17 不再用子集冒充全集。
6. architecture、traceability、route inventory 同步到真实状态。
7. M4C 专项、contracts、M2/M3/M4A/M4B 回归、fitness、build、凭据扫描和全量 check 在干净 capture commit 上通过；失败捕获保留，不覆盖历史证据。
8. 新冻结 commit 后由独立会话重新审查；实现会话不得自签。

## 5. 声明与下一步

本轮结论为 `M4C_EXTERNAL_REVIEW_NOT_PASS`。允许的下一动作仅是 M4C 定向返修、重新内部审查、干净重捕获和再次独立外审。禁止进入 M4D/M5，禁止声明 Wave 2 组合通过、`WAVE2_EDITABLE_ADOPTION_READY`、Gate D4.2、V1-P0 或 V1-Full。

