# D10 MAIN 修复候选第二轮独立复审

**REQUEST_CHANGES — BLOCKER 0 / MAJOR 1 / MINOR 0（本轮未关闭问题）**。

冻结 `13496366d9c0a2ff3aec5efa4798ce6b5f1c9818`，原目录 `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`。未参与实现，不派生实现者。读取正式 ROUND2_REVIEW 票、MAIN AGENTS、首轮报告/原探针、MAIN 修复报告与验证记录，复审四路径及原 Coordinator/Publisher/RecoveryFiles/RetainedSourceTree/closed commit 的相关调用。本报告不覆盖首轮结论。

## MAJOR-R2-01：无 adoption 时 surviving authorization 仍未绑定完整 execution

位置：`src/host/agent-driven/created-source-recovery.ts:570`–587；提前接受路径536–540、594–603及806–829。对照 `src/host/agent-driven/created-source-adoption-service.ts:63`，以及 `created-source-ports.ts:221`–228。

本轮已修复“根本不查询 surviving authorization”，但仍遗漏 `input.execution.authorization_id`。prepared authorization 只含 project/run/approval/facts digest；新的检查将不可变 plan 摘要与授权摘要比较，却没有把请求 execution 与该 plan 的 `producer_execution` 比较。approval 字段核对覆盖 plan_version/step/attempt/input_digest/run_scope_digest，却不含 authorization_id。plan 摘要确实包含原 authorization_id，但单独计算原 plan 的摘要不会证明请求中的 authorization_id 相同。正常 adoption 服务63行已有完整 canonicalDigest(execution) 比对，可直接证明这里缺少同一约束。

最小复现输入与路径（**静态逐条件确认，本轮未额外运行重型反例**）：

1. 使用现有 `recoveryFixture({publish:false})`；保留真实 prepared authorization、impact plan、approval 和完整原 author/base/owner，以测试已有的受控损坏 seam 删除 adoption fact并恢复 trigger。
2. 只将 request.input.execution.authorization_id 换成另一个满足 schema 的 grant ID（例如原值加合法后缀），保留其他 execution/project/base/source/impact/approval 字段；使用原 contentDigest 重算 request_hash。
3. 531–533仍通过 schema/hash/project/base；567–568的run/approval未变，573的原plan hash未变；582–587全部被比较的字段未变。函数返回 true，536–540返回ok，594–603在无发表证据时进入原author证明，最后abort。
4. 预期：与不可变 producer execution 不同的请求应在owner/author proof前被判 REQUEST_NOT_LEGITIMATE，由原Coordinator持久attention并保全其他状态。当前可在已证明完整原author后错误中止。

影响：上一轮 MAJOR-02 的“损坏请求先保全”共因尚未闭环；不是可越权提交的证明，而是恢复把无法关联原执行授权的请求当成合法早期事务，读受控源并作终态决定。修改请求hash不能替代历史授权证明。新增两个授权用例分别改 approval_id 和保持全部匹配，均未触达 authorization_id 这一单字段差异。

建议修复边界：将 surviving immutable plan 中完整 producer_execution 与请求完整 execution 比对，保留真正无授权分支和全部匹配正向对照；增加仅替换 authorization_id 的真实 producer 回归，保留旧源真实失败。此处仅审查建议，本人未修改实现/测试。

独立性：在收到 MAIN 的同一疑点通知前，本轮已经从恢复代码及原 adoption 完整执行绑定比对识别该缺口；随后通知作为交叉确认，不作为结论依据。静态证据与运行证据明确分开。

## 上轮缺陷关闭情况及继承核对

| 项目 | 本轮判断与证据 |
| --- | --- |
| MAJOR-01 早期guard清理 | 原两个裸 finally 改为624–627、826–829调用统一releaseGuard；1218–1231聚合记录错误且不覆盖主操作。构造失败1015行登记cleanup错误；lease/publisher释放658/755也聚合。首次abort仍返回实际aborted，后续同项目拒绝，close报告错误。新增诊断与真实prepared路径覆盖，原缺陷关闭。 |
| MINOR-01扫描关闭 | 340行通过#admit登记整轮；360行内部#recover继续，不再请求新公开受理；390–397在callback前登记promise，close1241行后等待全部受理。新两项目队列用例覆盖正在执行的扫描，原缺陷关闭。 |
| MAJOR-02既有授权 | 查询前移535行，approval_id不匹配被拒绝，匹配对照允许安全abort；完整execution仍有上述MAJOR，故只部分关闭。 |
| 请求/原状态机 | 精确wrapper、schema、hash、project/base、family分类与队列内重读保持；attention持久化，扫描进展来自DB终态，attention/recovering仍unresolved，未制造新状态机。 |
| published/补偿 | 私有RecoveryFiles lease、Publisher和原closed commit组合保持；原source/identity/owner/base、authority/rights/selection/最终门重验及真实restore/fsync路径没有本轮退化证据。资源模块内部失败记录仍保留；关闭全attempt聚合，不声称未知FD已关闭。 |
| committed/原adoption | 原receipt/key/digest/principal/correlation/Applied/txn/snapshot/revision校验及不重复消费保持；adoption源码/测试与前轮字节相同，未重跑其50例。synthetic pointer不是合法后继。 |

构造及清理注入先释放真实FD，再模拟结果未知；诊断权威种行只证明生命周期，不冒充生产bootstrap。完整扫描受理机制的microtask顺序和close缓存promise也经代码检查；没有在回调前漏登记受理工作的本轮证据。旧481行关闭测试的证明能力有限，新增交错用例补上此边界。

## 本轮执行与证据边界

唯一重型命令在MAIN原目录运行一次：

```sh
corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/created-source-recovery.test.ts -t "MAIN lifecycle|MAIN authorization|MAIN cleanup|commits the original published transaction exactly once|resource cleanup failed"
```

实际 **9 PASS / 22 skipped / exit 0**（新增7、继承2），完整输出 nine-cases.log，精确argv和九个命中名称见 nine-cases.command.json，退出与log SHA见 nine-cases.result.json。不是完整31项或原50项重跑；实际生产fixture涉及本地Host/media，仅此精确argv获重型授权。九例通过不能覆盖本轮静态发现的authorization_id缺口。

完整tsc **exit 0**；原探针 **exit 0、两项defect=false**，首次abort保持aborted、第二事务保持received/deferred、close明确报告cleanup错误，扫描两行均attention且sweep_resolved先于close_resolved。结果见本目录 tsc.result.json、original-probe.result.json及相应完整log；均由 subprocess.run 实际等待退出，不使用管道head或外层shell成功冒充子命令成功。原探针逐字节复制到本新证据目录运行，仅改变脚本位置，使其自有临时目录也落在本轮可写范围；imports仍指向原MAIN源码，未复制工程或node_modules，原脚本未改。

historical-verification.json：四文件均匹配正式票SHA及冻结blob；MAIN七捕获log SHA/exit一致；full006/type007各620项完整捕获输入与冻结当前字节一致。旧lifecycle001的三真实断言失败、old-authorization002的真实错误abort，以及type004的测试类型exit2分别保留；类型错误不算业务反例。MAIN full31PASS属于内部证据，本轮未冒称全部31独立重跑。

before.json与after.json保存648个源码/测试/工具/合同/根配置及AGENTS、索引/HEAD、55个原独立及MAIN捕获证据前后核验。前后所有648项文件及55项既有证据无变化，HEAD和索引不变，唯一dirty仍为原AGENTS，探针临时目录已清理。新日志不覆盖首轮；Git仅只读，未reset/stash/checkout/add/commit。

## 交回范围

结论仅针对四路径冻结模块，当前不得 bounded ACCEPT。所有自有命令真实结束后只读交回并释放唯一重型槽，MAIN可按其授权安排修复；本人没有源码/测试/工具/配置/索引写入。

Host生产挂载、generic/scheduler组合、真实SIGKILL、真实合法后继、NativeAck、Studio、影片及A人工验收仍NOT_RUN。本轮不扩大到这些门，也不代签人验。
