# n1n2-claude-060p1r2 — 合并修复与轻量自验证报告（非 P2）

- release_id: `MAIN_RELEASE_060P1R2_CONSOLIDATED_REPAIR`
- task_id: `task_4ba8760231b0` / dispatch_id: `ctx_c79af5ef24d4`
- 依据: `repair-060p1r2/RELEASE.json`、`repair-060p1r2/SPEC.md`、`repair-060p1r-review/custodian-review/REVIEW.md` + `FINDINGS.json`（REQUEST_CHANGES：**C01..C11**）、`repair-060p1r-review/integration-review/REVIEW.md` + `FINDINGS.json`（REQUEST_CHANGES：**IR01..IR11**）、`repair-060p1-review/ADR_060_REV3_CUSTODIAN_AND_REPAIR.md`（rev3）、`repair-060p1-review/060P1R_PRIVATE_CONTRACT.md`、`ADR_060_REV3_BINDING.json`、`REV3_DOCUMENT_APPROVAL.json`
- 实施者自签：**不是外审**。源码冻结、独立静态复验与最终验收由 MAIN 组织。
- 旧报告**不覆盖**：`n1n2-claude-060p1-report.md`、`n1n2-claude-060p1r-report.md` 原样保留。本报告逐编号回应两位独立审查的 22 条。

## 0. 结论

本波修的是**整条责任链**，不是逐条静态表达式：

1. **正常启动链**（C01/C02）：Host 以 `detached:true` 启动 C（`cache-process-supervisor.ts:1214`），C 因此**在自己的 session/group 里诞生**；C 用 `custodian_is_isolated()`（`cache-process-custodian.py:326`）向内核核对 `pgid==sid==pid`，**不再对自己调用 setsid**；`prctl` 的 GET 改为**指针 + `c_int` 存储**（`:358/:374/:387`）；`self.sequence` 显式初始化为 0（`:852`）；**父进程 fork 后立刻关掉 exec 写端与自己的 draw fd3 副本**（`:803/:1130`），**子进程除 exec 管道外关闭一切 >3 的 fd**（`:792`）；exec 状态**在同一个非阻塞 selector 里读**（`:1210`），不再同步阻塞；setup/exec 失败写**真实 errno**（`:1104/:1150/:1160`），成功**只由 CLOEXEC EOF 表示**（`:411`）。
2. **唯一 wait owner 与完整证明**（C03/C04/C05/C06、IR03）：C 的**自身身份单列**，不再进入"目标已消失"的判定表（`:1079/:1409`）；目标身份表跟踪 N **和真实的被收养后代**（`:1284`）；未知 errno **不转 gone/空组**（`:273/:292/:231/:251`）；组信号**只在 N 自己建立 session/group 且核对完整 epoch 后**发出，setsid 前失败**只处置精确未 reap 的直属子 N**（`:1428`）；TERM/KILL **由所有目标的活动决定**（孙进程忽略 TERM 仍升级）；N 用 **WNOWAIT 保锚**，被收养后代**先收**，N **最后 reap**（`:606` `TargetSettlement.run()`）。
3. **有界控制面与截止**（C07/C08、IR08）：解码器**部分缓冲**与**已解码队列**（帧数+字节数）**同时有界**（`:700` `CacheFrameQueue`）；合法 metadata+最大 JPEG **合并到达**仍有效（draw 队列上界 = 8MiB+16KiB+64）；**总 READY 30s 一个起点**（`:1411` `new CacheDeadline(...)`，三步共用）；GO 后 outer 60s **含 JPEG**；候选后 finalize 3s **从候选起算**；洪水**在每一阶段**立即锁存；非阻塞写**按 offset 保存短写尾**（`:472` `ControlWriter`），**终端帧槽与 16KiB 单独预留**（`:518`）；**最终 receipt 未 flush 不能成功退出**（`:1568`）。
4. **候选不是成功**（C09、IR04）：候选**可被后来的失败撤销**（`:560` `latchCacheOutcome`），而**失败永不被后来的候选/清理覆盖**；`#holdForCleanup` **复制并去重**清理原因（`:577` `collectCacheCleanupCauses`），**不再边遍历同一边 push**。
5. **真实 whole-production 所有权与结束凭证**（IR01/02/05/06/07/11）：scope 的完成**只由真实阶段代码 settle 的私有 phase lease** 构成（`cache-production-scope.ts:463` `openCacheProductionPhaseLease`），**mint 不再接受调用方手造的 `{settled:true}`**（`:507`）；**消费一次即 spent**（`:546`），错 issuer/root/generation/未结束阶段/重复消费**全拒**；**factory 把真实 scope 交给 supervisor**（`openfilm-upstream.ts:645`），hold 会**标根 held**；**workspace 只有在 completion 被消费时才 release**（`created-native-workspace.ts:773-775`），否则**保持全 root barrier**；**责任按精确 draw 身份贯穿**，不再按 producer+root 找最后一条（`openfilm-upstream.ts:1657`）；**settled 只留有界摘要**（`:672`），不再留 8MiB 的 JPEG；**direct scope 覆盖 execution+parent_drain**，由 **bridge 在 drain 之后**归还（`:1690`）；**producer.close 等到 parent 阶段结束**（`:1692`）；workspace 把**既有 abort signal** 传给 scheduler（`created-native-workspace.ts:733`），获准后仍重验。
6. **每 draw 私有 HOME/XDG**（C10）：launch 前建立**私有 run 目录**（`cache-process-supervisor.ts:1123`），子环境**白名单且指向私有目录**（`:1139`），**不读用户配置/全 env/secret，不改 Host 全局 HOME**；真实完整结束后才删自己的 run dir，UNKNOWN 保留且可检视（`:1161`、`:1804`）。
7. **有意义的 pilot 重做**（C11、IR09/10）：helper **先正确绑定 GO ticket 摘要**、**mode 在 HELLO 前确定**、**foreign HELLO 真的 foreign**、**half-JPEG 是真的截断帧**、**normal 真的成功**、**零媒体零浏览器**、**ignoreTERM 有真 N 与真孙进程**、**保活用 ref 的真实 timer**、**child 立即登记 owner、finally 精确身份处置**、**UNKNOWN 保留目录**。**identity 轻量门不再真的 spawn**：spawn 被 `vi.mock` 局部替换，纯用例**断言精确零实际调用**。

本波**只运行本票允许的十一条命令**（外加一次许可的 `--generate`）：全部 exit 0，全部 runtime 捕获 `source_changed=[]`；生成捕获的 `source_changed` **恰好只有** `src/adapters/openfilm/cache-worker-integrity.json`。**所有真实 custodian / prctl / fork / setsid / wait / signal / 子进程故障 / HTTP / Chrome / ffmpeg / ffprobe / 媒体 / fullcheck / build 均 NOT_RUN**。原 17 与 ISO-01..18 **不减**，A057-04 **未关闭**，N1N2 / NativeAck / Studio / A 片 / V1 **不可用**。

## 1. 两位审查的 22 条逐编号闭环

图例：**已实证** = 本波有真实捕获证据；**实现，真实证据 NOT_RUN** = 代码写了，但需要真实进程/浏览器/媒体；**NOT_RUN** = 本波未跑也未实现到可运行状态。

### 1.1 custodian-review（C01..C11）

| 编号 | 级别 | 修订 | 实现位置 | 本波证据 |
|---|---|---|---|---|
| **C01** | BLOCKER | 三处启动缺陷一并修：① Host 以 `detached:true` spawn C，C 因此在**自己的 session/group** 中诞生，C 用 `custodian_is_isolated()` 向内核核对 `pgid==sid==pid`，**不再对自己 setsid**；② `prctl` 的 GET 改为**指针 + `c_int` 存储**（`prctl_bind` 不声明会拒绝 `byref` 的转换，改为默认转换 + `POINTER(c_int)`）；③ `self.sequence = 0` 显式初始化 | `cache-process-supervisor.ts:1214`（`detached:true`）；`cache-process-custodian.py:326` `custodian_is_isolated`、`:358` `prctl_bind`、`:374` `prctl_get_arg2`、`:387` `prctl_get_child_subreaper`、`:852` `self.sequence` | **已实证**：`cache-custodian-unit.py` 的 `ThePrctlCall`（GET 收 `POINTER(c_int)`、SET 收整数 1、拒绝的 GET 不是确认）与 `TheGateOfTheGroup`（4 例）；**真实 detached C 的 sid/pgid/startticks 与 C 的 seq1 HELLO：NOT_RUN** |
| **C02** | BLOCKER | exec 管道**所有权归位**：父进程 fork 后**立刻**关掉 exec 写端（`:803` `parent_close_set`），**父进程同时关掉自己的 draw fd3 副本**（同一函数内 `DRAW_FD`），子进程**除 exec 写端外关闭一切 >3 的 fd**（`:792` `descriptors_to_close`）；exec 状态**在 selector 内非阻塞读**（`:1210` `_read_exec_status`），EOF=成功、载荷=真实 errno（`:411` `classify_exec_status`）；setup/exec 失败写真实 errno 后 `_exit(127)` | `cache-process-custodian.py:792`、`:803`、`:1097` `_spawn_worker`、`:1210`、`:1225` `_finish_exec` | **已实证**：`cache-custodian-unit.py` 的 `TheExecPipe`（6 例：空读=成功、载荷=errno、非法载荷=EIO、EAGAIN 不阻塞、子进程保留 exec 管道、父进程关掉 exec 写端与 draw socket）；**真实 exec 成功/失败/卡住：NOT_RUN** |
| **C03** | MAJOR | **C 的自身身份单列**：`custodian_identity` 不进 `self.identities`；`_known_targets_gone` 只走目标表；收据里的 custodian 段单独报告 | `cache-process-custodian.py:1079` `_record_target`、`:1409` `_known_targets_gone`、`:1571` `_send_receipt` | **已实证**：`cache-custodian-unit.py` 的 `TheIdentitiesOfTheTargets`（自身不在目标表；**c 自身活着时目标已消失仍为真**）；**真实收据：NOT_RUN** |
| **C04** | MAJOR | 结算改成**由所有目标活动驱动**：新增 `TargetSettlement`（可注入操作），顺序固定为 ①礼貌信号 ②按**存活目标**决定升级 ③**被收养后代全部 reap 在前** ④**N 最后 reap** ⑤ECHILD/组 ESRCH/身份消失 | `cache-process-custodian.py:606` `TargetSettlement`、`:657` `run()`、`:704` `KernelSettlementOperations`、`:1312` `_live_targets`、`:1347` `_reap_adopted`、`:1373` `_reap_worker`、`:1392` `_echild` | **已实证**：`cache-custodian-unit.py` 的 `TheSettlementOfTheDomain`（**孙进程活着 → 仍发 SIGKILL**；**reap-worker 在所有 reap-adopted 之后**；无存活目标时不发硬信号；无组时只信号精确子 pid）；**真实 TERM-ignore 孙进程/延迟收养：NOT_RUN** |
| **C05** | MAJOR | **组信号有完整前提**：只有 N 的 `pgid==pid && sid==pid`（真实 session/group 建立）才发组信号，且**永不指向 C 自己的 pgid/sid**（`:1443`）；setsid 前失败**只处置精确未 reap 的直属子 N**（`:657` `_signal`）；`group_state`/`signal_group`/`direct_children`/`group_members` 全部**三态**（gone/present/unknown，failed≠sent） | `cache-process-custodian.py:273`、`:292`、`:231`、`:251`、`:1334` `_target_group`、`:1428` `_settle_domain` | **已实证**：`cache-custodian-unit.py` 的 `TheSettlementOfTheDomain`（无组时只有 `signal-pid`、**零 `signal-group`**）与 `a_group_that_could_not_be_asked_is_not_an_empty_group`（EIO→unknown、ESRCH→gone、正常→present）；**真实 setsid 前失败/权限拒绝：NOT_RUN** |
| **C06** | MAJOR | Host 侧**一套严格执行证明**，`run` 与 `reconcile` **共用**（`#proveExecution`）：C 真实 close + **exit 被观测且不是被信号杀死** + exit code 0 + **收据严格匹配**（协议/draw/ticket/seq/outcome/ECHILD/组/身份/事件链/digest/truncation）+ 目标组新鲜 gone + 每个记录身份 gone | `cache-process-supervisor.ts:1730` `#proveExecution`、`:1697` `#validateReceipt`、`:480` `validateCacheExecutionReceipt`、`:1024` `reconcileCleanup`、`:1112` `#fail` | **已实证**：`cache-process-identity.test.ts` 的 `the receipt of the custodian`（11 例：缺 receipt/换 draw/换 ticket/换协议/**错 seq**/outcome 非 reaped/ECHILD 假/组假/身份假/**事件链被截断**/**digest 不符**/换 custodian/换 worker）；**真实缺收据/C 意外死亡/持证 reconcile：NOT_RUN** |
| **C07** | MAJOR | **解码缓冲 + 已解码队列双有界**：新增 `CacheFrameQueue`（帧数+字节数），控制通道 8 帧/64KiB、绘制通道 4 帧/8MiB+16KiB+64；**worker 侧也加界**（`openfilm-cache-worker.mjs` 的 `buffered` 超限即失败）；**洪水在每一阶段立即锁存**（stdout/stderr 超限 → `#latchFailure`），不再只查一次；C 每轮读有界（`STREAM_ROUND_BYTES`） | `cache-process-supervisor.ts:700` `CacheFrameQueue`、`:203` `CACHE_DRAW_LIMITS`、`:1290` `onStdout/onStderr`、`:1298` `onStderr`；`openfilm-cache-worker.mjs` 的 `channel.on("data")`；`cache-process-custodian.py:1035` `_drain_worker_streams` | **已实证**：`cache-process-identity.test.ts` 的 `the queue of the decoded frames`（2 例：帧数界/字节界）；**真实洪水（合法小帧连发、pre-result/post-candidate 洪水、TERM-ignore 洪水）：NOT_RUN** |
| **C08** | MAJOR | **短写不丢帧**：`ControlWriter` 按 **offset** 保存尾部、只计**真实剩余字节**；**终端帧槽 + 16KiB 单独预留**，普通帧不得占用；**最终 receipt 未 flush / 通道已断 → 不能成功退出**（exit 4）；C **订阅 writable** 以便重试；**父进程关掉 draw 副本**，Host 观测到的 EOF 是 N 的 | `cache-process-custodian.py:472` `ControlWriter`、`:518` `queue`、`:536` `flush`、`:978` `_sync_control_interest`、`:1568`（未 flush → 非零退出）；`:803` `parent_close_set` | **已实证**：`cache-custodian-unit.py` 的 `TheControlWriter`（3 例：短写保留尾部与 offset、终端预留独占、超预留被拒）；**真实背压下的完整 transcript：NOT_RUN** |
| **C09** | MAJOR | **候选可被后来的失败撤销**（`latchCacheOutcome`：candidate→failure 允许，failure→failure 保留第一条）；**清理原因复制+去重+有界**（`collectCacheCleanupCauses`），**不再边遍历同一边 push**；exit/protocol/cancel/预算失败在**观察处**锁存 | `cache-process-supervisor.ts:560`、`:577`、`:1076` `#latchFailure`、`:1093` `#holdForCleanup` | **已实证**：`cache-process-identity.test.ts` 的 `the latch of the outcome`（3 例）与 `the cleanup causes of a held draw`（2 例：数组边遍历边扩张已消除、原因有界）；**真实候选后 fatal/超时/cleanup-unknown：NOT_RUN** |
| **C10** | MAJOR | **每 draw 私有命名空间**：launch 前 `mkdtemp` 建 run 目录并建 home/cache/config/data/runtime/tmp 六个私有目录（0700）；子环境**白名单**且 HOME/TMPDIR/XDG_* **全部指向私有目录**；**不读用户配置/全 env/secret**，**不改 Host 全局 HOME**；浏览器二进制只按原固定配置（`PLAYWRIGHT_BROWSERS_PATH`，与 formal render 的白名单同源）显式传；**真实完整结束后**才删 run dir，UNKNOWN **保留且可检视**（`inspectCleanup.run_directory`） | `cache-process-supervisor.ts:1123` `#createRunDirectory`、`:1139` `#childEnvironment`、`:1161` `#releaseRunDirectory`、`:1804`（finally 中释放）、`:1006`（inspection 暴露 run_directory）、`:240` `CACHE_CHILD_ENV_NAMES`、`:248` `PRIVATE_CHILD_ENV_NAMES` | **已实证**：`cache-process-identity.test.ts` 的 `starts a draw only once`（断言 `detached===true`、`env.HOME` **不是** Host 的 HOME 且落在 `narralens-cache-run-` 内、argv 固定）；**真实两次 draw 的目录独立、UNKNOW���保留：NOT_RUN** |
| **C11** | MAJOR | **pilot 重做（不跑）**：helper 绑定 GO ticket 摘要（`sha256(go.ticket)`）；**mode 在 HELLO 前确定**（从 helper 旁的场景文件读，`foreign-hello` 因此能**真的**说假身份）；**half-JPEG 发真截断帧**（头声明全长、只写一半）；**normal 真的成功**（正对照）；**零媒体零浏览器**（不 import nativeSourceFixture、不碰 ffmpeg）；**ignoreTERM 有真 N 与真孙进程**，另加"leader 先退出→延迟收养"模式；**保活用 ref 的真实 timer**；child **立即登记 owner**、所有断言在 **finally** 里按精确身份**真正 close/reap**；**UNKNOWN 保留目录**，afterEach 不无脑 rm；**identity 轻量门不再 spawn**（`vi.mock` + 断言零调用） | `tests/agent-driven/integration/helpers/cache-worker-fixture.mjs`（全文重写）、`helpers/cache-probe-fixture.mjs`（ref timer + 每次事件重读身份）、`cache-custodian-lifecycle.test.ts`（全文重写）、`cache-frame-duration-lifetime.test.ts`（finally 收割 + 父侧事件顺序）、`cache-process-settlement.test.ts`（**分 lane**：非浏览器 P2a / 浏览器 P2b）、`cache-process-identity.test.ts`（`vi.mock` spawn） | **已实证**：`cache-process-identity.test.ts` 44/44（其中"纯用例零 spawn 断言"为实证）；**helper 与 lifecycle 用例：NOT_RUN（P2a 授权后）** |

### 1.2 integration-review（IR01..IR11）

| 编号 | 级别 | 修订 | 实现位置 | 本波证据 |
|---|---|---|---|---|
| **IR01** | MAJOR | **release 必须以完整结算为前提**：workspace 只有在 completion **被消费**时才 release，否则 `markCacheProductionCleanupRequired` **保持全 root barrier**；**factory 把真实 scope 交给 supervisor**（含 ambient 的 workspace scope），hold 因此会**标根 held**；PRE/POST/tree close 失败 → 阶段 lease 不 settle → completion mint 失败 → **不 release**；已确定完成清理的**原业务失败**仍可按失败凭证结束（outcome="failed"） | `created-native-workspace.ts:733`、`:747-749`、`:757`、`:764`、`:773-775`、`:875`（parent_drain）、`:976`（tree_release）；`openfilm-upstream.ts:645`（scope 传给 supervisor）、`:538` `releaseProductionScope` | **已实证**：`cache-production-scope.test.ts` 的 `gives the scope back through the COMPLETION…`（completion 未 mint → 根仍 held）与 `refuses a phase lease of another owner…`（direct scope 缺 parent_drain → 无 completion）；**真实 PRE/POST 失败下的 barrier：NOT_RUN** |
| **IR02** | MAJOR | **私有 phase receipt**：mint **不再接受调用方手造的 receipt**；阶段由 `openCacheProductionPhaseLease`（私有 WeakMap 标识、**每阶段只有一个租约**、owner 必须匹配）签发**租约**，由**真正结束该阶段的代码** settle；completion 从**模块自己的记录**读收据；**消费一次即 spent**（WeakSet）；wrong issuer/root/generation/未结束阶段/重复消费**全拒** | `cache-production-scope.ts:463`、`:507`、`:546`、`:149` `CacheProductionPhaseLease`、`:157` `phaseLeases`、`:156` `spentCompletions` | **已实证**：`cache-production-scope.test.ts` 的 `refuses a phase lease of another owner…`（4 例）与 `refuses a completion of a scope whose owner is another one`（4 例）；**真实跨模块 phase capability 贯穿：NOT_RUN（静态可读）** |
| **IR03** | MAJOR | 收据**真的被验证**：见 C06；`facts.receipt` 由控制通道 pump **在到达时即捕获**（不是只在等到时），因此失败路径上的收据也能被证明；`#proveExecution` 为 run/reconcile **唯一**证明 | `cache-process-supervisor.ts:1290` 附近 `pumpControl`（DOMAIN_REAPED 即捕获）、`:1697`、`:1730` | **已实证**：`cache-process-identity.test.ts` 的 `the receipt of the custodian`（11 例）；**真实 refused/truncated/重排/C 意外死亡：NOT_RUN** |
| **IR04** | MAJOR | **候选可撤销**：见 C09 | `cache-process-supervisor.ts:560`、`:1076`、`:1594`（候选后若已锁存失败 → 走 `#fail`） | **已实证**：`the latch of the outcome`（candidate→failure 例）；**真实候选后 flood/协议异常：NOT_RUN** |
| **IR05** | MAJOR | **责任按精确 draw 身份贯穿**：bridge **持有它自己那次 draw 的责任对象**（`lastProductionResponsibility` 在同步调用后立即取走——注册发生在首个 await 之前），**不再按 producer+root 找最后一条**；`responsibilityOfRoot` 保留但**不再被 bridge 使用**（注释说明原因） | `openfilm-upstream.ts:507` `lastProductionResponsibility`、`:1657`、`:1620`（bridge 的 `responsibility` 字段）、`:1690` | **已实证**（静态 + 类型）：bridge 的 `inspect`/`reconcile`/drain 三处**只用同一个 `responsibility` 对象**；**真实同 root A held、B 排队：NOT_RUN** |
| **IR06** | MAJOR | **有界摘要与真实 held 责任**：settled 的责任**只保留有界摘要**（`{digest,bytes}`，不再留 8MiB JPEG）；责任数组**只保留最近 8 条 settled**，**未 settled 的一条都不丢**（真实 held 责任保留） | `openfilm-upstream.ts:518` `pruneProductionResponsibilities`、`:672`（outcome 摘要）、`:484` | **已实证**（静态 + 类型）；**真实长跑 producer 的内存曲线：NOT_RUN** |
| **IR07** | MAJOR | **direct scope 覆盖 execution+parent_drain**；**producer 不再先 release**：归还发生在 **bridge drain 之后**；`producer.close` **等到 parent 阶段结束**（`settleOnce` 在 drain 之后）；bridge 拥有 parent 阶段由 `bridgeOwnsParent` 标记，在同步调用后立即置位 | `cache-production-scope.ts:110`（direct 的必需阶段）、`openfilm-upstream.ts:438` `bridgeOwnsParent`、`:654-655`、`:694`、`:1661`、`:1684`、`:1690-1693` | **已实证**：`cache-production-scope.test.ts` 的 `refuses a phase lease of another owner…`（direct scope 需 parent_drain）；**真实 direct bridge 的父 drain 与 close 等待：NOT_RUN** |
| **IR08** | MAJOR | **队列总量有界 + 单一 READY 截止 + draw EOF 立即取消**：见 C07；`CacheDeadline` 让三级启动**共用一个预算**；draw 通道 `end/close` **当场**向 C 发 CANCEL | `cache-process-supervisor.ts:602` `CacheDeadline`、`:1411`、`:1449`、`:1500`、`:1660`（draw EOF→cancel）、`:700` | **已实证**：`cache-process-identity.test.ts` 的 `the deadline of the startup chain`（1 例）+ `the queue of the decoded frames`（2 例）；**真实合法 metadata+最大 JPEG 合并到达：NOT_RUN** |
| **IR09** | MAJOR | **helper 协议与保活重做**：见 C11（ticket 摘要、mode 前置、foreign 真假、half 真截断、normal 真成功、零媒体、ignoreTERM 真 N+真孙进程+延迟收养、ref timer、finally 收割、UNKNOWN 保留）；probe helper 也改用 **ref timer**（原来 unref+未决 TLA → 进程立刻就没了） | `helpers/cache-worker-fixture.mjs`（全文）、`helpers/cache-probe-fixture.mjs`（全文） | **已实证**（语法 + 静态）；**真实 helper 行为：NOT_RUN（P2a）** |
| **IR10** | MAJOR | **identity 轻量门不再真的 spawn**：`vi.mock("node:child_process")` 局部替换 spawn，纯用例**断言 `spawnMock` 零调用**；唯一会 start 的用例断言 **spawn 恰一次**、argv 固定、`detached===true`、HOME 为私有目录。**历史更正见 §9 evidence-gap**：旧门**真的启动过失败路径的解释器**，旧报告"零真实进程"**不实** | `tests/agent-driven/integration/cache-process-identity.test.ts`（`vi.hoisted` + `vi.mock` + `beforeEach` reset） | **已实证**：44/44，其中"纯用例零 spawn"与"start 恰一次且 argv 固定"为直接断言；**本波未启动任何进程** |
| **IR11** | MINOR | **workspace 把既有 abort signal 传给 scheduler**：排队中的 reservation **及时被取消**，不再只能等 30 秒 | `created-native-workspace.ts:733`（`signal:this.#abort.signal`） | **已实证**（类型 + 静态）；**真实 close 时排队被及时取消：NOT_RUN** |

### 1.3 原 11 条（P1-F01..F11 / P1-N01..N02）未被降格

两位审查都写了"先前发现**不会**因为代码存在就自动修复"。本波**没有**把任何一条标成 PASS：

| 原编号 | 本波状态 |
|---|---|
| P1-F01（parser） | 保留；Python parser 与两个 TS parser 未改，本波另加 custodian 侧 `parse_proc_stat` 的真实布局用例（NOT_RUN 之外仍为静态） |
| P1-F02（三态内核查询） | **加强**：custodian 侧 `direct_children`/`group_members`/`group_state`/`signal_group` 全部改为三态，errno 不再被吞成"gone" |
| P1-F03（issuer / held / 交接） | **加强**：`#proveExecution` 成为 run/reconcile 的唯一证明；reconcile 的三道门未放宽 |
| P1-F04（责任登记 / 私有 completion） | **加强**：completion 不再接受手造 receipt，改为私有 phase lease；release 以 completion 被消费为前提 |
| P1-F05（身份先验证后采纳） | **加强**：C 自己的 session/group 也向内核核对（C01） |
| P1-F06（每个阻塞点有 deadline） | **加强**：READY 改为单一预算；exec 状态不再同步阻塞 |
| P1-F07（入向/出向预算即时生效） | **加强**：队列总量有界、洪水每阶段锁存、worker 侧也加界 |
| P1-F08（入口先登记 / close 封准入 / 排队取消） | **加强**：abort signal 进 scheduler；close 等到 parent 阶段结束 |
| P1-F09（单调锁存） | **加强**：候选可被失败撤销（C09/IR04） |
| P1-F10（源 error≠close / destroy 异常保留） | 保留，未改（`openfilm-upstream.ts` 的源账本段未动） |
| P1-F11（真实 pgid） | 保留，未改 |
| P1-N01（close≠reap 的纠正） | 保留；probe pilot 现在记录**父侧** error/exit/close/callback 的**顺序** |
| P1-N02（旧失败 UNRECORDED） | 保留；**新增 2 次 P1R 失败同样 UNRECORDED**，见 §9 |

## 2. 文件清单（严格等于本票 allow_existing / allow_new）

### 新增（1，在 allow_new 内）

| 路径 | 责任 | sha256 |
|---|---|---|
| `tests/agent-driven/integration/helpers/cache-custodian-unit.py` | **纯单元门**：stdlib `unittest` + 显式绝对路径 import custodian；mock 内核/stdio/clock/selector 边界；**无 fork/setsid/wait/signal/prctl/外部进程/用户 env 读取** | `0da98fd7f203dc675880aae1d4012f34e0acf1241eb119dd61549b4ce3f40343` |

### 修改（均在 allow_existing 内）

| 路径 | 本波改了什么 | sha256 |
|---|---|---|
| `src/adapters/openfilm/cache-process-custodian.py` | 启动链、exec 管道所有权、非阻塞 exec 状态、目标身份表、三态内核查询、`TargetSettlement` 结算顺序、`ControlWriter` 短写与终端预留、事件链 digest、始终结算并发收据 | `71826989cef1bed97e4d0d947fcfd2c2df94a18695db4d4a1081d88ef10cbf22` |
| `src/adapters/openfilm/cache-process-supervisor.ts` | `detached:true`、私有 run 目录与私有 HOME/XDG、`CacheFrameQueue`、`CacheDeadline`、单一 READY 预算、收据严格验证（`validateCacheExecutionReceipt`）、`latchCacheOutcome`、`collectCacheCleanupCauses`、候选可撤销、draw EOF→CANCEL、`#proveExecution` 统一证明 | `1c867100e1ea64ba1ff0f17a97147797a0b9c051a4727237035a2508d8728b4b` |
| `src/adapters/openfilm/cache-production-scope.ts` | 私有 phase lease、`mint` 不再接受调用方 receipt、completion 一次消费即 spent、direct scope 覆盖 parent_drain、owner 绑定 | `9d33a15e3e8273af5dfecd54c466bab575236acf8d20e195c8dee4b7ae7c2e62` |
| `src/adapters/openfilm/openfilm-upstream.ts` | 责任按精确 draw 身份贯穿、scope 传给 supervisor、direct scope 由 bridge 在 drain 后归还、settled 只留有界摘要、责任数组有界、parent 阶段由 bridge 拥有 | `706a7489ee8eb133bd93d4f824f5af9e2d952354d1a43db91fd8e9d6b11f45d9` |
| `src/host/agent-driven/created-native-workspace.ts` | 私有 phase lease 取代手造 receipt、release 以 completion 被消费为前提、未结束阶段保持 root barrier、abort signal 进 scheduler | `7ac2a3333dfee09fe3d9a611de2ceebe5e94bc06a2d8a2daddb35b5d4a1147bd` |
| `src/adapters/openfilm/openfilm-cache-worker.mjs` | 入向未消费字节有界（无 waiter 也不增长） | `0eaf0bd5bf625d36ebe33c700bbcd51fccad895cc06e225a531f490d9e2a8806` |
| `src/adapters/openfilm/cache-worker-integrity.json` | **生成物**：本波第一次**实际**生成（见 §3） | `6489c739841c8897c20641719a5d64e254c20a472ec85753577864c050c27a4a` |
| `tests/agent-driven/integration/cache-process-identity.test.ts` | spawn 局部 mock + 零调用断言、收据验证、锁存、清理原因、队列、截止 | `6ee0fbe5ccc95c6638bd756bcbe8bafe4b741c1c7b7fc8325dfde68b371461c9` |
| `tests/agent-driven/integration/cache-production-scope.test.ts` | phase lease、completion 一次消费、owner 绑定、direct 阶段集 | `e44c1a46c414197fd9ec77590528318fa929c90f7259a6f96710aa7539f5f3c8` |
| `tests/agent-driven/integration/helpers/cache-worker-fixture.mjs` | 全文重写（mode 前置、ticket 摘要、真截断帧、真孙进程、ref timer、事件文件） | `0e854bca9a6d676fe76ffe18284c2fe0500375156dc6335efaa55c3a3bba8d58` |
| `tests/agent-driven/integration/helpers/cache-probe-fixture.mjs` | ref timer（原来 unref+未决 TLA 立刻退出）、每次事件重读身份 | `80388baed7275482ea7c4b7273d43706aa143a532aa47b8e0922c53e3c2720ef` |
| `tests/agent-driven/integration/cache-custodian-lifecycle.test.ts` | 全文重写（零媒体零浏览器、正对照真成功、mode 可观测、finally 收割、UNKNOWN 保留） | `cfb1e9123fa37134f5855ef7a461e68328f5cde7c8ba4b7a5dbfaaf6eebfc14f` |
| `tests/agent-driven/integration/cache-frame-duration-lifetime.test.ts` | 父侧事件顺序、finally 收割、helper 明确不是 ffprobe | `9448123441af711462d8549f4affd51c81243d0031be99f7a4df6a7fb4773281` |
| `tests/agent-driven/integration/cache-process-settlement.test.ts` | 分 lane（非浏览器 P2a / 浏览器 P2b）、mode 文件、UNKNOWN 保留 | `ddd557cf50e28d1f7893e4edc90d7714e688015b3ec99d223c4002426e07b115` |

### 明确未动（字节未变）

`src/host/agent-driven/created-native-source-reader.ts`（`0a52b8ff…289e`）、`tests/agent-driven/integration/native-cache-witness.test.ts`（`02a7b90f…306c1`）、`tests/m2.1/openfilm-upstream-lock.test.ts`（`9b2cf852…c175a`）、`tests/agent-driven/integration/created-native-source-reader.test.ts`（`6325eab3…d9784`）、`tests/agent-driven/integration/cache-serving-drain.test.ts`（`d9734282…bf1c4d`）、`src/adapters/openfilm/cache-worker-policy.mjs`（`0d2b2b38…b1214`）、`tools/openfilm-cache-worker-integrity.mjs`（`8f59fb59…7d509d0`）。

**静态 fitness 未放宽**：m2.1 lock 整文件本波运行 **60/60 通过**，loader 导出集合、`openFilmServingBridge(owner, producer)` 的参数位置（producer 在 index 1）、Host 调用点枚举均未变。公开 DTO、`EnginePort` 7、`pageFrame`/`close` 签名、`OpenFilmCacheProducerOwner`/`OpenFilmServingOwner` 形状、issued 品牌、正式 render/V/Approved015 **未动**。

**未新增**：其它协议模块、其它测试文件、config、包脚本、依赖、路由、公共 DTO、EnginePort 方法、缓存帧时长 probe 条件源文件（`cache-frame-duration-probe.ts` **仍未写**）。

## 3. 本波执行的命令（全部经统一 recorder，串行）

recorder: `docs/execution/A/implementation-20261111/integration/e1-main-takeover/run-recorded.py`（sha256 `88cd47ec…fd10`，与 release 一致，**未修改**）。前缀 `n1n2-claude-060p1r2-`。运行期间源码冻结；无并行修代码。

### 3.1 十一条许可命令（最终一轮，全部 exit 0，`source_changed=[]`）

| capture | argv | exit | log sha256 |
|---|---|---|---|
| `n1n2-claude-060p1r2-final-tsc-001` | `corepack pnpm exec tsc --noEmit` | 0 | `e3b0c44298fc1c14…` |
| `n1n2-claude-060p1r2-final-syntax-worker-001` | `node --check src/adapters/openfilm/openfilm-cache-worker.mjs` | 0 | `e3b0c44298fc1c14…` |
| `n1n2-claude-060p1r2-final-syntax-policy-001` | `node --check src/adapters/openfilm/cache-worker-policy.mjs` | 0 | `e3b0c44298fc1c14…` |
| `n1n2-claude-060p1r2-final-custodian-syntax-001` | `python3.12 -I -S -B -c "ast.parse(…)"` | 0 | `dd8ee964b960e83e…` |
| `n1n2-claude-060p1r2-final-integrity-check-001` | `node tools/openfilm-cache-worker-integrity.mjs --check` | 0 | `7480083d801311b0…` |
| `n1n2-claude-060p1r2-final-scheduler-001` | `vitest run … cache-production-scope.test.ts` | 0 | `d9a34a04b0bb070e…` |
| `n1n2-claude-060p1r2-final-identity-001` | `vitest run … cache-process-identity.test.ts` | 0 | `08318c3fd42284d1…` |
| `n1n2-claude-060p1r2-final-m21-lock-001` | `vitest run … tests/m2.1/openfilm-upstream-lock.test.ts` | 0 | `4936318ad49ff10c…` |
| `n1n2-claude-060p1r2-final-syntax-worker-fixture-001` | `node --check tests/…/cache-worker-fixture.mjs` | 0 | `e3b0c44298fc1c14…` |
| `n1n2-claude-060p1r2-final-syntax-probe-fixture-001` | `node --check tests/…/cache-probe-fixture.mjs` | 0 | `e3b0c44298fc1c14…` |
| `n1n2-claude-060p1r2-final-custodian-unit-001` | `python3.12 -I -S -B tests/…/cache-custodian-unit.py` | 0 | `9436669d041fd992…` |

内容：`tsc` exit 0；`cache-production-scope.test.ts` **13/13**；`cache-process-identity.test.ts` **44/44**；`openfilm-upstream-lock.test.ts` **60/60**；`cache-custodian-unit.py` **28/28**（`Ran 28 tests … OK`）；custodian `ast.parse` 输出 `CUSTODIAN_SYNTAX_OK`；integrity `--check` 输出 `{"ok":true,…}`。

### 3.2 许可的生成（第一次**实际**生成）

| capture | argv | exit | source_changed | log sha256 |
|---|---|---|---|---|
| `n1n2-claude-060p1r2-generate-001` | `node tools/openfilm-cache-worker-integrity.mjs --generate` | 0 | **`["src/adapters/openfilm/cache-worker-integrity.json"]`** | `958825c41d7e482d…` |

产物 sha256 `6489c739…c27a4a`。这一份捕获**记录到了真实的 source_changed**（唯一被改的路径就是那个 JSON），与上一波 `060p1r-generate-001`（同字节重复、`source_changed=[]`）**不同**——上一波的说法已被本波更正，见 §9。

### 3.3 本波的全部失败（保留，未删）

| capture | argv | exit | 失败内容 |
|---|---|---|---|
| `n1n2-claude-060p1r2-typecheck-001` | `corepack pnpm exec tsc --noEmit` | **2** | 7 条类型错误：`cache-production-scope.ts` 的 `ScopeFacts` 无 `root` 字段；`openfilm-upstream.ts` 的 `current` 可能是 `undefined`（`lastProductionResponsibility` 返回 `\| undefined`，而代码按 `null` 判空）。**已修**（`:559` 改用 `scope.root`；`:1657` 改为 `?? null`） |
| `n1n2-claude-060p1r2-custodian-unit-001` | `python3.12 -I -S -B tests/…/cache-custodian-unit.py` | **1** | `test_a_short_write_keeps_the_tail_of_the_frame`：`AssertionError: 0 != 3`。原因是**测试的假写入器每次都写满**，第一轮 `flush()` 就把整帧写完了，因此看不到"中间态"。**已修**（假写入器改为：第一次短写 7 字节、第二次 EAGAIN、第三次写完），生产代码未改。 |
| `n1n2-claude-060p1r2-scheduler-001` | `vitest run … cache-production-scope.test.ts` | **1** | `refuses a phase lease of another owner…`：`expected null not to be null`。原因是**用例**先开了一次 `parent_drain` 租约却没有 settle，第二次开租约按设计返回 null，于是 completion 永远 mint 不了。**已修**（用例改为持有并 settle 同一份租约），生产代码未改。 |

这三次失败**都在 recorder 之后**，都在原处保留，未覆盖、未删除。

### 3.4 本波**未**经 recorder 的一次运行（如实承认）

在第一次记录 `n1n2-claude-060p1r2-syntax-worker-fixture-001` 之前，我**在 recorder 之外**先跑了一次 `node --check tests/agent-driven/integration/helpers/cache-worker-fixture.mjs`（exit 0，无输出）。这是本波唯一一次**先跑确认再记录**，与本票"不在 recorder 前先跑确认"的要求**不符**。那次运行的 argv 就是上面那条允许命令，产物与之后的捕获一致，**没有产生任何其它副作用**；但它**没有被 recorder 记录**，因此按规则记为 **UNRECORDED**。本波其余全部开发运行都先经 recorder。

### 3.5 **没有运行**（本票明令禁止）

真实 custodian / prctl / fork / setsid / waitid-waitpid / signal / 故障 child、任何真实子进程故障注入、HTTP/Host/Chrome/ffmpeg/ffprobe/媒体、fullcheck/build/Python golden、`cache-frame-duration-probe.ts`（条件源文件**未写**）、`cache-custodian-lifecycle.test.ts` / `cache-process-settlement.test.ts` / `cache-frame-duration-lifetime.test.ts` / `cache-serving-drain.test.ts` / `native-cache-witness.test.ts` / `created-native-source-reader.test.ts`。没有联网/下载/付费/J 盘/凭据/.env/全量 env 读写；没有启动浏览器或用户窗口；**没有 git add/commit/reset/stash/checkout/push/merge**。

## 4. 私有 owner / FD 表与阶段状态流

### 4.1 私有 owner

| owner | 位置 | 责任 | 谁能动它 |
|---|---|---|---|
| `ProductionResponsibility` | `openfilm-upstream.ts:401` | 一次 draw 的登记（首个 await 之前）：scope / supervisor / handle / controller / 两个 phase lease / outcome 摘要 / settled promise | 只有签发它的 producer owner 与**持有它的那个 bridge** |
| `CacheProductionPhaseLease` | `cache-production-scope.ts:149` | 一个阶段的私有凭证；`settle()` 一次 | 只有 scope 的 owner 持有的那一份 |
| `CacheProductionCompletion` | `cache-production-scope.ts:184` | 一次生产的完成凭证（scope/generation/root/outcome/receipts/owner） | `completeCacheProductionScope`，**一次** |
| `CacheDrawHandle` | `cache-process-supervisor.ts:121` | 一次 draw 的不透明把手（issuer 绑定） | 只有签发它的 supervisor |
| `CacheDrawFacts` | `cache-process-supervisor.ts:~800` | draw 的私有事实（receipt / forked / authorizeSent / exit / recorded 身份 / run dir） | 只有本模块 |

### 4.2 FD/EOF 责任表（本波修订后）

| 进程 | 端点 | 责任 | 实现位置 |
|---|---|---|---|
| Host | C 的 stdout/stderr 两 pipe | 各自有界（64KiB），超限**当场**锁存失败 | supervisor `#run` 的 `onStdout`/`onStderr` |
| Host | 绘制双工 socket 父端（C 的子端为 fd3） | Host 与 N 各单 writer；**draw EOF 当场**向 C 发 CANCEL | supervisor `onDrawEnd` |
| Host | 控制双工 socket 父端（C 端为 fd4） | Host/C 独占方向；C 本地观测控制 EOF 即进入私有取消 | supervisor `#requestCustodianCancel`、custodian `_read_control` |
| C | fd3 绘制子端 | **只为 fork/exec 交给 N，随后父进程关闭自己的副本** | custodian `parent_close_set`（含 `DRAW_FD`） |
| C | fd4 控制端、selector/wakeup、exec-status | 仅 C 持有；N exec 前必须关闭（`descriptors_to_close`）；exec-status CLOEXEC 且**父进程立刻关掉写端** | custodian `_spawn_worker`、`_setup` |
| C/N | N 的 0/1/2/3 | N fd3 = 绘制端；N 关闭一切 >3（**exec 写端除外**） | custodian `_spawn_worker` |
| Chrome 后代 | Playwright 自身管道 | 其 fd3/4 属于 CDP，**不得**是 Host 控制/ticket socket；实证按 inode/端点 | **P2a 待实证** |

### 4.3 阶段状态流（一条 draw）

```
Host: reserve → [scope] → spawn(detached) → C_HELLO → AUTHORIZE_FORK
      → FORKED(exec) → N_HELLO → GO → result → picture(候选) → FINALIZE
      → DOMAIN_REAPED → C exit 0 + close → 严格证明 → 结算
C:    setup → 完整性 → 自身身份(必须是自己的 session/group) → prctl 核验
      → C_HELLO → 授权 → fork → exec 状态(非阻塞) → FORKED
      → 循环(取消/EOF/洪水/截止) → 结算(TargetSettlement) → DOMAIN_REAPED → exit
scope: acquire(owner) → phase lease × N → 逐阶段 settle → mint → consume → release
      （任何阶段未 settle ⇒ mint 为 null ⇒ 不 release ⇒ 根保持 held）
```

## 5. 本波**未**做（NOT_RUN 清单，逐项）

| 项 | 状态 |
|---|---|
| 真实 C 启动 / prctl GET 回读 / detached 的 sid/pgid | **NOT_RUN** |
| 真实 exec 成功 / exec 失败（真实 errno）/ 子进程卡在 exec 前 | **NOT_RUN** |
| 真实 waitid(WNOWAIT) 锚 / 延迟收养 / 真孙进程忽略 TERM / 组 KILL / Z 全回收 | **NOT_RUN** |
| 真实背压下的控制通道 transcript / 终端预留 / draw EOF → CANCEL | **NOT_RUN** |
| 真实洪水（合法小帧连发、pre/post 候选洪水、TERM-ignore 洪水） | **NOT_RUN** |
| 真实 HTTP/Host/Chrome/ffmpeg/ffprobe/媒体 | **NOT_RUN** |
| `cache-custodian-lifecycle.test.ts` / `cache-process-settlement.test.ts` / `cache-frame-duration-lifetime.test.ts` / `cache-serving-drain.test.ts` | **NOT_RUN**（P2a 授权后） |
| `native-cache-witness.test.ts` / `created-native-source-reader.test.ts` | **NOT_RUN**（P2a/P2b） |
| fullcheck / build / Python golden / 全量门 / 独立外审 | **NOT_RUN** |
| 原 17 与 ISO-01..18 的整体验收 | **NOT_RUN / 未整体验收** |

## 6. 剩余风险（真实）

1. **custodian 是第一次被真正运行**。本波只做了静态与纯单元证明：事件循环、`waitid(WNOWAIT)` 锚、精确 `waitpid`、ECHILD、组 ESRCH 判定、exec 管道的所有权、事件链 digest，**全部没有跑过内核**。P2a 是它第一次真正运行。
2. **`PR_SET_CHILD_SUBREAPER` 的真实内核能力仍未证明**。本波修的是**调用形状**（指针 + `c_int` 存储），不是内核能力。custodian 在 fork 前核验并在失败时**不 fork**，因此若本机内核不支持，整条 draw 会以 `PRCTL_UNAVAILABLE` 失败而不是悄悄退化。
3. **detached 只被静态证明**。Host 以 `detached:true` spawn，C 断言自己是自己的 session/group 组长——两侧都写了，但**没有一起跑过**。若 Node 的 detached 语义与本假设不同，C 会以 `CUSTODIAN_NOT_ISOLATED` **明确失败**（不是悄悄退化），但那会让**每一条 draw 都失败**。
4. **收据协议是本波新加的**，Host 与 C 两侧同时改。两侧的字段名、seq 语义、事件 digest 口径必须**逐字一致**；一处写错就是"永远拿不到有效收据"，即**每一条 draw 都失败**。这是本波最大的**耦合风险**，P2a 的第一条命令就必须先证它。
5. **目标身份表的增长**：每次结算都会把 N 的组成员与被收养后代记进表；上限 512，**超出即失败**（不再增长）。一个真的很大的浏览器树可能撞上限 → outcome=unknown → 保持 barrier。这是刻意的保守。
6. **phase lease 的粒度**是"阶段"级而非"步骤"级：一次 draw 的 execution 阶段里若还藏着别的资源（不止浏览器），它们不在 lease 的粒度里。**IR05/IR07 的责任链已按精确 draw 身份贯穿**，但"一个阶段里到底还有谁"仍靠各阶段自己的代码回答。
7. **私有 run 目录**在 Host 的 tmpdir 下；UNKNOWN 时**保留**，若长期积累会留下目录。inspection 暴露了路径，但**没有自动清理**，这是刻意的（自动清理会删掉还在被使用的目录）。
8. **helper 的场景文件**（`cache-worker-fixture.scenario` / `.events`）是 pilot 的运行时产物，位于 helpers 目录。**并发跑两个 pilot 会互相踩**；用例是串行的，且 finally 会删除它们，但这是 P2a 必须知道的事实。
9. **本波没有跑任何真实进程**：worker、custodian、Chrome、ffprobe、Host 全部 NOT_RUN。所有关于"真的会这样"的陈述都是代码级论证。
10. **既有真实回归未跑**：`native-cache-witness.test.ts`（含真实浏览器）与 `created-native-source-reader.test.ts`（含 K04-c 的真实固定 draw）本波**都没运行**。

## 7. 下一波（P2a）精确建议（**本波不执行**）

### 7.1 命令（同一 recorder、唯一前缀 `n1n2-claude-060p1r2-p2a-*`、串行、**一个重型槽**）

```
# 1) 非浏览器 pilot：detached 的 C / prctl 回读 / exec 管道 / WNOWAIT 锚 /
#    TERM-ignore 孙进程 / 延迟收养 / 组 KILL / Z 全回收 / C close
corepack pnpm exec vitest run --config vitest.config.ts \
  tests/agent-driven/integration/cache-custodian-lifecycle.test.ts

# 2) 结算：收据逐字匹配、held → reconcile 恰好一次、scope 保持
corepack pnpm exec vitest run --config vitest.config.ts \
  tests/agent-driven/integration/cache-process-settlement.test.ts

# 3) 父 drain 与准入冻结（真实 loopback + 真实源流）
corepack pnpm exec vitest run --config vitest.config.ts \
  tests/agent-driven/integration/cache-serving-drain.test.ts

# 4) Q2 决定性事件 pilot（真实 child、父侧 error/exit/close/callback 顺序）
corepack pnpm exec vitest run --config vitest.config.ts \
  tests/agent-driven/integration/cache-frame-duration-lifetime.test.ts

# 5) 受影响的既有真实回归（**非浏览器部分**）
corepack pnpm exec vitest run --config vitest.config.ts \
  tests/agent-driven/integration/created-native-source-reader.test.ts
```

**Chrome / 真实浏览器帧 / poster / 组继承 / 整组退出（P2b）不在本清单内**：`cache-process-settlement.test.ts` 的 BROWSER lane 与 `native-cache-witness.test.ts` 属于 P2b，不得并入 non-browser 授权。

### 7.2 fixtures（**已在本票写好，P2a 直接用**）

- `tests/agent-driven/integration/helpers/cache-worker-fixture.mjs`：mode 由**场景文件**在 HELLO 之前确定（normal / half-jpeg / flood / ignore-term / ignore-term-adopted / late-launch / foreign-hello / silent）；事件写入**事件文件**，pilot 可验证"mode 真的被触达"。
- `tests/agent-driven/integration/helpers/cache-probe-fixture.mjs`：normal / close-stdio-live / ignore-term，**ref timer**，每次事件重读身份。
- **P2a 仍需具名的新 fixture**（本票未写，需 MAIN 释放路径）：一个**真实 ffprobe 媒体夹具**（固定 argv、真实本地媒体、20 秒基线）。

### 7.3 P2a 每条必须产出的证据

真实 C/N 的 `(pid, startticks, pgid, sid)`；**C 的 sid==pgid==pid 且 ppid==Host**（detached 真的成立）；C 的 `PR_SET/PR_GET` 实际返回值；C_HELLO/FORKED/DOMAIN_REAPED 的 **seq 连续**；**收据逐字匹配**（协议/draw/ticket/seq/outcome/ECHILD/组/身份/**事件链 digest**）；`waitid(WNOWAIT)` 观察与**最后一次 `waitpid(N)`** 的先后；组 TERM 无效 → 组 KILL → 组空；**含 Z** 的每个 known(pid,startticks) 消失；Host 观测到 C 真实 close/reap 与 **exit code 0**；draw EOF → 取消的即时性；背压下的**完整 transcript**；父 HTTP/源流排空时刻；PRE 释放一次；scope 回到 idle；held → reconcile 恰好一次；候选与最终 witness 事实。**不得**用 elapsed 或计数代替。

### 7.4 资源清理步骤（每条 pilot 结束前）

1. **先登记 owner**：每个 helper/child 一创建就登记其 `(pid, startticks, pgid, sid)`，测试自己持有精确句柄。
2. **所有 expect/timeout/错误都在 `finally`** 里处置：TERM → 有界等待 → KILL → **等真实 close**；不留孤儿。
3. **UNKNOWN 保留目录**：不 `afterEach` 无脑 `rm`；本波已把三个 pilot 文件改成"只有结算了才删、否则保留并抛错"。
4. custodian 由 Host reap；任何 C 意外死亡按**保全分支**处理并**如实记录**，不伪造收据。
5. 浏览器/CDP 只在 P2b 出现，且必须落在 N 组内，由 custodian 的组信号收尾。

### 7.5 给 MAIN 的三个问题

- **Q1（§6.4）**：收据协议是本波两侧同时新加的。是否同意 P2a 的**第一条命令**只做"收据逐字匹配"的最小 pilot（不碰 TERM-ignore），以便把协议耦合风险与结算逻辑风险分开？
- **Q2（§6.3）**：`detached:true` 的语义若与本波假设不符，custodian 会以 `CUSTODIAN_NOT_ISOLATED` **全部失败**。MAIN 是否接受"先用一个只验证 C 身份的命令"来确认它？
- **Q3（§6.8）**：helper 的场景文件在 helpers 目录，**并发 pilot 会互相踩**。P2a 是否接受"串行 + 每个 pilot 前后由测试自己写删"作为唯一约束？

## 8. 交还

唯一 writer 权与重型槽在本报告完成后交还 MAIN。本波**不**继续实现：下一步是 MAIN 复核新字节并**独立静态复验**，通过后才发 P2a 真实无浏览器 pilot 票。A057-04 **未**关闭；N1N2 / NativeAck / Studio / A 片 / V1 **不可用**；原 17 与 ISO-01..18 的真实整体验收未通过。

## 9. 证据缺口与历史更正（详见同 prefix 的 `n1n2-claude-060p1r2-evidence-gap.md`）

- **旧 P1 的 2 次开发期失败**：**UNRECORDED / UNKNOWN**（原命令、exit、日志、inputs 均未留存，**不补造**）。
- **上一波 P1R 的 2 次开发期失败**：**同样 UNRECORDED / UNKNOWN**（整合审查已指出，本波搜索后仍找不到原 cmd/exit/log/inputs；**不补造**）。
- **本波 3 次失败**：全部**已记录**（§3.3），原处保留。
- **本波 1 次未记录运行**：§3.4，如实承认。
- **更正 IR10**：旧 identity 轻量门**真的启动过失败路径的解释器**（`/usr/bin/python3.12 -I -S -B /nonexistent/custodian.py`）；目标 custodian 与 prctl **没有**运行，child PID/close **未记录**。旧报告"零真实进程"**不实**，**不补造** PID 或 close。
- **更正 generation 说法**：上一波 `060p1r-generate-001` 是**同字节重复**（`source_changed=[]`）；本波 `060p1r2-generate-001` 是这些字节的**第一次实际生成**，`source_changed` 恰好只有那一个 JSON。
