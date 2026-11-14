# N1N2 054 — 子进程预算恢复、失败真实结算与证据可采信索引

Writer: Claude implementation child, task `task_622812dde3e3`, dispatch `ctx_848a60771d7d`,
terminal `term_5ecc204bc3e627021782595777253862`（同一实施树、同一平铺工作区，未新建 writer/worktree）。
授权：`.../resume-claude-20261112/BOUNDED_EXPORT_HARNESS_AND_VALIDITY_054.md` + 同名 `.json`。
cwd `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`，HEAD `e2eff61b464d75d36598103d718cd2a75db5dfda`。

**只改了一个文件**：`tests/m2.3/migration-real-export.test.ts`
（相对 054 基线 `9fa42cf0…776cb`：**+593 / -44 行**；最终候选 sha256 `6dc3e62eaf0095b4178c60226c10e5f5e8e60fbef69f7ba4d6f02627f18525fc`）。
生产代码、固定上游、其它测试/夹具、配置、运行器、索引**未改**；没有 git 动作。
本波新证据目录：`docs/evidence/N1N2/real-export-054/`；**053 目录只读**，其最后一个文件仍是
capture 003 写入的（01:14），本波未写入、未删除、未覆盖。

---

## 1. 子进程边界：恢复预算、实时登记、失败真实结算

| 边界 | 053 的退化 | 054 的实现 |
|---|---|---|
| 时间预算 | `spawn` 丢了 `timeout: 600000` | **恢复为 600000 ms**（`RENDER_TIMEOUT_MS`，不放宽） |
| 输出上限 | 丢了 `maxBuffer: 8 MiB`，字符串无限累积 | **恢复为 8 MiB**（`RENDER_MAX_OUTPUT_BYTES`），且**运行中就计数**：超限即停，只保留尾部 8 KiB |
| child 身份 | `context.children` 在 Promise `close` **之后**才登记 | **spawn 之后、第一次 await 之前**登记 pid/argv/cwd（`register` 回调） |
| 失败结算 | 只 reject，后台可能继续写 | 超时/输出超限/取消/spawn 错误**同一路径**：发信号 → 等 child **真正退出**（Promise 在 child 自己的 `close` 上结算）→ **reap** → 保留 **primary 原因 + cleanup 原因** |
| 定时器与竞争 | 无 | 结算时清理 timer/listener；`close` 与 `error` **只结算一次** |

真实字节能被复核：本次 capture 002 的日志里每个导出的 `render_child` 都带
`outcome/exit/signal/stdout_bytes/stderr_bytes/killed/settled` 与当时生效的 budget。

## 2. 新增的真实子进程边界用例（同一 runner，小预算，真实 `node -e` 子进程；主 render 链未被 mock）

`054-export-harness-002` 实测 **9 passed (9)**，其中新增 7 项：

| 用例 | 实际结果 |
|---|---|
| 挂起的 child 超过预算被 kill 并 reap | `outcome=timeout`、`killed=true`、`settled=true`、**pid 事后已不存在**、primary 与 cleanup 两个原因都在 |
| stdout 洪水 | `outcome=output_limit`、`note` 指明 stdout、尾部 ≤ 8 KiB、pid 已消失 |
| stderr 洪水 | `outcome=output_limit`、`note` 指明 stderr、尾部 ≤ 8 KiB、pid 已消失 |
| 取消 | `outcome=aborted`、`killed=true`、`settled=true`、pid 已消失，且**没有**等满 60 s 预算 |
| 私有 home 广告了一个没有可验证 pid 的 Studio | `settled=false`、`actions=[]`、原因写明「without any verifiable pid … NOT settled」——**不是**「没什么可杀所以干净」 |
| 无法证明归属的 pid | **一个信号都没发**（`actions` 无 SIGTERM/SIGKILL）、`settled=false`、**那个别的进程仍然活着** |

**归属证明**取自内核而不是可变 JSON：pid 必须存活、其 `/proc/<pid>/environ` 必须带本用例私有的
`OPENFILM_HOME`、且其 `/proc/<pid>/stat` 的启动时刻必须在本用例之后；三条缺一即**不发信号**并记原因。

## 3. 真实渲染仍然真实通过（未被 mock、未换链）

`MIG-03` 与 `EN-05` 两个真实用例照旧通过：两次导出 **sha256 不同**
（`bbf30366cec4268effe2e625a94eb3dda133fa2156b05a45a91a6e494bbfb8ad` / 917726 字节 与
`7870320dc14505149afd161abeab7f954aae83f3716feb1aba4943c58eadcf07` / 939596 字节），
**帧数相同**；每次导出都经 ffprobe 真实计数（**900 帧**、1280×720、容器 30.0 s）与
**音频流实测**（`aac` 48000 Hz、2 声道、30.0 s），并经 `ffmpeg -nostdin … -f null -` **完整解码**（exit 0）。
中镜 `shot-002` 的原生编辑真实生效（rev `91f328c7e5e80673` → `22af153f22a70eea`），
关后重开仍见 3 个 clip，源工程 `treeDigest` 前后相等。

## 4. 证据可采信索引（机器可读）

`docs/evidence/N1N2/real-export-054/validity-index-053-n1n2-claude-054-export-harness-002.json`
**sha256 `dbb5d825542227cef2967f63570a1f4b011f5a8b9f5bc167be8f4ba7aab70db5`**（独立 `sha256sum` 复核一致）。

索引**逐一**列出 053 的 **11 份** manifest，每条给出：文件**实际** sha256、manifest **声称**的 sha256、
实际/声称字节数、重新 ffprobe 出来的**音频事实是否真实**、以及裁定：

- **ACTIVE / ADMISSIBLE：5 条** —— capture `n1n2-claude-053-real-export-003` 的全部工件
  （digest 相符、audio 字段为真实值）。
- **REFUSED：6 条** —— 001/002 的 manifest（`media.audio` 字段无效：真实导出**有** AAC 音频，
  而那份字段写的是 `null`）；其中 `manifest-mig03-export-first-1.json` 的工件
  **实际 digest `7870320d…` ≠ 声称 `bbf30366…`**（名实不符）。
- `known_defects` 明确写了两条 053 缺陷及其状态（保留为缺陷证据、**不**可采信）。
- **没有**把整个目录 glob 成 PASS：验收入口只有那**一个**明确 active 的 capture 组。

## 5. 本波真实命令、实际 exit、日志 SHA

| capture | argv | 实际 exit | log sha256 |
|---|---|---|---|
| `n1n2-claude-054-tsc-001` | `corepack pnpm exec tsc --noEmit` | **2** | `2cf780603789609192f15ce37519c7a7b2c7c128f8ff6941ae297f8465ef82ce`（我引入的 `child.stdout` 可空类型错误） |
| `n1n2-claude-054-tsc-002` | 同上 | 0 | `e3b0c442…855` |
| `n1n2-claude-054-export-harness-001` | vitest `tests/m2.3/migration-real-export.test.ts` | **1** | `a10399233ce5ed3c5177dd3180fb4a0200a06355964e1b0f55f4f527a111c6fd`（7 passed / 2 failed：取消用例自锁、我写错的 manifest 条目数） |
| `n1n2-claude-054-tsc-003` | `tsc --noEmit` | 0 | `e3b0c442…855` |
| **`n1n2-claude-054-export-harness-002`** | vitest 同文件 | **0** | **`01628dd0fe5950f2393630bd715f60bc83336685ff1d260b1ab3de9b4346897a`**（**9 passed (9)**） |

**两个红灯都被修正并保留**：取消用例之前在 `finally` 里才 abort——那是在 `await` **之后**，而死锁的正是这个 await；
改为**在 child 运行期间**由定时器触发 abort。manifest 条目数是我写错（053 目录实为 11 份，索引本身是对的）。

`054-export-harness-002` 与 `054-tsc-003` 结束后复核：**626/626 inputs 匹配、0 漂移**；
`054-export-harness-001` 的唯一漂移是 `tests/m2.3/migration-real-export.test.ts`（我被授权修改的那一个文件，
`70ddc217…` → `6dc3e62e…`），**其它 625 个 guard 零漂移**。

## 6. 自有资源结算（内部结算，非事后手动清理）

- 两次用例的日志：`studio_started=false`，`cleanup={"settled":true,"actions":[],"reasons":[]}`
  （MIG-03 三个 CLI 子进程 pid `3721675,3723260,3724604`；EN-05 两个 pid `3726688,3727825`）。
- 运行后独立复核：**4747/4748 无监听**、**无 studio server 进程**、**无遗留挂起子进程**、
  `/tmp` 的 `narralens-*` 计数 234（与 044/051/052/053 一致，未删未扫）。
- 机器上另有 IDE 自己的 `playwright-mcp` 与 `/mnt/c/workSpace/navia/…` 的 `node --test`，**不属本 lane，未触碰**。
- 全程 Headless 静音、loopback 单重型槽；未读 J 盘、未联网下载、未付费、未外传、未安装或改配置；
  **没有 429**，没有工具格式异常；`HOME` 未被设置或改写，真实 `~/.openfilm` 未被读写。

## 7. 只据事实的两点更正（不再沿用旧描述）

1. **本波改的是测试 harness，不是生产 `Host`**：`created-native-workspace.ts`、
   `committed-snapshot-authority.ts` 等生产文件**未改**；「固定 CLI 的交互前置」这一判定来自只读阅读上游
   （`bin/openfilm.mjs:205..219`、`studio/client.mjs:150..179`），**不是**生产关闭路径的缺陷结论。
2. **git 事实**：`tests/agent-driven/integration/created-source-adoption.test.ts` 是**已跟踪且被修改**的文件
   （`git status` 显示 ` M`），**不是** untracked；本波 `git diff --cached` 为 **0**（索引为空），
   HEAD 仍是 `e2eff61b…`，受保护 `AGENTS.md` sha256 仍是 `37300463…4542b`。
   另外，本报告只用**实际命令、实际 exit、实际字节与实际 digest**作证据，**不以耗时充当 decode 证据**。

## 8. 未宣称 / 未做

- **未**跑 Expected 84 断言回归、两条反事实、全量、build、mutation；**未**做任何下一阶段接线；
  **未**动 git 索引或提交。
- 原 17 项、A 轮、V1、冻结独立复核：**均未宣称**。
- 诊断媒体**不冒充** A 轮两条 60–180 秒中文有声作品；旧 migrator **不宣称**保留原视觉保真；
  Hypit 源**没有** fresh 付费渲染。
- 053 目录的 001/002 工件与 manifest **保持原样**，是缺陷记录，**不是**可采信证据。
