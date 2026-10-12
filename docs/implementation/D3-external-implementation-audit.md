# D3 Claude Code CLI 实现外审记录

日期：2026-10-12  
CLI：Claude Code 2.1.205  
状态：两轮闭环；第二轮 PASS，致命/重大/一般问题均为 0，允许 Gate D3 通过

## 首轮结论

```text
IMPLEMENTATION_EXTERNAL_REVIEW=FAIL
致命问题：0
重大问题：3
证据可信度：可信，无伪造
允许 Gate D3 通过：否
```

首轮摘要只展开“恢复与已有 idempotency 主键冲突”。第一次追问在等待 20 分钟后持续零输出，被终止且不计结论；第二次较小追问最终给出三项明细。

## 问题处理

| 项 | 复核 | 处理 |
|---|---|---|
| duplicate incomplete journal 与已有 idempotency 冲突 | 有效。恢复应显式合并，不应让 SQLite PK 决定结果 | `idempotencyEntry` 对 request hash、Source target/before、current revision 三方一致性核对；一致只关闭重复 journal，不一致 attention；新增真实 SQLite 回归测试 |
| 声称代码使用未声明 `mutation_status` | 读取偏差。当前 `project-write-actor.ts` 使用 `mutation.status`，TypeScript 可识别自由变量错误 | 保留源码证据；409/422/500 单测全绿，未做无意义改动 |
| 建议将同 base revision 的两个 pending 依次提交到 N+1/N+2 | 建议不安全：无法证明一次/两次 Source mutation，与 D3“未知即 attention”冲突 | `RevisionStore.state()` 把任何非终态 journal 视作 attention，第二条 journal 不能创建；遗留多 pending 不猜测提交。新增异常前/后复读与 attention 测试 |

## 追加风险闭环

代码复核另发现 mutation HTTP 调用本身抛错时可能遗留 `prepared`。已实现：复读证明 Source/fit/Run/旁白/semantic 全为 before 才 aborted；已变化或不可复读即 attention。新增“写前断开”和“写后响应丢失”回归测试。

Studio origin 从 `localhost|127.0.0.1` 收紧到字面量 `127.0.0.1` + 明确端口，避免依赖 DNS/hosts 解析；schema、计划与实现同步。

修订后 `corepack pnpm check`：38 tests、TypeScript、Vite build 全绿；真实双事务/Studio 重开/Host 重启/check/plan 重跑通过，最终 Source/Run/旁白 baseline hashes 不变。

## 第二轮结论

```text
IMPLEMENTATION_EXTERNAL_REVIEW_ROUND2=PASS
未关闭致命：0
未关闭重大：0
未关闭一般：0
A-F：全部 CLOSED
允许Gate D3通过：是
```

外审逐项确认：幂等恢复显式合并、mutation 异常复读、单项目非终态 journal 门禁、真实 `mutation.status`、字面量 127.0.0.1 origin、证据真实性均闭环。
