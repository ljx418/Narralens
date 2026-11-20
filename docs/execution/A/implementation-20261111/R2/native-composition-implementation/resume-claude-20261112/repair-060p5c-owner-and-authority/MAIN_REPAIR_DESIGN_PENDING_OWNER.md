# MAIN合并修复设计（待owner正式结论，不是实现release）

依据：startup msg_1af75e539d0e，输入61份由MAIN复核一致；owner ctx_3f1bdc35536b仍在审查。先整理共同根因和直接反例，owner交还后合并补全才发票。保留R5C八文件边界和保护七文件，不运行真实N、不修改实施源码，不把本文件当授权。

## 1. 异步作业等待与异常清理分离

normal启动是进入运行态，不是异常。取得startPromise后，正常分支等待同一原结果，不能因inspect尚未settled就请求取消；等待应能在cleanupRequired时对同handle恢复，不能只await一个无法自行收敛的held promise。异常/明确取消才进入cancel-needed；真正finally始终等待同一原startPromise和fresh终局。不要另建替代promise、再次spawn或用等待截止当资源结束。

fault分支先以有界轮询等待实际accepted N，再等待同draw/root/GO摘要，再同步fresh全epoch活态检查且与注入之间无await。启动/观察期限只界定是否能注入预期失败；期限失败仍走同owner正常清理，不取得fault-observed资格。不在第一次诊断worker=null时立即拒绝一个尚在启动的任务。

反例：开始时worker=null、start pending，后续按C_HELLO/FORKED/N_HELLO/GO/result真实顺序更新；normal必须零cancel并得到精确图；fault只在晚到GO/live后注入。优先实际supervisor加ChildProcess/proc边界mock组合；若采用adapter，必须显式模拟上述时间顺序和生产cancel状态，不使用start同步settled作为唯一正常证明。

## 2. 首失败/首次取消凭据不可变

requestCancel第一次被接受为primary后，保存原Error和primary provenance；同一或不同后续取消不改写它。早于取消的无关native/transport错误也不可覆盖。可记录有界secondary计数/摘要，但不能把重复同一取消伪装为“被更早错误取代”。signal请求发送也应幂等；finally不要无必要重复cancel。生产方法本身仍需重复调用测试，不能仅靠工具避免重复掩盖方法缺陷。

反例：真实supervisor同issued handle在尚未完成清理时调用两次同Error，再不同Error；primary cause/provenance保持，终局一次、cancel命令不重复；无关原生错误先发的对照仍primary=false。

## 3. 原C身份未绑定时允许真正gone证明

明确born child由真实ChildProcess PID+error/exit/close事实提供。未授权fork，初始/proc未知且无verifiedHELLO时：真实exit/close之后，对该已签发child PID执行fresh读取。gone可收敛原失败；unknown继续hold；known但无原epoch不可猜成replacement，继续hold。不能仅因epoch=null永不尝试fresh读取；已发送AUTHORIZE但无fork/domain证明仍hold。绑定epoch后same-Z不能当原epochgone。

反例：初始EIO→未HELLO/AUTHORIZE→exit+close→freshENOENT，原promise一次失败结算；freshknown/unbound与freshunknown两个负对照；已授权但无receipt不能因上述startup规则释放。

## 4. 撤销signal权限不撤销终局证据收集

把“永不再对原号码/组发信号”与“继续证明原域已结束”分别处理。reaped/ECHILD/replacement之后保持权限不可逆撤销，任何后续observe不得重绑原epoch、不得信号外来PID/组；仍可核原已记录wait、已知原target epoch、原group观察、ECHILD等。不得在actions.authority_lost分支直接永久跳过所有证据核查。保留原group证明义务，未知不得因current_group=0变成不存在；所有原义务真实gone后可结算失败。实际anchor字段按真实reap状态报告。

反例必须经过真实生产adapter和raw OS边界mock：TERM→waitpid消费N→group/ECHILD暂未知→拒绝欠KILL→后续原域所有条件gone；断言post-reap raw信号0、同责任最终收敛。另一分支持续unknown/live必须保持hold，不能为测试绿色清空未知标志。

## 5. 长期持责的事实库存有界

persistent EPERM/unknown不可消费未发动作债，不可重置grace或增加责任到期。限制signals与receipt可增长历史：保留首项/最近固定数量/固定上限计数或饱和计数，注明截断，不保留每轮字符串。预算失败资格与实际资源终局分离。不可只限制_events而让self.signals无界；原首错误不被重试输出覆盖。

反例：raw os.kill/killpg连续EPERM，多轮真实settlement/recovery，内存库存固定有界、投递状态仍未发、owner保留；后来权限/投递可达时仍收敛。不得在高层patch掉signal方法而不触达errno分类。

## 6. 原settlement与最终资格

读取原settlement全部cleanup错误，不能只在timeline记数量。normal和故意失败都要求资源终局、无不允许的cleanup/transport/evidence/report错误；故意失败另外要求原取消确被接受、原cause、picture=null、同epoch注入。保留有界可审计原settlement摘要、实际图片与参考分离、fresh观察、receipt事实与产物摘要。不把证据文件预写的候选绿灯当最终结论，报告完成后的最终退出码和原结果必须联合核对。

## 7. 复验顺序

owner交还→MAIN合并全部意见和旧项子关闭→发精确八路径/六类FIRSTrecorder票→关键新反例先红后修（记录实际旧码失败，不能伪造）→修复和受影响pure/type/integrity最终同源捕获→一次交还→聚焦修改及关联不变量的两独立复核。通过后才另发当前pin真实N正常/预期失败票。R6/R7/原17/ISO18/N1N2/NEXT全部保留，最终新冻结commit独立审查不可由这次安全门替代。新429立即停，无自动接手。
