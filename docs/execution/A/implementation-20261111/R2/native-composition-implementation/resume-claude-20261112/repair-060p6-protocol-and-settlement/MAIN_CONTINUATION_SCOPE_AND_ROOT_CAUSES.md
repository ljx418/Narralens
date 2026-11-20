# R6 同一合同继续实施：部分交还不等于完成

本说明不新增规格、不重新开合同；原revision2 PLAN_READY及全部C06..08标准继续有效。MAIN核对本轮final2六capture实际exit0/相同651/零运行漂移、源码仅七条允许路径变化/protected7未变；这只是部分候选的轻量事实，不是功能完成。原worker_done首次task ID错误已被Orca拒收，后续msg_dc51bdc745d7已纠正；请今后只用新dispatch当前preamble的实际Task/Dispatch回报，不猜造ID。旧失败及当前partial报告已封存，不删除。

## 先纠正依据
OWN报告首部SPEC072f69…为旧R5I，所谓正式合同493f86…为旧R5G，均不是本票依据；“继续R5F”也失准。本票唯一依据是RELEASE.json中plan_contract/development_acceptance及independent_plan_review的完整hash与实际路径。先重新读取、核hash，并在自身报告追加更正/ACK与逐项关闭表，不覆盖已封存材料、不把未做写成已审。
报告§5所列C06-EPOCH/PARENT/BOUND、C06-EXEC分支直接例、C07-LATE、C08-LATEWAIT、§4A编排全部**早已在当前release内**，不需要另一份合同或用户批准。只有C09 helper/实际kernel是真正未释放。继续当前partial字节增量完成整个已授权批，不能用“主体完成/未来票”替代缺口；普通篇幅/会话长不是停止条件。真实服务端错误则按规则如实停。

## MAIN实际代码核对出的共同根因（一次解决，不按测试绿灯止步）
1. **资源结束仍与成功共用同一个谓词**：当前Python _resource_proof_complete见_failure、diagnostics_lost、overflow就false，而failed_terminal.resource_proof_complete直接复制同一谓词，因此真正预算/EIO失败证书永远不能证明资源已结束。这正是原C08需解决的核心，不是新要求。严格拆local raw_tree_terminal、stream实际finish、最终resource terminal与creative；资源已证且有原失败必须failed settlement，不交图，不永久空held。
2. **预算溢出原根因未修**：_known_targets_gone仍因_identity_overflow无条件false；event的全量count/hash仍可能与retained发送内容不符，waits/list仍有无界风险。按已审合同分开retained epochgone与完整转录资格、首次预算错误、根链有限失败证书及sent-excerpt/global-lifetime两个账本；不要删overflow检查来伪成功。unknown/live/Z/EPERM/root缺失仍held。
3. **有限证书producer/consumer没有实际互通**：当前custodian_epoch读`start_tickets`拼错；Host failed validator又只检查部分C/N字段、Number强转、可漏worker_epoch/stream/lifetime等mandatory，并把worker_wait_was_last===true强加于failed模式，反而拒绝合同明确允许的“实际N后catch-up、全终局但仅失败”分支。必须实际C writer→Host parser/domain/creative全链直接对照，严查全epoch/type/binding/branch/ordinal/stream/required-null。不是再手造一份满足consumer的假证书。
4. **Stream ledger只是新增类，未覆盖全生命周期**：实际KernelSettlementOperations.sleep仍仅time.sleep；_drain_worker_streams EOF未真正unregister、EIO只写disposition未等raw-tree proof实际close，不能声称whole-lifetime/reader-closed。把running/settling/recover/wait/final接同一公平服务，不饿死控制与wait；真实read0与实际close区分。用§4A顺序跨层反例确认没有循环依赖或盲关FD。
5. **C06核心semantic未实现**：完整i/w仍旧PID/ticks/简略wait，256 waitFacts静默截断、完整成功未要求N恰一次且last；segments只有version门而无不可变protocol/draw/ticket自身绑定。必须完成按epoch+completion的bounded map、parent-reaped-observed-gone诚实分类、N专用槽与terminal status、foreign段/direct pump/终局重放拒绝；保持failedexec不同分支不捏造身份。不是仅保留旧summary epoch测试就宣称C06关闭。
6. **启动及单根生产状态须实证**：按§1A表把Host-only/noauth/fork确切失败/setsid失败/exec同errno失败/真实成功串到actualwriter/parser；补空段/no-fork必要null、partial FD闭合、结构化setup未知。已做one-shot直接例保留；fork成功到register/其他失败间责任必须即时保留。不得把部分错误路径直接填sole_wait_owner=true当作机制证明。
7. **直接测试遗漏同批补齐**：按照MAIN_DEVELOPMENT_ACCEPTANCE_DRAFT中每一证据键完成producer/consumer负例与正控；尤其>256 adopted但<=512身份、65536/65537 late-stream、actual late draw/control/child error、原promise/fake timers归属、raw-tree unknown/EIO close未知/未receipt/未Cclose、latewait全终局只失败。mutant2errors不是自动语义红灯；说明实际异常入口，不能拿ImportError/NameError等夹具错误当生产反例。

## 连续实施和证据
- 只按RELEASE_CONTINUATION.json 当前sha起点继续；原8+自身报告、相同六FIRST命令。不改范围、预算、guard、protected7/recorder、公共API或配置。C09仍OPEN，实际C/N/kernel/mixedlifecycle不执行。
- 保持原final2及全部失败文件不变，新capture用 `n1n2-claude-060p6-complete-` 唯一名，最终源固定后generation幂等、同一651的六命令绿。运行期间不改源；每一项具体case映射到真实入口/测试名/capture/exit，不只给总数。
- 此前不自签外审是对的；但不需要先把明显缺功能的半成品送独立审。先在同一合同内完成全部已释放实现与direct证据，之后MAIN独立代码审，真实运行始终另票。
- 若确实无法在原8满足某具体接口，给最小具体路径/调用者/替代路线；不得简单说“需要下次合同”。需要stop时写清实际外部阻塞，不伪称done。
- 新429立即停，不自动重试重启换供应商，也不由MAIN/Codex接手。没有新429则按此票继续，不重复请求人工批准。
