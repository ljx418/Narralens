# M5 开发与验收门

状态：`FROZEN_FOR_IMPLEMENTATION`

强制裁决：`04_M5_REVIEW_CLOSURE_AND_SUPERSESSIONS.md`。所有 case 同时受其 Studio Gateway、comparison replay、
身份/锁/CAS、fixture 与 BLOCKED_ENV 规则约束。

## 1. 连续开发分段

### M5A：生产接缝与工作台骨架

1. 合同/schema/validator：WorkbenchProjectionV1、PublicLockV1、lock create/release、ComparisonReplay；错误码复用既有 union。
2. Host：workbench/replay/两条 lock route；source↔target 字段互证；锁严格 control CAS；完整负向路径。
3. Studio：Supervisor + Gateway + fixed-upstream closure pin；StudioHost selection/command bridge；read allowlist 与 native write
   translate/block；替换当前 preview 404。
4. Client：扩展 `HostApiClient`，不得在组件中直接 fetch；AbortSignal、correlation、幂等和 SSE 清理统一。
5. App：拆分 StageRouter、stores、Refine 四区布局，打开真实 migrated target；StoryAtlas 不是第二 timeline。
6. Fitness：精确 route 白名单 12→16，新增 mutation bite；这是唯一允许的旧门前向更新，其他旧测试不删不弱化。
7. 出门：UX-01..05 的自动部分和 Gateway 安全/绕过门；旧 1040 回归保持通过。

### M5B：完整比较—采用—恢复闭环

1. source/target 映射把既有真实 D4.1 comparison 通过 04 §2 replay 为 target-owned；不新调 provider；UI 标注录制件，
   3–6 候选中最多三路真实 proxy 同时 active。
2. proposal→bindings→materialize→GET 状态→impact→确认 adopt；每一步展示真实状态，不假百分比。
3. 采用后刷新 workbench projection/history/revision；同页 NativeTimelineBridge 与 selection 不丢失。
4. lock 创建/释放真实阻断 impact/adopt/restore；显示本机 owner/reason；History drawer 的 undo/redo 只生成意图，再走 impact/确认。
5. 409/422/423/428/500/503、cancel/late/stale/attention 均保留草稿并给出准确下一步。
6. 出门：UX-06..10；至少一条真实 900 帧链完成采用、关闭重开、在原生 timeline 重新选择中镜并受控采用、恢复旧 snapshot。

### M5C：可访问性、性能与 Headless 体验

1. 用 04 §7 的本地固定上游/ffmpeg 生成 20+ clip / 3–5 分钟真实系统 fixture；120 clip 结构压力 fixture。
2. 100 次 selection/pan/zoom/chapter 原始样本；p95≤100ms；冷/热重开、首帧、内存、丢帧分开记录。
3. 键盘、焦点恢复、reduced motion、axe、1440×900、1024、768、360 审阅模式、原生 200% page zoom。
4. 用仓内 launcher 自行启动并清理 Headless Chrome/Host/Gateway；不依赖用户手工 CDP。
5. 生成中文 HTML 自动验收报告，结构和必填字段见 04 §8。
6. 出门：UX-11、PF-01..03 到 `INTERNAL_EVIDENCED`；UX-12 保持 `HUMAN_NOT_RUN`，停在人工体验门。

## 2. 逐 case 门

| Case | 必须直接证明 | 失败门限 |
|---|---|---|
| UX-01 | Idea 草稿可编辑且不会伪装已建工程；打开/迁移真实 source→target 映射；本阶段不创建空白项目 | 固定 `d1-30s` 写死为生产入口或偷做 M6/M7 项目创建 |
| UX-02 | target 关闭重开后 projection/revision/history/selection 可重建 | 内存态才能打开 |
| UX-03 | 章/镜头/时间码定位同一 target clip/range，并显示唯一 source shot lineage | 自建第二 clip 列表或混用 shot/clip id |
| UX-04 | 语义结果同时带 script anchor、clip 和半开范围；无数据时诚实 blocked | 假搜索命中 |
| UX-05 | 原生 StudioHost bridge 使 navigator/player/timeline/inspector 共享 selection/clock/snapshot | 各组件漂移、raw upstream edit 或 preview 404 |
| UX-06 | 帧↔seconds 使用冻结 rational time model；缩放不改变 source | 浮点累计或写工程 |
| UX-07 | 录制 D4.1 comparison 有原始 audit/lineage；3 路 proxy 是真实 media events，只有一个音频焦点，离屏暂停 | 把 replay 写成新生成，或图片/mock 冒充视频 |
| UX-08 | 能力类别来自 server capabilities；Gateway 对未支持 native write 同步 disabled + 服务端 422 | 假按钮、裸 native op 或只禁 UI 不禁绕过 |
| UX-09 | materialize→impact→confirm→adopt；成功 +1，失败 0，跳过 NOWRITE | UI 直接写 source |
| UX-10 | 同页原生选择/预览 + capability 已支持的受控 adopt/history；undo/redo 只生成 restore intent；恢复 +1 | 裸原生 edit、指针回拨或“200=已撤回” |
| UX-11 | 键盘、焦点、文本状态、axe、reduced motion、主题、隔离 profile 原生 200% 读回 | headed 自动化、手工 CDP 或 CSS/viewport 缩放冒充 |
| UX-12 | 人类一分钟定位/比较、十秒找到撤回、理解 impact/错误 | 自动化代签人类判断 |
| PF-01 | 120 clip 四类操作各 100 样本 p95≤100ms | 丢慢样本/混入 AI 延迟 |
| PF-02 | 三路真实 proxy 播放/切焦，无三路同时出声，无不可控内存增长 | mock 或音频竞争 |
| PF-03 | 冷/热重开数据一致，首帧/内存/媒体关联记录 | 只测热缓存 |

## 3. 关键负向矩阵

- workbench：未知项目、非 terminal migration、binding/commit/ledger 缺失、source/asset drift、路径泄漏；
- identity/replay：MigrationRow 与 view 不一致、source comparison 属错项目、source shot 无/重复映射、lineage 篡改；
- locks：extra field、跨项目 id、非法 type/scope/reason/range/target、stale control revision、同 key 异体、重复 release；
- Studio Gateway：错误 HEAD/dirty/hash/接缝签名、raw key/path 泄漏、伪 Origin、未知写入口、stale native base、
  rebased bypass；Gateway origin 直调 Host 必须 401/403 且 lock/revision/outbox 均不变；
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

自动化全程 Headless、静音（浏览器 mute）、隔离 profile、无窗口、不抢焦点，由仓内 launcher 启动并在 finally 清理
自己创建的浏览器/Host/Gateway；200% 复用 04 §7 的已验证机制；
禁止读取 `J:\`，禁止网络/provider/付费。缺真实 fixture 或固定上游记 `BLOCKED_ENV`，不得 fallback mock 后宣称 E2E。

若缺固定 checkout、Chrome、ffmpeg、fixture 或固定上游 Studio 接缝/签名，合法终态为 `M5_BLOCKED_ENV`：不得启动人工体验门，不得声明
`M5_HEADLESS_EVIDENCED`。该状态不是测试 PASS，也不得靠延长超时或选择性摘绿消除。

## 5. 最低命令与证据

M5A 必须新增 `test:m5` 与 `test:m5:headless` 两个 package scripts；它们在本文冻结时尚不存在，不得在实现前冒充
已执行。完成实现后的最低执行：

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

中文 HTML 报告必须包含：基线/冻结 SHA、逐 case 状态、命令/exit/原始日志索引、截图索引、DOM/a11y/performance、
浏览器/硬件/profile/zoom、媒体与 ffprobe/decode SHA256、事务/NOWRITE 差异、失败捕获、审查状态、回退、限制与 NOT_RUN。

## 6. 内审与停点

四视角：架构/单权威、实现/并发、完整体验/可访问性、安全/证据。BLOCKER/MAJOR 全部关闭后冻结代码提交；实现
会话不得自签独立外审。M5A/B 不做重复模块外审；M5C 组合候选交 Codex/独立 Claude 一次总审。自动证据通过后必须
停止在人工体验门，headed/human 仍为 `NOT_RUN`，由用户决定何时启动可见服务。

允许最高声明：`M5_HEADLESS_EVIDENCED`；人工签署后 `M5_HUMAN_ACCEPTED`。仍禁止 Gate D4.2、V1-P0、V1-Full、
M6、生产 render、长片性能已验。
