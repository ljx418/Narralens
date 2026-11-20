# MAIN D10 生命周期共因修复（审查交回后执行）

当前冻结 eba0d42；独立探针 lifecycle-probe.mts 两场景真实失败，六关键业务案例 exit0。审查者未最终交回前，MAIN不改源码/测试/工具/索引。接管依据用户“同阶段超过两次返工由MAIN解决”，原Claude本批未出现429，非额度接手。

## 共因与具体修复

1. 所有已取得资源都由统一cleanup记录收敛。新增私有 recordCleanupFailure(projectId,error)，将同项目多次失败聚合保留，不能覆盖丢前一个。两个 proof.guard.close 的 finally 使用同一releaseOriginalGuard helper；close失败立即sticky该项目，完整错误留给最终service.close。已真实abort的结果仍报告aborted，不能被cleanup异常改称deferred。原 publisher.close / files.release 的finally也复用同一记录方法，已有真实commit事实不回滚、不虚报资源已全部清理。
2. RetainedSourceTree 构造若抛 PublicationCleanupError，意味着构造失败自清理也未知；#guard不能仅返回unknown而放行下一次同项目。给#guard显式projectId，先sticky记录cleanup失败，再按原unknown分类保全；普通可重试I/O但清理确定的情况不永久poison。
3. 统一admit(operation)：先拒绝closed，再以Promise微任务登记pending后才执行operation，避免同步回调能在pending登记前close。recoverTransaction与recoverOnStart都走该入口；后者的整轮sweep是一个accepted operation，其内部调用私有#recover而非重新经过会因closed拒绝的公开入口。close先停止新admission，再等待所有已受理promise，之后才关Publisher/RecoveryFiles；不关闭还被已受理sweep使用的资源。保持sweep原有限DB进展/排序和所有写入authority。

## 验证

将独立原探针保持原字节重跑：旧候选exit1，修复版不得有defect。新增永久回归用真实SQLite/Coordinator/queue/FS/retained guard，但明确标为seeded diagnostic authority、非bootstrap/Hostlisten业务验收。验证：abort后的guard cleanup失败不覆盖abort事实、同项目下一行deferred且不消费/不改行、close暴露错误；构造清理未知亦sticky；已受理sweep被close等待并完成其原有行，新recover入口在close后立即拒绝；完整sweep rejected时close仍真实等待并保全主错误。

先在原eba0d42源上用同一新增回归拿真实断言失败，保留SHA/cmd/log/exit；再修同一CreatedSourceRecovery与现有recovery.test两个文件。无旧核心/合同/DDL/Publisher/RecoveryFiles改动，不削弱任何closedcommit/gate。

新纯生命周期回归和原探针通过后，跑完整recovery文件（原24+新增），完整tsc。原adoption50不依赖新recovery模块且adoption实现/测试字节未变，不为次数再跑；若发现实际受影响依赖才扩大。所有实际Host/ffmpeg仍由MAIN明确独占slot，静音headless。按run-recorded.py新唯一前缀main-d10-*保留pre/post输入，源码/索引不在捕获中变化。新候选冻结后，由未参与修复者复审，不自签。

后续完整目标不缩减：Host三族scheduler/generic排除/运行根独占、实际SIGKILL、合法后继回执、NativeExpected reader/Ack/Studio、双影片与人验仍须逐项真实完成。


## 最终审查新增 MAJOR-02 与实际反例

已交回 REQUEST_CHANGES 后，MAIN 取得仅 recovery source/test 两路径写入权。新增独立于 adoption 的 prepared authorization 检查：现存 project/run/approval 先匹配原请求；若 adoption 缺损，用原 immutable impact plan 的完整 digest 和原 approval 的 base/control/execution 字段证明 surviving authorization。不能证明则在任何 author proof 前持久 attention；真正无授权的早期分支仍须证明原 base/source/owner 后中止。当前原实现新增三生命周期用例全部真实断言失败，原 producer 缺损 adoption + 冲突 approval 回归真实报告 aborted 而非 attention，日志前缀 main-d10-old-lifecycle-001 / main-d10-old-authorization-002，均输入稳定。未把缺损授权当成正常早期流程。
