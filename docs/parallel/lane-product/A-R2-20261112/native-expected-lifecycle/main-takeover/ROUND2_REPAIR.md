# 独立审查两项 MAJOR 修复

原审查冻结 0ddacd4，结论 REQUEST_CHANGES；所有原证据保留。审查已 worker_done 并以 READONLY_HANDOFF.json 交回，MAIN 仅修改相同两个文件；未触碰 integration Claude writer 或其捕获。

MAJOR-01：prove 在第一次 isCurrent、load/read 与投影计算之前建立一份 immutable binding snapshot；四个原有准入点共同校验它，投影使用同一不可变基线。全部回调及绑定字段读取在 closed/cleanup 私有末端 fence 前完成。不再计算完投影后采集“已变化的新绑定”冒充原绑定。加载期间变化在 read 前拒绝，read/compute/canonical/getter期间变化拒绝并释放真实 FD。

MAJOR-02：releaseResources 首次 close 异常的 catch 立即置 cleanupUncertain，再继续其余关闭回调。保持全量恰好一次尝试、主错误与清理原因，以及不重试未知原始FD语义。覆盖 release 与 prove failure 两路径、另一已发行凭证的同步重入。

新增7永久用例在旧0ddacd4源码上全部真实失败（root005，7FAIL77FILTERED）；新源码 root006 全84PASS。旧用例“最后isCurrent改变绑定”由延后 assertCurrent 拒绝加强为 prove 阶段拒绝，并追加FD关闭断言；非删测试/减断言。其他原77用例与MAIN先前四用例全部保留。

root007 原独立三场景探针未改字节重新执行，exit0，均 defect=false；root008 原六场景探针 exit0；root009 完整tsc exit0。五次捕获输入无变化，42保护文件逐一不变；摘要与实际命令见 round2-verification.json / *.cmd.json。当前只是两文件模块复验，尚需独立复审，未导入MAIN，不声明原生reader/NativeAck/Studio/影片或A通过。
