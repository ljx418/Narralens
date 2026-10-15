# 从当前中断点到 V1.0 的剩余路线

必须串行推进。前一阶段未出门，不得实现后一阶段。

## R0 — D4.2.1 收口（当前）

浏览器复跑、真实 Chrome 原生 200% 页面缩放、全量 126/126、证据清单、内部总审计和实现提交 `84775af` 已完成。剩余：Claude 独立只读总审计；若有发现则修订并重跑相关门禁，若 PASS/YES 则同步最终状态、提交文档/证据并推送。不得扩展 materialize/adopt。

## R1 — D4.2.2 文档闭环

先从总体 D4.2 计划拆出独立计划：segment binding、异步 Materialize Job、受控 ffmpeg renderer、canonical recipe、content-addressed composite、`derived + lineage`、MaterializedProposal 原子发布、取消/晚到/重启。使用 Archify 更新专项架构；完成内部审查与新的 Claude Code CLI 外审，critical/major/must-fix 全零后才能编码。

## R2 — D4.2.2 实现与验收

以三个真实输入生成精确 300 帧、无音轨 composite；每段起点/中点/末帧与 recipe 匹配。成功只显示“已准备采用”，Source/Run/narration/revision 全部不变。验证确定性：同环境同 recipe 双跑；若 libx264 不能 byte-exact，退回文档重新定义为 canonical recipe + semantic/frame determinism，禁止伪称 byte determinism。

## R3 — D4.2.3 文档闭环

冻结 impact snapshot/SHA、428 语义、adopt operation、journal 状态、adopted marker、typed `media.replace` 复用、补偿/attention、旧 comparison/materialization/revision/manifest 拒绝、UI 确认与预览刷新。内外审通过后开发。

## R4 — D4.2.3 实现与 D4.2 总出门

真实 D4.1 comparison → import/bind → materialize → impact confirmation → adopt → Hypit build → Host/Studio restart → rebuild。revision 恰好 +1；旁白字节、总帧数、相邻镜头、stable identity 不变；visual lock 与直调 API 均 423；失败不假成功。完成 D4.2 总 evidence manifest、内外审和 Git 推送。

## R5 — D5 文档闭环与实现

必须先补充当前仅为纲要的详细计划，至少包括：

- narration/duration 主动 LockPolicy，与 UI/Agent/直调 API 同一服务端门禁；
- 字幕与语音对齐不变量；已锁旁白/字幕/已确认素材的产物复用；
- 用户历史、撤回、恢复为新 revision，不覆写历史；
- Job/SSE 持久化，崩溃、取消、晚到、重复事件、外部文件修改；
- 工程 attention 的可诊断与人工恢复路径；
- 安全/性能/可访问性与真实重启证据。

D5 当前文档不足以直接支持自动实现。Claude 必须先新建 D5 阶段总计划和按可独立验收能力拆分的子计划，完成 PRD 追踪、逐实体所有权、状态机、API/schema、错误码、故障矩阵、专项架构、内审和外审；计划缺失本身触发文档开发，不触发猜测式实现。只有出现无法由现有 PRD/架构消解的产品路线分歧时才停止并请用户选择。

## R6 — D6 产品工作台与真实章节切片

先按 P0-01 至 P0-05 拆分实体、路由、API/schema、时间码合同和逐功能 Gate，再实现 CreativeTask/项目创建、章节/脚本/镜头导航、真实播放器与统一时间码、全片/局部时间轴、区间/逐帧选择。若性能 harness 尚不存在，先在专项计划中定义并审查后实现；以 3–5 分钟、20+ 镜头真实章节验证 100+/120 镜头性能、三种定位入口一致、无第二份最终时间轴。

## R7 — D7 交付闭环与 Gate V1

先拆分 P0-11 至 P0-13 的 API/schema、阻断规则和 E2E-01/02/03 ticket，再实现标题/封面候选、发布前检查、字幕/声音/黑帧/许可阻断与交付包。完成至少三个不同位置的“比较→素材化→采用→导出”，重开后缺失媒体引用为 0。执行真实 3–5 分钟零号用户流程、双导出、性能/失败率/人工步骤记录、中文 HTML 可视化验收报告和人工验收。

## R8 — V1.0 发布审计

同步 PRD、架构、Draw.io、计划、追踪矩阵与代码事实；全量测试、依赖/凭据扫描、证据哈希；Claude 独立总审查；打开最终 HTML 与真实服务供人工体验。只有自动 Gate 与人工 Gate 均通过才标记 V1.0。最后清理工作树、提交并推送，然后使用 `sync-project-progress` skill 同步项目进展。

## 预估文档覆盖

- D4.2.1：实现及内部验证完成，只差独立外部总审计、最终状态提交与推送；Gate 尚未关闭。
- D4.2.2–D4.2.3：总体规格约 80%，足以开始专项文档，不足以跳过专项审计直接开发。
- D5：约 35%，只有目标和出门方向，缺状态机/API/schema/故障与测试细节。
- D6–D7：约 45%，用户路径与 Gate 已定义，但代码实体、数据合同、性能基线、真实素材包和逐子阶段计划不足。
- V1 总验收：约 70%，验收场景明确，但要由各阶段证据补齐。
