# E1 MAIN 根因接管候选

本目录记录从 cfadc136 候选接管后的实际修复；原始输入见 IMPORT.json，旧宽泛scope测试与旧publisher夹具原样归档。

- 修复：封闭同步commit、真实publisher proof/FD/完整闭包守卫、同DB私有scope、R1 geometry与新增adoption provenance分表。
- 真链抓出并修复：40位Git SHA被当64位内容摘要；roots排序改变entry；测试fixture遗漏worker启动、SQLite外键创建顺序和合法review URL。
- `real-007`：两文件19测试全部通过，其中8个真实Host/本地媒体/原生源码/快照与提交边界用例；输入未改变。
- `typecheck-06`：exit 0；`d09-python-02`：11向量一致。
- 原失败real-001..005全部保留；real-006为单条正向通过。

限制：接受review策略为明确模块夹具，未证明真实UI审核、全Run、独立外审或人验；未集成created-source-change-service，BRIDGE剩余模块/PRODUCT/MEDIA仍各自开发。当前只能称E1候选内部模块证据，不能声明R2/A完成。


## 后续存储修复候选

`impact-atomic-02` 5/5、typecheck-07 exit0；增加真实外层事务插入、修正read返回完整hash/初次重放规范化，尚未服务接线。real-007的19例绑定前一候选8f35330，不能冒称已覆盖这次存储修改；受影响真实回归等待重型slot，PRODUCT当前持有。独立审查仍绑定原冻结commit，未取得本次增量PASS。


## 独立外审返修中

8f35330实际独立结论REQUEST_CHANGES：1 BLOCKER/6 MAJOR/2 MINOR（含增补）；原始Orca回报与逐项矩阵已保存。当前已编码隔离token与私有record、末端新时钟、真实native/权利/consumer/ranges/上游对账、原FD跨rename跟踪、跨库poison、impact幂等冲突等修复。新增真实媒体边界用例尚未运行，因此不能写已闭环。

当前仅impact-atomic-04轻量两文件18例、typecheck-10通过。另发现旧accepted黄金向量只测hash未测validator，补上了真正接受断言并修复与原LockService一致的project scope空target。旧失败impact-atomic-03/typecheck-08保留。重型真实回归等待MEDIA与PRODUCT003之后的MAIN预约，不并发。
