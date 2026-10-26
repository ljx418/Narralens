# Wave 2 开发与验收计划

状态：`M4C_EXTERNAL_REVIEW_PASS`（M3/M4A/M4B/M4C 单模块门已关闭；Wave 2 组合冻结与独立组合外审待执行）
执行模式：一个波次连续实现，模块检查点自动继续，波次末一次组合内审和一次独立外审。

## 1. 提交与依赖顺序

### W2.0 激活兼容层、合同与红灯门

交付：`ProjectResolver`/`ActivatedProjectView`、OpenFilm port composition、`MigratedAssetLedger` bootstrap、
`AssetInventoryPort`；runtime JSON Schema、TS 类型、validator、错误码 alias、route registry、DB migration plan、
测试夹具。所有新路由仍 404。先新增会失败的 resolver/asset lineage/contract/fitness/state-machine tests，再实现。

出门：terminal target 关闭重开仍可解析，非 terminal/越界 root/缺 binding/缺 commit/账本不唯一均 fail closed；
旧目标 bootstrap 不改 source/revision/commit，新 migration 可原子播种；schema/type/validator 同步；EnginePort
仍恰好七方法；legacy contracts 全绿；旧数据库可打开。

### M3.1 持久模型与 BindingService

交付：`MaterializationStore` 新表、受控 `job` 表前向迁移、`materialize` Job kind、binding validator、canonical
request digest、幂等冲突。只读取 target-owned D4.1 proposal 和 `AssetInventoryPort`；comparison/project 不同即拒绝。

出门：MT-01、MT-04 persistence 子集；source/revision/commit/binding/manifest 不变。

### M3.2 NativePlanBuilder 与 proxy worker

交付：三个稳定 clip spec、lineage、固定 ffmpeg argv/profile、专属内容寻址 artifact root、owner+attempt
lease、并发 2、同项目 1、120 秒单 segment timeout、清理与 quarantine。

出门：MT-02/03/06；真实 MP4 完整 decode、帧数与首末帧验证；不以 JSON/mock 替代媒体证据。

### M3.3 路由、stale、取消与恢复

交付：POST materialize、GET materialization、worker 启动恢复、cancel/late callback、读取时复核当前性；
ready 只在 plan/proxy/lineage/rights 全绿后出现。

出门：PR-01..03、MT-04/05；M3 全部 case `INTERNAL_EVIDENCED` 后自动进入 M4A，不做模块外审。

### M4A ImpactService

交付：ConsumerGraph、ImpactStore、canonical hash/黄金向量、15 分钟 TTL、impact route、锁/rights/base/current
recheck；无工程副作用。

出门：TX-01..05 的 impact/lock/stale 子集；impact hash TS/Python 或第二独立实现互校。

### M4B AdoptionCoordinator

交付：`adopt_materialization` TypedEdit、OpenFilm capability/plan/stage/validate、controlled write 内部原语、
versioned edits route、operation idempotency、snapshot/commit/outbox。legacy executeEdit 不重写。

出门：TX-03..08、TX-11..14 适用部分；成功恰好 +1，失败 0，三 clip 保持独立。

### M4C HistoryService

直接权威：`ADR-W2.0-006-m4c-history-restore.md` 与 `17_M4C_DEVELOPMENT_GATE.md`。

交付：M4B 独立外审前置；`HistoricalSnapshotResolver`、`HistoryRestorePlanV1`、restore impact、精确 consumer/
三类锁、`HistoryStore/HistoryService`、restore route、native history restore/undo/redo translation、当前策略重新计算
rights/impact、content-addressed snapshot 引用、revision 恰好 +1、取消晚到不采用、专用启动恢复。内容相同允许复用
旧 snapshot id，但必须创建新 transaction/commit/revision，禁止指针回拨。

出门：`17_M4C_DEVELOPMENT_GATE.md` §8 的 20 个 case；旧 snapshot 内容可恢复但 revision 只增不减。
TX-12C 只证明 snapshot-bound input immutable，生产 render 仍由 M6 关闭。

### Wave 2 组合冻结

同步主架构/追踪/route inventory/工作流登记册；完整捕获全部门；四视角内部审查关闭 BLOCKER/MAJOR；
冻结组合代码提交；独立只读会话复跑关键门并审查声明边界。修复后生成新冻结点，不覆盖旧证据。

## 2. 逐 case 验收矩阵

| Case | 自动层级 | 必须直接证明 | 失败门限 |
|---|---|---|---|
| PR-01 | integration | 记录的真实 D4.1 runner output 在目标投影上经正常 adapter 离线重放，3–6 proposal 均为 target-owned 且可读取/绑定；记录双端 SHA lineage；不重新调用 Claude/产生费用 | 改写 project_id、跨项目读取或任一新 provider 调用 |
| PR-02 | integration/NOWRITE | 比较、试听、materialize 不改 source/revision/binding/active asset ledger | 任一前后摘要变化 |
| PR-03 | fitness/negative | 第二 timeline、未知 asset、越界/重复 binding、锁定范围变化拒绝 | fail-open |
| MT-01 | HTTP/media | rights/hash/MIME/帧长/source span 重读；短素材拒绝 | 自动 loop/freeze/speed |
| MT-02 | real media/native inspect | 三候选 proxy；三镜 plan 恰三个稳定独立 clip | 单 composite 冒充 native plan |
| MT-03 | schema/hash | 每个 output 可追到 input asset bytes/span/rights/tool profile | lineage 缺失或可篡改 |
| MT-04 | DB/filesystem diff | M3 source/revision/active commit/binding/active asset ledger 全 NOWRITE | 任一 author 事实变化 |
| MT-05 | restart/fault | 取消、晚到、失 lease、重启、asset/rights/base/control 变化 → quarantine/stale | 晚到 ready/adopt |
| MT-06 | ffprobe/frame sample | proxy 总帧、每段边界、首末帧、split 与 clip 时长精确 | 只看容器存在 |
| TX-01 | HTTP | 缺 impact 返回 428 `IMPACT_REQUIRED` | 进入 stage |
| TX-02 | hash/clock | impact 篡改/过期/current facts 变化返回 428 `IMPACT_STALE` | 接受客户端 impact |
| TX-03 | concurrency | adopt 的 visual 锁、restore 中真实变化的 narration 锁命中后 423 | 只看 preserve 或无差别过度阻塞 |
| TX-04 | graph/lock | clip 边界变化的 duration 及 shared subtitle/audio/transition consumer 被完整分类 | 少算消费者 |
| TX-05 | HTTP/upstream | stale base/source/control 409；OpenFilm rebased 不绕过 | revision 增加 |
| TX-06 | concurrency | 双采用仅一个 commit，另一方 replay 或 409 | 双 revision/混合 source |
| TX-07 | idempotency | 同 kind/key/digest 完整重放；不同 digest 409 | 第二次 stage/commit |
| TX-08B | M4B crash matrix | 每个 adopt journal 边界由专用恢复先于通用恢复，收敛为 aborted/committed/terminal attention | 猜成功/孤儿 running/recovering |
| TX-09 | history | 恢复旧内容产生当前 revision+1，历史不删 | revision 倒退/换指针 |
| TX-10 | bypass | native undo/redo/restore 只能 translation 或拒绝 | 裸 native write |
| TX-11B | real harness render | 采用后由测试 harness 调固定上游 renderer 并完整 decode；不开放 M6 生产 render route | 只测 fixture JSON/proxy，或偷开生产 render |
| TX-12 | concurrency | 在途导出绑定 committed snapshot，新 revision 不改变其输入 | render latest |
| TX-13 | race | lock/external source/rights 在 stage 期间变化，commit 前复核阻止 | TOCTOU 成功 |
| TX-14 | native inspect | 采用后仍三个原生 clip，可独立修改中镜且两侧 identity 不变 | flattened MP4 |
| M4B-NW | failure diff | 每个失败路径 source/revision/pointer/ledger/impact/idempotency/outbox 与允许残留逐项记录 | 不实 NOWRITE |
| REG | full regression | Wave 1、D1–D4.2.1、legacy routes/contracts 全绿 | 删除/弱化旧测试 |

W2.0 另设不可合并为总数的兼容门：`ACT-01` terminal migration 重启解析；`ACT-02` 非 terminal、root escape、
binding/commit 缺失拒绝；`ASSET-01` 旧目标 ledger bootstrap 验证 source tree digest、输入一一对应且 NOWRITE；`ASSET-02` 映射歧义、
source manifest/target bytes/license 变化进入 attention；`ASSET-03` 新 migration 激活与 ledger 原子同成败。

## 3. 故障注入边界

M3：job create 后、lease 后、每个 segment 前后、proxy fsync/rename 前后、lineage 保存前后、ready 前、
cancel 前后、callback 晚到。M4：impact 保存前后、transaction received、stage 后、validate 后、snapshot
rename 后、prepared、commit DB 前/后、outbox 前/后、history stage 前/后。

每点必须证明清理 inventory：临时文件、lease、quarantine、immutable artifact、snapshot、transaction、
impact state、outbox。无法判断发布状态即 attention，禁止猜测 abort/commit。

## 4. 实际命令合同

实现阶段应新增并真实执行，名称可保持下列约定：

```bash
corepack pnpm check
corepack pnpm test:contracts
corepack pnpm test:m2.1
corepack pnpm test:wave2:w2.0
corepack pnpm test:wave2:m3
corepack pnpm test:wave2:m4a
corepack pnpm test:wave2:m4b # M4B 实现时新增
corepack pnpm test:wave2:m4c # M4C 实现时新增
corepack pnpm test:wave2:fitness
corepack pnpm evidence:wave1:historical
corepack pnpm evidence:wave1:integrity # current-tip 历史门预期非零，原样保存
corepack pnpm evidence:wave2:m4a:historical # M4B-0 新增
corepack pnpm evidence:wave2:m4a:integrity # M4B 开路由后预期非零，原样保存
corepack pnpm evidence:wave2:m4b # M4B 实现时新增并生成主捕获
corepack pnpm evidence:wave2:m4b:integrity # M4B 实现时新增
corepack pnpm evidence:wave2:m4b:historical # M4C-0 新增
corepack pnpm evidence:wave2:m4c # M4C 实现时新增
corepack pnpm evidence:wave2:m4c:integrity # M4C 实现时新增
```

若 script 尚不存在，W2.0 新增后再运行，不得在报告中把计划命令写成已执行。真实媒体另记录固定 argv、
ffmpeg/ffprobe 版本、exit code、完整 decode、帧样本和产物 SHA256。

## 5. Evidence 布局

```text
docs/evidence/WAVE2/
  evidence-manifest.json
  logs/<capture-sha>/*.cmd|*.txt|*.exit
  cases/PR-*.json
  cases/MT-*.json
  cases/TX-*.json
  artifacts/<sha256-owned-files>
  security/credential-scan.json
  reviews/internal-review.md
  reviews/external-review.md
```

manifest 记录 full repo/upstream SHA、工作树、环境、fixture hash、命令、exit、断言、artifact SHA、case
状态和声明边界。捕获目录只追加不覆盖；失败日志保留。外审绑定冻结 commit，不能由实现会话自签。

## 6. Headless、headed 与人工

- 自动浏览器测试全部 Headless、静音、隔离 profile、无窗口、不抢焦点，结束清理进程；
- 本波核心能力可由 API、真实 OpenFilm upstream、真实媒体和 Headless 证明；
- headed/human 默认 `NOT_RUN`，不阻止技术 Gate，但不得宣称 M5 用户体验已验；
- 若测试必须弹窗或抢焦点，停止该 case 并改技术路线，不自行开启可见窗口。

## 7. 回归与声明门

BLOCKER：数据损坏、双写、第二 timeline、adapter commit、stale/rebased 绕过、revision 非 exactly-once、
晚到自动采用、证据伪造。MAJOR：合同/实现不一致、真实媒体缺失、恢复边界缺口、旧 Gate 回归、rights/lock
漏检。全部 BLOCKER/MAJOR 关闭后才冻结。

最终允许：`WAVE2_EDITABLE_ADOPTION_READY`。禁止：Gate V1-P0、V1-Full、完整同页 Studio、正式生产
render route、长片性能、headed/human 已验。

## 8. 自动继续与停止

模块红灯、编译、局部回归和可复现故障由实现 Agent 自动修复。只有需要人工体验/高风险决策，或需
移交 Claude Code 时停止；移交必须使用 `05_CLAUDE_CODE_HANDOFF.md` 的完整提示词。
