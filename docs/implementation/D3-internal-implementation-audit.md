# D3 内部实现审计

日期：2026-10-12  
状态：通过；两轮 Claude Code CLI 实现外审已闭环，Gate D3 通过

## 结论

D3 冻结范围已实现：单镜 `fit` typed edit、stable identity、visual 服务端锁、Narralens/Studio 双 revision、幂等、SQLite journal、补偿/attention、启动恢复、Host API 与可操作 UI。内部审计未发现未关闭致命或重大问题，允许提交实现外审；外审通过前不标记 Gate D3 最终通过。

## 核查结果

| 维度 | 结果 | 证据 |
|---|---|---|
| 上游事实 | 通过 | 只用 `GET /__studio/session` 与 `POST /__studio/mutation parameter.adjust`；无正则写 Source |
| Identity | 通过 | descriptor `shot_id→authoring_id`，opaque item/parameter ID 仅在 Adapter 内 |
| 原子与恢复 | 通过 | prepared/source_validated/committed，补偿完整性，未知状态 attention；三种恢复状态有测试 |
| Revision/幂等 | 通过 | 真实 r2→r3→r4、Host 重启 r3、同 key 重放不二次 mutation、key conflict 独立 409 |
| 锁与错误 | 通过 | 真实 direct API 423；真实旧 revision 409；protocol double 409/422/attention |
| 不变量 | 通过 | 预测精确 Source 文本、900 帧、全部 item 语义、Run SHA、旁白 SHA |
| UI | 通过 | Headless Chrome 真点击 contain/cover；当前/目标/revision/transaction 可见，无横向溢出 |
| 安全 | 通过 | 固定 loopback origin、无重定向、路径 realpath confinement、token/origin、凭据与绝对路径 0 命中 |
| PRD | 通过（部分覆盖） | 只关闭 D3 明示切片；未声称 D4 proposal materialize/采用或三类主动锁全完成 |

## 主动发现并关闭的问题

1. D3 计划曾误写 Hypit commit 为 OpenMontage commit；已按 `git submodule status` 修正为 Hypit `85e01c...`。
2. 初版页面仍显示 `REAL PROJECT · READ ONLY`，与 D3 可写能力冲突；已改为 `TRANSACTIONAL EDIT` 并重跑浏览器截图。
3. 浏览器第一次关闭只终止 WSL launcher，Windows Chrome 子进程仍持有 profile；已按专用 profile 命令行精确终止相关 PID，删除 profile 与临时 SQLite，并在第二次 E2E 后验证清理。
4. 将 Hypit 5xx 保守处理：只有复读证明 Source 未变才返回事务失败；不确定即 attention，不根据错误字符串猜 422。

## 已声明限制

- `node:sqlite` 在 Node 22 输出 experimental warning。
- 崩溃/补偿失败分支由协议级 deterministic double 验证；真实成功、Studio 重开、Host 重启、check/plan 和 UI 均使用真实底座。
- D3 只有 visual 主动锁；narration/duration 是 preserve + hash 不变量。
