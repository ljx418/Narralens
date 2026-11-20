# 042 集中闭环：服务清理不确定性与事件兼容

041实际tsc003 exit0、626输入及35guard当前匹配、index空，MAIN已独立核对。业务仍NOT_RUN。041漏放created-native-workspace.ts导致服务uncertain无法闭环属于MAIN范围划分遗漏，本轮显式补齐，不需用户审批。只放同名JSON五精确路径；此前其他路径不续期。writer仍ctx_ae73a82c85e9。

1. 服务cleanup uncertainty必须真正闭环：工厂未return的失败、service已拿owner后的cleanup失败、owner.close中folder.drain失败分别明确归属。工厂的withCleanupFailures当前仅可变cleanup_failures属性，与retainedCleanupFailures私有ledger不互认，不能以普通cause/property作为genuine权威。由adapter自己的私有WeakMap记录真实结算失败，Host-private只读getter传给service（或同等清晰的模块私有可信方式）；service在工厂拒绝和自己close失败两条路径保留primary及各genuine对象并锁住uncertain。不得因一个普通观察/文件读取失败误置uncertain，不得因frozen/primitive primary导致清理原因静默丢失。无需引入第二业务状态机或公共API。不可反向import host实现导致adapter层倒置。

owner.close目前await folder.drain若抛异常会跳过server.close，须采用各自独立尝试/finally，始终尝试关闭实际listener，保留所有失败、重复close同一settlement。factory server.close callback的error参数目前被忽略，也应按实际返回处理；未listen的ERR_SERVER_NOT_RUNNING须依据实际状态如实归类而非伪造资源损坏。不吞cleanup，不用无限重试。

给工厂失败与service registration失败两路补genuine cleanup故障场景（真实释放后抛指定对象、不得mock完整工厂/HTTP/producer），断言同一primary、每genuine对象一次、真实已listen端口终态、uncertain粘滞及后续拒绝；正常构造拒绝且资源干净时不置uncertain。无资源泄漏允许以test-only观察点作“真实关闭后抛异常”，观察本身不授予authority。

2. 生命周期事件兼容：adapter当前只发serving_listening:<origin>/serving_request:<path>，旧测试仍if(point==='serving_listening')或==='serving_request'，Q01close及并发断言已不可达。这不是编译能发现的。保留既有具名事件再发payload，或同步所有消费点至一个明确兼容类型；优先保留旧named一次+payload一次，使旧测试仍可精确触发。service类型不能用as把运行时不在union内的payload假装合法，Host-private类型与fixture同步；不扩大公共DTO。callback后事实仍重验，named/payload任一抛出也有正确清理归属。

3. Q02只加setTimeout(...new Image('late-dependency.txt'),400)仍不保证该请求属于draw所等待的真实依赖；Image读txt失败也不等于请求完成成功。使用实际可解码asset且film.frame/真实draw明确await该依赖加载完成（先静态复核固定上游draw契约，不改上游）。须保证先观察实际film页面已请求完成、pending0/accepted>=1，再close，close后精确asset请求及成功完成均可证。不是只看到全局request数增长。rawdraw completion与production最后激活分离，生产最终必须NATIVE_CACHE_ORIGIN_FOREIGN，无见证、不sticky；两个close等待rawdraw及later dependency，不要求close晚于完整production。这仍是Host-private fixture，不新增客户端可控能力。

4. static gate：按每函数真实事实推导entry后，openFilmServingBridge可能并无直接string WeakMap.get。六项不再是强行数量约束，五项还是六项应由真实能力流证明；若bridge是受producerRoots记录约束的传递能力，则明确实现传递规则并用实参负例，不依赖同名producer参数把它误识别。MAIN此前按六项描述是待证明假设，不可当作覆盖事实。保留十个原反例、helper传播、同名不同scope正控、装配可信正控及旧pin/argv/shell检查，不改计数掩盖错报。

## 本轮一次连续交付与许可

完整修复这五路径并保存全部候选字节/hash后，原run-recorded.py串行corepack pnpm exec tsc --noEmit，唯一capture n1n2-claude-042-tsc-NNN。仅本轮引入语法/类型问题允许白名单内修后新编号编译、保留红灯，不设次数硬上限。每次运行输入冻结、真实终态后单独工具读result/log/清理，禁止与修改交叉。

编译实际exit0且当前输入与其inputs.json一致、记录器未改、AGENTS/index/固定fixture/config/上游保持后，可以无需再ask执行一次条件静态门：corepack pnpm exec vitest run --config vitest.config.ts tests/m2.1/openfilm-upstream-lock.test.ts tests/architecture/m2.2-fitness.test.ts，经原recorder唯一capture n1n2-claude-042-static-gates-001。先将新候选全输入hash及完整备份落盘，静态运行直到MAIN新放行前不改任何输入。静态非零/漂移/新429立即停，不自行修后重跑静态。成功也停在业务runtime申请前，交完整candidate与实际记录供MAIN复核。

Host/browser/ffmpeg/ffprobe/media/build/mutation/full均未授权。不是恢复旧038/040命令。禁止Git索引/提交/reset/stash/checkout/push、修改AGENTS/Expected015/pin/配置/公共DTO/EnginePort/旧Gate、不跨下一接线。新429立刻停工、保全、报告，不自动重试/接手。已明示常规技术路线无需再向用户审批。
