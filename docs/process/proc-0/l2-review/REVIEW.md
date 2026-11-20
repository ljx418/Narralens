# PROC-0 独立 L2 审查

**REQUEST_CHANGES**。候选为 `agent-driven/main-a-integration@9c2f6237f997c27e3f2d013fec48107a56f862ba`。当前不具备另发有限工具实跑票的条件。最直接的阻断是已返回的 recorder 可能失去原 owner 的 wait、身份未证实也能得到 CLEAN，以及同一项目能用第二个状态目录绕过未知资源。FINDINGS.json 逐项给出行号、触发、合同与 direct 验收建议。

## 原始记录与同源性

W 开始时在目标分支，跟踪工作区清洁，领先远端一个提交。B 起始 HEAD 为 `422a2b23fda2bc5e92373280cd4c147abec9ecc8`，有既有流程和审查草稿。审查期间只读取源码、证据、Git 对象与公开工作流说明。未调用受审 CLI、测试、helper、服务或进程实验。

| 捕获 | 原始结果 | 可支持的结论 |
|---|---|---|
| 001 B1 | inner/outer 1/1，凭据 assertion 为 None | 保留首次失败及对应源码 |
| 002 B1/B2/B3 | 0/0、0/0、1/1；B3 为 str.read_text 的 AttributeError | 夹具异常已留档，未计为业务反例 |
| 003 B1/B2/B3 | 全部 0/0；实际日志 25、24 项与 28 个具名自检分支 | L1 direct/mock 和合成元数据 |
| 004 B3 | 0/0，原日志 CODE_CANDIDATE_FOR_REVIEW | 003 交还包 16 项的 L1 元数据准入 |

从实际 004 的 inputs 路径集合出发，逐路径解析冻结提交的 Git blob 并计算 SHA-256，全部 656 项与记录值一致；003 三份 inputs 与之相同。观察该集合的大小，没有用固定数量替代逐路径对比。录制时 .cmd.json 的真实 HEAD 是 `9bde8c4584e3d13bcad474564caccfcbce2ced6f`，五个工具/测试文件当时尚未按当前候选提交。INPUTS.json 将不可变 blob 的字节核对与重点源码的语义阅读区分记录。

核对了八次捕获各六件原件、阶段票、owner claim、归档和 var 旁证。003/004 的 source/protected pre/post、实际原件摘要、inner/outer、原组采样与对应记录一致。canonical observer、W 副本的 Git blob 与外部保护 pin 同字节。原 recorder 独占创建 claim，直接执行 inner argv 并写入其退出码；observer 固定 Python 启动同一 recorder，获取 epoch 后由原 Popen wait，再做组采样。此次正常记录支持当时的组观察，不能还原全部 fork 历史。observer 的票面检查依赖 Python assert；本结论限于原单票与既存字节，不将其作为通用 runtime owner。

## 源码与证据的对应

- **架构与操作**。外部 release 路径、SHA 与 command_id 控制选择；固定 outer Python 的 argv 和获准 inner argv 独立构造，corepack 承载有 direct mock。仓内单槽是合作式协议，原始 Bash 和 OS 写入权限不受它强制隔离。
- **并发与资源**。正常路径先提交 STARTING，释放短锁再 Popen/wait；取消路径锁内重读并单调记录请求，正常终局合并 sticky 值。等待时间和 late cancel 均不足以证明回收。FINDINGS 列出了这些正常路径之外的真实反例。
- **交还与指定失败**。packet 逐项对应原 16 个 case，003 有共享 suite 及多 slot。静态样例要求 PROC0-13 的 direct、实际成功和指定失败三份证据；额外预留无需产物。handoff 的 run_chain 确实调用生产 command_run 并把写出的旁证交给生产 checker，但它使用 BOOTSTRAP_CODE、fake Popen、合成六件套和 mock 组观察。原 observer→checker 已有 004 真实元数据链。内层 -15 / 外层 241 仅验证编码；recorder 自身为负的 outer 或缺件不能推断 inner。
- **测试力度**。直接测试覆盖实际入口；取消测试用 Event 控制、finally 放行并有界 join。自检在每个变体前后恢复正控，但多数只要求出现任一 problem，不能证明命中指定拒绝理由。已核原 001/002 的具体失败。修订验收应对准 FINDINGS 给出的成因与持久状态，不能用更多绿色分支替代。

## 裁决与交还

三项 BLOCKER、四项 MAJOR 和两项 MINOR 已按共同根因合并。优先修复原 child 责任、epoch 和项目状态权威，再闭合产物位置、slot/退出事实、预约竞争及落盘反馈。两项 MINOR 可通过精确票及受限输入单独处置。由原实施角色按新票修订和保留失败证据，独立审查绑定修订后的真实字节。L3 的真实双客户、在途取消、pass0 与指定 fail1 均为 NOT_RUN。PROC-0、R6、N1N2 与 V1 继续维持各自原门状态。

| 项 | 级别 | 需修订的事实 |
|---|---|---|
| L2-01 | BLOCKER | 返回 child 后仍有路径跳过原 owner 的 wait |
| L2-02 | BLOCKER | 未取得完整 epoch 也可被持久化为 CLEAN/READY |
| L2-03 | BLOCKER | 同一项目可形成两个准入权威，旧票也能跳过换绑 |
| L2-04 | MAJOR | checker 在核准产物位置前读取 packet 路径 |
| L2-05 | MAJOR | slot 身份及原件与旁证的退出事实未闭合 |
| L2-06 | MAJOR | 核验与预约之间有竞争窗口 |
| L2-07 | MAJOR | 审计失败或旁证未落盘仍可显示成功 |
| L2-08 | MINOR | 有限 barrier 的路径与时长约束依赖发票人 |
| L2-09 | MINOR | 真实保护项路径与 direct fixture 形状不同 |
