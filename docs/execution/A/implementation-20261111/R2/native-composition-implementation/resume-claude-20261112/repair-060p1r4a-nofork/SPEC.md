# R4A：仅修独立nofork工具的NF01..06，不改生产链

原Claude唯一实施；新429立即停，不自动重试/换provider/Codex接手。W=/mnt/c/workspace/videoworkline/Narralens-agents/main-integration。完整读本RELEASE.json、/mnt/c/workspace/videoworkline/Narralens/docs/execution/A/implementation-20261111/R2/native-composition-implementation/resume-claude-20261112/repair-060p1r4-nofork/independent-review/nofork-safety/REVIEW.md与FINDINGS.json。MAIN核63输入无漂移，独立审查REQUEST_CHANGES 3MAJOR/1MINOR。只改tools/native-cache-nofork-pilot.mjs及tests/agent-driven/integration/helpers/native-cache-nofork-pilot.test.mjs，所有原25保护源/报告/manifest/AGENTS字节不变。保R4报告/四失败/后续绿，不覆盖。无新增文件、无Git变更操作、无生产/Npositive修复。

1. NF01：post-spawn任何证据/log写失败不能丢活owner。将runPilot和完整main纳同一个持久责任路径：owner先于每个可能throw的操作登记，write outcome/held/final证据出错保存有界原I/O error、触发失败资格，但必须仍在原finally/持责循环等完整终局；不能uncaught top-level await使detached C孤立。HELD证据写失败也同理。报告best-effort失败不删除root、不换owner、不放弃closePromise。目标真正结束后仍返回失败并保留写失败事实；能写的证据尽力写，写不了不能补造。模块导入不运行main，main可注入依赖做纯mock。不要增加全局Host补丁或genericframework。

2. NF02：error/diagnostic预算实际监听入口要统一first unexpectedFailure latch。stdout/stderr overflow、child/control/stdio error都影响最终eligibility，候选HELLO合法也不得mask；故意EXPECTED_ASSERTION_FAILURE只有这一已知注入且没有其它unexpectedfailure、完整终局成立才fault_case_passed。保存原primary与cleanupfailure，后来的错误不覆盖最早真实失败，但附有界诊断。完整decoded frame queue同时限制帧数/总bytes，不只partialbuffer。identity ok必须完整proof且无已知unexpectedfailure，不能只primary===null。

3. NF03：统一checkTerminalProof(ledger, freshobserver)用于cleanup返回、HELD恢复、main最终结果；验证实际close+exit/合法no-birth、固定原epoch freshgone/PID已换世代（只证明原epochgone，不获取新pid权限），unknown继续同owner不退出。HELD期间即使closePromise已resolved也不能只await它立即结束；在未知proc时保持有界非busyloop重查，绝不再signal已exit/reaped的C。无有限责任期，保原root/错误/唯一child。main只有完整proof成立才能结束，迟到proof只结束原失败而不洗白成功。

4. NF04：spawn无PID的异步ENOENT/EAGAIN不能dereference epoch=null。runner等真实error/close/no-birth事实并返回原spawnerror，不TypeError盖掉它。驱动runPilot/main真实顺序的测试，不只cleanupChild孤立case。

5. NF05/06：identity显式fresh.ppid==toolPid（HELLO及fresh一致）；工具实际控制通道从不write、fixedPython/C/no-authorize不变。新报告更正R4是test001..004四失败+test005绿，不叫五失败，旧报告不覆盖。

## 必须补实际main+runPilot+ledger纯mock反例

post-spawn outcome.json ENOSPC且cleanupunknown；held.json EIO；上述写失败后子仍活时原mainpromise不得reject/退出，随后exit/close/freshgone才结束为失败。合法HELLO之后stdoutoverflow/controlerror不能identity ok或fault_case_passed。持续completeframes超过queue界。HELD时close已seen但procEIO，再变gone的有界poll，禁止signal/提前返回。无PID异步error+close无exit走合法no-childconfirmed且原error不变。完整正常与期望assertionfailure对照、已有38case不删。所有测试依赖注入OS/ChildProcess/clock/fs，实际spawn guard应在被调用前throw禁止副作用，不能转发真实spawn再靠计数事后assert。测试importmain不得CLI autorun。无actualC/prctl/真实signal/kernel/Host/media/browser。

## 三精确运行，FIRST trial必须recorder

只准本JSON三条形式，cwd=W：
python3 docs/execution/A/implementation-20261111/integration/e1-main-takeover/run-recorded.py <fresh n1n2-claude-060p1r4a-name> node --test tests/agent-driven/integration/helpers/native-cache-nofork-pilot.test.mjs
同recorder wrapper node --check tools/native-cache-nofork-pilot.mjs
同recorder wrapper node --check tests/agent-driven/integration/helpers/native-cache-nofork-pilot.test.mjs
所有开发失败新名保留，无直接预跑/其它门/CLI主入口。运行源冻结，不改recorder/配置/timeout，不generation。只读源hash/git检查允许。不得联网/付费/J盘/读env/凭据/配置/新provider，保持现有所有生产findingOPEN。

OWN新增n1n2-claude-060p1r4a-report.md：每NF映射实际callsite/mockcapture/风险、2源sha、25保护hash不变、所有红/绿命令与日志、下次两条exact CLI计划及现行exit语义（identity0，assertion-failure1只有证明fault_case_passed与完整终局才是预期，不把任意exit1叫通过）。禁止声称实际子进程/内核已验收。worker_done交还writer，MAIN独立精确复验再另票运行实际nofork两case；原14生产finding/17要求/ISO18/全量/N1N2/NEXT不因此关闭。
