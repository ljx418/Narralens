你作为独立 Codex 审查者，复审 ClaudeCode R5E 最终当前字节。你没有参与该实现，不准修改源码、测试、Git或运行任何测试/产品程序/内核效应；本票纯只读，独立安全审查不等于真实运行验收或冻结commit审查。
W=/mnt/c/workspace/videoworkline/Narralens-agents/main-integration
控制包=/mnt/c/workspace/videoworkline/Narralens/docs/execution/A/implementation-20261111/R2/native-composition-implementation/resume-claude-20261112/repair-060p5e-proof-and-publication
先读 SPEC.md/RELEASE.json/MAIN_COMBINED_ADJUDICATION.json、MAIN_FINAL_CAPTURE_AUDIT.json 和 independent-review/INPUT_SNAPSHOT.json；读取其精确source8/protected7/report及需要的实际producer/consumer代码、最终六capture日志/输入/结果。检查输入快照的sha与你实际读取字节一致，读前后记录实际读过的全部文件SHA（不能只写8文件而遗漏依赖）。不重新跑命令，不以green count代替契约覆盖。
原R5D findings是必须逐项闭环的基线，不用新文档覆盖旧报告。核对本轮没有弱化已通过的取消主因、lateN、replacementPID保护、无root不写cwd等。捕获中旧os.kill越界、004 MAIN精确停止、005 INCOMPLETE原样保留，不能事后无影响保证。
输出仅写本票指定审查目录的 REVIEW.md、FINDINGS.json、INPUTS.json，包含实际SHA/调用链/可复现实验的纯设计（不执行）/严重性/最小修复和逐旧finding处置；记录not_run/限制，明确REQUEST_CHANGES或SAFE_FOR_SEPARATELY_PINNED_MINIMAL_N_PILOT。不得自签N1N2、R6/R7/R8、冻结commit或V1。
若发现源码漂移，停止审查并ask MAIN。完成后绑定新注入task/dispatch worker_done上报，输出路径明确。无需等待ClaudeCode，不向用户重复审批。

你的主要方向：R5D-N01/N04、O03/O04、NOTE01及受影响启动/回收/纯guard。
重点沿实际 _settle_domain→TargetSettlement→KernelSettlementOperations 检查original group证据义务与revoked destructive authority严格分离：空census/ECHILD不替代raw原PGID ESRCH；unknown仍held、后续ESRCH收敛、不恢复破坏权或瞄replacement。检查新增纯测试rawprobe反例确实达生产实现、旧逻辑red是否单因。检查TS/Python所有实际系统调用入口、全局defaultgone已撤回、逐case精确脚本、ledger断言吞异常/失败finally隔离/未决回调、ctypes/signal/os边界。任何真实signal/fork/wait/prctl漏mock都MAJOR并阻止真实pilot。检查current C pin/manifest一致（只读已生成产物），无需运行。输出目录=/mnt/c/workspace/videoworkline/Narralens/docs/execution/A/implementation-20261111/R2/native-composition-implementation/resume-claude-20261112/repair-060p5e-proof-and-publication/independent-review/startup-reaper-review