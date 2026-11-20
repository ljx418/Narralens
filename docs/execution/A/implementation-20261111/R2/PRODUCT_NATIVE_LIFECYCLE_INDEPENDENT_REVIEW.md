# 独立复审：PRODUCT 原生 expected 凭证生命周期

你是未参与实现的独立 Codex 审查者。直接向 ROOT 汇报，不派生实现者。仅审查冻结 commit 0ddacd46feb0643296d375c3df3a6ac9ae72b401，目录 /home/administrator/orca/workspaces/Narralens/Narralens-A-R1-PRODUCT。启动先读 AGENTS.md，核对 HEAD 与两个源码字节。该目录有 42 个受保护用户文件，保持它们；不得 reset/stash/checkout/提交或修改任何源码/测试/工具/索引。

范围：src/host/m5/openfilm-native-expected.ts 与 tests/agent-driven/integration/created-native-ack.test.ts 的完整继承生命周期差异，尤其 close/release 的资源所有权、晚到 read、重入、清理失败 sticky/fail-closed、跨实例/伪造凭证拒绝、回调最终验证、绑定被回调改变、冻结 pin/loader 原有规则不退化。MAIN 因第三次缺陷返修参与实现，不能自签。当前未与 MAIN 原生 reader / NativeAck 生产组合，不将端口桩当上游原生验收。

读 docs/parallel/lane-product/A-R2-20261112/native-expected-lifecycle/main-takeover/MAIN_REPAIR.md、verification.json、before-source.txt 与 before-tests.txt；root001-old 四个真实断言 FAIL 与 root002-fixed 77 PASS、root003-probe 六场景无缺陷及 root004-tsc exit0 均保留且捕获输入不变。历史 round3 为 72 项，不冒称与后来 73 项同字节。审查代码与完整测试本身，不仅信计数。

允许：只读代码/Git；原目录纯 FS/FD unit 验证与 tsc（不占重型 slot）。有必要可重跑 corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/created-native-ack.test.ts 和未改原探针 recovered-review/reentrancy-probe.mts。不得改源码做变异（此前反例已有证据）；新增最小探针只能放你自己的独立审查证据目录，真实清理自有临时 FD，不引入 Host/ffmpeg/browser/网络/费用/J盘。保留全输出与实际 exit，不能管道 head 冒称通过。无 source/index writer 与你并发；MAIN 只维护 canonical 控制文档。

报告写到 /mnt/c/workspace/videoworkline/Narralens/docs/execution/A/implementation-20261111/R2/product-native-independent-review/ 下（只此报告/证据目录可写）。逐项列 BLOCKER/MAJOR/MINOR 和精确行、可复现触发、影响；若无 B/M，可给该两个文件生命周期边界的 bounded ACCEPT，明确非 NativeAck/Studio/影片验收。用 worker_done 回报结论、冻结 SHA、命令/摘要、残余风险；不要自写实现或扩范围。
