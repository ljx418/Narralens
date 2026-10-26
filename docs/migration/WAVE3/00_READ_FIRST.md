# Wave 3 / M5 开工入口

状态：`FROZEN_FOR_CLAUDE_IMPLEMENTATION`

前置已满足：Wave 2 组合候选 `a038e4a6cc48a7d09c240318da3ec1068e0e8bcc` 独立外审 PASS，声明
`WAVE2_EDITABLE_ADOPTION_READY`。M5 只负责把已证明的 Host 能力做成同页 Studio UX；不提前实现 M6 生产导出、
标题/封面/preflight，也不提前声明 Gate D4.2、V1-P0 或 V1-Full。

阅读顺序：

1. 本文；
2. `01_M5_ARCHITECTURE_AND_CONTRACTS.md`；
3. `02_M5_DEVELOPMENT_AND_ACCEPTANCE_GATE.md`；
4. `03_M5_CLAUDE_HANDOFF.md`；
5. `docs/02_UX_Interaction.md`、`docs/10_V1_Frontend_Optimization.md`；
6. `docs/prototype-v1/V1_UX_Architecture.md` 与批准的 `prototype-v1/index.html`；
7. `docs/03_Architecture.md`、`docs/11_V1_Traceability.md`；
8. Wave 2 合同、真实源码、测试和 `docs/evidence/WAVE2/`。

事实冲突顺序：当前源码/合同/SQLite 约束 → 已通过 Wave 2 证据 → 本包 → 主架构/追踪 → 早期原型文字。
不得用原型中的模拟按钮覆盖生产合同，也不得为 UI 方便建立第二 timeline 或客户端 revision 权威。

执行方式：M5A→M5B→M5C 连续推进，每个子阶段先红灯测试、后实现、再专项回归；只在 BLOCKER/MAJOR、需要
真实用户判断或外部授权时停止。普通缺陷由实现会话闭环。自动 UI 测试必须 Headless、静音、隔离、无窗口、不抢焦点。
