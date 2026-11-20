# R5C：合并S01..06/O01..06，精确修复启动与N正向owner

原Claude唯一实施，新429立即停，不重试/换provider/Codex接手。读本RELEASE、MAIN_COMBINED_ADJUDICATION及R5B两审完整REVIEW/FINDINGS。C=/mnt/c/workspace/videoworkline/Narralens/docs/execution/A/implementation-20261111/R2/native-composition-implementation/resume-claude-20261112；W=/mnt/c/workspace/videoworkline/Narralens-agents/main-integration。MAIN核startup65/owner144输入一致，两审REQUEST_CHANGES。指定census/动作债已有改善，但C05仍因不可逆signal authority缺口未关闭；这不是需要用户裁决的冲突。

仅JSON8既有路径，7保护hash不动、无新源/config/依赖/路由/EnginePort/事务，OWN新增n1n2-claude-060p5c-report.md明确授权。原R5A非破坏state/真实fd、R4B安全报告边界和R3A无限持责不得回退。R6/R7及原17/ISO18保持OPEN。完整读票，别只改注释/纯helper让生产调用继续走旧路。

## 1. S01：信号权限是不可逆的原fork authority，不是可刷新号码

C记录forked worker_pid与自身独占wait authority；一旦读到原N epoch，pid/startticks/parent/session/group绑定不可被后续census、_settle_domain或_finish_exec覆盖成同号码新进程。snapshot的current observation另存，不让它改原authority。

真实KernelSettlementOperations.signal_pid/group在**raw os.kill/killpg之前**核：原直属child尚未reap/失waitauthority；任何anchor_reaped或waitid=ECHILD永久撤销该N号码的信号权限；原epoch已绑定时fresh必须匹配，UNKNOWN不猜；group还需原N独立SID/PGID与fresh全epoch同一、与C/Host分离。_signal不能当freshgroup=0又fallback缓存旧group。初始epoch尚不可读时只可用真实尚未reap直属forkchild authority作精确PID bootstrap，不碰未验证组；waitauthority不明则held，无裸数字fallback。

在N已reap后ECHILD/group探测unknown→恢复→PID复用的反例，绝不重绑、不kill替代PID/group、不把外来epoch纳入原target；有欠KILL也不能重获权限。实际成功发出的TERM/KILL才消费action债；拒绝/未知/EPERM记录有界事实并held/等待fresh，不假装已经发成功或无界刷信号。已发不重复，deadline不重置，不设弃责期限。

测试必须进入actual _settle_domain→KernelSettlementOperations→raw kill/killpg mocks，覆盖Nreap后探测EIO+替代epoch、原epoch未reap时freshgroupunknown、初始unknown后来恢复合法原组欠KILL一次；在raw dispatch断言外来PID/group零调用。保原Nlast、收养/真实ECHILD流程，不把权限制约修成普通TERM-ignore永久held。

## 2. S02/S05/O05：晚到noAuthorize/noBirth终局仍可由原handle恢复

reconcile不能一见worker/forkedPid都null就拒；若真实未AUTHORIZE（或严格no-birth），使用与run相同fresh终局函数等真实error/exit/close和原Cgone，保原失败后完成原promise。已AUTHORIZE但fork/receipt缺失是另一支，继续UNKNOWN，不能因无HELLO推无N。可由受验证C的明确nofork/终局记录证明的失败分支须明确shape与binding，不能加caller布尔自证。

fresh C观察为UNKNOWN必须不通过；缺初始epoch而freshknown不能猜是replacement；只有freshgone或与记录原epoch明确不同且原child已exit/close才证明原C ended。no-PID+error+close不要求不可能的exit，但error不等close。original Error/errno与cleanup保持，不能恢复成picture。

在actual supervisor start/reconcile局部ChildProcess/proc/clock mock：首窗口没close先held，之后noAuthorize的C exit/close/freshgone→原handle返回原失败；async noPID error后close晚到同样恢复；UNKNOWN或无初始epochfreshknown保持held；AUTHORIZE已发无forkproof继续held。不要只测试validator或仍会拒绝的reconcile。

## 3. S03/O01：一个canonical terminal continuation，放在真正finally

将entry在任何资源创建前以partial形态建立（root/supervisor/handle/startPromise均nullable）；实际mkdtemp是单个allocate操作，**立刻**把root写entry/registry，再prepare子目录/hash/copy等可能失败步骤；copy之后再hash副本。constructor/reserve/start逐个同步纳entry，所有都在同一try/finally内，不能start完再登记。

结构必须实际等价：
- try：prepare→construct/register→reserve/register→start/register→mode观测；
- catch：保存第一原失败，不覆盖已有first；
- finally：若有issued handle且尚未证终局，请同handle ownedcancel；**无条件await同一原startPromise的真实settlement与fresh终局 continuation**，held也继续同owner inspect/reconcile，绝不只inspect一次/只写JSON就return；
- 实际终局后读取**原startPromise的结果**，拿回picture、原error与cleanup；不能held恢复后仅看inspection.settled而丢原result。没有handle时明确未启动，保root错误，无phantomchild。

helper事件文件partial append仅消费完整行；真正EIO/无效完整行仍是失败，进同finally继续raw终局。evidence/report错误也不能脱离此continuation。UNKNOWN保原C/supervisor/handle/root/原promise，bounded非busyloop，无有限责任期；绝不杀C/组。工具返回或main exit之前必须完整终局或仍活着持责，不靠Map保引用代替运行中的结算。

## 4. S04/O04：必须真的复用受审R4B报告边界

删除/停用normal工具里没有接线的同名仿制factory。动态import固定本地tools/native-cache-nofork-pilot.mjs中的**实际export createReportingBoundary**，明确typed边界，不ts-ignore/任意路径。入口main在任何资源创建前调用同一个factory({stream:deps.reportStream,write:deps.writeStderr})，真实deps.reportStream=process.stderr，write为(text,callback)=>process.stderr.write(text,callback)。main与runPositivePilot传**同一boundary实例**，所有报告都走report，绝无直接deps.writeStderr/裸process.stderr.write旁路。

不复用nofork signal/cleanup；只报告factory。监听真实error/callback、去重、有界、失败后不反复写、pending callbacks纳最终资格，原owner终局前不卸。延迟EPIPE时main仍持同活owner，之后清理完成才失败；当时的绿candidate不是权威。实际main+真实同形Writablecounterfactual覆盖，不能只push字符串数组或null stream+onearg writer自称已接入。

## 5. S06/O02/O03：精确cancel原因与同epoch live注入

生产requestCancel在可接受为first失败时保传入**原Error对象**（facts.error或明确cause），并保有界cancel provenance；已有更早native/transport failure不覆盖，readonly诊断须能分清本次cancel是否成为原primary。issued/foreign/idempotent/预start no-spawn语义保留。

工具将intentional injection单列；故障case只能精确EXPECTED_ASSERTION_FAILURE被此handle接受为原cancel、最终真实settlement对应同cause（不能任意非nullerror），picture===null且picture_is_the_exact_one=false，no unrelated native/transport/cleanup/report/evidence failure，全fresh终局，才expected exit1 pass。若已有别的latched error或晚到成功picture，都不是预期通过。first错误不被catch或后续timeout覆盖。

诊断可增加readonly draw_id/ticket_digest（摘要不是rawticket）、accepted cancel provenance。GO文件事件须来自该root副本、pid==已接受worker.pid、ticket_digest==此draw摘要；helper未存startticks，所以**最后同步注入前fresh内核**须匹配snapshot原worker pid/startticks/ppid/pgid/sid、真实非Z/非dead状态。unknown、Z、错误epoch/GO pid/digest、早期失败禁止注入，作为失败完整清理。fresh核对→requestCancel中间无await。保kernel状态字段，known本身不是live。StubSupervisor必须模拟真实生产cancel/异步settlement；另加actualsupervisor requestCancel最终error===原Error或确切cause测试，不让全stub掩盖契约差异。

## 6. O06与证据（不由legacy额外阻拦standalone，但本票修掉降级）

legacy2cases仍委托安全runner，不自行spawn/kill、不得5秒race当结束，不Host组数旁证。expected C pin从明确审查用常量/固定fixture合同取，不在wrapper把当前文件hash拿来自签；本轮源生成后可在该已授权test文件显式更新常量，留diff说明，不影响工具CLI实际MAIN另票pin。不用runmixedfile，本票只typecheck其接线。

actual工具末尾保存真实rawsettlement、fresh C/N/group/known-epoch观察+时间序、readonly receipt summary/段摘要、mode资格、actualimage长度与SHA、实际文件SHA清单。expected image1024参考与actual image严格分列，故障无图，不summary伪造actual1024。无rawsegments就如实限，不冒充完整转录。所有证据写失败影响pass；终端后才最后qualification，epoch状态不能硬编码。

## 7. 必测反例与运行

existing identity/Python纯test和normal-pilot纯test内补：raw signal adapter Nreap后PID复用无信号；late noBirth/noAuthorize close真reconcile；Cfreshunknown不放；partialroot/constructor/reserve/start/事件EIO抛错后main仍pending直到同原settlement+freshproof；late settled原result真的读取；实际Writable延迟EPIPE不丢owner；真实生产原cancel vs先前unrelatedfailure；N为Z/错startticks/错GOpid/digest拒注入；预期fault不能接受其它error/cleanup/lateimage。原case不删，纯mock guard在effect前throw。

只准JSON六形式，firsttrial全recorder fresh n1n2-claude-060p5c-*，包括所有红和首次generation，运行时源冻结；不recorder外确认、不改concurrency/预算/timeout。无真实C/N/fork/prctl/wait/signal/CLI/Host/media/Chrome/Q2/legacy mixedfile/fullcheck/build。原recorder不改，generation仅JSON。无Gitadd/commit/reset/stash/push、网络/付费/J盘/用户env或配置凭据读取。

OWN新n1n2-claude-060p5c-report.md明确授权，逐S/O映射actualcallsite/mockcapture/NOT_RUN，8源hash/7保护一致、所有失败与INCOMPLETE不造exitcode、最终原结果/报告资格/owner契约及下一exactCLI。不要再泛称“全部旧25不变”，以本轮保护7与授权8为准。所有旧报告/交还拒收历史保留。使用**本轮Orca注入的新task/dispatch**交worker_done，切勿复用R5A/R5B历史ID。交还后MAIN两安全门，才另票真实N；R6/R7/原17/ISO18/N1N2/NEXT仍完整未接受。
