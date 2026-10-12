# D3 开发计划 Claude Code CLI 外审记录

日期：2026-10-12  
CLI：Claude Code 2.1.205  
权限：只读 `Read,Glob,Grep`；未授权编辑或命令执行  
状态：两轮闭环；第二轮 PASS，12/12 CLOSED，致命/重大/一般问题均为 0

## 首轮结论

```text
EXTERNAL_REVIEW=PASS
致命问题：无
重大问题：无
允许进入实现：是
```

项目没有仅凭 PASS 开工，因为外审同时把 12 个一般问题列为“进入实现前必须修订”。这些问题归并为：架构图错误包含 staging/check、幂等与 revision 共用 409、Hypit 普通参数错误可能返回 500、预校验不足、缺 401/403、no-op 审计依据、恢复时外部不可达、三类锁措辞、schema 缺失、补偿关联、baseline 未冻结、Studio origin 白名单不明确。

## 修订映射

| 外审问题 | 修订位置 | 关闭判据 |
|---|---|---|
| staging/check 图文冲突 | D3 Archify JSON/HTML、计划 §4 | 图中只保留真实 Studio mutation + 后置不变量；showcase 重新通过 |
| 幂等 409 歧义 | 计划 §3.3、response schema | 独立 `IDEMPOTENCY_KEY_CONFLICT` |
| Hypit 5xx 归类 | 计划 §3.3/§5 | options/type 前置验证；其余 5xx 失败关闭/attention，不做字符串猜测 |
| 鉴权错误缺失 | 计划 §3.3 | 401 `INVALID_SESSION`、403 `ORIGIN_REJECTED` |
| no-op 审计 | 计划 §5 | 不增内容 revision，但保存 transaction/idempotency/changed=false 事件 |
| 恢复外部不可达 | 计划 §5/测试矩阵 | Studio 5xx、journal 损坏、补偿不确定均 attention |
| 锁范围歧义 | 计划 §4/§9、架构图 | D3 仅 visual 主动锁；另两项为 preserve/hash 断言 |
| 缺少 schema | `docs/contracts/d3-*.schema.json` | descriptor/operation/request/response+errors 均有封闭 schema |
| 补偿关联 | 计划 §5 | 同 transaction/correlation，独立 attempt；非完整恢复即 attention |
| E2E baseline | 计划 §2/§6/§7 | 固定 shot-2 cover，[300,600)，记录双事务 revision/hash 链 |
| Studio origin | 计划 §3.1/§5/SEC | descriptor 唯一白名单、无重定向/覆盖、证据扫描 |

复审必须确认以上修订无新增致命/重大问题；复审通过后才把 D3 计划状态改为“允许实现”。

## 第二轮结论

```text
EXTERNAL_REVIEW_ROUND2=PASS
未关闭致命问题：无
未关闭重大问题：无
未关闭一般问题：无
十二项修订：12/12 CLOSED
允许进入D3实现：是
```

因此 D3 文档 Gate 已通过，只授权执行本计划冻结的单镜视觉 `fit` typed edit；不授权提前实现 D4 的 proposal materialize/采用。
