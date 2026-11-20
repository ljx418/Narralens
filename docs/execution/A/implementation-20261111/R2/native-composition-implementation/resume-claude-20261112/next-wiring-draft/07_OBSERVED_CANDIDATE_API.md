# N1/N2 冻结候选：下一接线的实际接口与差异约束

状态：OBSERVED_CANDIDATE_ONLY / DRAFT_NOT_RELEASED。观察对象为 `1d348d419120f23f45d958112ea8c43df5a04675` 的实际 Git blob，不是独立验收通过声明。accepted_native_commit 仍为 null。两路独立审查进行中；已收到畸形 HTTP URL 逃逸、文本前置预算与 EOF 哈希上界的候选 MAJOR。必须先完成审查、Claude 修复、自验证及新冻结复验，再把本附录重锚最终接受提交；不得把候选接口自动当成已验合同。

## 实际已有端口与下一阶段消费方式

|实体|候选提交中的真实接口|下一接线约束|
|---|---|---|
|共享 FD 预算|RetainedDescriptorBudget(limit)，RetainedDescriptorPool.limit/used/uncertain；reserve()/release(certain)|装配 owner 显式创建一个预算对象，分别注入 workspace.options.descriptorPool 与 reader.deps.pool；不要让两处默认构造形成两个预算。source acquisition 沿 reader 把同对象传入 authority。以实例身份和并发消耗直接证明，而不是比较 limit 数值。|
|提交源权威|CommittedSnapshotAuthority.acquireNativeFacts(projectId, transactionId, principalId, pool?)|只能传同一个已品牌化预算；源闭包由真实提交事实取得，不把任意 root 或浏览器对象当 authority。|
|工作副本|CreatedNativeWorkspaceService.prepare(projectId, caller)；registerWorkspaceRef(view, ref, registration)；acquireExpectedLease(ref, expectation)|view/ref/generation 都来自服务真实签发；registration 包含 project/principal/transaction/snapshot/source/revision/native_project_id；generation 由服务补入。不能克隆 view/lease 代替。|
|读面|new CreatedNativeSourceReader({authority,workspaces,library,pool,...})；readSource({binding})；close()|library 使用受保护 approved015；并非调用 readSource 即取得最终 NativeAck。交付的 retained handles 仍由消费 owner 释放；reader.close 不会替消费方释放已交付资源。|
|派生生产许可|workspaces.acquireCacheProductionLease(ref, expectation)|输入不是 root/path；精确对象登记在模块私有表。当前类型无 release() 方法，不允许在交接提示词中虚构该方法；生命周期由真实工作副本/引用/服务关闭与内部资源账本处理。若下一阶段确需额外 release 能力，须先单独审定增量合同。|
|真实缓存生产|workspaces.produceNativeCacheEntry(production, {producer,rel,ms,width,overrides,kind})，kind 为 pageframe 或 film-poster|请求没有 origin/base/serving 字段。producer 必须是 createPinnedOpenFilmCacheProducer 签发的真实 owner；root、origin 和 serving 的选择属于 workspace 服务。不能拿裸 producer.pageFrame 的结果直接补签见证。|
|素材 serving|workspaces.servingFor(production, producer, options?)；servingFacts(ref,generation)|内部按真实 issued view 单飞创建 serving，返回私有 bridge；facts 不暴露 origin。Serving owner 的 origin/root 来自其自己的私有事实，HTTP 请求/调用方不能声明。servingFor 的 headers 仅 Host 固定安全策略，不来自用户 URL/body。|
|缓存授权查询|cacheWitness(ref,generation,key)；cacheWitnessByOutput(ref,generation,output_path)|最新输出授权与具体绘制绑定；新绘制撤销后旧授权不能复活。pending witness 在资源真实 settle 前不可见；缓存路径和 key 不能泛白名单。|
|资源状态|workspaces.uncertain；reader retainedDirectories/descriptorPool；retainedCleanupFailures/mergeRetainedCleanupCauses|诊断状态不构成授权。保留所有真实清理原因；普通输入/读取失败与真实 release 不确定分开，不能补造 cleanup 错误。|

NativeCacheProducer.pageFrame 在底层仍有 root/base 参数，这是适配层私有机制；它与上面的 produceNativeCacheEntry 请求不是同一接口。04/05 中“Host origin”只表示内部事实归属，绝不是新增 wire 字段。

## Host 当前缺口与关闭顺序的精确含义

候选 CreationApplication 已构造 nativeWorkspaces，但未装配上述 source reader、同一共享 pool、持久 selection 与 Ack/Context 组合；其 ProjectContextService 仍传 undefined native port。候选的正常 review media 读器没有真实 package receipt binding producer。这些仍是下一阶段 W1–W4 要完成的接线，不能因 N1/N2 组件存在就宣称当前 Host 全链已实现。

workspace.close() 实际设置 closing、abort 并使所有 refs invalidated，等待已登记操作；它不是“只停止外部准入而所有 proof 保持有效”的 API。disposeAfterNative() 才在 native 停止后关闭 serving owners 并释放根。reader.close() 会停止准入、结束等待、kill/reap 自有 child，并等待原始 acquisitions；已交付 handles 的释放仍属于消费者。producer.close() 排空该 producer 自己的调用，最后 owner 与全局在途调用都清空才关闭共享 browser。

下一阶段 Host 在入口层先停止新 public/event/timer 准入，追踪并等待已接收的 mapping/Expected/Context/publication 与真实资源；允许关闭引起明确取消与 Ack+0，不承诺所有在途操作成功。不得靠调用 workspace.close() 代替该入口 gate 后继续声称旧 ref 当前有效。开始销毁前，原始 acquisition、已交付 handles、draw/HTTP/probe 都必须有真实 owner 与 settle 收据。依赖应保持到其最后使用者结束；producer 排空、native/gateway 停止之后，才能 dispose native 根；原 DB 与 FD9 最后关闭。若实际循环依赖阻止该顺序，先向 MAIN 提交具体路径和最小 hook 合同，不擅自重写已验组件。

## 下一阶段增补消费验收（不替换原编号）

|补充 ID|操作与直接断言|关联原门|当前|
|---|---|---|---|
|NW-API01|真实 Host 装配后采集 workspace/reader/authority acquisition 的预算对象身份；并发 proof 与 cache draw 共享上限，uncertain 容量不被返还|R07、J04、S01-P01|NOT_RUN|
|NW-API02|真实 Studio pageframe/poster GET 经已签发 ref 和固定 producer；尝试 caller origin、伪造 lease、foreign producer、另一代 ref|R04/G04/G07、A02、H02|NOT_RUN|
|NW-API03|Host 关闭交叉 mapping、已交付 proof handles、cache draw 和素材 GET；证明 Ack 不迟到、所有真实 raw work settle 后才删根/关 DB，peer producer 不受影响|J03、HC09/10/12、S01-L01/L02|NOT_RUN|
|NW-API04|真实 Context 在无新 UI 事件时遇到 source/negative dependency/输出授权撤销；旧 loaded 撤销，同 key 旧 witness 不回退|A04、S01-C01/D02|NOT_RUN|
|NW-API05|真实正常 preview→impact→package/receipt→trusted decision→apply→native proof；不灌表、不用 preview/commit 成功代替 native loaded|S01-P01、A01/A03、PUB-TX01|NOT_RUN|
|NW-API06|重启原 DB/原根后重新建立 session/ref/generation 与真实 producer witness；持久 Ack 历史保留但不自动恢复 live loaded|J01/J02、S01-R01/R03、HC08|NOT_RUN|

本附录只是当前候选的静态接口核对；未运行业务测试，不增加原 N1/N2 的追溯验收承诺。候选发现项由独立报告闭环；下一阶段完整原 S01 28 项、HC/A/H/J/PUB 门仍须保留。

## 静态来源

以下 SHA256 均由指定提交 git show 原始字节计算，且本次与实际工作文件逐字节相同；不包含任何用户配置、凭据或外部服务读取。

- `src/host/agent-driven/created-native-workspace.ts`：`3702917cf6efe09287030435c1883e1cdd57eb6e0da2fdd577bf3879ab965c1e`。
- `src/host/agent-driven/created-native-source-reader.ts`：`cde88435d61dba1a881bef403e6a013f1d4f2bb93db8e1ffa2b3c15b4c74f82b`。
- `src/host/agent-driven/retained-native-closure.ts`：`ab7ffead1c4b7b238f7e4f6097b1d17ad7792513e84591b623f67c95576ac6e7`。
- `src/host/agent-driven/native-cache-witness.ts`：`97c1fe93037f3f31afdf67e97a5d4451d42ac7016d3cca642217fe1750c2573b`。
- `src/host/agent-driven/committed-snapshot-authority.ts`：`1c53360e3c618c603cfcbe61d0c2d57004c5bd33dc26a92c2fdec72a1844bd6d`。
- `src/adapters/openfilm/openfilm-upstream.ts`：`013f50ce87e04b3ff542e15f3c98d833ae43940fef9d85ccad79ff38e5bd200b`。
- `src/host/agent-driven/creation-application.ts`：`774749bfab1f13f8a6ecad6ac5c85e157daa2f0a97f0385b2798229b16f50333`。
