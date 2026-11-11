# N3 临时句柄修复候选

状态：内部专项证据完成；独立复审 PENDING，未声明 A 通过。

- 修复 PreparedDraftVerifier 样式临时 FD：关闭不确定性进入持久于实例的历史故障集合；保留 stat/hash 与 close 双重错误；禁止重试裸 FD。
- 修复 Publisher 默认 fsync：实际 FileHandle 从取得时登记；sync/close 原因均保留；关闭时只重试原句柄对象的方法，历史故障不因后续 no-op 清除。
- real021：四个临时句柄用例实际通过。real022：七个真实 Host/native/source publication 用例通过（另32未选），追加覆盖真实 proof 生成后的 stage/outer-held 清理撤销与 pending-close 等待。typecheck31 exit0。所有输入扫描无变化。
- real023：仅将 publisher/verifier 两文件替换为 2b2dfec 冻结旧字节，当前依赖/当前测试下四例均失败；原 fsync 丢失原因、STYLE 被归一化成可重试资源错误。此为两文件反事实，不冒称全旧候选。Python finally 已恢复并核对新字节摘要，见 n3-temporary-control-restoration.json。
- 故障注入是在真实 close 已执行后由观察器抛出受控 EIO；证明软件对未知关闭结果 fail-closed，不证明真实内核 close 故障。
- 特定故障测试只移除自身拥有的关闭回调并显式清理全部 fixture；全局 afterEach 未放宽。原失败 typecheck30 保留。runner v2 的外层退出码不代表子命令结果，须读取 .exit/.result.json。

待完成：恢复后的完整39例回归、独立 N3-a/N3-b 复验。生产组合/专项恢复/NativeAck/正式导出/A 完整影片证据仍未证明。
