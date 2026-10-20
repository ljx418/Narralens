# M4B 文档独立外审 R4

审查基线：`32c9a0054260296f304e9c6211ded6fbd64840b0`；只读 Claude Code CLI；工作树 clean。

结论：`M4B_DOCUMENT_GATE_PASS`，BLOCKER=0 / MAJOR=0 / MINOR=8 / NOTE=5。

R3 的三项重大问题均关闭：post-adoption projection fact 能以 active snapshot 为唯一 pointer 严格重建 exact roots；
aborted failure response 的 HTTP/body/逐字幂等重放已冻结；`evidence:wave2:m4b` 已进入全部执行清单。复审会话实际
重跑 OpenFilm spike exit 0，并核对 sequence JSON/HTML SHA 与记录一致。

外审后已收口 8 项 MINOR：累计 adopted roots、恢复 roots 重建、outbox-before-response 顺序、受控 423 不落终态
幂等、failure schema/validator 注册、spike 完整输出、edit 回值与回读 problems 的职责、ADR-W2.0-005 M4B 例外。
这些修订不改变已通过的权威或原子性边界。

本 PASS 只表示 M4B 文档可供实现；M4B 代码尚未实现，不代表 M4B/Wave 2/Gate D4.2/V1 已完成。
