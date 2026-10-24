# M4B 捕获失败

本目录是失败捕获，禁止作为冻结证据或改写为全绿。

- capture commit：`1c0703bd8621d9a4002fa67b2080edf25bab37c4`
- `overall=1`，唯一的失败步骤是 `m4b-integrity`（exit=1）；其余 16 条命令 exit 0，
  两个历史 current-tip 门按设计 exit 1。
- 失败原因：完整性检查器（当时刚增强为校验**具名**测试引用是否真实存在）发现 case 文件里
  `TX-08B` 仍按测试的**旧名**引用 `after_active_inspect`——该测试已从「revision +0」改名为
  「revision +1」（它证明的是一次提交 +1，而不是一次 abort +0）。

这个失败是检查器**按设计**工作的结果：引用与测试改名不同步。修复是改 case 文件的引用，
不是放宽检查。

## 处置

- case 文件的引用已改正，并且另外六条 pre-publish 边界引用被恢复（它们在修这一条引用时被
  一个过宽的字符串过滤器误删；复审证明了它们本来就能通过检查器的模板前缀回退）。
- 捕获脚本现在**自己**记录 outcome，并在失败时写下 `CAPTURE_FAILED_DIAGNOSTIC.md`；manifest 的
  `known_failed_captures` 从每个捕获**自己记录的 outcome** 派生，而不再依赖"目录里有没有手写
  诊断文件"——这正是本目录当初漏掉的原因。

`wave2-m4b.txt` 与 `m4b-integrity.txt` 是这次失败的原始记录，逐字保留。
