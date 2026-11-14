# N1N2 056 — 完整门禁的真实失败诊断、遗留渲染隔离与**完整 check 全绿**

Writer: Claude implementation child, task `task_f98911dafcda`, dispatch `ctx_59425c510934`,
terminal `term_2890771813f7a7777b1aeb3a17493e4c`（同一实施树、同一平铺工作区）。
授权：`.../resume-claude-20261112/FULL_GATE_UI_DIAGNOSTIC_AND_LEGACY_ISOLATION_056.md` + 同名 `.json`。
cwd `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`，HEAD `e2eff61b464d75d36598103d718cd2a75db5dfda`。

**只改了三个授权的测试文件**，生产/前端源码/合同/配置/固定上游/pin/运行器/索引**未改**，
没有 git 动作。已跟踪 dirty 由 17 个变 **20** 个（多的正是这三个），索引仍为空，`AGENTS.md` 未变。

| 文件 | 相对 056 基线 | 最终 sha256 |
|---|---|---|
| `tests/agent-driven/headless/owned-project-entry.test.ts` | +31 / −2 | `652356e57e3d0ac59e1c478178acdd707dc0a102f8a95938fc756a713ee85f45` |
| `tests/wave2/m4b/adoption-route.test.ts` | +30 / −2 | `471d1c3337cf5e939cf005a48f59b09bf7e09dd42873bd04f2826f6c8906818b` |
| `tests/wave2/m4c/history-media-and-failure.test.ts` | +32 / −4 | `53727ee85083eac79320b8e0aae1f32e67baa00c6b6d8110e9804d83ca5e77f2` |

---

## 1. UI：先取真实状态，再修（不是把一个布尔合取当根因）

**诊断采集**（写在测试内，断言之前）：两个条件**分别**取值（`hash`、`hasTimelineScroll`/`timelineScrollCount`）、
URL 脱敏到 origin+path、`readyState`、DOM 事实、CDP frame tree、console 异常、网络响应/失败与其时间顺序，
以及**断言前**的截图（`native-ready-before-assert.png`）与 `native-ready-state.json`。

**`n1n2-claude-056-owned-entry-001`（exit 0，隔离运行通过）**给出的真实状态：
`hash:""`、`hasTimelineScroll:true`、`timelineScrollCount:1`、`readyState:"complete"`、
`hasWorkspaceShell/hasPanelReady:true`、`consoleEvents:[]`、`failedRequests:[]`、
frameTree 根为 `/projects/<id>?target=project_<id>`（1 个子 frame）。
⇒ **hash 不是错的、选择器没变、原生页面没报错**。

**根因（来自源码，不是推断）**：`src/host/m5/studio-host-bridge.ts` 把 Narralens 面板作为
**deferred module script**（`script.type="module"`）加载，而固定 Studio 的**自己的**模块同样是 deferred；
两者是**两个互相独立的 module graph**，**没有任何东西**保证面板的 `data-narralens-panel=ready`
先于 Studio 自己的 `.tl-scroll` 出现。旧 `waitFor` 等的是**比断言更弱的状态**，然后断言却要求更强的状态
——这是 harness 缺陷，不是产品事实。

**修正**：**同一个** `waitFor` 的就绪表达式补齐为断言真正要求的状态
（`…&&!!document.querySelector('.tl-scroll')&&location.hash===''`），
**不额外延长 30 s 预算、不 sleep、不删任何原生断言**；
`expect(...)` 本身**一字未改**，chooser/刷新/打开原生/无 legacy 访问/无异常/无 commit 变动/无 NativeAck
全部保留。**没有**改 app 或 server。

`n1n2-claude-056-owned-entry-002`：**exit 0**（1 passed，14.3 s）。

## 2. 两个遗留 wave2 渲染用例：精确隔离交互前置

两个文件各自的 `render` helper 现在：
- 在**本工程自己的副本**里写上游自己支持的 `.film/opened` 存在标记
  （明确写清：只表示“不要交互式打开这个工程”，**不是**人已打开、**不是**Studio 展示过、**不是**UX 通过）；
- 给 child **自己的** `OPENFILM_HOME`/`OPENFILM_LIBRARY`（自有 temp 目录）+
  `OPENFILM_NO_UPDATE_CHECK=1` + `OPENFILM_NO_BROWSER=1`，**`HOME` 一概不碰**；
- **保留原 600000 ms / 8 MiB 预算**，保留真实媒体、真实原生编辑、恢复/回滚错误门、
  clip 结构与**实际 ffprobe 900 帧**的全部原断言（**没有**复制 500 行新框架，**没有**改生产）；
- 运行后检查**自己私有 home**里有没有 Studio 广告自己：有就**fail closed**
  （抛 `THE_RENDER_STARTED_A_STUDIO:…`），**不全局 kill、不依赖事后人工 SIGTERM 代签**；
  私有 home 在 `finally` 里删除。

`n1n2-claude-056-legacy-media-001`：**exit 0，44 passed (44)**（m4b 35 + m4c 9），
含 “restores three native clips, renders them with the pinned upstream and decodes 900 frames”。
**运行后本 lane 没有任何残留**：4747/4748 **无监听**、**无 studio 进程**、**无遗留 media 子进程**、
`/tmp` 里**没有**留下私有 home（计数 0）。

## 3. 此前 NOT_RUN 的三个步骤：各自真实跑了一次，全绿

| capture | argv | 实际 exit | 结果 |
|---|---|---|---|
| `n1n2-claude-056-python-golden-001` | `python3 -I tests/wave2/m4a/impact-hash.golden.py tests/wave2/m4a/impact-hash.vectors.json` | **0** | 8 个向量、**0 failures**（base/arrays-reversed/split-range/no-locks/restore-operation/unicode-consumer/later-expiry/control-revision） |
| `n1n2-claude-056-vite-build-001` | `corepack pnpm exec vite build` | **0** | 48 modules，built in 911 ms |
| `n1n2-claude-056-vite-m5-build-001` | `corepack pnpm exec vite build --config vite.m5.config.ts` | **0** | 52 modules，built in 1.03 s |

**构建产物 SHA256**（最终 check 重建后与独立构建**逐字节相同**）：
`dist/index.html` `1b39be2952d52a0c2eb0cc174fa01766e6f75042eddfb8bad3674cdd8958a17a`；
`dist/assets/index-CNuf5gq2.css` `686b4e292f864a90d269a375271155b5431eef958f73c438cacb29f81940fedf`；
`dist/assets/index-BgsCCX5J.js` `2b1035075d8db7b3a05825e9298d25af3c7b446dae40d8ed18714bbfaa3cbfce`；
`dist/m5/narralens-panel.css` `c41f7d7dd43dc589642164f7c194a075df87952f41a59dd731cc18ad16cb09ef`；
`dist/m5/narralens-panel.js` `a34c28e8ef67b66b59960c889486f324bdc0b5393c06a2f70454008ec9d69832`。

## 4. 完整门禁：**绿**

`n1n2-claude-056-final-check-001`，argv `corepack pnpm check`，**实际 exit 0**，
log sha256 `61befc15eb2932eb11882e81d9ec3450d8b8e96fe89667827a4d0c24d9d11fcc`。
脚本实际是 `tsc --noEmit && vitest run --config vitest.config.ts && python3 -I … && vite build && vite build --config vite.m5.config.ts`：

| 子步骤 | 实际状态 |
|---|---|
| `tsc --noEmit` | **实际执行，exit 0** |
| `vitest run`（全量） | **实际执行，exit 0** —— **188 个测试文件全通过，2592 passed / 1 skipped (2593)**（055 那条红的 `owned-project-entry` 本轮通过） |
| `python3 -I … impact-hash.golden.py` | **实际执行，exit 0**，8 vectors / 0 failures |
| `vite build` | **实际执行，exit 0**，built in 911 ms |
| `vite build --config vite.m5.config.ts` | **实际执行，exit 0**，built in 1.03 s |

日志里 `Failed Tests` / `FAIL ` 出现次数 **0**。

**冻结与自有资源**：check 结束后 **626/626 inputs 匹配、0 漂移**；**4747/4748 无监听**、
**无 studio 进程**、无遗留 media 子进程；**35 个未授权改动的 guard 全部匹配**；
索引为空；`AGENTS.md` sha256 仍 `37300463…4542b`；HEAD 仍 `e2eff61…`。
（055 那次 check 结束后确实留下过一个 studio 孤儿（我当时按身份结算了）；**本轮结束后没有**。
本轮**没有**改动那个用例的 Studio 生命周期，所以**不宣称**修好了它——这里只报告观察到的事实。）

**本轮 check 自产的媒体**（capture id `n1n2-claude-056-final-check-001`，新文件名，**未覆盖**任何历史工件）：
5 个 MP4 的 digest 与此前三次运行**逐字节相同**
（`bbf30366cec4268effe2e625a94eb3dda133fa2156b05a45a91a6e494bbfb8ad` 917726 字节 ×4、
`7870320dc14505149afd161abeab7f954aae83f3716feb1aba4943c58eadcf07` 939596 字节 ×1）；
证据索引 `validity-index-053-n1n2-claude-056-final-check-001.json`
sha256 `55a39c885ca3e86067c067fe2a4deee3ac041fa7221c6f3bf521e0bae83e047a`，
仍是 **active = `n1n2-claude-053-real-export-003`、5 admissible / 6 refused、11 条逐条裁定**。

## 5. 两个红灯（保留，未被新绿覆盖）

- `n1n2-claude-056-tsc-003`：**exit 2** —— 我写成了 JS 里**不存在**的 `try/catch/else`（两个 TS1128）。
  已改为显式标志位；`056-tsc-004` exit 0。**该红灯的 capture 与 rawlog 仍在**。
- `n1n2-claude-056-owned-entry-001` 是**诊断绿灯**（隔离运行本就通过），真正的红来自 055 全量里的那次；
  本波**没有**重跑全量来“制造”一次失败，也没有把布尔合取当成根因。

## 6. 原 17 项覆盖与缺口（按本轮实际证据）

| 项 | 状态 |
|---|---|
| R01 producer_chain / independent_trees | 有证据（reader 91 + adoption 34 + 本轮全量 2592 通过） |
| R02 tamper_and_authority | 有证据（reader F/P/G/K01/K06 + 055 两个反事实） |
| R03 complete_dependencies | 有证据（reader G06） |
| R04 native_cache | 有证据（witness 31） |
| R05 actual_probe / child_lifetime | 有证据（reader F09/F05/G05 + real-export 的真实 MP4 与 decode + 054 的真实 child 边界用例） |
| R06 native_bytes_and_order | 有证据（reader P06/P07/F10） |
| R07 budgets / fd_lifetime / cleanup_uncertainty / drain | 有证据（reader P07/P09/G01/G02/F01/F07） |
| R01/R02 lease_isolation | 有证据（reader R02 族） |
| REG existing_behavior | 有证据（055 的 Expected 85/85，其中原 84 全部保留通过；legacy 44；witness 31；本轮 legacy-media 44） |
| EVIDENCE frozen_capture | 有证据（每条命令唯一 capture、实际 exit、输入冻结与复核、字节备份、可采信索引） |
| **完整 check 门** | **本轮绿**（188/188 文件、2592 passed / 1 skipped、5 个子步骤全部实际执行且 exit 0） |
| **REVIEW independent_acceptance** | **仍缺** —— 冻结 commit 的独立复核**未取得**，**不自签** |
| **NEXT next_integration_plan** | 不在本波 |
| **A 轮两条 60–180 秒中文有声影片** | **仍 NOT_RUN**，诊断媒体**不冒充** |
| Studio 生命周期缺口 | 055 全量留下过 studio 孤儿；本轮无残留，但**未定位**归属、**未宣称**修复 |

## 7. 未宣称

不宣称原 17 项**全部**通过（REVIEW 仍未取得）、不宣称 A 轮/V1/human/UX 通过、
不宣称任何两条中文影片或下一接线；**没有** Git index/commit/reset/stash/checkout/push、
没有 force-add、没有新 worktree；全绿**只是当前 dirty 候选的门**，冻结 commit 与独立复核由 MAIN 另行办理。
