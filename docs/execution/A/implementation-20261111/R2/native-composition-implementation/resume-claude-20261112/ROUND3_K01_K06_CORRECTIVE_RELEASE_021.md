# 原 N1/N2 范围：独立 round3 K01–K06 合并修复约束

状态：原014修复授权的精确补充；不是下一接线阶段实现许可。真实基线为 BATCH_020_GRANT.json，HEAD e2eff61b464d75d36598103d718cd2a75db5dfda，生产字节与独立审查019相同，仅测试收尾断言变化。独立报告 independent-coverage-audit-round3/REVIEW.md 与 MATRIX.json 为输入，1 BLOCKER/5 MAJOR，绝不写外审 PASS。

## 先结束正在运行的捕获

既有020已启动命令必须保持全部源码/测试/工具/配置/索引冻结，等真实退出并交 own cleanup。未启动的159撤销；若已经启动，保留其运行及真实结果，不因消息迟到重复运行或强杀。MAIN核验后开始本合并修复；不得一边测试旧字节一边改源码。当前156=3通过、157=19通过不被抹除，也不覆盖完整17项缺口。

## K01：由真实工作区签发且绑定签发者的内存能力

实体关系必须为：CreatedNativeWorkspaceService 的真实 refs/binding → 不可伪造的 Host-private production lease → produceNativeCacheEntry → issuer-bound witness → 同一服务实际 record/lookup → CreatedNativeSourceReader。原始 ref/root/generation 字符串、结构化 registry 回调、全局 witness WeakSet 都不能单独授予资格。

production lease 必须由实际服务核对现有注册 view、实际 owner/base/control/generation 后签发；运行时用模块私有 WeakMap/私有品牌解析，未知对象/复制品/已释放/其他签发者拒绝。签发与解析不能是公开的“给任意 callback/object 加品牌”工厂。可复用既有真实 workspace lease 品牌并增强隐藏签发者关联，不新增持久权威。若新增 Host-private opaque lease，存放在既有白名单模块，不增加公开 DTO、EnginePort 或路由。

根、ref、generation、绑定以及所属 descriptor pool 来自已验证能力；caller 传同名字段必须相等或直接删除冗余。未知/foreign 能力在真实 producer 开工前拒绝。最终 witness 的隐藏签发者必须绑定这个服务实例及同一生产能力，真实服务 record 还要重验当前 binding；其他 registry 发行但 root/ref/gen 恰相同的 witness 仍不能晋升。服务不得公开原始可写 ledger，不允许调用方借自造 token 绕过入口。一个 caller 自称成功 record 不能使其 witness 对真实 reader 有效。

反例分别独立执行：plain lookalike、public ledger constructor、clone、另一服务实例、同 root/ref/gen 的后续 service.record 晋升、失效/释放/新 generation。每个反例证明实际拒绝边界被命中；不能由前一个更早错误导致后续分支永远不执行。

## K02：解析临时副本的成功与失败路径同样结算

CommittedSnapshotAuthority 私有 parse copy 仍取 bounded retained film bytes，固定 parser 只读该私有副本。副本拥有者覆盖 mkdir/write/parser 真正 settle/remove；成功也必须清理，失败/取消/晚到结果保持真实 owner 直到原始 parser settle。

保留 primary，尝试全部 cleanup，保留每一个 named cleanup cause 及 genuine 标记。禁止只有 catch 清理或裸 finally 抛错覆盖 primary。成功但 cleanup 不确定则不交付成功事实；其上级 reader 接收真实不确定状态。对 narralens-n1n2-film-* 的当前分配提供明确 Host-private 生命周期观察/owner 证据，不仅检查 fixture 根目录。历史前缀目录不得盲目 glob 删除；只清理可证明属于本任务且已无使用者的分配，未知归属如实列明。

## K03：原生 key、海报配对、既存保留

固定上游规则仍是唯一算法：pageframe 的规范化 rel/ms/width/overrides → frameKey 三件套；film poster 是同一次 film.html、ms<0、规范化 width=480 绘制的配对产物，不使用早返回的 filmPoster race。若本包装只允许固定 ms=-1，明确验证这个更窄的内部请求并由所有合法 caller 使用，不把其他请求的旧图混入。

既有选择是保留并拒绝 unwitnessed preexisting instance；检查应覆盖该 key 的 JPEG/JSON/stamp 任意既存成员，以及会被本次调用覆盖的旧 poster。不能只检查 JPEG 后让 producer 覆盖旧海报或部分三件套。禁止清空整个 cache/其他项目目录。海报成功必须实际等于该调用返回 JPEG 的摘要，并对应 exact request；独立分开旧 poster、每种 partial triple、wrong rel/ms/width、正常页帧与海报正向用例。

## K04：最终资源身份与消费时身份必须闭合

PRE/POST 保留原有 bounded stream/text limits 和共同 instance pool。前置依赖只来自实际 source membership；大型 binary 用 bounded stream，不得套文本8MiB限制。原有 dev/ino/size/hash/mtime/ctime 比对不能代替最后一次 held-file/root/parent fence。

在最后异步读取及可重入观察回调之后，实际复核已持有的依赖与输出三件套身份/内容、root/parent identity、当前 production lease；不能用整树不变检查拒绝合法 cache 生成。保存必要的整数/纳秒身份，不用浮点时间精度制造盲区。消费端用自己安全持有的实际 dependency/output identities 与 witness 全部比对；只比 sha256/bytes 不足以接受旧 producer witness。same bytes/new inode、same-inode change→restore bytes+mtime、parent/root swap、三件套替换均要有真实边界和失败反例。

cache 仍不是 author source、独立 Expected 或审批事实；新 source proof 不会自动刷新旧 witness。合法情况失效后只有重新真实生产/重新完整见证才能取得新的能力；不把旧品牌搬到新实例。

## K05：清理不确定时绝无可用见证

见证的发行、可用性和资源结算必须有明确线性化点。优先在所有实际资源结算确定并完成最终同步身份/control检查后，才让 issuer-bound witness 可用；如用 pending/active/revoked 私有能力，pending 不得被 lookup/reader 接受，任一真实 cleanup 失败必须撤销可用性，不能只让调用 Promise reject 而留下有效记录。

这不是新增持久状态机/数据库表。失败时保留原始错误、全部内外 release 原因和 genuine 身份，不允许 nested finally 覆盖错误、不允许重复关闭已回收数值 FD。所有清理尝试完后才判定，成功路径也不能把不确定 owner 遗忘。临时资源 settlement、witness 激活后的最终身份有效性、后续消费复核需要一起设计，不能为了“先清理”把最后身份检查做成死门。

测试应包括：原 producer 错误+PRE/POST各自 cleanup 故障、多重 cleanup 故障、成功生成但清理失败、记录/激活前后边界、当前服务读取与下一次生产受不确定状态约束。若这些 fault hook 不能真实触及，补有限 Host-private seam，不能仅伪造一个 Error 对象当成真实释放失败。

## K06：合法生产输入与真实权威变动窗口

现有 assembler/created-source-publisher 明确支持 narration_asset_id=null；NativeDraftAssembler:72 仅在 plan.narration 存在时 mute video。利用现有生产合同生成不带 narration 的真实 SOURCE_ONLY 方案，并选择真实含音轨的视频，保留其合法权利、plan/consumer/job/revision 事实。不得手改已提交 author bytes 或伪造媒体事实来得到“heard 缺失字幕”。证明实际 native heard consumer 确实查询该 absent transcript，读取成功后再 birth 并验证旧 proof 失效。当前默认 fixture narration 路径及所有旧用例保留。

如扩展测试 factory，需要使用其既有 creative/run/task/producer API 与真实注册媒体；尽量在已有 native-source-fixture.ts 内组合。只在确有必要时允许 created-draft-fixture.ts 增加最小 optional test options（默认行为逐字段不变），并明确列出全部受影响测试；不改生产 assembler 合同。此为同一原始验收范围的测试布置，不是新增影片功能。

owner/base/control/ref/generation 的 await 反例必须来自真实服务/原 DB 权威与实际注册/替换操作；把布尔 callback 改成 false 只能作为补充，不能替代真实窗口。无生产转移 owner API 时，可用明确标记的权威数据库 fault injection 验证持有 lease 变旧，不能虚构用户操作/扩大 owner 产品功能。外国 lease 要经过真实 issuer predicate 的组合消费，不把 predicate 硬编码为 false。每条都记录实际边界 hit，失败前后没有越权交付/修改。

## 白名单、证据与开工条件

主路径仍是原014十文件；受保护 Expected、三个既有回归/Pin/artifact/依赖/公开合同/公共路由不得改。额外可选测试 helper 仅 tests/agent-driven/integration/helpers/created-draft-fixture.ts；使用前先登记当前完整哈希与最小变更说明并告知MAIN，不需要重复用户批准，也不扩大为任意 tests 目录授权。若不需要，不修改。其他路径申请准确原因后由MAIN协调。

所有旧失败捕获保留。每次候选所有实际源码字节按 SHA256 保存，数量不是验收。K01–K06 与原17项逐条映射，已有 G01/G02/G07 正向修复不可退化。当前仅允许真实录制的串行 tsc 直到新 MAIN runtime grant；无安装、外联、付费、J盘、配置/凭据、push/reset/stash、第二 writer。新429立即停且不自动重试/接手。

合并修复先形成一份实现/验收映射，再按风险路径分组运行有判别力的反例与正常实际 producer，用完整回归验证默认行为。不得每修一个函数就宣称 Kxx/阶段完成。最终仍须实际候选 commit + 独立绑定审查，再重绑定下一接线合同；本文件不开放下一阶段。
