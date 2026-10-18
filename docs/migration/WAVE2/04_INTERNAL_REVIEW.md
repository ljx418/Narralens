# Wave 2 文档内部独立复审记录

状态：`PASS`（BLOCKER=0、MAJOR=0、MINOR=0；限制项不冒充缺陷关闭）
对象：`00`–`05` 开工包、Archify 图、总架构/追踪及真实代码接缝。
规则：三轮从不同视角重新建立检查清单；不是把同一段文字读三遍。任何 BLOCKER/MAJOR 未关闭时不得
把开工包标为 ready。

## Round 1：架构与数据所有权

检查：单引擎、唯一 commit、M3 NOWRITE、无第二 timeline、stage/snapshot/pointer 顺序、持久状态机、
回退、M2 兼容。

初始发现：

| ID | 级别 | 发现 | 处置 |
|---|---|---|---|
| R1-01 | BLOCKER | 旧 docs-only schema 用单 composite 驱动 Hypit replace，与 OpenFilm 三原生 clip 目标冲突 | `01` C-01 明确历史化；新合同以 NativePlanV1 clips 为权威 |
| R1-02 | BLOCKER | 若 M3 发布 derived entry 到 active Manifest@2，会改变 source digest，违反 NOWRITE | 衍生产物改为 materialization 专属区；M4 stage 才装配 source |
| R1-03 | MAJOR | 新采用若自建 service commit，会形成第二写入权 | `02` 冻结为 ProjectCoordinator 内部 controlled-write 原语 |
| R1-04 | MAJOR | restore 若直接切 active pointer 会让 revision 倒退 | 冻结为 restore_snapshot typed write，新 snapshot/revision +1 |
| R1-05 | BLOCKER | `migratedRoots` 虽会恢复，但没有进入 `ProjectCatalog`；文档错误假设 target 已能走 project/proposal/materialize 链 | 增加 W2.0 `ProjectResolver`/`ActivatedProjectView`，以 terminal migration+binding+commit+root containment 解析，ACT-01/02 单独出门 |
| R1-06 | BLOCKER | M2.3 target 只复制资产 bytes，没有目标 Manifest@2；直接复用 AssetRegistry 会失败或诱发静默跨项目 fallback | 增加 target-owned `MigratedAssetLedger` 与 ASSET-01..03；可证明 bootstrap，不改 author source/revision |

复验结论：原始 4 BLOCKER / 2 MAJOR 已全部转成冻结契约、明确实现实体和直接 case；残余 0/0/0。

## Round 2：代码可实现性与兼容

检查：真实 route、TypeScript union、DB CHECK/migration、Job lease、OpenFilm adapter、Native registry、
legacy response、超时/并发/资源清理。

初始发现：

| ID | 级别 | 发现 | 处置 |
|---|---|---|---|
| R2-01 | MAJOR | `JobKind` 与 SQLite CHECK 都没有 materialize | W2.0/M3.1 要求同提交受控 job_v2 前向迁移 + old DB reopen test |
| R2-02 | MAJOR | OpenFilm capability 全 blocked 且 `plan()` 固定 422 | M4B 只开放 adopt/restore 明确 ops，保留 unknown default deny |
| R2-03 | MAJOR | Coordinator commit/幂等响应绑死 legacy EditResponse | 新增内部通用受控写结果；legacy wrapper/表继续兼容，不改旧响应 |
| R2-04 | MAJOR | 当前 idempotency PK 缺 operation kind | Wave 2 使用独立 operation_idempotency；同一 Wave2 op 不双写旧表 |
| R2-05 | MINOR | M2.3 migrate-copy 是同步 route，不是 materialize worker 模板 | M3 明确使用 PersistentJobStore，不复制 migration route 的同步执行 |
| R2-06 | MAJOR | SQLite `job.kind` CHECK 不能用普通 ALTER additive 扩展 | 冻结 VACUUM INTO 备份 + job_v2 显式复制/校验/事务替换 + 旧库重开门 |
| R2-07 | MAJOR | 默认 EngineRegistry 只组成 Hypit；即使能解析 target，也没有生产 OpenFilm port | W2.0 显式组成固定 SHA port；缺 vendor/摘要/许可任一项继续 fail closed |
| R2-08 | MAJOR | 既有 D4.1 comparison 属于源 Hypit 项目，不能作为 target proposal 使用 | 强制 comparison/proposal/path 同项目；真实 runner output 只可经正常 adapter 离线重放并记录双 SHA lineage |
| R2-09 | MAJOR | 第一版架构图边标签写成 `EnginePort ... commit`，与七方法合同冲突 | 图改为 `plan/stage/validate`；commit 只由 Coordinator→RevisionStore 边表达，重新 9/9 deliver |

复验结论：原始 0 BLOCKER / 8 MAJOR / 1 MINOR 均有实现点、迁移算法或禁止项；残余 0/0/0。

## Round 3：完整体验、验收与诚实声明

检查：真实用户路径、每一承诺是否有 case、真实媒体、取消/重启/竞争、Headless、证据绑定、声明上限。

初始发现：

| ID | 级别 | 发现 | 处置 |
|---|---|---|---|
| R3-01 | BLOCKER | 仅 proxy 成功不能证明原生可编辑采用 | TX-14 要求三 clip 原生 inspect + 独立改单镜 + 两侧 identity 不变 |
| R3-02 | MAJOR | “双导出”可能错误宣称 M6 生产 render | 固定 upstream harness 仅作 Wave2 验收；正式 route 仍属 M6 |
| R3-03 | MAJOR | 锁只按 visual clip 会漏真实 duration/narration/shared consumer；无差别三锁又会过度阻塞 | adopt/restore 按 projection diff 分类，TX-03/04/13 分别覆盖 |
| R3-04 | MAJOR | 取消晚到若只看 Job state，materialization 仍可能 ready | MT-05 同时断言 Job、materialization、source/revision 三层 |
| R3-05 | MINOR | 本波无完整产品 UI，不能做用户体验通过声明 | headed/human 记 NOT_RUN，声明上限不含 M5 |
| R3-06 | MAJOR | 为避免新费用而直接修改旧 comparison 的 project_id 会制造虚假 target 证据 | PR-01 只允许 recorded provider output 经 adapter 在 target projection 上重放；标记 `RECORDED_PROVIDER_OUTPUT_REPLAY`，禁止宣称新调用 |

复验结论：原始 1 BLOCKER / 4 MAJOR / 1 MINOR 已全部转成直接证据或明确声明边界；残余 0/0/0。

## 最终裁决

签署：`PASS`，允许移交 Claude Code 开始 W2.0→M3→M4 连续实现。

实际复验（2026-10-18）：

- 架构检查：单引擎/唯一 commit/M3 NOWRITE/no second timeline/rebased 409/revision +1/late-result
  quarantine 关键字与真实 `EnginePort` 七方法、Coordinator commit ownership 对照，exit 0；
- 可实现性检查：确认三条新 route token 在 `server.ts` 不存在，确认静态 catalog、`migratedRoots`、默认 Hypit-only
  registry 与两项 SQLite CHECK 的真实差异；所有具体源码引用存在，exit 0；
- 验收检查：ACT/ASSET 5 项、PR 3 项、MT 6 项、TX 14 项、W2-REG 共 29 个 case ID 全部存在；真实媒体、
  restart/race/late callback、Headless、外审不可自签与声明上限均有直接条款，exit 0；
- `corepack pnpm check`：exit 0，38 files / 383 tests，TypeScript 与 production build 通过；
- `corepack pnpm evidence:wave1:integrity`：exit 0，6/6 PASS，21 cases=20 PASS + 1 approved N/A；
- `corepack pnpm test:contracts`：exit 0，3 files / 21 tests；`corepack pnpm test:m2.1`：exit 0，10 files /
  139 tests；`corepack pnpm check:m2.1-docs` 与 `git diff --check`：exit 0；
- Archify deterministic deliver：showcase 9/9、composition 0 errors/0 warnings，spec SHA256
  `6600c3ed3f7f244ea56a3a1b9549ced5a34388ad435664a7e14e571c860101ab`，HTML SHA256
  `7752e1ef2d880758dccec8ee30645748e92e4bc68911a24b0a282e81996eb7b8`；
- Archify 浏览器 visual-check：`NOT_RUN/BLOCKED_ENV`。Linux Chrome 不可用；Windows Chrome 经 WSL pipe
  返回 `ECONNRESET`。未打开可见窗口、无残留进程。该限制不等于浏览器通过，也不阻止纯文档/后端技术 Gate。

接受但未消失的产品边界：固定 30/1、三镜 900 帧先验；M6 正式 snapshot-bound render route 未实现；
headed/human 为 `NOT_RUN`。这些边界均在声明上限之外，不构成本包实现歧义。
