# M5 开发前独立文档审查（Claude Code Round 3）

绑定提交：`6611eb9e46f98d6a087ba42b82f29d24202b4416`

结论：`PASS`，允许进入 M5A；`BLOCKER=0 / MAJOR=0 / MINOR=5`。

第二轮阻塞和重大项全部 CLOSED：replay 改为 source descriptor 与当前 target projection 的同 id 双向互证；Gateway
开放集与 OpenFilm capability map 精确一致；Host asset import 与 native files 路径分层；浏览器没有 Host bearer、
业务调用由 Gateway 服务端中继；固定上游 Studio 接缝缺失进入 `M5_BLOCKED_ENV`。

五条 MINOR 已在签署提交关闭：

1. 映射权威改为 `openfilm-migrator.ts` 的模块私有 `clipIdFor`，并要求 M5 导出纯函数供 migration/replay 共用；
2. Workbench serializer 明确用 Supervisor descriptor 替换 adapter 的 404 preview 占位；
3. Gateway 与 M5 页面固定同为 `127.0.0.1` 单 origin，不使用跨源 iframe/cookie；
4. StudioHost v1 明确是 M5 build 实现的固定上游接口，probe 路径与 BLOCKED_ENV case 已冻结；
5. 读路径 probe 证据位置与过期 comparison 的 409 用户文案已冻结。

声明边界不变：本结论只允许实现 M5A→M5C；不等于 `M5_HEADLESS_EVIDENCED`、`M5_HUMAN_ACCEPTED`、Gate D4.2、
V1-P0 或 V1-Full。
