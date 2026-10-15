# 权威文档与代码索引

本包共 10 个平铺文件。Claude 还必须读取以下仓库原文；总审查清单少于 20 个入口。

## 核心规格与流程

1. `docs/01_PRD.md` — P0/NFR/不做范围。
2. `docs/03_Architecture.md` — 系统边界、真实写入路径、错误码。
3. `docs/04_Development_Plan.md` — D1–D7 总体阶段与当前 Gate 状态。
4. `docs/05_Acceptance_Plan.md` — Gate 与端到端场景。
5. `docs/09_Development_Workflow.md` — 用户批准的六步版本循环和自动化纪律。
6. `docs/11_V1_Traceability.md` — P0/NFR 追踪。
7. `docs/Narralens-V1-Development-GAP.drawio` — 7 页目标架构/GAP/门限图，后续阶段必须同步。

## 当前阶段专项

8. `docs/implementation/D4.2-development-and-acceptance-plan.md` — D4.2.1/2/3 边界与总测试族。
9. `docs/implementation/D4.2.1-development-and-acceptance-plan.md` — D4.2.1 冻结合同、NO-GO、测试矩阵。
10. `docs/implementation/D4.2.1-internal-implementation-audit.md` 与 `docs/implementation/D4.2.1-fault-race-implementation-audit.md` — 最终内部总审计及最近已关闭子门禁。
11. `docs/evidence/D4.2/D4.2.1/evidence-manifest.json` — 当前证据索引，状态为内部审计通过、外部总审计待完成。
12. `docs/architecture/d4.2-materialize-adopt.architecture.html` — D4.2 全景。
13. `docs/architecture/d4.2.1-import-transaction.architecture.html` — 导入事务专项。

## 生产代码入口

14. `src/host/server.ts`、`src/host/assets/`、`src/host/projects/` — Host、导入、registry、journal、queue、write actor。
15. `src/app/director/` — 当前生产 UI/API client。
16. `src/contracts/`、根 `contracts/` 与 `docs/contracts/` — runtime types/validator、生产 schema 与评审期 schema；三者边界不得混淆。
17. `vendor/hypit/packages/studio/src/` — 固定 fork 的 manifest lease 和 typed mutation。
18. `tests/evidence/` 与 `tests/fixtures/` — 浏览器/上传证据脚本及测试夹具；真实工程 canonical fixture 是仓库根 `fixtures/d1-30s`，不是 `tests/fixtures`。

## 现有证据边界

- D1–D4.1：`docs/evidence/D1`、`D2`、`D3`、`D4.0`、`D4.1`。
- D4.2.1：`docs/evidence/D4.2/D4.2.1`。`d421-browser-import.json` 与 `d421-browser-zoom-200.json` 是 canonical pass；`attempts/` 只保存失败历史，不能冒充通过证据。
- 不要把 `docs/prototype-v1` 的交互原型当生产实现；它只用于目标体验对照。
- `J:\` 名称为“视频制作”的移动硬盘可能不稳定；使用前通知用户，证据中不得写入绝对盘符路径。D4.2.1 复跑不依赖该盘，使用仓库根 `fixtures/d1-30s/assets/generated/visual-alt-10s.mp4`；后续 V1 真实母项目若必须依赖移动盘且离线，应停止并报告，不能用小 fixture 冒充 3–5 分钟母项目验收。
