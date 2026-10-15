# 叙镜：决策与待确认项

## 已锁定
- 名称：**叙镜 · AI 导演工作台** / **Narralens — AI-Assisted Directing Studio**。
- 首发：时政观点型中文长视频。
- 时长：通常 10–12 分钟，必要时 15 分钟。
- 目标：把问题说透、把来龙去脉讲清。
- 小分镜：通常 5–10 秒，软约束。
- 章节：文案明确、画面自然，不默认刻意过渡。
- 封面：AI 辅助，但需契合实际。
- 标题：AI 多候选，吸引力与准确性并重。
- 体验优先级：第一阶段逐镜可控和精修质量；后续稳定出片、批量和风格控制。
- 集成：OpenMontage 创作/素材上游 + Hypit 编辑/渲染底座 + Narralens 统一控制层。
- 2026-10-12：`prototype-v0` 获准作为 V1 开发目标原型；一级信息架构固定为“想法 → 精修 → 交付”。
- V1 实际开发已批准；Gate D1、D2、D3、D4.0 已通过，未完成的 D4.1/D4.2 不得提前标记实现。
- 2026-10-12：V1 文档架构固定 `NarralensApp → LocalHost API → ProjectWriteActor → HypitAdapter → Author Source + Run` 为真实写入主路径；`OpenMontageAdapter → Proposal Staging` 是受控支路。
- Gate 分为原型 P、文档 DOC、开发准入 D1、实现出门 V1；前一 Gate 通过不代表后一 Gate 已通过。
- 2026-10-12：项目负责人批准 V1 开发计划与 Draw.io 方向；内部独立文档审查已在批准前完成。
- 单一版本阶段固定执行六步循环：原型开发 → 原型审查 → 阶段性原型优化 → 开发文档迭代闭环 → 逐子阶段开发迭代 → 阶段性审查/报告/Git。V1 未完成第 6 步前不得启动 V2。
- 2026-10-12：Claude Code CLI 完成首轮只读外审，结论为“可进入实际开发审批”，致命/重大问题为 0；4 个一般问题进入文档闭环。外审结论不等于实际开发批准。
- 2026-10-12：4 个一般问题修订后，Claude Code CLI 第二轮只读复审确认 G1—G4 全部关闭，未新增致命/重大/一般问题；Gate DOC 外审闭环，生产开发仍未批准。
- 2026-10-12：项目负责人批准进入实际开发；V1 第 5 步从 D0/D1 真实底座探测开始。项目 Git 仓固定为 `https://github.com/ljx418/Narralens`，默认分支 `main`。
- 2026-10-12：项目负责人批准将本机 Claude Code CLI 用作 D2 真实产品 Runner，并允许复用本机既有登录态；外传仍严格限制为项目摘要、revision、选区、导演意图、preserve 和固定 pipeline/schema 摘要，不发送媒体、凭据、绝对路径或任意文件。
- 2026-10-12：D2 Runner 不设置本地硬性预算上限或调用次数；服务端 422/529 等约束必须如实映射为 `PROVIDER_REJECTED`/`PROVIDER_OVERLOADED`。单个 job 不自动重试，避免重复费用与无限重试；用户可显式重试。
- 许可证复审触发条件：对外网络服务、SaaS、多租户、商业再分发、移除或改变上游标识、自动发布/分发，或改变当前“本地单组织自用”边界。触发任一条件必须新建 ADR 并完成许可证/法律复审后才能实现。

## 开发基线中的默认值（可配置，不阻塞开工）
- B 站优先，16:9，1920×1080，30fps。
- 第一周验收：真实 10–15 分钟母项目中的 3–5 分钟章节切片；全片脚本/章节/粗分镜已进入工作台。
- 第一个月：完整 10–15 分钟闭环。
- 标题默认 8 个候选；封面默认 4 个方向。
- 第一阶段手动发布。
- “不弱于 OpenMontage/Hypit”对照的参考样片/工程哈希、素材集合、预算上限、允许失败次数、计时口径和参考机器必须在对应阶段测试前冻结，具体值由 D1 真实环境与零号用户约束确定。

## D1 事实验证结论

1. Hypit 0.3.1 的 Source/Run/Result、真实命令、Studio 服务端写回及 revision 冲突保护已经实测。
2. OpenMontage 固定版本的 pipeline、artifact schema 与 registry 已探测；其 Agent 工作流不得伪装成稳定 HTTP 服务。
3. 参考机为 i7-13700KF（24 logical CPUs）、15 GiB WSL 内存、RTX 4090 24 GiB、FFmpeg 6.1.1；30 秒夹具通过，但 10–15 分钟真实项目性能必须在 D6 前单独冻结门槛。
4. 两仓库许可证文本和哈希已记录；当前仅批准本地、单组织自用，商业分发/SaaS 需重审。

因此 D1-blocked 已解除，允许进入 D2；这不等于 Adapter、TimelineSurface 或真实 Provider 已实现。

## D2/D3 决策

1. D2 已通过真实 Claude Code CLI Runner、SSE 页面链和单个 ProposalBundle 验收；它不等于 3–6 提案比较或工程写入。
2. D3 使用 Hypit Studio 真实 `parameter.adjust` 接口实现单镜头 `fit` 写入；业务 shot ID 显式映射 authored ID，不暴露或持久依赖绝对 item ID。
3. D3 不把自然语言 Proposal 猜测为源码/fit 操作；当前不可渲染提案的 materialize 与采用属于 D4。
4. Narralens project revision 与 Hypit Studio session revision 分离；跨文件/数据库原子性由 journal、补偿和启动恢复实现，未知第三状态必须阻断写入。

## 后续可在对话中继续确认，但不阻塞 D1
- 第一版旁白：本人录音还是授权 TTS 为默认。
- 允许进入成片的素材来源白名单。
- 单条视频模型/API 预算上限。
- 3 个参考视频及“具体喜欢的点”。
- 标题/封面更偏克制、媒体感还是强点击风格。

## D4 高风险路线决策

- 固定 Hypit Studio typed mutation 目前不能新增/替换 visual clip 的媒体绑定；当前 inspector 无 media/source 字段。
- 2026-10-12：项目负责人批准路线 A，在 Hypit 薄 fork 新增 package-owned typed media mutation；Narralens 自建 SVML AST writer 路线不采用。
- 固定 slot 覆盖和“只做 fit 提案”均为 No-Go。详见 `implementation/D4-capability-spike-and-route-decision.md`。
- D4.0 类型化本地媒体替换的实现外审最终 PASS；负责人已创建 `ljx418/hypit`，实现固定在分支 `narralens/d4-typed-media-mutation` 的 commit `437563f977541002066e6ee961f83a67cbebd3c2`，主仓子模块指向该提交。

## D4.2.1 导入与错误边界决策

1. D4.2.1 只接收浏览器选择的本地 MP4 与用户填写的来源/许可声明；不接受远程 URL 导入、不解引用 `source.uri`、不下载、不检索、不生成，也不产生 provider 调用或费用。远程获取仍属于 P1/后续另行审批范围。
2. `INVALID_MEDIA`（422）与 `MEDIA_TOOL_UNAVAILABLE`（503）是对 P0-08 本地媒体导入既有错误边界的稳定 API 细化，不增加 PRD 功能范围：前者表示输入内容不合格，后者表示 Host 的 ffprobe/ffmpeg 能力不可用。两项必须同步 TypeScript、api-error schema、HTTP 与 UI，不能复用 `MISSING_ASSET` 或 `HYPIT_UNAVAILABLE` 混淆责任。
3. 库存 availability 在 D4.2.1 不做跨请求缓存；每次 GET 重验 realpath/stat/bytes SHA，并限制并发。该选择优先保证篡改可见性，接受最多 256 项时的读取成本；后续若引入缓存，必须另行设计可证明的新鲜度协议并通过安全复审。
4. D4.2.1 不创建 `derived` 资产，但 @2 reader 必须兼容合法的既有 derived entry；import metadata 继续拒绝 derived。这样保持格式前向兼容，同时不把 D4.2.2 composite 能力提前实现。
5. 2026-10-14：项目负责人批准 D4.2.1 导入响应采用路线 A。`manifest_format` 必须返回事务完成时唯一活跃清单的真实格式（`@1` 或 `@2`）；@1 工程命中既有相同 identity 时返回 200、`created=false`、`migrated_from_v1=false` 并保持 @1 原字节，不为迎合响应合同制造迁移。只有 @1 工程成功提交新 identity 才返回 @2、`created=true`、`migrated_from_v1=true`。幂等重放返回首次持久化的同一 status/body。
6. 2026-10-15：所有自动化浏览器、交互、无障碍、截图和端到端验收固定为 Headless、无声、无弹窗、不抢焦点。200% 门限必须使用可读回的原生 Chrome page zoom；不得以 device scale、viewport 缩半、CSS 注入或 headed 自动化替代。可见浏览器仅用于项目负责人明确发起的人工验收。
