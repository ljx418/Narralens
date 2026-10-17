# Narralens M2–M7D 开发与验收交接包

- 版本：1.1（四波次加速版）
- 事实冻结日期：2026-10-17（Asia/Shanghai）
- 文档状态：`IMPLEMENTATION_READY / CODE_NOT_STARTED`
- 适用仓库：`https://github.com/ljx418/Narralens`
- 观察分支：`migration/m1-m0-m1a`
- 观察 HEAD：`1eec29062156356d29e5adc5016b5403a4e3002d`
- 观察 `origin/main`：`304c89134fdf9f834f7d69e3f4d5c89a68044c60`

## 1. 本包回答什么

本包把已批准的 OpenFilm 迁移方向展开为可由 Claude Code 逐阶段、逐模块执行的规范，覆盖：

- M2–M7D 全部剩余开发顺序、进入条件、交付物、停止条件和验收门限；
- L0 系统上下文、L1 组件/数据所有权/依赖规则和真实代码落点；
- EnginePort、原生写入治理、snapshot、journal、Job/SSE、素材化、采用、Studio UX、P0/P1 的模块设计；
- HTTP、TypeScript、状态机、摘要、幂等、错误、兼容和版本规范；
- 架构契约锁、代码规范、团队阶段流程、证据规范和三轮独立复验；
- 可直接交给 Claude Code 的完整执行提示词。

它不包含生产实现，不把目标接口冒充为当前 API，不批准跳过阶段。

## 2. 当前真实状态

| 范围 | 状态 | 允许声明 |
|---|---|---|
| D1/D2/D3/D4.0/D4.1 | 历史 Gate 已通过，限制保留 | 只在原证据范围内通过 |
| D4.2.1 / M1A | 逐编号证据完成，独立 Claude Code R4 `YES` | 导入与登记子集关闭 |
| M1B | 固定 OpenFilm `e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3` 的隔离 spike 通过 | 可进入 M2，不等于生产集成 |
| M2 | `allowed-not-started` | 从 M2.1 开始，按 Wave 1 连续推进至 M2.3 |
| M3–M7D | `not-started` | 不得宣称实现或验收 |

当前生产代码的事实入口仍是：

- `src/host/server.ts`：Host API、Origin/session 边界；
- `src/host/projects/project-write-actor.ts`：Hypit typed edit 的事务所有者；
- `src/host/projects/revision-store.ts`：revision、edit/import journal、幂等和 attention；
- `src/host/projects/project-operation-queue.ts`：每项目串行化；
- `src/host/assets/*`、`asset-registry.ts`：真实导入、媒体验证和 Manifest@2；
- `src/adapters/hypit/*`：当前生产剪辑适配；
- `src/adapters/openmontage/*`：真实 Claude CLI 多提案；
- `spikes/openfilm-m1b/**`：仅 spike，不是生产 OpenFilm Adapter。

## 3. 权威层级

发生冲突时按以下优先级处理，禁止 Claude Code 自行“统一”掉历史编号：

1. 用户最新明确批准或限制；
2. `docs/01_PRD.md` 的 P0/P1/NFR/明确不做；
3. `docs/11_V1_Traceability.md` 的本地权威状态与编号；
4. `docs/migration/M1/CR-MIG-001.md` 和本包 `06_ARCHITECTURE_CONTRACT_LOCK.md`；
5. 当前源码、合同、测试和真实证据；
6. 本交接包的模块与接口设计；
7. `docs/Narralens-Migration-M1/contracts/*` 等 migration 目标草案。

若 3–6 与当前源码不一致，先写差异和 ADR/变更单；不得在代码里静默裁决。

## 4. 阅读顺序

1. `00_README.md`
2. `01_MASTER_ROADMAP.md`
3. `02_ARCHITECTURE_L0_L1.md`
4. `03_M2_M4_MODULE_DESIGN.md`
5. `04_M5_M7_MODULE_DESIGN.md`
6. `05_API_INTERFACE_SPEC.md`
7. `06_ARCHITECTURE_CONTRACT_LOCK.md`
8. `07_CODE_STANDARDS.md`
9. `08_TEAM_DEVELOPMENT_WORKFLOW.md`
10. `09_TEST_ACCEPTANCE_PLAN.md`
11. `10_TRACEABILITY_MATRIX.md`
12. `11_THREE_PASS_REVIEW.md`
13. `13_ACCELERATED_DELIVERY_STRATEGY.md`
14. `14_WORKFLOW_REGISTRY.md`
15. `12_CLAUDE_CODE_HANDOFF_PROMPT.md`

开始 Wave 1 前还必须读取以下已落盘的模块级文件：

- `docs/migration/M2/ADR-M2.1-001-contract-reconciliation.md`；
- `docs/migration/M2/M2.1-development-and-acceptance-plan.md`。

其中 D-01..D-06、历史编号、兼容和具体接口裁决继续作为 M2.1 的有效约束。两份文件形成于“四波次连续交付”授权之前，因此其“唯一允许 M2.1 / 不进入 M2.2”只保留为当时的流程记录，不再是当前停工边界。实现者不得覆盖或改写它们，应新增 Wave 1 总计划/兼容补充，说明如何在保留 M2.1 裁决的前提下承接 M2.2/M2.3。

配套图：

- `diagrams/target-architecture.html`：L0/L1 目标架构；
- `diagrams/stage-development-workflow.html`：四波次连续开发—组合验收闭环。

## 5. Claude Code 使用边界

- 一次开放一个完整垂直波次；首次连续完成 M2.1→M2.2→M2.3，不在普通模块检查点等待人工批准。
- 波次开工前一次冻结跨模块合同；波次内每个模块先写失败测试并追加证据；波次末统一全量回归、内审和独立外审。
- 自动 UI 默认 Headless、静音、无窗口、不抢焦点；headed 与人类体验单独记录并等待用户协调。
- 不重写 D1–M1 已通过模块；修改既有模块必须保留原合同与回归。
- 不 force push、不 reset 用户工作、不删除 legacy、不上传凭据/私有素材、不产生未经批准的费用或外传。
- 独立外审必须绑定冻结 commit；实现会话不能自签外审。
- M6 最多声明 `Gate V1-P0`；只有 M7A–D 和 P0/P1 全部真实证据通过才可声明 `V1-Full`。

## 6. 文档自身验收

本包通过不代表业务 Gate 通过。文档门只证明：阶段范围可执行、接口边界明确、验收用例可追踪、禁止项可测试。业务能力仍必须由对应阶段的真实代码、真实素材、真实工程、真实重开/导出和独立审查证明。

