# M3 Codex 独立审查与返修闭环（2026-10-20）

## 1. 审查边界

- 初审冻结候选：`dcc570a0c81ef321bfc44a41912f8a43637c9028`
- 第一轮返修实现提交：`b55ca6addb5c92a7abd20f8170ad20bfa000c4af`
- 独立 CLI 复审后的最终实现提交：`f2a41ff9f5613dc083ea89082505a496163175eb`
- 分支：`migration/m2.2-coordinator-persistence`
- 上游基线：`origin/main=304c89134fdf9f834f7d69e3f4d5c89a68044c60`
- 范围：M3 materialize、derived artifact 发布、Host drain/lease、迁移资产账本重验和证据真实性。
- 不在范围：M4A/M4B/M4C、Studio UX、正式 render、headed/human 验收。

本记录由 Codex 在初审发现问题后形成，并记录同一阶段由 Codex 接管的返修闭环。它不是另一名审查者对
返修提交的独立外审签名；组合外审状态在单独的冻结提交审查完成前仍为 `REVIEW_PENDING`。

## 2. 初审结论

初审为 `CHANGES_REQUESTED`：2 BLOCKER、2 MAJOR。

| 编号 | 级别 | 发现 | 返修 |
|---|---|---|---|
| CXR-B1 | BLOCKER | 每个 worker 的 `finally` 全局删除 derived staging，可删除另一个活跃 worker 的 ffmpeg 输出 | 删除 worker 级全局 sweep；renderer 仍只删除自己持有的精确路径；新增并发所有权回归测试 |
| CXR-B2 | BLOCKER | ADR 声明 `HOST_RESOURCE_EXHAUSTED`，账本与测试仍返回 `MEDIA_TOOL_UNAVAILABLE` | 生产账本、重验传播和测试统一为新 code；真实 drift 仍保持终态 |
| CXR-M1 | MAJOR | hard-link 的所有非 `EEXIST` 错误都回退到覆盖式 rename | 非 `EEXIST` 一律 fail closed；删除覆盖式 fallback；增加真实错误码注入测试 |
| CXR-M2 | MAJOR | `run()` 最外层异常静默返回，数据库关闭等边界不可观测 | 在不再次访问数据库的条件下写入脱敏、带 SHA256 的结构化诊断 |

第一轮返修后，使用干净、只读的 Claude Code CLI 会话绑定候选提交复审。它确认上述四项修复真实，
但新增发现 1 MAJOR：`ProxyRenderer` 与导入验证把 child-process 原始 `ENOMEM/EMFILE/EAGAIN`
翻译为不可重试的 `INVALID_MEDIA`。最终返修将宿主资源分类收敛到共享函数，并在 ffmpeg、ffprobe
与媒体导入边界优先保留 `HOST_RESOURCE_EXHAUSTED(recoverable=true)`；缺工具与坏媒体继续分别为
`MEDIA_TOOL_UNAVAILABLE` 和 `INVALID_MEDIA`。

全量门同时复现一次“ffmpeg exit 0 但只产出 167/300 帧”。这不是源媒体错误：渲染前探针已证明源
有 300 帧。根因是只限制了两个编码进程，却没有限制每个 libx264/filter 内部线程池。最终实现将每个
编码器和滤镜池固定为 1 线程，并把输出帧数不符分类为可重试工具失败，避免一次资源尖峰把工程置终态。

## 3. 可复现性

初审对 CXR-B1 的最小实验在同一个 store 中创建两个活跃 staging 文件，然后执行一次全局清理，得到：

```json
{"removed":2,"active_worker_b_survived":false}
```

返修测试现在通过 `MaterializeService.drain()` 的真实 `finally` 边界证明：一个 worker 完成后，另一个
活跃 worker 的 staging 仍逐字节存在。旧实现会在该测试中删除文件。

CXR-M1 的旧测试只执行正常发布，并未制造 link 失败。返修测试注入 `EIO`，要求操作拒绝、目标文件
不存在、调用者 staging 被清理；若恢复覆盖式 rename，该测试失败。

## 4. 返修复验

专项结果：

- `derived-artifact-store.test.ts`、`drain-liveness.test.ts` 连续 10 轮：10/10 PASS。
- 宿主资源分类、代理渲染与 drain 重点文件：46/46 PASS。
- 两组真实代理渲染测试在显式线程上限后连续 5 轮：165/165 PASS。
- `tsc --noEmit`：PASS。
- `git diff --check`：PASS。
- 正式捕获的两次完整 `corepack pnpm check`：均 62 files / 750 tests，生产构建 PASS。

冻结捕获：

- capture commit：`f2a41ff9f5613dc083ea89082505a496163175eb`
- 日志：`docs/evidence/WAVE2/logs/f2a41ff9f5613dc083ea89082505a496163175eb/`
- 两次完整 `check`：均 exit 0。
- contracts、M2.1、M2.2、M2.3、W2.0、M3、Wave 2 fitness、OpenFilm probe、凭据扫描：均 exit 0。
- Wave 1 historical：exit 0。
- Wave 1 integrity：exit 1，原因仍是其历史不变量禁止 Wave 1 冻结后改代码；输出原样保留，不作为当前门失败。
- `evidence:wave2:m3:integrity`：9/9 PASS，且其命令、exit 与输出摘要已作为第 14 条命令纳入 manifest。

## 5. 审查结论与声明上限

Codex 初审提出的 2 BLOCKER、2 MAJOR和独立 CLI 复审提出的 1 MAJOR，均已由代码和会在旧实现上
失败的测试闭环。最终冻结提交仍需新的独立只读会话签署；本记录不自签外审。

当前允许声明：

- `M3_REVIEW_PENDING`
- M3 返修实现与证据已形成冻结候选，可交另一独立会话做只读签署审查。

当前禁止声明：

- `WAVE2_COMBINED_REVIEW_PENDING`
- `WAVE2_EDITABLE_ADOPTION_READY`
- Gate D4.2、Gate V1-P0、V1-Full
- headed/human、长片性能、正式 render 已通过

## 6. 保留限制

- `verifyPublished()` 与当前代理生成仍会把完整代理读入内存；M3 的短片门不据此宣称长片性能。
- 超过 shutdown 等待预算的外部媒体进程仍依靠 abort、lease 与下次恢复收敛；不声明进程级强杀已覆盖。
- 崩溃遗留的全局清理不能在活跃 worker 中运行；后续若增加 GC，必须以 attempt/lease/年龄证明文件已无所有者。
