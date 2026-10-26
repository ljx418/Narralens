# M5 开发与验收门

状态：`FROZEN_FOR_IMPLEMENTATION`

## 1. 连续开发分段

### M5A：生产接缝与工作台骨架

1. 合同/schema/validator：WorkbenchProjection、PublicLock、lock create/release response；错误码复用既有 union。
2. Host：workbench read route、两条 lock route、跨项目/额外字段/旧 revision/非法范围负向路径。
3. Client：扩展 `HostApiClient`，不得在组件中直接 fetch；AbortSignal、correlation、幂等和 SSE 清理统一。
4. App：拆分 StageRouter、stores、Refine 四区布局，打开真实 migrated target，保留旧 D2/D4.2.1 页面能力。
5. 出门：UX-01..05 的自动部分；旧 1040 测试不删不弱化。

### M5B：完整比较—采用—恢复闭环

1. source/target 映射驱动真实 D4.1 comparison，不新调 provider；3–6 候选中最多三路真实 proxy 同时 active。
2. proposal→bindings→materialize→GET 状态→impact→确认 adopt；每一步展示真实状态，不假百分比。
3. 采用后刷新 workbench projection/history/revision；同页 NativeTimelineBridge 与 selection 不丢失。
4. lock 创建/释放真实阻断 impact/adopt/restore；History drawer 的 undo/redo 只生成意图，再走 impact/确认。
5. 409/422/423/428/500/503、cancel/late/stale/attention 均保留草稿并给出准确下一步。
6. 出门：UX-06..10；至少一条真实 900 帧链完成采用、关闭重开、中镜原生修改、恢复旧 snapshot。

### M5C：可访问性、性能与 Headless 体验

1. 20+ clip / 3–5 分钟真实 fixture 的核心路径 Headless E2E；120 clip 结构压力 fixture。
2. 100 次 selection/pan/zoom/chapter 原始样本；p95≤100ms；冷/热重开、首帧、内存、丢帧分开记录。
3. 键盘、焦点恢复、reduced motion、axe、1440×900、1024、768、360 审阅模式、原生 200% page zoom。
4. 生成中文 HTML 自动验收报告，包含截图、DOM/性能 JSON、API/事务/真实媒体证据链接和限制。
5. 出门：UX-11、PF-01..03 到 `INTERNAL_EVIDENCED`；UX-12 保持 `HUMAN_NOT_RUN`，停在人工体验门。

## 2. 逐 case 门

| Case | 必须直接证明 | 失败门限 |
|---|---|---|
| UX-01 | Idea 草稿可编辑且不会伪装已建工程；打开/迁移真实 source→target 映射 | 固定 `d1-30s` 写死为生产入口 |
| UX-02 | target 关闭重开后 projection/revision/history/selection 可重建 | 内存态才能打开 |
| UX-03 | 章/镜头/时间码定位同一 clip/range | 自建第二 clip 列表成为权威 |
| UX-04 | 语义结果同时带 script anchor、clip 和半开范围；无数据时诚实 blocked | 假搜索命中 |
| UX-05 | navigator/player/timeline/inspector 共享 selection/clock/snapshot | 各组件漂移 |
| UX-06 | 帧↔seconds 使用冻结 rational time model；缩放不改变 source | 浮点累计或写工程 |
| UX-07 | 3 路候选是真实 media events，只有一个音频焦点，离屏暂停 | 图片/mock 冒充视频 |
| UX-08 | 能力类别来自 server capabilities；未支持类别 disabled + 理由 | 假按钮或裸 native op |
| UX-09 | materialize→impact→confirm→adopt；成功 +1，失败 0，跳过 NOWRITE | UI 直接写 source |
| UX-10 | 同页原生精修；undo/redo 只生成 restore intent；恢复 +1 | 指针回拨或“200=已撤回” |
| UX-11 | 键盘、焦点、文本状态、axe、reduced motion、主题、原生 200% | headed 自动化或 CSS 缩放冒充 |
| UX-12 | 人类一分钟定位/比较、十秒找到撤回、理解 impact/错误 | 自动化代签人类判断 |
| PF-01 | 120 clip 四类操作各 100 样本 p95≤100ms | 丢慢样本/混入 AI 延迟 |
| PF-02 | 三路真实 proxy 播放/切焦，无三路同时出声，无不可控内存增长 | mock 或音频竞争 |
| PF-03 | 冷/热重开数据一致，首帧/内存/媒体关联记录 | 只测热缓存 |

## 3. 关键负向矩阵

- workbench：未知项目、非 terminal migration、binding/commit/ledger 缺失、source/asset drift、路径泄漏；
- locks：extra field、跨项目 id、非法 type/scope/range/target、stale control revision、同 key 异体、重复 release；
- proposal/materialize：旧 comparison、缺 binding、取消、晚到、Host 重启、proxy 失败；
- impact/adopt/restore：过期、hash 篡改、base/source/control/rights 变化、三类锁、并发双击、网络断开后重放；
- UI：SSE/poll 乱序、组件卸载后晚到、路由切换、浏览器重载、主题与草稿恢复、attention/503。

每项必须断言允许变化和禁止变化，不能只看 HTTP 状态。写路径至少记录 source/revision/active commit/snapshot/
impact/idempotency/outbox/locks 前后；只读路径断言全部不变。

## 4. 测试层次与真实数据

- schema/unit：stores、selection、clock、error mapping、route parser；
- Host HTTP：真实 loopback、SQLite、项目目录；
- component：Testing Library + user-event + axe，只证明 DOM 行为；
- Headless E2E：真实浏览器、真实 Host、真实 migrated OpenFilm、真实 proxy/media events；
- media：固定上游 render、ffprobe、完整 decode、帧数/摘要；
- human：仅项目负责人亲自执行，自动化不得代签。

自动化全程 Headless、静音（浏览器 mute）、隔离 profile、无窗口、不抢焦点，结束清理自己创建的浏览器/Host；
禁止读取 `J:\`，禁止网络/provider/付费。缺真实 fixture 或固定上游记 `BLOCKED_ENV`，不得 fallback mock 后宣称 E2E。

## 5. 最低命令与证据

实现时新增实际脚本名，不预言不存在的脚本。最低执行：

```bash
corepack pnpm check
corepack pnpm test:contracts
corepack pnpm test:wave2:m4c
corepack pnpm test:wave2:fitness
corepack pnpm test:m5
corepack pnpm test:m5:headless
corepack pnpm build
```

证据追加到 `docs/evidence/WAVE3/M5/`：manifest、逐 case JSON、命令 `.cmd/.txt/.exit`、Headless screenshots、
DOM/a11y/performance JSON、真实媒体/ffprobe SHA256、credential scan、内部四视角 review。失败捕获只追加不覆盖。

## 6. 内审与停点

四视角：架构/单权威、实现/并发、完整体验/可访问性、安全/证据。BLOCKER/MAJOR 全部关闭后冻结代码提交；实现
会话不得自签独立外审。M5A/B 不做重复模块外审；M5C 组合候选交 Codex/独立 Claude 一次总审。自动证据通过后必须
停止在人工体验门，headed/human 仍为 `NOT_RUN`，由用户决定何时启动可见服务。

允许最高声明：`M5_HEADLESS_EVIDENCED`；人工签署后 `M5_HUMAN_ACCEPTED`。仍禁止 Gate D4.2、V1-P0、V1-Full、
M6、生产 render、长片性能已验。
