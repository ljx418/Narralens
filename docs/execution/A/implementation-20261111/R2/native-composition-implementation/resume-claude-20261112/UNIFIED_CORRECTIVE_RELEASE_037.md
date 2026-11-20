# 037 集中修复：MAIN源码放行与约束裁决

对应 UNIFIED_CORRECTIVE_RELEASE_037.json，唯一writer为Claude ctx_ae73a82c85e9。用户已明确恢复。方案a664f16e…、清理收据9b3ad345…已审查；MAIN当前复核两个自有遗留PID消失、4747/4748无监听，22冻结输入、用户AGENTS及空索引不变。以下约束优先于方案中的歧义。无需再等人工裁决，按此完成同一集中批次。

## 精确范围

JSON白名单18个源码/测试文件及3个固定摘要opaque fixture。其余候选字节保护不变，特别是Expected015、committed-snapshot-authority、revision-store生产实现、公共DTO/EnginePort七方法、pin/配置/旧Gate/运行器。只修改必要路径，不以“15候选均可延续”为由整体开放。自身OWN文档可更新，每个新候选保存逐字备份，旧证据永不覆盖。超出范围的必要修复以精确差异请求MAIN，不静默扩大。

## PF01：同一被签发实例与真实serving的绑定

允许新增方案所列Host-private self-owned serving owner，复用固定folderFiles/pageFrames；handler-only工具保留为非授权工具。模块私有WeakMap唯一登记，binding出口只能给只读副本，不能暴露可变注册事实。生产不可接受自由base或对象字段当权威。

**不可把不同生成器产生的两个number generation直接相等当作绑定**：owner工厂计数与workspace generation并非同一域，也不能仅root+恰好相同数字信任另一分配。服务应创建/登记自己的serving与确切签发view/lease实例关联（内部只读方法命名自行确定），生产用对象分配身份、当前view事实、root-heldFD dev/ino、活跃listener/owner代次共同核对。合法本根正例必须可用；外根真实owner、复制/伪造/closed/replaced owner绘制前拒绝并零请求/零缓存写，见证激活前再次验证。

close阻止**新的生产受理**，但已受理绘制可能继续发起页面/资产HTTP请求，不能提前断listener使其失败，也不能把abort当raw task已结算。保持实际在途draw/probe/HTTP依赖直到它们结算，再关闭listener及相关root资源。初始化失败、owner关闭、peer producer关闭、清理异常都有归属收据，不广杀。

## PF02：真实输出见证与逐输出消费

duration输出必须由真实draw后POST持有、进入pending记录、最后全身份复验、全部清理确认后active。仅增加lookup并不足够。ledger按输出路径维护当前active授权，撤销/失效不回退到旧授权；frame三件套只检验它自身实际输出，不因新的合法duration替换而永久失效。lookup只读能力由既有服务持有，不允许外部补签。保留真实两次不同frame绘制正例及伪造/新inode/改后恢复负例。

## PF03：联合故障的真实可达性

批准RetainedNativeDescriptorOps新增**可选Host-private分配观察元数据**，对已有调用后兼容；phase由生产包装覆盖，不接受调用者自报相位当权威。分配身份是allocation namespace/单调id+phase+path，不是fd数字。先把会暴露丢失的用例写出，再仅按其暴露问题修补merge。

POST观察点变更film若先触发POST acquisition SOURCE_MOVED，则不能声称已命中后续SOURCE_RACED比较：必须记录实际主因/分配时点，选择可达组合。生产成功后主因+PRE/POST独立genuine对象各保留一次，全部关闭尝试、无可见见证、sticky拒绝。另跑“不抛错误”的控制不能单独证明删除POST原因的变异必红；后续须在独立运行grant下保留真实变异/反事实证据。无运行证据前均NOT_RUN，不把新增测试不存在称为old-red。

## LF03：哈希证明窗口，不降低并发成功要求

保留两次同内容不同key并发成功、一资产两回执一次事件、并发2、取消无槽泄漏及所有篡改负例。只在**已发布内容寻址对象**证明路径考虑ctime变化，私有staging完整校验不得一起放宽。

若采用与assertBlob一致的二次证明：第一次摘要必须匹配expected、held FD dev/ino/size/mtime及canonical路径均不变；ctime变化后从**同一FD**显式位置0重读完整内容，摘要仍匹配，二次读取前后**完整fingerprint包含ctime**稳定，最终复核路径/身份；不能继续已在EOF的游标。建议该最终二次证明使用现有同步fstat/read风格，防止同一进程其他staging清理再次插入窗口；不允许循环重试、无条件忽略ctime或把原因一定解释成unlink。同步证明仍需有界(MAX_BYTES)与失败关闭。事实只能称重新证明内容稳定，除非有直接归属证据，不声称知道每次ctime变化原因。

N10现方案仍只说“before_publish之后”，没有确保发生在hashFile两个stat之间。批准在既有Host-private boundary union增加一个精确命名的**published blob初始stat后、读取前**观察点，测试用真实link/unlink发生在这次实际证明窗口，并记录前后ctime/完整身份/hash/命中次数。它不改变任何公共请求能力。保留N9真实并发测试；N10不是其替代。旧严格comparison变异下用同一观察点实际打红，不能靠旧码没有hook证明。

## LF04：一个状态权威与原子提交

批准CreatedSourceImpactStore最小expire委托ImpactStore.markExpired，服务读取返回/实际状态，不无条件置expired。现有同步SQL路径中是否真可插入并发需真实可达证据，不构造不可达race签通过。

批准fitness里精确revision-store.ts/commitPreparedCreatedSource注册，**不改revision-store生产代码**。这不是全局同名豁免：负向必须覆盖其他文件同名、同文件未登记方法，CAS/hash/项目错配及完整事务回滚由实际业务负向证明。保留原扫描器负向。所有新反事实执行另申请运行grant。

## LF05：能力边界代替整文件词法猜测

选择方案AST/能力边界测试，而非仅改req/request变量名。不新增serving文件。保留其余13断言、固定argv、shell拒绝、伪造pin verdict拒绝。vendor参数string本身不能证明无请求污染：至少覆盖所有Host装配入口/加载与serving工厂路径及调用点；合成header/body来源、别名/重命名或通过helper传递到vendor参数必须被识别，不能只靠req/body名称。保持规则针对来源与能力，而非单词。若有限AST分析无法可靠覆盖，则报告具体限制请求MAIN调整，不写假完备断言。

## LF01/02：可复现的组件夹具与真正的渲染证据

选择A：从canonical只读复制3个17/17/18byte旧opaque文件到JSON精确路径并核SHA，不改原组件manifest、也不以真实视频替换旧合同字节。**这些文件必须最终能在干净checkout复现**：Claude现在不add；MAIN冻结时将显式git add -f这3个确切小文件，或另行采用等价追踪方案。不能只在本机补ignored文件后宣称交付可复现。新增OWN清单说明它们不是MP4/WAV，源摘要与用途清楚。

真实导出文件当前仍有两条真实目标渲染/完整decode/900frame/中镜修改与第二次导出的既有要求，必须保留，不以独立D1探测一条绿替代它们。**仅更名原测试+另加无关媒体decode不足以关闭LF02**。

批准在migration-real-export.test.ts的私有临时fixture里，生成/准备真正有效、帧数与本次声明一致的视觉与旁白文件，实测probe+完整decode，按真实bytes更新该临时fixture的manifest/hash，AssetRegistry用真实probe而非常量900；不改固定opaque夹具或已验模块。已有本机D1媒体可只读使用但不得假定其帧数900；可用固定本机argv离线生成有界30s诊断媒体来匹配实际900frame，生成执行只在后续重型test grant内。记录诊断媒体不是A创作影片。

既有两个目标导出仍调用固定上游真实renderer、实际解码计帧并比较。旧migrator标题页面≠原视觉内容保留，不重写旧migrator，不据此声明完整可编辑内容迁移。回退中的Hypit回调若只是摘要/既有产物证明，明确其性质并保留源bytes/绑定/历史产物检查；不能把摘要冒称新鲜源工程导出或伪造900frame。新鲜付费Hypit导出未授权。若真实export用例因旧migrator限制不可执行，报告实际阻塞，不降低断言来假绿。

## 编译和后续运行

本次仅新增一次精确编译许可：完成集中源码批次、保存所有候选字节和全路径hash清单后，经原run-recorded.py执行 capture n1n2-claude-037-tsc-001 / argv corepack pnpm exec tsc --noEmit，串行且输入冻结，独立读取result+cleanup；非零保留并停止申请下一许可。除该编译外，vitest/媒体/Host/浏览器/构建/变异/全量均**未授权**。完成后交代码差异、编译结果、逐case预期以及精确运行申请，MAIN会审查后一次提供有依赖及失败即停的运行序列，避免细碎往返。

新429立即STOP报告，不自动重试或接手。所有失败证据保留，Git索引由MAIN独占。禁止本轮实现下一接线、A影片/V1完成或独立外审自签。
