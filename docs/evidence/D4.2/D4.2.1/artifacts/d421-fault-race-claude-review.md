# D4.2.1 Fault/Race Claude Code 外审

日期：2026-10-14  
工具：Claude Code CLI 2.1.205 / Sonnet  
基线：`ff090f1` + 当前 fault/race diff  
模式：完整仓库上下文、只读审查

```text
VERDICT: PASS
ALLOW_FAULT_RACE_SUBSTAGE_CLOSE: YES
CRITICAL: 0
MAJOR: 0
MINOR: 0
```

## 审查结论

外审未发现 critical、major 或 minor finding，并确认：

1. `AssetRegistryDependencies.fault`、`AssetUploadDependencies.createStagingWrite` 和 `AssetImportServiceOptions.contentInstall.link` 均为可选的进程内窄测试缝；生产构造走原生默认值，HTTP、metadata、环境变量和项目文件不能选择故障点。
2. staging/content link/manifest write/rename 的发布前失败返回 500，清理 temp 与未引用的新内容，保持 manifest、Author facts、revision 与 attention 状态不变。
3. rename 后 directory fsync 或 readback 的一次性失败被包装为发布不确定，精确恢复 preimage 并重读证明后才清理内容；补偿阶段持续 fsync 失败则返回 423、持久化 attention 并保留内容，绝不伪成功。
4. client abort 测试使用真实监听端口、chunked request、部分 file body 和 socket destroy，最终轮询真实 staging 目录为空，不是 mock。
5. 同项目并发测试通过真实 HTTP 与共享 `ProjectOperationQueue`；两个不同请求均落盘且无 lost update，同 key 并发只追加一次并逐字段重放同一响应。
6. `ProjectWriteActor` 第五参数只允许测试装配共享 registry，生产默认构造不变，Host 的 registry identity 校验保持成立。
7. fault 测试断言真实 manifest bytes、content 文件、staging、SQLite attention、Author facts 与 Actor 调用数，不是仅验证 hook 被调用。

## 外审验证事实

- 聚焦测试：2 files、20/20 通过。
- fault hook 位于真实 I/O 前后，没有替换事务编排、journal、HTTP normalization、补偿或 attention 判定。
- 持续 fsync 故障下 manifest 当前可读为 preimage 仍不足以证明持久性，因此 attention=true 且内容保留；该行为符合冻结计划。
- import 路径没有新增 route、Source/Run/narration/revision 写、Runner 调用、URI 解引用或路径泄漏。

## 声明边界

- 本轮不是实际物理满盘、RAID 或磁盘断电复现；它以注入 errno 和真实文件 I/O 分支验证语义。
- 并发规模为两个并发请求；无 lost update 结论限定于已验证的 N=2，不外推为压力测试结论。
- 真实浏览器交互、真实 200% 文本缩放、最终 evidence manifest 和 D4.2.1 总审计不属于本轮外审范围。
