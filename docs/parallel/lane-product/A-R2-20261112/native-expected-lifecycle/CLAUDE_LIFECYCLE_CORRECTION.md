# Claude 实现报告（第二轮）— 生命周期纠正 + MAIN 授权的陈旧 pin 夹具调和

本文件是本轮**实现者自述**，交父 Codex 只读复核。它不是验收、不是独立外审、不是 NativeAck/A 门结论。第一轮的 `CLAUDE_LIFECYCLE_IMPLEMENT.md` 与 `evidence/RECEIPTS.json` 原样保留，未被改写。

## 0. 本轮实际回执

| 项 | 值 |
| --- | --- |
| 本任务 / dispatch / 终端 | `task_33558cf8e146` / `ctx_537a8d25982b` / `term_ba17ed9fe94dac509ae9844f618da902` |
| 协调者终端 / 消息 | `term_d0da21385daaeb26007c3d57936f2438` / `msg_169de2336cde` |
| MAIN 授权 | `msg_b850663ed8a8`（仅授权“既有拒绝用例改用显式临时 pin”这一处夹具调和） |
| 父任务 / dispatch | `task_61570c14c644` / `ctx_802299266d15`（实现与取证期间只读） |
| 会话自述 | `MiniMax-M3.1-Flash-Preview[1m]`（来自本会话环境块；未读取/改动任何 provider、凭据、配置或模型设置） |

基线 HEAD 仍为 `a809f8d7e53fb90dbd1f56aa956c48c9600d508f`，分支 `agent-driven/a-r1-product`，未 commit、未动索引、未 add、未 reset/stash/push。

## 1. 父复核指出的两个问题与本轮修正

### 1.1 内部清理不得再经过 proof 的公开面

第一轮候选在 `release()` / `close()` 里调用 `proof.markReleased()`。该方法是公开的、属于调用方拥有的对象：调用方可以把它换成会抛异常的函数，或换成会抛异常的取值器。于是一次 `release` 会在**触碰任何描述符之前**抛出，句柄被搁浅、其余 proof 的清理被跳过，而且因为清理根本没跑，`#cleanupUncertain` 也没有被置位——实例仍然可以“变绿”。

本轮修正（`src/host/m5/openfilm-native-expected.ts`，sha256 `1dd35aaa…` → `5184d200…`）：

- `release()` 与 `close()` **不再调用 `proof.markReleased()`**；撤销权威只写模块私有记录 `PROOF_STATUS`（`status.released = true`）、本实例的 `#released`、以及 `HELD_FACTS` 的删除。
- 内部路径**不再触碰 proof 对象的任何成员**（不读 `proof.released`，不调 `proof.markReleased()`）。`assertCurrent` 的权威判据同样来自 `PROOF_STATUS`。
- 可观察行为保持不变：公开的 `proof.released` getter 本来就是模块私有记录的**视图**（`status.released`），所以释放后仍为 `true`；`assertCurrent` 仍抛 `NATIVE_EXPECTED_PROOF_RELEASED`；`markReleased()` 作为公开方法保留原语义（外部调用它只会**撤销**权威，不会凭空取得权威，也不会让句柄泄漏：`release()` 依据本实例自己的 `#released` 记录，仍会执行清理）。
- 清理失败依旧：首个 close 失败不阻止其余 close，全部失败保留，`#cleanupUncertain` 置位并 sticky fail-closed。

### 1.2 签发 proof 前的最后一道状态检查

第一轮候选在 `#projection` 之后只检查 `#closed`。本轮补齐为完整三问：`#closed` → `#cleanupUncertain` → `binding.isCurrent()`（会话状态）。任一不成立即拒绝签发，并释放本次读到的全部描述符（既有 catch 路径）。

## 2. 本轮新增的反例测试（5 条）

全部写在 `tests/agent-driven/integration/created-native-ack.test.ts`（sha256 `a3dd488f…` → `702c16fa…`），用真实文件/真实 fd/受控回调：

| case | 证明什么 |
| --- | --- |
| releases the descriptors even when the proof replaces its own method | 把 `proof.markReleased` 换成抛异常函数后，释放仍然完成：被替换的方法**一次都没被调用**（调用计数为 0），描述符确实关闭，`proof.released` 仍为 true |
| does not let a replaced method hide an uncertain cleanup | 被替换的方法不能掩盖真实的清理失败：报出的是 `NATIVE_EXPECTED_CLEANUP_FAILED`，并且实例进入不确定态 |
| closes every proof even when one proof replaces its own method | **close 跨多个 proof**：一个 proof 的公开面抛异常不得搁浅另一个 proof 的描述符（两次读的全部描述符都被关闭） |
| refuses to issue a proof when the binding stops being current while the projection is computed | **受控回调**：`isCurrent` 前三次为真、第四次为假 → 证明存在“第四次、独立的”签发前检查；投影期间会话失效即拒绝签发并释放描述符 |
| refuses to issue a proof when a cleanup failed while the projection was computed | **受控回调**：投影期间另一个 proof 的清理失败 → 签发前检查拒绝签发，且实例此后一直不确定 |

## 3. 实际命令 / exit / 哈希

cwd 全部为 `/home/administrator/orca/workspaces/Narralens/Narralens-A-R1-PRODUCT`。机器可读回执见 `evidence/RECEIPTS_ROUND2.json`。

### 3.1 陈旧 pin 夹具调和（MAIN 单独授权，**独立于**生命周期 oldfail/fixedpass 对）

MAIN `msg_b850663ed8a8` 只授权：既有拒绝用例改为**自建显式临时 pin**（同样的 `native_expected` 结构，但无 approval），把该确切路径传给 `nativeExpectedApprovalFromPin`，断言**同一条** `NATIVE_EXPECTED_BUILD_NOT_APPROVED`；保留既有的“已批准”正向用例；不得删除/跳过/放宽断言，不得改动真实已批准的 pin / manifest / 哈希。

据此只改了 `the tracked candidate pin > refuses the candidate until a review has approved it` 一条用例（新建临时目录与临时 pin，断言同一条错误码，finally 清理）。真实 pin `src/host/m5/openfilm-studio-ui-pin.json` **未改**，其 `approval: "APPROVED"` 与全部哈希未动；正向用例逐字未动。

### 3.2 取证序列

| # | 类型 | 源码 | 测试字节 | exit | 结果 | 日志 sha256 |
| --- | --- | --- | --- | --- | --- | --- |
| 04 | 陈旧夹具调和（单独授权） | 候选1 `1dd35aaa…` | `f49d2704…`（仅夹具调和） | **0** | 62 passed (62) | `38ef9d35…` |
| 05 | 生命周期 **旧失败** | 候选1 `1dd35aaa…` | `702c16fa…` | 1 | **5 failed / 62 passed (67)** | `a23ab530…` |
| 06 | 生命周期 **修复通过**（同一份测试字节） | 纠正后 `5184d200…` | `702c16fa…`（逐字节相同） | **0** | **67 passed (67) —— 全量目标套件通过** | `d78f44bc…` |
| 07 | 类型检查 | 纠正后 `5184d200…` | — | **0** | 无诊断 | `e3b0c442…`（空） |
| 08 | 最终确认重跑（确认盘上字节未漂移） | 纠正后 `5184d200…` | `702c16fa…`（跑前已核对盘上字节） | **0** | **67 passed (67)** | `a94ad5d2…` |

- 05 与 06 使用**同一份测试文件字节**（`702c16fa…`），只换源码：05 中 5 条新反例全部失败，06 中全部通过。
- 04 与 05/06 是**两类不同取证**：04 只体现 MAIN 授权的夹具调和（候选1 源码即已 62/62 全绿），05/06 才是生命周期 oldfail/fixedpass 对。

### 3.3 前后哈希

| 对象 | 前 | 后 |
| --- | --- | --- |
| `src/host/m5/openfilm-native-expected.ts` | `1dd35aaa…`（候选1） | `5184d200…`（纠正后） |
| `tests/agent-driven/integration/created-native-ack.test.ts` | `a3dd488f…`（候选1） | `702c16fa…`（本轮） |
| 原始基线源码 | `9f9d2c82…`（blob `9a1104fc…`） | 未变，可用 `git show HEAD:…` 原样恢复 |
| 原始基线测试 | `12c3e8b3…`（blob `34b43e0e…`） | 未变 |

跟踪输入（`tools/agent-driven/product/native-inputs/`）六个文件哈希未变，聚合加载器摘要 `c5b53099b2f94fc12b5f9d184c0c8c2b12c51349051eddf67794fb0866e8dfd1`，与被跟踪 pin 的 `inputs_sha256` 一致。

### 3.4 原始日志留存

`*.log` 被 `.gitignore` 忽略，因此每一份被回执引用的原始 `.log` 都按字节复制为同目录的 `.txt`（逐对校验 SHA 相同），`.log` 原件保留。共 9 对（00–08），清单见 `evidence/RECEIPTS_ROUND2.json` 的 `raw_log_copies`。

## 4. 保留与未动

- PREFLIGHT 的 **42 个 protected dirty/untracked 文件哈希全部未变**（脚本复核：checked=42 changed=0）。
- 第一轮的回执、报告、候选1 源码与测试字节原件均保留；第一轮命名的两个 evidence 路径已按第一轮回执**逐字节还原**（`fixed-openfilm-native-expected.ts` = `1dd35aaa…`，`created-native-ack.test.ts` = `a3dd488f…`），本轮产物另存为 `corrected-openfilm-native-expected.ts` 与 `round2-created-native-ack.test.ts`。
- 未提交、未动索引、未切分支、无子 worker、未读写配置/凭据/网络/J 盘。
- 未做 SourcePort、未做 NativeAck 生产接线、未做 native 源码移植。

## 5. NOT_RUN

全量 vitest 套件、Host、监听端口、浏览器、ffmpeg、build、install、网络、下载、付费调用、真实 runtime：**全部未跑**（票面禁止）。本轮只跑了目标文件 `tests/agent-driven/integration/created-native-ack.test.ts`（62 → 67 个用例，纯 FS/fd/promise/内存 SQLite）。`tests/agent-driven/headless/created-native-entry.test.ts` 需真实浏览器与真实服务器，**未跑**。

## 6. 不主张

本文件是实现者自述。**未**取得独立复核，**未**主张 NativeAck 通过、A 轮通过、V1 通过或任何人工验收结论；“全量目标套件通过”仅指本票允许范围内的目标测试文件，**不代表全量套件绿**（全量套件按票面禁止未跑）。父 Codex 需独立读取代码并重跑验收后自行判定。
