MAIN 060P0失败分类与精确修订批准。reader-001已真实exit1，93tests=90pass/3fail，logsha d8a0fd829330e7af2de63267e20638d81cdf5fd8ddd9c7f879aad3f2b78179aa；新增K04-c/F05-c实际通过。这不是ENOMEM，不是卡死；原失败产物保留。MAIN已读三个P07和retainFile/verifyFile实现。

批准在现有允许测试文件内修订三处旧断言，依据059已审定的“预算必须在任何digest读取之前”和“读后held+named identity完整比对”，不是放宽源实现：
1) cumulative total用例：first retain后先验证readText两次不重复收费，再断言second retainFile拒绝NATIVE_CLOSURE_BUDGET，而非先retainsecond等read才拒；保留两个单文件各自合法但总和超预算的具体数值和全部deep/FD/growth子段。
2) maxTotalTextBytes40与maxTextBytes100用例：预算拒绝发生在retainFile，必须在该边界断言准确code；不允许把retain前hash恢复为旧行为。保留普通text正向/恰好预算/实际零读取证据；059独立budget用例已有直接证据可以准确引用，不伪称本P07也测了实际read计数。正确释放每个闭包，即使断言失败也不漏big子段资源。
3) equal-bytes path replacement后verifyFile旧期望true与059现在完整identity fence冲突，改为false，保留替换前true与verify整体false，显式证明held旧FD bytes尚一致但命名path已不同inode；若用readFileSync closure.probePath仅限测试真实heldFD，不新增生产绕过。原restored-write和symlink拒绝子段继续执行，不删；注释明确verifyFile现在包含named-path身份，不把它描述成仅旧descriptor字节。允许同步改verifyFile既有注释澄清真实语义，禁止改生产判定放宽。

在原060P0整文件命令前额外准一条快速定点命令（同recorder、唯一n1n2-claude-060p0-p07-NNN，默认配置不改）：corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/created-native-source-reader.test.ts -t "P07 refuses a grown file|P07 refuses a symbolic link|P07 refuses a text file"。三个用例都必须实际执行，其他skip仅因filter不计验收。修后再按原release跑完整reader、完整cache、tsc；不在同一运行中改source。其余范围/独占slot/固定bytes/原17要求不变。任何新真实失败按证据处理；普通允许范围内自行闭环，超范围或新429停止报告。MAIN不接手源码实现。
