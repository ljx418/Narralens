# MAIN裁决：完整请求与持久恢复（首轮修订批次）

本裁决针对原问题msg_b51a407dfdd5。回复因Orca/WSL重启后原Dispatch失效而未送达，保全原reply失败记录；本文件为MAIN明确裁决，覆盖候选中相反测试预期，不扩大四路径release/Host/core/API权限。

1. **损坏/marker-only请求绝不补偿或中止。** 原队列内先验证wrapper恰operation/input、原ApplyChange、contentDigest、项目/base/source/execution；如adoption/prepared auth已存在，逐项匹配。合法校验前不得读owner/source路径、inspect/move资源或调用Publisher。已分类owned但损坏的请求保全全部source/backup/staging/snapshot，用原Coordinator真实持久attention，reason REQUEST_NOT_LEGITIMATE；仅attention事实可增加，不消费批准、不改revision/pointer/impact/outbox/幂等/发表journal。未知kind/op仍not_owned。
2. **早期缺fact是独立分支。** 完整合法原request/hash/project/base/source、真实DB creation owner/origin、确实无发表journal/identity时，才能独立证明完整当前author与committed原base/owner后走原abort。若已有发表证据却无匹配fact，保全attention。无journal从不单独证明作者未写；测试不能从另一个已published target的fixture假称原source未变。
3. **attention必须真落原库，进展必须真来自原库。** 当前#result仅返回标签，不是持久决定；测试期待attention同时prepared是错规格。原Coordinator在队列内落attention，验证transaction/project gate。recoverOnStart不能按返回标签累加progress而对同prepared无限循环；可按排序单pass交既有MAIN scheduler收敛，或只统计观测到的原DB终态变化。attention/recovering仍须出现在unresolved IDs，不能返回空集假就绪；终态绝不复活。
4. **瞬时/未知失败不终态。** #proveOriginalHeld/#guard/#proveOwner不能catch-all把ENOMEM/EIO/现有503 HOST_RESOURCE_EXHAUSTED/cleanup uncertainty变成不符证据。传播真实类型并defer/reconciliation，保全prepared及文件；只把已证身份/内容冲突attention。不要默认所有409/ProductError都是gate；journal读取除确证无表/无行外不能把I/O/坏schema吞为空。
5. **已提交回放不能假成功。** #verifyCommitted没有匹配合法request/fact/owner/原receipt时，不得fallthrough报告already_committed和base+1。严格验证原同key/digest/transaction/principal/Applied；缺失或损坏只能诚实拒绝/待核对，不回退已committed文件/指针，不编造Applied或revision。真实历史receipt可在后续合法commit存在时复读，不把旧target当currentauthor。
6. 在同一首轮修订批次补代码与真正会失败的对应反例，并保留旧候选/错误断言及失败捕获。确切外部未决prepared仍defer，不改原closedcommit来调绿。正在运行的真实捕获先等终止再改输入；资源只沿原两文件串行grant，无全量/浏览器/provider/J。任何新429停工，Codex/MAIN不得接手，除非用户明确授权此次接手。

原实现尚未证明业务恢复门/Host接线/SIGKILL/NativeAck/A通过。测试必须同时核对完整文件字节+身份、状态/批准/impact/revision/pointer/step/outbox/幂等，不能只验返回标签。
