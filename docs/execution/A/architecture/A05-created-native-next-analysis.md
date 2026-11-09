# A05 next real vertical: created project into the existing native workbench

Read-only production integration analysis. MAIN observed HEAD `cb444229e37d7503daf13c5fd886ea2bfb7d5fd2`, with live workbench-session edits present; not a frozen review verdict. Only this PRODUCT analysis document is written. No MAIN source changes/tests/browser/Host/media execution. This does not repeat the independent workbench-session preaudit or request another phase approval; A's full short-film goal remains unchanged.

## Next implementation result

The next vertical is: **real owned created project → trusted workbench open → pinned Studio opens that exact committed author source → existing injected M5 panel renders a genuine zero-frame created view → existing selection/clock remains singular → native acknowledgement stays unknown until actual loaded-version evidence arrives.** Root's fixed legacy `d1-30s` is not this vertical, and an open empty Studio is not completion of A05/A.

Prefer the existing **top-level native Gateway editor + injected panel bundle**. Do not build another editor root or embed the Gateway inside a new Host timeline. Existing Gateway explicitly denies framing of its editor (`gatewayFramePolicy`, `src/host/m5/openfilm-studio-gateway.ts:132`), while film runs on a separate read-only origin (`:205`). Keep those boundaries rather than weakening CSP to fit an iframe shell.

## Concrete present seams / exact gaps

| Production entity | Current behavior / next change |
|---|---|
| `CreationApplication`, `src/host/agent-driven/creation-application.ts:27` | Already attaches real creation store/resolver, source verifier, local assets and committed snapshot authority. Composes `FixedWorkflowService({repository})` **without facts/adoption**, `ProjectContextService(..., native=undefined)`. Registers creative/create/creation-job/context/run-read/workflow-read; does not register run prepare/authorize/start, task prepare, review decision, delivery or native ack. Do not infer any of these from the class existing. |
| `ProjectResolver.resolveNative/resolveCreated`, `src/host/projects/project-resolver.ts:133,:139` | Real created origin and committed transaction/snapshot/source binding now exist. `resolveNative` accepts created or activated, preserving actual origin; use it for native open. Do not regress back to catalog or create fake migration IDs. |
| `NarralensHost.#workbench`, `src/host/server.ts:1219` | Calls old migration-only WorkbenchService and legacy validator. Existing route `/api/migration/v1/projects/:id/workbench` is not a genuine created route merely because caller authentication was added. |
| `WorkbenchService.workbench`, `src/host/m5/workbench-service.ts:56` | Calls `resolveActivated` (`:62`), requires non-null migrated_from, migration row, source catalog shots (`:87` onward). Needs explicit created branch using `resolveNative` + real created source fact/projection/local asset facts, with no source-project lineage invented. |
| Legacy read model `WorkbenchProjectionV1` / `contracts/workbench.schema.json:16,:17,:26` | Requires nonempty source_project_id/migration_id and frame_count>=1. Empty created source cannot truthfully satisfy it. MAIN must version/extend the workbench read contract with explicit `origin=created`, nullable migration/source lineage and frame_count=0 for empty draft, preserving old migrated payload compatibility. Empty strings/dummy migration IDs/padding a frame are not fixes. |
| Supervisor `targetRootOf`, `src/host/server.ts:620` | Still calls resolveActivated. Replace created-path lookup with proven resolveNative root. Reuse supervisor probe/ensure and pinned startStudio; do not launch a second Studio frontend. |
| `OpenFilmStudioSupervisor.ensure/#openInStudio`, `src/host/m5/openfilm-studio-supervisor.ts:184,:252` | Opens server-resolved root using upstream server-side launch key and `{path,create:false}`; actual Studio project ID returned differs from Narralens ID. Retain/prove that mapping server-side; `?target=` is display addressing, not ownership authority. No path/key reaches browser. |
| `GatewayApiClient` / Gateway service port | Existing native panel calls `/narralens/api/*` and `/narralens/native/*`, with Gateway cookie, no Host bearer. Gateway `#narralensOperation` (`gateway.ts:495`) accepts caller project_id query then invokes same-process services. `StudioServices.call` has no authenticated principal/session argument; created reads/decisions need that precise identity/scope connection. |
| Host `#studioOperation`, `src/host/server.ts:1327` | In A application mode allows only workbench/inventory/materialization.read/history.read; legacy mutators are refused. Keep that refusal. New A run/review calls must pass the new controlled application/gates with authenticated principal and exact DTO, not reopen old replay/materialize/native write bypass. |
| Root `src/app/director/NarralensApp.tsx:28` | Still starts legacy API and fetches fixed d1-30s. Workbench entry session exchange does not change that project binding. Root may become a thin owned-project entry/open action; actual editing remains the existing native page/M5 panel. |
| `src/app/m5/panel.tsx:15`, `M5Panel.tsx:154` | Existing injected bundle/mount and one SelectionStore/WorkbenchStore/PlaybackClock. Integrate observation/system/review here by callbacks/adapters; do not instantiate their own selection, clock, media editor or app root. |
| `ProjectContextService` / `NativeContextPort`, `src/host/agent-driven/project-context-service.ts:9` | Exact injection seam already exists: selection+selection_version, ack+sync, active_bridge_session_id. Current missing producer truthfully yields null/unknown. Native generation/project/snapshot/revision/source/selection consistency is already compared on context reads; supply real bridge facts rather than filling Host current values into ack. |

## Minimal production call sequence

1. **Host-side owned-project open operation.** Existing workbench-session exchange authenticates operator transport; resolve selected project ID from a real create result/context/link, validate syntax, assert current principal ownership with CreativeProjectAuthority, prove `resolveNative`, source projection and committed snapshot facts. Opening reads/starts owned native UI only; it is not a content decision, run grant or adoption approval.
2. **Open native source through existing Supervisor.** `ensure(projectId,correlationId)` probes pinned Studio, resolves the owned source root, opens it via server-side upstream key and `create:false`. Bind returned native Studio project ID to Narralens project ID, principal/session, Host instance generation and actual committed snapshot/source; never let query `target` rebind that mapping.
3. **Delegate browser transport deliberately.** Host UI's cookie/proof belongs to Host origin; native Gateway is another port. Reuse a narrowly scoped, one-use server-issued handoff (or an equivalently authenticated typed server binding) for that principal/project/generation into the existing Gateway editor session. Do not put operator/driver bearer, Host browser proof or absolute root in URL/query/film source. Browser fragment ticket is transport only and cleared before page scripts use it. This is a required cross-origin identity seam, not a reason to duplicate the existing workbench-session security implementation.
4. **Return/open the real top-level Gateway URL.** Existing classic studio-host bridge must run before deferred Studio modules, then existing `panel.js` mounts the panel into the native document. Keep actual native project ID and selected Narralens project identity explicit. Do not iframe the editor or copy its timeline into Host Root.
5. **Created workbench projection.** Resolve and inspect the exact committed created source; project tracks/clips/frame_count from actual engine projection, asset inventory from LocalAssetRegistry, history from the real committed history/store, and source lineage from creation origin. Empty source gives real frame_count=0 and empty clips/tracks; controls requiring selected clips stay unavailable. No fake legacy comparison/source ID or positive-frame placeholder. Preview URL comes from actual Supervisor/Gateway opening. Add an explicit created workbench read shape and validator branch, not a type assertion around old migration payload.
6. **Mount R4 additions on that original page.** `WorkflowTopBar` consumes actual Workflow, observedAt/connection and onLocate; before a Run exists, show explicit no-run/definition-empty state, not fabricated running attempts or completion. `SystemControlPanel` consumes real HealthRead/nowMs/read-only check callbacks; defaults closed, uses nonmodal layout with no overlay/focus trap. `NativeSyncIndicator` reads the same Context and stays unknown/pending without matched ack. `CreativeReviewPanel` consumes the real ReviewPackage and delegates onOpenPart to the original player/selection/clock; close is read-only. It owns no player or timeline.
7. **Genuine native acknowledgement producer.** Bind an authenticated `native_bridge` session to the actual opened editor, project/native-ID/Host-generation and request epoch. Persist actual monotonically ordered loaded observations and selection versions; validate frozen NativeAck input on the native-only route. Context compares that observation against committed facts. Initial open or commit only changes expectation to pending/unknown. Do not treat supervisor ensure, fetched film, job succeeded, panel mounted, selection event or commit response as a loaded acknowledgement.
8. **Next business continuation (still required for A, not collapsed into the empty editor result):** real Script/Storyboard and confirmed Brief carrier → fixed RunPrepare with MAIN actual catalog/facts → trusted scope authorization → guarded durable attempts and actual local assembly/candidate producer → sample/first-chapter/chapter bundle review → finite approved Coordinator adoption → real native reload/ack → committed snapshot render/QC/delivery → reopen and same-source download. Only register those application handlers once the actual producers and every side-effect gate are wired.

## Native version observation is a real remaining seam

The pinned upstream `StudioHost` interface exposes selection and commands but **no loaded-revision callback**: `Narralens-openfilm-m1b/vendor/openfilm/packages/openfilm/studio/ui/src/lib/host.ts:256` defines StudioSelection as `{projectId,time,refs,range?,stage?}`. `ProjectView.tsx:1179` emits this on selection/time dependencies, with no `loaded.rev` or document/hash binding. The private React state `loaded`/`loaded.rev` is visible in source (`ProjectView.tsx:188,:232`) but not an approved public native bridge contract.

Therefore `onSelection` plus Host current revision cannot truthfully manufacture `NativeAck.loaded_project_revision/snapshot/source`. Nor does intercepting a GET response prove the editor loaded that exact document; a newer response can race an old render. MAIN needs a precise versioned trusted native loaded-document observation seam (approved upstream/host bridge extension or another proven native observation), and must preserve pinned-source integrity/change policy while doing it. Until that seam exists, a real empty Studio may open and native selection work, but `native_sync` remains unknown/pending and A's native loaded gate is not signed. Same clip IDs across revisions are not revision proof.

## Origin/isolation invariants for this integration

- Keep editor Gateway, film Gateway and Host origins distinct as currently designed. Film JS is untrusted author content; it must not become same-origin with the panel, its sessionStorage proof or controlled API. Existing film read-only proxy/CSP/CORS one-way grant (`gateway.ts:238`) should survive created support.
- Cookies are host/path scoped, not port-scoped. Merely using another localhost port does not make a cookie a project/principal authority. Preserve Host origin-scoped browser proof and give Gateway its own narrowly bound authenticated transport; don't rely on film being unable to read HttpOnly cookies as the whole defense.
- Gateway currently issues a cookie from its editor-page path and tracks cookie strings, not owner/project grants (`gateway.ts:369`). Do not automatically promote that old cookie to trusted UI authorization for created project reads/review/apply. Query/body project IDs must match server binding and current authorized principal on every call.
- A same-process `services.call` is not automatically authorized: explicitly carry the verified session/principal/project scope and purpose into MAIN dispatcher/authority checks. Don't create an arbitrary URL proxy to `/api/agent/v1`, accept actor/channel fields from the panel body, or enable CORS from film to Host/Gateway control APIs.
- Native observations may locate/play/select only. They cannot accept review, authorize a run or approve adoption. Distinguish the actual native editor window/session from film iframe/postMessage source and stale opened projects; isolate result epochs. Opening/closing any R4 panel does not pause, cancel or approve work.

## Reuse directly / remaining producers

- Reuse `ProjectResolver.resolveNative`, created source facts + `CommittedSnapshotAuthority`, LocalAssetRegistry, existing pinned Studio probe/start/open lifecycle and Gateway film isolation.
- Reuse `panel.tsx` injection and M5Panel stores/SelectionCoordinator, `narralens:studio-selection`, and `narralensStudio.command(select-clip/seek/show-range/show-file)` for observation/review location. Route every new part callback to those existing objects; no second clock.
- Reuse PRODUCT `FixedWorkflowService` only after MAIN supplies actual ProductFactPort/adoption authority. It records domain run/review facts; changing a run's state is not execution dispatch. `guardExecution` + durable attempt binding must sit inside MAIN actual dispatch/apply boundary.
- Current M5 replay UI asks for recorded D4.1 comparison and its materialization bindings (`M5Panel.tsx:733`), so it cannot be the sole new-created assembly producer. Existing NativePlanBuilder can reuse bound segment math, but the full legacy materialization/adoption path must be checked for migration/native-plan assumptions; never substitute the d1-30s fixture for the requested 60–180s film.
- Actual A `TaskPrepare.assemble_draft` producer and created-source commit/adopt continuation, review-package publication from real outputs, `editor.native.ack` producer, and Media render/delivery dispatch are still missing from current CreationApplication. Missing handlers stay unavailable; no fake JobReceipt/complete node/ready delivery. UI component presence does not register those capabilities.

## Direct next MAIN implementation order

1. Explicit created workbench read-contract branch + WorkbenchService resolveNative + Supervisor created targetRoot + genuine empty-native open.
2. Bind existing trusted operator/project context into Gateway typed services while preserving film isolation; legacy A-mode write refusal remains.
3. Mount existing observation/system components in original panel bundle and carry same stores/clock; real context/health/no-run/unconfirmed behavior.
4. Implement/prove the native loaded-version observation and NativeContextPort/ack route; don't synthesize success while waiting.
5. Finish fixed Run/facts/grants + actual local assembly/attempt/review/Coordinator adoption + media delivery vertical using the same project/editor.

This sequence is a continuous implementation cut within authorized A, not a new phase gate, and does not shrink A's real-film/native-edit/reopen/dual-export acceptance.

## 2026-11-10 append — explicit created UI read contract / GET

只读规格核对，MAIN 当时 HEAD `452b4a2605381ef8d71de8cca1f539df2b2296e1`；不改 MAIN、不运行服务/测试。前文是旧观察时点，snapshot 派生 workspace 与 Supervisor 版本窗口已由 MAIN 后续实现，不能把前文缺口列表当当前逐项未实现。本节建议是独立 UI 读适配，**不是修改 CP-A0 的 31 个 registry routes**，不是新增 MCP 工具或 approval/ack 权限。

### 适用的批准语义与约束

- `cp-a0/01_PROTOCOL_AND_AUTH.md:19–21`：Context 与 native route 的 wire 以冻结 registry 为准；不能偷偷给原 route 增减字段或新 tool 别名。`src/contracts/agent-driven-types.ts:22` 的 Context 已有 `origin/project_revision/control_revision/snapshot_id/source_digest/selection_version/current_selection/active_run/native_ack/native_sync`，可原样复用它的含义，不能把 UI 新 GET 加入冻结 generated DTO。
- CP01:41 的 trusted_ui 是服务端 session + Origin + CSRF + project permission，native_bridge 是独立身份。CP01:51 创建返回真实 created origin/initial transaction/snapshot/source，new 不假造 migration，native_state 默认 unconfirmed、native_ack=null；CP01:57 仅实际桥匹配 loaded observation 才确认。CP02:28/30/64 与生产 Context/BootstrapResult/NativeAck DTO 一致。
- `cp-a0/03_EXECUTABLE_ACCEPTANCE.md:44,48,54,56`：created/migrated 分别重开且来源真实；Host commit 不推进 native loaded；read/health 不产生媒体执行。`implementation-design/07_EXPERIENCE_SPEC.md:22,61,75`：真实项目/审阅链接、打开关闭不改工程或重置播放、无新流程编辑器。`final-review/independent-design-review.md:22` 明确单 Host/DB/引擎/native timeline/selection/clock 与 Gateway 注入 bundle。
- 上述规格没有冻结专用 created-workbench URL 或完整 UI DTO。新增只读 UI facade 是 MAIN 常规集成工作；须自己 version/schema/validator/注册/入口 inventory，不用修改文档包 registry 或调用代码生成器。

### 最小 DTO：新 discriminator，保持既有 legacy wire 不变

建议新 UI 合同 `format: "narralens.created-workbench@1.0"`、`origin:"created"`，严格 additionalProperties=false；独立 runtime validator，不放松旧 `narralens.workbench@1.0`。不要对 created 值断言成旧 WorkbenchProjectionV1。

| 必需字段组 | 建议字段与真实来源 |
|---|---|
| 当前 committed 标识 | `project_id`, `revision`, `control_revision`, `active_snapshot_id`, `source_digest`；来自同一一致性边界的 resolveCreated/resolveNative 与 committed snapshot facts。沿用旧 M5 字段名可减少 UI 改动，但明确 revision 是影片 revision，不是 workflow plan_version |
| 创建来源 | `origin:"created"`, `source_project_id:null`, `migration_id:null`, `initial_transaction_id`, `initial_snapshot_id`；来自实际 cp_origin/creation store 的不可变初始事实。不能填当前 snapshot 到 initial 字段；不能给真实旧 migrated 工程补 created |
| 原生投影 | `engine:"openfilm"`, `engine_upstream_sha`, `fps:{num,den}`, `frame_count` 整数>=0, `tracks`, `clips`；inspect 当前 committed source/真实 projection并核 source_digest。空工程 tracks/clips=[]、frame_count=0，不padding。clip 的 source_shot_id/source_label 仅有真实可证 lineage 时填，否则 null，native clip id 不冒充 legacy shot id |
| 历史与锁 | `history`, `active_locks`；当前项目真实 HistoryStore/LockService。created 合同 history.kind 允许 `creation`（其 transaction_id 为真实初始事务）；其余仅映射实际业务种类。若 HistoryStore尚不提供该entry，可以history=[]并由独立creation来源字段完整呈现初始事实，不能造 migration history。不要把未知kind转换成adoption |
| 能力与旁白 | `capabilities:[{entry_id,state,reason}]`, `narration:"present"|"absent"|"unknown"`；只声明当前已注册可用入口，UI supported 不授写权限；旁白来自当前真实source/asset关联，draft未选择为absent，证据不足unknown，不凭Brief字段非空就认定实际媒体存在 |
| 编辑入口 | `preview:null | {kind:"openfilm-studio",url,bridge_version:1}`；只引用已授权 open 得到、当前仍有效的 session/window/generation描述，未打开或窗口过期为null。这个描述表示可打开/定位的入口，不表示loaded/ack |

最小读 DTO 不必重复整份 Run/Workflow/Review/Health/Delivery；已有 CP read handlers按原合同读取，未注册显示不可用/暂无，而非伪空成功。native 状态优先用原 Context：native_ack=null、native_sync=unknown/pending直到真实观察；若需要在 UI DTO 附带它，只能将真实 Context 的同语义字段显式列入新 UI schema，并在同一读快照/版本键下生成。不要将互不一致的多次读取拼接后声称同一 snapshot。Context与projection版本不一致时重新取读/显示stale，不能用projection覆盖Context ack。

不下发 absolute path、authorroot/workspace目录、原始source bytes、operator/driver bearer、launch key、DB信息、principal UUID、内部adapter类名。`preview.url` 仅允许受管本地Gateway地址/允许路由；URL本身不是授权，不接受客户端任意upstream地址。

### 新 GET 与旧 M5 的最小兼容接法

建议独立路径示例 `GET /api/ui/v1/projects/:projectId/created-workbench`（这是建议，不声称已注册或规格指定）；只读、owner校验、严格项目ID。旧 `/api/migration/v1/projects/:id/workbench`、旧schema/返回format和legacy测试保持原义。created请求落到旧迁移route仍应明确拒绝，不能尝试legacy catalog fallback。

新 GET 的应用服务只组合已有事实，不调用 `Supervisor.ensure/start/open`、不生成project/native workspace、不启动worker/render、不登记ack/approval。旧 `WorkbenchService.workbench()` 在 `src/host/m5/workbench-service.ts:114` 之后包含 `supervisor.ensure`，因此不能直接复用整个旧方法来实现“纯读 created GET”。复用其中的投影整理与public lock/helper即可。workspace/open的准备工作沿MAIN现有明确受控入口做；新GET读取已完成状态，未打开给 preview=null。纯GET必要的鉴权/审计/session检查不被这里误解成业务生成。

旧 M5 兼容应是客户端 `LegacyWorkbench | CreatedWorkbench` discriminated union；api client新增明确created读方法或依据服务端可信origin选择，不能使用 `404→另一个route` 的静默fallback。M5投影/SelectionCoordinator可复用共享小接口（project/revision/control/source/snapshot/fps/frame/tracks/clips），由一个纯normalizer将union映射至UI视图；迁移专属按钮仅legacy branch显示，不能给created塞假的非空字段满足旧类型。

`src/app/m5/M5Panel.tsx:154–157` 原SelectionStore/WorkbenchStore/PlaybackClock/SelectionCoordinator保留；`:206–224` 的load增加union归一化与项目切换旧请求失效处理。空工程不选择first clip、不构造非法 start=end 的Selection（冻结Selection仍要求真实范围），可显示空选择/无镜头；clock保持frame0，换fps更新既有clock，不新增另一个播放头。`source_shot_id=null` 不代表“不能选原生clip”，只表示没有legacy lineage。

旧 M5 replay/materialization/inventory调用含迁移假设，created分支只呈现已注册的新业务能力，不能为了按钮可点重开旧mutator。顶Bar、非模态System、Review部件可接原panel同stores/clock，原无run时明确未开始，native无ack保持未确认。

### 原生 delegate 必须先于哪里成立

1. **Host自己的created GET**：已有受信 operator UI/允许的 read principal + owner校验即可，不要求先打开native，也不要求有NativeAck。读取不授予trusted UI批准、native身份或run grant。
2. **准备隔离 workspace / Supervisor open**：服务端验证principal拥有目标created项目、snapshot/source currentness、允许本机owned runtime；目标root只能服务器解析。委托的nativeID必须来自这次真实open结果，不能从query target或film自报猜测。
3. **Gateway panel读取项目资料之前**：先完成Host→Gateway的受限session delegation，绑定principal/Host instance generation/project/native Studio project id/workspace generation/有效期与用途。旧gateway自动cookie只证明浏览器持有gateway session，不证明创建项目owner；服务call必须携带已验证principal/project context，body/query仅作匹配。没有delegate的gateway可显示受限入口/认证提示，不能泄露created read DTO。
4. **Gateway native API/文件/command转发之前**：同一delegate还需命中实际nativeID/window。最迟必须在任何项目文件、edit、history、provider、folder路由触达上游之前校验；不能只保护`/narralens/api/workbench`却允许原生`/api/projects/:id`任意枚举。具体session安全预审仍归MAIN安排的独立审查，不在此重签。
5. **native observation/ack之前**：另外成立native_bridge purpose/session，匹配当前generation/loaded bytes证据。普通trusted_ui不能自行扮native_bridge；GET、preview descriptor、Supervisor opened窗口或panel mounted均不能当ack。即使delegate正确，实际文档观察未完成仍是unconfirmed。见008报告的真实loaded接缝。
6. **review/run/adopt写之前**：另走冻结trusted UI确认/有限authority/Coordinator，不继承上述read/open/native delegate的写批准。GET不能顺便默认接受/消费gate。

规格允许直接完成上述读合同与兼容适配；没有新的大阶段人工审批需求。新增route应进入生产入口inventory并保留401/403/404、跨项目/generation、无delegate、纯读无side effect、空工程、legacy兼容的成功与拒绝对照；本次仅报告观察点，全部未执行。
