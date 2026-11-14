# N1N2 052 — LF04 真实第二项目构造修正、原因证实与剩余四组验证（全绿）

Writer: Claude implementation child, task `task_e354a43f1e16`, dispatch `ctx_fe79a6bd8195`,
terminal `term_cfe0f050c10d656973004cdf346308c8`（同一实施树、同一平铺工作区，未新建 writer/worktree）。
授权：`.../resume-claude-20261112/LF04_FIX_AND_REMAINING_VALIDATION_052.md` + 同名 `.json`。
cwd `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`，HEAD `e2eff61b464d75d36598103d718cd2a75db5dfda`。

**只改了一个文件、一个用例**：`tests/agent-driven/integration/created-source-adoption.test.ts` 的
`LF04 refuses a REAL impact and a REAL transaction of another project, and moves no authority`
（相对 052 基线 `8ab6dfcd…97e`：**+54 / -10 行，全部在这个用例内**）。
生产代码、其它用例、fixture/helper、配置、pin、索引**未改**；没有 git 动作。

---

## 1. 先证实原因，再修 case（推断没有被当成事实）

**第一步（诊断红灯，已保留）**：`n1n2-claude-052-lf04-001`，**实际 exit 1**，
log sha256 `e57fb9380b61d63eb2ffa253f43d3ce49237f4e305527fe67645b8d56725cabc`。

只补了 HTTP 响应诊断（每个响应 body **只读一次**，只保留 status / wire code / **已脱敏**的 details；
日志里没有 token、没有 header、没有本机绝对路径），跑原错误，拿到的**真实事实**是：

```json
{"put_status":200,"put_code":null,
 "second_intake_id":"intake-<uuid>","first_intake_id":"intake-<同一 uuid>","same_intake":true,
 "second_intake_version":1,"intake_head_version":2,
 "create_status":409,"create_code":"REVISION_CONFLICT","create_details":null}
```

⇒ **MAIN 的推断被证实**：该用例复制 `definition:IntakePut:valid` 向量后**没有换 `meta`**，
与 `createdProjectFixture` 建项时用的是同一 meta（`idempotency_key:'id1'`），于是第二次 PUT 是
**第一个项目 intake 的重放**：返回的是同一个 intake 的**旧版本 1**，而该 intake 的 head 已经前进到 **2**
（draft fixture 把同一 intake 更新过一版）。创建请求因此拿到 `409 REVISION_CONFLICT` ——
**这是正确的过期版本保护，不是生产缺陷**；错的是**用例的构造**。

**第二步（构造修正 + 第二个红灯，已保留）**：`n1n2-claude-052-lf04-002`，**实际 exit 1**，
log sha256 `6f9f6e960fb410d6eaaefa8521a52bc8b09922cd1102b5e006e9319646ff02db`。

构造修正：第二个 IntakePut 带上**自己的幂等键/关联 ID**（`brief.meta={idempotency_key:'foreign-intake',…}`），
于是它是**真实的第二个 intake**；并新增断言「第二个流程的 intake 不是第一个项目的 intake」
（第一个 intake 的 id 是从**它自己的创建事务**里读出来的，不是猜的）。
修正后用例**第一次真正走到两个 foreign 负例**，并暴露出**第二个真实事实**：

```
AssertionError: expected [Function] to throw error including 'CREATED_COMMIT_PLAN_MISMATCH'
                 but got 'CREATED_COMMIT_ADOPTION_MISMATCH'
```

⇒ 生产里 `commitPreparedCreatedSource` 的检查顺序是
**TRANSACTION_MISMATCH → ADOPTION_MISMATCH → PLAN_MISMATCH**（`src/host/projects/revision-store.ts:523-547`）：
本 commit 的 **adoption 记录绑定了 impact**，传入外项目 impact 时**先**在 adoption 绑定上被拒，
plan 检查根本到不了。**原期望的 code 是事实错误**，已改成**实测的真实精确 code**
`CREATED_COMMIT_ADOPTION_MISMATCH`（不是 `any throw`，没有放宽成「只要抛错就算」）；
同文件的兄弟用例 `LF04 refuses a stored hash that does not match the plan` 仍以
`CREATED_COMMIT_PLAN_MISMATCH` 证明 plan 检查本身可达。

**第三步（小门真绿）**：`n1n2-claude-052-lf04-003`，**实际 exit 0**，
`1 passed | 33 skipped (34)`，log sha256 `ab9281d2affe753d2eeb4ce0278e993e69d139a563bad441e11bed1c59ca3ae2`。
该用例这次**完整跑到了两个 foreign 拒绝与「双方 authority 完全不变」的后置比对**（`expect(after).toEqual(before)`）。

### 三个候选的完整字节备份（sha256）

| 阶段 | sha256 |
|---|---|
| 诊断版 | `b6dc9fca8dbe1b51eb4bc6332fe7b73a001557c0c0a3b056c0daf47bafdead05` |
| 构造修正版 | `5727a6a0d12feff9adced815f65e441a1c2b044698b53c49bf3660135c845f85` |
| **最终候选** | `c50bcef0ca39643aa3549cbd8f7dceda2d58ea538224a3ab216dc785e3975f47` |

逐字节副本在 `docs/parallel/lane-product/A-R2-20261112/N1N2-native-source/captures/<sha256>.txt`。
两个红灯的 capture 与 raw log 全部保留，未被新绿覆盖。

---

## 2. 冻结后的四组条件验证（全部 exit 0）

| 组 | capture | 实际 exit | log sha256 | 结果 |
|---|---|---|---|---|
| authority 整组 | `n1n2-claude-052-authority-001` | **0** | `c9ccff23a66790bf64dd2089111a5fdd782537397a7a9ec19cca0307d19ccbe3` | `3 files, 54 passed (54)`，582.10s |
| 真实媒体双导出 | `n1n2-claude-052-real-export-001` | **0** | `9f8f0d9c6c53f64ab4bb3ef498afcd5330f6577948cb06970dbfbd359452ec77` | `2 passed (2)`，76.12s |
| 完整 reader | `n1n2-claude-052-native-reader-001` | **0** | `9ab744d350230dd261cc32189a65024239191e59196fe905ca3ce0bf9c8060ef` | `1 file, 91 passed (91)`，955.54s |
| 四套 legacy fixture | `n1n2-claude-052-legacy-fixtures-001` | **0** | `6bc3fbff1bd5acf352a6e8b5664dbf3029390d7580e94d55ace35f8ef4e533da` | `4 files, 44 passed (44)`，27.12s |

编译：`052-tsc-001/002/003` 全部 **exit 0**，log `e3b0c442…855`（0 字节）。

### 逐 suite 的实际结果

- **authority 整组**：adoption **34/34**（含 LF04 两个用例）、impact-atomic **9/9**、source-change **11/11**。
- **真实媒体双导出**：`MIG-03 … produces two real, different exports of the same 900-frame three-clip film`（42.97s，
  真实 migrate → 重开 → 导出 → 改中段单镜 → 再导出）与
  `EN-05 the source project is still intact and openable after rollback`（27.00s，源字节/绑定/记录产物保持）。
- **完整 reader**：**91/91**（R00/R01/R02/R03/R04/R05/R06/R07、P06–P09、F01–F10、G01–G07、K02、K06 全绿），
  其中真实发生的有：真实 ffprobe 事实归一与旋转/双视频流处理（F09）、**真实 stdout/stderr 溢出拒绝**、
  **真实挂死子进程的 kill 与 reap**、**真实信号死亡与取消**（G05）、真实字节预算/EMFILE/ENOMEM/EACCES、
  可重入释放、EMFILE/ENOMEM/EACCES 的 primary 保留（P07）、两棵树各自持有与空目录（F/G06、F/G07）、
  外项目 facts lease 与过期 generation 拒绝、五条固定 native revision 向量与非字典序 caption 顺序（P06）。
- **legacy fixture**：snapshot-store **9/9**、host-coordinator-integration **2/2**、migration-service **26/26**、
  openfilm-migrator **7/7**。

### 媒体产物的诚实口径

- 真实导出的**两个产物**的 sha256 是**在用例内部真实计算并断言**的（第一个导出与报告的
  `export_artifacts[0].sha256` 相等且形如 `/^[a-f0-9]{64}$/`，第二个导出**不等于**第一个），
  但**用例没有把十六进制值打印到日志**，所以**本报告不给具体 digest 值**——不编造。
- 真实 decode / probe / 900 帧双目标 render / 改单镜 / 重开**确实执行了**（用例耗时 42.97s 与 27.00s 即其证据），
  **没有**用常量或 mock 替代。
- 3 个 canonical opaque fixture 的 digest **未变**（`0427d617…`、`40d825e6…`、`e4276d5e…`，仍在 626 inputs 内）。
- 真实导出用的是**测试自有 temp 副本**，canonical 固定上游与 opaque fixture 未被改动。
- 旧标题页迁移**不等于**原视觉保真；既有 Hypit 产物回调**不等于** fresh 付费渲染——**均未宣称**。

---

## 3. 资源结算：一个必须报的真实发现

`052-real-export-001` 结束后，**该次运行自己起的固定上游 studio server 仍然活着**：
两个 `node …/vendor/openfilm/packages/openfilm/studio/server/main.mjs` 进程（父进程
`started=Sat Nov 14 00:31:24 2026`，落在本次运行窗口 00:31:12–00:32:32 内），父进程已退出、
被 `/init` 收养，**占着 127.0.0.1:4747 与 :4748**。在此之前的运行（051 全部、044 focused）**这两个端口无监听**。

处置：按**完全匹配的 cmdline**（`*/vendor/openfilm/packages/openfilm/studio/server/main.mjs`）
核对后对其发送 SIGTERM；复核：**4747/4748 无监听、该 cmdline 无残留进程**。
其余每组结束后的复核：**无遗留 vitest/chrome/ffmpeg/ffprobe 进程、无 4747/4748 监听**，
`/tmp` 的 `narralens-*` 计数稳定在 234（与 044 的观察一致，未删未扫）。
机器上另有 IDE 自己的 `playwright-mcp` 与 `/mnt/c/workSpace/navia/…` 的 `node --test`，**不属本 lane，未触碰**。

⇒ **给 MAIN 的待裁决事实**：真实迁移导出路径**没有**在用例结束时关闭它自己起的固定 studio runtime。
这不影响本批任何断言结果（用例内断言全部成立），但它是一个**真实的资源生命周期缺口**，
需要 MAIN 判定是产品侧缺口还是该路径的既定 studio 生命周期；**本轮未改任何生产代码**。

---

## 4. 冻结与不变性

- 五个 052 capture 的 `inputs.json` 每次都是运行内冻结的 **626** 个文件；**每个 capture 结束后独立复核
  626/626 匹配、0 缺失、0 不匹配**；每个 `result.json` 的 `source_changed`/`source_added` 均为空。
- HEAD 仍是 `e2eff61b464d75d36598103d718cd2a75db5dfda`；**git 索引为空**；已跟踪 dirty 17 个文件、
  untracked src/tests 6 个文件与开工前一致；受保护 `AGENTS.md` sha256 仍 `37300463…4542b`；
  Expected015、固定上游、pin、config、旧 Gate、运行器**未改**。
- 全程 Headless 静音、loopback 单重型槽；未读 J 盘、未联网下载、未付费、未外传、未安装或改配置；
  **没有 429**，也没有工具格式异常。
- **没有** `git add/commit/reset/stash/checkout/push`；未建新 worktree / 新目录。

---

## 5. 原 17 项覆盖缺口（本批之后的实际状态）

本批把 051 留下的三组 NOT_RUN 全部补上，缺口如下：

1. **R05 actual_probe / child_lifetime** — **本批有真实证据**（reader 的 F09/F05/G05：真实 probe 归一、
   真实 stdout/stderr 溢出、真实挂死子进程 kill+reap、真实信号死亡与取消）。
2. **R06 native_bytes_and_order** — **本批有真实证据**（P06 五条固定 native revision 向量、
   数值序与非字典序 caption 顺序、F10 平台目录顺序）。
3. **R07 budgets / per_allocation_fd_lifetime / cleanup_uncertainty / drain_and_delivery** — **本批有真实证据**
   （P07 预算/总量/深度/FD 界、EMFILE/ENOMEM/EACCES、可重入释放、每次分配精确一次关闭；
   F01/F07/G01/G02 的交付与不确定）。
4. **R01 producer_chain / R02–R04 的 reader 侧** — **本批有真实证据**（reader 91 项全部真实执行）。
5. **REG existing_behavior（旧 render 合同、legacy 拒绝、已接受的 Expected 生命周期/84 断言）** —
   本批的 legacy 四套件 **44/44** 与 047 的 native-cache **31/31** 提供了回归证据；
   **但 Expected 的 84 条断言本身本批没有单独重跑**（属 MAIN 既有证据，未在本批重复执行）。
6. **LF04（Q06 外项目 impact/transaction）** — **本批由红转绿**，且两个 foreign 负例与「双方 authority 不变」
   **真实触达并通过**；同时把真实 wire code 固化进了用例。
7. **EVIDENCE frozen_capture** — 本批 capture 链完整（唯一命名、实际 exit、输入冻结与逐次复核、字节备份）。
8. **仍然缺口的**：
   - **REVIEW independent_acceptance**：仍未取得**独立复核**——**不自签**。
   - **A 轮两条真实 60–180 秒中文有声影片**：始终 **NOT_RUN**，本批也没有新证据；
     诊断媒体**不冒充** A 影片、**不冒充**人声。
   - **NEXT next_integration_plan**：不在本批范围。
   - 本批**没有**跑 full 套件、build、mutation，也**没有**任何下一阶段接线。

**未宣称**：原 17 项全部通过、A 轮通过、V1 通过、独立外审通过、NativeAck/Studio 就绪。

---

## 6. 回退

回退只需把 `tests/agent-driven/integration/created-source-adoption.test.ts` 还原到
`8ab6dfcdc98bdef2f4dd42a38c32b0048a0907a95a7c07488910534f49b2097e`
（052 基线逐字节副本在 MAIN 的 `source-captures/8ab6dfcd….txt`；本 lane 的三个候选副本在
`captures/` 下）。该文件是 untracked 新文件、索引为空，**回退不影响任何已提交内容与用户 dirty**。
