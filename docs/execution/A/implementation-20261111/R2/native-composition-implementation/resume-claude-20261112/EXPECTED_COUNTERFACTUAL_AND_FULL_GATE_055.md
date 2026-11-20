# 055 Expected回归、两条真实反事实与完整check准入

054最终9PASS由MAIN核实rawlog/result与当前626inputs，唯一批准render测试变化，5active/6refused证据索引存在。现在全部正常候选源码冻结。只许可下面准确验证序列，以及两条极窄、必恢复的临时变异；不是新功能开发。runtime仍唯一Claude重型槽。

## A Expected旧行为回归

原recorder一次完整tests/agent-driven/integration/created-native-ack.test.ts，capture n1n2-claude-055-expected-regression-001。原84条冻结验收断言须映射原编号，当前整文件可能包含新增测试（既往85）；按实际计数，不把新增数冒充覆盖、不能跳过旧断言。实际exit0、单独tool读取、当前inputs匹配和owncleanup后才进入B。

## B 反事实：真实命中，而非编译/缺文件红

B1 LF03：仅src/host/agent-driven/local-asset-registry.ts，原字节完整存独立备份。将已发布文件ctime变化后的允许同FD二次证明临时替成旧严格身份拒绝：建议在#hashFile取得after stat之后添加精确published&&fingerprint(before)!==fingerprint(after)拒绝，保留其它逻辑。只运行local-assets-host.test.ts中“proves a published blob again when only the change time of its inode moved, and keeps every other change refused”。原候选先该case实际PASS，变异后必须由预期合法发布被错误拒绝而失败，不是syntax/timeout/模块缺失；保留准确补丁、SHA、命令和rawassertion。

B2 PF03：仅src/host/agent-driven/created-native-workspace.ts，把#produce释放after/POST树的catch中cleanupFailures.push(error)临时去掉；仍实际执行after.release，不泄漏资源，不动PRE。只运行native-cache-witness.test.ts的K05-c。原候选先PASS，变异后必须失败于缺失POST genuine cause（例如2期望只得1），不得以编译错误/新测试不存在算red。

每个反事实单独控制：baseline green → 完整原字节备份及all-input inventory → 精确一次注入（锚点须唯一匹配，否则STOP不猜）→ 原recorder新唯一mutationcapture，运行内该变异源码冻结 → 无论结果如何finally**在实际命令/子进程终态后**从备份逐字节恢复（绝不git checkout/reset/restore）→核对全部正常候选35guards、626inputs与index/AGENTS → 原候选同一case再PASS。两项不得叠加、不可与任何其它测试/审查并行。反事实NONZERO只在指定语义断言真实失败且恢复后PASS时算gate bites，不盲把exit1算通过；若mutant不红或baseline/recovery不绿就保全并停在该项，禁止顺跳full。

允许在自身docs/parallel/lane-product/A-R2-20261112/N1N2-native-source/mutation-055/写一次性控制脚本、补丁、备份和receipt，控制脚本也给SHA。原run-recorded.py不可改。控制脚本用try/finally包住临时变异恢复，记录actualchild终态；旧日志/源码备份不覆盖。新429禁止自动重试，安全finally只用于结算自己在途命令和恢复原候选，不算继续开发。

## C 全量门禁与生产构建

A及B两个语义gate bites、全恢复后同case绿、源码/fixtures/config/index全部匹配且ownresources结算，允许一次corepack pnpm check，经原recorder n1n2-claude-055-final-check-001。读取package实际脚本，记录其子步骤实际执行/NOT_RUN；通常依次tsc→vitest→Python golden→vite→vite.m5，&&前失败则后续NOT_RUN。不得把包装shell echo的0当check0。默认worker/timeout不改，不并行其它heavy，不挑结果/自动重跑。check非零/漂移/cleanupuncertainty立即停并报告最早真实原因，禁止自修源或测试/预算后重跑。check绿也仅为当前dirty候选实测，未获得冻结commit独立外审。

## 交付及边界

所有命令唯一capture、完整hash字节备份、真实终态另tool读result/rawlog、每步自有资源PID归属与清理。完整check可能较长，发实际进度/当前capture即可，不以静默推断退出。realexport测试当前会在自有evidence路径自产新媒体，这是批准的运行产物，不改author源码或原证据索引；CAPTURE_ID用此次正确唯一值，不覆盖已封存产物。

最终交Expected原编号映射、两反事实before/mutant/restored语义与源码恢复证明、actualfullcheck脚本分步exit/计数/构建产物SHA、所有真实失败证据、原17逐项覆盖/缺口和自有资源终态。禁止把A两条中文影片或UX/human/下一接线开发写PASS。后续由MAIN形成精确提交范围（不包括用户AGENTS）、对3个tinyopaque fixture显式force-add并验证干净checkout可复现，再冻结commit独立复核。当前无任何Git index/commit/push/reset/stash/checkout权限，不进下一接线、不forcepush、不删旧工程。

Headless静音loopback、不J盘/安装/下载/付费/外传、Expected015/pin/配置/运行器不改；新429立刻停，不自动retry/换供应商/接手。工作区直接videoWorkLine同级，不新增worktree或嵌套目录。
