# D4 素材化与采用——能力探测及路线决策

日期：2026-10-12  
状态：路线 A 已于 2026-10-12 获批；D4.0 实现、真实验收、内外审查与 Git 固定均已通过，Hypit fork commit 为 `437563f977541002066e6ee961f83a67cbebd3c2`

## 1. D4 目标

D4 必须完成同一选区 3–6 个结构不同的真实 Proposal 比较，只对选中方案执行素材化，记录来源/许可/外传/费用，并把一个方案真实写入 Hypit 工程、刷新预览。单纯生成三张卡片或继续改 `fit` 都不能通过 D4。

## 2. 探测事实

1. 固定 Hypit `85e01c...` 的 `StudioMutation` 完整公开词汇只有 `timeline.adjust` 与 `parameter.adjust`。
2. D1 真实 session 的 visual item inspector 只公开 frame 边界、z、fit、frame/content position、fit offset/constraint；没有 media/source/asset 绑定字段，track `inspectorObjects` 为空。
3. 当前三个 visual clip 共用 `visual-media`/`visual-source`。修改这个共享 source 会扩大影响到非目标镜头，违反 PRD 默认局部影响。
4. Hypit `PUT /__studio/source` 是全 Source 文本写回，不是 clip/media typed operation。Markup 包提供解析能力，但未发现能把受控 AST 重新序列化为 Author Source 的公开 serializer。
5. D2 真实 Proposal 的 segment `asset_id` 全为 null，`requires_materialization=true`、`renderable=false`；不能诚实地直接采用。
6. OpenMontage 提供 Agent/pipeline/tools 和可产出媒体的本地流程，但不是稳定单一 HTTP API；D4 仍需受控 Runner、明确审批和 AssetManifest。

结论：现有上游公开 typed mutation 能安全完成 D3 参数编辑，不能安全完成 D4 的“新增/替换目标 clip 媒体并保持非目标不变”。若直接写字符串或让 Agent 输出 SVML，会违反已批准架构和验收门限。

## 3. 路线对比

| 路线 | 做法 | 优点 | 风险/代价 | 结论 |
|---|---|---|---|---|
| A. Hypit 薄 fork 新增 typed media mutation | 在固定 Hypit fork 增加内部 `media.replace`；按 authored item + registered asset ID 修改/插入媒体实体，沿用 preimage、compile、rollback、revision | 与唯一事实源和 typed Adapter 一致；长期可测试；不把 Source 文法泄漏给 Narralens/Agent | 需修改 vendor 子模块、补上游测试和许可证/维护记录；设计不当会扩大上游耦合 | **已批准** |
| B. Narralens 自建 SVML AST writer | Narralens 解析完整 Source，建立受限 AST/serializer，生成全文件事务 | 不改上游 API；可快速覆盖当前夹具 | 实际复制 Hypit Author 语法所有权；serializer/注释/格式/引用语义风险高；容易成为第二套编译前端 | 不推荐，除非 A 被否决 |
| C. 预置固定媒体槽并覆盖文件 | 每镜预先引用固定 slot 文件，只替换 slot 内容 | 实现最小 | 内容哈希/缓存/来源身份失真；现有工程需预改；Studio watcher与共享引用风险；不能普遍导入已有工程 | No-Go |
| D. D4 只做参数提案 | 生成 3 个 fit/crop 候选，沿用 D3 写入 | 无上游改造 | 不满足 PRD 的分镜结构、素材化和真实方案采用；会造成虚假 D4 通过 | No-Go |

## 4. 推荐路线 A 的最小边界

已批准 A；先只做一个技术子阶段 D4.0，不生成付费媒体：

1. 在 Hypit fork 定义一个受限 typed mutation，输入只含当前 Studio revision、目标 authored item、已登记 `asset_id`；绝不接收任意路径或 Source 文本。
2. Asset Registry 把 `asset_id` 映射到项目内内容哈希文件，校验 mime/时长/许可；Adapter 不允许客户端传路径。
3. mutation 只改变目标 clip 的媒体绑定；若需要插入 media/normalize 实体，由 Hypit package 自己拥有序列化规则和稳定 ID。
4. 复用 Studio preimage transaction、recompile、postcondition 和 rollback；增加 shared consumer 检测，影响超过目标即 422。
5. 用 D1 fixture 中一个预生成且有明确本地来源的 10 秒替代资产做真实 `shot-002` 替换→重开→check/plan/build→正常事务恢复，不调用外部生成 Provider。
6. D4.0 通过后再冻结 D4.1 三提案契约和 D4.2 选中方案 materialize；首次真实素材 Provider 的外传字段、许可、费用与审批单独 Gate。

## 5. 路线 A 出门门限

- Hypit 新 mutation 有类型、server validation、package/unit/integration tests；无 Narralens regex/全 Source writer。
- 目标 clip media hash 改变，非目标 item、旁白、时长和 Run 定义逐字段/哈希不变。
- stale Studio revision 409、未知/越界 asset 422、shared consumer 影响扩大 422、编译失败回滚。
- 关闭重开仍存在，真实 build 可完成，恢复 baseline 走第二个正常 mutation。
- vendor submodule commit 可复现，许可证边界仍为本地单组织自用；任何对外分发另审。

## 6. 当前停止原因

这是上游编辑词汇和所有权边界的实质扩展。项目负责人已经批准路线 A，但批准路线不等于批准无门禁开工。D1–D3 已完成且不受影响；当前先按 `D4.0-development-and-acceptance-plan.md` 完成内外文档审查，通过后才修改 Hypit fork 与 Narralens 实现。
