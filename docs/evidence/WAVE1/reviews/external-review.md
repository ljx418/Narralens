# Wave 1 独立外审结论记录

状态：`PASS_RECORDED`  
独立审查对象：`cb87a2cc224ad7e9efab96fd1bd84c24ec8a9c8b`  
外审后修复/最终冻结代码：`e2dec5ca03ee881b55f92b920ee6df2c676aeb26`  
证据捕获提交：`fd64762dbcff4e1577529a00991049b59bf2c1e7`  
首次组合 manifest 封存：`44b294de81d4503517ec82d997845bf73f360a09`

## 1. 记录性质

本文件不是伪造的外审逐字稿。独立干净会话的原始会话转录未作为仓库产物保存；本记录只把已经写入
`internal-review.md` §4.2、并由交接报告再次确认的独立结论和关闭动作固化为可追踪决策记录。

## 2. 独立结论

独立会话对候选 `cb87a2c...` 的结论为：

- 总结：`PASS`
- BLOCKER：0
- MAJOR：0
- MINOR：2
- NOTE：2
- 声明条件：两条 MINOR 记录并关闭后，可声明 `CONTROLLED_OPENFILM_READY`。

两条 MINOR 均在 `e2dec5c...` 中关闭：

1. `MigrationService.recover()` 已接入生产 `listen()`，重启后可收敛被中断迁移。
2. `before_report` 已成为真实可注入崩溃边界，崩溃矩阵覆盖增至 9 个边界。

同时修正回退导出按项目引擎分发；未把需要外呼和付费的 Hypit 新鲜渲染冒充为本波证据。

## 3. 修复后复验

修复后的干净捕获绑定 `e2dec5c...`，由 `docs/evidence/WAVE1/logs/e2dec5c/` 保存：

- `corepack pnpm check`：exit 0，38 files / 383 tests，含 TypeScript 与生产构建；
- contracts、M2.1、M2.2、M2.3、黄金向量、20 条变异门和文档一致性门均通过；
- `corepack pnpm evidence:wave1:integrity`：6/6 PASS；
- 21 个逐 case 结果为 20 `PASSED` + 1 `NOT_APPLICABLE_APPROVED`。

`evidence:m2.2:integrity` 的 exit 1 是已记录的信息项：其历史不变量是“M2.2 冻结后无代码变化”，而
M2.3 正是在 M2.2 之上继续开发。组合证据重新执行了 M2.2 门禁，未修改历史校验器来制造全绿。

## 4. 最终裁决与边界

外审条件已关闭，Wave 1 允许声明：`CONTROLLED_OPENFILM_READY`。

该裁决不等于 M2 的所有后续产品能力完成，也不关闭 Gate D4.2。以下范围仍禁止宣称：

- materialize、impact、adopt、history restore；
- Gate D4.2、Gate V1-P0、V1-Full；
- headed 自动化或人工体验已运行；
- legacy Hypit edit 已具备迁移链同等级的“隔离 stage 后发布”语义；
- Hypit 源工程已在本波完成新的付费/外呼渲染。

下一允许阶段为 M3（materialize）。
