# R3 + R3A 独立 integration 静态复验

结论：**REQUEST_CHANGES**。发现 5 条 MAJOR；本报告仅审当前绑定 dirty 字节，未参与实现，不签 runtime、P2、N1N2 或阶段验收。

绑定：`repair-060p1r3a/independent-review/INPUT_SNAPSHOT.json` 的25份实际输入起止一致；历史 HEAD `1d348d419120f23f45d958112ea8c43df5a04675` 不是已接受修复冻结。完整输入 SHA256、辅助只读 retained closure/合同/证据元数据和终核结果见 INPUTS.json。全部 reviewer 业务 runtime **NOT_RUN**；只执行读取、rg、stdlib哈希和文档输出及Orca交还命令，无目标 C/N 或测试运行。

## 实质残留

1. **R3-I01（原 R2-I01）**：workspace 821–823 打开的 parent/tree lease 在普通 preexisting/stale 拒绝时没有 NOT_OWNED 使用；生产源码没有任何 `notOwned()` 调用。原生失败时 bridge 已真实 drain 却在 upstream1782直接 throw，workspace989 的 drawn 仍为 null，parent lease 永久缺凭证。helper手动settle的16条门不能证明真实produce路径。
2. **R3-I02（原 R2-I01）**：成功后 tree release 失败走 workspace1110–1117 的 throw，绕过1107 hold。原 work结束后从 #operations移除，close/dispose能越过未确认的closure责任；只把scheduler标held不足。
3. **R3-I03（新）**：workspace548–566 重调 retained closure.release，把无异常返回当 fresh proof。但真实 closure1321先置released，失败sticky uncertain；1359第二次调用是幂等no-op。reconcile还忽略finalize=false，并硬报parent_drained/settled。不得通过重试数字FD“修复”。
4. **R3-I04（原 R2-I02）**：upstream1722只有一次插入map；direct factory647跨await后才在672reserve，插入时handle=null。ambient workspace可同步reserve的一支改善，不代表direct bridge具备可达恢复。
5. **R3-I05（原 R2-I04/shared C11）**：首个nofork case的endChild139–161仍按race到期返回；close Promise<void>与true比较不成立；finally255无条件settled。positive case也只有root/boolean，无全局owner登记supervisor/handle或恢复接续，早期建根/expect/reserve未全部被finally覆盖。

每条精确触发、合同、最小改法、真实分支mock和未来决定性runtime见 FINDINGS.json。反例均为静态调用路径推导，**不是捕获的旧代码失败**，也没有把Host-private恢复面说成公共HTTP权限漏洞。

## 已改进的分支与测试真实性

R2-I03、I05、I06、I07及R3-MAIN-01可标 **CLOSED_STATIC**，限逐分支源码复核。生产EOF入口确实调用失败锁存；拒绝进入refused并有界剪枝；supervisor恢复后调用私有run目录释放；R3A实际恢复循环不再因60秒、控制EOF或selector OSError放弃责任。未发现需要新增责任硬期限的理由，保留无限持责和有界动作/轮询区分。

Python新三例确实进入真实 `Custodian._recover → _wait_for_recovery → _settle_domain → KernelSettlementOperations`，在proc/wait/clock/selector边界mock，优于仅FakeSettlementOperations；但38/38不等于真实fork/wait/FD/收养。TS新的NOT_OWNED用例在测试里手动调用lease，不经过workspace普通拒绝；消息解释/receipt/deadline纯函数门不能独自证明整个spawn事件链。40次真实factory缺根拒绝确实覆盖refused剪枝；它包含上游只读git工具调用，不称零进程或真实C/N内核实证。

实际 `OpenFilmDrawResult` 生产调用仍为 workspace981，测试消费者为 native-cache-witness226；读picture的类型迁移存在，但错误分支没有相同阶段凭证。原source流ledger的error/close区分、destroy异常保留、freeze/drain以及默认上游probe所有权未因R3A改动；未据静态代码签Q2实际事件语义。原17、ISO-01..18、Chrome、全量门、A057-04、NEXT均不因本次修复签接受。

## 分开的首次pilot建议

**现成的精确 nofork case尚不能给 STATIC_SAFE_FOR_EXACT_NOFORK_IDENTITY**，直接阻碍是R3-I05的child close/error账本；修它不需要先运行N/Chrome，也不需要新增60秒责任到期。该case正常与断言失败都须凭同一个真实C的close/reap结束，未知时保留实际owner。它不拥有N，因此不能以nofork通过关闭树/parent生产问题。

**最小positive N helper尚不能给STATIC_SAFE_FOR_MINIMAL_POSITIVE**：先完整登记root/supervisor/reserved handle并覆盖所有失败finally，提供未知时可恢复的原owner。只跑单case/单slot/独占runtime root，先C身份再一次normal receipt、真实C close、目标fresh gone、digest/段序/原outcome；不混跑整lifecycle文件或TERM-ignore/adoption/flood。生产workspace与direct bridge还需R3-I01..04；成功pilot也不替代这些代码责任或全门。所有运行仍需MAIN另票精确argv、资源、停止与恢复owner，本报告不授权。

## 捕获与保全

R3 snapshot与当前25份逐项比较，恰好3份源/测试字节变化：custodian.py、helpers/cache-custodian-unit.py、integrity.json；其余19份source/test及R3两份报告一致。R3报告内被REJECTED的60s文字历史保留，R3A明确更正，不当当前合同。

核对R3十二份捕获result/log哈希：十一命令及generate均exit0；该事实不消除evidence-gap自认的整段未经recorder开发试跑（约10次失败：4 tsc、2 identity、4 Python单元；原argv/时刻/inputs无法补造）。旧P1/P1R四次UNRECORDED、R2三份已记录失败及一次未记录node--check继续保留原分类；未制造缺失日志。

R3A四份捕获已核实际cmd/result/log：unit-001 exit1（fake selector事件形状错误）；unit-002 exit0，日志38 tests/OK；generate与integrity各exit0，生成delta仅integrity JSON。unit-002 log SHA256 `4d875fedc582561cde1f243eafa5d4e02956cf374028ab9ddd019828c4c590fd`，unit-001 `5cd6100cf21b43e1134c7c241ff453df5a962823630958310f361a3e36d52fbc`。这只确认所存捕获，不把“首次mutation”时间线从delta反推为已证明。旧证据和报告未改写。

结束时所有登记输入重新hash一致；只新增本目录三份审查文档。
