# 叙镜验收计划 v1.0

## 0. 三层出门门限

| Gate | 用户操作 | 必需证据 | 出门门限 | 失败动作 |
|---|---|---|---|---|
| Gate P（已批准） | 切换想法/精修/交付；模拟冲突；检查导出阻断 | `prototype-v1/`、交互检查、Archify 收据 | 规格、状态、路线、事实边界一致 | 退回原型 |
| Gate DOC（已通过） | 从任一 P0 追踪到实体、阶段、测试和证据 | MD、7 页 Draw.io、Archify 全系统图、内审与 Claude Code CLI 外审 | 内审和外审均无未关闭致命/重大问题；实际开发已于 2026-10-12 获批 | 继续修订文档；未批准不得开发 |
| Gate D1（已通过，限制已声明） | 30 秒预览→导出→关闭→重开→改一镜→再导出 | 双 MP4、日志、命令、SHA、license、哈希/帧样本 | 声画正确、改动持久、接口来自事实；无字幕夹具不得声称字幕通过 | 停止业务 UI |
| Gate D4.1（已通过，限制已声明） | 同一真实镜头→真实生成三案→键盘比较 | CLI audit、Comparison、结构签名、四类工程 SHA、写 Actor 计数、浏览器截图 | 3–6 全有或全无；只读、无采用、无工程写；内外审 0 未关闭问题 | 打回 D4.1 文档或实现 |
| Gate D4.2（D4.2.1 内审通过，外审待完成） | 选方案→本地导入/绑定→核对许可/影响→采用→真实预览 | import/ffprobe、composite recipe/边界帧、journal、Source/Run/MP4、浏览器证据 | revision +1；旁白/时长/相邻镜头/stable shot 不变；失败可补偿 | 打回 D4.2 文档或对应子阶段 |
| Gate V1 | 真实章节定位→比较→保留旁白采用→锁→恢复→重开→再导出 | 3–5 分钟、20+ 镜头、3 处采用链、失败/性能证据 | PRD、架构、实现、证据一致 | 打回对应开发阶段 |

只有自动化 Gate 与零号用户人工体验 Gate 同时通过，才可声明阶段完成。

## A. D1 底座验收
- [x] 固定 OpenMontage/Hypit commit SHA 和依赖版本。
- [x] 30 秒中文声画项目可预览、导出 MP4。
- [x] 关闭重开后工程完整。
- [x] 修改一个镜头后再次导出；至少抽取目标镜头起始/中点/结束及前后相邻非目标区各 1 个时间点，保留两次导出的时间码、帧样本、音轨/字幕流信息与比较结果。
- [x] 比较容差已在计算 SSIM/PSNR 前冻结并执行；目标区显著变化、非目标区满足门槛、完整解码旁白哈希一致。D1 无字幕流，字幕项明确不在已验证范围。
- [x] 记录真实命令、日志位置和产物路径。

## B. 提案链验收
- [x] 页面发起导演要求，真实 Agent Runner 返回一个 ProposalBundle（D2 范围；3–6 候选待 D4）。
- [x] 每个 proposal 绑定 baseRevision 和选区。
- [x] D4.1 候选完整显示结构、资产缺口、来源状态和真实 CLI 费用；可信来源 manifest 仍待 P0-01。
- [x] 浏览候选不自动触发所有昂贵生成。
- [x] OpenMontage 输出不能直接写主工程。

### B.1 D4.1 多提案比较门限（已通过，限制已声明）

- [x] 单次真实 Claude Code CLI 请求返回用户指定的 3–6 个候选，真实阶段已验 3 个。
- [x] 每个候选通过 schema、帧数、引用和结构差异校验；任一无效则整套失败。
- [x] Host 而非模型绑定 project/revision/selection/ID，并注入真实 CLI 模型、费用与耗时审计。
- [x] UI 可键盘比较策略、分段、素材需求、来源与费用状态；不出现采用按钮或假可渲染状态。
- [x] 422、529、取消、晚到和旧 revision 不自动重试、不覆盖新任务且不丢失用户草稿。
- [x] 正常及失败路径的 Hypit Source、Run、旁白 SHA 与 Narralens revision 全部不变，`ProjectWriteActor` 调用为 0。

## C. 编辑事务验收
用选区 `[start,end)`：
- [ ] 采用方案后总帧数符合差异说明。
- [ ] 非目标相邻镜头逐字段不变。
- [ ] `preserve=narration` 时原旁白资产哈希不变。
- [ ] 视觉锁同时阻止 UI 和 Agent 路径。
- [ ] 过期 proposal 返回 409，不覆盖新版。
- [ ] 写入失败后主 Source 哈希恢复。
- [ ] 历史恢复产生新 revision。

D3 已通过其中：单镜 visual fit 事务总帧数不变、非目标逐字段不变、`preserve=narration` 资产哈希不变、visual 锁 423、旧 revision 409、失败补偿/attention 与真实 Source baseline 恢复。它只证明 visual 这一项主动锁；narration/duration 主动锁、历史恢复和整个 C 章节均未通过，不能由追踪矩阵中的 `partial` 推导为 P0-07 完成。

### C.1 D4.2 素材实体化与采用门限（D4.2.1 候选完成，D4.2.2–D4.2.3 未实现）

#### C.1.1 D4.2.1 契约、本地导入与资产登记（实现及内审通过，外审待完成）

- [x] 浏览器在 Headless Chrome 中真实选择本地 MP4；Host 以受限 multipart/backpressure 流式导入，真实 ffprobe + 完整 ffmpeg decode，API/日志/证据不暴露绝对路径。
- [x] @1 manifest 可读；第一次成功新增 identity 保留旧条目并原子迁移 @2，失败保持/补偿原 bytes 且无第二活跃清单；同批 Hypit fork 支持 @1/@2、expected SHA、四次 TOCTOU 复核，D4.0 全回归。
- [x] 完整库存不含 `project_path`/绝对路径；restricted/unknown 可见但不可采用。每次 GET 重验 realpath/stat/bytes SHA，无跨请求 availability 缓存；size/mtime 不变的篡改也在下一次读取被发现。
- [x] 导入/Source 写复用同一 FIFO `ProjectOperationQueue`；错误不毒化 tail，不同工程可并行；import journal 可重启恢复且不增加 revision event。
- [x] `INVALID_MEDIA`/`MEDIA_TOOL_UNAVAILABLE` 已进入 runtime union/schema/HTTP/UI；busboy 版本、lockfile、类型、许可证和供应链审计留证。
- [x] materialize route 与虚构 adopt route 仍为 404，向 edits 发送 adopt operation 为 422；无 Job/binding/composite/Source/revision 写。
- [x] `generated + cleared` 仍明确显示 synthetic；D4.2.1 不创建 derived，但可读取已有合法 @2 derived。许可可用不等于真实现场。
- [x] 专项 Archify 确定性交付保持 9/9、0 error、0 warning；浏览器 100% 与原生 200% page zoom 均由隔离 Headless Chrome 留证，axe 无 violation，未声明真实屏幕阅读器兼容。

#### C.1.2 D4.2.2 只读实体化与确定性 composite

- [ ] 每个 Proposal segment 绑定 cleared/commercial asset；短素材、缺许可、hash/MIME 错误均 422 且 Source 不变。
- [ ] 异步 materialize Job 无假百分比，取消/晚到/Host 重启语义真实；成功 composite 精确覆盖选区且无音轨。
- [ ] composite 使用 `derived + lineage`，不误标 synthetic；每个 segment 起点/中点/末帧抽样与输入/recipe 一致，真实 ffprobe 与完整解码通过。
- [ ] 成功只显示“已准备采用”；Source、Run、narration、revision 仍完全不变。

#### C.1.3 D4.2.3 事务采用与交互闭环

- [ ] 缺失或过期 impact approval 返回 428；服务端重算确认快照后才允许采用。
- [ ] 采用复用 typed `media.replace`，revision 恰好 +1；原 shot Clip/Window identity、旁白、总时长和相邻镜头不变。
- [ ] 旧 revision、manifest race、visual lock、写入/验证/metadata commit 失败分别产生稳定错误与 abort/compensate/attention 证据。
- [ ] 真实 Hypit check/build/MP4、关闭重开、再次构建通过；D1–D4.1 回归无删除、跳过或降级。

## D. 3–5 分钟章节切片验收（首周）
- [ ] 来自真实 10–15 分钟母项目。
- [ ] 至少 20+ 镜头进入真实工程。
- [ ] 用户能按章节、镜头、语义和时间码定位。
- [ ] 至少 3 个位置完成“多方案→采用→导出”。
- [ ] 中文字幕无明显超框/错位。
- [ ] 音量、静音、截断、黑帧检查通过。
- [ ] 导出后随机抽样帧与预览一致。
- [ ] 重开项目后所有媒体可重新关联：缺失引用为 0；记录总耗时、重试次数与失败率；D6 开始前依据 D1 参考机器冻结 Gate V1 性能预算。
- [ ] 每个章节边界完成过渡检查：无默认章节动画、无非叙事需要的黑帧、无突兀音频断点、字幕不跨越错误章节；零号用户按“自然/需修复”逐项签署，任何“需修复”不得出门。

## E. 完整 10–15 分钟验收（首月）
- [ ] 章节结构完整、过渡自然，无默认刻意章节动画。
- [ ] 小分镜通常 5–10 秒，但允许必要长镜头。
- [ ] 关键事实有来源；争议和作者判断不伪装为事实。
- [ ] AI 合成画面有可追溯标记。
- [ ] 生成 8 个标题候选和至少 4 个封面方向；最终项经人工确认。
- [ ] MP4、字幕、来源/许可清单、标题/封面一起交付。
- [ ] 单次失败不会导致整项目重做或丢失确认结果。

## F. 性能与稳定性
- [ ] 100+ 镜头项目时间轴可交互，不因生成任务阻塞 UI。
- [ ] SSE 断线重连不重复应用旧事件。
- [ ] 任务取消如实显示“已请求取消/已产生费用”。
- [ ] 无 API key/凭据泄漏到前端、项目 JSON、日志。
- [ ] 目录穿越和未登记路径写入被拒绝。

## G. “不弱于 OpenMontage / Hypit”对照验收
不做空泛功能表比较。使用同一脚本、同一素材、相近预算，对比：
1. 成片叙事、画面相关性、字幕、声音、节奏。
2. 指定区间改动的操作步骤和可控性。
3. 保留旁白/已确认素材的能力。
4. 恢复旧版本、重开、再导出。
5. 总耗时、人工步骤、生成费用与失败次数。

开始对照前必须在阶段计划中冻结参考样片/工程哈希、素材集合、预算上限、允许失败次数、计时起止点和参考机器；测试结束后不得为适配结果改写基线。

只有真实成片与修改压力测试通过，才声明在零号用户核心场景“不弱”。

## H. 核心端到端场景与步骤

### E2E-01：定位并局部采用

1. 打开真实 10–15 分钟母项目的 3–5 分钟章节。
2. 用语义搜索定位指定句子，核对 ScriptBlock、NarrationBlock、shotId 与 `[startFrame,endFrame)`。
3. 用 I/O 调整选区，输入“改成三镜组接，保留原旁白，不改变总时长”。
4. 比较至少 3 个结构不同的 Proposal，核对素材、许可、费用与 baseRevision。
5. 锁定旁白/时长并采用一个方案；核对新 revision 和真实 Run。
6. 导出并抽样帧；关闭重开，确认修改持久且相邻非目标区域不变。

门限：三处不同选区全部通过；旁白资产哈希不变；任何一次失败不能损坏主 Source。

### E2E-02：冲突与恢复

1. 分别制造旧 revision、缺素材、画面/旁白/时长锁、未审批外传、Runner 不可用和写入失败。
2. 核对 409/422/423/428/503 或具体写入错误；用户草稿必须保留。
3. 执行重新定位、补素材、解锁、审批、手工编辑或阶段重试。
4. 重启 Host，验证未完成 journal 恢复到最后已提交 revision。

门限：无静默覆盖、无假成功、无主 Source 损坏、无事件重复应用。

### E2E-03：交付

1. 运行黑帧、字幕边界、音量、截断、来源与许可检查。
2. 查看 8 个标题和 4 个封面方向，处理与正文不一致/风险词提示并人工确认。
3. 导出 MP4、字幕、来源/许可清单、标题/封面、版本和生成记录。
4. 随机抽样导出帧对比预览并重开媒体关联。

门限：任何阻塞预检失败时导出不可用且显示原因；交付包文件齐全、引用一致。

## I. 验收证据规范

- 每条证据包含：测试编号、UTC/本地时间、机器环境、上游 SHA、项目/revision/job ID、命令、退出码、日志与产物路径、断言结果。
- 真实能力必须使用真实素材、真实工程和真实输出；mock 只能证明 UI/契约，必须明确标注。
- 截图只证明界面状态，不能独立证明写入、重开或导出；真实 MP4 必须附 ffprobe、帧样本和工程哈希。
- 失败用例同样落盘；不得删除失败日志后只保留成功截图。
