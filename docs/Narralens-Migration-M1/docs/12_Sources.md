# 来源登记、事实边界与引用口径

## 1. 本地/用户来源

**U0 用户本轮项目报告。** 起点304c891、阶段、测试总数、直接证据缺口和范围评估，全部按用户提供记录；本包未读取真实本地代码。`sources/User-Reported-Baseline.md`为本轮摘要留档，不是独立复验。

**L1 早期Narralens v1开发基线。** 本次读取`01_PRD.md/03_Architecture.md/04_Development_Plan.md/05_Acceptance_Plan.md/07_Decisions_Open_Issues.md`；与304c891当前实现不同，不用早期文档反推现有源码。副本位于sources/legacy-*。

**L2 Story Atlas体验增量。** 本次读取`01-Experience-Delta.md/02-Implementation-Handoff.md`，保留缩放地图/三路预览/六类候选意图，技术栈段落由本包ADR替换。

当前权威`11_V1_Traceability.md`、D4.2.1内部审计和冻结矩阵必须本地读取，未在本包伪造其内容。

## 2. 公开上游源码研究

查阅日期：2026-10-16。公开main分支内容可能变化；本包没有成功取得不可变full commit SHA，`upstream-lock`中保留null，M1B必须解析并固定后再实现。网页可读不等于仓库在本机已安装可用。

| ID | 官方来源 | 支持的事实 |
|---|---|---|
| R1 | [OpenFilm官方贡献/源码布局](https://raw.githubusercontent.com/openfilm/openfilm/main/CONTRIBUTING.md) | React/Vite Studio、服务端/引擎模块、源码运行条件；M1B仍须本地固定。 |
| R2 | [OpenFilm ProjectView](https://raw.githubusercontent.com/openfilm/openfilm/main/packages/openfilm/studio/ui/src/components/ProjectView.tsx) | 现有Timeline/Preview/Inspector等实际集成位置；不是已接入Narralens。 |
| R3 | [OpenFilm film.mjs](https://raw.githubusercontent.com/openfilm/openfilm/main/packages/openfilm/studio/server/film.mjs) | editProjectFilm使用当前value应用ops，返回rebased；不以base不同作为统一拒绝。 |
| R4 | [OpenFilm SPEC](https://raw.githubusercontent.com/openfilm/openfilm/main/packages/openfilm/SPEC.md) | film.html/片段/场景frame(t)；工程语义依据。 |
| R5 | [OpenFilm provider contract](https://raw.githubusercontent.com/openfilm/openfilm/main/packages/openfilm/studio/server/providers/contract.mjs) | 多种媒体能力；Spend确认不含金额预算模型。 |
| R6 | [VibeMovie prompt与解析](https://raw.githubusercontent.com/EvanJYHe/vibe-movie/main/backend/prompts/geminiPrompts.js) | 完整JSON timeline编辑和解析；本项目只借鉴结构化提案方法。 |
| R7 | [VibeMovie render](https://raw.githubusercontent.com/EvanJYHe/vibe-movie/main/backend/src/services/render.js) | Remotion bundle/selectComposition/renderMedia；不是OpenFilm通用后端。 |
| R8 | [HyperFrames README](https://raw.githubusercontent.com/heygen-com/hyperframes/main/README.md) | HTML/媒体/seekable动画；可选素材/场景能力。 |
| R9 | [OpenFilm LICENSE及商标](https://raw.githubusercontent.com/openfilm/openfilm/main/TRADEMARK.md) | MIT代码与名称标识另分；自有修改版使用Narralens品牌。 |
| R10 | [VibeMovie LICENSE](https://raw.githubusercontent.com/EvanJYHe/vibe-movie/main/LICENSE) | 代码MIT；不代表所有依赖相同许可。 |
| R11 | [HyperFrames LICENSE](https://raw.githubusercontent.com/heygen-com/hyperframes/main/LICENSE) | Apache2.0；分发按具体条款处理。 |
| R12 | [OpenFilm package.json](https://raw.githubusercontent.com/openfilm/openfilm/main/packages/openfilm/package.json) | 本次看到0.1.7；exports/依赖是观察结果，不是选择或锁定的版本。 |
| R13 | [OpenFilm LICENSE](https://raw.githubusercontent.com/openfilm/openfilm/main/LICENSE) | 代码MIT通知与保留义务。 |
| R14 | [VibeMovie timeline验证](https://raw.githubusercontent.com/EvanJYHe/vibe-movie/main/backend/src/timeline.js) | 规范化和基础字段验证；不能替代领域级范围/资产/锁验证。 |

## 3. 设计与事实区别

EnginePort、CommandGateway、NativeMutationRegistry、impact hash覆盖、immutable snapshot、M阶段/测试矩阵、P0+P1完成规则均为针对本项目的**新设计**，不是上游已有功能列表。主架构切换是用户同意的方向，但尚未完成运行验证。

许可证说明用于工程选型和保留通知，不是对具体商业模式的法律意见。复制上游代码或发布时以固定版本许可和依赖清单再次审核。
