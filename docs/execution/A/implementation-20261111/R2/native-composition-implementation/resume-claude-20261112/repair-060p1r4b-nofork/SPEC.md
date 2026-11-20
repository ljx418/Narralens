# R4B：仅修异步stderr持责边界与两次要项

原Claude唯一实施，新429立即停不重试/换provider/Codex接手。读本RELEASE.json与/mnt/c/workspace/videoworkline/Narralens/docs/execution/A/implementation-20261111/R2/native-composition-implementation/resume-claude-20261112/repair-060p1r4a-nofork/independent-review/nofork-safety/REVIEW.md/FINDINGS.json。MAIN已核71输入无漂移；NF03..06 CLOSED_STATIC，不能回退。只改原tools/native-cache-nofork-pilot.mjs和tests/agent-driven/integration/helpers/native-cache-nofork-pilot.test.mjs，25保护源/manifest/报告/AGENTS不变，无新源文件、无生产链修复。OWN新增n1n2-claude-060p1r4b-report.md明确授权；旧报告与红绿全部保留。

A. 主要项：defaultwriteStderr现在process.stderr.write(text)只有同步try/catch，异步error EPIPE会无监听崩CLI，丢活C。给standalone main的reporting boundary在任何spawn前装真正的Writable error listener和write completion error handling（两路去重），保存有界原unexpected reportingfailure，绝不逃出持责直到完整checkTerminalProof。依旧同owner/原closepromise/root，HELD证据写不了或stderr坏了都不能放弃。不要只catchwrite同步throw，不要全局Hostpatch/改provider/config/吞错误称成功。

main与真实默认adapter共用该边界，测试用可emit error的同形Writable注入（不可只push字符串数组）。合法HELLO与HELD时异步emit EPIPE，验证无unhandled error/main不提前结束、不删根/不换owner，随后真形exit+close+freshgone才失败结束、保EPIPE。pending报告写的callback/error必须在最终资格判断里被纳入；不能main算成功后下一tick日志错误又丢失。报告错误若因已坏stream无法再写，仅保内存/尽力证据，仍等待原资源终局，不能无界重试写日志/递归error报告。listener在owner存活期不能卸除；实际模块import不自动改process.stderr，只有明确执行main安装独立工具的边界。保固定noAUTHORIZE/noN/信号epoch权限和无有限责任期。

B. 次要资格项：已完整结束后outcome.json写失败不得只kind=failed却留fault_case_passed=true和unexpected_failure=null。重新生成一致的权威结果：存原evidenceerror，identity/faultcase所有pass标记清/重算。故意断言失败模式只有EXPECTED_ASSERTION_FAILURE、完整终局、无任何unexpected/evidenceerror才算预期故障case；exit1并不自动通过。添加实际runPilot/main完整已终局faultcase+outcome ENOSPC/EIO反例，原错误与cleanup proof均保留。

C. 次要decoder项：第一次解码fatal后立刻terminallyfail/reset释放无效buffer，此channel不再feed累积、不为每个后续data无限pushnull。最多一个有界error marker，已有有效frame队列count/bytes上限不变；消费正确记账可顺手最小修，不扩大预算。实际ledger注入重复坏chunk几千次，断言decoder pending与frame/bytes/markers均有界且firsterror保留。固定C小nofork transcript的正常路径不要被过度改动。

同一现有test文件补这三条真实main/defaultreport boundary/ledger反事实，不新增框架/依赖/源码文件，已有49case不删。realspawn guard仍先throw，纯OS/ChildProcess/Writable/clock/fs边界mock，禁止运行真实CLI或C/prctl/fork/signal/kernel/Host/媒体/浏览器。无需先修production14，他们仍OPEN。

只准三形式首次全部经原recorder，cwd=/mnt/c/workspace/videoworkline/Narralens-agents/main-integration，freshprefix n1n2-claude-060p1r4b-*：node --test tests/agent-driven/integration/helpers/native-cache-nofork-pilot.test.mjs；node --check tools/native-cache-nofork-pilot.mjs；node --check tests/agent-driven/integration/helpers/native-cache-nofork-pilot.test.mjs。每次包括开发失败先用python3 docs/execution/A/implementation-20261111/integration/e1-main-takeover/run-recorded.py NAME argv，不预跑确认、不改recorder/并发/timeout，不generation/tsc/vitest/fullgate。源运行时冻结，所有红新名保留。只读文件/hash/git可，禁止git add/commit/reset/stash/checkout/push、网络/付费/J盘/env凭据读取。

交付报告明确3项actualcallsite/mockcapture与2源sha、25保护全匹配、所有失败/最终3门、NOT_RUN、下一exactnofork两CLI及exit语义；worker_done交还writer。MAIN定点独立复核这些残留，安全过才另票实际nofork两case。不得自签外审/实际内核/生产14/原17/ISO18/N1N2/NEXT，不重复完整生产重写。
