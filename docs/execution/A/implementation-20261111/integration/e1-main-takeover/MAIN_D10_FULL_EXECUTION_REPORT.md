# MAIN D10 完整执行授权绑定修复

候选由MAIN实现，独立复审仍待签署。唯一源码变化：恢复合法性门的有adoption和 surviving authorization 无adoption 两个分支，都要求完整 canonicalDigest(input.execution) == canonicalDigest(plan.producer_execution)。不只比较grant是否仍有效，不回填请求，不增加强制参数，不改变原ApplyChange、计划哈希、原DDL/Coordinator/Publisher/RecoveryFiles或九字段提交。

新增两个真实producer负向：保留原immutable impact plan、approval和prepared authorization，仅替换schema合法authorization_id并重算request_hash；分别删除adoption fact、或在受控测试损坏seam将adoption.execution一并改成请求值。原1349636两例都实际错误abort而断言失败；新源两例均在owner/author guard前持久attention，并核对source字节和inode/mtime、approval/impact/revision/pointer/step/outbox/idempotency/journal不变。第二例专门防止拿两份同时损坏的重复记录自洽当原授权。

真实门：old-full-execution008 exit1，2失败/31过滤，均是业务断言非fixture错误；full009 exit0，33/33；type010完整tsc exit0。三个捕获18文件都记录argv、完整stdout/stderr、actual exit、log SHA256、before/after输入。full009与type010的所有输入逐项匹配最终源字节，无source changed/added。旧三轮全部失败和成功证据及报告保留。

内部四视角：合同沿用原producer完整execution绑定；实现两个历史分支均检查且真正无auth/noadoption独立早期分支保持；体验拒绝损坏请求而不错误中止/读author，不影响匹配授权安全abort；测试实际完整33项覆盖既有commit/补偿/资源/关闭及正向匹配对照。此前独立关闭的清理和扫描问题不重开、不冒称本轮自审为外审。

未变边界：新服务未生产Host接线，真实SIGKILL、真实合法后继、NativeAck/Studio/影片/A人验未运行。下一步先独立复核精确新四例，再按原后续连续接线计划推进。保护AGENTS未提交工作，未reset/stash/push/合main。
