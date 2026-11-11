# D10 文件身份组件候选

仅组件内部证据；独立代码复核 PENDING，全部 RCV-D10 仍 NOT_RUN。未接入 Publisher/journal、恢复调度或 Host 写路由。

## 实现及范围

RetainedSourceTree 增只读 identity()/directoryIdentity()：实际 held FD 取 dev/ino 十进制字符串、完整根内目录/文件相对集合、bytes/hash；前后复验，返回冻结数据。重命名不把父目录名称当原树身份；snapshot 容器只能读已持有父目录 FD，不重新按名字授信。原 verify/release/rename 行为未放宽。

CreatedPublicationIdentityStore 为原 SQLite 新 immutable 附属事实，无 state/ready/Approval/FD，必须加入 caller 原事务，只允许精确 created apply 的 prepared 父事务首次记录；现有事实逐字段/摘要一致才重放。三棵树和 snapshot 容器身份分别绑定，target/snapshot 内容闭包必须一致。read 校验 canonical/hash/schema/version；assertCurrent 从真实 guard 观察比较，不创建 publication/commit proof。未来 Publisher 仍须自己重验所有业务权威，才能私有签发 proof。

## 验证

- identity001：22/22 PASS（store15、guard7），真实本地文件与 SQLite，非 Host/视频业务验收。
- identity002：只删 persisted-vs-current equality，测试不改；实际5FAIL17PASS，五种同字节 file/tree/container 替换均抓到旁路。当前源按备份 SHA 精确恢复。
- identity003：恢复后22/22PASS，all inputs stable。typecheck46最终源 exit0。原 typecheck43/44/45 失败保留，分别为 parent TS narrowing、测试括号和必填 correlation_id 错误，未归咎环境。
- 明确 identity JSON 不是 isCreatedSourcePublicationProof，记录不产生 snapshot/active_commit。atomic rollback、immutable trigger、原库重开、冲突重放、缺失 schema protection、checksum-valid未知 JSON版本、额外fd字段均有实际断言。

## 设计模型与证据工具（各自独立，不算业务门）

recovery-model001 用明确旧 A1-C2-H3 反例和9,837配置证明设计模型终止，96项交错链33个进展轮收敛；伪 recovered 计数不构成进展。没有执行真实三个恢复模块/Host，不能闭合 RCV08/10。

证据工具 v3 为新捕获增加原子 claim+已存在文件拒绝，并传播真实子命令 exit。self-check 的预期 exit7被真实传播、同名重跑被拒且所有原产物摘要不变。旧v2原始记录不改，原v2外层0不证明子命令成功，必须读 .exit/.result；v3工具测试也不冒充业务测试。

## 下一步

RD05 完整调度设计复核与本组件独立复核后，接入原 Publisher prepared journal 同事务，并实现原授权可证时完成、失效时完整树补偿、未知时原 attention、真实进程 SIGKILL 再恢复及通用恢复排除。尚未完成上述内容或 native selection/Context/NativeAck/正式渲染/中文人验影片/A组合出门，不进入B。
