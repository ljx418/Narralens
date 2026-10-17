# ADR-M2.1-001：M2.1 开工前契约差异裁决与别名表

状态：`ADOPTED_FOR_M2.1`
日期：2026-10-17
触发：`docs/handoff-m2-m7d-claude/00_README.md:57`「若 3–6 与当前源码不一致，先写差异和 ADR/变更单；不得在代码里静默裁决」。
范围：只覆盖 M2.1。不改变任何历史 Gate 结论，不修改 `docs/handoff-m2-m7d-claude/` 用户未提交文档。

权威层级（`00_README.md:45-57`）：用户 > `docs/01_PRD.md` > `docs/11_V1_Traceability.md` >
`CR-MIG-001` + `06_ARCHITECTURE_CONTRACT_LOCK.md` > 当前源码/合同/测试/证据 > 交接包设计 > migration 目标草案。

## 0. 冲突复核结论

对交接包与 `docs/03_Architecture.md`、`docs/04`、`docs/05`、`docs/architecture/*`、
`docs/Narralens-Migration-M1/contracts/*`、`docs/contracts/*` 与真实代码做双向复核：
**BLOCKER = 0，MAJOR = 4，MINOR = 14**。四项 MAJOR 全部为文档层裁决，结论如下。
同时复核了交接包的「目标尚未实现」前提：`src/host/engine/` 不存在、`src/adapters/openfilm/` 不存在、
`src/host/job-store.ts:9-11` 确为内存 `Map`、全仓无 `source_digest`/`narralens-source-v1` —— 前提属实。

---

## 1. D-01 fps rational 与既有 `frame_rate: number` 浮点合同并存

**冲突**：`06_ARCHITECTURE_CONTRACT_LOCK.md:38`（AC-D02）与 `05_API_INTERFACE_SPEC.md:16` 要求
fps 为 `{num,den}`；既有运行合同 `contracts/project-response.schema.json:9` 与
`src/contracts/types.ts:145` 为 `frame_rate: number`。

**裁决**：两者分层共存，不修改既有合同。
- 既有 `/api/projects/:id` 响应**保持** `frame_rate: number`（AC-019，legacy Gate 产物不得追溯改写）。
- 新增 `Fps = { num: number; den: number }`（既约、`num>0`、`den>0`），只在
  `EngineProjection` 与 `/api/migration/v1/**` 新面出现。
- `FrameRate30` 是 `Fps` 常量 `{ num: 30, den: 1 }`；legacy `frame_rate` 由
  `fpsToLegacyNumber(fps)` 单向派生，仅供 legacy 响应使用，legacy 面不得反向读回 `Fps`。
- 该派生只用于展示既有字段，不参与任何摘要、digest 或帧换算。

**理由**：`00_README.md:47` 禁止 Claude Code 自行「统一」历史编号与合同；
`06:63` 要求保留现有路由与测试。改 legacy schema 会使 D2/D3/D4.0/D4.1/D4.2.1 证据失效。

## 2. D-02 新增 `ApiErrorCode` 的 alias/version 表

**冲突**：`docs/03_Architecture.md:188`「阶段计划只能引用并收窄此表，不得另造同义 code」；
`05_API_INTERFACE_SPEC.md:25-39` 引入新 code，并要求「M2.1 建立 alias/版本表」。

**裁决**：`06_ARCHITECTURE_CONTRACT_LOCK.md:66`（层级 4，高于未排层的 `docs/03`）允许
「API 错误兼容通过 alias/version 实现」。因此 M2.1 必须交付下表，且必须证明新码**不是**同义词。

### M2.1 alias/version 表（版本 `narralens.error-alias@1`）

| 新 code | HTTP | 既有相关 code | 语义区别（必须可被测试断言） | 同义？ |
|---|---|---|---|---|
| `SOURCE_CHANGED` | 409 | `MANIFEST_CHANGED` | `SOURCE_CHANGED` = source 引用闭包 digest 变化（film/scene/字幕/设置/字体/资产）；`MANIFEST_CHANGED` = 仅资产清单变化。二者作用域不同，可同时成立。 | 否 |
| `CAPABILITY_NOT_ENABLED` | 404 | `NOT_FOUND` | `CAPABILITY_NOT_ENABLED` = 阶段门未开放（路由已知但能力未到本阶段）；`NOT_FOUND` = 资源/路由本身不存在。 | 否 |
| `ENGINE_UNAVAILABLE` | 503 | `HYPIT_UNAVAILABLE` | `ENGINE_UNAVAILABLE` = 引擎绑定或其固定上游不可用（含 OpenFilm 未 vendored、SHA 不匹配）；`HYPIT_UNAVAILABLE` = Hypit fork 运行时不可用。 | 否 |
| `INVALID_RANGE` | 422 | `AMBIGUOUS_TIME` | `INVALID_RANGE` = 区间结构非法（零长、负起点、越界、跨镜）；`AMBIGUOUS_TIME` = 时间无法唯一确定。 | 否 |
| `DATA_POLICY_DENIED` | 403 | `ORIGIN_REJECTED` | `DATA_POLICY_DENIED` = 外传/费用/凭据策略拒绝；`ORIGIN_REJECTED` = 同源检查拒绝。 | 否 |

上表只列 5 个新码；既有 24 个 `ApiErrorCode` 在本 ADR 中只做整体声明，其逐条 alias 记录由机器可读表 `src/host/engine/error-alias.ts` 以 `legacy: true` 承载，fitness test 校验该表覆盖 union 的每个成员，并校验本表 5 行与该表 5 个非 `legacy` 条目逐条一致。

**约束**：既有 24 个 `ApiErrorCode` 与 7 个 `JobState` 一个不改名、不删除、不合并语义
（沿用 `11_THREE_PASS_REVIEW.md:48` 的 `B-01`/`B-02` 结论）。
`AssetBlockingReason` 继续与 HTTP error union 分离。
fitness test 强制 TS union 与 `contracts/api-error.schema.json` enum 双向相等。

## 3. D-03 EN-04 的 `attention` 断言与阶段切分

**冲突**：`09_TEST_ACCEPTANCE_PLAN.md:28` 的 EN-04 文本丢掉了 `进入 attention 不是自动同步`
（该措辞见于 `docs/Narralens-Migration-M1/docs/08_Acceptance.md:66`，层级 7）；
`docs/migration/M2/M2-kickoff.md:31` 把 EN-04 自动化部分放在 M2.1，
但同文件 `:53` 把「注入 scene/字幕/设置/引用资产外部修改」放在 M2.3。
`03_M2_M4_MODULE_DESIGN.md:39` 又把「Source digest 与外部变更检测」列入 M2.1 最小提交序列。

**裁决**：按能力而非按文件切分，并把被弱化的断言恢复：

- **M2.1（本次实现与取证）**：EN-04 覆盖完整引用闭包；任一被引用文件（含 scene、字幕、设置、
  字体、引用资产）bytes 改变 → digest 改变 → 以旧 digest 的写入被 `409 SOURCE_CHANGED` 拒绝；
  项目经既有 `RevisionStore.markAttention` 进入 attention；**不自动同步、不自动接受外部改动**。
  registry `filewatch.external_change` 为 `read_only`，只检测不落地。
- **M2.3（不在本次范围）**：迁移副本上的注入演练、回退与 `MigrationReport` 交叉验证。

**证据义务**：M2.1 evidence 必须逐条断言 `attention=true` 与「外部修改后 bytes SHA 与
拒绝前一致」，而不只是「digest 变了」。

## 4. D-04 历史 `AT-*` / `D42-*` 编号不得被新编号吞掉

**冲突**：`docs/11_V1_Traceability.md:17,19,55,58`（层级 3）的
`AT-PREVIEW-01`、`AT-SELECTION-01`、`AT-SEC-01`、`AT-CONTRACT-01`、`AT-E2E-01`
在交接包 `10_TRACEABILITY_MATRIX.md` 中被映射为 `TM-01`、`TM-01/02`、`EN-06`、「全部 case」，
交接包全文零次出现 `AT-`。`00_README.md:47` 明令「禁止 Claude Code 自行『统一』掉历史编号」。

**裁决**：M2.1 证据中每个 case **同时**记录历史编号，不合并、不替换。

| M2.1 case | 历史编号（同时记录） |
|---|---|
| `TM-01` 帧↔秒往返 | `AT-PREVIEW-01`（`docs/11:17`，P0-03 帧时间往返） |
| `TM-02` 半开区间边界 | `AT-SELECTION-01`（`docs/11:19`，P0-05 `[start,end)` 边界） |
| `EN-06` 权限/路径/网络隔离 | `AT-SEC-01`（`docs/11:55`，NFR-01 Origin/token/路径穿越/凭据扫描） |
| 全部 case 的合同与集成层 | `AT-CONTRACT-01`、`AT-E2E-01`（`docs/11:58`，NFR-04 每阶段 evidence manifest 完整） |
| 旧 Hypit typed edit 合同回归 | `D42-HYPIT-01`、`D421-*`（`docs/11:30,32`） |
| 安全回归 | `D42-SEC-01`、`D421-SEC`（`docs/11:30,32`） |

**额外义务**：`docs/03_Architecture.md:216` 为 `AT-SEC-01` 固定了产物路径
`docs/evidence/<phase>/security/credential-scan.json`。M2.1 必须产出该文件，
并记录扫描器名称、版本、规则集与执行时间。若环境无 `gitleaks`，使用仓库内固定规则集的
等价扫描器并如实标注，**不得**把「无凭据」结论建立在未记录工具的检查上。

## 5. 目标草案（层级 7）与交接包（层级 6）的命名裁决

| 项 | 草案 `docs/Narralens-Migration-M1/` | 交接包 | M2.1 采用 | 依据 |
|---|---|---|---|---|
| 区间字段 | `end_frame` | `end_frame_exclusive` | `end_frame_exclusive` | 既有 runtime 合同已如此（`contracts/edit-request.schema.json:11`） |
| 引擎 SHA 字段 | `engine_sha` | `engine_upstream_sha` | `engine_upstream_sha`，40 位小写 hex | `02_ARCHITECTURE_L0_L1.md:89`；固定值确为 40 hex |
| binding 存储 | `.narralens/engine.json` | `src/host/engine/engine-binding-store.ts` | SQLite，`engine_binding.project_id` 为主键 | `06:9` 要求 unique constraint 自动验证 |
| binding 字段 | 含必填 `active_snapshot_id` | `created_at` + `binding_version` | 草案的 `active_snapshot_id` **移出** binding | binding 在创建时写入，此时无 snapshot；snapshot 属 M2.2 单一 active commit record（`03:52`） |
| manifest 大小字段 | `bytes` | 未命名（`05_Contracts.md:58` 用 `size`） | `size` | 契约正文表述；记此裁决 |
| EnginePort 签名 | 无 `ctx`、`isolatedRoot: string` | 每个方法带 `ctx`，`AbsoluteServerPath` | 交接包 | `05_API_INTERFACE_SPEC.md:46-57`，且草案形状允许客户端传路径，不安全 |

## 5.1 D-07 `TypedEdit` 就是既有 `EditOperation`，不引入新形状

独立评审发现计划初稿把 `TypedEdit` 写成 `{ kind, clip_id }`，与既有
`EditOperation`（`src/contracts/types.ts:7-17`，`op` + `shot_id`）在两个字段上不同，
却又声称「一一对应」。两套字段名之间必然存在一层映射代码，而映射本身可被绕过，
与 AC-019 冲突。

**裁决**：`export type TypedEdit = EditOperation;`。网关 `translated` 输出可原样交给
`ProjectWriteActor.execute()`，中间零映射。M2.1 不新增 operation；
未来新增时同时扩展 union、`contracts/edit-operation.schema.json` 与兼容测试。

## 5.2 D-08 M2.1 不实现 `migrateTo()`

计划初稿把 `migrateTo()` 列为 `EngineBindingStore` 方法，但唯一调用入口是 M2.3 的
`POST /api/migration/v1/projects/:id/migrate-copy`（`05_API_INTERFACE_SPEC.md:79-81`），
该路由在 M2.3 前关闭。为无入口的行为写生产方法与测试，等于把 M2.3 语义提前冻结。

**裁决**：M2.1 的 `EngineBindingStore` 只有 `bind()`（已存在则抛）与 `read()/require()`。
「迁移副本不改变旧 binding」改由 store 层证明：对**新** `project_id` 调 `bind()` 生成新行，
断言旧 `project_id` 的行逐字节不变。`migrateTo()` 整体推迟到 M2.3 重新设计。

## 5.3 D-09 SourceDigestV1 canonical：只排序 `files`，`assets` 保语义顺序

计划初稿把 `files` 与 `assets` 一并按 UTF-8 字节序排序，超出
`05_API_INTERFACE_SPEC.md:147`「数组保留语义顺序，只有 source files 在进入 canonical 前
按 UTF-8 相对路径字节排序」。

**裁决**：只对 `files` 排序；`assets` 保持解析器首次发现的 BFS 语义顺序。
BFS 顺序本身由「roots 按字节序 + 文件内引用按匹配偏移」固定，因此仍然唯一可复现，
且不构成对规范的单方面偏离。完整 canonical 规则与闭包解析算法见
`docs/migration/M2/M2.1-development-and-acceptance-plan.md` §5.4.1–§5.4.3。

## 5.4 D-10 引擎上游 SHA 固定值

| engine | `engine_upstream_sha` | 来源与复核 |
|---|---|---|
| `hypit` | `6fdd8c0f02c17b9970aee6deb4550a70e9d57acf` | `docs/01_PRD.md:3`；`git -C vendor/hypit rev-parse HEAD` 一致 |
| `openfilm` | `e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3` | `spikes/openfilm-m1b/upstream-lock.json`；隔离 worktree `vendor/openfilm` HEAD 一致 |

两者均为 40 位小写 hex；`engine_upstream_sha` 的运行时校验只接受该形状，不静默放宽到 64 位。

## 5.5 D-11 实现中发现并固定的两处确定性细节

实现 §5.4 时发现两处「两个实现者可能做出不同选择」的空隙，已在计划 §5.4.2/§5.4.1a/§5.4.1 中钉死：

1. **`entry` 是 Host 声明的第一个 root，不是排序后的第一个。**
   原措辞「roots 排序…第一个 root → entry」在实现时会把 `assets/narration.vtt` 这类
   按字节序更靠前的附属文件提升为 `entry`，把真正的 `film.html` 降级为 `html`。
   排序只决定遍历顺序；`entry` 由声明顺序决定。
2. **被引用文件允许相对目录使用 `..`。**
   scene 引用 `../assets/theme.css` 是正常工程结构。`..` 只在**声明的 roots** 中禁止；
   引用中的 `..` 被消解后必须仍落在 root 内，由 §5.4.2 第 7 条的 realpath 包含性判定兜底。
3. **`url( … )` 的未加引号形式必须抽取。**
   `url(a.png)` 与 `url("a.png")` 在真实 CSS 中同样常见；只匹配带引号形式会让闭包漏文件，
   直接违反 AC-006「完整引用闭包」。

同时澄清：数组排序属于 **manifest 构造**（进入 canonical 之前），`canonicalJson` 自身不重排数组。
因此黄金向量 V03（`files[]` 重排）期望 digest **改变**，而「声明 root 顺序不影响结果」
属于解析器性质，由 `tests/m2.1/source-digest-v1.test.ts` 断言，不属于 manifest 向量。

## 5.6 D-12 M2.1 网关的强制点尚未落在生产写路由之前（必须如实声明）

M2.1 的 `NativeWriteGateway` 完成的是**登记与判定**：它对每个入口给出
translated / translated_host_service / blocked / read_only / denied，并对未登记入口默认拒绝。
但 M2.1 **没有新开任何写路由**，因此网关目前并不位于某个生产写请求的前置位置上。

M2.1 期间唯一存在的生产写路由仍是既有的 `POST /api/projects/:id/edits`，
它在 M2.1 之前就已经由 `ProjectWriteActor` 独占提交；M2.1 包装 Hypit 时没有改变这条路径。

因此必须区分两件事，不得混为一谈：

- **已证明**：入口清单完整、无 `unknown`、未登记默认拒绝、translated 的类型与既有
  `EditOperation` 完全一致（零映射）、asset import 走 Host 资产服务、直接 HTTP 直传
  `native_operation` 被 schema 拒绝。这些都由可执行断言与变异用例证明。
- **尚未证明**：网关在一个真实写路由上拦截并拒绝请求。这一强制点随
  `POST /api/migration/v1/projects/:id/edits`（M4A）或 M2.2 的 Coordinator 接线而生效。

任何把 M2.1 描述为「所有写入口已在网关后强制治理」的表述都是夸大。证据清单与最终报告
按此口径书写。

## 6. 命名与顺序冻结

- 网关模块名统一为 `src/host/engine/native-write-gateway.ts`（导出 `NativeWriteGateway`），
  登记表为 `src/host/engine/native-mutation-registry.ts`（导出 `NativeMutationRegistry` /
  `NATIVE_MUTATION_REGISTRY`）。`03:22` 的「NativeMutationRegistry/Gateway」、
  `01:33` 与 `02:121` 的 `NativeWriteGateway`、`code-map.md:19` 的 `NativeMutationRegistry`
  三种写法由此对齐；`spikes/.../native-mutation-inventory.md:7` 的 `CommandGateway` 记为同义别名。
- 开发顺序按 `03_M2_M4_MODULE_DESIGN.md:32-40`（registry 先于 digest）；
  `01_MASTER_ROADMAP.md:77` 的相反顺序视为同义表述，不影响提交序列。
- 证据目录按用户指令与 `08_TEAM_DEVELOPMENT_WORKFLOW.md:48-58` 用 `docs/evidence/M2/M2.1/`；
  与既有 `docs/evidence/Migration/M1A/` 的差异记此裁决。

## 7. 本 ADR 不做的事

- 不修改 `docs/handoff-m2-m7d-claude/`（用户未提交文档）。
- 不修改 `docs/04_Development_Plan.md` / `docs/05_Acceptance_Plan.md` 中 D4.2.1 的历史状态文字
  （`12_CLAUDE_CODE_HANDOFF_PROMPT.md:43` 要求不改写旧 Gate 历史）。
- 不修改 `contracts/project-response.schema.json` 与 legacy 响应字段。
- 不引入 M2.2/M2.3/M3/M4 的任何实体。

## 8. 撤销条件

若后续阶段证明 D-01 的 `Fps` 分层或 D-02 的任一新码造成真实兼容问题，
必须新开 `CR-*` + ADR 走 `06_ARCHITECTURE_CONTRACT_LOCK.md:70-78` 的变更程序，
不得在本 ticket 内静默回改。
