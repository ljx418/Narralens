# N1/N2 冻结候选审查入口

本包封存真实代码与证据，最高状态为**内部全量门禁通过、冻结独立审查待完成**；不是A轮/V1完成，也不自签外审。

1. 读取 SOURCE_SCOPE.json：当前25个新增/修改源码与测试文件及3个17/18字节opaque夹具，用户AGENTS和无关lane-media草稿排除。实际以清单为准。
2. 原始17项逐字保存在 ORIGINAL_REQUIREMENTS.json，TRACEABILITY.json 是内部候选映射，独立审查仍须逐项读取代码/断言及原始log，不得以测试总数替代覆盖。
3. GATES.json 索引完整check、独立build（包括validator --check）、85项Expected、两条实际反事实及恢复。完整check实际exit0，188files/2592pass/1skip，Python8向量与两vite均实际通过。被跳过的opt-in real-tools用例明确NOT_RUN。
4. 所有旧失败capture、旧错误工件保留。053工件必须依054的validity-index逐项判定：003五份active，001/002六份manifest拒绝或字段错误，不能直接glob目录宣布全部PASS。054/055/056新capture各自的artifact和manifest绑定自己的capture与源码hash。
5. 诊断30秒媒体不是A轮两条60–180秒中文有声作品，不冒充人类体验、NativeAck/Studio完整就绪、下一接线完成、源画面保真或fresh Hypit付费渲染。
6. 独立复核必须绑定**实际包含此包的commit**；当前文件不能引用自身最终SHA。MAIN获得SHA后另存绑定回执。修复后重新冻结/验收，不覆盖旧Gate。

固定上游要求OpenFilm e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3、Hypit6fdd8c0f02c17b9970aee6deb4550a70e9d57acf；依赖lockfile不变。当前真实上游位于隔离树，未把vendor冒充生产submodule；跨机器需显式准备固定SHA与匹配依赖，不能用latest。

当前只允许审查与下一阶段文档准备，不释放下一接线生产实现。新Claude429立即停，不自动重试或接手。工作区直接收纳videoWorkLine下，无项目入口中间层或孙级套娃。
