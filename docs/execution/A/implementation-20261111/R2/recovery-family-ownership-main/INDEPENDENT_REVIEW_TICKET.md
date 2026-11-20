# 恢复职责过滤候选独立实现复核

MAIN亲自实现；请BRIDGE未参与实现上下文独立只读审核，不再做实现或派子Agent。冻结 e2eff61b464d75d36598103d718cd2a75db5dfda，实际MAIN cwd /mnt/c/workspace/videoworkline/Narralens-agents/main-integration；branch agent-driven/main-a-integration，唯一原dirty仍AGENTS.md。所有src/tests/contracts/tools/config/index/HEAD从本票至交回冻结。PRODUCT ctx_52e11feda546只读设计固定4f2，不持有任何测试/源码grant。

先读当前MAIN AGENTS、你刚交付的host-recovery-composition-review、canonical本目录ADR-OWNERSHIP-001.md与RELEASE.json、MAIN integration/e1-main-takeover/RECOVERY_OWNERSHIP_MAIN_REPORT.md及VERIFICATION.json；读取全部5变更路径并审查继承行为，不能把设计正确当代码正确。
{
  "src/host/projects/project-coordinator.ts": "8dd7acf5a063bc6087a83cf0b6f4ac943c938697e564249b08ce31c20d196fe0",
  "src/host/adoption/adoption-coordinator.ts": "d67fc581a23f253b740eaaaf4b4fd9b5e0d671d3032fb0629b40008523b14179",
  "src/host/history/history-service.ts": "55238f929cf4ddf64589c59e5e8a2ec4de0ce1771a844d68b1304d659ee40044",
  "tests/agent-driven/integration/controlled-recovery-families.test.ts": "e4f3adf9cd9db48efaea65d7ef365eb05273542cc915cda4d8238dfa767554f8",
  "tests/wave2/m4b/adoption-route.test.ts": "2010e23727f8714b64041de240e2c71dbb911cf08bb82fb8d35be791a4918a44"
}

相对4f2修改只有三入口本地原classifier职责判断（历史/采用在计数/parse前仅认领自己，generic新鲜按实际行skip已知controlled）；不改DDL/gate/九字段commit/scheduler算法/原写actor。特别审查旧corrupt JSON测试前提与三族职责冲突是否按ADR正当协调：明确owned marker+坏合同仍attention/原错误码（原断言不删），完全无法解析JSON无可信family，原generic负责并保留recovering/terminal_reason+write gate阻断。不能把改fixture当原未知请求仍通过，不得抹去旧约束或虚称未知已恢复。

MAIN实际证据：旧001新增10case8真实断言FAIL/2对照PASS；中间002旧测试前提冲突1FAIL、003新增fixture参数类型error、004新增断言错读error_code而非原terminal_reason，均原样保留并区分。最终005两个纯组件文件55PASS、006完整tsc0、007真实legacyHost关闭重开2PASS；三组完整输入匹配冻结。D10 abf独立bounded ACCEPT和PRODUCT两blob84PASS/tsc0是之前有界证据，不能冒称在此重跑。

唯一重型grant R2-RECOVERY-OWNERSHIP-INDEPENDENT-REAL-001：只运行原MAIN adoption-route.test.ts -t "owned adoption marker|unparseable unknown request" 两例，准确argv为 corepack pnpm exec vitest run --config vitest.config.ts tests/wave2/m4b/adoption-route.test.ts -t "owned adoption marker|unparseable unknown request"。
允许独立纯组件命令 corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/controlled-recovery-families.test.ts tests/agent-driven/integration/controlled-recovery-scheduler.test.ts（55例），及完整tsc。0full suite/build/浏览器/provider/网络/费用/J/安装/配置/新worktree/代码变异/复制项目。若新反例需扩围先ask精确命令，不以重跑次数代替证据。

只写新canonical /mnt/c/workspace/videoworkline/Narralens/docs/execution/A/implementation-20261111/R2/recovery-family-ownership-independent/，完整argv/stdout-stderr/actual exit/logSHA、源码/索引/HEAD/AGENTS/所读历史证据前后不变，失败记录不删。允许静态最小探针仅自己新证据目录，不改任何现有源/测试/工具/配置/Git。全部自有命令终止后明确交回唯一writer与资源槽，用worker_done给bounded ACCEPT或REQUEST_CHANGES（可附具因果的缺陷）。此模块完整关闭不等于Host scheduler/native selection/SourcePort/真实SIGKILL/影片/A通过，均仍NOT_RUN。
