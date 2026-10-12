# 上游来源与核对记录
核对日期：2026-10-11。开发时必须再次固定 commit SHA；下面 URL 只用于说明当前架构与许可依据。

## OpenMontage
- Repository: https://github.com/calesthio/OpenMontage
- Architecture: https://github.com/calesthio/OpenMontage/blob/main/docs/ARCHITECTURE.md
- Project context: https://github.com/calesthio/OpenMontage/blob/main/PROJECT_CONTEXT.md
- Backlot: https://github.com/calesthio/OpenMontage/blob/main/backlot/README.md
- License: repository declares GNU AGPLv3.

已核对事实：OpenMontage 是 agent-orchestrated / agent-first；智能体读取 pipeline manifest 与 skills、调用 Python tools、写 checkpoint。Backlot 是读取项目产物与事件的只读 living storyboard，不应当作本项目可写剪辑器。

## Hypit
- Repository: https://github.com/hypit-ai/hypit
- README: https://github.com/hypit-ai/hypit/blob/main/README.md
- License: https://github.com/hypit-ai/hypit/blob/main/LICENSE

已核对事实：Hypit 提供 Studio/工程/渲染相关能力；许可不是无附加条件的标准 Apache 2.0。当前许可文本明确允许组织内部/自用（包括自己的商业工作），但对多租户托管和商业再分发等场景增加约束，并包含标识/版权要求。未来 SaaS 或对外产品必须重新审查。
