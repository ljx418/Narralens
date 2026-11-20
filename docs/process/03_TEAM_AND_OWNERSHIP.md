# 实际分工与窗口规范

|角色|负责|不负责|当前状态|
|MAIN Codex|总架构/单一合同/根因合并/精确release/工具准入设计/总验收/Git和目录治理|不在Claude429时自动接实现；不代签人验|本轮执行流程与归档，产品实现未启动|
|领域Codex|真实代码图、状态机/合法非法样例、详细验收及未参与实现的复核|不各写第二套总体合同；不隐式扩scope|按需派发，当前未新启动|
|ClaudeCode（现有供应商）|精确范围内编码、接线、direct cases、自验证、失败保全|不自行裁决架构/放宽测试/自签外审|上次429任务已停止；额度恢复由用户报告，本轮不启动|
|独立Codex|绑定候选commit/实际输入，按影响审源码与证据|不把same-source摘要核对称全部文件语义审计|候选完整后启动|
|用户|A/B/C人工体验与高风险规格/权限决策|不承担低价值命令操作、每内部步骤批准|本轮批准流程调整和Git备份|

工作目录：Narralens为canonical docs/Git管理；Narralens-agents/main-integration为当前源码；固定Narralens-openfilm-m1b只读保留。不同目录历史内容不覆盖相互独有草稿；文档权威按process入口，源码候选按具体source branch完整SHA。

并行只允许不同写路径、稳定接口或只读审查。C/Host同一协议仍单writer；可并行制作验收样例或后续文档，但发布前MAIN统一裁决。审查者角色不等于天然独立：参与实现者不能签该实现独立外审。

每个实际Orca任务登记真实task/dispatch/terminal/cwd/owner/release/hash/state，不凭计划岗位冒充已启动。禁止手填旧task ID；closed/unknown不得因静默就恢复。新窗口应在videoWorkLine目录上下文直接显示，无Narralens项目入口中间层。冗余旧工作区在归档并验证独有资料后移出，不删除分支历史。

可选Codex亲写高风险核心尚未启用；若将来用户明确指定，重新分配唯一writer并另派独立审查。不能以“同意流程优化”猜测已撤销Claude实施约定。
