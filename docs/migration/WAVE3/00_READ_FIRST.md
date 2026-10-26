# Wave 3 / M5 开工入口

状态：`REWORKED_CANDIDATE_FOR_INDEPENDENT_REVIEW`

前置已满足：Wave 2 组合候选 `a038e4a6cc48a7d09c240318da3ec1068e0e8bcc` 独立外审 PASS，声明
`WAVE2_EDITABLE_ADOPTION_READY`。M5 只负责把已证明的 Host 能力做成同页 Studio UX；不提前实现 M6 生产导出、
标题/封面/preflight，也不提前声明 Gate D4.2、V1-P0 或 V1-Full。

阅读顺序：

1. 本文；
2. `04_M5_REVIEW_CLOSURE_AND_SUPERSESSIONS.md`（首轮独立审查后的强制裁决）；
3. `01_M5_ARCHITECTURE_AND_CONTRACTS.md`；
4. `02_M5_DEVELOPMENT_AND_ACCEPTANCE_GATE.md`；
5. `03_M5_CLAUDE_HANDOFF.md`；
6. `docs/02_UX_Interaction.md`、`docs/10_V1_Frontend_Optimization.md`；
7. `docs/prototype-v1/V1_UX_Architecture.md` 与批准的 `prototype-v1/index.html`；
8. `docs/handoff-m2-m7d-claude/04_M5_M7_MODULE_DESIGN.md`、`05_API_INTERFACE_SPEC.md`、
   `10_TRACEABILITY_MATRIX.md`（只作为被取代关系的输入，不覆盖本包）；
9. `docs/03_Architecture.md`、`docs/11_V1_Traceability.md`；
10. Wave 2 合同、真实源码、测试和 `docs/evidence/WAVE2/`。

事实冲突顺序：当前源码/合同/SQLite 约束 → 已通过 Wave 2 证据 → 本包（04 的裁决优先）→ 主架构/追踪 →
旧 handoff → 早期原型文字。旧 handoff 中 ProjectCreation/story-projection/checkpoint/900 秒 M5 harness 等条目按 04
的取代表延期或合并，不得并行实现两套接口。
不得用原型中的模拟按钮覆盖生产合同，也不得为 UI 方便建立第二 timeline 或客户端 revision 权威。
不得读取或使用仓库根未跟踪 `narralens-d1`，不得读取 `J:\`，不得联网、调用 provider 或产生费用。

执行方式：M5A→M5B→M5C 连续推进，每个子阶段先红灯测试、后实现、再专项回归；只在 BLOCKER/MAJOR、需要
真实用户判断或外部授权时停止。普通缺陷由实现会话闭环。自动 UI 测试必须 Headless、静音、隔离、无窗口、不抢焦点。
