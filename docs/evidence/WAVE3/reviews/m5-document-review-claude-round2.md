# M5 开发前独立文档审查（Claude Code Round 2）

绑定提交：`29f40f04932b15f5b3e17a1a43ac706d7742e128`

结论：`NOT PASS`（新增 BLOCKER=1 / MAJOR=4 / MINOR=6）。首轮 Studio 合同与 route fitness 阻塞已在文本层关闭；
comparison replay 仍因引用非持久 `MigrationReportV1.target_clips` 而不可达。

本轮要求的修订已经纳入 `04_M5_REVIEW_CLOSURE_AND_SUPERSESSIONS.md`：

- source shot→target clip 改用当前迁移器的同 id 不变量，由 source descriptor 与当前 EngineProjection 双向互证；
  禁止使用 report extras 与空 plan identity_map；
- Studio Gateway 开放集严格等于 OpenFilm capability map 当前 supported 的 adopt + restore/undo/redo；fit/replace 不冒充；
- Host asset import 与 upstream `files.bring` 分层，保留既有 translated_host_service 策略；
- Studio 浏览器没有 Host bearer，所有业务调用由 Gateway 服务端中继；Gateway origin 直调 Host 必须被拒且零副作用；
- `startStudio/StudioHost v1` 在开工时先做固定上游真实 probe，缺失/签名不符进入 `M5_BLOCKED_ENV`；
- 统一 Gateway 命名、标注新增 host_identity、消歧唯一原生 timeline、明确 fixture 与 package scripts。

本轮结论不是开工许可；必须在新冻结提交上第三轮独立复审 PASS。
