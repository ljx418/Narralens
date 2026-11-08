# 并行设计复核与准备工具验证

范围：多Agent工作目录/任务/所有权/公共端口/统一验收设计与元数据工具。产品运行时未实现，未运行新业务验收。
用户认可基线：`867b3b33b9dd88c88e7bcca6c997d1ceba9c3051`。本轮并行方案构建在此之上。

## 1. 两路只读审查

- `parallel_boundaries`独立检查代码耦合、路径白名单、共享文件、端口/存储分层与集成责任。
- `parallel_acceptance`独立检查17包依赖、资源/fixture冲突、统一冻结与验收、元数据工具边界。

两路均未编辑文件、未启动服务或运行重型任务；复核是并行设计审查，不是绑定生产实现冻结commit的外审，也不是用户验收。

共同事实：server/RevisionStore/validator/M5Panel集中耦合，适合MAIN独占；现有Vitest maxWorkers=1与固定上游/缓存意味着代码能并行，重型门不能按Agent数量放大。

## 2. 发现与闭环

| Finding | 处置 | 直接验证 |
|---|---|---|
| 原17包线性链不能表达并行 | 06依赖改多前置DAG；编码release与正式验收依赖分列；校验用DFS | 17包/35族完整，缺前置/环拒绝 |
| 同worktree与公共文件冲突 | 同父目录3worktree，唯一索引/分支；MAIN独占合同/DDL/装配，lane互斥路径 | parallel-check.json含所有权与9项路径探针 |
| 已有lane dirty/旧HEAD仍报PREPARED | 准备前检查DIRTY/BASE_MISMATCH，先拒绝保留工作；明确implementationReady=false | 隔离测试dirty不删除、分歧拒绝、同基线幂等 |
| stale iteration JSON仍可PASS | 校验源Markdown SHA，过期直接STALE_ITERATION_PLAN | 隔离篡改源文档后必须失败 |
| guard漏dirty/untracked、口头例外 | 检查实际分支和所有当前变更/未跟踪；旧M5仅patch请求由MAIN提交 | 越界untracked拒绝；protected优先；不提供动态例外 |
| 独立资源冲突与假组合PASS | 全机重型1槽、只读上游/隔离运行根、模块/接缝/组合证据分列 | 设计约束；未来真实验证仍NOT_RUN |

修复后两路只读复核分别报告BLOCKER=0、MAJOR=0，确认工具SHA与9项隔离回归回执相符；审查者明确未代称本人重跑测试。

## 3. 已执行验证

`node tools/check-iteration-plan.mjs`：六阶段/17包/35验收族，多前置DAG无环。
`node tools/check-parallel-plan.mjs`：3lane互斥、17包owner齐全、保护规则优先。
`node tools/test-parallel-planning-tools.mjs`：9项一次性小仓库回归通过，目录/分支/dirty/旧HEAD/越界/stale/环均覆盖；不触碰用户worktree，测试目录已清理。回执`parallel-tool-tests.json`绑定工具SHA。

Archify并行图：spec SHA256 `34e3fc94c2f8a281802d77ab867ec7f514d6f9313e5de340284262b792b20951`；HTML SHA256 `61eeb264775994e4b278a1f5fb585dd41489d7c08286e2bf0a6cb01336566c58`；deliver 9/9、0错误/0警告。
Windows Headless补充检查四桌面尺寸无溢出，核对页40项与导出正常；图表截图以`parallel-architecture-*`命名。原生visual-check如遇WSL/Windows pipe错误应保留独立失败，不替换成补充PASS。

## 4. 结论与上限

并行规划可用于角色与目录准备；是否实际创建以外部`Narralens-agents/workspace-receipt.json`与git worktree现场为准。
未完成：IT-P01/IT-P02、精确CP-A0、正式实施release、新业务真实测试、生产独立外审与人验。创建三个目录不等于已开始三条实现线。
MAIN将统一安排实际实现、持续接线与组合冻结；独立审查和人工判断依然保持角色分离。
