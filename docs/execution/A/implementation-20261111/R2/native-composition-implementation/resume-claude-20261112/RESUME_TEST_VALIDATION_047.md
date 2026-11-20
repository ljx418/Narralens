# 047：工具恢复验真后的单项修正与缓存验收重新激活

新唯一writer ctx_a8de95aeab93，task仍task_5dcbe8192764；旧writer ctx_ae73a82c85e9已确认退出和释放。新上下文实际Bash probe输出NARRALENS_TOOL_CHANNEL_OK/exit0、读取工具有效；MAIN又核实626inputs全匹配、HEAD e2eff61b464d75d36598103d718cd2a75db5dfda、index空、protectedAGENTS不变。恢复只证明工具可用，不证明业务通过。Orca全部9工作区平铺；继续复用当前实施树，不创建新worktree/嵌套目录。

本文件正式解除046首次只读暂停，替代旧writer身份与旧runtime授权。只允许tests/agent-driven/integration/native-cache-witness.test.ts内Q01 registration genuinecleanup这一项oracle及必要说明修正；其它生产/测试/config/fixtures/index全部保持本JSON摘要。

## 真实生产检查顺序与修正

MAIN重新读实际源码：produceNativeCacheEntry先#closing，#produce先模块私有lease存在/同service、再facts.lease.assertCurrent、再producer品牌，最后才#uncertain。因此之前MAIN说保存原lease后必得到CAPABILITY_UNAVAILABLE/UNCERTAIN不准确，本裁决纠正；不得据此前预期去改生产检查顺序。

当前用例故意删除root，后续f.productionLease()在fixture重新取lease时同步REVISION_CONFLICT，根本未调用production。应在破坏root/registration前保存真实productionLease，servingFor和后续produce都使用此保存lease。后续真正production先检测stale，严格断言NATIVE_CACHE_PRODUCTION_STALE，说明这是前置拒绝而非uncertain分支覆盖；同时现有真实genuine对象确切一次、primary精确code、服务uncertain=true、实际listener关闭且无见证仍须成立。实际uncertain分支已有未删除的factory cleanup case负责，不能将两个控制流混称。禁止anythrow、伪造lease/ledger、mockproducer或改生产实现。

## 分层验证序列

原run-recorded.py摘要88cd47ec732a340f54cdd4bb05b05878887697eebb0ddc94b1ccd7d0e434fd10不变；完整候选字节backup/hash、每次运行内全输入冻结、每次终态后另tool读result/rawlog并自有清理。精确命令和唯一capture见JSON：
1. 编译047-tsc-NNN。仅本oracle引入语法/类型错误可在本授权test范围修后新编号编译；失败原样保留。
2. 小门047-registration-NNN，仅-t完整唯一registration测试名。仅本批准oracle的错误可在确认命令终态/清理后同范围修正，再新编译/小门；其它case或生产缺陷则停止报告，不越权修生产。无次数硬上限，不盲重跑。
3. 最新小门实际1PASS、候选hash稳定后冻结所有源码，一次047-focused-lifecycle-001（15重点用例）。任何失败立即停止，不自修/重跑。
4. 重点实际15PASS，单独tool读终态、hash匹配、自有清理完成后，一次047-native-cache-full-001（完整31缓存用例）。结果无论如何均报告MAIN并保持冻结，禁止自动reader/其它suite/full/build/mutation。

单一Claude重型槽，全程Headless静音loopback，不J盘/下载/付费/外传。不改AGENTS/Expected015/EnginePort/公共DTO/pin/配置/旧Gate/索引，不git add/commit/reset/stash/checkout/push。新429立即停，不自动重试/切供应商/Codex接手。工具再出现异常格式立即报告，不能伪造工具执行。保留此前全部失败，不用新绿覆盖旧红，不宣称原17/A/V1或冻结外审通过。
