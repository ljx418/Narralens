# M4B 四视角内部审查

状态：`BLOCKER=0 / MAJOR=0 / MINOR=3`。本结论只支持 `M4B_INTERNAL_EVIDENCED`；独立外审仍为 `REVIEW_PENDING`。

审查对象：`src/host/adoption/`、OpenFilm adapter 的 closed adoption op、生产 Host 路由与装配、`RevisionStore.commitAdoption/abortAdoption`、projection/ledger/materialization 接缝、M4B 合同与测试。基线为已通过的 M4A；没有改写 Wave 1/M3/M4A 历史证据。

## 1. 架构与合同

- 写入口只有 `/api/migration/v1/projects/:id/edits`，只接受 `AdoptRequestV1`；history restore/undo/redo 仍未注册。
- `EnginePort` 仍为七方法；Host 通过 `NativeWriteGateway` 把唯一白名单操作翻译为 OpenFilm adapter 的九条 closed op，不接受客户端原生 op。
- author source 只有两个允许变化：安装内容寻址 MP4、同目录原子替换 `film.html`。路径、摘要、protected roots、临时 token、before/after facts 均 fail closed。
- revision、active pointer、impact consume、projection fact、ledger、outbox 与 idempotency response 在一个 SQLite 事务提交，未建立第二幂等权威。

结论：无 BLOCKER/MAJOR。

## 2. 实现、并发与恢复

审查期间发现并已闭环：

1. publisher 的临时文件 token 与 durable recovery fact 曾分别生成，可能无法清理同一文件；改为事务作用域唯一 token并加入负向校验。
2. generic recovery 的 pending transaction 门会挡住 M4B 自身精确恢复；增加同一项目队列内的 controlled recovery，并确保 M4B 专用恢复先运行。
3. ledger 曾把 adoption 行当 migration baseline 行计数，采用后重验会误报漂移；增加 provenance，migration 与 adoption 事实分离。
4. M3 任意 segment 数曾被强制映射到三个固定 clip ID，破坏既有非采用 materialization；只有与 migration bindings 完整一一对应的三镜计划才使用稳定 native ID。
5. pinned OpenFilm 会省略 `overrides: null` 属性；validator 现在只在这一个 canonical 等价上接受 omitted，不放宽其他字段。
6. 最初只有协调器 `after_prepared/published/committed` 三个崩溃点；补齐 publisher 的 `asset_temp_fsynced/asset_installed/film_temp_fsynced/film_renamed/parent_fsynced` 五个真实持久化边界，并增加 neither-before-nor-after 的 terminal attention 证据。

并发结果：同项目由 `ProjectOperationQueue` 串行；同 key/digest 并发得到一个 commit 与逐字 replay；发布前重读 impact/materialization/view/rights 并重查锁；所有数据库状态推进使用前态谓词/CAS。

结论：上述问题均有会在旧实现失败的测试，无残留 BLOCKER/MAJOR。

## 3. 完整体验与安全

- 自动化从真实 migrate-copy、三镜 materialization、impact、adopt、Host 重启走完整生产路由。
- 固定 OpenFilm 上游真实渲染 900 帧影片；采用后仍是三个 native clip，只改中镜 overrides 后两侧 ID 不变，第二次渲染可完整 decode 且摘要改变。
- 全程 headless、静音、无窗口、无焦点抢占；仅 loopback；未读 `J:\`，未调用 provider、网络付费或外传。
- 4xx details 不包含绝对路径、token 或 adapter 内部类名；凭据扫描纳入冻结捕获。

结论：M4B 后端用户路径成立，但不是 M5 UI 人工体验结论。

## 4. 测试与验收

逐 case 映射见 `docs/evidence/WAVE2/cases/m4b-cases.json`。冻结捕获必须执行 contracts、M2.1、W2.0、M3、M4A、M4B、fitness、全量 check、生产 build、历史 evidence 门与 credential scan。Wave 1/M4A current-tip integrity 因后续合法改码应非零，日志原样保留；其 historical 门必须为 0。

证据生成后由 `evidence:wave2:m4b:integrity` 复核 capture commit、clean-at-capture、命令/日志/exit 摘要、逐 case、route 状态、声明上限与外审状态。实现会话不得把外审改成 PASS。

## 5. 有界 MINOR / 声明限制

1. `film.html` 同时不匹配 before/after 时进入 terminal attention；M4B 没有人工 repair/clear 工具，这是安全停机而非自动可恢复体验。
2. 真实媒体只覆盖固定 900 帧短片，不代表长片吞吐、磁盘压力或生产 render route。
3. headed/human 为 `NOT_RUN`；最近的人工体验仍依赖 M4C、Wave 2 组合外审与 M5 Studio UX。

禁止声明：M4C 完成、Wave 2 完成、Gate D4.2、Gate V1-P0、V1-Full、headed/human 已验。
