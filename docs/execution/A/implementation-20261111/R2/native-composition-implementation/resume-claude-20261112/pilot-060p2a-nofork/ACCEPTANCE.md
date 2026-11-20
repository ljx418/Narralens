# 无 fork 首次真实内核验证

结论：仅此两个用例通过；不是 N1/N2、ISO 全套或生产接受。

- identity：runner exit 0，固定 Python/C 原字节匹配；实际 C=186046、PPID=186039、PGID=SID=186046、start_ticks=280962；SIGTERM 后 C 自身 exit4、真实 exit/close，原 epoch gone。C 的非0不是创作结果：本用例从未授权 N。
- assertion-failure：runner exit1 为精确预期，error=EXPECTED_ASSERTION_FAILURE、fault_case_passed=true，无其它 unexpected/reporting/evidence 错误；实际 C=187139、PPID=187132、PGID=SID=187139、start_ticks=289460；真实 exit/close 后原 epoch gone。
- 两捕获各649项输入当前匹配，source_changed/source_added为空，原始日志摘要正确。独立/proc观测看见固定 recorder→Node→C 链；所有观察到的原epoch现已gone；无控制写、无AUTHORIZE_FORK、无N。
- 证据：RELEASE.json、MAIN_IDENTITY_VERDICT.json、MAIN_ASSERTION_VERDICT.json、MAIN_COMBINED_VERDICT.json、两PROC_RECEIPT以及原recorder捕获；每个判定中有SHA256产物路径。运行根内preflight.json/outcome.json保留，仅清理已终局后的自有空HOME/XDG/temp目录。

边界：没有持久化原始HELLO帧；seq/protocol/subreaper/epoch检查由受审固定工具实际断言证明，不能冒充原始socket转录。第二次Node退出到Z时/proc/cmdline变空导致末样本role被误标，保留原始观测，用同PID/startticks较早样本在独立ANNOTATION说明，不改原数据。

原14生产finding仍OPEN，未验证N创建、exec、采样帧、收养/整树wait、负例、Q2、Chrome、父FD、完整workspace、视频双导出、全量门、冻结外审、下一接线包。不得用本门签整体验收。
