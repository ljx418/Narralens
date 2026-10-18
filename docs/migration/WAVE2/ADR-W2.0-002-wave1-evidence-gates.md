# ADR-W2.0-002：Wave 1 证据的两个门

状态：`RATIFIED_BY_REWORK`
日期：2026-10-18
实现提交：随 W2.0 correction 一同提交

## 1. 触发事实

`tools/wave1-evidence-integrity.mjs` 在 Wave 2 的 tip 上现在返回 exit 1。

这不是缺陷，是它按设计工作。该工具同时回答两个不同的问题：

| 问题 | 性质 |
|---|---|
| Wave 1 的证据还是完好的吗？ | 关于**记录**的永久属性 |
| 冻结之后有代码变动吗？ | 关于**工作 tip**的属性 |

第二个问题在任何后续波次落地后必然为假。Wave 2 改了代码，所以它是 FALSE，这正是它被
设计来发现的东西。

## 2. 为什么不能靠它，也不能改它

原工具在 Wave 1 是对的，并且必须保持逐字节不变 —— 修改它以在后续 tip 上变绿，正是
AC-019（不得追溯改写历史证据证据）和本 ADR 都要禁止的事。

但它的 exit code 已经无法区分"有人重写了我们的证据"和"Wave 2 存在"。任何后续波次
把它报成 PASS（改断言）或忽略它（不记录），都是在误导复核者。

## 3. 决定

新增 `tools/wave1-evidence-historical.mjs`（脚本 `evidence:wave1:historical`），
只回答第一个问题，并**从冻结 commit 的 tree 读取**，不从当前工作树读取：

1. 每个被引用产物都被 git 跟踪，且在 `e2dec5c` 处哈希为清单记录的值；
2. 9 份 gate log 存在、被跟踪、摘要匹配；
3. 捕获时 `repo_dirty_at_capture=false`，且环境记录独立地写着同一个 commit；
4. 清单冻结的 commit 就是 Wave 1 冻结的那个，且该 commit 可达；
5. `code_paths` 在冻结 commit 处确实含文件（154 个），证明冻结覆盖了真实内容；
6. 21 个 case 的状态原样报告，含 1 个 `NOT_APPLICABLE_APPROVED`。

在当前 tip 上已经合法变动的冻结产物，作为 `INFO` 逐条列出，**不算失败**。

### 两个门的分工

| 命令 | 回答 | 在 Wave 2 tip 上的预期 |
|---|---|---|
| `evidence:wave1:historical` | Wave 1 证据是否仍然完好 | exit 0 |
| `evidence:wave1:integrity` | 冻结之后是否有代码变动 | **exit 1，符合预期** |

`evidence:wave1:integrity` 的 exit 1 必须在任何报告中逐字保留并解释，
不得写成 PASS，也不得改断言使其变绿。

## 4. 与冻结文档的关系

本 ADR 是追加裁决，不修改 `docs/evidence/WAVE1/` 下任何文件，也不修改
`tools/wave1-evidence-integrity.mjs`。后者由 `git diff --stat` 验证为空。

## 5. 验证

该门被逐项证明会失败，不是恒绿：

| 注入 | 结果 |
|---|---|
| 清单 `repo_dirty_at_capture` 改为 true | exit 1 |
| 清单中一个产物的 sha256 改为全 0 | exit 1，指名该产物 |
| 向 `logs/e2dec5c/check.txt` 追加一行 | exit 1，指名该 gate log |

三次注入后 `docs/evidence/WAVE1/` 均恢复原状，`git status --porcelain` 为空。
