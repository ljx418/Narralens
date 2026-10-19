# Codex 独立审查：M3 候选 `3b6b36b`

日期：2026-10-19  
绑定提交：`3b6b36bd23ff4b5e7d65b731c331b7b092dadb9f`  
审查结论：`FAIL / M3_REWORK_REQUIRED`  
计数：`BLOCKER=4, MAJOR=2`

## 已独立复验

- branch：`migration/m2.2-coordinator-persistence`；审查开始时工作树 clean。
- `corepack pnpm test:wave2:m3`：exit 0，7 files / 125 tests。
- 真实 proxy、lineage、Host 自动 drain、NOWRITE 和基本取消路径在现有测试中通过。
- 未将三次 `corepack pnpm check` 的失败改写为通过。

## BLOCKER

### B1：长渲染失 lease 后，旧 worker 仍可把 materialization 升为 ready

`MaterializeService.run()` 只在开始时取一次 30s lease，渲染过程无 heartbeat/renew。
Host 的 lease reaper 每秒可将超时 job 重排，但 worker 在 `ready_for_adoption` 前只检查
`cancel_requested`，不重验 owner/attempt/未过期 lease。因此一个晚到的旧 attempt 可在 lease 丢失后
先晋升 materialization，然后才在 job callback 处被判为晚到。这违反 MT-05 的“晚到不得 ready/adopt”。

必须增加受 owner+attempt 约束的 lease renewal/心跳，并在发布 proxy、写 lineage 和
`ready_for_adoption` 之前使用 CAS 重验 lease。失 lease 的产物只能 quarantine。

### B2：失 lease/崩溃后的 materialization 与 job 状态不一致，实际不能重排

reaper 只把 job `running -> queued`，但 materialization 仍为 `running`/`validating`。下一个
`drain()` 取得 job lease 后，`run()` 因 materialization 不是 `queued` 而把新 job attempt 作为
cancelled callback 处理，不会继续或安全重建。

现有“worker died holding lease”测试只断言 `recover().retried` 包含 id，没有真正调用下一次
drain 并证明它收敛到 ready/quarantine/attention。MT-05 因此是假绿。

必须定义并实现联合恢复规则：job/materialization/derived artifacts 三者在失 lease 或重启后
收敛到可重试、已取消、attention 或安全完成，不得只在报告中返回 `retried`。

### B3：Host close 没有停止或等待在途 materialize worker

`close()` 清理 interval，但已启动的 `drain()`/`run()` 不在 Host controllers 中，
`MaterializeService.#inflight` 也从未写入。Host 只等一个 `setImmediate` 就关闭 SQLite。
在途 ffmpeg/文件操作结束后仍可访问已关闭 DB，且无法证明 lease/产物的最终归属。

必须在 close 时先停止新 drain，向在途 worker 发送 abort/停止接单，等待其完成持久化收尾
或可证明地保留 lease 供重启恢复，最后才关闭 RevisionStore。

### B4：证据 manifest 与实现互相矛盾，不能支撑当前声明

`docs/evidence/WAVE2/evidence-manifest.json` 仍声明“五条 Wave 2 路由全部 404、materialize 不存在”，
但 M3 已开放 POST materialize 和 GET materialization。manifest scope 仍只支持 W2.0，却把 declaration
写成 `WAVE2_COMBINED_REVIEW_PENDING`。此外：

- package scripts 没有冻结文档要求的 `evidence:wave2` / `evidence:wave2:integrity`；
- `check_stability` 记录 attempt 2 为 `cause=unknown=1`，但 `w2_reg_status` 又声明三次全部
  已归因 ENOMEM；
- M4A/M4B/M4C 未实现，不能声明 Wave 2 组合候选。

必须新建 M3 只追加的 capture/manifest 或正确升级 Wave 2 manifest，删除语义过时项，增加能
检测 route/case/command/artifact/capture SHA 相互一致的 integrity tool。禁止改写旧失败日志。

## MAJOR

### M1：“完整 proxy 提升中断可重试”的修复没有形成可达恢复路径

complete row 在 promotion 异常后确实没有立即变 stale，但 job 被记为 terminal `failed`。
重启后 `recover()` 会把它转为 stale，不会重试 promotion。现有测试只断言当前 row 不是 stale，
没有验证同进程下一次 drain 或关闭重开后仍能到达 ready。

需要明确“安全促进 complete row”的 CAS 恢复路径，并在重启后证明它只在 premises、lease、
lineage 和 proxy 摘要全部仍一致时晋升。

### M2：PR-03 不能在 M3 出门时保持 PARTIAL

冻结验收矩阵明确要求 PR-03 证明“锁定范围变化拒绝”，且 M3 全部 case
`INTERNAL_EVIDENCED` 后才允许进 M4A。这不需要提前实现 M4 adopt：可使用现有 `LockService`
实际获取/释放目标范围锁，证明 control revision 改变后 POST 被 409 或已 ready materialization
在 GET 中变 stale。不得仅手动改 control revision 冒充锁路径。

## 裁决

- 当前真实阶段：`M3_EXTERNAL_REVIEW_FAILED`。
- 禁止声明：`M3_INTERNAL_EVIDENCED`、`WAVE2_COMBINED_REVIEW_PENDING`、
  `WAVE2_EDITABLE_ADOPTION_READY`、Gate D4.2、V1-P0、V1-Full。
- 先修复 B1–B4/M1–M2 并形成新冻结候选。修复期间不进入 M4A。
- 这是 M3 的第一次 Codex 独立打回，尚未触发“同阶段超过 2 次返工由 Codex 接管”。
