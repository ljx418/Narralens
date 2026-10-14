# 叙镜 Codex 开发交接 v1.0

当前阶段：生产开发已批准，Gate D1、D2、D3、D4.0、D4.1 已通过。D4.2 总体文档与子阶段边界已通过内外审；D4.2.1 合同/共享队列、Hypit lease/expected SHA、AssetRegistry/import journal 三个实现子阶段已分别通过门禁，Hypit fork/gitlink 固定为 `ljx418/hypit@6fdd8c0f02c17b9970aee6deb4550a70e9d57acf`。下一步是 ImportService、严格 multipart 与资产 routes；这些 route 当前尚未开放。

## 你的角色
你在本地仓库实现 Narralens。先做真实视频工程，再做体验包装。不要把已有 HTML 原型当生产系统。

## 开工第一条命令前先做
0. 确认项目负责人已明确批准进入实际开发；没有批准则只继续文档审计和修订。
1. 阅读 `00_README.md` 到 `05_Acceptance_Plan.md`。
2. 扫描当前本地已有 UI/剪辑代码，不删除用户已有成果。
3. 克隆或定位 OpenMontage 与 Hypit；记录 commit SHA、license、依赖、实际 CLI 帮助。
4. 新建 `docs/implementation/D1-environment-audit.md`，写明真实环境与可执行命令。
5. 在任何 Narralens 业务功能前，完成 30 秒中文视频“预览→导出→重开→局部改→再次导出”。

## 不可变架构边界
- 一个统一工作台，不拼两个 iframe。
- Hypit Author Source + Run 是唯一最终剪辑事实源。
- OpenMontage 只通过 Adapter/暂存区输出提案与素材，不直接写主 Source。
- Narralens DB 只存任务、版本、锁、审批、映射、预算和事件，不存第二条最终时间轴。
- 所有人工/Agent 写入走同一个 edit transaction。
- 未验证的上游内部接口不可凭猜测编码。

## 首周开发顺序
D1 底座探测 → D2 DirectorPane + Proposal API → D3 real source edit/revision/locks → D4 alternatives/materialize → D5 reuse/recovery → D6-D7 真实 3–5 分钟章节精修。

## 推荐初始目录
```text
app/director/
host/
adapters/openmontage/
adapters/hypit/
contracts/
tests/e2e/
docs/implementation/
```

## 第一批契约
先实现并测试：
- `contracts/creative-task.schema.json`
- `contracts/proposal-bundle.schema.json`
- `contracts/asset-ref.schema.json`
- `contracts/edit-operation.schema.json`
- `contracts/event-envelope.schema.json`

## 第一批 API
- POST `/api/projects/:id/proposals`
- GET `/api/jobs/:id`
- GET `/api/projects/:id/events`
- POST `/api/projects/:id/edits`
- POST `/api/projects/:id/renders`

先返回真实但最小的数据，不要为了“接口齐全”造假后台。

## 提交门槛
每次提交必须带：
- 变更说明；
- 自动化测试；
- 手工复现命令；
- 真实产物/日志位置；
- 已知限制；
- 如果接触上游，记录 commit SHA。

## 禁止
- 不允许用静态 HTML 演示声称“视频系统完成”。
- 不允许写不存在的 `openmontage generate --hypit` 等命令。
- 不允许正则替换或数组索引猜 Hypit author identity。
- 不允许因一个镜头变化无故重跑全部付费生成。
- 不允许把研究来源自动当作可复用视频素材许可。
- 不允许删除上游要求保留的版权/标识。

## 恢复工作时

1. 先核对 `docs/evidence/D1`、`D2`、`D3` 的 manifest 和 `11_V1_Traceability.md`。
2. 运行 `corepack pnpm check`；D3 基线为 38 tests + TypeScript + Vite build 全绿。
3. 核对 fixture Source SHA `ae4edebf...fcab3a`、Run SHA `bff6a663...c738`、旁白 SHA `ca8d3773...07a`，确认没有遗留 Studio/Host/专用 Chrome 进程或临时数据库。
4. D4.0 与 D4.1 已通过；D4.2 总体门禁已通过。D4.2.1 合同/共享队列与 Hypit lease/expected-SHA 两个子阶段已实现并通过内外审；下一动作是 AssetRegistry v2 与 import journal，仍不得开放 import route 或提前实现 materialize/adopt。

## 当前事实快照（2026-10-14）

- V1 目标原型已批准；细化原型位于 `prototype-v1/`。
- 全系统目标架构位于 `architecture/v1-target-system.architecture.html`。
- 开发 GAP、计划、门限和风险位于 7 页 `Narralens-V1-Development-GAP.drawio`。
- Git remote 已固定为 `https://github.com/ljx418/Narralens`；D4.1 基于 `e776eddd28c63d9a78f6b7c7797bcebaef542a1f` 开发，代码、测试与验证脚本冻结于实现提交 `44bd351c13d820b9e99bc13c39c2f1532dbee781`。
- OpenMontage `9327439...`、Hypit fork `6fdd8c0...` 已固定为 submodule；Hypit upstream base 为 `85e01c...`。
- D1 真实 30 秒底座、D2 真实 Claude Code CLI 单提案链、D3 typed visual fit 写入事务均已通过并有证据。
- D4.0 与 D4.1 的计划、schema、Archify 图、实现、内外审计与证据均已落盘并通过；D4.1 自动化为 80/80、真实 CLI/浏览器/NOWRITE 与 D4.0 回归通过。D4.2 计划位于 `implementation/D4.2-development-and-acceptance-plan.md`，外审记录位于 `implementation/D4.2-external-plan-audit.md`，目标图位于 `architecture/d4.2-materialize-adopt.architecture.html`；只允许从 D4.2.1 开始，不得跳到采用写入。
