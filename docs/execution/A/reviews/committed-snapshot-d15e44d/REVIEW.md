# Committed snapshot read chain 独立冻结复核

**限定PASS：已提交快照读取权威及固定原生parser读取的本次范围。不是render、A06整包、T20或A整体通过。**

冻结fullSHA：`d15e44d1d9739febdc0f47e260b06b4a3881ab1c`。审查上下文a_media_independent_review未参与实现；MAIN授权独占单worker复验。开始和结束均精确该HEAD且git status --porcelain为空。报告只绑定本SHA，不外推MAIN随后开发。

独立核对 committed-snapshot-evidence.json 的8个源码和43个产物，共**51/51** bytes/SHA一致，并逐项与git tree实际字节比较；另记录package/lock/四个直接测试文件摘要。manifest的capture_dirty=true保留MAIN原采集历史，当前独立冻结输入由clean检查和tree/worktree三方摘要另证。

实际exec session **70222**（启动chunk a47a07），实际执行：

```text
corepack pnpm exec vitest run tests/agent-driven/integration/committed-snapshot-host.test.ts tests/agent-driven/integration/pinned-snapshot-inspection.test.ts tests/agent-driven/media/preflight.test.ts tests/agent-driven/media/snapshot-copy.test.ts --maxWorkers=1 --minWorkers=1
```

**4文件30/30通过，真实exit0，40.87秒**。stdout/stderr分别保存；stderr仅SQLite experimental warning，未删掉。未执行额外tsc、旧M1B probe、scanner、全量回归、浏览器或ffmpeg/render；MAIN已有tsc/golden/扫描只是经摘要核对的内部证据，不能冒充本审查者重跑。

## 源码独立判断

1. readerForTransaction只对同principal拥有的created project开放，精确要求指定transaction同project且state=committed，snapshot/digest/engine一致，snapshot ID由项目+source摘要导出，返回revision=该transaction.base_revision+1。并非从活动pointer推测旧revision；宽泛snapshotIsCommitted不能替代该精确检查。
2. CreatedSourceFact经不可变表及canonical摘要验证，读前/读后重建同一binding；closure路径来自该snapshot source，非author工作目录。目录/源路径及每个file有realpath/nofollow/regular/nonblock与hash/bytes复验。资产集合与fact一致，许可来自fact，缺producer/fact fail closed。
3. 原CSR-R1具体FIFO窗口已修复：原路径先用安全descriptor读取bytes，仅以这些bytes写私密700 temp及600/wx film.html，委托原pinned loaded parser并finally清理；adapter将parser返回textSHA绑定本次digest film hash，字幕同fd安全读取并绑定digest。没有fork解析器或改vendor。
4. cancel仅before/after检查，不是宣称可抢占任意CPU/内核I/O的硬20秒deadline。raw路径错误经authority.readSnapshot固定消息包装，不从MEDIA.failure泄漏绝对Host/temp路径；失败adapter初始化可重试。
5. 空created工程仍返回0帧，字幕/rights缺声明和许可事实不被补造；MEDIA固定preflight继续阻断交付。CreationApplication只是Host-only property，未登记不具事实的task/render/Delivery能力。

本限定范围内未留已证实P0/P1/P2。原CSR-R1从SOURCE_FIXED升级为**FIXED / INDEPENDENT_CASE_PASS**，不是把原问题删掉。旧代码实际FIFO超时失败、R3旧mock text不一致失败以及历史M1B probe失败全部保留。

## 独立实际用例与边界

| 文件/用例 | 本次结果 | 证明边界 |
|---|---|---|
| committed-snapshot-host，11项 | PASS（26852ms） | 真Host创建/commit，准确request/owner，author漂移不改变snapshot，事务状态重查，字节变更，外链source目录，调用前FIFO，错误消息/恢复，parser init恢复，parser阶段FIFO，digest后同文档不同字节严格409 |
| pinned-snapshot-inspection，1项 | PASS（759ms） | 原固定parser读取原生三page/音频工程；先明确断言原override完整性问题，再仅私有副本经真实native mutator去override，900帧、30fps、3page/1sound/字幕；旧摘要严格409且无额外写、预取消拒绝、非法UTF8拒绝 |
| media/preflight，10项 | PASS（20ms） | 模块级缺项/许可/规格与固定门验证；不是真encode |
| media/snapshot-copy，8项 | PASS（20ms） | 实际文件复制、闭包/hash/路径保护；不是真render |

parser阶段FIFO用例现在要求ENGINE_UNAVAILABLE，mkfifo/setup assertion不会再被“任意拒绝即成功”吞掉；同文档追加注释仍被hash严格409拒绝。修前main-parser-fifo-before中的真实超时仍是有效红证据。

旧m2.1/m4a mock修正仅让其text等于实际disk字节，原ENGINE_UNAVAILABLE/完整性断言保持，未降低新hash绑定。本审查读取了这些差异；未额外重跑那两组（MAIN R4相关回归摘要已核对）。

历史tests/m2.1-probe/openfilm-upstream-probe.mjs曾在原M1B含shot-02 override时错误期待problems=[]而失败，后续检查NOT_RUN；本次**没有重跑、修改或放宽它**。新probe首先要求该override问题仍被报告，再只在mkdtemp副本中真实nativeedit，以明确范围验证当前可表示工程。不是悄悄修改原作品以调绿旧probe。审查额外在测试前后独立记录原M1B film SHA256，均为 `cc5ad804621626d3fa1ae5dc981de812b70ffcc4e2492bc5bd690f2181474915`；原件未改变。

## 不得外推的结论

真Host读权威case使用当前真实created producer的空0帧工程；900帧非空工程case证明固定adapter/parser读取，未登记为完整committed SnapshotReadPort生产影片。两部分均真实，但不能拼接宣称已有“非空正式commit→授权render→交付”的完整链。

没有证明任意历史migration/无created_source_fact项目可读（当前明确拒绝），没有实测真实下一revision commit后旧历史读取/T20-G、读取中外部DB事实改变的全部并发矩阵、真实导演编辑区/原生ack、AttemptFence/lease/取消、DeliveryCommit/下载/outbox/重启恢复。没有encoding/full decode、真人中文旁白或60–180秒授权影片；非空900帧inspection不是A片、真实语音或实际渲染。强制缺字幕/rights许可门继续保留。

因此：读取链本批限定PASS，正式Task/Run/producer/Delivery/full T20、A06整体与A人工验收均未据此完成。独占测试进程已终态、资源已释放。

证据：input.json（51项manifest/tree/worktree核对和附加输入摘要）、tests.cmd、tests.stdout.txt、tests.stderr.txt、tests.exit、completion.json、artifact-hashes.json。
