# Claude Code 交接：M3 Materialization → Wave 2 组合冻结

状态：`READY_FOR_CLAUDE_CODE_IMPLEMENTATION`
生效日期：2026-10-19
上一阶段：W2.0 `INTERNAL_EVIDENCED`

> 本文档是当前继续开发入口。它覆盖 `05_CLAUDE_CODE_HANDOFF.md` 中“重复实现 W2.0”和
> “后续 tip 必须使 `evidence:wave1:integrity` 6/6 PASS”的过时要求；其他 Wave 2 架构约束继续有效。

## 1. 开工基线与裁决

- repo：`/mnt/c/workspace/videoworkline/Narralens`
- branch：`migration/m2.2-coordinator-persistence`
- W2.0 候选 HEAD：`889f758b4c5da77301032794bc58a4881221f7a2`
- origin/main：`304c89134fdf9f834f7d69e3f4d5c89a68044c60`
- OpenFilm：`e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3`
- Hypit：`6fdd8c0f02c17b9970aee6deb4550a70e9d57acf`
- ADR-W2.0-001 已批准：允许 `active -> attention`，`attention` 是终态，禁止自动
  `attention -> active`。

以实际 HEAD/工作树为准，不要 reset 到上述 SHA。保护用户改动，禁止 force push、
删除历史证据、重建替代项目或改写 Wave 1/W2.0 通过行为。

## 2. 开工前门

1. 输出 branch、完整 HEAD、origin/main、remote、worktree 及与本文档的差异。
2. 按顺序阅读 `00_READ_FIRST.md`、`02_ARCHITECTURE_AND_CONTRACTS.md`、
   `03_DEVELOPMENT_AND_ACCEPTANCE_PLAN.md`、ADR-W2.0-001/002、W2.0 case 与 evidence manifest。
3. 执行 `corepack pnpm test:wave2:w2.0`、`test:contracts`、`test:m2.1`、
   `evidence:wave1:historical`；记录真实 exit code。
4. `evidence:wave1:integrity` 在 Wave 2 tip 上预期 exit 1，只能原样保存和标注
   `SUPERSEDED_BY_LATER_CODE`，不得调绿。
5. 确认 materialize/impact/versioned edits/history restore 当前路由状态与冻结文档一致。

W2.0 曾在并行全量门中出现 ENOMEM 和一次原因未知的 Host 500。Codex 复验时
W2.0 专项 13 files / 175 tests 全绿，且关键真实 Host 场景隔离连续 3 次通过。
该问题作为 `INFRA-RISK-W2-001` 保留：M3 不得用“重试直到绿”掩盖新失败。新增 Host 500
必须在不泄露绝对路径/凭据给客户的前提下，在测试诊断通道保留 correlation id、阶段和根因。

## 3. M3.1：持久化、绑定与幂等

- 在同一 `RevisionStore`/SQLite 连接增加 `materialization`，不创建第二数据库。
- 复用已通过的 `materialize` Job kind；默认 max attempts=3、lease=30s。
- 幂等唯一键为 project + operation kind + idempotency key；同 digest 重放原响应，异 digest 409。
- `BindingService` 逐 segment 重读 target-owned proposal/comparison、`AssetInventoryPort`、bytes SHA、
  MIME、帧长和 rights。path project/comparison/proposal 必须一致。
- 一个 proposal segment 恰一个 binding；整数半开帧区间；短素材、未知素材、重复/越界绑定拒绝。
- 不得 loop/freeze/speed，不得将源 Hypit comparison 改 project id 冒充 target proposal。

M3.1 出门：MT-01 及 MT-04 persistence 子集；source closure、revision、active commit、
engine binding、active asset ledger 前后逐字/逐值不变。

## 4. M3.2：NativePlan 与真实 proxy

- `NativePlanBuilder` 对三镜 fixture 产生恰好 3 个稳定、唯一、可独立编辑的 clip spec。
- 时间轴总帧和 proposal selection 精确一致；不得生成第二份完整 timeline。
- proxy 使用固定 `execFile` argv/profile，禁止 shell/网络；全局并发 2、同项目 1，
  每 segment 120s，最多 64 segment。
- 产物放 materialization 专属内容寻址 derived root，必须 fsync + atomic rename。
- lineage 覆盖每个 input asset id/bytes/span/rights/tool profile 与 output SHA，不可篡改。
- 用真实 MP4 证明完整 decode、总帧、分段边界及首末帧；不得以 JSON/mock/文件存在代替。

M3.2 出门：MT-02/03/06。

## 5. M3.3：路由、worker、取消与恢复

- 开放且仅开放：
  - `POST /api/migration/v1/projects/:projectId/proposals/:proposalId/materialize`
  - `GET /api/migration/v1/materializations/:materializationId`
- POST 返回 202 JobResponse + materialization id；GET 返回 `MaterializationV1`。
- worker 执行前必须持有 owner+attempt lease。失 lease、重启、取消、部分产物和晚到 callback
  必须按冻结状态机收敛。
- 取消后的晚到产物只能 quarantine，永远不能 `ready_for_adoption`。
- 每次 GET 重验 base/source/control/inventory/rights/bytes；变化后转 stale，不自动升级或采用。
- ready 只在 native plan/proxy/lineage/rights 全部验证通过后可达。

故障注入覆盖：job create 后、lease 后、每 segment 前后、proxy fsync/rename 前后、
lineage 保存前后、ready 前、cancel 前后、callback 晚到。每点核对 temp、lease、quarantine、
immutable artifact、job event 和 materialization state。不能确定发布结果时进 attention，不得猜测成功。

M3.3 出门：PR-01..03、MT-04/05。

## 6. 真实数据与 NOWRITE

- 使用已迁移 OpenFilm 三 clip fixture、target-owned D4.1 proposal 和已登记
  cleared/commercial MP4。
- 不得发起新 Claude 付费请求。可离线重放已保存的真实 D4.1 output，但必须通过
  正常 adapter 重建 target-owned comparison，同时绑定原 payload/stdout SHA 和新 comparison SHA，
  标注 `RECORDED_PROVIDER_OUTPUT_REPLAY`。
- M3 前后必须不变：author source closure、project revision、active commit、engine binding、
  active asset ledger。只允许 materialization/job/event/outbox read model/derived root 变化。
- 禁止读取 `J:\` 私有素材、网络外传、付费、弹出可见窗口或抢占焦点。
- 自动交互验证一律 Headless、静音、隔离 profile，结束清理进程。headed/human 为 `NOT_RUN`。

## 7. 门禁、证据与自动继续

新增并执行：

```bash
corepack pnpm test:wave2:m3
corepack pnpm test:wave2:fitness
corepack pnpm evidence:wave2
corepack pnpm evidence:wave2:integrity
```

回归至少包含：`check`、`test:contracts`、`test:m2.1`、W2.0、M2.2、M2.3、
`evidence:wave1:historical`、OpenFilm 固定上游探针、凭据扫描。无论最终成败，都保留每次
全量门的 `.cmd/.txt/.exit` 和原始失败分类；禁止只拷贝某次绿色输出。

证据追加到 `docs/evidence/WAVE2/`，不覆盖 W2.0 或 Wave 1 证据。每个 PR/MT case
记录自动层级、production seam、命令、exit、产物 SHA256、声明边界和 NOT_RUN 项。

M3 实现完成后先做架构/正确性/真实体验/验收四视角内审，关闭全部 BLOCKER/MAJOR。
PR-01..03、MT-01..06 全部 `INTERNAL_EVIDENCED` 后，不停下等待模块外审，自动进入 M4A。

M4A 仅实现 `ImpactService`/`ConsumerGraph`/`ImpactStore`、canonical hash 及黄金向量、15 分钟
TTL、impact route、current facts/rights/locks 重验；不得在 M4A 门通过前提前开放 adopt/history。
M4A 内部门通过后不停止，按 `05_CLAUDE_CODE_HANDOFF.md` 的 M4B/M4C 冻结约束连续完成
AdoptionCoordinator 和 HistoryService；只在 Wave 2 组合冻结候选、四视角内审和全量证据完成后
停止，交独立外审。实现会话不得自签外审。

## 8. 唯一停止条件

普通编译、测试、race、adapter 差异、文档小错和证据工具问题自动闭环。同阶段第 3 次
返工时必须自行做根因修复与防回归门。仅以下情况可停止：

- 需要人工体验/内容裁决；
- 不可逆数据变更、付费、外传或新架构偏差；
- 客观环境阻塞且安全替代路径已耗尽；
- Wave 2 组合冻结候选已完成，需交独立外审。

实现会话最高只可声明各模块 `INTERNAL_EVIDENCED` 和 `WAVE2_COMBINED_REVIEW_PENDING`。
只有独立外审 PASS 才可声明 `WAVE2_EDITABLE_ADOPTION_READY`。始终禁止声明 Gate D4.2、V1-P0、
V1-Full、M5 Studio UX、M6 正式 render、长片性能或 headed/human 已验收。
