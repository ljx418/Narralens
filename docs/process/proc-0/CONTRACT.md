# PROC-0 执行预约与交还门合同 v1

本包是流程工具工作包，简称PROC-0；不是PRD优先级P0或Gate V1-P0。用户新active goal明确恢复全A/N1N2主线，第一步先完成本工具门。原R6/R7/R8/17+ISO18/NEXT范围保持。本文先独立文档审查，未发实施release、未运行产品。

## 1. 当前事实与最小范围
W=../Narralens-agents/main-integration，branch agent-driven/main-a-integration，观察HEAD fae74ae6c4c6b24134eded8ebc05290c4a4e9985，clean；旧Claude ctx_17cf94883a53经worker-show为stopped/liveness exited。只读/proc扫描未发现本项目run-recorded进程，不将该扫描声称全机/历史进程绝对不存在。
原run-recorded.py SHA88cd47ec732a340f54cdd4bb05b05878887697eebb0ddc94b1ccd7d0e434fd10保持不变。tools/check-delivery-spec.py已存在，但仅metadata admission，当前PARTIAL packet拒绝是正确行为。旧python003挂起与MAIN精确终止/source_changed原件保留；当前helper已改用tempfile与两轮drain，仅静态看到，不把它当真实pipe/backpressure验收。

## 2. 实体与工具边界
新增tools/run-delivery.py，标准库实现薄执行包装；新增tests/process/test_delivery_admission.py和最小fixtures/admission_helper.py（工具自证，不是产品替身）。可按直接需要修tools/check-delivery-spec.py及补其direct tests；不改原recorder，不改src/、产品contracts、R6协议算法/fixture、包依赖或配置。工具状态和自证文件仅W/var/process-admission/；正式交还材料在本包指定OWN目录，原历史日志不动。源码分配仍唯一Claude，MAIN只写合同/验收包与实际验收，独立Codex审实现。

CLI最小命令：status、begin-write、end-write、run、request-cancel、rebind。所有写状态入口都校验release路径+MAIN期望SHA（--expected-release-sha256必需）、project root、owner task ID、格式/必需类型。source pin含原recorder、允许工具与全部实际recorded输入、保护项；真实源码路径逐项核对，不只对影子目录算SHA。
run只接受release的command_id枚举及唯一capture，不接受原始argv/--shell/任意cwd/未知flag。release中每条精确argv、runtime_class、expected exit、source inventory、recorder pin、capture prefix、state root都必需。命令值严查array of nonempty strings，不经shell拼接；原recorder通过绝对Python3.12 -I -S -B启动，cwd只能release绑定的W。禁止额外timeout包装；run同步等待原recorder结束，原日志.cmd/.inputs/.claim/.exit/.result由原recorder唯一生成。任何existing suffix即拒绝，不能覆盖或复用capture。
此工具是合作式命令/资源准入，不是对恶意同用户的安全边界；预期release SHA与文件owner约定由MAIN/工具权限共同维护。不能声称阻止所有原始Bash或OS级编辑。违规绕过仍须停工记录；不篡改CLI配置/凭据去强行实现权限限制。

## 2A. 输入绑定与原记录器相容
release分开 `recorded_source`（原recorder实际扫描的全部路径→SHA）、`protected_inputs`（例如AGENTS/计划/固定helper/二进制、完整路径→SHA）与 `commands`。不能把原recorder不扫描的AGENTS强塞进其.inputs后宣称相等。原recorder文件与.inputs都不可补写；额外pin的真实pre/post核对进wrapper自己的旁证。packet.source只包含实际recorded输入，protected单独核；source inventory不能仅列有利子集。

运行前/后完整发现原固定recorder范围内的实际文件集合，严格等于recorded_source路径集且逐SHA吻合；新加工具/测试文件也须显式重绑，不沿用旧651数量。原始.cmd/.claim/.inputs/.exit/.result/.txt任何缺失都不补造。Bootstrap grants与将来的真正run grants分别产生；RELEASE_SHAPE.json只是字段样例，无任何执行许可。

## 3. 预约与生命周期
project root只有一个持久state目录（真实路径、不能由CLI任意覆盖），O_EXCL/mkdir或经过实测的本机跨进程原子机制获取短事务锁。并发只允许一个修改事务；锁失败不能退回无锁写，也不删除不认识的锁。状态写入临时同目录unique文件→真实flush/close→atomic replace，追加有界单条journal/event记录保留历史；不覆盖旧run结果。
区分两个维度：phase=IDLE/WRITING/STARTING/RUNNING/TERMINAL/UNKNOWN；admission=READY/BLOCKED。运行exit非0是结果不是资源仍活；源码漂移/证据坏是admission BLOCKED，不可伪装进程仍活或自动通过。unknown进程则phase UNKNOWN且BLOCKED，无新验证/写入许可。

|入口|准入与单调事实|输出/禁止|
|begin-write|仅无活动/unknown验证及无别人write lease；锁内记录task、随机nonce、generation、原release pin|WRITING逻辑许可；明确不代表OS强制写保护，也不能用逻辑lease当实际Agent存活证据|
|end-write|原owner/nonce/generation完全一致，重新核输入并记录实际变更|解除逻辑写许可；因改源旧runtime pin失效，MAIN更新release再run，不能工具自行批准新source|
|run|无写lease/活动或unknown运行；原release+source+命令+capture全部校验后，在Popen前持久STARTING与wrapper完整epoch|只有一个command；失去短锁不允许执行；Popen成功后立刻保存recorder真实pid/start_ticks/ppid/pgid/sid与boot身份|
|status|只读实际/proc与保存的原epoch，不读取env或配置|文件state或PID存在都不是存活充分证据；PID reuse/Z/读不明如实报告，不能仅凭时间清锁|
|request-cancel|同一run_id/owner且实际未终局|只记录CANCEL_REQUESTED事实，不发产品信号、不杀recorder/组、仍阻止下一次run；请求不等于取消完成|
|终局|对同一Popen实际wait，核原capture exit/result/log/inputs，保存已观察自有后代及原组实际状态|已观察资源若仍live/Z/unknown则UNKNOWN持责；已结束但坏证据为TERMINAL/BLOCKED；干净可回IDLE/READY（只允许同release源与下一唯一capture）|
|rebind|必须有显式新MAIN release SHA、无活动/unknown资源及无别人write lease；核旧证据保全|可解除纯metadata阻塞或更新改源后pin，保留旧记录。不能据旧PID缺失/过时锁就清unknown；未知清理需MAIN提交实际终局事实并另裁决，不实现自动资源回收|

wrapper身份完整tuple加boot_id（仅读/proc/sys/kernel/random/boot_id）；record PID和known descendant epoch只来自实际该次Popen链，不从外部任意PID输入取得信号权限。可为原recorder建立独立session/group并作只读signal0探测；不能向组发TERM/KILL。本票不新增通用kill/reaper/强制unlock/责任超时。原recorder和测试命令仍可能派生工具子进程；采样的known descendants必须明确不是完整历史fork transcript，不能用它签R6/D2。
wrapper异常或死亡：STARTING已持久但recorder身份未存为UNKNOWN，禁止自动重跑；RUNNING而wrapper已死也不得自动释放，因recorder/后代可能还活。Popen失败需要确切无child事实，已返回child后的metadata写失败仍保原child责任，不抛出后丢手柄。真实运行中异常优先记录，再保同一wait责任，不重新启动原命令。
测试命令正常退出但有known child未清理，不可先解除slot再补清理。无可靠完整进程树隔离保证，工具只能核自己实际观察到的epoch和原owned group，报告观察局限，不能把工具层可调度当产品资源证明。

## 4. 交还metadata门补强
权威release清单与packet required cases/source/contract逐项相等。只接受自己真实存在的capture全套、cmd/cwd符合该release允许命令、current source与capture输入一致、log bytes/hash、exit/result一致且无source drift。0为METADATA_READY_FOR_REVIEW，2为拒绝；均不是业务PASS。明确expected nonzero还需case实际资格证明及source绑定，不能仅self-report case_passed就覆盖原业务验收。工具不验证全部测试语义，MAIN/独立复核仍判断direct可达性。
不要将历史已passed但受改源影响的capture作为current evidence，不删除required IDs。对当前R6的packet只能保持PARTIAL/NEEDS_REVALIDATION；不得在PROC0把它调绿。

## 5. 自验证与运行许可分层
首阶段只准类型/语法与工具direct tests：mock实际Popen/持久状态/文件系统/identity接口，但断言调用真实runner入口，不能另写predicate；持续deny未声明的os.kill/killpg/fork/waitpid/prctl/产品spawn。工具的Popen边界测试用mock，不能偷跑R6 suites或实际C/N。
独立源码审查后，MAIN另发精确自证票：只允许该工具自己的有限Python helper（pass/fail/owned-file barrier），正常返回与双客户争抢验证；临时根属于var/process-admission/selftest唯一root，helper不fork、无网络/声音/Host/模型。故障/超时只让helper真实退出失败，绝不拿计时器当进程消失；由原owner实际wait。取消/丢wrapper对照可先mock；如需实际wrapper死亡注入，另具名精确PID/epoch票，当前未释放。不得为metadata工具重建另一套C/subreaper架构。
真实R6 C/N命令直到独立安全审+新pin+专用release仍禁止。整个PROC0通过也不签R6/N1N2/V1；原R6剩余内容必须继续。
