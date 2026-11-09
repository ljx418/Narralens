> **续轮当前结论（见文末完整快照）：R1–R4源码修正已读审；本轮发现的native-ack嵌套绑定、Node Origin接缝也已修正。对下面指定实际字节未发现新的源码阻断。MAIN报告并有日志显示16文件148/148、tsc0；这不是本审查独立重跑。生产runtime、完整可信UI写、A阶段及人工门仍开放。历史NEEDS_WORK与最初发现原样保留，不表示这些旧缺陷仍存在于最新快照。**

# MAIN kernel 独立只读审查

结论：**NEEDS_WORK**。初始发现1项P1事务原子性问题、3项P2恢复/幂等元数据/时间边界问题。MAIN随后已提交R1源码修正候选供只读复核，状态NEEDS_TEST（见末尾附录），未将原发现抹除。下面均为源码推导和可执行复现方案；**本轮未运行任何测试、SQL或Host，复现执行状态NOT_RUN**，不能把推导写成实测PASS/FAIL。MAIN应在允许的独立槽落实负向及成功对照。没有修改MAIN源/索引/运行根，没有占轻量槽。

审查人：Codex `/root/a_bridge_lead`，未实现本次4个MAIN kernel文件。本人参与BRIDGE设计和模块验收，因此本文只审MAIN输入及其接缝，**不为BRIDGE实现自签独立外审、不签整体A/人工验收**。原BRIDGE模块候选`50f4e19309d81ad0bf6ddc986494c2d34f32bea1`保持，本文仅新增lane报告。

## 输入快照

MAIN目录：`/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`。
读取前后HEAD均为`a72196a109c80500fcac4f116eabaec3f22ce10b`；SQL核心提交`f2f87e23db5d556a3afc6d4b4adee079b9ea7c79`。durable-cursor.ts为该HEAD上的**未提交修改**，observation-cursor-ports.ts及其测试为**未跟踪文件**，所以不能单凭HEAD重放此次审查；以下实际字节SHA256为准。初始4个源及4个测试/ADR曾复读确认一致；报告生成期间MAIN修正了R1的repository及其测试，初始输入与修正候选分开记录，不能用新hash替代旧发现。

| 输入 | 实际SHA256 |
| --- | --- |
| `src/host/agent-driven/agent-schema.ts` | `71530aa99d453da4bc799393436f2b780801406978dc88d0d740a1bb5bfe1fa3` |
| `src/host/agent-driven/product-sqlite-repository.ts` | `7886ae40b4a80f613d1adb6652129968dd136d2ed81b776d64f5f43eef66768c` |
| `src/host/agent-driven/durable-cursor.ts` | `33bbd8646561fcdfa2b4ca245cb5cb43b7b3e570468c073f6239451dd3c31ba6` |
| `src/host/agent-driven/observation-cursor-ports.ts` | `c568746a71723881a54b1d513434a93a56ee25f091e351710d4c2c834d7af549` |
| `tests/agent-driven/integration/agent-schema.test.ts` | `115b8367f56292499a4cd2241b60020182464df5c891217f8f18ad81fd23cb27` |
| `tests/agent-driven/integration/product-sqlite-repository.test.ts` | `48519e65ced906c64ab37ef483f3c5599803b75e1181bbd7c2e8dfaae68cab2e` |
| `tests/agent-driven/integration/durable-cursor.test.ts` | `d9b36662f481825a3a4982690485f9625e82f0335911ac3aa3664f6ae4e55cc0` |
| `tests/agent-driven/integration/observation-cursor-ports.test.ts` | `c755cefb368ea646271d1fab4ca72da3941210f2017627f5f4c125ed5f0ab956` |
| `docs/execution/A/ADR-A03-001-shared-persistence-and-cursor.md` | `aa2ea5f76ee276fdcf6e853f7b9bf2142038ae29708c6af5696aab6e58acf47d` |
| `contracts/agent-driven-a.migration.sql` | `5572530b5036728e414a0653fc36fd43958874a3a89cc8223e3984194c4a1fa4` |
| `src/host/projects/revision-store.ts` | `fea46b6310be044d2c90b6c846b07e04600da286643411a53313680230978dae` |
| `src/host/projects/operation-idempotency-store.ts` | `d7ac446fdd7007c023f86d15c98a385447c10e79788e8f9188d83b9b59dba24d` |
| `src/host/creative/product-repository.ts` | `f071a02f1ed691e70a7f7cc774c6f4b5948c088e4a8411491fb51adb7affc3b7` |
| `src/host/observability/cursor.ts` | `9350b1084968c2629cc2ff58120e0f3c8cfe0c460c3b87879f9a9405dfc0d1b7` |

补充只读上下文：PRODUCT closed collection/record interface、CreativeService的receipt消费、同连接RevisionStore.atomic与OperationIdempotencyStore、冻结SQL、BRIDGE cursor consumer；未扩大到新HTTP router或整套PRODUCT业务实现认证。主线程仍在写的其他未提交文件不纳入本文结论。

## R1 — P1：被callback捕获的emit失败仍可提交成功业务outbox

位置：`src/host/agent-driven/product-sqlite-repository.ts:58`（transaction）、`:164`（emit），`src/host/projects/revision-store.ts:294`（outbox DDL）、`:329`（atomic）。

`emit`先INSERT outbox，后INSERT cp_a0_event；第二条run/scope FK失败时只有失败的SQL语句回滚。transaction只有异常逃出callback才回滚，tx方法出错不会标记事务失败，也没有为这两个INSERT加savepoint。callback若捕获该异常后正常返回，外层COMMIT仍会持久化第一条业务outbox。outbox.project_id本身没有project/run FK，所以缺失run的首INSERT可成功。

静态复现方案（执行NOT_RUN）：

1. 新RevisionStore + ProductSqliteRepository，记录outbox/cp_a0_event计数。
2. `await repo.transaction(tx => { try { tx.emit(eventWithMissingRun); } catch { /* domain handles failure */ } return null; })`。
3. eventWithMissingRun用合法ProductEvent字段，source=host、scope={kind:run,project_id:project1,run_id:missing_run,run_scope_digest:64hex,plan_version:1}、正常topic/entity/attempt/input_digest/observed_at/payload。无需构造有效run，因为这正是第二条FK失败条件。
4. 由当前控制流，外层会resolve并COMMIT，outbox计数+1，cp_a0_event不增；这是失败run动作泄露的业务事件，不是单独声明的拒绝审计。

已有`product-sqlite-repository.test.ts:30`只覆盖异常逃出callback的完整回滚，不能覆盖上述分支。建议把tx操作失败后整笔事务poison，或让多SQL操作在savepoint内失败原子回退；同时明确回调捕获错误是否允许提交其他事务内容。至少新增捕获run emit失败的计数负向，以及有效run emit两表同增的成功对照。修复前不关闭事务/事件原子门。

## R2 — P2：迁移回执与当前DDL互相证明，不能拒绝带伪回执的既存漂移库

位置：`src/host/agent-driven/agent-schema.ts:13`、`:23-30`。

现有回执路径比较的是“DB里写的schema_fingerprint”与“同一个DB当前sqlite_schema的hash”，没有把当前DDL与冻结DDL的独立预期manifest比对。migrationSHA仅证明随代码打包的SQL字节没变，不能证明既存数据库实际执行过那些SQL。仅核3个receipt列名也不校验receipt表的PK/CHECK/类型。

静态复现方案（执行NOT_RUN）：正常应用schema后DROP一个cp_a0不可变trigger，用同文件fingerprint算法重算当前sqlite_schema，再UPDATE receipt.schema_fingerprint；不改变合法migrationSHA。关闭重开调用applyAgentSchema，29行两项比较均通过，返回兼容receipt，而必需trigger已缺失。也可在首次导入库预置同列名receipt和自洽fingerprint，走return分支跳过34行的未登记表拒绝。

这不是在宣称能防御有任意OS/DB写权的攻击者；具体问题是旧库/恢复入口所需的**兼容性验证不能把待验证库自己的metadata当DDL来源证明**。若本阶段故障模型明确将所有既存receipt/DDL视为可信且排除其一致漂移，应显式收窄ADR中的“DDL/回执漂移拒绝”承诺；否则应校验独立冻结的对象/列/FK/索引/trigger清单或已知canonical fingerprint。现有schema测试只改单边DDL或单边schema_sha，缺双边一致伪回执向量。

## R3 — P2：recall忽略唯一命令账本的request_digest，转而信任response里的复制receipt

位置：`src/host/agent-driven/product-sqlite-repository.ts:149-154`，参照`OperationIdempotencyStore.recall/assertSameRequest`。

底层recall返回原账本request_digest，但adapter丢弃该字段，只检查response_json.format后将entry.receipt直接cast。该复制receipt的operation/key/project/principal/digest均未与查询scope和原账本列交叉核验。上游CreativeService随后用返回的receipt.request_digest作重放判断，因此response metadata可在恢复漂移时替代唯一命令权威。

静态复现方案（执行NOT_RUN）：用原OperationIdempotencyStore.record或旧库恢复夹具写入agent.v1:操作同一key，账本列request_digest=A，response_json.format=agent.idempotency@1，内嵌receipt.request_digest=B（其他字段合法）。repo.transaction(tx=>tx.recallIdempotency(scope,operation,key))当前返回B而不报冲突；请求B的服务重放检查会认可B，尽管原命令权威记录A。此条件需要持久数据不一致；正常remember当前会写一致副本，未声称普通wire请求能直接修改账本。

建议recall验证完整receipt结构、operation/key/scope/principal约束，并断言嵌套request_digest与底层found.request_digest相同；不一致按持久事实冲突/诊断失败关闭，不能静默选择副本。新增上述恢复负向与合法跨correlation重放成功对照。现有真实CreativeService测试覆盖正常副本一致，未覆盖这一漂移。

## R4 — P2接缝：verifySignature拆分保持scope→expiry，但future-issued时间检查被遗漏

位置：`src/host/agent-driven/durable-cursor.ts:27-30`、`:41-56`，`observation-cursor-ports.ts:9`；消费端`src/host/observability/cursor.ts:155-165`。

本轮修改正确保留了foreign expired先scope拒绝：adapter映射CursorError且注入verifySignature，BRIDGE先scope后expiry。现有新增2个测试对此有明确断言。

但原codec.dates拒绝issued_at>now；verifySignature不调用dates，BRIDGE consumer只检查issued<expires和expires<=now，未检查issued<=now。因此同scope、合法签名、尚在未来issued的token在组合路径会被接受，而同一个codec.verify会拒绝。合法的系统时钟回退/恢复即可产生该差异，不需伪造HMAC。

静态复现方案（执行NOT_RUN）：用sign clock=T+120s签issued_at=T+120s、expires=T+600s的合法claims；用同keys/DB的新codec clock=T创建adapter；`codec.verify(token)`拒绝ORIGIN_REJECTED，而`verifyCursor(ports.verification,token,{scope,nowMs:T})`当前返回claims。新增同scope future-issued拒绝，以及foreign future-issued仍先scope拒绝的向量。修复需明确全部时间规则由哪层在scope之后执行；不要简单重新裸注入原verify而恢复旧的foreign expiry泄露。该项涉及MAIN/BRIDGE接缝，不是对BRIDGE原实现的独立外审签字。

## 已有结构优点及不能扩大之处

- 4个MAIN文件只复用RevisionStore.compose，没有第二DatabaseSync；版本/head/receipt/outbox正常路径同原RevisionStore.atomic，命名空间principal:与合法project ID分离。
- 固定migration字节校验、单次DDL+receipt事务、首次无回执cp_a0对象拒绝、头部CAS的PK匹配和SQL expected谓词均可从源码确认。未见本次4文件直接修改影片revision/active_commit或旧EnginePort。
- closed集合/key/列表required scope和SQL标识符白名单防止调用者传任意table/全局list；这是持久访问路径限制，**不等于项目/用户授权**。repository不持有authenticated caller，敏感trusted_confirmation等行写入的真实权限仍依赖MAIN dispatcher/out-of-band context。不能用列白名单或FK替代该鉴权。
- ADR已诚实保留真进程kill、真实旧库副本升级、生产密钥生命周期、Host/SSE及人验未做；已有schema测试所谓legacy是当前RevisionStore加旧项目行，不能替代冻结旧版本DB副本升级证据。本审查没有重跑或复签其测试。
- PRAGMA foreign_keys是连接状态，schema_version不包含其变化。后续同连接消费者若关闭FK，当前transaction只在schema_version变化时重检；目前读取的生产代码未发现关闭FK路径，故只列装配约束，不作为已证明普通请求缺陷。应禁止同连接关闭FK，或在写事务前断言。

## 出口

本文为独立只读代码审查，NEEDS_WORK；R1先修并补负向/成功对照，R2-R4需按故障模型和接缝规则落实。MAIN源码/测试未被本审查修改，所有复现NOT_RUN，资源槽未占用。原BRIDGE候选50f4及其模块测试结论未改变。任何修复后的源字节需重新冻结再由未参与实现者复核，本文不对将来dirty内容自动生效。

## R1源码修正候选复核（随后快照，NEEDS_TEST）

MAIN在审查进行中修改了同HEAD上的两个未提交文件：

| 文件 | 修正后SHA256 |
| --- | --- |
| `src/host/agent-driven/product-sqlite-repository.ts` | `8f4caeb4ab8fc0403e4c93f9a881556466731417e4a0b9801a7f67c376e45a18` |
| `tests/agent-driven/integration/product-sqlite-repository.test.ts` | `3b96b63e61d015d03741bff5c8f3f3f000ad67d690baeff7785d98021e8b661d` |

只读diff确认：所有tx方法现在经guarded捕获错误并poison当前事务；callback即使吞错，返回后、COMMIT前仍重新抛错，因此RevisionStore.atomic回滚；后续tx方法在poison后直接拒绝。嵌套transaction尝试也taint外层。新增用例覆盖吞run emit镜像FK失败后outbox/cp_a0_event不增，以及吞CAS失败后新version不留存。

此修正从控制流看针对R1根因，**源码修正已读取，实际测试NOT_RUN/NEEDS_TEST**；本审查未执行新增测试，不签R1运行闭环。MAIN应按预约验证此候选并补有效run event镜像两表同增的成功对照；现有新增用例本身使用真实SQL失败而非mock。R2/R3仍需核恢复元数据假权威，R4仍需future-issued接缝负向。

## 续轮当前源审查：R1–R4修正及auth/router/真实Host接缝

范围按MAIN后续任务扩至scoped-auth、HTTP router、application dispatcher、既有Host挂载和HTTP client Origin修正；只读，没有编辑MAIN文件，没有运行install/tsc/tests/Host，没有占测试槽。BRIDGE自己的HEAD仍是50f4e19309d81ad0bf6ddc986494c2d34f32bea1，只更新这一份报告。

本轮开始读到MAIN HEAD `e7f29a1e23c62e87f602871d36d3c90e08fcb193` + dirty修正；过程中MAIN提交到`7678cab3347516c93dc4c24db14e846615b02fbd`，并继续有server.ts和host-application-ports.ts未提交修改、host-application.test.ts未跟踪。因此本轮结论只绑定下表实际字节，不能用一个旧HEAD替代working-copy SHA。最终复读server/client/Host测试摘要与下表一致。

| 当前实际输入 | SHA256 |
| --- | --- |
| `src/host/agent-driven/agent-schema.ts` | `08db842f1886ef292d057f0a4688ed6f8e72ca7d96c5bf3f8bf34996aa461a0a` |
| `src/host/agent-driven/agent-schema-definition.ts` | `d314ebbfd83182edc30293e5772d06b5b1a591ea32a78b612783834dbb0f8065` |
| `src/host/agent-driven/product-sqlite-repository.ts` | `b946d8c62df8cd927aaa87907b8f85a7c7b7c494fdd58f290ef0d35005d53351` |
| `src/host/agent-driven/durable-cursor.ts` | `33bbd8646561fcdfa2b4ca245cb5cb43b7b3e570468c073f6239451dd3c31ba6` |
| `src/host/agent-driven/observation-cursor-ports.ts` | `c568746a71723881a54b1d513434a93a56ee25f091e351710d4c2c834d7af549` |
| `src/host/agent-driven/scoped-auth.ts` | `a4f81840a55ba870c7d20370feb2d217a6c55cdc48791c4c6a3c2eaa3815b6b2` |
| `src/host/agent-driven/agent-http-router.ts` | `b123a4cee7e4f28ca9febbd251a8757e33cfd8ca4a07d8088da0f8e35bb3bde5` |
| `src/host/agent-driven/application-dispatcher.ts` | `25a772d8d0f9b00bf985be6b13cf09a7d27234221d5f86935407d1205e20d9d0` |
| `src/host/observability/cursor.ts` | `b9ad33ddab1238702c7063c7b787701b184231dc121338ed50afe729421cdd54` |
| `src/host/server.ts` | `bf7382b5c38e21879c3d1e1b9fe12c736d79857a3291151e68863e9a404b7e70` |
| `src/mcp/stdio-main.ts` | `8a34ce53223067abb2a14bd7469589f7a2cf2005ea88a118350b1a185128fc83` |
| `src/mcp/host-application-ports.ts` | `3a0a593b184fa43861e16c65460fc59f421c5f8ee95840c8cce805e325089c55` |
| `src/host/creative/creative-service.ts` | `fa5ad69a5f94bef4e1415e133cf13593236360ea2cafdcd376310c78b5aaaa6f` |
| `src/host/creative/creative-closure.ts` | `d55c1a06ef542eaf1d1d1bf697231676d6f9e1819f312b4ddaf9329a3467b800` |
| `tests/agent-driven/integration/agent-schema.test.ts` | `6e45cb8fe1f63bedd3acd005857535311ab0c6e6bed9959bd43fd14e5556050b` |
| `tests/agent-driven/integration/product-sqlite-repository.test.ts` | `9079f4ff2f1047daeecb823496f253a865bb3c44f3120530d3c591957147a97a` |
| `tests/agent-driven/integration/observation-cursor-ports.test.ts` | `175b1356174e792c20d92eedf2e189822905e7a9c7c23eaa45f899bfae804572` |
| `tests/agent-driven/integration/scoped-auth.test.ts` | `29c6362f509fe04c356a92acf8c2a17ca4b36387ac0e40c8ad43b59297a29587` |
| `tests/agent-driven/integration/agent-http-router.test.ts` | `63b93b686e5d8470ab1f34c6235ba28cb7dafeaaa286338be7456e9779c19e05` |
| `tests/agent-driven/integration/host-application.test.ts` | `c63ee3d0f61f63349b397f8a77ee99fc83bc153ab3d1f691eb4a2ddc331b8e7d` |

### R1–R4逐项只读结论

| 发现 | 当前实现核对 | 当前状态 |
| --- | --- | --- |
| R1捕获错误后错误提交outbox | repository所有tx方法经guarded，异常poison事务；callback正常返回后、COMMIT前再抛fault；嵌套transaction也poison。新增真实SQL用例捕获emit镜像FK失败及CAS失败后验证无局部提交 | SOURCE_ADDRESSED；MAIN微测记录通过，本审查未独立执行 |
| R2自洽假receipt替代冻结DDL | agent-schema-definition从固定迁移SQL及receiptDDL独立提取table/index/trigger定义；按type/name/tbl_name和保留literal内容的token序列核当前sqlite_schema；agent-schema同时核固定migrationSHA、receipt及独立定义。新增删trigger后伪造自洽fingerprint负向 | SOURCE_ADDRESSED；独立预期不再来自待验证DB的receipt |
| R3复制receipt替代原账本digest | recall取回原OperationIdempotencyStore.request_digest后比较内嵌receipt；同时核operation/key/project scope及principal类型，principal scope还核principal精确相等。新增修改response副本而保留原账本列的负向 | SOURCE_ADDRESSED；未发现原R3路径仍可认可漂移digest |
| R4future-issued漏检 | codec.verifySignature保留签名/claims结构；BRIDGE消费先assertCursorScope，再拒issued_at>now，not_yet_valid映射ORIGIN_REJECTED，最后查expiry。新增foreign future先scope、同scope future拒绝；foreign expired/同scope expiry及400/403映射原有对照保留 | SOURCE_ADDRESSED；scope→time顺序未因修future而回退 |

这四项不是重新签BRIDGE外审：时间消费端虽来自本人原泳道，其新修正由MAIN负责，本文只核MAIN接缝的实际变化及源码顺序；不签完整A或人验。

### 本轮新增接缝问题及当前修正

**R5 native acknowledgement路由绑定（最初SOURCE_BLOCKED，现SOURCE_ADDRESSED）**：初读router将URL project_id注入顶层，冻结NativeAckInput却只允许meta/ack，导致合法native请求400。当前agent-http-router.ts:89后为editor.native.ack单独核ack.project_id与URL精确相同，不添加顶层字段，完整DTO仍过同validator。新增实际HTTP测试三路径：native正确请求成功、嵌套跨project拒400、driver凭据拒403，且producer调用仅1次。该测试producer回传ack只证明协议绑定/身份门，不证明真实原生载入事实；实际native ack生产者仍需核session/generation/revision/snapshot/source/selection。

**R6 strict Origin与Node客户端缺Origin（最初SOURCE_BLOCKED，现SOURCE_ADDRESSED）**：scoped-auth强制正确Origin或严格浏览器same-origin回退；原Node stdio client仅发bearer，因此真实组合会403，分开的Bridge stand-in和router helper测试没覆盖。tracked 7678版本client摘要是dfa4f2226c3a940962e7effaaa2934193327d14816f81b5e48c316d6585c3f54。当前dirty client从已验证loopback baseURL生成固定Origin；先删除所有大小写同名注入header，避免双值歧义。源码无通过取消鉴权“修复”连通性，token和channel仍须独立正确。新Host测试实际SDK Client→stdio-main→NarralensHost→ScopedAuth→SQLite Intake读取覆盖此接缝；见下方MAIN运行证据边界。

### auth/router安全核对及撤回的初步判断

- scoped-auth在资源匹配及body读取前校验Origin与凭据，route匹配后按authChannel再次核channel。ordinary bearer不能冒trusted_ui或native_bridge；trusted_ui必须cookie+写CSRF，不能把同UI token当bearer；native不能升为ordinary/trusted；重复关键header/混合cookie+bearer、过期/撤销凭据拒绝。body actor/channel字段不参与身份。
- router保留未知字段交runtime validator，不做有损清洗；GET重复query/path identity冲突拒绝，CursorRead两个nullable字段按明确route恢复null，Last-Event-ID冲突拒绝。POST限1MiB并有5秒读取边界；producer输出再次校验，异常信息不回显路径/私密内容。新增Host挂载对旧session bearer不开放A权限，旧写入口fail closed。
- 先前向MAIN发送的“B可读/改/确认A intake”是过早判断：我沿用了前轮CreativeService片段，未在发出前重读当前函数；putIntake已有owner检查，当前readIntake L213、confirmIntake L241也调用assertIntakeOwner。当前helper读head对应版本核principal，不匹配返回无可访问intake。**此三项不作为当前漏洞，原初步消息撤回**。本文没有据此扩大成全部项目/run资源授权已通过；其他资源仍须逐生产handler核所有权，不能仅靠channel。
- 在本次核查的scoped-auth/router具体源码中，未发现新的ordinary→trusted/native权限提升路径。它们是显式身份传输门，不是全项目权限或真实人类操作证明；实际credential分发、cookie安全属性、全生产handler范围仍由MAIN实际装配验收。

### MAIN报告与读取的运行证据（非本审查独立重跑）

MAIN先报告baseline exec62928 terminal exit0；本审查未执行baseline。读取`docs/execution/A/logs/main-composition-r2`显示tsc0、8文件38/38；`main-host-first/integration.txt`显示9文件40/40、exit0，均为MAIN微测记录。

MAIN随后报告exec63084 terminal exit0。本审查只读`main-host-sdk/integration.txt`尾部及exit文件确认16文件148/148（包含BRIDGE108与MAIN40）、tsc0、exit0，118.80s。新test源码确实起NarralensHost并注入真实ProductSqliteRepository/CreativeService与ScopedAuth，通过真实SDK stdio读取SQLite中的简报；handshake instance元数据明确是测试数据，不证明launcher/supervisor真实就绪。**这些运行是MAIN执行，本人没有独立重跑，也不把148项相加解释为完整A通过。** 原第一次无效fixture失败日志仍由MAIN保留，不因后续绿而抹去。

### 仍开放的实际集成门

1. A-mode旧Gateway写当前是fail-closed过渡：Host的studioOperation只留4个read、studioNativeWrite拒所有写；旧M5Panel apply/restore仍调用nativeWrite(timeline.adopt_materialization/history.restore)。所以不能把当前后端微测称为保留原工作台写体验已经完成。MAIN已明确后续逐项接可信scope/CSRF/批准和同一Coordinator，再解禁已翻译入口；不建议直接开放legacy bearer。
2. 当前Host测试证明新路由挂载与一条真实SQLite简报读链，尚未证明生产入口/runtime冷热启动、真实instance/健康探针、完整workflow调度、所有UI写动作、native加载确认、60–180秒片/双导出/关服重开或恢复原子发布。
3. 本次源码及测试结束需MAIN冻结最终组合SHA；本报告actual working-copy hashes仅约束上述输入。真实外部客户端、人验及整个A门由原计划单独验收；本轮没有B授权，也不改BRIDGE原108历史证明范围。

续轮结论：**本轮列出的R1–R6源码路径已针对性修正，指定实际字节未发现新的源码阻断；MAIN微测148/148已读取，其执行主体仍是MAIN。实际生产runtime及完整UI/A验收仍NOT_RUN/待集成。** 本审查不写MAIN、不申请测试资源、不自签整体A。
