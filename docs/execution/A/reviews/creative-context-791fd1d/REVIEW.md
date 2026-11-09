# 冻结791fd1d Creative / Context链独立验证：PASS（限定范围）

**结论：本批Creative / Context链 PASS。** 输入是MAIN实际目录 `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration` 的完整冻结提交 `791fd1dfb8958889c101715a68cc628898ed650c`，测试前后HEAD相同且工作树clean。本人未实现本批MAIN改动，验证期间MAIN暂停源码写入与测试。本人只读MAIN源码，日志/报告仅写BRIDGE自身目录；未启动浏览器或ffmpeg。

此结论不签完整A03/A04/A、不代签人验、不证明生产Run执行、许可、原生UI加载或正式导出。原BRIDGE50f4源未改，先前76607创建链结论不被冒充为此次全部重跑。

## 本次独立命令与结果

| 实际命令 | 句柄 / 结果 |
| --- | --- |
| `corepack pnpm exec vitest run tests/agent-driven/integration/creative-context-host.test.ts tests/agent-driven/integration/agent-http-router.test.ts --maxWorkers=1 --minWorkers=1` | exec session79293 terminal exit0，2files18/18，40.78s |
| `corepack pnpm exec tsc --noEmit` | 顺序exec session17953，exit0，stdout/stderr空 |
| `python3 -I tests/m2.1-golden/source-digest-v1.golden.py tests/m2.1-golden/source-digest-v1.vectors.json` | 同session17953，在tsc结束后执行，exit0，10 vectors failures0 |

同目录tests/typecheck/golden各有.cmd、.stdout.txt、.stderr.txt、.exit；input.json及final-state.json保留前后身份/状态。SQLite experimental warning原样保留，不是失败。测试结束未见vitest/tsc/golden残留，已通知MAIN释放本次独占槽。

## 初始发现的冻结复核

| 发现 | 冻结修正 / 本次独立验证 | 状态 |
| --- | --- | --- |
| C-R1 runToken遗漏grant/confirmation造成异步混版本 | 最终同一SQL事务调用readCurrentRunInTransaction；真实持久observer case在native观察期间写授权后返回新授权 | CLOSED（本链） |
| C-R2 非creator job误落409 | 先核creator job身份，其余缺producer明确503；真实queued render Job的HTTP Context503，job.read先owned项目/实际job.project_id再503 | CLOSED（本链） |
| C-R3 future-issued投影active | 统一trustedGrantConfirmation核精确来源/范围/时间；future/missing不可用授权投影null，readGuardFacts grant=null；当前有效/过期/新有效优先对照 | CLOSED（本链） |
| C-R4 严格投影回滚pause/cancel | 读侧排除不可用授权而非抛错；执行#requireActiveGrant仍严格；两个实际SQLite service pause/cancel用例核返回null授权、持久收紧、后续start拒绝 | CLOSED（本链） |
| C-R5 content.relay任意project错关联 | 同事务owner之后、幂等之前contentAuthority核nonnull owned committed+origin Intake匹配；unknown/foreign/自身不匹配拒绝、matching/replay/null成功 | CLOSED（本链） |

artifact幂等receipt项目字段修正与真实SQL成功/重放已覆盖；旧MemoryRepo纯域成功未替代生产数据库验证。Script/Storyboard真实HTTP写入保持author source及project revision不变；坏ref/hash/input、跨owner、同owner另一project ref拒绝，问题闭包变动后旧key仍回原artifact、新stale写拒绝。未见当前已注册artifact/context/content.relay入口的剩余具体越scope问题。

实际Native inspect/source drift Context409、权限先于源读取、FIFO替换源在3秒deadline内明确503且Host可close，本次独立通过。SourceDigest用同fd NONBLOCK/NOFOLLOW/regular stat/read/finally close，摘要域及正常文件语义不变；独立Python10 golden通过。更广TypeScript M2.1 相关组是MAIN R8证据，未在本次18项外再跑一遍。

## 冻结manifest核验

`docs/execution/A/creative-context-evidence.json` 中12份source及49份capture artifact，共61项，均逐项比较：manifest bytes/SHA256、`git show 791fd1dfb8958889c101715a68cc628898ed650c:path` 的实际bytes/hash、当前工作树bytes。**61/61一致**，详情evidence-check.json。公开CP contracts/registry相对4b683未改。

manifest的base_commit4b683及capture_dirty:true记录提交前捕获事实，不是当前dirty；当前冻结tree与manifest内容一致。原失败capture保留：main-relay-scope-before非法冒号fixture400不作旧行为证据；main-relay-scope-negative unknown=200、main-safe-control-before两项回滚、main-source-fifo-before挂请求分别是MAIN真实负向历史。本人核其产物hash，没有重新checkout旧源码跑这些失败。

MAIN报告的R8 15files232/232、其Python10、scanner505files0 findings只标MAIN执行；本次独立结果严格为上述18项+tsc+Python10，不扩写成独立232或独立scanner。

## 仍保留的交付/证据边界

Observer授权及safe-control用例虽用真实持久SQLite，却注入明确的synthetic eligibility/adoption port；不证明真实rights、四能力事实或生产Run执行。生产CreationApplication仍没有run dispatch等执行producer，不能凭组件成功打开缺事实路径。

当前NativeContextPort未生产装配，Context依旧ack/selection null、native_sync unknown；不能解释为原生UI已加载。创建/内容/context均限已实现created分支，其他未交付producer明确unavailable，不补假数据。

本轮独立HTTP测试不含新一轮SDKstdio→Context全链、不含UI、真实影片/人声/许可、正式Delivery/双导出、T20全链或人工验收。Script声明段落规则已读源码；旧测试标题提到dangling paragraph但未另构造专门负向，不能按名称计新覆盖，该简单成员校验并非本轮剩余阻断。完整A03/A仍需后续冻结组合与实际产品入口验收。

后续源码变化须另绑SHA。本报告仅关闭本冻结Creative/Context链的具体发现和本次授权验证范围。
