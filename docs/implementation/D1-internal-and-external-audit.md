# D1 内部与外部审计闭环

日期：2026-10-12  
状态：通过；允许进入 D2 计划与实现

## 内部独立审查

内部审查没有直接沿用执行者的“命令退出 0”结论，而是重新核对 PRD、架构、既有 JSON 示例、Source、构建制品和证据清单。

发现一项重大契约偏差：初版 `contracts/proposal-bundle.schema.json` 使用 camelCase，和已冻结示例的 snake_case 不一致。该版本未获放行；schema 已改为 `schema_version/base_revision/source_refs/...`，`validate-contracts.py` 同时验证 schema、官方示例、`[start,end)`、片段覆盖和 renderable 约束。

回归结果：OpenMontage contract tests `109 passed`；Hypit `pnpm check` 通过；Author/Run `ok=true`；双构建定点差异及完整音频哈希通过；JSON、Draw.io XML、shell syntax 和 `git diff --check` 通过。

## Claude Code CLI 只读外审

工具：Claude Code CLI `2.1.205`，`--permission-mode plan`，只允许 Read/Grep/Glob 和只读 Git 命令。首轮结论为 `PASS`，同时提出 7 项 D2 启动前重大事项。处理如下：

| 外审项 | 处理 | 结论 |
|---|---|---|
| M-1 checksum 中安全扫描哈希过期 | 全部修订完成后重建并校验 `docs/SHA256SUMS.txt` | 已关闭 |
| M-2 安全制品未按架构路径归档 | 新增 `docs/evidence/D1/security/credential-scan.json` | 已关闭 |
| M-3 Windows TTS 跨机器不 bit-stable | 脚本增加环境前检和显式提示；文档声明每次重建记录新哈希，manifest 哈希只标识本轮输入 | 已关闭（限制保留） |
| M-4 怀疑 8% inset 未进入 Hypit IR | 外审误读：`value-0001` 是 full Frame；修改帧为 `value-0002`，`value-0011` 的 shot-2 placement 明确为 x=102.4/y=57.6/w=1075.2/h=604.8，且最终帧差显著。摘录已归档 | 已反证关闭 |
| M-5 扫描排除与空白 pattern 文件缺少元数据 | 原始扫描显式列出两个 commit 排除；新增结构化扫描摘要并删除空白文件 | 已关闭 |
| M-6 Hypit wrapper 硬编码账户路径 | 改为 `NARRALENS_HYPIT_CLI` → `XDG_CACHE_HOME/HOME` → vendor fallback | 已关闭 |
| M-7 composition frame 被误称 Studio UI 截图，HTTP 证据缺失 | 所有文档改称 Studio snapshot 合成帧；新增 202/revision 2 和 stale 409 的结构化证据 | 已关闭 |

外审一般项中，plan/ffprobe 缺制品和 probe 硬编码 commit 也已顺带关闭；`.hypit` 被提交是误报，`git check-ignore` 证明其由根 `.gitignore` 排除。字幕、真实 Provider、全部 UI 手势和真实母项目仍是明确的后续范围，不能因 D1 通过而宣称完成。

聚焦复审结论：M-2 至 M-7 全部 `CLOSED`，M-4 被原始 IR 反证关闭，无新增致命/重大问题；M-1 仅待内容稳定后的最终 checksum 机械重建。复审明确允许完成该步骤后进入 D2。

## 最终判断

D1 没有未关闭的致命或重大问题。证据足以证明固定版本的真实底座、写回边界与 Proposal 转换边界；D2 可以启动，但必须先建立 D2 开发/验收计划，且不得用手工 JSON 冒充真实 Runner。
