# ClaudeCode R6 精确实施票：C06/C07/C08一次合并

你是原ClaudeCode实现者；MAIN负责合同/计划与验收，独立Codex负责复核。本票已取得文档PLAN_READY，允许立即连续实施无需再次询问，严格遵守本目录RELEASE.json。不是另起工程、不是代码清理或公共接口改造。

先全文读取当前AGENTS及本目录：RELEASE.json、MAIN_PRIVATE_CONTRACT_DRAFT.md、MAIN_DEVELOPMENT_ACCEPTANCE_DRAFT.md、contract-review-round2/REVIEW.md。再读当前生产实际入口/全部相关direct tests，不按旧行号盲补。原R5I已接受最小normal002/fault001，不是完整N1N2；历史失败与原报告不修改。

## 执行
1. 只读核W分支完整HEAD/index和原8/protected7/recorder/current651；当前dirty全部用户/历史工作必须保留。首份报告写本票ACK/调用图/逐case计划，然后按依赖连续实现，不等待MAIN的额外ACK。若发现本票输入漂移或其他writer，停止写入并报告，不reset/stash或覆盖。
2. 按锁定契约，C+Host同步实现，而不是只在summary填true：唯一授权/attempt/原root registry、setup stage与no-birth/no-fork/failedsetup变体、full epoch/terminal wait/segment语义、同一全阶段stream ledger、root→stream→wire→Hostclose门、有限失败终局证书、实际snapshot+唯一publication消费者。严格normal完整/失败资源终局/creative资格分离，failed-terminal永无图。
3. 同批完成验收计划所有C06..08具名direct cases和R5回归。对应实际producer/KernelSettlementOperations/TargetSettlement/真实supervisor事件回调/pump/validator/checker；不能只测另写helper、伪造trueflag或绕过bad路径。首轮文档暴露的同batch AUTH,AUTH / CANCEL,AUTH / AUTH,CANCEL及各startup变体必须走实际入口。C09仅保持NOT_RELEASED/OPEN，不改固定helper。
4. 六条轻量命令全部FIRST用原录制器，unique prefix n1n2-claude-060p6-：先red counterexample（可精确mutant，明确不等于历史重放）再修复green，所有失败/不完整保留。用 /usr/bin/python3.12 -I -S -B <W/recorder> <unique_capture> <allowed argv>。未进录制器不得先跑tests/typecheck/生成。纯测试原OS守卫持续deny，新增mock也不能漏到真实os.kill/fork/wait/prctl。不要运行mixed lifecycle，即使只想选其中一个case。
5. integrity generate第一次改变manifest如实记录；最终输入确定后先使generate幂等，再串行保存同一最终输入下全部六项exit/log/.cmd/.inputs/.result；本轮报告应给逐case证据而非总数。任何运行期间不改输入；没有新变更或实际失败无需反复全量。不得加timeout wrapper结束recorder，不编造PID或exit。若hang保留原owner/实际命令并问MAIN，不盲kill或另起重复测试。
6. 只写允许原8与RELEASE.report。任何额外具体文件/fixture/公共接口需求，报告路径+理由并停在该边界，不能顺手改。当前report不得宣称独立外审或R6/N1N2/V1 PASS。六项全绿及direct映射齐全只能称C06..08内部证据，C09/kernel场景/原17+ISO18/R7/R8仍未验。
7. 报告含实际改变/未改文件SHA、关键生产实体/调用关系、每case已实现/已实测/NOT_RUN、旧代码或mutant红灯强度、每实际命令exit/loghash/currentinputs、原Error/cause与资源前后门、残余风险/停止原因/回退。若未完成如实报partial，不调合同或测试预期制造通过。随后worker_done交还并冻结源码等待MAIN独立复审。

## 执行边界
- 唯一writer是你；MAIN不同时改源码/Git。你也不得Git add/commit、清工作树、删产物或reset/stash。
- 新429立即停止任何继续派发或自动重试/重启/切模型供应商，保存上下文/原命令/进程/dirty，明确报给MAIN；不能由Codex自动接手。只有用户针对该次明确授权才能恢复。当前用户额度恢复授权已覆盖旧429，不假设能绕过新429。
- Headless静音；没有浏览器/桌面/焦点/声音；不读配置凭据、J盘，不联网或付费。实际产品/C/N/kernel/Host等一律另票，不能用通过纯测试为理由自行运行。
- 旧5s/20s fake悬挂根因未证，不凭延长预算或清空map宣称解决。对本批direct callback的原promise/fake timer显式所有权/teardown，超出原8的问题如实记录。

## 当前输入/输出位置
代码W与当前窗口cwd应为RELEASE.cwd；canonical控制文档是本票目录。source651是字节pin，不等于651语义审查。复审材料可只读，禁止改MAIN合同/计划/独立结论/旧日志。可在自身报告内维护操作进展，不创建额外生产文件或另写验收script。
