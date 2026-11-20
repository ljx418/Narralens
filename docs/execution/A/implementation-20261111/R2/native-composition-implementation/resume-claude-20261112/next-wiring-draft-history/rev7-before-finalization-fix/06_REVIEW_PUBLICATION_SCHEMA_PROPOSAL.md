# W3 收据持久化：逐字 SQL 与验收补充草案

状态：DRAFT_PENDING_N1N2_ACCEPTANCE_AND_SCHEMA_REVIEW；不是实现 release。N1/N2 历史及后续扩展的精确释放均不包含本提案；不得据此在当前源码建表。业务测试全部 NOT_RUN。

## 当前事实与设计纠偏

已只读核对实际 main-integration 的 src/contracts/prepared-preview.ts、src/host/render/preview-prepared-source.ts、src/host/agent-driven/created-prepared-source-store.ts、review-media-http.ts。现有 PreparedPreviewReceiptV1 没有 package_id/version；收据先产生，再被 package 绑定，不能把 package 身份塞回收据形成循环哈希。既有 created_prepared_source_package 只存 receipt_digest，不存其原像；ReviewMediaBindingPort 需要完整 receipt，这是新增表所补的事实缺口。

此处精确采用真实字段 source_digest、plan_digest、rights_digest、receipt_digest；04 中的 input/output digest 是概念描述，不新增同义列。output 的整包身份由 receipt_digest 覆盖五个 parts 的真实 sha256/bytes/media_facts；不能凭空再造 output_digest。run_id、prepared_job_id、execution_attempt、producer_attempt 都由真实收据给出，不取调用方授权声明。

## 逐字 DDL 提案

DDL 摘要计算范围：下面 sql 代码块内部 UTF-8 字节，LF 换行，包含最后一个 LF，不包含 fence。独立 marker 的 ddl_sha256 写入该摘要；摘要覆盖 marker 定义但不覆盖其 INSERT 数据，因而没有自引用。私有 namespace 与 S01 marker、cp_a0 均分离。

```sql
CREATE TABLE created_review_publication (
  prepared_source_id TEXT NOT NULL PRIMARY KEY REFERENCES created_prepared_source(prepared_source_id),
  schema_version INTEGER NOT NULL CHECK(schema_version = 1),
  project_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  package_id TEXT NOT NULL,
  package_version INTEGER NOT NULL CHECK(package_version >= 1 AND package_version <= 9007199254740991),
  receipt_digest TEXT NOT NULL CHECK(length(receipt_digest) = 64 AND receipt_digest NOT GLOB '*[^0-9a-f]*'),
  receipt_json TEXT NOT NULL CHECK(json_valid(receipt_json)),
  source_digest TEXT NOT NULL CHECK(length(source_digest) = 64 AND source_digest NOT GLOB '*[^0-9a-f]*'),
  plan_digest TEXT NOT NULL CHECK(length(plan_digest) = 64 AND plan_digest NOT GLOB '*[^0-9a-f]*'),
  rights_digest TEXT NOT NULL CHECK(length(rights_digest) = 64 AND rights_digest NOT GLOB '*[^0-9a-f]*'),
  prepared_job_id TEXT NOT NULL,
  execution_attempt INTEGER NOT NULL CHECK(execution_attempt >= 1 AND execution_attempt <= 9007199254740991),
  producer_attempt INTEGER NOT NULL CHECK(producer_attempt >= 1 AND producer_attempt <= 9007199254740991),
  created_at TEXT NOT NULL,
  UNIQUE(project_id, package_id, package_version)
) STRICT;
CREATE TABLE created_review_publication_schema (
  singleton INTEGER NOT NULL PRIMARY KEY CHECK(singleton = 1),
  version INTEGER NOT NULL CHECK(version = 1),
  ddl_sha256 TEXT NOT NULL CHECK(length(ddl_sha256) = 64 AND ddl_sha256 NOT GLOB '*[^0-9a-f]*')
) STRICT;
CREATE TRIGGER created_review_publication_no_update BEFORE UPDATE ON created_review_publication
BEGIN SELECT RAISE(ABORT, 'immutable review publication'); END;
CREATE TRIGGER created_review_publication_no_delete BEFORE DELETE ON created_review_publication
BEGIN SELECT RAISE(ABORT, 'immutable review publication'); END;
CREATE TRIGGER created_review_publication_schema_no_update BEFORE UPDATE ON created_review_publication_schema
BEGIN SELECT RAISE(ABORT, 'immutable review publication schema'); END;
CREATE TRIGGER created_review_publication_schema_no_delete BEFORE DELETE ON created_review_publication_schema
BEGIN SELECT RAISE(ABORT, 'immutable review publication schema'); END;
```

DDL SHA256：`be75d5683a25861ab2cbe14d0a12c4bbde050a342288e2f254f577a2a6623e56`。

## 安装与重开顺序

1. MAIN 审定精确私有 schema 修改、ReleaseAssignment 列出此表/marker/六个对象的合法名字后才可实现。沿用唯一 RevisionStore 连接、原 ProductTransaction；不打开第二业务库，不改变 user_version 或 cp_a0 comparator；rev6仅明确允许原schema_migration中一个独立marker行，不改其DDL或别的行。
2. 在 Host 明确的 bootstrap 步骤安装，依赖既有 prepared-source schema 已验证；constructor 不偷偷执行 DDL。复用既有事务边界；非事务入口才申请 BEGIN IMMEDIATE，不能在外层事务里嵌套 BEGIN。
3. 安装必须按rev6的独立外部marker与私有namespace四象限执行：仅两者都不存在才在同一事务执行完整DDL，再INSERT私有singleton marker与原schema_migration中的独立marker；任何边界失败整体回滚。
4. 重开必须逐个比对 sqlite_master 的 type/name/tbl_name/sql 与冻结定义，并验证 table_xinfo、外键、唯一约束、STRICT、CHECK、四个 immutable trigger 和 marker 唯一行。不得只检查名称/列数/marker digest；不得用宽松文本包含匹配。具体 schema 比对实现及 SQLite 规范化规则须在 release 前独立审查。
5. 任意部分存在、缺 marker、多 marker、未知对象混入本 namespace、摘要不符、约束/触发器改变都拒绝服务，不修复、不删除、不自动升级。不支持不理解新 schema 的旧 binary 直接进入该运行根；兼容回退与实际阻断按本章末约束，不宣称未修改旧 binary 已会主动拒绝。

## 唯一 publication 事务

异步 preview/render/proof 全在事务外，先拿到真实 PreparedPreviewReceiptV1 与 prepared/impact。进入原事务后重新检查 owner、当前 run/step/attempt、S01 read lease、author/base/rights、prepared 身份和全 receipt schema。

把完整 receipt（包括 receipt_digest）按原 canonicalJson 保存为 receipt_json；验证 canonicalDigest(去掉 receipt_digest 的其余原像) 恰等于 receipt_digest。严格校验五种 slot 各一次、object_id 唯一、实测 fps/frame_count 和媒体事实、整数安全范围、不得出现绝对路径。不得另换哈希算法、偷偷删未知字段后通过校验。

同一原事务包含：真实 artifact part 发表、FixedWorkflowService.publishReviewPackageInScope、prepared.bindPackage、此表不可变 INSERT、最终 S01/原批准规则要求的同步检查。任何失败数据库整体回滚；已存在的媒体对象按真实 owner 清理或保留待回收，不宣称数据库回滚能撤销文件系统写入。此事实表没有 state/approved/revision 字段，不是第二审批或事务权威。

重放只允许同 prepared_source_id 的逐字段相等事实；created_at 读取既有值，不重新生成以制造冲突，不 UPDATE、不 REPLACE、不重新渲染。不同收据/包/运行/attempt 必须沿既有冲突错误合同拒绝；不先覆盖再比对。package 当前性和权限仍来自原 workflow/run/approval，不由本表历史行授予。

## 媒体读与生命周期

currentPart/currentByReference 从当前 run/package→prepared binding→本表反向核验完整链；读后重算 canonical 与摘要并比对所有重复列。读对象经原 PreparedReviewMediaReader；绝不拿 receipt_json 的字符串拼绝对路径。await 之后重验当前包/运行/授权与 S01 lease，旧包仍在磁盘不代表能继续播放。

GET/describe 不创建或补写 publication，不启动渲染，不写批准、不推进 revision。缺原像、损坏/漂移、跨项目包、过期 session 均拒绝；原 HTTP 错误合同复用，字面码须在最终 release 中逐个锁定。重启/关闭时先停新入口，drain 已接收的 publication/proof/media 读取，最后关同一 DB，不能让超时 worker 使用已关闭句柄。

## 增补验收（不替换原 S01 28 case）

|编号|真实操作及失败注入|必须证明的门限|状态|
|---|---|---|---|
|PUB-DB01|原旧库在显式 bootstrap 安装；每个 DDL/marker 边界中断并重开|完整安装或零对象；旧 cp_a0/S01/原权威表逐字不变；无第二连接|NOT_RUN|
|PUB-DB02|改 CHECK/FK/STRICT/trigger/sql/marker；部分 schema；同名未知对象|每个变异均在启动拒绝，无静默修复，原数据不变|NOT_RUN|
|PUB-TX01|真实 preview→prepare→package/bind/publication；每次 INSERT/最终检查前失败|数据库无半包/半 binding；revision 不变；媒体归属清理有证据|NOT_RUN|
|PUB-RP01|同 key 同收据重放；改 receipt/包/version/run/attempt 后重放|前者相同行相同响应且零渲染；后者真实冲突，原行不可变|NOT_RUN|
|PUB-MD01|真实 five-part receipt；篡改原像/摘要/重复列/slot/object/媒体事实|运行时 schema+canonical+跨表链均实际生效，单点变异可打红|NOT_RUN|
|PUB-RD01|实际 currentPart/currentByReference→媒体 GET；在 await 中换 run/package/rights/session|实际陈旧读拒绝；GET 无写入/渲染；未用内存 Map 冒充权威|NOT_RUN|
|PUB-RC01|实际进程在 publication 事务前/中/后丢失，再用同库同 root 启动|重开只见完整已发表事实或无事实；不得伪造批准/修复 S01 epoch；关闭按真实 owner drain|NOT_RUN|

这些是 W3 新增规格，不允许倒写为当前 N1/N2 或已封存模块的验收要求；完整阶段仍保留原 28 项与 HC/Studio/真实短片/人工门限。下一 release 前需独立审查本 SQL、实际 producer 参数与既有幂等/错误映射，再绑定已通过的 N1/N2 commit。当前没有运行数据库或业务测试来验证此提案。

## schema 比对与重放的精确实施约束（rev5，仍待独立文档审定）

实际候选 `src/host/agent-driven/agent-schema-definition.ts::matchesFrozenSchemaNamespace` 按对象 name 的 prefix 选取 sqlite_schema 后比较 token。它可以复用固定 SQL 的词法规则，但仅调用该函数不足以满足本提案全部启动检查：名字不带此前缀、却挂在这两个表上的额外 trigger/index 会漏掉；marker 行的 DML 也不改变 schema_version。不能把“调用既有 helper 返回 true”当作六对象、约束和收据全部已证。

拟实现按以下封闭顺序核对，每个步骤都需真实反例：

1. 范围同时覆盖 `name` 以 `created_review_publication` 开头的对象，以及 `tbl_name` 为 `created_review_publication` / `created_review_publication_schema` 的所有对象。六个显式对象必须精确是上面两张表和四个 trigger；同名未知对象、不同前缀但附着这两表的 trigger/index 也拒绝。不能修改旧 CP-A0 comparator 来放宽范围。
2. 两个隐式 autoindex 不计入“六个显式对象”：主表 TEXT PRIMARY KEY 对应一个 pk 索引，UNIQUE(project_id,package_id,package_version) 对应一个 u 索引；schema 表 INTEGER PRIMARY KEY 复用 rowid，不凭空期待第三个 autoindex。分别核对 index_list/index_xinfo 的 origin、unique、partial、字段顺序及隐式键语义；不能把 sql=null 的 autoindex 当未知显式对象误拒绝，也不能全部忽略索引。
3. 表的 SQL token 比对保留字符串字面值与 CHECK/FK/STRICT 语义；再核 table_xinfo、foreign_key_list、STRICT 与索引/触发器归属，冻结允许的词法规范化规则。只忽略空白/注释及既有 helper 已明确的 IF NOT EXISTS/末尾分号，不随意把 literal 大小写或表达式改写成同义。若实际 SQLite 规范化需要扩展，先用独立用例审定，不在生产遇错时宽松放行。
4. schema marker 的 singleton/version/ddl_sha256 必须每次服务 read/write 的最终受信检查重新读取并精确验证，不能仅以 PRAGMA schema_version 缓存 marker 有效性。媒体异步读取后还要重验当前包/运行/授权/原像；变更 marker 而 schema_version 未变必须真实拒绝。缺失/部分/错误 marker 不补写；SQLITE_BUSY/EIO 不是“未安装”。
5. 已有 package/binding 但 publication 原像缺失时，GET/describe 拒绝，不通过“再渲染一次”重建成已发表事实；同 prepared_source_id 的重放先验证原始 publication 内容，不重新发新 package。空 namespace 安装与历史媒体事实恢复必须区分，不能从无表推断没有历史发表。私有namespace整体丢失由rev6独立外部marker识别并拒绝；不得以重装空表证明已恢复历史事实。两份marker与全namespace同时被删除/完整旧DB回滚的本地防回滚边界另按rev6声明，不冒充密码学保证。

PUB-DB02 明确增加：非前缀 trigger/index 绑定私有表、marker DML 不变 schema_version、implicit index 对照、BUSY/EIO；PUB-RP01/PUB-RD01 增加历史 package/binding 仍在但 receipt 原像丢失的拒绝。均 NOT_RUN，仍须完整独立文档审查与真实实现验收。本段不修改上面的逐字 SQL 或其摘要。

回退语义不得依赖未修改的旧二进制会主动识别新私有表。受支持方案应优先用已兼容的同一 build 关闭新入口，并保留 S01/原 DB 的最终写入保护。若要支持真正旧 build 开库，须另有实际可执行的兼容阻断及验证；当前不宣称已具备此能力，也不以手改版本、删除表或 reset 作为回退。最终 release 必须明确选择受支持回退方式并同步02/05，不留一句不可执行的“旧 binary 会自动拒绝”。


## rev6：同库双 marker 与安装历史（拟冻结合同，待独立审定）

此修订只明确原schema_migration一个INSERT行的归属，不新建第二业务库、不改旧表DDL/其他migration行、不改变以上六个显式对象或其DDL摘要。原表实际定义在固定候选src/host/projects/job-kind-migration.ts:121–126，六列为id/from_version/to_version/applied_at/backup_path/detail；须先成功完成原RevisionStore开库与该表核验，缺失/不匹配/EIO不是初装。安装显式发生在受信Host启动、回收/观察/读写入口开放之前，不在constructor偷偷建表。

本模块仅可在原连接/同一个BEGIN IMMEDIATE原子事务插入：

```sql
INSERT INTO schema_migration
 (id,from_version,to_version,applied_at,backup_path,detail)
 VALUES ('created_review_publication_v1',0,1,?,'',?);
```

applied_at必须是该事务实际UTC Date.toISOString，不在重开时刷新；backup_path精确为空，因为这是additive安装，不虚构backup。detail精确UTF8 canonical JSON，无多余字段、空白或最后LF：

```json
{"ddl_sha256":"be75d5683a25861ab2cbe14d0a12c4bbde050a342288e2f254f577a2a6623e56","format":"narralens.created-review-publication-migration@1","namespace":"created_review_publication","version":1}
```

detail SHA256：`b021a477274708f2695cd4676d1c806ddef0d5f2d25be6c5c8e9142bc01e4dce`。from/to必须真实整数0/1，id、空backup_path与detail逐字核对，不能只解析JSON比部分字段。按literal prefix `created_review_publication_` 用substr/length等精确比较查询所有相关migration id，不用LIKE的下划线通配；仅认识created_review_publication_v1，未知/高版本同族行拒绝，不落入absent分支。

|独立外部marker|私有六对象/单例marker|动作|
|---|---|---|
|全无且无未知同族id|全无|原owned DB信任边界内允许首次安装；DDL、私有receipt、外部marker、最终核验同事务提交|
|exact v1|完整exact v1|只读核验定义/索引/trigger/两份receipt；不更新applied_at、不补业务publication|
|exact v1|缺失/部分/不符|明确拒绝安装/服务，保全既有数据；不重装、不补表|
|无|任何私有对象存在|明确mismatch，不能补外部marker|

任何marker畸形优先报错，不能当不存在。私有receipt与独立marker每次服务最终检查都重读，schema_version未变不免检marker DML。DDL/两marker任一插入/最终校验/COMMIT边界失败后应是全有或全无；崩溃验证同原DB同连接/同根，不能用新临时库冒充恢复。所有原job-kind/S01/CP-A0行逐字保留。

这解决“只删私有namespace”或“只删独立marker”的识别。若操作者同时删除两份marker及全部namespace，或整体回滚整个原DB，本地账本无法密码学证明曾安装；本阶段不假称能检测完整DB回滚。任何既有package/binding仍在但publication原像不存在，媒体GET/describe及当前prepare/apply的publication前提必须拒绝或明确对账，不自动渲染补成旧审核结果。新真实run/producer可以按正常新package形成新事实，但不能重标历史批准；文档与实现均不声称旧review已恢复。

补充到原PUB-DB01/02/RC01：四象限、未知同族版本、外部marker全字段DML、两份receipt任一丢失、schema_version不变、DDL/私有marker/外部marker/最后检查/COMMIT各边界，同库重开两次幂等；PUB-RD01验证旧package仍在但无原像时读/采用均不伪造。编号不替换，当前全部NOT_RUN。此为下一阶段私有schema目标，未注册当前生产API，不是本轮N1/N2/A04代码范围。

## rev7：受信媒体读scope与最终交付门

NW6-A01确认仅实现无caller参数的binding resolver不足以完成本节session/currentness规格。完整拟私有接口、真实请求签发来源、review-media-http.ts/dispatcher/CreationApplication窄接线路径，以及describe/openMedia/HTTP每个await至交付的同步最终门，以04的rev7节为规范；不改变本文件SQL、双marker或receipt哈希。

PUB-RD01必须按04的真实窗口矩阵逐格验收，特别包含descriptor close和backpressure、scope异步释放之后的最终同步复核。已写入socket的字节不可撤回，不能承诺跨DB与socket原子撤权。close失败保留且不能释放仍在使用的资源；DB最后关闭。上述均NOT_RUN；此修订不是当前N1N2实现/验收release。
