# S0审查与声明边界

## 第1轮：MAIN基线与设计自审

只读核对当前核心实体/Job kind/DDL/原catalog，记录baseline.json。发现一般project_create未实现，旧投影要求migration，MCP/新工作台尚为规划；本包显式分离初始化与迁移，不伪造旧Gate。未运行生产全量或视频验收。

## 第2轮：两路独立只读设计审查

契约/恢复审查发现：旧/api/session全权token和confirmed布尔批准可绕新scope设计；commitAdoption内部BEGIN IMMEDIATE导致外层consume无法原子；approval事实可被修改；Artifact缺input_refs；全局outbox ID间隙不能判断丢事件；workflow/download合同不全；通用hash向量不是合法命令。对应修订02 §8/9、03 §6、schema/registry/DDL与合法命令向量。审查者使用纯内存SQLite验证过旧候选approval可篡改，未接触生产库。

UX/验收审查发现：E03缺资料/主张/来源路径、节点共用版本/内容、未保存内容丢失、批准无前后对照、任意主题套彩虹示例、重开不重验、storage异常与多窗未处理、dialog/选案语义及C阶段不清。原型已加入独立节点内容/版本、编辑缓冲、来源待核验、明确固定示例、批准前后/范围/许可/费用、重开清预览、storage降级/冲突提示、可访问命名与C目标操作。

这些是文档/原型设计审查，不是生产独立外审或用户验收。最终复核结论与工具receipt待完成后追加，不提前写PASS。

## 第3轮：自动校验与MAIN复验计划

- s0-contract-check：严格schema/输入输出注册一致性、未知/缺字段拒、TS同源、合法命令与通用canonical向量、越界数字。仅合同工具证据。
- s0-sql-check：从旧source摘录真实DDL，在临时库执行新增SQL/约束/重复执行/回滚/重开，独立Python复核hash；不是RevisionStore生产迁移验收。
- s0-browser-check：真实无窗口Chrome操作模拟原型，检查PX路径、草稿/节点版本、冲突/取消/重开/断线、核对意见下载与响应式；不是生产链。
- Archify：deliver结构与浏览器/视觉证据分列，非零结果原样保留。

## 当前声明上限

S0_REVIEW_CANDIDATE；S0-HUMAN=REVIEW_PENDING，CP-A0=NOT_RELEASED，A/B/C=NOT_IMPLEMENTED。SDK已核对固定1.26.0/MIT注册元数据，未安装/未测试客户端；Codex/Claude/DSH实际MCP探针NOT_RUN。新空工程上游可重开仍需探针；若失败走ADR，不塞fixture。无GPU/模型/付费/媒体外传/访问J盘。

## 修订后独立复核

契约审查又发现EventSource初始query与最新Last-Event-ID本来会不同、MCP快照资源字段缺失；已修为有效header优先且同scope/epoch，新增events-snapshot资源。UX审查发现非画面编辑被误清stale、资料意见未持久化；已修为未模拟重算时禁用提交、审阅意见保存并重开恢复。最终两路只读复核均为本范围BLOCKER=0、MAJOR=0，可交用户核验；不是生产独立外审。

首轮浏览器检查因测试选择器[data-candidate=2]非法失败，原receipt保存browser-check.failed-1.json；修复测试语法，没有放宽原型断言。最终测试结果以contract-check.json、sql-check.json、browser-check.json为准；用户核验仍REVIEW_PENDING。

## 实际复验与浏览器边界

精确合同校验已通过179项（39定义/16目标路由/13工具），隔离SQL+独立Python已通过24项；TypeScript镜像已用真实tsc严格编译exit 0。上一轮Headless模拟路径26项通过，后续补充资料审阅持久化和非画面stale保护，再对最终字节复验；以最终browser-check.json哈希为准。

Archify deliver 9/9、零组合错误/警告；原生visual-check先报告WSL未发现Chrome，指定Windows Chrome后的结果保持在原receipt，不用补充CDP测试改写原生状态。补充Windows Headless检查四尺寸与两端主题，结果另存browser-check.json；人工视觉由MAIN读取真实截图检查，可读性不是结构通过自动推断。
