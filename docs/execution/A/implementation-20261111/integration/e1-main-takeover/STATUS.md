# E1 MAIN 根因接管候选

本目录记录从 cfadc136 候选接管后的实际修复；原始输入见 IMPORT.json，旧宽泛scope测试与旧publisher夹具原样归档。

- 修复：封闭同步commit、真实publisher proof/FD/完整闭包守卫、同DB私有scope、R1 geometry与新增adoption provenance分表。
- 真链抓出并修复：40位Git SHA被当64位内容摘要；roots排序改变entry；测试fixture遗漏worker启动、SQLite外键创建顺序和合法review URL。
- `real-007`：两文件19测试全部通过，其中8个真实Host/本地媒体/原生源码/快照与提交边界用例；输入未改变。
- `typecheck-06`：exit 0；`d09-python-02`：11向量一致。
- 原失败real-001..005全部保留；real-006为单条正向通过。

限制：接受review策略为明确模块夹具，未证明真实UI审核、全Run、独立外审或人验；未集成created-source-change-service，BRIDGE剩余模块/PRODUCT/MEDIA仍各自开发。当前只能称E1候选内部模块证据，不能声明R2/A完成。
