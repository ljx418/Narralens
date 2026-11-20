# Narralens 工作空间布局约定

2026-11-13 最终用户要求：取消“Narralens｜项目入口”中间层，本项目9个工作区全部直接收纳于videoWorkLine文件夹下、彼此同级。

```text
videoWorkLine
├─ Narralens｜主控文档与验收
├─ 01 实施｜ClaudeCode N1-N2
├─ 02 审查｜PRODUCT Codex
├─ 03 审查｜BRIDGE Codex
├─ 04 审查｜MEDIA Codex
├─ 90 保留｜BRIDGE 代码树
├─ 91 保留｜MEDIA 代码树
├─ 92 保留｜PRODUCT 代码树
└─ 93 基线｜固定 OpenFilm 隔离树
```

- 不再创建项目入口中间层或实施/审查下的孙级工作区，优先复用现有窗口和工作区。
- 本次只更改Orca收纳元数据，不移动磁盘源码目录、Git worktree、运行目录或会话，不影响当前Claude运行。
- 新物理worktree如确有必要，优先videoWorkLine根下Narralens-<职责>同级目录；不递归套娃。
- 保全dirty源码、失败验收证据与历史会话，不批量关闭未知窗口或删除旧工程。替换writer先证明旧writer退出，单一源码writer，恢复后先真实工具probe与基线ACK。
- ClaudeCode负责实施/自验证，MAIN负责计划/设计/复核/验收；新429立即停，未经明确授权不切换供应商或Codex接手。

最新实际复验记录：docs/execution/A/implementation-20261111/R2/native-composition-implementation/resume-claude-20261112/WORKSPACE_DIRECT_VIDEOWORKLINE_050_AFTER.json。此前046/048/049层级均为历史，已被本次050取代。
