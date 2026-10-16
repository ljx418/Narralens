# 插件路线、依赖治理与执行安全

## 1. 迁移时不拼装三套主工程

OpenFilm是主编辑/默认渲染。VibeMovie代码核查显示其AI请求/规范化围绕完整时间线输出，render调用Remotion；本包只借鉴prompt/context/验证方法，输出仍是现有Narralens结构化提案。[R6][R7] 现有Claude Runner不因迁移强制改为Gemini。若复制代码，保留来源、MIT通知和改动记录，先验收更严格的ID/资产/范围规则。

HyperFrames提供HTML素材/动效能力，但其运行合同不同，不与OpenFilm网页场景直接等同。[R8] 首次插件可输出带lineage的媒体或参数化scene；不可编辑资产明确标识。HeyGen商业API需要单独权限/费用配置，非迁移必需项。

## 2. 三类能力插件

| 类型 | 输入 | 输出 | 不允许 |
|---|---|---|---|
| planner | 创作brief、只读projection、已登记assets | proposal/claim/scene plan | author source全量覆盖、任意URL、执行shell |
| media provider | 授权素材需求、预算、外传清单 | staging文件、receipt、cost、rights/provenance | 直接进timeline或绕库存登记 |
| scene/post worker | 冻结参数/素材snapshot | native可编辑scene或parameterized/flattened资产 | 未声明编辑性损失、未经确认运行任意网络 |

M2只定义边界/默认deny，M7C再实现最少所需插件；没有必要先做插件商店、热加载任意包或通用AgentOS。旧HarnessOS能力不作为依赖引入，避免范围漂移。

## 3. 费用与外传

OpenFilm现有provider contract覆盖多个生成/检索动词，但当前Spend是视频生成确认且不含金额预算。[R5] 叙镜必须以现有成本审计继续扩展：预算currency、estimate/max授权、expiry、已保留额、真实receipt、unknown-cost分开。仅浏览本地proxy免费；用户点“多备选”不自动授权多次付费生成。

所有实际外传列assetId/hash、目的provider/model、目的、保留策略和批准范围。引用/脚本和原视频是否发出分开审批。默认本地素材留本机；免费服务也要外传审批。失败重试遵守幂等/receipt；未知完成态先核对，不盲目重复收费。

## 4. 运行与供应链

固定OpenFilm的full SHA、pnpm lock digest、node/ffmpeg/browser/fonts；仓库scripts而非npx latest作为日常入口。上游升级独立ticket，重跑adapter/native写入/恢复合同和媒体回归，不自动追main。

保留MIT来源声明和OpenFilm商标边界，用Narralens名称发布自有修改版。[R9] VibeMovie MIT不等于其所有依赖许可同样；不采用Remotion后端就不必为了迁移额外引入它。[R10] HyperFrames为Apache2.0，若分发修改版/模板资产分别保留相应通知。[R11] Hypit/OpenMontage既有义务不因换引擎自动消失；若保留/分发相关代码按固定版本审核。

依赖安装脚本可执行代码；M1B在隔离worktree/环境进行，记录批准操作，不让上游安装修改当前main或用户凭据。scene执行进程没有Host secret/通用FS/随意网络，远端HTML默认不直接运行。通过受控本地资产路由加载文件，禁止directory traversal/symlink与开放CORS。

## 5. 插件验收

逐能力声明version、upstream SHA、kind、允许网络/文件、输入输出schema、输出编辑性、价格策略、取消/超时策略。unknown capability拒绝；不能从插件元数据直接推断执行完成。旧plugin结果带过期base只能入候选库；不允许回调直接采用。
