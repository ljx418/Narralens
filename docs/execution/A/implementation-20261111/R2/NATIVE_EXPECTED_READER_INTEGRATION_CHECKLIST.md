# MAIN 原生预期读取器接线检查清单

状态：接线前代码核对记录；未释放新源码，不宣称已实现或验收。基于 MAIN de438d17 与现有 PRODUCT_NATIVE_COMPOSITION_PLAN.md，后续不能用缓存路径代替本清单所需事实。

已观察：CreatedNativeWorkspaceService.prepare 从同一 committed snapshot 复制文件；isPrepared 验证 issued view、当前 committed binding 与目录身份，未验证完整字节。rootFor 的 #verify 重读原 entries，只证明这些文件仍匹配，未证明相关新增文件/缺失事实及原生枚举顺序。因此这两个API都不能直接作为 NativeExpectedSourcePort 的完整 closure proof。

实现接线前必须满足：

1. workspace_ref 只映射到实际服务登记、同一 owner/commit/revision/snapshot/source 的工作副本，拒绝 body/字符串路径伪造。Expected binding 的 isCurrent 只证明会话，不能替代实际数据库/文件证明。
2. 保留原 committed snapshot 独立读取与 created producer lineage 分支；不得为支持 rich native clip 而删 legacy completeness 问题。原 source digest/rights/source manifest 与持有句柄共同重验。
3. 实际 native working copy 的 film/settings/markers/style/transcripts/translations/media 读取，须与该已提交基线匹配。新文件或工作副本变脏不得因不在旧entries而漏检为loaded。需明确 native 派生缓存的逐项白名单及上游出处；未知新增项 fail closed，不能泛称metadata可忽略。
4. computeNativeEffectiveSidecars 只计算 supplied input，当前已独立接受的修复仅保证 queried listing 与 supplied file facts 一致，不保证supplied facts真实。MAIN必须独立取得实际精确目录枚举、正/负文件事实、同媒体字节真实probe；不得从浏览器obs或字幕的最大时间猜duration。
5. NativeExpectedRetainedFile.verify 和 verifyClosure 必须同步且持续持有真实文件/父目录身份，包含新增/删除/同字节新inode/负lookup变为存在；源读取成功后句柄责任交给Expected，失败前由reader负责所有清理。PRODUCT当前生命周期修复是前置组件，未完成时不能越过它直接接线。
6. 原ExpectedProjectionInput的settings/markers需固定015读取及规范化，style/captions用已固定原生规则；not_proven不是默认已证明。media/listing/rights摘要来自实际读取，同一事实不得同时当输入与自证摘要。
7. native_rev必须复现原生server真实算法与文件字节绑定，不能使用工程revision字符串代替；需在实现前定位固定上游算法并给独立向量。
8. proof等待期间commit/control/selection/session/generation/workspace变化均拒绝。缓存loaded也必须重验闭包，不凭同revision直接复绿。关闭/晚到proof由当前PRODUCT生命周期票处理并另做接线实测。

待验收：真实已采用created source→原工作台同一时间轴→document及四hydration→选择→独立expected→原库NativeAck→Context loaded；以及新增caption/style、同字节替换、commit/control漂移、重开与关闭时晚到结果等负向。实际Host/浏览器/媒体统一预约；当前所有这些接线用例NOT_RUN。
