# 剩余阶段的统一开发与验收门禁

每个 R1–R8 阶段都必须按以下顺序执行，不得把“总体计划存在”当作专项计划通过。

## 1. 进入条件

- 前序阶段 evidence manifest、内部实现审计、Claude 独立外审全部通过。
- 工作树和远端提交可追踪；上游 gitlink、依赖版本与真实 fixture 哈希已冻结。
- 本阶段涉及的 P0/NFR、明确非目标、用户路径和失败动作已经落盘。

## 2. 文档开发

至少产出：开发及验收计划、专项架构 HTML/JSON（需要时同步 `Narralens-V1-Development-GAP.drawio` 及对应专项架构）、合同/schema、错误码、实体状态机、代码文件清单、测试矩阵、证据清单、停止条件。若执行环境提供 Archify skill，必须先完整阅读其 `SKILL.md` 再使用；若 Claude Code 环境没有该 skill，不得伪称已使用，应按既有架构 HTML/JSON/Draw.io 格式完成同等事实核查并在审计中记录限制。图中实体必须对应真实或明确 planned 的代码实体。

## 3. 内部独立审查

从 PRD 覆盖、架构合理性、事务所有权、测试真实性、交互一致性、安全、恢复和范围漂移审查。存在 critical/major/must-fix 时继续修订；无法消减的路线风险才交给用户选择。

## 4. Claude Code CLI 外审

使用 `09_EXTERNAL_AUDIT_SESSION_PROMPT.md` 启动新会话、完整上下文、只读模式。结论必须显式给出 `PASS/FAIL`、是否允许实现/关闭、critical/major/minor 数量、文件行号、复现依据、claim limits。critical 或 major 非零不得进入实现。

## 5. 实现

每个提交只交付一个可观察能力。不得手写宽松协议解析、绕过 Host/Actor、直接正则改 Author Source、用 UI 状态代替服务端锁、用 placeholder/空产物冒充能力。发现计划不足立即退回文档阶段。

## 6. 自动验收

- 使用真实工程、真实媒体、真实 Host/Hypit/ffmpeg/浏览器；mock 只证明组件或合同。
- 成功与失败都验证 Source、Run、narration、manifest、revision、journal、临时目录和外部调用事实。
- 截图不能单独证明写入、重开、恢复或导出。
- 全量回归不得删除、跳过或降级旧测试。

## 7. 子阶段出门

更新 evidence manifest、PRD 追踪矩阵和当前状态；完成内部实现审计与 Claude 外审；critical/major/must-fix 全零；提交并推送。任何限制必须保留，不能因通过而删除 claim limits。

## 8. 高风险停止条件

出现以下任一项立即停止并报告用户：

- 只能以 mock、静态 HTML、截图或手工改 JSON 证明核心能力；
- 需要放宽路径、许可、origin/token、expected SHA、revision 或锁定边界；
- 无法证明失败后 Source/manifest 精确恢复，且没有诚实 attention 状态；
- PRD、架构和实现对能力状态互相矛盾；
- 422 表示合同/输入设计错误却只能靠重试掩盖；529/限流反复出现并影响真实验收；
- 自动化测试试图启动 headed/可见浏览器、抢占焦点、弹窗或发出声音；移动盘使用仍须提前通知用户；
- 真实素材或上游环境不足，继续开发只能制造虚假验收。
