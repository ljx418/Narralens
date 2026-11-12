# MAIN D10 共因修复内部审查

状态：内部受影响验证通过，独立复审待完成；不能自签。

修复：两条 guard 清理出口以及构造失败、Publisher 与 lease 的失败统一进入项目 sticky 账本，保留多个错误；真实 abort/主错误不再被 finally 覆盖。整个启动扫描以一份受理 promise 被 close 等待，关闭拒绝新入口而不截断既有扫描。adoption 缺失仍先核对现存 prepared authorization；借原 immutable impact plan 与 surviving approval 匹配 hash/base/control/execution，损坏请求在 author proof 前持久 attention。

四视角自审：架构/合同未修改原状态机、DDL、九字段 commit/队列/Publisher/RecoveryFiles；实现逐个核对原早期 guard、构造、自有发布器和 lease 的清理出口，错误聚合与项目隔离；体验拒绝不确定操作、真实终态与错误不撒谎；验收保留旧源真实反例与新源对照、matching surviving authorization 正向对照、原文件与 authority witness。自身发现测试 TS2352 错误，类型声明已修复，原 exit2 保留，不计业务失败。独立审查尚未签署。

实际结果：旧实现三个纯 SQLite/FS/FD 生命周期回归均真实断言失败；真实 producer 下授权冲突原实现返回 aborted（预期 attention），失败日志原样保留。修复后完整 recovery 31/31、完整 tsc exit0、独立原始生命周期探针 exit0 且两个 defect=false。所有七组命令 actual exit 与日志 SHA 均核对，无捕获输入变化；full006 和 type007 的完整输入与当前字节逐项匹配。adoption 实现及其50项测试未改动，不因次数重复跑未受影响门。

证据：同目录 main-d10-* 七组共42文件与 MAIN_D10_REPAIR_VERIFICATION.json。失败与类型错误捕获不覆盖，原 D10 12组捕获和独立失败探针不覆盖。AGENTS 未提交用户/流程改动保持原字节，不纳入本提交。

边界：新增纯生命周期用例种入诊断权威，仅证明 SQLite/Coordinator/queue/FS/FD 生命周期。其余 real producer 用例不等于生产启动、真实 SIGKILL、真实合法后继、NativeAck、Studio 或 A 人验。下一步先新冻结独立复审，再实现原 Host 三族恢复与 generic 精确排除、运行根排它和真实崩溃矩阵；PRODUCT 接线另行逐项真实验证。
