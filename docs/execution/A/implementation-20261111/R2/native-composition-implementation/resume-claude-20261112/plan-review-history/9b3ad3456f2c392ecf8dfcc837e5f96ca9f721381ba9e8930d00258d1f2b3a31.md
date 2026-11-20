# N1N2 037 — 自有子进程/监听器/临时物清理收据（只读观察 + 一次定向清理）

Writer: Claude implementation child, task `task_5dcbe8192764`, dispatch `ctx_ae73a82c85e9`,
terminal `term_2dc99ebb-91cc-4ec3-91c9-28fd81bfb66f`。
cwd `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`（WSL）。
checkpoint：`USER_AUTHORIZED_RESUME_20261113_POST036.md`（**文档期**：只读诊断 + 必要自有清理 + 自身文档，不改源码/测试/tools/config/fixtures/索引，不编译、不跑测试、不跑 Host/媒体/浏览器/构建）。

本收据是**当前观察**（observation now），不是对任何历史时刻的倒填。

---

## 1. 观察方法与时间

| 观察 | 命令 | 时间（本地 +08:00） |
|---|---|---|
| 进程/监听器/浏览器 | `ps -eo pid,ppid,etimes,stat,comm,args`、`ss -ltnp`、`/proc/<pid>/environ` 只读读取 | 2026-11-13T15:04:27 ~ 15:12 |
| 归属扫描 | 遍历 `/proc/<pid>/environ` 找 `npm_lifecycle_event=check` 的存活进程 | 2026-11-13T15:06 |
| 临时物清单 | `ls -1d /tmp/narralens-*`（仅顶层，不递归） | 2026-11-13T15:08 |
| 仓库状态 | `git rev-parse HEAD`、`git diff --cached --quiet`、`git status --porcelain=v1`、`sha256sum` ×15 | 2026-11-13T15:11 |

**未运行**：任何测试、编译、Host、ffmpeg/ffprobe、浏览器、构建、网络、安装；**未** add/commit/reset/stash/checkout/push。

---

## 2. 发现的自有子进程（036 全量门禁遗留）

`ps` 中**没有** vitest、ffmpeg、ffprobe、`run-recorded.py`、python http.server、chrome/chromium/playwright/puppeteer 进程。
但 `/proc` 归属扫描发现 **2 个存活进程**确证属于本 lane 的 036 全量运行：

| PID | PPID | 启动时间 | 命令 |
|---|---|---|---|
| 2728937 | 1（已孤儿） | Fri Nov 13 12:11:44 2026 | `/usr/bin/node .../Narralens-openfilm-m1b/vendor/openfilm/packages/openfilm/studio/server/main.mjs` |
| 2728944 | 2728937 | Fri Nov 13 12:11:44 2026 | 同上（父进程 fork 出的监听实例） |

### 2.1 归属证据（可证明，非推测）

1. `/proc/2728944/environ` 内含
   `VITEST=true`、`npm_lifecycle_event=check`、
   `npm_lifecycle_script=tsc --noEmit && vitest run --config vitest.config.ts && python3 -I tests/wave2/m4a/impact-hash.golden.py tests/wave2/m4a/impact-hash.vectors.json && vite build && vite build --config vite.m5.config.ts`、
   `OLDPWD=/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`、
   `npm_package_json=/mnt/c/workspace/videoworkline/Narralens-agents/main-integration/package.json`、
   `npm_config_user_agent=pnpm/10.33.0 … node/v22.22.1 linux x64`
   ⇒ 该进程的父命令链正是 036 的 `corepack pnpm check`（argv 见 `BATCH_036_GRANT.json` steps[0].argv）。
2. `/proc/2728937/cwd` = `/tmp/narralens-m4a-DfCxWN/migrations/mig_80934aea59bf4fea82aeb6ea6f02bb65 (deleted)`
   ⇒ 工作目录是 `tests/wave2/m4a/harness.ts:60` 的 `mkdtemp(join(tmpdir(),"narralens-m4a-"))` 根，已被测试删除（进程仍在）。
3. `/home/administrator/.openfilm/logs/studio.log` 末行 `2026-11-13T04:11:45.808Z OpenFilm Studio · http://127.0.0.1:4747`
   = 12:11:45 本地，与进程启动秒级吻合。
4. 监听：`127.0.0.1:4747`（fd 21）与 `127.0.0.1:4748`（fd 22），持有者 2728944。

### 2.2 采取的动作（定向，非全局）

```
kill -TERM 2728944 2728937        # exit=0，仅这两个 PID
```

- 事前：`ss -ltnp` 命中 4747/4748 → 持者 2728944。
- 事后：`ps -o pid,stat,args -p 2728937,2728944` → **无输出**（两进程均已退出）；
  `ss -ltnp | grep -E ':4747|:4748'` → **无命中**（端口已释放）。
- **未**使用全局 kill、**未**按 tmp 前缀批量删除、**未**触碰任何不属本次运行的进程。

### 2.3 明确未触碰（保留）

| 对象 | 数量 | 处置 |
|---|---|---|
| `/tmp/narralens-n1n2*`（历史 parse 目录） | **170** | **全部保留**，未删、未改 |
| `/tmp/narralens-*` 其余（import/upload/registry/m5/m1a/…） | 64 | 保留（多属其它 session 与历史运行，归属不可证 ⇒ 不动） |
| `fixtures/d1-30s/assets/generated/*`（真实媒体，本 worktree 存在：3.3MB mp4 / 5.7MB wav） | 3 | 保留 |
| `tests/fixtures/m2.1/snapshot-project/assets/generated/*`（**缺失**的 3 个不透明占位） | 0 | 未创建（属 LF01 待裁决范围，未获授权） |
| 其它无关 node 进程（dsh web、playwright-mcp、context7-mcp、hook-relay、fams-service-controller、vite preview、yue2-serve/8016/8020、各 codex 会话监听） | — | **未触碰**（非本 lane 所有） |

---

## 3. 仓库与在途状态（观察时刻）

- `HEAD` = `e2eff61b464d75d36598103d718cd2a75db5dfda`（未变）。
- **索引为空**：`git diff --cached --quiet` → `INDEX_EMPTY`。
- 已跟踪 dirty（8 个，与 036 前一致）：
  `AGENTS.md`（MAIN 保护的用户改动）、`src/adapters/openfilm/openfilm-upstream.ts`、
  `src/host/agent-driven/committed-snapshot-authority.ts`、`src/host/agent-driven/created-native-workspace.ts`、
  `src/host/m5/openfilm-native-expected.ts`、`tests/agent-driven/integration/created-draft-processor.test.ts`、
  `tests/agent-driven/integration/created-native-ack.test.ts`、`tests/agent-driven/integration/helpers/created-draft-fixture.ts`。
- 未跟踪条目 1228（含 036 捕获文件与自身证据文档）。
- **15 个候选源码/测试字节与独立预审表逐字一致**（无漂移）：
  `native-cache-witness.ts 85b1e804…`、`created-native-workspace.ts 32d5adae…`、`committed-snapshot-authority.ts 1c53360e…`、
  `openfilm-native-expected.ts 19110e45…`、`openfilm-upstream.ts 29a0827a…`、`retained-native-closure.ts 776331d6…`、
  `created-native-source-reader.ts f00e0278…`、`native-cache-witness.test.ts eb5c71c9…`、`created-native-source-reader.test.ts f2e7cc84…`、
  `native-source-fixture.ts 7160a285…`、`created-draft-fixture.ts 59788a8f…`、`created-native-workspace.test.ts 439d4690…`、
  `committed-snapshot-host.test.ts bfd0c637…`、`created-native-ack.test.ts 5f50db85…`、`created-draft-processor.test.ts 684df1c2…`。
  （与 `independent-pre-freeze-review-021/REVIEW.md` 的字节表逐项相同。）

**在途 writer/测试**：观察时刻**无**本 lane 的 vitest/ffmpeg/ffprobe/编译器/录制器进程；唯一存活的本 lane 痕迹是上面已终止的两个孤儿。

---

## 4. 未宣称

- 不宣称这是任何历史时刻机器状态的记录；只宣称上面命令在记录时刻的返回值。
- 不宣称全量门禁通过；036 终态是 **exit 1**（8 failed files / 47 failed / 2513 passed / 1 skipped，
  log SHA256 `3a58fadcd86ed1e269089d107d4243318208c18210dd796b5f0135d3e1895d02`），失败全部保留。
- 不宣称 N1/N2 通过、不宣称独立外审、不宣称 NativeAck/Studio/A 影片/V1。
- 不宣称 429 恢复授权可再次自动重试；本次无新 429。

## 5. 关联产物

- 统一修正方案（本次同批交付）：`n1n2-claude-021-pf01-pf03-implementation-plan.md`（已按 037 要求改写为 PF01–PF03 + LF01–LF05 的统一可实施方案；
  改写前字节 SHA256 `21df73c88a2d4773ceafacf825810967af81ff6ddd58697a95c2166231cc32b2`，同字节副本另存于 MAIN
  `resume-claude-20261112/plan-review-history/21df73c8….md`）。
- 036 原始捕获（未改写）：`docs/execution/A/implementation-20261111/integration/e1-main-takeover/n1n2-claude-021-final-check-001.{txt,result.json,exit,cmd.json,inputs.json}`。
