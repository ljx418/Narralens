# M3 最终冻结候选独立外审

审查日期：2026-10-20
审查方式：新的 Claude Code CLI 只读、无持久会话；仓库审查前后均 clean
候选提交：`fa08fe4bcb111aeb8329f5771bae9b92bed3583e`
代码与正式捕获提交：`f2a41ff9f5613dc083ea89082505a496163175eb`
OpenFilm 上游：`e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3`

## 1. 结论

`PASS`：BLOCKER=0，MAJOR=0。M3 的 PR-01..03、MT-01..06 可以从
`M3_REVIEW_PENDING` 进入 `PASSED`。该结论只关闭 M3，不代表 M4、Gate D4.2、Gate V1-P0 或 V1-Full。

审查确认：候选提交相对捕获提交仅增加 `docs/evidence/WAVE2/` 下的证据和审查材料，`src/`、`tests/`
与 `contracts/` 没有漂移；14 条命令日志的 exit 与 SHA256 全部匹配；两次 `pnpm check` 均为
62 files / 750 tests，生产构建通过；M3 integrity 为 PASS；Wave 1 historical 为 PASS。

## 2. 重点审查结论

- `ENOMEM/EMFILE/EAGAIN` 在 ffmpeg、ffprobe 与导入验证边界保持
  `HOST_RESOURCE_EXHAUSTED(503,recoverable=true)`，materialization 不进入 stale/attention。
- 缺工具保持 `MEDIA_TOOL_UNAVAILABLE`，坏媒体保持 `INVALID_MEDIA`，没有混淆。
- ProxyRenderer 全局并发 2、同项目 1、每个 libx264/filter pool 线程 1；短帧产物视为可重试工具失败。
- 活跃 staging 不会被其他 worker 全局清理；hard-link 非 `EEXIST` 错误 fail closed。
- `evidence:wave1:integrity` 的 exit 1 是“Wave 1 冻结后不允许后续代码”的历史门语义；本轮前后 FAIL
  集合一致，本轮没有新增 Wave 1 回归。

## 3. 接受的 MINOR 与声明边界

1. `MEDIA_TOOL_UNAVAILABLE` 当前不带 `recoverable=true`，会使单个 materialization 行进入终态 stale；
   它不锁项目，客户端可用新的 idempotency key 重建。M3 不声明该路径自动重试。
2. “ffmpeg exit 0 但输出短帧”的保护分支没有独立故障注入；它属于 defence-in-depth，正式全量门曾真实
   触发并证明会拒绝错误产物。不得宣称该分支具有确定性单元注入覆盖。
3. 对刚产出文件的 ffprobe 若返回无帧事实，仍可能映射为终态 `INVALID_MEDIA`；这是有界既有行为。
4. `git-status-after.txt` 记录捕获器生成 credential report 和新日志目录后的 dirty 状态；这些产物随后全部
   在候选提交中跟踪，审查前后实际工作树 clean，不与 `repo_dirty_at_capture=0` 冲突。

另保留：M3 没有崩溃遗留 staging 的生产 GC；长片性能、流式哈希、headed/human 与 M6 正式 render
均未验证。自动化测试继续要求 Headless、静音、无窗口、不抢焦点。

## 4. 允许和禁止

允许：`M3_EXTERNAL_REVIEW_PASS`；下一允许模块为 M4A ImpactService。
禁止：`WAVE2_COMBINED_REVIEW_PENDING`、`WAVE2_EDITABLE_ADOPTION_READY`、Gate D4.2、Gate V1-P0、
V1-Full、M5 Studio UX、M6 正式 render、长片性能和 headed/human 已通过。
