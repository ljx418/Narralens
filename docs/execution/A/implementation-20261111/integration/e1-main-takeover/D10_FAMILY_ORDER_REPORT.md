# 实际 legacy/history 恢复排序接线候选

基线10ebadd。两个既有实际 recovery 入口使用共同 `(created_at, transaction_id)` 排序，history 旧小于等于时间比较换为全序，legacy adoption 在验证/决定自己请求前检查老的 created/history/adoption 行。实际 controlledRecovery 忽略集合按原库真实 kind+marker 纳入三个域；未知 legacy 仍阻塞。legacy orphan sweep 新可选 false，仅首轮调用默认行为不变，返回旧报告形状不变。

不改 author publication、已有事务状态、审批/许可/锁/队列、合同/DDL、原 corrupt-JSON attention/error-code 行为；原 claimsControlledWrite 双格式导出保留兼容，但两个实际 pending 集合不再依赖它冒称覆盖 created。Host 旧固定 pass 仍未替换，generic/created recovery 未接线，不是生产完整恢复交付。

## 已执行

- families-001：实际 family 类/原 SQLite/真实 Coordinator18 + scheduler23 =41PASS。
- families-002：新增实际同一项目队列/真实 pre-publication abort+idempotency/未知行阻塞四例，22+23=45PASS。
- families-003-old：仅还原两个生产文件到10ebadd，新增测试字节不变，11FAIL/11PASS，证明排序/created pending/sweep规则失效会被发现。
- family-order-restoration.json 与两个 .ts.txt 备份记录精确候选/旧源/恢复 SHA256。
- families-004-restored：45PASS；typecheck49exit0；所有输入 source_changed/source_added 空。

实际 family 分支测试使用非法最小请求作为“有没有在错误顺序验证”的哨兵；不是业务授权或有效发表。另两例合法请求以 received 阶段进入原未发表 abort，证明真正经过队列/真实DB转移/唯一幂等表，并保留 younger created 阻塞。没有真实视频、Host.listen、三个实际 domain 或 SIGKILL，因此 RCV-D10-08/10 仍 NOT_RUN。

## 原有路径风险观察（不得漏报）

零revision/没有active snapshot的 received 哨兵虽能验证队列分支，原 abort response 取 source_digest_before，此时可为空；本次只断言持久status/revision/幂等绑定，没有对该类合成响应声明完整 wire schema 合格。RevisionStore 的既有 abortAdoption/abortHistoryRestore 在未获得 source before 的早期前态可能存在同类合同缺口。本组件不猜造 source hash、不重写旧核心。后续实际 Host/SIGKILL 集成必须用已验证源项目重跑 receipt schema，并处理无可证基线时的诚实失败；这不能被本次45通过掩盖。received/source未知业务边界未验，不能据此声明 V1-Full 或所有旧错误回复均合格。

## 仍需验证

原 M4B/M4C 真实重启、同域多行、corrupt request 与 orphan sweep 场景将另行独占运行；新核心 created recovery、generic保留、Host调度仍待实现。此候选只有内部模块证据，未自签外审、未声明任何 A/RCV/Gate完成。
