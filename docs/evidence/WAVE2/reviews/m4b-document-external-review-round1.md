# M4B 文档独立外审 R1

审查基线：`87304330993798055f2e14fe521e2f2b0734940e`；只读 Claude Code CLI；工作树 clean。

结论：`M4B_DOCUMENT_GATE_FAILED`，BLOCKER=1 / MAJOR=3 / MINOR=16 / NOTE=4。

## BLOCKER

- M4B 专用恢复与现有 `project_transaction` 状态机不闭合：通用恢复会把 validated/prepared 行置 attention，
  terminal attention/recovering 没有合法 committed/aborted 出边，项目 attention latch 也没有通用清除路径。

## MAJOR

1. film 已发布、DB 未提交时的允许差异、HTTP、回滚策略、同 key 重试未冻结；
2. `adoption_transaction_fact` 写入时点与不可变 publish receipt 自相矛盾；
3. staged film 的生成机制未冻结，adapter ops 与直接写 isolated film 二选一未裁决。

## MINOR 清单

错误优先级；operation kind；精确 route inventory；命令表；审查状态；捕获/证据/外审 SHA 角色；模块路径；
EnginePlanIntent/EngineEditPlan 形状；OpenFilm roots；validate digest 重算；rights API；lock/binding API；
commitAdoption 禁止嵌套事务并取得真实 outbox id；case 全表；架构错误码；journal 中间态持久化。

本报告只审文档，不代表 M4B 已实现或可开工。
