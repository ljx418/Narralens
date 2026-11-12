# candidate-v1 溯源说明（覆盖事故与哈希核验恢复）

## 发生了什么

本目录最初保存的是**冻结候选 v1**（`created-source-recovery.ts` = `0fa52f3c…`、
`created-source-recovery.test.ts` = `76b00b70…`），它们正是捕获 `d10-business-repairedsel-003`
与 `d10-business-repairedfull-005` 的实际输入。

在补齐 MAIN 只读审计提出的 3 处闭环缺口后，我把修订后的字节**同名覆盖**进了本目录，
从而丢失了 v1 的两个文件（adoption service 与 adoption test 未变，仍在）。

## 缺口与恢复方式（不凭记忆、不冒称原字节）

- 丢失字节的**权威哈希**来自捕获自身的输入快照，不是我的记忆：
  `docs/execution/A/implementation-20261111/integration/e1-main-takeover/d10-business-repairedfull-005.inputs.json`
  记录了该次运行前每个输入文件的 SHA256。
- 恢复方式：以当时的交付记录（Write/Edit 的原文）为基准，**机械地撤销**我在冻结之后追加的那几处改动，
  得到候选字节，再与上述权威哈希逐字节比对。
- 比对结果：两个文件**哈希完全一致**，因此可以称为「哈希核验的原字节恢复」，而不是重写：
  - `created-source-recovery.ts.v1` = `0fa52f3c75d2f8704af7ed507eeb369b3e195356b56a39a0841f98355cd1f7fe` ✔
  - `created-source-recovery.test.ts.v1` = `76b00b70313eec6906cfe3204a8896362d6749f636e14a6059dd4bd192187456` ✔
- 四个文件已全部与 `d10-business-repairedfull-005.inputs.json` 逐条交叉核对，全部 MATCH。
- 未做全机扫描，未读任何配置，未删除任何捕获日志；重建用的临时副本在校验后即删除。

## 教训与约束

- **不再覆盖任何历史候选**。当前版本另存 `candidate-v2/`（独立 `SHA256SUMS.txt`）。
- 冻结 = 复制字节 + 记录哈希 + 阶段日志；后续修订一律新增版本目录，不动旧目录。
- 捕获本身已经把「输入是什么」固化在 `*.inputs.json` 里，即使字节副本丢失，证据链仍可核验；
  但字节副本是更强的证据，所以必须保留。

`SHA256SUMS.txt` 是本目录四个文件的权威哈希清单。
