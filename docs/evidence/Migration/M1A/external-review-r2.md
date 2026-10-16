# M1A 独立外审 R2

审阅工具：Claude Code CLI 2.1.300（全新独立只读会话）  
审阅 HEAD：`7c6f84f5d88c1ee2193c6458b3e18ece887ca112`  
冻结实现：`84ecd6dcc2cd567865a7b03483b22c0cccb7176c`  
结论：`ALLOW_M1A_CLOSE=NO`  
统计：critical=0，major=2，must_fix=3

## 原始结论摘要

R2 确认 R1 六项实现/证据缺口均已真实闭环，test seam 不可由 HTTP 触达，也确认没有越界宣称 M1B/M2。仍拒绝关闭的原因是：

1. 冻结矩阵 `D421-UI-02` 要求 360/768/1440/1920 + 200% + axe；本轮冻结 SHA 只直接覆盖 1440@100% 与 native 200%。
2. README 执行表错误引用冻结前 `pnpm-check.log`，应指向 `pnpm-check-r4.log`，并标记 r0/r2/r3 已被取代。
3. README 大文件命令路径错误；实际脚本位于 `tests/evidence/d421-large-upload-evidence.ts`，包命令为 `pnpm evidence:d421-large`。

观察项（非本轮新增阻断）：IM-22 未用确定性 barrier 覆盖两种先后；部分 multipart 负向项直调生产 parser；timeout 只证明直接子进程；256 项 fixture 使用注入 probe；证据 source SHA 由环境提供。均保留为后续加强项，不冒充本轮已覆盖。

## R3 闭环计划

- 在不改生产代码的前提下，对冻结实现 `84ecd6d...` 用新鲜 fixture 补跑 360/768/1920 CSS viewport；每份均执行真实浏览器导入、键盘路径、layout、axe 与截图。
- 1440@100% 与 native 200% 继续使用已通过 canonical artifact；native 200% 不使用 device scale/CDP page scale。
- 更正 README 日志世代和实际大文件命令，随后启动全新独立 R3 会话。

R2 失败审阅历史永久保留。
