# 008 — 实际 native document loaded-version 接缝（只读分析）

状态：IMPLEMENTATION_MAP / NOT_IMPLEMENTED / NOT_TESTED。作者 Codex，唯一文档 writer；2026-11-10。只新增 PRODUCT 分析文档，没有运行测试、构建或安装，没有改 MAIN、vendor 或 legacy UI。本报告不另设模块人工门，也不代签 A05/整轮人验。

读取 MAIN HEAD：`452b4a2605381ef8d71de8cca1f539df2b2296e1`（工作中源码可能继续变化）。原上游完整 pin：`e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3`，来源 MAIN `contracts/openfilm-upstream-lock.json`。本文 V 路径均相对只读 `Narralens-openfilm-m1b/vendor/openfilm`；M 路径相对 `Narralens-agents/main-integration`。

## 结论与最小切口

原 pin 有公开的 `StudioHost` v1 selection/command 接口，没有“此文档版本已由实际编辑器提交到 DOM”的接口。可以通过 **managed UI 的三个源文件薄 patch** 补齐：`lib/host.ts` 的可选版本化 observation 扩展、`editor/use-film.ts` 同一原生状态里的服务器字节证据、`components/ProjectView.tsx` 的实际 DOM commit 观察。继续用原 App、Timeline、Player、useFilm、undo/redo 和 clock；不需要第二应用、第二 timeline、私有 React fiber 或 Host 响应拦截。

这是已授权 A05 的常规适配扩展。上游只读、原 legacy dist 不变；新 UI 输出单独记录“上游完整 SHA + patch SHA + 输入/依赖闭包 hash + 构建输出 hash”的复合 pin。它不是未经说明仍冒充原上游 UI pin 的产物。

## 已核对的事实链

| 源实体 | 当前事实 | 接线意义 |
|---|---|---|
| V `studio/ui/src/lib/host.ts:12,34,256,291`（前缀 `packages/openfilm/`） | StudioHost v1 有 onSelection；StudioSelection 只有 project/time/refs/range/stage；模块载入时捕获 globalThis.openfilmHost | 官方 selection 不是 loaded ack；注入须早于 UI module 执行 |
| V `packages/openfilm/studio/ui/src/api.ts:24,99,102` | ProjectFilm 返回 text/rev/value/doc/problems；edit 返回 text/rev/value/doc/rebased | 原生接口本来已提供真实服务器 film 原文与 native rev，不需新增伪造查询 |
| V `packages/openfilm/studio/server/film.mjs:26,33,64,77` | revOf 是 UTF8 text SHA256 前 16 hex；读 film.html 后解析；写/edit 返回实际写出的 text/rev | 必须同时传 full SHA256，不能只依赖截断 rev；不能 serialize Film 替代原 text |
| V `packages/openfilm/studio/ui/src/components/ProjectView.tsx:188,201,232,234` | 实际 api.film→loaded，但 initial 仅传 value/rev 给 useFilm，text 在此丢失 | 最早的安全补点是将同次返回的 text 与已解析 value 一起传递 |
| V `packages/openfilm/studio/ui/src/editor/use-film.ts:20,35,71,116,129–152,203` | FilmState 只有 value/rev；fromServer 替换实际状态；本地乐观编辑保留旧 rev；有些成功路径只更新 rev；失败可能保留旧图且 broken | 只读 state.rev 也会误报；必须明确证据失效/settled/已解析状态，覆盖每条转换 |
| V `packages/openfilm/studio/ui/src/components/ProjectView.tsx:517,535,2333–2336,2714` | 同一 film.film 生成 timelineTracks/blocks，value 决定实际 Timeline；workspace-shell 是实际 editor 根 | 在该组件无条件调用 layout effect，ref 指向真实根，在此提交之后观察同一状态 |
| V `packages/openfilm/studio/ui/src/components/ProjectView.tsx:1179–1191` | onSelection 是延迟 80ms 的 selection effect，不含文档证据 | 保留它的语义；不能拿它当 loaded |
| V `packages/openfilm/studio/ui/src/editor/Preview.tsx:202–220`；ProjectView:2334 | Preview ready/seeked/updated 校验 film origin/source frame，但消息未绑定文档 rev；viewerReady 仅 Boolean(info) | 文档 DOM commit 不等于视频解码/指定新版本画面 ready；不能偷换标签 |
| V `packages/openfilm/studio/ui/src/main.tsx:1–11` | applyStudioHost 后 createRoot + StrictMode + 原 App | 无需改入口，注意 StrictMode effect 重入、清理、序号去重 |

`useFilm.settled()` 仅是 queue Promise；onChange 会在 React commit 前调用；二者单独都不足以当 DOM 已载入证明。未载入、解析失败、broken、乐观编辑、卸载都不能沿用先前 ack。合法空 Film（例如 tracks=[]）可以真实提交文档 DOM；不存在/空字符串且解析失败的 film.html 不可以。空工程不应为获得 ack 而虚构镜头或播放帧。

## managed patch 的准确职责

1. `use-film.ts` 扩展现有 FilmState 的**观察元数据**，不建立另一份编辑文档 store。服务器证据至少含原始 text、native rev、state epoch、同次解析 value 的关联与 pending/dirty。initial、fromServer、edit/rebase 成功、异常恢复、undo/redo、forget/导航均须维护。每次乐观 value 更新立即清空可 ack 证据，并发出失效状态；pending 大于零时即使某个 edit 返回 rev 也不能恢复证据。
2. 所有成功分支都要经过同一个小 helper 判定“最新响应的 value 与现在实际 state.value 一致，且没有后续未确认本地编辑”。原有只更新 rev 的分支不可直接沿用旧 text。可保留原 reducer/相等性规则；观察证据必须保守失效，不能为了恢复证据强行改变 editor 行为。broken 后回退旧 value 只代表编辑器仍显示旧图，不代表本次请求版本载入成功。
3. `ProjectView.tsx:232` 把实际 loaded.text 纳入 initial 证据。新增 root ref 及 **在条件 return 之前声明** 的 useLayoutEffect；只在真实 workspace-shell 已挂载、film 状态合法/settled 的同一次 React commit 里开始观察。读取闭包里的 state epoch/value 及其 text 证据，不从 DOM 猜 Film，不访问 React fiber。
4. 使用 TextEncoder(text) + crypto.subtle SHA256。hash 异步完成时须核对本次 token/epoch 仍为当前且组件仍挂载、无 dirty/broken。更稳妥的实现是 hash 完成更新证据状态，再由下一次 layout effect 验证根/epoch 后发 committed；不能把网络回调自身叫 DOM commit。旧 hash、导航前响应、卸载/StrictMode 清理必须失效。普通 time/selection 变化不需要重新 hash。
5. `lib/host.ts` 添加可选 `narralensObservation: {version:1,onDocumentState(...)}`；原 StudioHost.version 仍是 1，扩展有独立 version。无此字段时原行为不变。此命名是本报告的 managed API 建议，不声称上游已有此接口。

建议内部事件：`kind = document_dom_committed | invalidated | broken | unmounted`；committed 带 studio_project_id、document_epoch、native_rev、film_sha256、utf8_byte_length。会话/open generation 由 Host 注入绑定，不由 film 内容指定。其余事件带 epoch 和有限 reason，无 film 原文/磁盘路径/凭据。可再带 canonical parsed-value digest 用于排查，但不能替代原始 text digest。dirty invalidation 应从原生编辑路径及时通知，不能等网络返回。浏览器消息不是持久批准或 Coordinator 写权限。

这是“实际原生编辑器文档状态已经提交到 DOM”的证据，不是“所有媒体已经播放/解码成功”的证据。如 A 体验另要求 preview-ready，需另外扩展 Preview 的真实 frame/update/seek sequence 与同一文档 epoch 对齐；不能用旧 info 的 Boolean、任意 film postMessage 或 document ACK 冒充画面就绪。

## MAIN 接线与校验序列

M `src/host/m5/openfilm-studio-gateway.ts:563–571` 已将 `/narralens/studio-host.js` 以 classic script 插入 body，先于 deferred modules；M `studio-host-bridge.ts:63,79` 已建立 onSelection 和 window.openfilmHost。可在**这条现有 bridge** 上增加上述可选扩展，监听只接受此 adapter 的受管回调，再经受鉴权的 workbench-session 通道报告。不要把已有可伪造 CustomEvent 当可信状态来源；film iframe 的 origin/source 边界继续保留。浏览器同一 trusted editor origin 的 XSS 属既有信任边界，callback 本身不是密码学签名。

具体顺序：

1. MAIN 从已提交不可变 snapshot 及其真实 source closure materialize 独立 native workspace。先验证 film 文件为严格 UTF8（decode/encode roundtrip），读取最终实际 film bytes 的 full SHA256/长度；记录 workspace instance/generation、native project id、author project/revision/snapshot/source binding。不直接把 author/snapshot 根交给 native 写 `.film`。
2. 启动已验证复合 pin 的受管 UI，Host 将私有 session/open generation 绑定到当前 workspace/项目。目标 revision 是**期待值**，不能作为 UI 自报已观察值。UI 仍从原生 api.film 读取、useFilm 载入、Timeline commit。
3. UI 提交观察 full SHA256 + native rev + epoch。Host 在同一 session/当前 open generation 下对比实际 workspace/已提交目标 film bytes；native rev 应等于 full hash 前16位。只在真实原生证据匹配后，按服务器绑定映射 author revision/snapshot/source 到 NativeAck。不能从 Hostcurrent 直接复制版本并回填为 loaded。
4. 已有 committed ack 收到 dirty/broken/unmounted、新 open generation 或断连即失效。native 本地编辑变成另一组 bytes 时，不再声称它是旧 snapshot；进入已有 Coordinator adopt/prepare/apply 路径。不能自动把 native 编辑写回 author。
5. selection 仍用同一 ProjectView/onSelection。绑定同一会话、文档 epoch 与实际 selection 序号；不能将另一项目/旧 epoch 的 selection 拼到新文档 ack。Server 对乱序观察拒绝或忽略，只允许单调 generation/epoch。

**证据范围限制**：film 字节相同而 subtitles/settings/assets closure 不同，full film hash 无法证明后者也已经被 UI 加载。Host materialization 可证明封闭工作区正确，但不能将此说成 UI 每个资源的 loaded 证据。如 NativeAck 的 source_version 语义要求这些 UI store 也更新，需要对实际 useFilmSubtitles/settings/listing 状态增加同类 epoch 观察，或规定切换 generation 强制重开且在各实际 store 返回后汇合。不要用 Host 的 closure hash取代原生 store 的加载证据；不必因此阻塞先做真实 film/document ACK。

## 受管构建与复合 pin

V `packages/openfilm/studio/ui/vite.config.ts:1–16` 使用 React/Tailwind、alias @、es2022、输出本包 ui/dist；V `packages/openfilm/package.json` 的 `build:ui` 是 `vite build --config studio/ui/vite.config.ts`，且有 prepare 自动 build。V use-film.ts:15–16 直接依赖相对路径 `studio/server/ops.mjs` 与 `src/film-doc.mjs`；不能只拷贝 ui/src 就改用 Host 的依赖版本声称等价。

隔离方法（供 MAIN 在获资源准入后实施，此次未执行）：

- 从验证过的完整 upstream SHA 导出到独立 managed build root，保留原包相对目录；复制 lock/workspace/package 清单和 build import 所需闭包。原 vendor 与 legacy ui/dist 保持只读，build root 不含运行 project/home/library。不得写原 dist，也不得 symlink 可写 node_modules/运行根。
- 仅在导出树应用版本化三文件 patch，记录 patch base/path/preimage/postimage hash。使用该树的原 lock 做 offline/frozen/ignore-scripts 安装，避免 prepare 隐式构建；锁及版本不改。原包需 pnpm9.15.9、monorepo Node>=22.18；MAIN 是 pnpm10.33/不同 React/Vite，不能静默混用 Host node_modules。缓存缺包则报明确本地构建依赖缺失，不自动联网升级。
- 在独立树运行 `pnpm --filter openfilm build:ui` 和该包 UI typecheck（资源由 MAIN 排期）；产物发布到独立不可变 editorDir，以 manifest hash命名。既有 pnpm store 的只读包内容可复用，项目可写安装树必须独立。
- 复合 manifest 至少记录完整 upstream SHA、原锁 hash（现冻结 `d9faf24e9480b847be99b61ec2b220ef5290530a54b1f6f667845fb8ac2905f9`）、patch commit/full hash、patch 输入/输出、实际依赖/Node/pnpm/build 命令、dist 全文件有序路径+hash 闭包。输出树 digest 是 build SHA；仅写“patch git SHA”不能固定构建结果。
- MAIN 原 upstream lock 的 studio_build_input_sha256 继续描述旧 dist，不能改写成新 UI 后仍自称同一 pin。新 manifest 是显式的 managed-ui composite pin，原 upstream server/film/guard模块 pin 继续验证。

M `src/host/m5/isolated-studio.ts:16` 当前只接 vendorRoot/runtimeRoot；M `openfilm-studio-child.mjs:25,34,38` 从私有父进程取得 vendor，导入原 server，editorDir 硬编码原 dist。常规最小扩展为 MAIN-owned 的 verifiedManagedEditor 参数/manifest：父进程验证后通过私有启动参数/IPC传入，子进程独立校验允许路径/不可变 manifest/dist closure，再将该 editorDir 交原 `startStudio`。不得通过浏览器参数或随意环境变量选 editorDir。M `openfilm-studio-supervisor.ts:247` 调用 isolated launcher；其原 legacy 路径 :267 保持原 dist。原 probe 仍校验原上游，另增 managed artifact probe，不让 probe 对假原 pin 放行。

## 实施后的最小真实观察点（当前全部 NOT_RUN）

- 正向：真实 committed snapshot materialization→真实 isolated Studio→原生 api/useFilm→DOM root/Timeline，观察 fullsha/native rev/epoch 与磁盘 exact bytes 一致；合法空工程也通过文档 ACK，且 preview 状态单列。
- 防伪：只收到 GET、只改 Hostcurrent、只派发 CustomEvent、旧 onSelection、仅 state.rev 更新、仅 queue settled 都不能产生 ACK；未匹配 expected bytes 的原生载入应明确 mismatch。
- 竞争：两次快速 open、旧 GET/hash 晚到、StrictMode 双 effect、组件卸载、断连重连、旧 generation 的消息均不回绿；本地 optimistic edit 即刻 invalidates，pending>0 不回绿；edit成功/rebase、undo/redo、外部变更/解析失败/恢复各保留真实行为。
- 同源隔离：film iframe 即便向 parent 发 ready/假 observation 也不能冒充 managed editor；native workspace 文件变更不能写 authorroot；不同会话/项目观察不能混接。独立 session 安全审查由其他人负责，本报告不重复签署。
- UI 观察：真实 timeline 的 clip/count/位置与 loaded parsed state 对齐；selection/clock/undo 照旧；旧 preview info 不使新文档显示“画面已就绪”。构建错 hash/漏文件/替换依赖时 launcher 拒绝启动。

## 风险与切换依赖

常规接线范围：同一原生 useFilm 观察元数据、ProjectView commit callback、StudioHost 可选扩展、managed build/pin、既有 gateway bridge 与 isolated launcher editorDir 参数。这些不新增生产写权限，不需要另开人工模块门；按 A 目标继续实现、内部检查、独立复核和阶段末人验。

真正需要重新裁决的冲突是：将未知/任意 native 文件当已提交 snapshot；让观察回调绕过 Coordinator 写 author；放开 film iframe 访问 Host 权限；将未版本化改包当原 pin；用第二 editor/store/clock 替代原生；或者扩大 NativeAck 为“所有资源/画面已载入”却无相应真实观察。这些不是本方案所需动作。

切换只依赖 MAIN 正在做的 committed snapshot→隔离 workspace、明确 generation/source binding、managed build closure可离线获得、以及 authenticated session ACK入口。没有官方现成 loaded seam 是一个可实现的 adapter 缺口，不是 A05 的永久合同阻断。源码/构建/真实浏览器观察尚未实施，本文不能被登记为 loaded证据或 A05 PASS。
