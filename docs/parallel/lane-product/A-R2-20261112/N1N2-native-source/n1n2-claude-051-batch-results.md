# N1N2 051 — 受影响回归与真实媒体验证：**第 2 组真实失败，序列按停止条件中止**

Writer: Claude implementation child, task `task_7dd13fc845a7`, dispatch `ctx_8d0e4eca6a91`,
terminal `term_2319a446d5861724561c7095f074818b`（同一实施树、同一平铺工作区，未新建 writer/worktree）。
授权：`.../resume-claude-20261112/BATCH_051_GRANT.json` + `BATCH_051_ACCEPTANCE_PLAN.md`。
cwd `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`，HEAD `e2eff61b464d75d36598103d718cd2a75db5dfda`。

**全程只读**：没有改任何 source/tests/fixtures/config/tools/index，没有 git add/commit/reset/stash/checkout/push；
固定上游、3 个 opaque fixture、Expected015、AGENTS 均未动。没有 429，没有工具格式异常。

---

## 1. 逐组真实结果

| 组 | capture | 实际 exit | log sha256 | 结果 |
|---|---|---|---|---|
| 1 资产并发 | `n1n2-claude-051-local-assets-001` | **0** | `39a29f2124ca30430e46881fd787f23855b22b5c9cf99ca7678cb9796853347c` | `24 passed (24)`，63.30s |
| 2 authority/adoption/atomic/change | `n1n2-claude-051-authority-001` | **1** | `a784c31402777948b8c9a712b6fe173b8697383ea2df9f0356814522d551bea5` | `1 failed | 53 passed (54)`，366.36s |
| 3 真实媒体双导出 | `n1n2-claude-051-real-export-001` | — | — | **NOT_RUN**（第 2 组非零 → 停止） |
| 4 完整 reader | `n1n2-claude-051-native-reader-001` | — | — | **NOT_RUN** |
| 5 四套 legacy fixture | `n1n2-claude-051-legacy-fixtures-001` | — | — | **NOT_RUN** |

### 第 1 组逐 case（24 项，全部真实执行并通过）

actually probes and fully decodes video and synthetic diagnostic audio into the same Host database without modifying native source ·
requires real trusted UI provenance and ownership before reading files or recording rights ·
replays the original registration without reimporting changed input and refuses a conflicting key ·
rolls back row, command and outbox together at before_insert / after_insert / after_receipt / after_event, preserving an unreferenced blob for a safe retry ·
checks real input hashes, paths and media rather than accepting metadata as proof ·
preserves unknown license and synthetic origin as facts rather than silently clearing them ·
detects a published blob changed inside the final SQL boundary and commits no registration ·
**converges concurrent same-key imports to one immutable row, one command and one business event**（并发 N9/N10 之一）·
rounds audio directly from sample time to project frames rather than rounding through displayed milliseconds ·
refuses truncated audio and a video with a damaged audio track even when video-only legacy validation passes ·
refuses local storage overlapping author, snapshot or input domains before creating directories ·
does not follow a newly redirected configured source root, even when replacement bytes have the declared hash ·
captures trusted input by value before asynchronous inspection rather than accepting later permission changes ·
**bounds real concurrent imports to two and removes a cancelled queued request without leaking a slot**（并发 N9/N10 之二）·
proves a published blob again when only the change time of its inode moved, and keeps every other change refused ·
preserves cancellation through the actual video validator wrapper and waits for its media child before returning ·
quiesces admitted local imports and their real media child before the Host closes its shared database ·
keeps snapshot bytes untouched when a storage parent is replaced exactly at before_stage_create ·
keeps snapshot bytes untouched when a storage parent is replaced exactly at before_publish

### 第 2 组逐 suite

- `tests/agent-driven/integration/created-source-adoption.test.ts` — 34 项中 **33 通过 / 1 失败**
- `tests/agent-driven/integration/created-impact-atomic.test.ts` — **9 / 9 通过**
- `tests/agent-driven/integration/created-source-change.test.ts` — **11 / 11 通过**

---

## 2. 最早真实断言与原因（唯一失败）

```
FAIL tests/agent-driven/integration/created-source-adoption.test.ts
  > LF04 refuses a REAL impact and a REAL transaction of another project, and moves no authority
AssertionError: expected 409 to be 202 // Object.is equality
  ❯ tests/agent-driven/integration/created-source-adoption.test.ts:583:27
```

- **最早真实断言**：`created-source-adoption.test.ts:583` 的 `expect(created.status).toBe(202)`。
- 失败发生在**用例自己的 setup**：它通过 Host 自己的 API（`POST /api/agent/v1/intakes` → `…/decision` →
  `POST /api/agent/v1/projects`）在**同一数据库**里造第二个真实项目时，创建被拒为 **409**，
  而不是被受理为 202。
- 因此**该用例真正要证明的负例从未被执行**：外项目 impact 拒绝
  （`:629` `CREATED_COMMIT_PLAN_MISMATCH`）、外项目 transaction 拒绝
  （`:633` `CREATED_COMMIT_TRANSACTION_MISMATCH`）、以及「两边一个 authority 都不移动」的后置比对，
  全部**没有到达**。同文件的兄弟用例
  `LF04 refuses a stored hash that does not match the plan, and moves no authority` **通过**。
- 409 的**wire 错误码没有被捕获**：该用例只断言 status，没有断言响应体；
  vitest 输出里只有 `409`。按代码路径，project.create 的冲突一律是
  `ProductError('REVISION_CONFLICT','The creation facts changed')`
  （`src/host/projects/project-creation-store.ts:62`），来源在
  `reserve()` → `confirmed()` 的事实一致性守卫（intake 版本/head、confirmation 的 action/digest/有效期、
  `canonicalDigest(brief) !== version.input_digest`）。**具体是哪一个守卫，本次运行没有留下证据，不猜。**
- **性质**：`LF04` 是当前**未提交 dirty diff 里新增的用例**（`git diff` 显示该 `it(...)` 为新增行），
  本候选是它的**第一次执行**——此前没有任何绿/红历史可比对。它不是既有行为的回归，
  也不是我这次 047 改动引起的（我只改了 `native-cache-witness.test.ts`，本套件不引用它）。
- **未自修、未重跑、未改测试或生产**：按授权「失败不得修改测试/生产，等待 MAIN 集中裁决」。

---

## 3. 冻结、漂移与自有资源结算

- 每次 capture 的 `inputs.json` 是运行内冻结的 626 个文件；两次运行结束后**各自独立复核 626/626 匹配、
  0 缺失、0 不匹配**；两个 `result.json` 的 `source_changed`/`source_added` 均为空。
- HEAD 仍是 `e2eff61b464d75d36598103d718cd2a75db5dfda`；**git 索引为空**；已跟踪 dirty 17 个文件、untracked
  src/tests 6 个文件，均与开工前一致；受保护 `AGENTS.md` sha256 仍 `37300463a72a612ae16e0a5fcfb496502c57c722b83781e0e2e8c9480594542b`。
- 自有资源：两次运行结束后**无遗留 vitest / chrome / ffmpeg / ffprobe 进程**，
  `127.0.0.1:4747/4748` **无监听**。机器上另有 IDE 自己的 `playwright-mcp` 与 `/mnt/c/workSpace/navia/…`
  的 `node --test`，**不属本 lane，未触碰**。
- 全程 Headless 静音、loopback 单重型槽；未读 J 盘、未联网下载、未付费、未外传、未安装或改配置。
- **本批未产生任何媒体产物**：第 3 组（真实媒体双导出）NOT_RUN，所以**没有** 900 帧 decode、
  **没有** 音频 probe/decode、**没有** 渲染产物 SHA256 可报——这些**据实记为未执行**，不以旧批次数字冒充。

---

## 4. 原 17 项覆盖缺口（本批之后的实际状态）

已由本批真实执行触及的：
- **资产并发（N9/N10 两个真实 case）**：第 1 组 `bounds real concurrent imports to two and removes a cancelled queued request without leaking a slot`
  与 `converges concurrent same-key imports to one immutable row, one command and one business event` **本次真实通过**。
- **同库 authority / expiry / impact 原子性**：第 2 组 adoption 33 项 + atomic 9 项 + change 11 项通过，
  其中含 `refuses authority expiring during the final creative closure scan`、
  `rolls back checkpoint, attempt and every authority after a post-checkpoint transaction failure`、
  `poisons a swallowed read of another intake inside the project commit scope`、
  `rejects a real intake update after approval without consuming database authorities` 等**真实 case**。

**仍然缺口的（原 17 项中本批未执行或未证明）**：
1. **R05 actual_probe / child_lifetime** — 第 3 组 NOT_RUN ⇒ 固定 ffprobe 同父 PID FD、duration/fps/rotation/audio 归一化、
   child 真实 exit 先于 FD 释放、限额拒绝而非截断，**本批无证据**。
2. **R06 native_bytes_and_order** — 第 4 组（完整 reader）NOT_RUN ⇒ UTF8/BOM/CRLF/native_rev 向量、
   numeric localeCompare 视频序与独立 caption readdir 序、Node/ICU/locale 记录，**本批无证据**。
3. **R07 budgets / per_allocation_fd_lifetime / drain_and_delivery** — 第 4 组 NOT_RUN ⇒ 增长/总量/路径深度/FD/输出/时间界、
   回收整数 FD 的精确一次关闭、close 排空与成功后资源移交，**本批无证据**。
4. **R01 producer_chain 的 reader 侧** — 第 4 组 NOT_RUN ⇒ 真实 bootstrap + SOURCE_ONLY producer + 受控 adoption 产出的
   已提交源被**真实 workspace/reader** 消费这一段，**本批只到 authority/adoption 侧，reader 消费侧未执行**。
5. **R02/R03 tamper_and_authority / complete_dependencies 的 reader 侧负例** — 第 4 组 NOT_RUN。
6. **REG existing_behavior** — 第 5 组（四套 legacy fixture）NOT_RUN ⇒ 旧 render SnapshotReadPort、legacy 拒绝、
   已接受的 Expected 生命周期/84 断言保持，**本批未复核**（047 的 native-cache-witness 31 项与本批第 1/2 组不覆盖它）。
7. **LF04（Q06 外项目 impact/transaction）** — **本批为红**，且红在 setup 的「造第二个真实项目得 409」，
   两个外项目拒绝断言与「零 authority 移动」后置比对**未执行**；需 MAIN 裁决该 setup 409 的归属
   （测试构造 vs 生产事实守卫）后才能重跑。
8. **EVIDENCE frozen_capture / REVIEW independent_acceptance** — 本批证据链完整（唯一 capture、实际 exit、
   输入冻结与复核），但**独立复核仍未取得**，**不自签**；**NEXT next_integration_plan** 不在本批范围。
9. **A 轮两条真实 60–180 秒中文有声影片** — 始终 NOT_RUN，本批也没有新证据，不以诊断媒体冒充。

**未宣称**：原 17 项全通过、A 轮通过、V1 通过、独立外审通过、NativeAck/Studio 就绪——**均不宣称**。

---

## 5. 回退

本批**没有产生任何需要回退的改动**（全程只读）。第 1/2 组的 capture 与 raw log 全部保留在
`docs/execution/A/implementation-20261111/integration/e1-main-takeover/n1n2-claude-051-*`，
失败原样保留，未被新绿覆盖。
