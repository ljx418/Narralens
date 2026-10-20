# Claude Code 交接：M4B 受控采用

以下正文可直接交给全新 Claude Code 会话。开工前把占位 SHA 替换为最终 M4A 外审封存 HEAD；若本文已经由
Codex 完成替换，则不得自行改回旧 SHA。

---

你是本地 Narralens 仓库 M4B 的实施负责人。请在现有分支增量实现，不新建替代项目、不重写已通过模块、
不 reset/stash/丢弃用户工作、不 force push。除需人工高风险决策外自动连续完成 M4B-0→M4B-5；模块检查点
不停止、不请求外审。最终只停在 Codex 独立复核点。

## 先核对，不把报告当事实

仓库：`/mnt/c/workspace/videoworkline/Narralens`

- 预期分支：`migration/m2.2-coordinator-persistence`
- M4A 外审封存 HEAD：`__M4A_EXTERNAL_REVIEW_HEAD__`
- origin/main：`304c89134fdf9f834f7d69e3f4d5c89a68044c60`
- OpenFilm 固定上游：`e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3`

先输出完整 SHA、branch、status、remote 与分叉点。工作树不干净或 SHA 不符时保留用户工作，列差异后继续可安全
部分；禁止 reset 到任何报告中的旧提交。

按顺序完整阅读：

1. `docs/migration/WAVE2/00_READ_FIRST.md`
2. `docs/migration/WAVE2/02_ARCHITECTURE_AND_CONTRACTS.md`
3. `docs/migration/WAVE2/03_DEVELOPMENT_AND_ACCEPTANCE_PLAN.md`
4. `docs/migration/WAVE2/12_M4B_DEVELOPMENT_GATE.md`（本轮直接权威）
5. `docs/migration/WAVE2/11_M4B_CONTROLLED_ADOPTION.html` 与 `.sequence.json`
6. `docs/migration/WAVE2/ADR-W2.0-004-m4a-impact-request-and-consumer-graph.md`
7. `docs/evidence/WAVE2/reviews/m4a-external-review-claude.md`
8. 当前 `docs/03_Architecture.md`、`docs/11_V1_Traceability.md`
9. 实际 ProjectCoordinator、RevisionStore、SnapshotStore、ImpactService、MaterializeService、LockService、
   EnginePort、NativeWriteGateway/registry/capability、OpenFilm adapter、route/validator/schema 和全部 M4A case/evidence。

如旧文与 `12_M4B_DEVELOPMENT_GATE.md` 冲突，先记录差异；不得静默裁决。只有会改变产品权威/数据模型的冲突才
停给人类，普通实现细节按最新门文档执行。

## 唯一允许范围

只实现 `adopt_materialization`：

- `AdoptRequestV1` versioned route；
- AdoptionCoordinator；
- ProjectCoordinator 内部 controlled-write 原语；
- OpenFilm adopt capability/registry/gateway translator 与固定 plan/stage/validate；
- Host-only `AuthorSourcePublisher`；
- snapshot/journal/recovery；
- 单事务 revision/pointer/ledger/impact consumed/idempotency/outbox；
- 真实三镜采用、重开与改单镜证据。

禁止 M4C restore、M5 UI、M6 正式 render、provider/联网/付费/外传、读取 `J:\`、开放任意 native op、修改
legacy `ProjectWriteActor` 行为或使用 proxy/flattened MP4 作为 author source。

## 不可协商架构

1. EnginePort 仍恰好 7 方法；adapter 无 commit/publish 权；Host 是唯一 revision/lock/transaction 权威。
2. 整个 adopt 位于既有 `ProjectOperationQueue`；所有会过期的检查必须在队列内，commit 前再次执行。
3. M4A impact 只能通过 `ImpactService.requireCurrent()` 消费；不得只看 stored active flag。
4. materialization 必须走 `MaterializeService.read()`，不得 raw store 绕过 ledger/rights/source drift。
5. HTTP `AdoptRequestV1` 不携带 native plan。按开发门 §3.1 新增 server-only `EnginePlanIntent`：Coordinator
   在重验后注入 `NativePlanV1/rights_digest/impact_hash`，adapter 不得依赖 Host store 或客户端 ops；
6. active source 只允许新增内容寻址 asset 与同目录原子替换 `film.html`：新 asset 先 no-clobber 安装并验 hash/fsync，
   film temp 验 hash/fsync 后 rename + parent fsync。禁止递归覆盖 active root。
7. SnapshotStore 先从 staged source 发布 immutable snapshot；active film publish 后再由 pinned adapter inspect；DB
   commit 只能在两者与批准 impact 一致时发生。
8. `RevisionStore.commitAdoption` 一个 `BEGIN IMMEDIATE` 同时完成 revision 恰好 +1、active pointer、ledger 新引用、
   impact active→consumed CAS、唯一 operation idempotency 完整 response、outbox 与 transaction committed。
9. 同 kind/key/digest 重放不得再次 stage/publish；异 digest 409。失败 revision +0。
10. rebased=true、未知 upstream field/op、projection problems、三 clip/总帧/identity/consumer 不变量不成立均 fail closed。
11. 恢复只能由 before/after bytes、snapshot、journal、DB 权威事实判定；不确定即 attention，禁止猜成功。

## 实施顺序

### M4B-0 合同与红灯

先新增会在旧实现失败的 tests/fitness：route 仍 404、capability blocked、raw store 绕过、缺 impact/approval、
非原子 commit、source publish 竞态、三 clip 未采用。冻结 journal/commitAdoption/AuthorSourcePublisher 接口，运行
合同门。不要先写生产实现再补“会通过”的测试。

### M4B-1 OpenFilm 受控写

registry/capability/gateway 必须同一子阶段开放且 default deny 保持。adapter.plan 只接收服务端
`adopt_materialization`，从已重验 NativePlanV1 生成固定 ops；stage 只写 Host isolated root；validate 用固定上游
重读并证明三 clip、frame ranges、assets、total frames、narration/subtitle/audio/neighbours 与 source digest 闭包。

### M4B-2 source publisher / recovery

实现 `AuthorSourcePublisher` 白名单 diff、realpath containment、no-clobber asset install、hash/fsync、film 同目录
rename、active re-inspect。覆盖 received 到 response 的全部故障点；film before→abort/retry，film after+可证明→
幂等完成 commit，其余 attention。旧 bytes/snapshot/history 不删。

### M4B-3 coordinator / route

AdoptionCoordinator 只编排，不自建 commit 权威。ProjectCoordinator controlled-write 持项目队列并复用现有状态机。
路由原样验证 `AdoptRequestV1`；auth/origin 在资源查找前；跨项目与不存在资源同 404；错误优先级按门文档。

### M4B-4 真实链与并发

使用仓库固定无隐私三镜 fixture、已保存 D4.1 输出离线重放、真实 materialize/impact/adopt。证明：双采用仅一
commit；同 key 重放零二次 stage；stage 期间 lock/source/rights/active commit 漂移拒绝；采用后三个原生 clip；
关闭重开仍可 inspect；修改中镜后两侧 clip identity 不变；真实上游渲染/完整 decode 与帧数符合批准 impact。

### M4B-5 证据与冻结

逐项关闭 TX-01/02/03/04/05/06/07/08B/11B/13/14、M4B-NW、REG。做架构、实现与并发、完整体验与安全、
测试验收四个独立视角内审，修复全部 BLOCKER/MAJOR。冻结 clean capture commit 后追加式捕获，不覆盖 M4A、
失败捕获或历史证据。实现会话不得自签外审。

## 测试硬约束

- 自动化全部 headless、静音、隔离、无窗口、不抢焦点；不启动 headed Chrome；
- 不放宽 timeout/assertion，不删除/跳过旧测试，不用总测试数替代逐 case；
- 每个关键负向测试须说明旧实现为何失败；对 gateway、final recheck、CAS、source publish、impact consume 做变异门；
- 真实文件/SQLite/upstream/media 不能全被 mock 替代；组件 seam 与生产 route seam 分开标注；
- 保留并执行旧门；`wave1:integrity` 的历史 exit 1 原样记录，使用 `wave1:historical` 验证冻结树，不调绿。

最低命令：

```bash
corepack pnpm exec tsc --noEmit
corepack pnpm test:contracts
corepack pnpm test:m2.1
corepack pnpm test:wave2:w2.0
corepack pnpm test:wave2:m3
corepack pnpm test:wave2:m4a
corepack pnpm test:wave2:m4b
corepack pnpm test:wave2:fitness
corepack pnpm check
corepack pnpm check
corepack pnpm build
corepack pnpm evidence:wave1:historical
corepack pnpm evidence:wave2:m4a:historical
corepack pnpm evidence:wave2:m4b:integrity
```

M4B-0 必须先增加 `evidence:wave2:m4a:historical`，从 M4A capture commit 的 tree 校验其证据与当时 route；M4B
打开 edits 后，current-tip `evidence:wave2:m4a:integrity` 预期因代码/route 合法移动而非零，需原样记录，禁止调绿。

## 停止与报告

普通红灯、可复现竞态、文档同步、内部审查意见自动修复；不要在子模块间停。仅在需要人工高风险产品/数据裁决
或 M4B 全部完成并冻结到 Codex 独立复核点时停止。服务器 422/429/529 中断时保留现场和未完成状态，不把中断
当 PASS。

最终报告必须给出：完整 repo/upstream/origin SHA、分支/clean 状态、提交序列、逐 case PASS/FAIL/NOT_RUN、
实际命令/exit/计数、真实媒体与 snapshot SHA256、故障矩阵、source/revision/ledger/impact/outbox 差异、四视角
内审、证据路径、回退方式、已知边界与唯一下一允许 ticket。最高声明 `M4B_INTERNAL_EVIDENCED`；不得声明 M4C、
Wave 2 完成、Gate D4.2、V1-P0、V1-Full、headed/human 已验。
