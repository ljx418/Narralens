# Claude 实现报告 — NativeExpected 私有生命周期修复

本文件是本票的**实现者自述**，交父 Codex 只读复核。它不是验收、不是独立外审、不是 NativeAck/A 门结论。

## 0. 实际启动回执

| 项 | 值 |
| --- | --- |
| 本任务 / dispatch | `task_7fbdee3fbe6c` / `ctx_ba8ca62faab0` |
| 本终端 / run | `term_3250e75d-1a40-42e9-b158-63ae6604480e` / `run_399f9dd3ce5a` |
| keptOpen / state | `true` / `ready` |
| 协调者终端 | `term_d0da21385daaeb26007c3d57936f2438`（消息 `msg_8b8f3694b8fb`） |
| 父任务 / dispatch | `task_61570c14c644` / `ctx_802299266d15`（实现与取证期间父为只读） |
| 会话自述 | `MiniMax-M3.1-Flash-Preview[1m]`（来自本会话环境块；**未**读取或改动任何 provider/凭据/配置/模型设置） |

基线 HEAD `a809f8d7e53fb90dbd1f56aa956c48c9600d508f`，分支 `agent-driven/a-r1-product`。本票两张目标文件的基线 blob 与 MAIN `de438d17…` 一致（`9a1104fc…` / `34b43e0e…`），已复核。

## 1. 改了什么（只两文件）

### `src/host/m5/openfilm-native-expected.ts`（sha256 `9f9d2c82…` → `1dd35aaa…`）

公开面不变：`NativeExpectedPort` 的 `prove/assertCurrent/release/close` 签名、投影/哈希/pin 契约、`NativeExpectedProof` 的导出形状全部保持；新增的只有**私有**记录与私有错误类。修的是生命周期：

1. **权威来源分离**。`HELD_FACTS`（全局事实表）与新增的模块私有 `PROOF_STATUS`（liveness + 归属实例 token）分开。`assertCurrent`/`release` 只认 `PROOF_STATUS`，公开的 `proof.released` getter 只是它的**视图**，`markReleased()` 不再是权威。
2. **先撤销权威，再清理**。`release`/`close` 在碰任何句柄之前先把 `PROOF_STATUS.released` 置真、移出本实例 outstanding、删掉事实表条目；因此清理失败后该 proof 也不再能被 `assertCurrent` 接受。
3. **清理不再被首个异常截断**。新增私有 `#releaseResources()`：逐个尝试、收集全部失败、**不**抛。其中一个 close 抛错时，其余描述符仍全部被 close。
4. **主错误不被清理错误覆盖**。`prove()` 失败路径把 cleanup 原因以**不可枚举**字段 `cleanup_errors` 附在原主错误上并原样重抛（主错误类型/消息/stack 不变）；主错误无法承载时（例如被 freeze）才退化为聚合错误，且聚合错误里仍保留主错误。`release`/`close` 无主错误时抛聚合错误 `NATIVE_EXPECTED_CLEANUP_FAILED`。
5. **不泄露路径/凭据**。聚合错误 message 只是 code；原因只存在于不可枚举的 `errors` 字段；`cleanup_errors` 同样不可枚举（`Object.keys()` 看不到，`JSON.stringify` 不带出）。
6. **清理不确定 sticky fail-closed**。任一清理失败后置 `#cleanupUncertain`；此后 `prove`/`assertCurrent` 抛 `NATIVE_EXPECTED_CLEANUP_UNCERTAIN`，重复 `release`/`close` 也抛同一错，**不会**因为记录已移除而伪称成功。
7. **不重试裸 FD**。每次尝试前先把资源对象标记进本实例的 `#releasedResources`（WeakSet，按对象身份去重）：同一对象在一次列表里出现两次只 close 一次；失败过的也不重试。不同对象是否同 FD **不猜**。
8. **每个 await 之后复核状态**。`await loader` 之后、`await source` 之后、以及计算/签发 proof 之前，都检查 `#closed` / `#cleanupUncertain` / `binding.isCurrent()`。关闭后晚到的 source：它交来的全部资源被释放，并且**不签发** proof（`NATIVE_EXPECTED_CLOSED`）。关闭期间尚未返回的 source 仍由其 owner 负责；一旦返回，责任立即交给本类并被收敛清理。`close()` 仍是同步 API，不假装能等待无法取消的 source promise。
9. **`release` 只管自己签发并跟踪的 proof**。外来实例 / 伪造 / JSON 重建的 proof 一律 `NATIVE_EXPECTED_PROOF_FOREIGN`，且**不碰**原 owner 的任何资源（原实现会经全局 `HELD_FACTS` 释放别人的描述符并删掉别人的事实）。自己的已释放 proof 保持幂等。
10. `assertCurrent` 原有判定（外来/失活/字段变更/closure/file guard）语义保持不变。

新出现的错误名（均为本模块私有面）：`NATIVE_EXPECTED_CLEANUP_FAILED`、`NATIVE_EXPECTED_CLEANUP_UNCERTAIN`；`NATIVE_EXPECTED_PROOF_FOREIGN` 复用既有名字。

### `tests/agent-driven/integration/created-native-ack.test.ts`（sha256 `12c3e8b3…` → `a3dd488f…`）

原有 51 个 case **逐字未改**（只增加了两条 import 与文件末尾追加的 describe 块）。新增 11 个 case，全部用真实文件/真实 fd/受控 promise：

| case | 证明什么 |
| --- | --- |
| keeps the projection failure and still releases every other descriptor | 主错误仍是主错误；首个 close 失败后其余 close 仍执行，且用 `fstatSync` 证明真的释放了 |
| revokes the proof before the cleanup, and still releases every descriptor | release 失败后 proof 已无权威 |
| releases every proof on close, even when the first cleanup fails | 一次 close 的失败不阻止其他 proof 清理 |
| does not go green again after an uncertain cleanup | 不确定 sticky：prove/assertCurrent/release/close 都不再“变绿”，且不重试裸 FD |
| refuses a candidate that loads after the close, and never reads the source | 关闭后晚到的 loader：不调 source，prove 拒绝 |
| releases the descriptors of a source that returns after the close, and issues no proof | 关闭后晚到的 source：交来的描述符全部释放，不签发 proof |
| refuses a foreign proof and releases nothing of the owner | 外来 proof 被拒，原 owner 资源与权威不受影响 |
| refuses a forged or a rebuilt proof, and releases nothing | 伪造 / JSON 重建 proof 被拒，不释放任何东西 |
| releases one resource that is listed twice exactly once | 同一对象列两次只 close 一次（防 FD 复用误伤） |
| releases a proof once, and a repeated release neither closes again nor fails | 普通释放幂等，无回归 |
| closes twice without closing a descriptor twice | close 幂等，无回归 |

“模拟 close 不明结果” 的那个 fd **从不断言已被 OS 释放**（只断言其余 fd 真的关闭）。

## 2. 实际命令 / exit / 日志与哈希

cwd 全部为 `/home/administrator/orca/workspaces/Narralens/Narralens-A-R1-PRODUCT`。机器可读回执见 `evidence/RECEIPTS.json`。

| # | argv | exit | 结果 | 日志 sha256 |
| --- | --- | --- | --- | --- |
| 00 | `node_modules/.bin/vitest run --config vitest.config.ts tests/agent-driven/integration/created-native-ack.test.ts`（原始源码 + 原始测试，基线） | 1 | 1 failed / 50 passed | `364f1ba3…` |
| 01 | 同上，**原始源码** `9f9d2c82…` + **相同测试字节** `a3dd488f…` | 1 | **10 failed / 52 passed** | `f7b179b4…` |
| 02 | 同上，**修复源码** `1dd35aaa…` + **完全相同的测试字节** `a3dd488f…` | 1 | **1 failed / 61 passed** | `75f80bf5…` |
| 03 | `node_modules/.bin/tsc --noEmit` | 0 | 无诊断 | `e3b0c442…`（空文件） |

**先证旧失败再证新通过**：run 01 与 run 02 使用**同一份测试文件字节**（`a3dd488f…`），只换源码。run 01 中 9 个生命周期反例全部失败（逐条失败断言见 `logs/01-original-source-new-tests.log`），run 02 中它们全部通过。

run 01 的第 10 个失败（`the tracked candidate pin > refuses the candidate until a review has approved it`）是**基线既有失败**，与本票无关：run 00（未动任何字节的 HEAD）已经是 `1 failed / 50 passed`，失败用例名完全相同。原因是仓库里被跟踪的 pin（`src/host/m5/openfilm-studio-ui-pin.json`）现在带 `approval: "APPROVED"`（MAIN 后续提交 `2eecfe4`），而该旧断言仍要求它抛 `NATIVE_EXPECTED_BUILD_NOT_APPROVED`。本票**未改这条旧断言**（不“改旧断言调绿”），也未改 pin（不在释放路径内）。**需要父 Codex / MAIN 决定**：是更新该旧断言，还是保留为已知失败。

## 3. 保留与未动

- PREFLIGHT.json 里的 **42 个 protected dirty/untracked 文件哈希全部未变**（脚本复核：checked=42 changed=0）。
- 用户既有 dirty（`AGENTS.md`、`docs/AGENT_MEMORY.md`、`docs/agent-driven-v1/07_PARALLEL_DEVELOPMENT.md`、`docs/execution/A/implementation-20261111/AUTHORIZATION_INTERPRETATION.md`）与全部未跟踪历史证据保持原样。
- 未 `git add` / `commit` / `reset` / `stash` / `push`，未切分支，未起子 worker，未读写配置/凭据/网络/J 盘。
- 原始源码可原样恢复：`git show HEAD:src/host/m5/openfilm-native-expected.ts > src/host/m5/openfilm-native-expected.ts`（恢复后 sha256 `9f9d2c82…`）。修复版与测试版副本另存于 `evidence/`。

## 4. NOT_RUN

全量 vitest、Host、监听端口、浏览器、ffmpeg、build、install、网络、下载、付费调用、真实 runtime：**全部未跑**（票面禁止）。`tests/agent-driven/headless/created-native-entry.test.ts` 需要真实浏览器与真实服务器，**未跑**。`tests/agent-driven/product/observation-ui.test.tsx` 为 happy-dom UI 用例，不 import 本次改动模块的任何部分，**未跑**。本票未实现 SourcePort、未做 NativeAck 生产接线、未做 native 源码移植。

## 5. 需要父方注意的语义变化（诚实列出）

1. `release()` / `close()` 现在在清理失败时**会抛**（聚合错 `NATIVE_EXPECTED_CLEANUP_FAILED`），且重复调用在不确定态下抛 `NATIVE_EXPECTED_CLEANUP_UNCERTAIN`。这比旧行为（部分情况静默吞掉首个 close 错误）更吵，但是票面要求的“不得用隐藏 catch 吞掉 / 不得伪称成功”。现消费者 `src/host/m5/native-observation.ts:876` 在 `finally` 里调 `release`——正常路径不抛，清理失败路径会向上传播，请父方知悉。
2. `release()` 对外来/伪造 proof 现在抛 `NATIVE_EXPECTED_PROOF_FOREIGN`（旧行为是误释放对方资源）。
3. 本票不新增任何公开 API；新增的两个错误名只在私有面出现。

## 6. 自述边界

本文件是实现者自述。**未**取得独立复核，**未**主张 NativeAck 通过、A 轮通过、V1 通过或任何人工验收结论；父 Codex 需按流程独立读取代码并重跑验收后自行判定。
