# 叙镜架构设计 v1.0

## 1. 零层架构

```text
用户：聊天 / 观点 / 资料 / 实拍 / 录音
                  │
                  ▼
Narralens Unified Workbench
导演面板 + Hypit 编辑区域 + 时间轴 + 交付区
                  │
                  ▼
Narralens Local Host (TS/Node)
项目 / 任务 / 版本 / 锁 / 预算 / 权限 / 事件 / 事务
          │                         │
          │                         ▼
          │                 Hypit Adapter
          │                 Author Source + Run
          │                         │
          │                         ▼
          │                 Hypit compile/build
          │                         │
          ▼                         ▼
OpenMontage Adapter          预览 / MP4 / 字幕
受控 Agent Runner
pipeline + skills + tools
          │
          ▼
ProposalBundle / Evidence / AssetManifest
          │
          └──> 暂存区 → 审批/校验 → Source Adapter → 唯一主工程
```

**唯一剪辑事实源：Hypit Author Source + Run。** Narralens DB 不是第二条时间轴；OpenMontage 不直接写主工程。

## 2. 为什么这样集成
OpenMontage 的公开架构是 agent-first：编码智能体读取 YAML pipeline、Markdown skills，调用 Python tools，并通过 checkpoint 推进；它不是一个现成的单一 HTTP 视频生成 API。Backlot 是只读制作看板。因此我们复用它的制作方法、工具和产物，不把 Backlot 当编辑器。

Hypit 已有 Studio、时间模型、工程和本地渲染链路。Narralens 应在固定版本 Studio 应用层做薄改造，复用真实播放器/时间模型/工程写入，而不是重新发明渲染器。

## 3. 组件职责
| 组件 | 负责 | 禁止 |
|---|---|---|
| Narralens UI | 单页创作、选区、方案、精修、标题封面、交付 | 维护独立最终时间轴 |
| Local Host | 项目状态、任务、锁、版本、审批、预算、事务、SSE | 隐藏创作决策 |
| OpenMontage Adapter | 调用固定 pipeline/skills/tools，归一化提案和素材 | 直接覆盖主工程 |
| Agent Runner | 受控目录和白名单网络下运行 OpenMontage | 任意 shell/任意路径 |
| Hypit Adapter | Author Source 定位、typed patch、Run 产物选择、build | 正则猜写源码 |
| Hypit Runtime | 真实编译、预览、媒体装配、编码 | 自动理解用户聊天 |
| SQLite/Event Log | 任务、事件、修订、审批、映射 | 保存第二份影片结构 |

## 4. 技术栈基线
- UI：沿用固定 Hypit Studio 的 TypeScript/Vite 技术栈；新增 `DirectorPane`、`SpatialAlternatives`、`DeliveryPanel`。
- Host：Node.js + TypeScript；loopback 同源 API；每项目串行写 actor。
- Persistence：SQLite + append-only event log + project journal。
- OpenMontage：独立 Python venv，固定 commit SHA，受控 Agent Runner。
- Hypit：固定 commit/version；Source/Run adapter；实际 CLI/API 以 D1 探测结果为准。
- Testing：Vitest/现有 TS 测试 + Playwright + pytest（adapter）+ ffprobe + 帧采样。
- Media store：内容哈希目录；媒体不嵌入 JSON。

## 5. 文件布局
```text
narralens/
  vendor/hypit/                 # 固定 SHA 的薄 fork
  vendor/openmontage/           # 固定 SHA，独立 venv
  app/director/                 # 导演面板、空间备选、标题封面
  host/                         # API、actor、事务、事件、SQLite
  adapters/openmontage/         # pipeline 交接、产物归一化
  adapters/hypit/               # author identity、patch、run/build
  contracts/                    # JSON Schema + examples
  projects/<project-id>/
    film/
    media/<sha256>/
    proposals/
    runs/
    .narralens/
```

## 6. 核心数据模型
### CreativeTask
主题、核心观点、目标时长、平台、章节策略、必须保留原话、待核验主张、资料引用、视觉偏好、输出规格。

### NarrationBlock
稳定 `block_id`、文本、语义锚点、音频资源、对齐结果。

### ShotRef
稳定 `shot_id`、章节、帧范围、素材引用、对应 NarrationBlock、分项锁、style override。

### ProposalBundle
`proposal_id/base_revision/selection/preserve/segments/assets/cost/source_refs/renderable`。它是意图，不是 Hypit 工程语法。

### AssetRef
`asset_id/sha256/mime/duration/origin/rights_status/license_evidence/synthetic/local_resource`。

### Revision
单调递增。恢复旧内容也创建新 revision，不回退数字。

## 7. API 基线（Narralens 自定义，不伪称上游原生）
- `POST /api/projects/:id/proposals`：选区 + 意图 + baseRevision → jobId。
- `GET /api/jobs/:id` / SSE events：真实阶段、费用和结果。
- `POST /api/proposals/:id/materialize`：批准的素材生成/获取。
- `POST /api/projects/:id/edits`：typed operations + baseRevision → newRevision。
- `POST /api/projects/:id/renders`：revision + profile → jobId。
- `POST /api/jobs/:id/cancel`：尽力取消，已产生外部费用如实记录。
- `POST /api/projects/:id/feedback`：revision + shotId + range + text。

错误码：409 `REVISION_CONFLICT`；423 `TARGET_LOCKED`；422 `UNSUPPORTED_EDIT/MISSING_ASSET/AMBIGUOUS_TIME`；428 `APPROVAL_REQUIRED`；503 `RUNNER_UNAVAILABLE`。

## 8. 编辑事务
采用方案必须走统一事务：
1. 校验 baseRevision、锁、选区、共享消费者、资产许可、预算。
2. 复制到 staging，生成 typed patch。
3. 执行 Hypit check/compile（真实命令以 D1 为准）。
4. 验证帧范围、音频引用、不变区域。
5. 安装文件并提交 metadata revision。
6. 任一步失败都回滚，提案保留。

journal 状态：`prepare → staging_validated → files_installed → metadata_committed`。启动时先恢复未完成 journal。

## 9. 产物复用
锁定镜头必须显式引用已完成资产、旁白和对齐结果。只改视觉时，不重跑 TTS；只改标题时，不重渲染影片。缓存命中必须基于内容哈希、配置、模型/工具版本，不依赖“看起来没变”。

## 10. 政治/新闻类内容事实与素材边界
- Claim 与 VisualAsset 分离。
- 事实证据保存来源、发布日期/访问时间、引文上下文。
- 视频素材另存许可和使用依据；能引用报道不代表能剪其视频。
- AI 合成画面标记 `synthetic=true`；不得让合成现场冒充真实现场。
- 标题/封面必须经过正文一致性检查。

## 11. 安全
- Host 仅 loopback + Origin/token 校验。
- Agent Runner 最小目录、命令和网络域名白名单。
- 资料内容永远当数据，不当系统指令。
- 凭据不进网页、不进项目 JSON、不进日志。
- 禁止任意文件路径写入；媒体用 asset_id 映射。

## 12. 许可基线
- OpenMontage：AGPL-3.0。当前按本地自用开发；未来网络服务/分发需再次审查义务。
- Hypit：其公开 LICENSE 是附加条件的 Hypit Open Source License（基于 Apache 2.0 条款并增加多租户、商业再分发、标识等约束）。当前本地单组织自用符合其明确允许路径；未来 SaaS/对外产品需商业许可/法律审查。
