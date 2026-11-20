# 下一接线阶段发布前接口重锚清单

状态：DRAFT_PENDING_N1N2_ACCEPTANCE。本文不是实施授权，也不替代已审查的下一阶段草案。

N1/N2 尚无接受的冻结提交。原 17 项要求、最终回归和独立冻结审查均须完成，才能向下一阶段文档写入 accepted_native_commit。

1. 将草案中的“014拟 producer / wrapper”逐项重锚到最终接受实现：CreatedNativeWorkspaceService.produceNativeCacheEntry 与服务私有的 production lease、witness 归属关系。不得向路由暴露可自选 registry/root/generation 的生产权威。
2. 原生页面服务须使用固定上游 folderFiles 默认 timeline 注入，核对实际加载依赖摘要；不要以直接静态 film.html 服务代替可运行原生页面，更不能注入伪造 window.film。
3. 缓存见证限定 workspace、代次、具体绘制请求、输出与依赖全身份。海报绘制同时产出的三件套仅能由同次绘制且 frame_key 相同的真实海报见证覆盖，不能扩大为通用缓存白名单。此条实现仍在修复和待验收，不能提前标为已通过。
4. 上游毫秒 stamp 与 Host 纳秒身份必须分别保留；源身份不可退化为毫秒或摘要比较。平台真实 stat 向量与消费者篡改用例应进入下一阶段回归依赖表。
5. 生命周期按实际 owner 停新请求、排空受理工作、原始媒体探测和共享浏览器，最后关闭 DB。HTTP aborted/finish 不自动证明底层任务已结算。
6. 最终冻结清单要记录所有实际依赖路径，包括条件夹具及此前授权的 Expected/ack 等保护依赖，不能用历史“十文件”简称漏掉真实字节；用户 AGENTS 不得被捎带提交。
7. 逐个复核下一阶段既有 28 个 S01 case 及发布提案附加 case 的输入、生产者、路由、故障点和证据，不以 N1/N2 组件通过替代 Studio/Host 重启、真实审批或 A 成片证据。

所有旧失败捕获与原 Gate 历史保留。完成上述重锚和独立合同复审后，仅停在下一阶段开工门槛，不实现下一阶段代码。
