# N1N2 055 — Expected 回归、两条真实反事实与完整 check：**A/B 绿，C 未绿**

Writer: Claude implementation child, task `task_2c2f94683492`, dispatch `ctx_1b50484550cb`,
terminal `term_878d7429b1eef9719748632e98718c49`（同一实施树、同一平铺工作区）。
授权：`.../resume-claude-20261112/EXPECTED_COUNTERFACTUAL_AND_FULL_GATE_055.md` + 同名 `.json`。
cwd `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`，HEAD `e2eff61b464d75d36598103d718cd2a75db5dfda`。

**永久源码没有改动**：本波只做验证与两条**必恢复**的临时变异；两次变异都已逐字节恢复，
35 个授权 guard 与 626 个 inputs 全部匹配，git 索引为空，HEAD 与 `AGENTS.md` 未变。

---

## 1. A — Expected 旧行为回归：**绿**

| capture | argv | 实际 exit | log sha256 |
|---|---|---|---|
| `n1n2-claude-055-expected-regression-001` | `vitest run --config vitest.config.ts tests/agent-driven/integration/created-native-ack.test.ts` | **0** | `aac4c1096f5909ca9501a302427948d08076f5196df47c0dcf20b334d5b4c110` |

实际：**85 passed (85)**，624 ms（测试本身 795 ms），626/626 inputs 匹配、0 漂移，无自有进程/端口残留。

**原 84 条的编号映射（按实际 diff 得出，不靠记忆）**：把候选的
`tests/agent-driven/integration/created-source-adoption.test.ts`…（此处为
`created-native-ack.test.ts`）与 HEAD 的同名文件逐行比较，diff 是 **+32 / -1** 行，
其中**恰好新增 1 个 `it(`**、**没有任何 `it(` 被删除**：

```
> it('refuses a candidate whose module does not export the settings and markers parsers', async () => {
```

⇒ **原 84 条全部仍在文件中且本次全部通过**；第 85 条是候选新增的
「拒绝没有导出 settings/markers 解析器的模块」这条 loader 暴露断言。
**新增数没有被冒充成覆盖**：84 是旧的、85 是新的，两个数分开陈述。

## 2. B1 — LF03 反事实：**咬住（语义红）→ 已恢复**

| 阶段 | capture | 实际 exit | 结果 |
|---|---|---|---|
| baseline | `n1n2-claude-055-lf03-baseline-001` | **0** | 1 passed / 23 skipped，log `5b5255e04afbeacffa7be8eb7f58763f3a83429c37c751218c989f9fe238799b` |
| **mutant** | `n1n2-claude-055-lf03-mutant-001` | **1** | **语义红**（见下），log `84eb469bbd4cc3d3b99891c4245720b191071eaf039271b0dd1193121d5803b0` |
| restored | `n1n2-claude-055-lf03-restored-001` | **0** | 1 passed / 23 skipped，log `0ff630c24e0403b52ea24975f8c640f74757970cb1931a56834a4da597d0f2b7` |

**精确变异**（`src/host/agent-driven/local-asset-registry.ts`，锚点匹配数 **1**，唯一）：

```diff
             const after = await handle.stat({ bigint: true });
+            // MUTATION-055-LF03 (temporary): the OLD strict identity refusal.
+            if (published && fingerprint(before) !== fingerprint(after))
+                throw conflict();
```

**mutant 的失败正是指定语义**：失败点在 `local-asset-registry.ts:538`（**注入的那一行**），
`ProductError: Local asset facts or bytes changed`（REVISION_CONFLICT），调用链
`LocalAssetRegistry.#import` → `#hashFile` ⇒ **合法发布（内容相同、只是 inode 的 change time 移动）
被错误拒绝**。**不是**语法错误、**不是**超时、**不是**模块缺失。

**恢复证明**：备份 = 原字节（sha256 `0f99ed585bc8152926b555a3139a240c80025c023db4dc690b26769e1635bb25`，
41475 字节）；恢复用**逐字节复制**，**没有** git checkout/reset/restore；
恢复后实测 sha256 与备份、与授权 guard **完全相同**，35/35 guard 匹配，626/626 inputs 匹配
（该次 mutant 运行冻结的 inputs 里只有被变异的那一个路径与现在不同，正是它被恢复回去了）。

## 3. B2 — PF03 反事实：**咬住（语义红）→ 已恢复**

| 阶段 | capture | 实际 exit | 结果 |
|---|---|---|---|
| baseline | `n1n2-claude-055-pf03-baseline-001` | **0** | 1 passed / 30 skipped，log `9acf7a065286389eb9524bc187411a8b95a542059c26338d740555daaffa6a9a` |
| **mutant** | `n1n2-claude-055-pf03-mutant-001` | **1** | **语义红**：`expected 1 to be 2`，log `23313743061d7bbdc6558ced3eb68b2b57ba24bdedece70a0bd654df0407088e` |
| restored | `n1n2-claude-055-pf03-restored-001` | **0** | 1 passed / 30 skipped，log `f0d4ad3741c719aade05e963893016fd731700b218ff451460be5ef83fc7559d` |

**精确变异**（`src/host/agent-driven/created-native-workspace.ts`，锚点匹配数 **1**，唯一）：

```diff
-  if(after)try{await after.release();}catch(error){cleanupFailures.push(error);}
+  if(after)try{await after.release();}catch(error){/* MUTATION-055-PF03: the genuine cause of the after tree is dropped */}
```

`after.release()` **仍然真实执行**（不泄漏资源），只去掉 `cleanupFailures.push(error)`，PRE 侧未动。

**mutant 的失败正是指定语义**：`native-cache-witness.test.ts:1131`
`expect(genuine.length).toBe(2)` 得到 **1** ⇒ **after（POST）树那条 genuine 释放失败原因缺失**。
**不是**编译错误、**不是**新测试不存在。

**恢复证明**：备份 = 原字节（sha256 `3702917cf6efe09287030435c1883e1cdd57eb6e0da2dff577bf3879ab965c2e`，
65816 字节），逐字节复制恢复，无 git 操作；恢复后 35/35 guard 匹配，626/626 inputs 匹配。

**控制脚本**：`docs/parallel/lane-product/A-R2-20261112/N1N2-native-source/mutation-055/run-mutation.py`
（备份 → 锚点唯一性检查 → 注入 → 跑**原** recorder → `finally` 逐字节恢复 → receipt），
连同两个补丁、两个备份与两份 receipt 都在同目录，**原 `run-recorded.py` 未改**
（sha256 仍 `88cd47ec732a340f54cdd4bb05b05878887697eebb0ddc94b1ccd7d0e434fd10`）。

## 4. C — 完整 check：**未绿（exit 1），已停止，未自修未重跑**

`n1n2-claude-055-final-check-001`，argv `corepack pnpm check`，**实际 exit 1**，
log sha256 `6c1f873507550cc9ce834d4d5e3a35cba7b947432c0413ff3fed46eb3b9aabc4`。

`package.json` 的实际脚本是
`tsc --noEmit && vitest run --config vitest.config.ts && python3 -I tests/wave2/m4a/impact-hash.golden.py tests/wave2/m4a/impact-hash.vectors.json && vite build && vite build --config vite.m5.config.ts`。

| 子步骤 | 实际状态 |
|---|---|
| `tsc --noEmit` | **实际执行，exit 0**（无输出） |
| `vitest run --config vitest.config.ts`（全量） | **实际执行，exit 1** —— 188 个测试文件、2593 个测试：**1 failed / 2591 passed / 1 skipped**，5474.25 s |
| `python3 -I … impact-hash.golden.py` | **NOT_RUN**（`&&` 在 vitest 失败处短路） |
| `vite build` | **NOT_RUN** |
| `vite build --config vite.m5.config.ts` | **NOT_RUN** |

**最早真实原因**：唯一失败的是
`tests/agent-driven/headless/owned-project-entry.test.ts`
（`starts at the real owned project chooser, preserves refresh, and opens the selected original native editor`），
在该文件 **第 31 行**：`expect(await tab.evaluate<boolean>("location.hash===''&&!!document.querySelector('.tl-scroll')"))`
得到 `false`（第 30 行的 `waitFor` 已成功，即 workspace shell 与 `[data-narralens-panel=ready]` 都已就绪）。
**该文件不在候选的 17 个已修改文件里，也不在 35 个授权 guard 里**（`git status` 未列出它），
它是一个**真实 headless 浏览器 UI 用例**（workbench 的拥有者项目选择器 → 打开原生编辑器），
在 N1N2 的十条路径与本波两条变异之外。

**同一轮全量里 N1N2 相关的套件全部通过**（这是同一次运行的事实，不是另跑）：
created-native-source-reader **91**、created-source-adoption **34**、migration-real-export **9**、
created-native-workspace **11**、committed-snapshot-host **11**、native-cache-witness **31**、
local-assets-host **24**、created-native-ack **85**、created-impact-atomic **9**、created-source-change **11**、
migration-service **26**、openfilm-migrator **7**、snapshot-store **9**、host-coordinator-integration **2**。

**没有**自修源码、**没有**改测试、**没有**改预算、**没有**重跑 check。
那个失败的 UI 用例属于本波授权之外（允许改的只有 LF04 的那一条用例），因此按规则**停在这里交 MAIN 裁决**。

## 5. 自有资源结算

- check 结束后**确实又有一个 Studio runtime 残留**（pid `3778510` supervisor + `3778517` worker，
  `vendor/openfilm/packages/openfilm/studio/server/main.mjs`，占 127.0.0.1:4747/4748）：
  启动时间 **Sat Nov 14 02:18:47 2026**，**落在本次 check 的运行窗口内**
  （2026-11-13T17:44:14Z → 19:18:16Z，即本地 01:44:14 → 03:18:16），
  其父进程已退出、已被 `/init` 收养 ⇒ **是本轮 check 自己留下的孤儿**。
  它**不是** 054 的隔离 harness 起的：它的环境里**没有** `OPENFILM_HOME`（用的是默认 `~/.openfilm`），
  说明是**全量套件里另一个用例**（打开原生编辑器那条路径）起的，且那个用例没有做私有 home 隔离。
- 处置：**按身份**（精确 cmdline + 启动时刻落在本轮窗口 + 已被 /init 收养）向这两个 pid 发 SIGTERM，
  复核：**4747/4748 无监听、两个进程都不存在**。**没有**广域 kill、**没有**按名字扫、
  **没有**碰别的进程（那台机器上 IDE 的 `playwright-mcp` 与 navia 的 `node --test` 未触碰）。
- `/tmp` 的 `narralens-*` 从 234 变为 **298**：这是全量套件自己建的临时目录，**未删未扫**。
- 全量套件里那个失败用例在它自己的断言之前建了一个**空的**证据目录
  `docs/execution/A/logs/owned-project-entry-1794596202222/`（同一路径还有一个 **2026-11-13 12:48** 的旧目录，
  不是本轮产物）——两者都是**运行产物**，未被本波删除或改写。
- 全程 Headless 静音、loopback 单重型槽；未读 J 盘、未联网下载、未付费、未外传、未安装或改配置；
  **没有 429**；没有工具格式异常。

## 6. 冻结、索引与不变性

- check 结束后复核：**626/626 inputs 匹配、0 漂移**；**35/35 授权 guard 匹配**；
  `git diff --cached` = **0**（索引为空）；已跟踪 dirty 仍 **17** 个文件；untracked src/tests 仍 **6** 个；
  `AGENTS.md` sha256 仍 `37300463…4542b`；HEAD 仍 `e2eff61…`。
- 本波 check 期间 real-export 用例按授权自产了**新**媒体（capture id `n1n2-claude-055-final-check-001`，
  新目录同一 evidence 根下的新文件名，**没有**覆盖任何已封存产物）：
  `mig03-migration-export` / `mig03-export-first` / `en05-migration-export` /
  `en05-export-copy-after-rollback` = `bbf30366cec4268effe2e625a94eb3dda133fa2156b05a45a91a6e494bbfb8ad`（917726 字节），
  `mig03-export-after-middle-edit` = `7870320dc14505149afd161abeab7f954aae83f3716feb1aba4943c58eadcf07`（939596 字节）。
  **两次独立运行得到逐字节相同的 MP4**（与 053/054 相同）——渲染是可复现的。
  本轮的证据索引：`validity-index-053-n1n2-claude-055-final-check-001.json`
  sha256 `d3fcc80a4fbdc03bc85777c21c414a8e4e06d5307c5e501760248897a820f561`。

## 7. 原 17 项的覆盖与缺口（按本轮实际证据）

| 组/要求 | 状态 | 依据 |
|---|---|---|
| R01 producer_chain | **有证据** | reader 的 R00 两条 + adoption 34 + 本波 full run 内全绿 |
| R01 independent_trees | **有证据** | reader 的 G07（两棵树/嵌套与空目录）31 条全绿 |
| R02 tamper_and_authority | **有证据** | reader 的 F/P/G/K01/K06 全绿 |
| R03 complete_dependencies | **有证据** | reader 的 G06（settings 删除/空目录/字幕翻译出生）全绿 |
| R04 native_cache | **有证据** | native-cache-witness **31/31**（本波 full run 内） |
| R05 actual_probe | **有证据** | reader 的 F09/F05/G05 + 本波 real-export 的 ffprobe/完整 decode 证据（真实 MP4 落盘并有 SHA） |
| R05 child_lifetime | **有证据** | G05 真实挂死子进程 kill+reap、真实溢出、信号、取消；另有 054 新增的真实 child 边界用例 |
| R06 native_bytes_and_order | **有证据** | reader 的 P06/P07/F10 全绿 |
| R07 budgets / fd_lifetime / cleanup_uncertainty / drain | **有证据** | reader 的 P07/P09/G01/G02/F01/F07 全绿 |
| R01/R02 lease_isolation | **有证据** | reader 的 R02 租约族全绿 |
| REG existing_behavior | **有证据（本波 A）** | 本波 85/85（其中原 84 全部保留通过）+ legacy 44 + witness 31 |
| EVIDENCE frozen_capture | **有证据** | 每条命令唯一 capture、实际 exit、输入冻结与复核、字节备份、可采信索引 |
| **REVIEW independent_acceptance** | **仍缺** | 冻结 commit 的独立复核**未取得**；本波**不自签** |
| **NEXT next_integration_plan** | **不在本波** | 下一接线未开始 |
| **完整 check 门** | **缺（红）** | headless UI 用例 `owned-project-entry.test.ts:31` 红；python golden 与两次 vite build **NOT_RUN** |
| A 轮两条 60–180 秒中文有声影片 | **仍 NOT_RUN** | 诊断媒体**不冒充**；**不宣称** |
| 全量套件里的 Studio 生命周期 | **缺（未授权修）** | 全量里另一个用例起的 Studio 没有私有 home 隔离，本轮已按身份结算，但它**不是**本波可改的范围 |

## 8. 未宣称

不宣称完整 check 通过、不宣称原 17 项全部通过、不宣称 A 轮/V1/冻结独立复核通过；
不宣称 A 轮两条中文影片或任何 UX/human 通过；不宣称下一接线已实现；
**没有** Git index/commit/reset/stash/checkout/push，没有 force-add，没有新 worktree。
