# CR-MIG-001：默认编辑引擎迁移与 Gate 重排

状态：`APPROVED_DIRECTION / M0_OBSERVED / M1A_IN_PROGRESS / M1B_IN_PROGRESS`  
生效边界：只改变后续开发顺序和目标架构，不追溯改写 D1–D4.1 历史 Gate。

## 决策

1. 保留 Local Host、Manifest@2、真实 Claude CLI 多提案、费用审计、typed edit、revision/lock/journal/补偿。
2. 目标新增 `EnginePort` 与受控 `OpenFilmAdapter`；OpenFilm Studio 成为新项目目标原生 UI 和默认渲染器。
3. Hypit 保留为 legacy/回退。每个项目只绑定一个可写引擎；迁移创建副本，不双写、不删除旧项目。
4. VibeMovie 只提供结构化提案方法参考，不引入 Gemini 服务、第二份完整 timeline 或 Remotion 全片后端。
5. OpenMontage、HyperFrames、HeyGen 仅按后续明确能力 ticket 接入；不前置插件市场。

## Gate 重排

`M0 → (M1A D4.2.1 证据闭环 || M1B OpenFilm spike) → M2 写入治理/持久恢复 → M3 素材化 → M4 采用事务 → M5 原生 Studio UX → M6 V1-P0 → M7A–D P1/V1-Full`。

M1A 与 M1B 必须同时通过才允许 M2。任何一门失败，修复本门或报告 NO_GO，不跳回旧 D4.2.2。M6 只能声明 `Gate V1-P0`；只有 M7A–D 与 P0/P1 全部有真实证据，才可声明 `V1-Full`。

## 不变量

- Host 拥有 commit；adapter 不自增 revision、不绕过锁、不裸转发 native mutation。
- source digest 覆盖 film、scene、字幕、设置、字体及引用资产内容，而非单文件摘要。
- materialize 只产生 proxy/segment plan/lineage，不写 author source 或 project revision。
- adopt 需要服务器 impact/hash、base/revision、锁、许可、幂等检查，并使 revision 恰好 `+1`。
- 三镜方案采用后仍是三个原生可编辑 clip；扁平 MP4 不能通过可编辑迁移验收。
- 恢复旧内容产生新 revision；取消后的晚到结果不得自动采用；所有导出绑定已提交 snapshot。

## 当前风险与回退

M1B 尚未证明 OpenFilm 的完整写入口可被治理，且上游已知 `editProjectFilm` 可能在 base 不一致时返回 rebased。若无法在 Narralens 网关严格拒绝 stale base，M2 为 NO_GO。回退使用已验证 Git bundle、固定 Hypit fork与旧项目副本，不使用 `git reset`，并保留迁移后的 OpenFilm 工作成果。
