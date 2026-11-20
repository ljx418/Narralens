> 最新恢复指令：先读 [USER_AUTHORIZED_RESUME_AFTER_429.md](resume-claude-20261112/USER_AUTHORIZED_RESUME_AFTER_429.md)。用户已明确允许恢复原Claude任务；本次仅测试修正与记录式tsc释放，其他runtime须新grant。再次429立即停止。

# MAIN：原生真实组合技术裁决

基线e2eff61b464d75d36598103d718cd2a75db5dfda。D10 abf34c9及恢复职责e2eff61均独立bounded ACCEPT；PRODUCT dd32两blob精确集成84PASS/fulltsc0。以上不证明整轮生产，后续目标不缩减。本文由MAIN作已授权A内技术裁决，不向人类重复索取常规实现批准；具体源码权仍须逐路径release。

## F-01：批准只读retained probe和N1N2闭包实现

批准设计CONTRACTS_AND_OWNERSHIP的Host-private parent-PID FD路径：仅已取得的lease内部生成/proc/<parentpid>/fd/<fd>交固定ffprobe。无公共DTO/path/fd输入，不回退可换位普通path。FD/父链一直保留至真实child退出；取消等待自有child退出，无法证明退出则资源与关闭UNKNOWN而非假已释放。不下载/安装/改CLI配置/更换provider或二进制。仅当前本机已有工具、已审上游。

批准其建议资源防护：64KiB流式hash；文本单项8MiB/合计64MiB、4096相关路径与明确目录深度、最多2同proof probe、单probe30s、stdout4MiB/stderr256KiB。它们是有明确失败语义的运行资源防护，不是开发预算/重试次数；不可把截断当成功、提高并发掩盖资源失败或把A影片目标降到诊断3秒。真实A负载若超出，应提具体事实与技术方案，不静默缩水。

缓存按PRODUCT四文档中的精确路径/生成key/原上游producer规则逐项证明。probe cache不是expected事实；必须独立同bytes probe比较。新的/替换的允许派生cache使原proof失效，下一稳定round再证。未知metadata/cache、临时变动态、来源/配对不明全部fail closed，不能宽泛忽略.film。N1N2遇到正常原生必要GET生成未覆盖项，给出实际上游代码/文件/依赖后交MAIN追加精确规则，不允许虚构来源或永远unsupported而自称完成。

## S-01：选择语义裁决，N1N2不实现DDL

接受PRODUCT指出的session-counter重置ABA风险。受控created路径采用一个同原DB的私有项目级单调epoch authority作为方向，不让normal/recovery各用session-local0或plan值。原NativeObservation默认legacy行为不等于受控模式的生产authority。公共Selection/NativeAck/Context DTO、cp_a0表、九字段commit保持原形；新增private selection表须经MAIN精确DDL/迁移票，不准混入N1N2。

必须严格区分两件事：
- epoch事实已知且因实际会话/文档失效而mapping待证：版本仍是可信单调数字，selection返回null/live loaded撤销；不能误称已选择或已加载，也不能因为mapping未证而让doc/hydration→proof无法启动。
- authority缺失/损坏/读失败/未初始化/已关闭：current版本unavailable，绝不返回0或抄plan。初始化0仅当原verified created bootstrap、同库无适用pending且明确首次初始化可证。

新session/workspace、实际mapping变化及明确invalidate按同库CAS推进epoch，重复同有效mapping不重复推进。每次对外publish/commit前比较同一authority；stale session/late callback不能落epoch。Host重启可读已证明持久epoch但不恢复live映射/Ack。不能把没有session的事实直接重置成0；新开实际session先invalidate推进，旧plan不误复活。Host关闭先撤销会话内liveness/停止admission，不能为了关闭实现而令已受理恢复失去其依赖；是否对特定close原因推进持久epoch由精确迁移/生命周期合同列明，不由各consumer猜。

历史created pending若缺epoch账本，不自动初始化/猜旧值；原早期安全abort仍要真实证明原source/base/owner，已发表不确定则保全、明确诊断/对账。既有Hypit/migrated legacy选择语义不被改造。新增表不授予批准或覆盖gate；不得将此历史无法证明状态包装成通用恢复成功或无限defer完成RD05。BRIDGE需提交可执行schema/状态与迁移/重启/close合同供MAIN核定，N3再交实施；不阻塞独立N1N2真实reader。

## L-01：一份装配和关闭owner

MAIN独占server.ts/creation-application.ts/start-runtime.ts和总shutdown；BRIDGE详细恢复设计与PRODUCT原生设计使用同一task/asset/verifier/selection/DB。N1N2只实现自己资源对象的admission/drain/释放，不新建应用、Host、数据库、时间轴、全局关闭器或第二Ack/Job系统。原context/observation/Ack最终事务fence在N3N4实施，不能用N1N2组件通过代签。

代码实施由PRODUCT Codex监督独立Claude具体实现、自验证；MAIN管理共同基线、接口/范围、资源与最终验收。最新Claude429 STOP优先于旧goal自动接手条款：任何新429立即停止，保留源/日志与子进程状态并报告，未经用户此次明确接手授权不自动重试、换provider或Codex接替。
