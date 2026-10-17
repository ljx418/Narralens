# 目标架构 L0–L1 详细设计

## 1. L0：系统上下文

Narralens 是本地优先的单人创作系统。用户只面对一个 OpenFilm Studio 增量应用；所有写入、付费、外传和恢复决策均经 Narralens Host。

```text
用户 / 本地素材 / 观点与资料
             │
             ▼
OpenFilm Studio + Narralens surfaces
Player / Timeline / Inspector / StoryAtlas / CandidateFocus / Delivery
             │ loopback HTTP/SSE，session + Origin
             ▼
Narralens Host（唯一公开控制平面）
Auth ─ ProjectCoordinator ─ Lock/Impact ─ Job/Event ─ Asset/Revision
             │ EnginePort（项目单引擎绑定）
      ┌──────┴────────┐
      ▼               ▼
OpenFilmAdapter    HypitAdapter
新项目目标引擎      legacy/回退
      │               │
      └── snapshot/render/export ──► 交付包/QC/证据

Claude Runner/OpenMontage、TTS/ASR、素材 provider、scene worker
只能经受控网关输出 proposal / staging asset / receipt，不能写 author source。
```

系统边界外：ChatGPT/Claude 等上游讨论、互联网来源、付费 provider、人工发布平台、移动硬盘“视频制作”。这些外部对象只通过明确导入/授权进入，不能成为隐式运行依赖。

## 2. L1：容器和所有权

| L1 容器 | 数据所有权 | 可以调用 | 绝对禁止 | 当前状态 |
|---|---|---|---|---|
| Studio UI | 视图状态、未提交表单、播放位置 | HostApiClient、原生只读 projection | 直接写 source、持久 revision、保存第二 timeline | OpenFilm 生产集成未实现 |
| Host API | session、输入解析、路由、SSE transport | ProjectCoordinator、Query services | 自己绕过 actor 修改项目 | 现有 Hypit API 已实现，需演进 |
| ProjectCoordinator | 单项目写入序列、precondition、commit 事务 | locks、impact、EnginePort、stores | adapter 自提交、并行双写 | 目标；现有 ProjectWriteActor 为基础 |
| EnginePort | 引擎 projection、plan、stage、validate、preview/render | 固定引擎接口和隔离 stage | 增 revision、改锁、裸 shell/native op | M2.1 目标 |
| OpenFilmAdapter | OpenFilm 映射和验证 | 固定 `e70d9d...` fork API | 自动 rebase 成功、写 active source | M1B spike，生产未实现 |
| HypitEngineAdapter | 包装现有 Hypit read/write | 现有固定 fork | 删除 legacy 或改变旧合同 | M2.1 目标 |
| SnapshotStore | 不可变 source closure、active commit record | filesystem + durable metadata | in-place 改已提交 snapshot | M2.2 目标 |
| Revision/Journal/Outbox | revision、事务状态、幂等、待发事件 | SQLite 事务 | 存第二份完整 timeline | 部分已有，M2.2 扩展 |
| PersistentJobStore | Job、lease、attempt、event seq、cancel、receipt | SQLite/outbox/worker | 用内存态冒充可恢复 | 现有内存 Job，M2.2 替换 |
| AssetRegistry | Manifest@2、bytes、rights、lineage | import/media validator | 暴露绝对路径、自动采用 | D4.2.1 已实现，M3 扩展 |
| Proposal/Materialize | proposal、binding、native plan、proxy、lineage | Runner、AssetRegistry、Job | 写 author source/revision | D4.1 proposal 已有；M3 待实现 |
| Impact/Adoption | server impact、approval、typed adoption | Coordinator、locks、EnginePort | 信任客户端 impact、静默 rebase | M4 待实现 |
| Delivery/QC | snapshot-bound render、preflight、package | renderer、ffprobe/QC | 读取 mutable stage | M6 待实现 |
| Provider Gateway | 外传、预算、receipt、重试/取消 | 明确 capability adapter | provider 回调直写 source | M7C 待实现 |

## 3. 分层依赖规则

推荐生产目录保持当前 `src/` 结构增量扩展：

```text
src/
  app/director/                  # UI，只经 api/ 和共享 view contracts
  contracts/                     # 纯类型/校验入口，无 host/vendor 依赖
  host/
    engine/                      # EnginePort, binding, capability, digest
    projects/                    # coordinator, locks, revision, snapshot, history
    jobs/                        # persistent job/event/lease/outbox
    materialize/                 # binding, native plan, proxy, lineage
    delivery/                    # render/QC/package
    providers/                   # approval/budget/provider gateway
  adapters/
    hypit/                       # legacy adapter
    openfilm/                    # fixed upstream adapter
    openmontage/                 # proposal runner
    voice/                       # M7B
    media-providers/             # M7C
```

依赖方向固定为：`app → contracts/api client → host use-cases → ports → adapters/infrastructure`。反向 import 失败。具体规则：

1. `app/**` 不 import `host/**`、`adapters/**`、`vendor/**`。
2. `contracts/**` 不 import React、Node filesystem、数据库或 adapter。
3. `host/projects/**` 依赖 `EnginePort`，不依赖 OpenFilm/Hypit 具体类。
4. adapter 不依赖 UI，不拥有 commit/revision/lock。
5. provider/runner/materialize worker 只写自己的 stage/derived 区。
6. Query/read model 不修改 author state；写操作必须进入 ProjectCoordinator。
7. `spikes/**` 不可被生产 `src/**` import。

使用静态架构测试检查 import 边界，并在 M2.1 将其纳入 `pnpm check`。

## 4. 关键数据边界

### 4.1 EngineBinding

每个 `project_id` 只有一个 active binding：`hypit | openfilm`。字段至少含 `engine`、`engine_upstream_sha`、`created_at`、`migrated_from?`、`binding_version`。变更 binding 是迁移/激活动作，不是普通 edit；不允许一次请求触发双写。

### 4.2 SourceSnapshot

已提交 snapshot 不可变，包含：

- `film.html`；
- 实际引用的 scene/html/js/css；
- 字幕、设置、字体；
- 引用媒体的内容 SHA；
- engine 与完整上游 SHA；
- 按 canonical 规则生成的 dependency manifest/source digest。

未引用缓存、候选和访问时间不进入 digest。任何 reader 由 active commit record 解析 snapshot，不遍历“最新目录”。

### 4.3 ProjectRevision 与 ControlRevision

- `project_revision`：每次成功真实编辑/恢复恰好 +1；无变化可返回 unchanged 且不增；失败不增。
- `control_revision`：锁、许可、预算等策略版本；变化使相关 impact 失效，但不必改变影片 revision。
- `asset_manifest_revision/digest`：资产库存变化；导入不自动增加影片 revision。
- OpenFilm native revision 只作 adapter 内部 preimage，不替代以上数值。

### 4.4 Candidate/Materialization

Proposal 是意图；Binding 是资产选择；Materialization 是 native edit plan + proxy + lineage；Impact 是服务器计算的采用快照；只有 Adoption commit 才改变 author snapshot/revision。

## 5. 写入和读取序列

### 5.1 写入

```text
UI/native入口
 → NativeWriteGateway（translated/blocked/read_only）
 → Host auth/schema/idempotency/base/digest/control
 → ProjectCoordinator 单项目队列
 → EnginePort.plan → isolated stage → validate
 → 再核对 active base/impact/locks/rights
 → immutable snapshot + prepared journal
 → 单一 active commit record + revision + outbox 原子提交
 → read model/event replay
```

adapter 的“rebased”不能跳过 `base_revision/source_digest` 的严格 409。

### 5.2 导出

导出请求在创建 Job 时冻结 `snapshot_id/project_revision/profile`。后续新 revision 不改变该 Job 输入；输出只归属于冻结 revision。失败/取消/晚到结果只更新 Job/产物台账，不采用工程变更。

## 6. 部署与安全域

- Host 仅 loopback；Origin + 短期 Bearer session 先于项目存在性检查。
- UI 永不接触 provider/Host secrets；日志和 evidence 脱敏。
- stage 与 active snapshot 同文件系统以支持可靠提交；路径必须 realpath 后保持在允许根。
- scene/worker 运行于无 Host secret、受限文件和网络的独立进程；默认网络拒绝。
- 资产 API 使用 asset ID/token，不接受客户端绝对路径。
- 上游固定完整 SHA、lock digest、许可证和补丁清单；升级是独立 ticket。

## 7. 质量属性

| 属性 | 架构机制 | 证明方式 |
|---|---|---|
| 一致性 | actor + immutable snapshot + single commit record | crash boundary、并发、混合 revision 读取测试 |
| 可恢复 | journal + attention + outbox replay | 每个状态杀进程/重启 |
| 安全 | loopback/auth/path/provider default deny | 绕过、路径、Origin/token、secret scan |
| 可追溯 | digest、lineage、receipt、case evidence | SHA256 manifest 与逐 case 审计 |
| 性能 | EngineProjection、virtualization、proxy 解码上限 | 900 秒/120 镜、p95 和内存原始样本 |
| 可访问 | shared selection、键盘、焦点、reduced motion | axe + headed + 人工 |

## 8. 图形证据

`diagrams/target-architecture.html` 已通过 Archify showcase 9/9、0 错误、0 警告；Headless Chrome 四个桌面视口无溢出。此结果证明确定性图表结构与浏览器包络，不等于人类视觉审批，也不证明生产架构已实现。

