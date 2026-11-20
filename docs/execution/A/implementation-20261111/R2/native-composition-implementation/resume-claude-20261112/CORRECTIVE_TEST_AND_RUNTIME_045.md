# 045 三项真实失败的测试修正及闭环验证

MAIN独立核实044-static003 exit0/53pass、044focused001 exit1/12pass3fail16filtered，rawlog摘要分别63f703279681c78128a843f37a0d71010ff9b46f1d224b3692ea550f025a378a、890546b890f85c20b74fbb0feffc42530aa4d17dcf3b59859617bb2b66db6e77；当前两次inputs全部匹配。原失败保留，后续新结果不覆盖。

只释放tests/agent-driven/integration/native-cache-witness.test.ts 中这三项测试及其就地必要说明/import，不改任何生产文件、不重构其它已通过用例。writer仍ctx_ae73a82c85e9。

1. Q01 root moved：当前真正先触发lease.assertCurrent，于是严格断言NATIVE_CACHE_PRODUCTION_STALE，明确这是前置拒绝而非深层origin校验覆盖。继续断言没有注册owner、实际端口已关、无request、正常结算不sticky；不能仅把expect改any throw。已有真实origin负例保留。
2. Q01 service registration cleanup：service产生的primary用retainedCleanupFailures读取Host私有登记，genuine对象确切一次，保留adapter自身错误应从其ledger读的不同用例。断言实际精确primary/refusal code、sticky以及后续production拒绝、真实清理，不以手工复制错误进ledger凑数。
3. Q03不能降级/删除。上游 packages/openfilm/src/host.mjs:294/open接受entry路径，:338 goto(new URL(entry,...))，:351只要求页面提供window.film.frame而没有要求basename=film.html。当前scenes.html只有普通body，所以错误是fixture不满足原生page契约，不能宣称非film页不可达。让独立scenes.html提供真实合法原生window.film接口（可复用同fixture有效film文档到不同入口路径，或最小真实frame/duration契约），真正经固定上游pageFrame绘制成功，同时因rel!==film.html不产生duration输出。原film.html不变；先放伪造duration，断言绘制后三件套真实存在、返回输出有效、伪造duration字节/身份没有被本次授权、lookupByOutput为空、reader明确NATIVE_SOURCE_CACHE_UNWITNESSED。不要mockproducer、伪造witness、扩超时或把上游超时当拒绝成功。

## 连续执行权限

对上述三项测试oracle/fixture修正与其范围内发现的同类测试错误允许连续自验证，避免每次小修停等。每轮保存候选完整bytebackup和全输入hash，原recorder串行typecheck corepack pnpm exec tsc --noEmit（n1n2-claude-045-tsc-NNN）；实际0并单独读取result/log/清理后原recorder重点运行 corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/native-cache-witness.test.ts -t 'Q01|Q02|Q03|K05-c|PF01|PF02'（n1n2-claude-045-focused-lifecycle-NNN）。输入在每次运行内冻结，非本test的所有guard始终固定；失败保留、不可盲重跑。只允许已批准三项的测试oracle/fixture必要修正，若发现生产缺陷或其它case失败，则停止并报告，不修改生产/已绿case绕过。

最新重点实际15项全部通过、inputs与当前一致、独立tool读终态并确认自有清理后，冻结所有文件，允许一次完整本文件：corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/native-cache-witness.test.ts，capture n1n2-claude-045-native-cache-full-001。这是本次唯一重型序列，单一slot、Headless静音loopback。全文件结果无论如何均停止提交报告，失败后不可自修/重跑，不能自动进入reader/asset/其它legacy/full/build/mutation。新429总是立即STOP，不能用连续自验证许可自动重试。

全部唯一capture经未改run-recorded.py落盘，独立终态读取、输入前后比对、真实自有资源结算。对不相关其它workspace不干预。禁止索引/commit/reset/stash/checkout/push、改AGENTS/Expected015/pin/config/运行器/公共DTO/EnginePort/旧Gate，禁止J盘/付费/外传。原17项及A/V1/frozenreview均尚未通过，不自签。
