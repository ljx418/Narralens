# R2：初审闭环、设计反思与 ComfyUI 接入

状态：文档修订候选；未开发新业务接口、未启动ComfyUI、未提交生成任务、未下载权重。
用户文件原件：`reviews/user-review-r1.json`。导出版本与R1的5份文档SHA256逐一相符；原件27认可/3需修改/2待讨论，不代表新路线实现批准。

## 1. 审核意见逐条处置

| 原ID | 用户意见 | R2修订 | 当前处置 |
|---|---|---|---|
| E02 | Agent主动启发提问，界面覆盖主题/内容/时长/风格 | 创作简报+结构化问题/回答，已知信息不重问，少量分批提问，假设可见可改 | 修改方案待复核 |
| E03 | 待讨论，无附注 | 保留资料/主张/脚本分层；建议正文优先、来源展开、争议集中审查 | 待用户澄清，不能宣称关闭 |
| E05 | 根据主题相关性、脚本、台词分阶段下载 | AssetPlanService按topic→chapter→shot/utterance建需求，先候选后下载，已选方案优先 | 修改方案待复核 |
| E15 | 工作流图展示状态和每节点输入输出，能复查独立编辑 | 业务DAG+NodeInspector，artifact version+依赖stale+受控局部重算 | 修改方案待复核 |
| A06 | 多镜下载、多个章节拼接/音频合成并行 | DriverSession与ResourceScheduler分离；child jobs按资源容量并发；正式写串行 | 修改方案待复核 |

其余认可项保留历史认可，但关联条目变化不可自动沿用为R2签署。新增E17..19/A11..12及S2/S3/S4的本地生成、工作流、资源验收需重新核对。

## 2. 对R1的反思

1. R1仍偏向“工具集合”，欠缺创作对象和过程呈现。现在以版本化brief/script/storyboard/asset plan/voice/concept/transition/delivery为工作流节点产物，让人能检查与独立修订。
2. “Agent自己规划”不能成为界面无下一步指引的理由。需要WorkflowProjection与ActionSuggestions把当前决定/等待项映射到用户能操作的入口。
3. 素材下载不是一个泛化按钮，应是被脚本与镜头需求驱动、受许可与相关性约束的分阶段任务。
4. 单活动驱动租约的含义写得不充分；它不应限制底层并发。下载、章节渲染、音频处理可以并发，但竞争同一显卡的大模型任务不应盲目同时加载。
5. 本地既有能力应先利用，不优先重造服务或重下载模型；但“目录里有JSON”绝不是现阶段生成能力验收通过。
6. 概念说明的精确内容与生成模型应分离。中文术语、数学/因果/流程关系应由可编辑确定性层承载，背景与动态可以AI生成。不能用漂亮视频掩盖概念错误。

## 3. 本地现场清单与证据等级

机器生成的文件/节点/格式/摘要清单：`local-comfy-inventory.json`，由 `tools/inspect-local-comfy-design.mjs` 只读扫描。

| 路线 | 本地实体 | 用途 | 本轮观察与限制 |
|---|---|---|---|
| 图像生成 | `C:/ComfyUI-aki-v2/ComfyUI/user/default/workflows/项目工作流总库/05_图像生成与编辑/（工作流）image_z_image_turbo.json` | 概念图、分镜、封面 | canvas格式，不是API图；另一个同名简化图有子图UUID，需展开/转换并验证节点与模型，未跑生成 |
| H3参考图 | `comfyui-ai-comic-workflows/workflows/api/01_H3_R2V_Character_Cinematic_5s.api.json` | 统一参考的主题/概念镜头 | prompt封套、17节点，非裸graph；历史注册表与逐路线文档状态不一致 |
| H3首尾帧 | `.../02_H3_FL2V_Storyboard_5s.api.json` | 概念镜头、首尾连接/转场候选 | prompt封套、17节点；历史低规格smoke约260s，不把它当正式5秒性能保证 |
| Wan低内存I2V | `.../03B_Wan22_I2V_Wrapper_LowMem_Smoke.api.json` | 静态图→短动态 | prompt封套、14节点；历史448×256/33帧/16fps，不能冒充1080p正式产出 |
| RIFE | `.../05A_Finish_RIFE_Prepare_30fps.api.json` | 插帧准备 | 6节点，输出图片序列；不能仅提交此图就称交付MP4 |
| AnimeSharp后期 | `.../05B_Finish_Fast_AnimeSharp_1080p.api.json` | 分批清晰化 | 5节点，需复用`run_fast_finish.py`完成磁盘分批、编码和媒体核验 |
| SeedVR2 | `.../06_Finish_HQ_SeedVR2_1080p.api.json` | 可选高质量修复 | 2个自定义后台job节点；Comfy图执行结束可能只得到外部job handle，需第二层状态确认 |
| 上游已有包装 | `Narralens/vendor/OpenMontage/tools/_comfyui/workflows/{flux2-txt2img,wan22-i2v-4step,wan22-t2v-4step}.json`及Python工具 | 方法与HTTP客户端参考 | 上游标EXPERIMENTAL；不是Narralens已接通生产服务，默认输出路径/重试/模型检查需适配，不能直接暴露任意workflow_path |

现有更广泛库中的人物迁移、动作驱动等不是本轮优先场景，不为接入概念图而整库复制。模型、插件、工作流各自有许可与依赖，需逐条记录；主程序许可证不替代模型许可。

读取的本地Comfy源码HEAD为 `086099f5d8886163ef77dc354f8382cb7431582a`（仅观察，不修改/固定该外部工程）。本地workflow集合无Git对象，应用候选使用文件SHA256绑定。历史preflight报告ready=false、4个阻塞；其中曾缺失的CLIP Vision当前文件存在，而Wan Animate 2指定权重仍不存在。这证明历史状态会过期，必须重新做环境指纹和真实探针。

本轮不声称Comfy服务在线；WSL监听列表未观察到8188/8189/8190，但这不能排除其他Windows端点。本轮未做模型加载、节点执行、完整显存/时延基准或媒体审美验收。全候选 `CANDIDATE_NOT_INTEGRATED / runtimeTest=NOT_RUN`。

## 4. Comfy能力目录与模板合同草案

`ComfyWorkflowManifestV1`（拟定，不是现有API）至少包含：

- identity：workflow_id/version、源文件SHA256、Comfy/自定义节点commit或包版本、model清单与指纹、license信息。
- API形态：canvas/api graph/prompt envelope；转换产物hash；绑定允许修改的node_id+input_key、输出节点/输出类型。禁止模型按自由JSON注入任意节点。
- 语义输入：prompt、negative、reference asset IDs、start/end frame assets、seed、宽高、目标时长/帧数、fps rational、质量档、风格版本；约束单位、范围和默认值。
- 资源：server/GPU归属、估计VRAM/RAM/磁盘、是否排他、模型驻留与卸载策略、超时/取消/恢复能力。
- 结果：同步媒体或异步子job handle；history输出filename/subfolder/type、成品验证、来源/生成标记、输入摘要与产物哈希。
- 可用性：file_discovered → schema_validated → dependencies_verified → smoke_verified → quality_approved；当前节点/模型/硬件指纹变化使状态失效，不自动保持available。

ComfyAdapter只接受批准的manifest与语义参数，解析封套、应用白名单映射、验证依赖后提交；websocket只作为进度信号，最终状态结合prompt history、外部子job状态、文件和媒体校验。网络断开不等于执行失败，不盲目重提。seed+workflow hash+model版本可追踪，但GPU算子不保证跨环境逐字节确定性。

AssetRegistry保存产物副本或可验证的受控引用，不依赖Comfy临时output文件永远存在。后续采用只引用已登记资产；Comfy输出不能直接覆盖film.html或增加工程revision。

## 5. 精确概念说明和转场合同

`ConceptSceneSpec`（拟定）：concept_id、source_claim_refs、术语/关系/数字、narration_range、semantic diagram layers、background asset、风格、时长、synthetic标记。生成背景不携关键术语，文字与关系由原生HTML/SVG/字幕层生成。预览阶段检查错字、方向、因果、遮挡和阅读时间；不合格退回设计或换确定性图形。

`TransitionSpec`（拟定）：from_clip/to_clip、两端snapshot/内容摘要、可用handle帧、目标过渡窗、锁定总帧、首尾参考、音轨保持、风格、candidate asset、风险。首尾帧模型只是候选，不保证端点像素精确或内容连贯；必须做端点接近度/跳变和人工观感核验。缺少handles或锁冲突时拒绝/改方案，不暗中加长影片或改旁白。默认普通cut/dissolve和可编辑图形可作为用户可见备选，不能悄悄把失败AI转场标成通过。

“视频专场”本轮按主题化连续片段/专有概念说明理解，并额外纳入AI转场；两者分别验收，术语仍可由用户澄清。

## 6. 并行队列与资源模型

DriverSession是编排者身份与接管控制；ProjectOperationQueue是正式工程写入串行；Job/ChildJob负责可并发的准备。三者不能混用。

ResourceScheduler按IO下载、CPU合成、GPU推理和总RAM/磁盘保留执行槽；容量由参考机配置与真实峰值决定，不硬编码“越多越快”。

- 同时下载多个已批准镜头；先去重缓存/URL与asset intent，再按IO容量执行。
- 章节视频/音频可以针对不可变输入分段并行prepare；汇总验证后一次计划提交，不让worker直接写主timeline。
- 单4090的大模型任务初期用GPU独占槽，同模型连续批次优先减少加载；但有公平性和显式优先级，不能永远饿死别章。资源不足显示waiting_resource，不报假失败。
- 进度使用实际运行/完成的child job计数；estimated与measured分开。取消父任务传播到自有child jobs，已完成资产保留，晚到结果隔离。
- 缓存键含输入内容/模型/工作流/seed/参数/生成器版本；复用时仍检查许可和文件完整性。内容或资源错误与“实际内容变化”分开，瞬时读失败不能永久锁死项目。

本地Comfy `server.py` 支持带prompt_id的interrupt检查，同时存在无ID全局interrupt；不因返回200就标取消成功。接入默认使用自有队列项和自有服务实例，避免打断其他项目；共享服务不能验证安全归属时只取消未提交/待执行的自有任务或标记requested_cancel，等待运行结果隔离。禁止全局清队列/全局卸载模型。还需用固定版本重验针对ID中断的竞态，不单靠静态源码承诺隔离。

## 7. 工作流编辑与局部重算

NodeInspector展示输入/输出artifact版本、媒体预览、来源、当前attempt、参数、日志摘要和下一步。文本可直接编辑；媒体可以替换或调参数另生成；已提交工程使用原编辑入口；高级Comfy图修改需要新模板版本、重新验证，不直接改正在执行的prompt。

`ArtifactRevisionService`接收base_artifact_version与新内容，验证并建新版本；`DependencyImpactService`计算直接和传递消费者，明确“只重跑这章的素材与画面；其他章和锁定旁白不变”。重算先生成新execution attempt，旧artifact与旧预览仍可查看；输入在运行中变化时结果记obsolete而不是自动采用。DAG重组还需workflow_revision CAS与环检测，编排不能产生自循环无限重试。

## 8. 开发顺序优化

- S0：把启发问题、业务图、节点详情/编辑/重算与概念片段做进原型审查；不只展示长文。
- S1：只读Comfy模板发现与依赖探针、资源能力目录；不加载全部大模型预热，不创建执行任务。
- S2：持久短片链增加只读业务图；先用确定性概念图完成一条可用链，同时在独立探针验证选定的一图/一视频模板。探针未通过不冒充生产能力。
- S3：图节点编辑、按镜头/台词AssetPlan、IO/CPU并行与驱动接管先闭环，确保后来GPU任务能正确调度与取消。
- S4：Comfy模板→任务→资产→原生clip/概念/转场全链，渐进质量档；声音、标题封面与QC一起完成。每类能力需要真实媒体和人工观感。
- S5：长片与多驱动接力、跨章节重算、资源峰值与质量一致性，保留原P0/P1门。

## 9. 技术来源

- [ComfyUI 官方服务总览](https://docs.comfy.org/development/comfyui-server/comms_overview)：服务可用HTTP/WS驱动，提交后的prompt是执行输入快照；修改工作台内容不自动改变已提交任务。
- [ComfyUI 官方路由](https://docs.comfy.org/development/comfyui-server/comms_routes)：prompt、queue、history、object_info、system_stats、上传/产物/interrupt接口；实际接入以固定本地版本探针为准。
- 本地候选清单/文档/源码为本轮只读事实；历史smoke不替代Narralens集成验收。
