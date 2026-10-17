# M2.1 第二轮外审返修内部复验

- 返修实现：`ee58ab5c6a9d4bbdf05e8ac8a394fd75218cae59`
- 文档与证据捕获候选：`3cdff441abe998d098e1b1a9a7403d667a74cf82`
- 上一独立外审候选：`971d02aac88b8f6f1513cbfa52b91923dd033d56`
- 审查角色：实现后的内部自审，不替代独立外审
- 结论：`INTERNAL_PASS / EXTERNAL_REVIEW_PENDING`

## 1. R2-M-01 关闭检查

- `git status` 不可执行、非零退出或超时时，OpenFilm availability 均 fail closed，不再进入固定文件摘要通过路径。
- tracked dirty checkout 被拒绝；只有成功执行且输出为空时才记录 `git_clean`。
- `createPinnedOpenFilmUpstream()` 继续把 unavailable 映射为 `503 ENGINE_UNAVAILABLE`。
- 新增 MUT-L；将 `dirty === null` 分支退化为跳过时，专项测试按预期失败。
- 未改变固定 OpenFilm SHA、锁文件摘要、动态加载边界或请求输入面。

## 2. R2-M-02 关闭检查

- `docs/03_Architecture.md` 已按当前源码更新 EnginePort、binding/registry、gateway、digest 与 OpenFilm adapter 状态。
- `docs/11_V1_Traceability.md` 明确保留两轮历史候选，同时把当前状态改为返修后独立复审待执行。
- `tools/m2.1-doc-consistency.mjs` 机械校验两份权威文档的返修 SHA/审核状态一致，并拒绝六条已经失效的当前架构描述。
- `evidence-manifest.json` 与权威文档统一为 `REVIEW_PENDING`；没有内部自签外审 PASS。

## 3. 实际复验

| 门 | 结果 |
|---|---|
| `corepack pnpm check` | exit 0；26 files / 258 tests；生产 build 通过 |
| `corepack pnpm test:m2.1` | exit 0；9 files / 124 tests |
| `corepack pnpm test:contracts` | exit 0；3 files / 21 tests |
| Python SourceDigestV1 黄金向量 | exit 0；10/10 |
| credential scan | exit 0；0 findings |
| MUT-A..L | exit 0；12/12 gate bites |
| OpenFilm 真实上游探针 | exit 0；12 checks PASS |
| B-02/M-03 独立复现实验 | exit 0 / 0 |
| evidence integrity | exit 0；捕获树干净、引用证据受跟踪且摘要一致、冻结后无代码变化 |
| 文档一致性门 | PASS |

全部验证为 headless、无声、无窗口、无焦点抢占；headed 与 human experience 继续为 `NOT_RUN`。

## 4. 自审结论与边界

- BLOCKER：0
- MAJOR：0（R2-M-01、R2-M-02 内部关闭）
- MINOR：0
- 外审：`REVIEW_PENDING`

本轮没有实现 snapshot commit、持久 Job/lease/SSE、三类锁、outbox、迁移副本/回退、materialize、adopt 或 history restore。不得声明 M2、Gate D4.2、Gate V1-P0 或 V1-Full。独立复审确认本候选前不得进入 M2.2。
