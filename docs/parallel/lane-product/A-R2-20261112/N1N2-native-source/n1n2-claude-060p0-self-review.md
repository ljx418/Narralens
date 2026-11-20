# N1N2 060P0 — 基线真实回归自审报告（MAIN_RELEASE_060P0_BASELINE_REAL_REGRESSION）

Writer：Claude 唯一实施者，task `task_7b5b5d75392e`，dispatch `ctx_fb5e1de480f9`，
terminal `term_499fde1b-4bc4-40d0-a884-225e555d7b70`（同一实施树，未新建 writer/worktree）。
授权：`.../resume-claude-20261112/repair-058/RELEASE_060P0.json`（`MAIN_RELEASE_060P0_BASELINE_REAL_REGRESSION`）
+ `060P0_P07_BOUNDARY_RULING.md`（P07 三处旧断言的精确修订批准）。
执行根 W=`/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`，
HEAD=`1d348d419120f23f45d958112ea8c43df5a04675`（**未变**；每条 capture 的 `cmd.json.git_head` 都是它）。

**本报告不是验收，也不是 PASS 声明。** 它是实现者对这一波的事实交代：改了什么、每条命令的真实 exit 与 hash、
每个真实失败如何分类与闭环、资源如何释放、以及**哪些门没有跑**。
**A057-04 仍 OPEN**：测试 exit 0 **不**证明它已修，也**不**证明 PRE 的风险闭环。

---

## 0. 基线核对（先做的事）

`RELEASE_060P0.json.dirty_source_inputs_sha256` 的 **11 个文件逐一比对，当前字节全部一致**（包括 059 的全部改动）；
HEAD 与 release 的 `base_head` 一致；用户的 `AGENTS.md`（`37300463a72a…`）未动；Git 索引未动（未 add/commit）。
本波**只在 allow_existing / allow_new 内**改动：`tests/agent-driven/integration/created-native-source-reader.test.ts`
（K04-c 修正 + 三处获批的 P07 旧断言修订）与 `src/host/agent-driven/retained-native-closure.ts`
（**只有 `verifyFile` 的注释**：澄清它现在也比对**命名路径**的身份；**判定未放宽**）。

---

## 1. 这一波实际改了什么

### 1.1 K04-c 的测试修正（MAIN 点名的两处错误 + 更严的证明）

`tests/agent-driven/integration/created-native-source-reader.test.ts` 的 **K04-c**：

| MAIN 的要求 | 现在的写法 |
|---|---|
| `triple` 是前缀，不是文件名 | 三件真名 `` `${witness.frame_key}.jpg` `` / `.json` / `.stamp`；存在检查逐个断言（带文件名作为断言消息） |
| 证明**只删了三件** | 删除前后各读一次 pageframes 目录的 listing，断言 `after === before.filter(不含那三件)` |
| `before.mtime` 是 Date，会丢 mtimeMs 小数 | **在真实 draw 之前**把 film 的时间设为**固定整秒** `1700000000`（`utimesSync`），draw 之后用 **bigint** `statSync` 记录 `mtimeNs/ctimeNs` |
| 改复 bytes 再恢复**同一** mtimeNs | 写入不同字节再写回原字节（真实 change+restore），随后 `utimesSync(film, WHOLE_SECOND, WHOLE_SECOND)` 把**内容时间恢复到同一纳秒** |
| 逐字证明 bytes 与 mtimeNs 不变、ctimeNs 确变 | 断言 `readFileSync(film).equals(filmBytes)`、`restored.mtimeNs === drawn.mtimeNs`、`restored.ctimeNs !== drawn.ctimeNs` |
| duration output identity 未变 | duration 的 `ino/size/mtimeNs/ctimeNs` 与字节逐项断言未变 |
| 旧 `duration.film` stamp 仍匹配 | 读出 duration 的 `film` 字段，断言它仍等于 `` `${filmNow.mtimeMs}:${filmNow.size}` ``（读者比较的就是这一对）⇒ **拒绝不可能来自 stamp** |
| 不要放宽原判定、不要换成任意 reject | 断言**精确 code + 精确 message**：`NATIVE_SOURCE_CACHE_STALE` + `A file the native cache entry depends on changed since it was produced` ⇒ 命中的正是**历史 witness 的依赖身份**边界 |
| 真实不同 ctime，不用固定 sleep 当正确时序 | 变更走**真实写**；若该文件系统的时钟粒度粗，用**已有的一次性变异子进程**（`native-read-growth-child.mjs rewrite`，写回同一字节）在**有界重试**内推动 inode 的 ctime，**没有**任何 sleep 参与正确性判定；子进程的 status 必须为 0 |

### 1.2 三处获批的 P07 旧断言修订（`060P0_P07_BOUNDARY_RULING.md`）

| # | 旧断言 | 现在的断言 | 保留了什么 |
|---|---|---|---|
| 1 | 先 retain 第二个文本、再在 `readText` 时被累计预算拒绝 | **先**验证第一个文本 `readText` 两次（不重复计费），**再**断言第二个 `retainFile` 以 `NATIVE_CLOSURE_BUDGET` 拒绝 | 两个单文件各自合法、**总和**超预算的具体数值（`limit=max+2 < first+second`）与全部 deep / FD / growth 子段原样保留 |
| 2 | `maxTotalTextBytes:40` 与 `maxTextBytes:100` 的拒绝发生在 `readText` | 拒绝发生在 **`retainFile`**，在该边界断言准确 code | 新增**恰好等于预算**的合法正向（100 字节文本被保留并读出）；closure 自身的 `onReadChunk` 观察显示被拒文本**零字节**（**如实标注为 closure 自身观察**，不冒充系统调用级证据）；`bounded.close()` 移入 `finally`，**断言失败也不漏资源** |
| 3 | 等字节的路径替换后 `verifyFile(film)` 期望 `true` | 期望 **`false`** | 替换前的 `true`、整体 `verify()` 的 `false` 保留；并**显式证明** held 旧 FD 的字节仍逐字一致（`readFileSync(closure.probePath(film))`，只限测试的真实 held FD，无新增生产绕过）而**命名路径已是另一个 inode**（`named.ino !== held.ino`）；`restored-write` 与 `symlink` 两个子段**未删** |

`src/host/agent-driven/retained-native-closure.ts` 的 `verifyFile` 注释同步澄清：
它现在回答的是「**被取走的文件是否仍是这棵树所命名的那个文件**」——描述符的 device/inode/size/字节**与**
命名路径的身份都要成立；一个在路径上被等字节副本替换掉的文件因此被拒，**尽管描述符仍握着原来的字节**。
**生产判定未放宽**（只改注释）。

---

## 2. 命令、真实 exit、log hash（全部经 recorder，cwd=W；每条 `source_changed=[]`、`source_added=0`）

索引由 recorder 的 capture 文件**自动生成**（未手填）：`n1n2-claude-060p0-capture-index.json`。

| capture | argv | recorder 实测 | exit | log sha256 | 结果 |
|---|---|---|---|---|---|
| `n1n2-claude-060p0-tsc-001` | `corepack pnpm exec tsc --noEmit` | `03:51:47Z → 03:52:15Z` | **0** | `e3b0c44298fc…7852b855` | 通过（K04-c 修正后） |
| `n1n2-claude-060p0-reader-001` | `…vitest run … created-native-source-reader.test.ts` | `03:52:30Z → 04:13:31Z` | **1** | `d8a0fd829330e7af2de63267e20638d81cdf5fd8ddd9c7f879aad3f2b78179aa` | **93 tests = 90 pass / 3 fail**（三条 P07）⇒ 原始失败产物**原样保留** |
| `n1n2-claude-060p0-tsc-002` | `corepack pnpm exec tsc --noEmit` | `04:16:38Z → 04:17:02Z` | **0** | `e3b0c44298fc…7852b855` | 通过（三处 P07 修订后） |
| `n1n2-claude-060p0-p07-001` | `…vitest run … created-native-source-reader.test.ts -t "P07 refuses a grown file\|P07 refuses a symbolic link\|P07 refuses a text file"` | `04:17:18Z → 04:17:36Z` | **0** | `e9507c162231e117d9ce73704d003028d76f60f5e244ab7fe0b9a114ca03ac79` | **3 passed / 90 skipped**（其余 skip 只因 filter，不计入验收） |
| `n1n2-claude-060p0-reader-002` | `…vitest run … created-native-source-reader.test.ts` | `04:18:11Z → 04:34:32Z` | **0** | `546fd12f342f59cbe0043c9bfa7cc5598d3f36d451fe09412e587f306189a5c5` | **93 passed (93)** |
| `n1n2-claude-060p0-cache-001` | `…vitest run … native-cache-witness.test.ts` | `04:35:49Z → 04:44:00Z` | **0** | `d6a96157a886626c14c27ab65e46ce20ffd03ad2edaba4fbffb5a92db3f1c5c9` | **31 passed (31)** |

（MAIN 已独立核对 reader-002 与 cache-001 的 631 个输入与当前字节一致、log sha 正确、运行中无 source changed/added：
`repair-058/060P0_MAIN_READER002_VERIFICATION.json`、`060P0_MAIN_CACHE001_VERIFICATION.json`。）

### 2.1 reader-001 的三条真实失败（分类与闭环）

| 失败 | 真实原因 | 处置 |
|---|---|---|
| `P07 refuses a grown file, the cumulative text, the deep tree and the descriptor budget` | 累计文本预算现在在 **retain** 就拒绝（059 已审定的「预算必须在任何 digest 读取之前」），旧断言在 `readText` 才拒绝 | 按 ruling 第 1 条修订（保留数值与全部子段）⇒ `p07-001` 绿 |
| `P07 refuses a symbolic link, a same-bytes replacement and a restored change time` | `verifyFile` 现在含**命名路径**身份（059 的读后 held+named 栅栏），旧的「路径被替换后仍 true」与之冲突 | 按 ruling 第 3 条修订为 `false`，并补上 held 字节仍一致 / 命名 inode 已变的显式证明 ⇒ `p07-001` 绿 |
| `P07 refuses a text file above the budget and bounds the total` | 预算拒绝现在发生在 `retainFile` | 按 ruling 第 2 条修订（在该边界断言准确 code；补恰好等于预算的合法正向；`close()` 移入 `finally`）⇒ `p07-001` 绿 |

**没有一条旧断言被放宽成「任意拒绝」**：每一处都改成**在新的边界上断言更精确的 code**，并补上更强的事实证明。

---

## 3. 逐 case 状态

### 3.1 reader 整文件（`reader-002`，93/93）

| 组 | 状态 | 备注 |
|---|---|---|
| 原 K / P / F / G / Q 历史用例 | **全部通过** | 91 条历史用例 + 059 新增 2 条 = 93；**没有**因为读后身份更严就改期望绕过原规格（只有 MAIN 逐条批准的三处边界修订） |
| **K04-c**（A057-05） | **实际通过**（15.4 s） | 真实 fixed draw（真实上游 + 真实 headless Chrome）真的画了 film.html/ms0，三件 triple 与 duration 真的写出；只删三件后 duration-only **仍被接受**；改复 bytes + 恢复同一 mtimeNs 后 **ctimeNs 真的变了** ⇒ 读轮以 `NATIVE_SOURCE_CACHE_STALE` + 依赖身份的消息拒绝 |
| **F05-c**（A057-06） | **实际通过**（30.6 s） | 用工作副本里真实媒体文件的**正确 upstream key** 造 posters/frames/waves 伪文件 ⇒ 以 `NATIVE_SOURCE_CACHE_FAMILY_UNSUPPORTED` 明确拒绝，且**不删任何东西** |

### 3.2 native-cache 整文件（`cache-001`，31/31）

全部通过：G04 真实浏览器绘制、B0-1..B0-5、K01、K03、K05、P08、K04-a/b、PF01/PF02、Q01–Q03 等
**该文件本波未改一个字节**（sha256 仍是 `6ba76059a41c1820d580ea0a7ae684f62b7afcd445bdc431a1524b8c7647ccd4`），
**旧语义（含 P07/P08/K04 的旧期待）原样通过** ⇒ 读后身份栅栏与有界摘要**没有**破坏旧的成立条件。

### 3.3 预算零读证据的两层（诚实区分）

| 面 | 证据 | 本波状态 |
|---|---|---|
| **纯 closure 面**（系统调用级） | 059 的 `retained-native-budget.test.ts`：真实 `readSync` 包装 + 真实 fd 归因 + 一次性变异子进程 | **本波 NOT_RUN**（本票只授权 tsc + 两个整文件；该文件不在本波命令里）⇒ 引用 059 的 `budget-008` 记录，**不冒充本波跑过** |
| **真实 authority / workspace 面** | reader 整文件里的 **F06**（authority 的 `acquireNativeFacts` 路径）与 P07 的 authority/workspace 用例 | **本波实际通过**（reader-002 93/93）⇒ 但那里的零读证据是 **closure 自身的 `onReadChunk` 观察**，**不是**系统调用级计数；两者不可混说 |

---

## 4. 当前源码摘要（精确 sha256 与字节）

| 文件 | sha256 | 字节 | 本波是否改 |
|---|---|---|---|
| `src/adapters/openfilm/openfilm-upstream.ts` | `1583d4aba7f1a2fde487b1339745a039759d09b29fe81edc3268a76edb054e41` | 56803 | 否（059 字节） |
| `src/host/agent-driven/retained-native-closure.ts` | `fd896104149d6cd2663b63a59d50beabbeee546f3e3f46a5d6bf07fbe662ede9` | 75335 | **是（仅 verifyFile 注释）** |
| `src/host/agent-driven/committed-snapshot-authority.ts` | `e7277382b1b3819d1f6aaa8459dc4d2bf904169d31e614aa45ac6a7b3c610f8b` | 44152 | 否（059 字节） |
| `src/host/agent-driven/created-native-source-reader.ts` | `057015a54e9daee8d08f56eadbd7b2766622f2f915f29a0ebc330e0d4cc676b6` | 79025 | 否（059 字节） |
| `tests/m2.1/openfilm-upstream-lock.test.ts` | `9b2cf8525c7e51da9a7c0d9eb579b65be56a679651fcbb5bfb5bd8e1424c175a` | 58158 | 否（059 字节） |
| `tests/agent-driven/integration/created-native-source-reader.test.ts` | `6325eab3e4411e77a0b000a084793fb57545d961437c572d0a990625a50d9784` | 173839 | **是（K04-c + 三处 P07）** |
| `tests/agent-driven/integration/native-cache-witness.test.ts` | `6ba76059a41c1820d580ea0a7ae684f62b7afcd445bdc431a1524b8c7647ccd4` | 94440 | 否（基线字节） |
| `tests/agent-driven/integration/retained-native-budget.test.ts` | `3241bdd2c8b7b958e9852db2f28bd831f5a6f70bd2c09d975c09295769e7cd9d` | 16277 | 否（059 字节） |
| `tests/agent-driven/integration/openfilm-serving-url.test.ts` | `6c02e6d3cf56f60e33cbbb74a1b56bef3eaabbb20f10bba025e41e4f3de74e2b` | 4379 | 否（059 字节） |
| `tests/agent-driven/integration/helpers/native-read-growth-child.mjs` | `2a31e13d30b98d161a69fcd4c33a125d2733762adb65dddb75fd1b79517f5c84` | 1708 | 否（059 字节） |
| `tests/agent-driven/integration/helpers/native-read-byte-observer.mjs` | `a249498702425a01cb3964ef87cfddbbd036b6998a2d03a8938a755d43b89169` | 2486 | 否（059 字节） |
| `tests/fixtures/openfilm-serving-url-child.mjs` | `db3caf37f9983bdebf69ea76795925c79a446e88a779e063235f3d402d085a41` | 2951 | 否（059 字节） |

相对基线 `1d348d4` 的总改动：`6 files changed, 800 insertions(+), 200 deletions(-)`（src+tests），
**全部在 allow_existing 内**。本波相对 059 字节的增量只有上面两处。

---

## 5. 旧坏产物与失败保留

- `n1n2-claude-060p0-reader-001`（exit 1，93=90/3）的**全部 capture 文件原样保留**（claim/cmd/inputs/txt/exit/result），
  log sha `d8a0fd829330e7af…`；**没有**被后来的绿覆盖或改写。
- 本波**没有**产生需要保留的坏媒体产物（没有渲染、没有 export、没有新工件）；旧的 053/054/055/056 证据目录未动。
- 059 波的失败 capture 同样原样保留（`n1n2-claude-059-*`）。

---

## 6. 资源 owner 与清理证据（本波真实跑完后的实测）

| 资源 | owner | 清理证据 |
|---|---|---|
| recorder / vitest 进程 | 本波 | `ps` 实测：**无任何 run-recorded / vitest 进程残留** |
| Chrome / Playwright | 上游模块（进程级） | `ps` 实测：本波结束后**没有**本波启动的 chrome/playwright 残留；系统里存在的是**用户自己的** `playwright-mcp`（PID 1825，已运行 2h37，早于本波）⇒ **未触碰、未 kill**（不按进程名全杀） |
| ffmpeg / ffprobe | fixture / 上游 | `ps` 实测：**无残留** |
| 临时树 | fixture / 本波 | `/tmp` 内**没有** `n1n2-*` / `narralens-*` 目录残留（fixture 自己在 `finally` 里清理） |
| 上一波遗留 | 059 的反事实运行 | 发现并**删除**了我自己的一个遗留：`/tmp/n1n2-budget-08LIIs`（33 MB，03:28 UTC 的 cf-budget 运行因 hook 超时未清）——**是我自己的工件，已清**；060P0 窗口内没有产生新的遗留 |
| 监听 / producer owner | 测试内 | 每个用例在 `finally` 里 `owner.close()` / `producer.close()`；本波 P07 修订把一个 `close()` 移入 `finally`（断言失败也不漏资源） |

本波**没有**杀任何进程、**没有**改 HOME/供应商配置、**没有**联网/下载/付费/碰 J 盘、
**没有**读改用户 config / credentials / `.env` / 全量 env。

---

## 7. 没有跑的门（全部 NOT_RUN）

1. `pnpm check` 全门、`vite build`、validator `--check`、Python golden —— **本票未授权**。
2. `tests/agent-driven/integration/retained-native-budget.test.ts`（纯 closure 的系统调用级预算用例）—— 本票未授权；
   引用 059 的 `budget-008`，**不冒充本波跑过**。
3. `tests/m2.1/openfilm-upstream-lock.test.ts`、`openfilm-serving-url.test.ts` —— 本票未授权（059 已跑绿，引用即可）。
4. **`A057-04` 的真实 seek/JOB 超时与 browser/page/context 结算** —— **仍 OPEN**；本波**没有**动 producer 工厂 /
   bridge 计数 / close 语义 / workspace / 固定 vendor 的任何一行；**测试 exit 0 不证明它已修，也不证明 PRE 的风险闭环**。
5. 原 17 项要求的整体验收：**本波不宣称任何 requirement PASS**；
   `ORIGINAL_REQUIREMENTS.json`、7 条 gate 与全部历史失败证据原样保留。
6. 下一阶段接线、S01、NativeAck、Studio、A 影片、V1 —— **一律未推进**（P1 的精确范围由 MAIN 另发）。

---

## 8. 交还

唯一 writer 与**唯一重型 slot** 交还 MAIN。本波**未提交**（`git add`/`git commit`/`reset`/`stash`/`push`/`merge` 一次也没有）、
**未自签外审**、**未进入下一接线**。候选字节已冻结在 §4 的 sha256 里，等 MAIN 决定后续（060P1 的范围另发）。

一处需要 MAIN 知悉的**诚实登记**：`verifyFile` 的语义在 059 之后**包含命名路径的身份**，
因此「路径被等字节副本替换」从此是**拒绝**而不是 true —— 这是 059 已审定的栅栏，MAIN 在 ruling 第 3 条里逐字批准；
旧用例的这一条期望已按批准修订，其余旧语义**原样通过**（native-cache 整文件 31/31 未改一个字节）。
