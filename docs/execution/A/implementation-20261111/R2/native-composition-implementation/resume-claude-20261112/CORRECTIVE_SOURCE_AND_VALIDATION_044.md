# 044 精确测试修复与连续静态自验证

MAIN独立核实043实际exit1，31通过/2失败（worker标题1失败32通过错误，报告正文和rawlog正确）；log SHA 5b18c564cd785a48d42738a4c5682a59a854cd3ea7d3824e91ad99881567b75b。35输入保持原冻结，重点真实用例NOT_RUN。当前唯一writer不变。

只释放tests/m2.1/openfilm-upstream-lock.test.ts，其他全部生产/测试/fixture/config/tools/index保持043摘要。修复invokesIssuedCapability处理producer as Type的别名，包括透明parenthesized/as/type assertion/satisfies/non-null包装和链式别名；包装本身不能创造污点或赋予能力。使用实际语义同一分析器，不改生产代码/unknown类型迎合测试，不删反例或放宽任意数量断言。补透明包装正反控及纯predicate无pageFrame不算entry，保留完整name→position映射、十个原反例、本地loader/bridgeproducer反例以及词法作用域同名正控。优先拆成独立命名/表驱动it，使一个反例失败不阻断其他反例验证；不把未执行写通过。

## 新授予的窄范围连续自验证

本授权覆盖测试分析器这一文件中的必要修正和以下两个准确命令，允许在其自身类型/静态断言未通过时连续自修并重新捕获，**不需要每一个同范围修正另向MAIN申请**。这仅对本轮测试分析器有效，不是旧043失败后的追认，不扩展任何生产修复或业务运行，不覆盖新429停工规则。无次数硬上限，但每个失败必须有具体根因/修正映射，不能无修改反复碰运气、不放宽断言/超时预算。若出现需要其它文件的缺陷，停并报告精确必要性。

每个候选修正后：完整字节backup及原记录器inputs/hash → corepack pnpm exec tsc --noEmit（capture n1n2-claude-044-tsc-NNN）→实际终态后单独tool读result/rawlog并核对自有清理和全输入 →编译0后corepack pnpm exec vitest run --config vitest.config.ts tests/m2.1/openfilm-upstream-lock.test.ts tests/architecture/m2.2-fitness.test.ts（capture n1n2-claude-044-static-gates-NNN）。每个命令执行期间全部源码/输入冻结；各候选间仅此测试文件可改，其他35guard逐项比较，失败原样保留，捕获绝不覆盖。

最新候选静态实际exit0、另次tool读result/log且其inputs匹配当前、所有其它guard不变、自有清理完成后，正式冻结整个候选，条件允许**一次**真实browser重点运行（原recorder）：corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/native-cache-witness.test.ts -t 'Q01|Q02|Q03|K05-c|PF01|PF02'，capture n1n2-claude-044-focused-lifecycle-001。这是唯一重型资源槽，Headless静音loopback。真实用例一旦非零/漂移/资源清理不确定就立即停，不自行修改或重跑；成功也仅报告这些case实际结果并保持源码冻结，不启动reader/其它套件/full/build/mutation。全部唯一capture写原E目录，保留全部历史失败。

出现新429立即停并报告，不自行重试或切供应商；不得Git add/commit/reset/stash/checkout/push、改AGENTS/Expected015/pin/config/运行器/公共DTO/EnginePort/旧Gate、访问J盘/付费/外传。不是全阶段通过，不关闭原17项，不自签独立外审。
