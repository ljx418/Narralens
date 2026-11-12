# 恢复签发 RISSUE-M1 返修及自审

独立审查 msg_0b389d98e967 指出的 Major 经实际测试确认，不能由原47/47回归覆盖。原始旧实现与失败捕获保留。

## 实现

恢复资源类仅在真实构造时将对象登记到模块私有 WeakMap。登记内容为固定数据库实例与闭包，闭包直接调用 ECMAScript #private 方法。Publisher 的四处资源读取/同步调用均使用模块函数；删除 instanceof 信任与公开方法调用。伪造 prototype 不具备登记，覆盖实例同名方法不改变闭包，已释放 lease 仍由私有记录拒绝。配置复制后冻结且使用 #options，不再公开为普通属性。

同步闭包仍实际验证 live lease、original/target/snapshot/container 身份、当前 prepared/base、原工程 owner marker 和移动状态，并同步两个真实父目录。不能以改签发边界为由省略原有 producer/rights/native plan/闭包校验或 N3 清理。

## 直接复验

- real045-forgeable-issuer-old：同一组新增测试在原实现3失败/47过滤。三种情况分别为伪实例、覆盖真实实例方法、覆盖已释放实例方法；每种旧实现确实返回真实私有签发凭证，失败不是 fixture 设置异常。
- real046-private-issuer-fixed：7通过/43过滤，包含上述3种拒绝、真实同事务提交恰+1/重放、补 published journal 不产生新 snapshot/job、JSON lease/selection 拒绝、过期后完整源补偿再中止。
- recovery-files010-private-issuer：23项资源恢复 + 10项保留句柄 + 15项身份事实，合计48通过。
- type056-private-issuer：全项目 tsc exit0。

以上捕获均 source_changed=[]、source_added=[]；原始命令、日志、exit、输入摘要保留。real044全47通过属于前一候选的历史回归，不描述为本次50项全量通过。

## 自审与限界

检查了四个生产调用点均走私有登记、私有同步不再反调公开方法、close/release 仍撤销租约且 closed 会先拒绝、database 使用对象身份比较、配置冻结不改变原合法调用。反例同时断言未新增 published journal、transaction 保持 prepared、active revision/outbox/approval 未变。

这不是 sandbox 对同 UID 任意代码执行的隔离承诺，也不是原始数据库对象或 Node 内置函数遭全局恶意替换的防护。实际运行仍要求独占 runtime 和原项目队列。CreatedSourceRecovery 业务编排、Host/generic 接线、实际 SIGKILL、NativeAck/双正式导出/人验仍未实现或未证明。RCV-D10-01..10 不因这7例关闭；独立复审仍 REVIEW_PENDING。
