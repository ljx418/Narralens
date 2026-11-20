# 每draw独占进程：A057-04可实施性补充

结论：**可作为优先修复路线，需MAIN小范围ADR和精确release；不是现成helper直接拼接即可通过。** 保持 `OpenFilmCacheProducerOwner.pageFrame/close` 和issued WeakSet品牌不变；内部每draw独占Node worker、POSIX session/process group，直接import经hash验证的固定pageframes原字节。结果仅是candidate，直到worker真正退出、整组及已知后代身份均消失、父serving/probe排空才交付。正常和超时均有“关闭出生→有界温和关闭→精确组TERM/KILL→真实核实”路径，不用永久abandon收口；只有真实权限/内核/归属异常留UNSETTLED责任。

架构基线一律取 `git show 1d348d419120f23f45d958112ea8c43df5a04675:<path>`；即使059并发修改W，也不把当前working bytes纳入结论。固定上游仍 `e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3`。本次未运行任何probe/test/build/Host/browser/media/import，所有新runtime为NOT_RUN，未改W/V/renderer/锁/合同/Approved015，未授权Claude或新worker。

## 现有代码可以复用到哪里

- `native-renderer.ts:112` workerEnvironment只复制allowlist，排除NODE_OPTIONS等注入；可直接调用，另赋本draw私有OPENFILM_HOME/NO_UPDATE_CHECK/TMPDIR，不重设HOME或读取用户配置。这是运行时允许的实现行为，本次没有读取当前env。
- `:132` groupExistsOfProcess用kill(-pid,0)，仅ESRCH表示组消失；EPERM/其他错误必须未知或仍在。可沿用该保守规则，另加/proc身份与SID/PGID核对。
- `:143` signalProcessGroup在组signal异常后fallback child.kill：**不能直接照抄作为新闭环**。它可能只杀leader，留下browser；异常被吞且不检查startticks/PGID/SID。新supervisor须提供带归属核对和错误记录的signal_group，不能把fallback成功当整组结算。
- `:218` awaitChildExit可作为只读复用的计时/close监听骨架，通过现有signal_group/group_exists seam接入新ownership校验；其group_settled还须叠加实际/proc清单核实。重要局限：leader自然close而group仍在时它只观察15s，不会主动杀剩余；错误后onError/close顺序也不能证明PGID身份。因此worker协议必须在可控路径保住leader直到finalize，异常提前死亡走独立归属核实，不将它的返回值直接叫settled。`requireSuccessfulRendererExit`不可直接复用：新协议允许parent有意finalize已成功的draw后收到SIGKILL退出，不能把它混同业务失败或把任意SIGKILL混同成功。
- `media-process-policy.mjs:25–47`安装在worker加载上游/Playwright之前，spawn/spawnSync/execFile强制detached:false并syncBuiltinESMExports，正是防止Playwright请求detached:true逃离owner组的现有局部机制；media协议参数限制原样复用，不在Host安装。
- `openfilm-render-worker.mjs`已有先hash再import、局部policy、私有native-home、guard marker和固定host loader hook。新worker可复用这些模块/模式而不改正式render worker。固定pageframes文件直接import；原host经已有offline-wrapper入口，原算法不变、既有网络限制不退化。wrapper只在这个独占Node进程中修改原FilmPage.open，Host和peer无共享ESM实例。现有launch guard没有显式mute flag；新worker须用独立小guard facade在同样BLOCKING_FLAGS之后附加--mute-audio，或同等经过验证的worker局部guard，不能改已通过renderer wrapper/pin。

历史证据：冻结tree的 `docs/execution/A/logs/main-media-process-r3/chromium-groups.json`记录normal-close和kill-group各6个真实身份，均all_in_owner_group=true、remaining=[]，chromium-probe.exit=0；同期tests137/137。**该JSON的policy hash是bcadcfec…0559，而冻结057的policy是3d448ff7…95bc，不能把旧Chrome探针冒充当前057 policy精确字节验证。** 当前Node inheritance test源码覆盖spawn/spawnSync/execFile及undefined options重载；新方案须对实际新worker+057既有policy+真实当前Chrome重新做诊断。旧探针不测新IPC、SID、late launch、pageFrame或父close，且仅采样后代，不能直接成为本项PASS。

## 最小文件范围与接口

拟新增私有 `src/adapters/openfilm/openfilm-cache-worker.mjs` 与 `src/adapters/openfilm/cache-process-supervisor.ts`；可另加小的worker-local transport/policy/guard facade模块及cache-worker专用完整性manifest。既有只改adapter factory内部pageFrame/close调用点与bridge父folder-drain接线；workspace原则上继续await桥完整promise即可持有PRE，若需独立uncertainty owner再作精确改点。不得改正式 `src/host/render/*` 源/pin或固定vendor；只import现有稳定helpers。新专用manifest登记worker、supervisor、所复用policy/guard和固定pageframes/host及实际执行依赖hash，不更新正式render pin、不改approved015。

owner的pageFrame公开签名不增signal。owner内部发DrawRecord，close封新admission并可取消该owner所有accepted draw，等待实际结算；若要保留旧close“等待已接单而不主动cancel”语义，ADR明确选择，默认建议等待，遇父服务关闭/私有cancel再取消。新增私有supervisor AbortSignal入口只供已验证bridge/service使用，不暴露用户可造的group/PID/token。品牌仍在原factory铸造，不返回worker对象替代issued owner。

## 归属建立：先预约，再spawn，再允许上游

1. 同步建立DrawRecord/accepted责任，持有PRE与serving，随机32byte私有ticket，绑定owner实例、workspace_ref/generation、origin/root和唯一reservation id；状态RESERVED。**spawn前无法知道PID**，只能登记reservation，不能捏造PID/startticks。记录spawn intent和预期入口hash，随后用固定Node绝对路径/固定argv、shell:false、detached:true启动worker。
2. spawn返回后无await地登记ChildProcess/真实pid、error/close/stdout/stderr/私有pipe监听；读取Linux `/proc/<pid>/stat`按最后一个`)`解析字段，保存PID/startticks(22)/PPID(4)/PGID(5)/SID(6)，要求PPID是父Host、PGID=SID=worker PID。拒绝/proc读取未知与自报替代。worker启动只安装控制通道/SIGTERM处理，不import上游、不启动Chrome，发送HELLO后等GO。父读不到身份时不发GO。
3. parent与worker各核对同一ticket、协议版本、draw id和自/proc身份。私有ticket只走继承pipe，不进argv、URL或日志；它防串话，不替代内核ownership。父验证代码/固定根/hash后才发GO；worker再重复校验入口/依赖hash并安装worker-local policy、guard及可关闭的出生闸门，然后执行原固定pageFrame一次。
4. 记录组内实际身份时保留(pid,startticks,pgid,sid,ppid,state)。扫描不仅追PPID后代，也枚举所有同PGID/SID项，以覆盖重挂到init的browser；Z也算未消失。随机ticket/环境字符串不能成为杀组依据；不会读取/proc/environ或用户secret。

## 组不逃逸的证明边界

Node子进程fork/exec默认继承PGID/SID；现有policy把Playwright的detached改false。要先加载policy再加载固定Playwright模块，防预先捕获原spawn；固定路径使用的所有子进程入口须列清单。现有policy只包装spawn/spawnSync/execFile，不应宣称拦截fork/exec/execFileSync或任意native setsid。新worker-local补充层应拒绝未批准的子进程入口/命令、把固定路径允许的入口都纳入出生账本，并提供SEALED后禁止新spawn的闸门；不可在共享Host打补丁或使用任意shell。

这不是对恶意native二进制的内核sandbox证明。对本次固定Playwright/Chrome可执行closure，必须用真实/proc诊断验证Chrome主进程/zygote/renderer/utility/crash helper均继承相同PGID/SID，并在终止后组和每个采样身份均消失；冻结可执行路径/版本/hash为环境前提。若该固定二进制自己setsid/换组、出现不同SID后代，不能照样宣布noescape或只看原组为空，必须拒绝能力准入/记录escaped-owned身份并走有证明的资源回收。若合同要覆盖任意native escape，则需cgroup/同等内核containment，超出这个小方案；不能假称现有JS policy已经提供。WSL Linux/proc、负PGID signal和init实际reap能力均为准入条件。

## worker与父supervisor协议

状态建议：RESERVED → SPAWNED_UNVERIFIED → READY_VERIFIED → RUNNING → CANDIDATE_OK/PRIMARY_FAILED → SEALED → TERMINATING → CHILD_CLOSED → GROUP_GONE → FOLDER_DRAINED → DELIVERED/FAILED_SETTLED；任何不确定转CLEANUP_REQUIRED，并持有原DrawRecord/PRE/serving，不转DELIVERED。重入close复用同一promise。worker不发settled=true，只有parent根据内核和自己HTTP/probe账本产生settlement receipt。

worker原pageFrame resolve后发送一次候选JPEG+sha256+来源hash；reject后发送原错误码/有界message，不改为成功。然后封子进程出生，尽力await closePageFrames，但这个返回不构成结算证据。正常成功同样清理整组，缓存页/iframe未来读输入的执行面必须消失，不能把buffer一发就放掉PRE。late launch/JOB把browser置null或close空返不影响：潜在launch续体在worker退出后不可能再执行，已经出生的browser仍在owned组，父必须清完它。

parent拿到candidate后发FINALIZE；worker保持控制loop和已安装SIGTERM handler作为leader锚，不在candidate后自己process.exit。温和close完成且parent核实组内除leader无成员、SEALED禁止任何新spawn时，允许明确EXIT，worker正常exit0；父仍等真实ChildProcess close及整组消失。若温和关闭迟迟不完，parent进入TERM→KILL流程，worker的SIGTERM handler不得提前退出让group锚丢失；在同一锚PID/startticks/PGID/SID核对成功后发负PGID TERM，宽限后再次核对同一锚再KILL，直到child close且组ESRCH、已知身份全部不存在才结算。有意FINALIZE_AFTER_OK造成的SIGKILL是受控回收事实，若candidate完整且没有cancel/输出溢出/协议/清理错误，ADR可允许交付；日志必须明写forced_finalize，不伪称graceful_exit0。未知/自发崩溃SIGKILL没有此资格。

原操作失败/seek15s/JOB45s/capture30s/父cancel都不会交付JPEG，但使用同一回收链后正常转FAILED_SETTLED，PRE可释放；不是永久abandon。取消优先于已到candidate但尚未DELIVERED的结果；最终交付前再核对owner/view/cancel，取消不可被竞态成功覆盖。

候选超时参数供MAIN ADR确定：READY30s，GO后的外层60s（不改上游15/45/30s），温和finalize3s，TERM宽限3s，KILL后确认15s；这些是触发动作/报告UNKNOWN的截止，**不是到点就视为settled**。控制状态/原生错误必须区分外层deadline与原JOB/seek错误，不能把提前触发的parent timeout叫已覆盖JOB45s。

## signal/退出的细节：不复用危险fallback

只对owner锚仍符合原PID/startticks、PGID=SID=原pid的组发负PGID signal，记录每次结果；ESRCH是观察事实，EPERM是异常而非成功。新guarded signal_group不能catch后悄悄child.kill当组已终止。现有helper只能在这些guard之下复用；parent也不得在leader自然退出后延迟向可能重用的PGID盲发信号。

正常/timeout路径让worker保住锚直到最后KILL，因此有可实施的精确终止窗口。若worker自发崩溃而组残留，先继续核对所记录成员/组身份，不能只凭旧数字杀组；需要额外可靠身份句柄的回收或MAIN reconciliation，真实保持CLEANUP_REQUIRED。若严格要求对这种异常也任意时刻有界强杀，需要pidfd/cgroup或独立存活reaper-anchor，须另审范围；不隐称Node+startticks消除了所有TOCTOU。标准POSIX数字signal并非原子pidfd，对锚存活核对与发信号间意外死亡的极小竞态也要如实列为信任边界，异常身份变化停止自动信号。parent本身死亡可由worker私有pipe EOF触发封出生、尝试graceful close并自持锚对自己的组KILL，后续MAIN重启只读核对原receipt；这不是跨机器重启恢复已自动通过。

发SIGKILL成功不等于reap。parent等待worker close（含stdio真正关闭），再要求group signal0=ESRCH、/proc无同PGID/SID、所有记下的(pid,startticks)项都消失，包括Z。如init不回收Z，不能过滤掉Z假绿，保留owned责任。确认截止后仍CLEANUP_REQUIRED，后续只在真实消失并完成资源drain后才能转FAILED_SETTLED；这只是例外保全分支，正常与超时设计都主动回收。

## 父serving/FD交付门

桥beginDraw必须覆盖spawn、原工作、退出/清组、父folder请求/probe排空全链，endDraw不得在candidate或公开原pageFrame拒绝时触发。现有 `folder.drain`(冻结adapter:625–629)等请求/probe集合，可新增私有bridge访问，不能在accepted>0时递归serving.close，否则close等endDraw而endDraw等close会死锁。worker执行面全灭之后才drain，既有流要finish/abort、真正ffprobe close/reap；group证明不覆盖Host里的probe。然后才返回buffer给workspace做POST/原有witness校验；失败同样settle后再拒绝，workspace正常catch/finally才释放PRE。

同一serving内draw可先保持串行，防持续新请求令drain无边界/同key文件并写；不同owner/独立serving的peer draw可同时占用各自owned组，在MAIN批准并发上限内运行，资源超额排队。A的JOB只关闭A的进程内browser，Host只signal A组，B进程/browser/serving原样继续并实际绘制成功；这次才可承诺原生JOB物理隔离。close A只封A新请求，不影响B。若两个owner指向同一物理workspace/cache key，仍需原service路径互斥；进程隔离不自动解决磁盘写冲突。

CLEANUP_REQUIRED情况下桥promise/责任不能丢；若需先回客户端错误，必须独立移交PRE和serving给明确owned cleanup记录，不能让workspace无条件finally释放。仅该失败scope暂停交付，不禁用所有producer作为“修复”。

## 有界通道与预算

stdout/stderr只做诊断，每流64KiB总计128KiB作为拟议硬上限，保留尾部8KiB，运行中累计，超限即PRIMARY_FAILED+终止组，不只截断后宣称成功。请求/候选走继承的独占二进制pipe（例如fd3控制、fd4响应），不用stdout也不用默认Node IPC整对象反序列化来宣称输入有界。固定header先读长度，限制元数据16KiB、请求64KiB、JPEG8MiB，增量读取/计数、检查一次响应+序号/ticket/sha256、忽略或拒绝重复/晚到帧，写端遵守backpressure。上述数值由ADR明确；超界是清晰budget refusal，不改固定JPEG算法，也不假装所有历史合法超大overrides/画幅都不受影响。应验证实际默认fixture在预算内。

私有目录0700、文件0600、仅显式run id下写，不读用户home内容，不扫删其他run。固定入口及vendor根来自factory verified capability，不来自用户IPC路径；request.root/base沿原issued serving绑定。错误不输出ticket、headers/env/用户绝对路径。worker response不能覆盖parent捕获的signal/输出上限/取消/ownership失败。

## 相对前一observer方案的代价和ADR边界

这条路线不需大面积AST插桩、不需追每个隐藏raw.evaluate promise；其真实终止证明是“所有可执行续体所在Node+browser进程域消失”，并非声称那些promise都优雅resolve。每draw新Node+新browser导致CPU/内存/启动时延更高，丢失跨draw页面/JS状态和KEEP_PAGES复用；真实磁盘cache文件、原pageFrame key/版本/预算和确定性渲染逻辑保留，已有合法缓存命中仍按原算法（正常受控生产前置仍拒绝覆盖的规则不变）。并行draw会由原模块单queue变成多个worker，需要显式Host容量与每workspace磁盘互斥，不承诺无限并行。相比observer保留共享browser的性能收益，此路线清理证明更小、peer隔离更强，但运行成本更大。

MAIN ADR最少写清：Linux/WSL/proc与实际Node/Playwright/Chrome二进制闭包前提；policy noescape的验证范围和非Linux拒绝；每draw隔离/缺少页复用；私有spawn出生闸门、IPC/输出/外层清理预算；owner.close等待还是主动取消；已成功candidate在有意forced_finalize后是否可交付；原native错误/cleanup原因保留；父serving drain和PRE交付门；新worker integrity manifest与拟文件owner/release。此ADR不更改正式render合同/pin，不能把Windows用户经WSL验证写成原生Windows/macOS全平台支持。

## 精确验收/诊断（全部待授权，NOT_RUN）

建议新 `tests/agent-driven/integration/cache-process-settlement.test.ts` 和专用只诊断probe；原renderer测试/源字节保持。轻量用例覆盖协议帧分片/长度/重复ticket、spawn失败、READY未GO不得启动、startticks/PGID/SID错配、EPERM/未知不settle、正常exit残组、取消候选竞态、close重入与每resource释放一次。重型case必须真实固定producer，不能拿假producer闭环：

1. **正常连续两draw+poster**：真实JPEG/cache/deps/stamp/duration，两个新worker/browser，原key不变；worker close+整组和全部身份消失→parent请求/probe排空→endDraw/PRE release的序列断言；页截图后延迟请求没有执行域可再发起。保持Q03多frame/current duration用例。
2. **seek15s**：真实页ready完成，frame返回不resolve；观察原FrameError，并主动终止A组至消失；无witness、FAILED_SETTLED，B真实draw成功。不能缩短原FRAME_MS宣称覆盖。
3. **JOB45s**：真实goto等待未结束load，使原goto60s晚于JOB45s；观察原JOB文本/45s分支与browser变量空返场景，parent仍以owned组清理；B组/浏览器上下文存活并成功，不能只比owner集合数。
4. **capture30s**：授权可控真实CDP/browser停滞或barrier，使用原CAPTURE_MS，准确标“真实资源+transport barrier”与自然卡顿的区别；wrapper拒绝早于资源结束仍不得释放PRE。
5. **late launch/newPage**：实际Chrome启动资源的受控交付barrier跨JOB或parent cancel，Node仍有原续体；worker SEALED后晚spawn被拒，已启动Chrome由组清理；可控注入不冒充自然OS launch慢。
6. **父close/cancel/断管**：执行中与candidate到达后各取消；重复close同receipt；B同时真实绘制不受A组TERM/KILL影响；另在隔离测试parent子进程中验证控制pipe EOF worker自清理，核实所有后代消失。
7. **真stdout/stderr洪水、超长/分片二进制响应**：超限拒绝且实际组清完；不得先分配完整巨大IPC对象再声称8MiB内存边界。
8. **真实异常清理**：group EPERM/leader提前崩溃/关闭异常注入分别验证不假settled与保留原主因；已关闭后抛cleanup Error仍保留对象；未关闭前失败不能只写cleanup字符串。可回收的普通TERM-ignore由KILL实际闭环，不拿异常例永久UNSETTLED替代正向证明。
9. **真实继承诊断**：以新worker执行固定真实pageFrame，记录PID/startticks/PGID/SID及可执行hash，分别正常finalize和seek/JOB/强杀，所有相同身份/proc项包括Z消失；同时保留peer组记录。新probe不得沿用旧工具无界stdout/stderr；也禁止任何按名字扫kill。

拟命令仅作验收包入口：`corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/cache-process-settlement.test.ts --maxWorkers=1 --minWorkers=1`；专用真实containment probe须先落源码、精确argv/输出唯一目录、端口/单重型槽和停止条件，再由MAIN授权执行。本报告没有运行这些命令，更没有放行A04代码。
