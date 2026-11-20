# n1n2-claude-060p6 — R6 私有协议与资源结束契约（C06/C07/C08 单批实施）

本文件是 R6（`MAIN_R6_C06_C08_CONSOLIDATED_SOURCE_AND_PURE`，SPEC sha256
`072f69fd63d63ca002b739be879730b1fd09e7d10238eabbcabf3b87ef4e95da`，正式合同 sha256
`493f86e334b25a4d2fa240b2248f485c910f379747b9c7e1e91ec4b82f124319`）的 OWN 报告。

**ACK**：本票已取得文档 `PLAN_READY`（`contract-review-round2/REVIEW.md`，msg `c517183de1e3`），
MAIN 正式释放原八路径与六项 FIRST 纯验证；本轮是**唯一 writer**，继续 R5F 的 dirty 字节，
**没有** reset/stash/Git 变更，**没有**新建源码文件，**没有**运行真实 C/N、混合 kernel lifecycle、
Host/媒体/Q2/full/build ✓。

**调用图（本轮实际改动的链路）**

```
Host（cache-process-supervisor.ts）
  cacheInterpretControlMessage ──► RECEIPT_SEGMENT/DOMAIN_REAPED：版本2、段序、summary唯一性
  CacheReceiptAccumulator.take   ──► 严格 wire type（index/count/pid 不再 Number() 宽松化）
  validateCacheDomainReceipt    ──► 版本门 + proof_kind 判别 + startup_kind 判别
  validateCacheFailedTerminalReceipt（新增）──► failed-terminal 证书的全部必需事实
  validateCacheExecutionReceipt ──► failed-terminal 永不交付结果；creative_eligible 必需
C（cache-process-custodian.py）
  _run_loop            ──► 每条消息单独检查 authorization_state（unbound→sealed→terminated）
  _authorize_fork      ──► 封存绑定 + 消耗唯一 attempt（先于 FD 分配与 fork）
  _spawn_worker/child  ──► 结构化 setup 记录（setsid/stdio/exec + session_established）
  OwnedStreamLedger    ──► 全寿命 stream 事实（bytes/tail/eof/read_error/disposition/ownership）
  _reap_*_/_echild     ──► 统一 wait ordinal、N 专用 terminal 槽、ECHILD-after-wait ordinal
  _send_receipt        ──► receipt_version 2 + proof_kind + creative_eligible + startup 事实
                          + failed_terminal 证书（有限失败终局证书）
```

## 0. 边界（如实声明）

- **只**执行了 `RELEASE.json` 的六种 recorder 命令形态，全部经**未改**的
  `run-recorded.py`（sha256 `88cd47ec…`），capture 前缀 `n1n2-claude-060p6-`；
  **没有** timeout 包裹 recorder、**没有**造 PID/exit、**没有**覆盖任何旧 capture ✓。
- **没有**执行真实 C/N、产品 CLI、混合 kernel lifecycle 套件、Host/Chrome/media/网络/费用/J盘、
  Q2/full/build ✓；**没有**读改凭据/CLI 配置 ✓。
- 原 pure guards **没有**弱化 ✓；R5F 的已闭环语义（发布-v2 联合 checker、全行 hash、原始 group 证明、
  取消主因、替代 PID 保护）**没有**退化 ✓。
- 保护七文件（含 **C09 的受保护 helper fixture**）**逐项 MATCH** ✓ ⇒ fixture 未改 ✓。
- 本报告**只是内部自验证**：**不**自签独立复审、**不**签真实 N、N1N2、R6/R7/R8、原 17+ISO18、
  冻结审查、NEXT 或 V1 ✓。

## 1. 逐 finding → producer → actual consumer → 测试 → 捕获

| 合同行 | producer（C 或 Host） | actual consumer | 测试（本轮新增/改写） | 捕获 |
|---|---|---|---|---|
| **C06-BIND**（foreign protocol/version/draw/ticket → 拒绝） | C：`RECEIPT_VERSION=2` 落在**每个** `RECEIPT_SEGMENT` 与 `DOMAIN_REAPED` 上（`_send_receipt`）；Host：`validateCacheDomainReceipt` 的版本门 + `cacheInterpretControlMessage` 的**段**版本门（无 v1 fallback） | 同一个 `verifyPublishedRun`（R5F 的唯一 checker）与 legacy 薄调用 | identity：`refuses a receipt that does not carry the version`、`refuses a segment that does not carry the version`、`refuses a receipt of another draw, another request or another protocol`（+3） | `…-final2-identity`（exit 0） |
| **C06-ONESHOT**（AUTH,AUTH / CANCEL,AUTH / AUTH,CANCEL → 至多 1/0/1 attempt） | C：`authorization_state`（unbound/sealed/terminated）+ `fork_attempt_consumed`；`_authorize_fork` **先封存绑定并消耗 attempt**、**后**分配 FD/fork；`_run_loop` 对**每条消息**单独检查状态，重复/终止后的 AUTHORIZE 只锁存协议失败 | C 自己的 `_run_loop`（实际入口） | python：`test_two_authorisations_fork_at_most_once`、`test_a_cancel_before_the_authorisation_forks_nothing`、`test_an_authorisation_before_the_cancel_forks_once`、`test_a_refused_authorisation_keeps_the_original_binding`、`test_a_fork_that_fails_keeps_the_attempt_consumed`（+5） | `…-final2-python`（exit 0） |
| **C06-ORDER**（重复/跳段/超 count/终局后段/重复 summary/非严格类型） | Host：accumulator 的 `index`/`count`/`pid` 改为**严格 wire type**（不再 `Number()`）；`cacheInterpretControlMessage` 拒绝**终局后的段**与**第二个 summary** | 同上 | identity：`refuses a segment whose order is not a NUMBER`、`refuses a segment after the summary, and a second summary`（+2） | `…-final2-identity` |
| **C06-WAIT / C06-EPOCH**（错 N/缺 N/重复 N/非 terminal status） | Host：`validateCacheDomainReceipt` 的**专属 terminal wait** 门（`exited`/`signaled` 才算终局）**未退化**；accumulator 的「同一 identity 两次」拒绝**未退化** | 同上 | identity 的既有用例（`the receipt carries no wait at all`、`refuses the same identity twice`）**保留** ✓；**本轮没有**新增 epoch/adoption 语义用例（见 §5） | `…-final2-identity` |
| **C06-EXEC**（启动分支与必需字段） | C：`startup_kind` 四分支（`custodian-unauthed`/`authorized-fork-failed`/`forked-setup-failed`/`forked-exec-succeeded`）+ `fork_attempt_state`/`fork_errno`/`forked_pid`/`worker_epoch`/`worker_wait`/`last_actual_wait_ordinal`/`echild_after_wait_ordinal`/`group_disposition`；child 的**结构化 setup 记录**（stage/errno/session_established）；Host：startup_kind 判别 + 每分支必需字段 | 同上 | python：`TheExecPipe` 改写为结构化 setup（EOF+marker 才算成功、stage 区分同 errno 的 setsid/exec、坏记录=unknown、≤2 记录）+ `test_a_fork_that_fails_keeps_the_attempt_consumed`；identity：`refuses a receipt that does not name a kind of proof` | `…-final2-python`、`…-final2-identity` |
| **C07-EOF**（短读/EAGAIN/read0/repeated EOF） | C：`OwnedStreamLedger`（ownership/bytes/tail_bytes/eof/read_error/disposition）；`_drain_worker_streams` 中 **EAGAIN 不是 EOF**、**read0 才是 EOF 且只记一次**、读错记 `read-failed-and-reader-closed` | C 自己的 drain（实际入口）+ receipt 的 `stream_disposition` | python：`test_the_end_of_the_file_is_registered_once`、`test_a_stream_that_was_never_opened_is_not_an_end_of_the_file`（+2） | `…-final2-python` |
| **C07-EIO**（读错不冒 EOF） | 同上（`mark_read_error` 保留错误、`diagnostics_lost` 置真、**不**改原失败） | 同上 | python：`test_a_read_that_fails_is_NOT_the_end_of_the_file`（+1） | `…-final2-python` |
| **C07-CHANNEL**（candidate 后的 draw/control/child error） | Host 的既有通道错误门**未退化** ✓ | 同上 | identity 的既有用例**保留** ✓ | `…-final2-identity` |
| **C08-END**（真实 settle/recover → 失败证书 → 实际 domain/eligibility） | C：`_resource_proof_complete`（真的 ok、无失败、无 overflow、subreaper 已核准、N-last、ECHILD 在其后、group gone、保留 epoch 全 gone、stream 干净）⇒ `proof_kind=complete-v2`；否则 `failed-terminal-v1` + `creative_eligible=false` + `failure` + `failed_terminal` 证书 | Host：`validateCacheFailedTerminalReceipt`（证书的全部必需事实）+ `validateCacheExecutionReceipt`（failed-terminal 永不交付结果） | identity：`accepts the FAILED TERMINAL proof of the resources, and NEVER a result`、`refuses a failed terminal proof whose wait never arrived`（+2） | `…-final2-identity` |
| **C08-HOLD**（unknown/live/Z/group EPERM/失 root/subreaper 未确认/N 未 wait 不得放行） | C 的 `resource_proof_complete` 与 Host 的证书门（`retained_epochs_gone`/`original_group_state`/`subreaper_before_fork`/`sole_wait_owner`/`no_new_fork_after_termination`/`worker_wait_was_last`/`post_worker_echild`/`echild_after_wait_ordinal` 全部必需且必须为真） | 同上 | identity：`refuses a failed terminal proof that is forged`（**17 个变体** × 1）（+1） | `…-final2-identity` |
| **C08-FORGE**（缺 required 对象/true 冒充/错绑定/错 digest/creative_eligible 缺失或错型） | Host 的三个门（`creative_eligible` 必须为 `false`、`failure` 必须非空、`failed_terminal` 必须是合法对象且其事实为真） | 同上 | identity：`refuses a complete receipt that does not claim the creative result`、`refuses a failed terminal proof that is forged`（+2） | `…-final2-identity` |
| **C08-OVERFLOW / C08-LATEWAIT** | 既有 256 events / 512 identities 预算与 N 专用槽**未退化** ✓；本轮新增的 `post_worker_wait_count`/`worker_wait_was_last` 事实 | 同上 | identity 的既有预算用例**保留** ✓；**本轮没有**新增 late-wait 直接用例（见 §5） | `…-final2-identity` |
| **R5-REG**（旧 cause/未知升级/禁止复用 PID/无 root/publication 全部 mandatory keys） | R5F 的实现**逐字节未动** ✓（`tools/native-cache-normal-pilot.ts` 未改） | 同一个 `verifyPublishedRun` | pilot 的既有 **264** 例**全部保留** ✓ | `…-final2-pilot`（exit 0） |
| **C09-PLAN** | **NOT_RELEASED / NOT_RUN**：受保护 fixture **未改** ✓（sha256 `e3f4ccb1…` MATCH ✓）；真实 adoption/TERM-survival 链**未跑** | — | — | 无捕获 |

### 1.1 红灯（旧逻辑的安全 mutant）

`n1n2-claude-060p6-red-mutant-identity`（exit 1，**4 failed / 93 passed**）与
`n1n2-claude-060p6-red-mutant-python`（exit 1，**2 errors**）：把本轮的门在**其辅助函数层**中和
（receipt 的版本门、`creative_eligible` 门、`validateCacheFailedTerminalReceipt` 的整体、
accumulator 的宽松 `Number()`、C 的**每条消息**授权检查），**字节链、全行 hash、发布与报告门保持原样**。
失败的正是本轮新增的反例：版本缺失、creative 缺失、伪造证书、严格 wire type，以及
AUTH,AUTH 与 CANCEL,AUTH 的 attempt 数 ✓。

**准确表述**：这是**行为 mutant**（辅助函数/门的中性化），**不是**存档 R5F tool 的逐字节重放 ✓；
它只说明**该 mutant 让这些断言失败** ✓。跑完后两个源文件**按 sha256 逐字节还原** ✓（无 RED LIGHT 标记残留 ✓）。

## 2. 最终八文件 hash

| 路径 | sha256 | 与 R6 `start_sha256` |
|---|---|---|
| `src/adapters/openfilm/cache-process-supervisor.ts` | `3396945546985a334bd99520c97d403eb853fdd0c4a01ff4359b4ac97d414eed` | **已变**（版本门、proof/startup 判别、failed-terminal 证书门、严格 wire type、段序/summary 唯一性） |
| `src/adapters/openfilm/cache-process-custodian.py` | `d7eee942d3fb2acf1db12bca4ce32568e3038a1ef03e3efebed222eda6dd55c4` | **已变**（单调授权、setup stage、stream ledger、wait ordinal、receipt v2 与失败证书） |
| `src/adapters/openfilm/cache-worker-integrity.json` | `dc68cb3d4417c065d83c0564e7bbf38e315be54d8afb32afd2b98eb6a268959f` | **已变**（`--generate` 重生，只改这一个文件 ✓） |
| `tests/agent-driven/integration/cache-process-identity.test.ts` | `8aef2bd65a87fa99f69f1286b415dd582a748f488ec1e6c79df7eaad7aa11a74` | **已变**（+10 例） |
| `tests/agent-driven/integration/helpers/cache-custodian-unit.py` | `ec3baa5ff292b3f7b14f31fdcd8e05b60a5f15a6bf82dd24eb55c8727b6dd63b` | **已变**（+8 例，exec pipe 改写） |
| `tests/agent-driven/integration/cache-custodian-lifecycle.test.ts` | `0599c27158ad52f29c26ae9d2697d5c4b3bbb30f96161ccdc94ac5742ef0b985` | **已变**（custodian pin 随 R6 的字节更新 ✓） |
| `tools/native-cache-normal-pilot.ts` | `e4db3499f715d5b6b5634568677a6688cf80a897c9321c45e93cda98c6a19ebb` | **逐字节未变** ✓（R5F 的 checker 已静态正确，本轮**没有**为迁就错 label 改生产 ✓） |
| `tests/agent-driven/integration/native-cache-normal-pilot.test.ts` | `8ebecbfbcca0fe722c88215804c5d9b544df4d0042ac311a1a99ade046bc1f4e` | **已变**（fake custodian 说 v2 ✓、custodian pin 更新 ✓） |

**保护七文件**：逐项实测**全部 MATCH** ✓（含 C09 的受保护 fixture ✓）。

## 3. 最终捕获（同一最终输入，`source_changed` 全部为 `[]`，651 个输入文件零漂移）

| capture | 命令 | exit | log sha256 |
|---|---|---|---|
| `n1n2-claude-060p6-final2-integrity-generate` | `node tools/openfilm-cache-worker-integrity.mjs --generate` | **0** | `542cd98985745dace76dc3a207d5061d387ff4220086b92555f5856cd3b94adb` |
| `n1n2-claude-060p6-final2-tsc` | `corepack pnpm exec tsc --noEmit` | **0** | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `n1n2-claude-060p6-final2-identity` | `corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/cache-process-identity.test.ts` | **0** | `c5b6ad22ab06dc0726b6a3929be24c71f9d59ce66c51bfc3aa900e053459b536` |
| `n1n2-claude-060p6-final2-python` | `/usr/bin/python3.12 -I -S -B tests/agent-driven/integration/helpers/cache-custodian-unit.py` | **0** | `0f8b52398f410cd7f4e827c8af22f2d511a38cd750ec09f429376a9abd7d6617` |
| `n1n2-claude-060p6-final2-pilot` | `corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/native-cache-normal-pilot.test.ts` | **0** | `33db12882af7c9f8283b1ce4f16910eeaec677ae7b1584947aee5e05d5327674` |
| `n1n2-claude-060p6-final2-integrity-check` | `node tools/openfilm-cache-worker-integrity.mjs --check` | **0** | `7480083d801311b007ec2f2a6c4717621f8aed33de5e17dd7ba35815b0d68e68` |

测试规模：identity **97 passed**（87 → 97）、python **69 passed**（61 → 69）、pilot **264 passed**（未变）✓。

## 4. 失败索引（全部保留，未覆盖、未补造）

| capture | exit | 含义 |
|---|---|---|
| `…-tsc-001` | 2 | outcome 的 `diagnosticSnapshot` 字段加入后，快照局部类型未收窄 → 已改类型守卫 ✓ |
| `…-tsc-002` / `…-tsc-003` | 2 | 同上（latched/provenance 的类型谓词、快照视图类型）✓ |
| `…-tsc-004` … `…-tsc-010` | 2 | 新反例的类型问题（`delete` 的可选性、fixture 的作用域、测试文件的花括号平衡）→ **同批自行修复** ✓ |
| `…-identity-001` … `…-identity-005` | 0/1 | 协议 v2 之后，既有 receipt fixture 必须带 v2 字段 → **协议改动引起的真实失败，已如实改写 fixture** ✓；其中 `…-identity-002`/`-003` 是 fixture 的 `failure` 键重复与 `EVENTS` 作用域的真实错误 ✓ |
| `…-pilot-001` … `…-pilot-004` | 1 | fake custodian 尚未说 v2 ✓ / **custodian 的 pin 过期**（R6 改了 custodian 的字节，pin 未同步 ⇒ 真实失败，已更新 pin）✓ |
| `…-python-001` | 1 | 旧的 `classify_exec_status` 已不存在 → **exec pipe 的真实语义改动**，已改写为结构化 setup ✓ |
| `…-python-002` | 1 | 结构化 setup 的读取顺序（记录与 EOF 分属不同的轮次）→ 已改为有界轮询 ✓ |
| `…-python-003` … `…-python-006` | 0/1 | 本轮新增 C 侧用例的夹具细节（selector 的 key 形状、tail 字段的位置、真实 pipe 的 FD）→ **同批自行修复** ✓ |
| `…-red-mutant-identity` / `…-red-mutant-python` | 1 | **安全红灯**（§1.1）✓ |
| `…-final-*` | 0 | 第一组六命令：generate 改了 manifest（`source_changed` 记录了它 ✓） |
| `…-final2-*` | 0 | **最终六命令**：同一最终输入、零漂移 ✓ |

### 4.1 更早的失败与 INCOMPLETE（原样保留，本轮**没有**触碰）

`n1n2-claude-060p5d-red-python-002`（真实 `os.kill(200,SIGTERM)` 越界；事后 PID 不存在**不能**证明当时无影响）、
`…-060p5d-red-*`、`…-060p5d-fix-pilot-004`（MAIN 的精确停止）、`…-060p5d-fix-pilot-005`（**INCOMPLETE**，
缺 exit/result ✓）、`…-060p5e-*`、`…-060p5f-*`（含 5s 超时）、`…-060p5g-*`（含 20s mock 超时与 mutant 红灯）——
**全部原样保留** ✓。**没有**补造 PID、exit 或日志 ✓。

## 5. 本轮**没有**实现的部分（如实记录，不冒充已完成）

合同与验收计划里的下列条目**本轮未实现**，其 direct case **NOT_RUN**：

| 条目 | 状态 | 原因 |
|---|---|---|
| **C06-EPOCH**（错误 ticks/初始父/伪造收养/同 PID 不同 epoch 的按 epoch 归属） | **NOT_RUN** | 既有 epoch/身份语义**未退化** ✓，但合同 §2 的「按 epoch 语义 map 记录 completion」与**新**的 epoch 归属判定**未实现** |
| **C06-PARENT**（`parent-reaped-observed-gone` 的 completion 分类） | **NOT_RUN** | 合同 §2 要求 i 项**单列**这一 completion；本轮的 C 端**没有**实现该分类，receipt 的 i 项仍是旧语义 |
| **C06-BOUND**（>256 个合法 adopted completion 后 N-last、≤512 身份） | **NOT_RUN** | 既有 256/512 预算**未退化** ✓，但**没有**新增的直接用例 |
| **C06-EXEC 的 Host-only 分支**（no-child / 未 authorize） | **NOT_RUN** | Host 的既有 no-birth/未授权路径**未退化** ✓，但**没有**为它们新增 direct case |
| **C07-LATE**（settle/recover 之后的分路输出、65536/65537） | **NOT_RUN** | 既有 DIAGNOSTIC_BUDGET 路径**未退化** ✓，但**没有**新增的直接用例 |
| **C08-LATEWAIT**（N 之后的意外 wait） | **部分** | 证书带了 `post_worker_wait_count`/`worker_wait_was_last` 的**真实事实** ✓，但**没有**驱动一次真实晚到 wait 的 direct case |
| **§4A 的完整顺序对象**（独立的 `raw_tree_terminal`） | **部分** | 本轮把 raw-tree 的事实放进 `failed_terminal` 证书 ✓，但**没有**独立的对象与独立的阶段编排 |
| **C09** | **NOT_RELEASED / NOT_RUN** | 受保护 fixture 未改 ✓；真实 adoption/TERM-survival 链未跑 ✓ |

这些缺口**不**通过放宽任何谓词或断言来掩盖 ✓；它们需要 MAIN 的下一次合同与 release。

## 6. 已知限制

1. **内部自验证**：不构成独立受影响复审，也不构成真实 N/N1N2/R6/R7/R8/原17+ISO18/冻结/NEXT/V1 的验收 ✓。
2. **混合 lifecycle 文件只 typecheck**：`cache-custodian-lifecycle.test.ts` 的联合判定**未经运行**
   （本票禁止运行它）；可执行覆盖在 pilot 与 identity 套件里 ✓。
3. **checker 不观察外层退出码**：它只验内部协议与真实字节；**实际**退出码由外层 recorder/MAIN 另核 ✓。
4. **mock 终局事实不是内核证明**：stub 的 `proven:true` 是**显式 mock** ✓；生产门**没有**为它放宽 ✓。
5. **纯 mock 的 receipt 是协议形状**：本轮的 v2 receipt 由 fake custodian 产生 ✓，
   真实 custodian 的字节只在**真实 N 票**里验证 ✓（本票**没有**任何真实运行许可 ✓）。
6. **旧 5s/20s mock 超时根因仍未知** ✓：本轮**没有**加预算、**没有**改生产 deadline、
   **没有**改断言求绿 ✓；本轮的所有捕获都没有再出现该超时 ✓，但这**不**等于根因已关闭 ✓。

## 7. 交还 MAIN

- 请对 §2 的**八份精确 SHA**与 §3 的**六条同源捕获**做只读受影响复核；
  本轮的新面是：receipt v2（段与 summary）、proof_kind/creative_eligible、startup_kind 判别、
  failed-terminal 证书与其 Host 门、单调授权与唯一 attempt、结构化 setup stage、
  OwnedStreamLedger、wait ordinal 与 ECHILD-after-wait、严格 wire type 与段序/summary 唯一性 ✓。
- 本轮**没有**新的 429、没有重试/重启/换供应商/Codex 接手；**没有** Git 变更；
  **没有**覆盖任何旧 capture；**没有**碰保护七文件、用户 AGENTS、Approved015 与旧证据 ✓。
- 交还后**冻结字节**接受独立受影响复核；安全通过后由 MAIN 另发**精确 pin 的真实 normal/fault 票**
  （C09 与 overflow/backpressure 的真实链仍另票）✓。
