# 060P1R2 独立静态定点复验

**REQUEST_CHANGES**。6项MAJOR、1项MINOR及1项NOTE。24份实际dirty快照在开始/结束均匹配；历史HEAD `1d348d419120f23f45d958112ea8c43df5a04675`不是本修复接受提交。逐旧IR01..IR11与C01..C11的CLOSED_STATIC/STILL_OPEN结论见FINDINGS.json，未接受实施者“22项已关闭”自述。

## 仍需修复

|新ID/关联旧项|实际路径、触发与影响|
|---|---|
|R2-I01 MAJOR / IR01|workspace:733–775取得三phase lease，但preexisting-output或排队后stale等普通失败在parent/tree阶段结算前拒绝，finally只settle execution，随后永久held无bridge恢复入口。另一方面真实tree close未知仍先throw/reject原operation；仅保留scheduler held不保留wholeProduction promise，close/dispose:1157以后可越过原operation删根。需区分已证零资源/NOT_OWNED与真实UNKNOWN，后者保留原closure、owner及完整promise；前者正常失败后可继续下次生产。|
|R2-I02 MAJOR / IR05|upstream:1605仍只有一个共享responsibility指针，inspect/reconcile读它；同bridge A held后B进入排队会覆盖它。每次draw局部current已修父drain误归属，但A的真实cleanup handle仍会被B遮蔽。应按稳定opaque handle保存全部未结责任。|
|R2-I03 MAJOR / IR06|factory准入拒绝finally resolve责任promise却不把phase=queued改terminal，prune:518只剪settled；裸factory重复queuefull/timeout/取消仍无限积累。成功JPEG改为摘要、有界settled历史是实改，不能由此推断所有失败历史有界。|
|R2-I04 MAJOR / IR09,C11|probe reapHelper:105以后catch kill错误再race5秒正常返回，afterEach仍rm；custodian workingRoot:116启动前就加入removable，kept从未push，也无真实reserved handle的失败finally owner。首个正向pilot若超时/held，同样可能删活根或丢证据。必须真实close/reap后才标可删，UNKNOWN保全并维持owner。|
|R2-I05 MAJOR / IR04,C09|supervisor:1338 draw EOF立即发CANCEL却不锁存失败；若完整picture已缓冲、EOF先于FINALIZE，之后仍可能采纳候选与正常receipt。纯latch函数虽修好，实际EOF取消入口绕开它。需区分授权finalize后EOF与此前的协议/取消失败，前者允许，后者零witness。|
|R2-I06 MAJOR / C04/05/06|Python _collect_targets:1284忽略group_members/direct_children的None；_live_targets:1312只看缓存且跳过Z，_reap_adopted:1347又把无法枚举当无可reap。N为Z且孙仍存活、枚举EIO时，TargetSettlement可能据空列表reap N释放锚，最后才发现ECHILD/组unknown；run随后exit4主动丢掉reaper。真实adapter须把UNKNOWN传给状态机并保住C/N锚，不是只让最终receipt说unknown。|
|R2-I07 MINOR / C10|held后来reconcile成功，cleanupRequired未清且未调用run目录释放；原run finally已结束，releaseRunDirectory仍拒删。应在同owner确认终端后一次完成目录清理并保留真实失败，而非把已结束目录永久当UNKNOWN留存。|

每条的实际行号、具体反例、最小修订与决定性测试在FINDINGS.json。没有执行故障实验或把静态反例当已捕获runtime失败。

## 已有的真实修订与测试局限

当前owner-bound phase lease registry与spent completion已替换原raw boolean receipt接口；workspace只在consume成功后release、factory也传真实scope给supervisor，旧的直接无门释放形式已修。但实际阶段结束代码仍有R2-I01，不能只手工settle lease的scheduler测试就关闭完整责任链。direct bridge现在把parent phase纳入scope并在drain后归还，producer settled promise延续到bridge，旧IR07的主要缺口静态已修。workspace实际传#abort.signal，IR11静态关闭。

Host run/reconcile确实共用#proveExecution，并实际调用receipt validator、C exit code/signal/close与fresh观察；decoded队列与共享READY deadline也在真实pump/await调用中使用。候选锁存函数和cleanup-copy函数均已接入。当前identity文件用hoisted vi.mock(node:child_process)截住spawn，旧IR10在当前字节静态关闭，不能倒写旧P1R零spawn历史。

Python TargetSettlement不是完全脱离生产的复制实现：_settle_domain确实经KernelSettlementOperations调用它。但单测给FakeOperations返回人工live列表，不测试真实adapter在proc枚举None时如何构造该列表，因此不能证明R2-I06已修。同样latchCacheOutcome纯测不能证明onDrawEnd调用了正确失败入口；phase lease纯测不能证明真实preexisting拒绝及未知tree清理的NOT_OWNED/生命周期。

父source error与true close分离、destroy异常保留及Q2默认upstream promise未回退；真实源FD、parent probe回调/close/reap与准入冻结仍需实际门，未运行本身不是新finding。

## 证据与运行边界

实际核验24份R2 capture的原cmd/result/log SHA256/exit：其中typecheck-001 exit2、custodian-unit-001 exit1、scheduler-001 exit1三份失败仍在原处；后续成功用新name，未覆盖它们。早期捕获绑定较早源码属正常修复历史，INPUTS区分与最终24份快照的摘要差异，不能假称所有早期capture都证明最终字节。

另一次未记录的 `node --check tests/agent-driven/integration/helpers/cache-worker-fixture.mjs` 由evidence-gap承认并声称exit0；没有原capture，不能独立确认其时间/exit，也不称它为第四份已记录失败。旧P1/P1R四次失败仍UNRECORDED/UNKNOWN。R2 generate-001实际source_changed只有integrity JSON；旧P1R生成是同字节重复，区别保持。不补造日志/命令/时刻。

## 首次最小P2a的精确安全前提

当前不签STATIC_NO_BLOCKER_FOR_MINIMAL_P2A。MAIN的C identity→一次无浏览器正向receipt计划是合理分阶段方向，但需先给该单case真实C/N owner、reserved handle、失败finally与UNKNOWN目录保全；现有整文件测试不能直接作为安全入口。正向也可能失败，不能把5秒或Vitest timeout当资源结束。固定一slot/精确argv/cwd/唯一runtime-root，尚不运行TERM-ignore/adoption/flood，也不夹带Host/HTTP/媒体或Chrome。

scenario/events旁文件只允许单slot测试scaffold，不是生产共享状态批准。可由MAIN释放专属runtime-root：复制/映射该次测试worker与场景/事件并保持受审hash/实际路径receipt，或批准具名显式输入；必须在启动前登记归属，未知保全，不能平行复用或覆盖证据。生产不给绕过proof的开关。

修复R2-I06的真实kernel adapter后，再安排负例；Q2仍按独立真实事件pilot决定是否具名窄owner。当前所有真实Python/prctl/fork/wait/signal、FD/reaping、Chrome/Host/probe、原17/ISO18/full gates及人工体验均NOT_RUN；源码/运行释放仍由MAIN负责，不由本报告产生。原N1N2未接受，NEXT仍pending。

本审查仅写指定目录，未改源码、测试、配置、Git、旧报告或快照。实际输入SHA256及结束一致性见INPUTS.json。
