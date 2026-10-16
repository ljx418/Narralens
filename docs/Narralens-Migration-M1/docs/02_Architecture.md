# 新旧架构、ADR 与唯一写入控制

## 1. L0：旧架构与目标架构

| 层 | 旧基线/用户报告 | 目标设计 | 迁移动作 |
|---|---|---|---|
| 交互 | 单页 Host + 少量镜头fixture；完整工作台未实现 | OpenFilm Studio同一React应用，导演地图/原生精剪共享播放位置 | 不新造NLE，不嵌两个iframe编辑器 |
| 内容智能 | 真实Claude CLI Runner与结构化多提案 | 沿用Runner；VibeMovie方法适配为ProposalPlanner | 保留D4.1；不另建Gemini后端 |
| 控制平面 | Narralens revision/lock/typed edit/journal | 同一Host + EditCoordinator + EnginePort + 持久Job/Event | 补原生写入、历史、导出及provider边界 |
| 媒体 | 导入/库存/Manifest@2 | 同一资产台账+代理+derived lineage | 原生拖入也调用现有导入服务 |
| 工程 | Hypit Author Source + Run | OpenFilm film.html及依赖闭包+受控已提交快照 | 每个项目只绑定一个引擎 |
| 预览/渲染 | Hypit真实build，仅短fixture验过 | OpenFilm播放器/检查/默认渲染 | 新引擎真实重验，不复刻渲染器 |
| 可选扩展 | OpenMontage设计上游 | OpenMontage/HyperFrames/HeyGen独立能力适配 | 输出提案或资产，不写最终工程 |

```text
单一 Narralens / OpenFilm Studio 应用
  ├─ 原生播放器、时间轴、Inspector、导出控件
  └─ StoryAtlas、CandidateFocus、证据/决策上下文
                    │ Typed Command / 只读投影
                    ▼
Narralens Host（唯一公开loopback入口，原有Origin/token）
  EditCoordinator / ProjectActor / LockService / Job&Event / AssetRegistry
                    │
              EnginePort（按project.engine分派）
         ┌──────────┴───────────┐
     HypitAdapter             OpenFilmAdapter
     旧基线/回退               新项目、固定fork
     不双向同步                staging → validate → commit snapshot
                                   │
                    film.html + scenes + subtitles + settings
                                   │
                    readonly preview / render / QC / delivery
```

## 2. 六条不可折中的 ADR

**ADR-001 单项目单引擎。** 应用在过渡期可以打开两类项目，但一个 projectId 只有一个 engine binding。禁止每次编辑双写 Hypit 和 OpenFilm。研究提案和地图位置不是第二份最终影片。

**ADR-002 Native Studio 也不能绕过规则。** patch 原生编辑 transport 和实际服务器写入边界；将可支持动作转换为类型化意图。无法判断影响/无法遵守锁的原生操作必须显式禁用并显示原因，不能匿名透传。仅拦新导演按钮或仅隐藏旧端口不算完成。

**ADR-003 默认 OpenFilm 渲染。** VibeMovie不作为全片renderer。ffmpeg合成可用于候选proxy；生成MP4不是已拥有内部可编辑轨道。

**ADR-004 复用已建 Runner。** 编程助手（本地Codex）、运行提案CLI（现有Claude）、独立审计（Claude Code独立会话）分别记录角色。外审不可用则 REVIEW_PENDING，不自签PASS。

**ADR-005 staging隔离，审阅后提交。** 模型、插件、OpenFilm原生写逻辑只能编辑staging；渲染读取不可变snapshot。最终commit由Narralens协调。直接把线上source文件夹授予CLI写权限不在安全边界内。

**ADR-006 先收口再接管、可前进不隐式回退。** M1B可探测，M2以前不接管。迁移是copy-on-migrate；回退重新激活旧副本，不把新编辑自动逆转换到Hypit。

## 3. OpenFilm实际可复用的落点（R1–R5）

官方布局包括 `studio/ui`（React/Vite）、`studio/server`（项目/编辑/历史/媒体）、`src`（工程/检查/渲染）。`ProjectView.tsx` 已连接 Timeline、Preview、SourcePreview、Inspector、ExportCenter等，适合在现有应用内增量开发。[R1][R2]

`film.mjs` 当前 `editProjectFilm(root,base,ops)` 在写入后报告 `rebased`；它没有以 base 不同作为统一拒绝条件。[R3] 因此不能把其返回成功等同于 Narralens 的严格409。`revOf` 只基于 film.html 的短摘要；Narralens继续保留自己的数值revision和完整依赖摘要，不拿它替换既有合同。

文档中出现的上游路径是2026-10-16读到的main源码位置，**不是固定SHA后的稳定API承诺**。本包未成功获得full commit SHA；M1B本地固定并保存代码定位、依赖lock和许可证摘要后使用。npm发布版和源码运行条件可能不同，不照抄latest命令执行生产流程。

## 4. 原生写入路径登记必须逐项完成

| 入口 | 策略 | 审核 |
|---|---|---|
| timeline trim/move/split/speed | 映射帧范围、timing/visual影响、revision；事务提交 | 真实拖拽＋直接HTTP均测试 |
| Inspector crop/fit/text/overrides | typed operation；原生optimistic preview仅为draft | 锁定时server拒绝且UI复位 |
| 资产拖入/粘贴/上传 | 进入原有AssetImportService；未登记asset不能采用 | provenance与manifest契约一致 |
| subtitle/audio edits | 共享消费者和narration锁；对齐失效标记 | 不能静默重算已锁旁白 |
| 原生undo/redo/history restore | 翻译为受控恢复/new revision | 不直接git checkout覆盖source |
| native provider生成/CLI get | 同一预算/外传授权；产物先暂存 | 不允许隐藏副作用入口 |
| 导出与自动保存 | snapshot固定；draft与commit区分 | 导出不能读半写入stage |
| 外部编辑器/文件watch/Agent写文件 | 只写stage；意外变更进入attention | watcher不能自动接受为已审修订 |
| rename/delete/import project/模板覆盖 | 范围全项目、不可绕过原子性和路径安全 | 未适配前禁用 |

路由清单必须包括 HTTP、WebSocket/IPC、CLI、原生文件操作和第三方provider回调。每条写入口具有 `translated/blocked/read_only` 策略及测试编号；`unknown` 存在时 M2 不通过。

## 5. 工程主记录与运行权限

控制层保留既有store/journal，新增 EngineBinding 与 SourceSnapshot。目标存储采用不可变revision目录和一个持久commit-record。以现有持久存储实现原子提交；若需要更换store/增加数据库，必须先提交schema迁移ADR并演练旧journal恢复，不顺手换掉整套Host。

现有Host单项目互斥扩展为所有写动作共用的ProjectActor。stage在同文件系统；原生write函数对stage调用，不对active snapshot调用。每次预览/媒体请求绑定snapshot-id，避免一个播放器混读两个修订。服务重启先恢复未完成journal，再开放写入口。

这保护受控应用和worker路径，不宣称能抵御同操作系统用户使用管理员权限强改文件。对于意外外部修改需检测并隔离；运行不可信scene时，应使用无凭据、受限文件和网络的工作进程，不能只靠路径约定。
