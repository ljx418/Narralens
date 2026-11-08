# Narralens S0审查包

入口：[review.html](review.html)；单独操作：[prototype.html](prototype.html)；接线图：[architecture.html](architecture.html)。

本包是用户批准编制的S0可操作原型与首轮合同冻结候选。MAIN设计与编制；契约/恢复和UX/验收两路独立只读审查发现的问题已修并复核，无剩余重大问题。Codex负责设计/文档/验收、Claude实现、429接管的分工不变；生产开发尚未启动。

## 阅读与核验

1. 在review.html按建议操作原型：简报→资料/主张审阅→节点编辑→准备→前后对比→确认→演示导出→重开；再演练冲突/断线/取消。所有状态都是模拟，实际录音/素材/来源未核验，不生成视频。
2. 核对01的PX01..10和04的阶段目标/分工/A-C01..16真实验收；B/C能力是目标，不当作A已完成。资料/脚本/分镜的完整下游重算尚未模拟，这些变更会阻止本原型的画面提交，避免假完成。
3. 看02精确接口/权限/幂等/错误/事件与03同库恢复、legacy隔离和内部事务改动；contracts.schema.json为字段源，contracts.ts生成镜像。registry全部是目标，不冒充当前API。
4. 在页面逐项填17条意见，下载JSON交给MAIN；不自动授予生产实现权限。

## 可复现命令（仓库根目录）

```bash
node tools/s0-contract-check.mjs
python3 -I tools/s0-sql-check.py
node node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --types node docs/agent-driven-v1/s0/contracts.ts
node tools/s0-browser-check.mjs
node tools/s0-freeze.mjs
```

校验工具不安装依赖、不开Host、不调用provider、不读J盘。浏览器使用独立临时profile、Headless静音并精确清理；测试意见只写临时浏览器存储。contract/SQL/类型/模拟UI校验和真实业务验收分别记录。

## 冻结口径

FREEZE.json绑定本包schema/TS/SQL/原型/文档/校验回执与工具SHA256；状态固定S0_REVIEW_CANDIDATE。改动任何绑定文件必须新候选和相关复验，不能覆盖旧失败。旧源码观察在baseline.json，未重跑历史全量或视频验收，未修改src/tests/contracts/package/lock。

S0-HUMAN=REVIEW_PENDING，CP-A0=NOT_RELEASED，A/B/C=未实现。用户核验后MAIN仍须先汇报A具体开工计划/实际任务分配；生产合同注册、SDK lock/许可证与真实客户端探针、真实旧库/上游初始化/媒体恢复另有实现门。方案闭环不冒充这些门已绿。
