# RD05 恢复调度组件候选

MAIN 在 `399f1e45d68041ddbb2af4e5c3df4d9ba24d713a` 上实现精确释放的两个新文件。此前独立设计审查 `ctx_a9a63ff7c930` 对 `23cf2d0` 的设计级 bounded ACCEPT 不代替本次代码外审。

实现只从原 RevisionStore 同一连接读取原 project_transaction。按 kind 与精确请求标记分类 created/history/adoption，以 `(created_at, transaction_id)` 稳定全序辅助各域识别老未决行。每轮调用全部域，sweep 只首轮；回调自报数字无效，仅真实 DB 转入 committed/aborted/attention 算进展。无进展退出，不使用固定 pass 数或 busy loop；识别集合增长/移除、身份变动、前态倒退和终态重开时拒绝。attention/recovering 仍列为未解决写阻塞，其他项目可单独决定。组件不取得运行根独占锁，不执行 generic、不接 Host、不签发发布或业务授权；调用者仍须满足既有生命周期与 authority 约束。

真实 SQLite 组件测试使用合成 family 回调执行合法 aborted/attention 转移，不能证明实际三个恢复模块或 Host.listen。96 项长链使用原 schema 的 in-memory SQLite，仅考察排序/进展，不声称落盘耐久；其他有状态用例使用临时目录中的真实原库。

## 原始记录

- scheduler-001：语法转换失败，0 个测试运行；已修复换行的类型断言，不归因环境。
- scheduler-002：22 PASS / 1 timeout，长链超时。
- scheduler-003：切换长链为 in-memory 后仍 22 PASS / 1 timeout，证明不能简单归因磁盘。本次保留该失败。
- 后续修正：scheduler 从 N+1 逐行查询改为同连接一次查询；合成回调单次取行并在真实转移后更新该次本地遍历，避免每个判定重新扫描 DB。未增加测试超时，未减小 96 项链或删除断言。
- scheduler-004：23/23 PASS，长链 318ms。
- scheduler-005-no-progress-control：仅将生产组件的真实进展计算替换为 0，测试字节不变，5 FAIL / 18 PASS；故意失败，非业务回归。
- scheduler-restoration.json：保存候选、负向控制、精确恢复 SHA256；完整候选备份 scheduler-candidate.ts.txt。
- scheduler-006-restored：23/23 PASS；typecheck-47：exit 0。两份完整输入快照均 source_changed/source_added 为空。当前候选代码仍待独立外审。

## 仍未实现 / 不得宣称

实际 family 回调尚未采用本组件，legacy/history 的老行与 sweep 接线、generic 排除仍待实施。created Publisher 三树与 snapshot 容器身份事实尚未与 prepared journal 原子接线；专项恢复、SIGKILL/重开、实际三域链、Host.listen/运行根独占、NativeAck/正式双导出均未因本组件完成。RCV-D10-01..10 全部仍 NOT_RUN，不声称 A 阶段通过或生产写入口就绪。

## 同期独立交付

- 文件身份组件 `399f1e4` 经 `ctx_863c417e7314` bounded ACCEPT（msg_d19936b61dd9）：无 B/M，仍限定资源事实组件；不证明 Publisher/进程恢复。
- PRODUCT 原生接线设计源提交 `0f527060d0ab002bb472cee2505b06dfb7386082`、文档 SHA256 `e89b095edc23ef41823c7e7e88ef72b7028783725fce09efa0953eb5eb828fe1` 已逐字节保全在 PRODUCT_NATIVE_COMPOSITION_PLAN.md，来源见 companion JSON。它是设计输入，不是源代码或运行验收通过。
