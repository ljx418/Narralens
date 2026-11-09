# 009 — created UI read 源码只读预审

2026-11-10，Codex PRODUCT，只读 MAIN 工作中源码；读取尾部 HEAD `8638ee182fd53251b6461904016ddce62b9bc4eb`，未冻结dirty源码，不冒充该commit包含所有被读文件。未修改MAIN/vendor，未安装/构建/运行测试/启动服务；MAIN session55093的类型/测试结果由MAIN自己保留，本记录不重复签测。

结论：**当前真实零帧created GET未发现规格或安全阻断，可继续已授权生产接线。** 这是窄范围源码预审，不是A05/整轮PASS或Gateway delegate安全审查。

读取范围：`contracts/created-workbench.schema.json`、`src/contracts/created-workbench.ts`、`src/host/agent-driven/created-workbench-{http,service}.ts`、CreationApplication装配、`tests/agent-driven/integration/created-workbench-read.test.ts`；关联核对 ScopedAgentAuth、ProjectCreationStore、RevisionStore、ActivatedProjectionService、OpenFilmEngineAdapter。

## 核对结果

- 独立 format `narralens.created-workbench@1.0`、origin=created、null migration/source lineage、frame_count>=0，旧migration与CP31 wire不改；严格validator拒绝假migration、loaded、preview对象、路径额外字段。合法零帧可仍有真实空tracks，不应强制tracks=[]。当前测试期望真实track_0/track_1均clip_ids=[]符合事实。
- 创建历史是实际journal种类，不是产品文案。ProjectCreationStore:124真实以kind=snapshot_publish/base_revision=0建立创建事务，:281 BootstrapResult初始revision=1。service:33映射已committed记录至base+1，当前创建history的snapshot_publish/revision1/transaction/snapshot均真实；**无需另造creation kind或migration历史**。007里creation kind是建议的可选UI表示，不是冻结合同要求。未来若新增不推进影片revision的committed transaction种类，应按其真实receipt revision映射，不能一律base+1；当前已读创建路径未发现该反例。
- service:18–28前后owner校验、resolveCreated、真实inspect并比较engine/pin/source/fps/frame_count，await之后同步重核active commit/control/recovery gate，拒绝半工程/漂移/在读期间移动的facts。随后同步构造history/locks并validate，没有在该段再await暴露读混合窗口。
- service没有Supervisor.ensure/start/open/nativeWorkspace calls。layoutFor只重建cache与注册可重建layout（ActivatedProjectionService:100起），不是生成资产/写revision/启动native；不能因内存memo变化把纯读认定为生产写。测试源码包含事务/outbox/authorbytes不变与nativeworkspace/runtime根不存在的断言；本agent没有执行它。
- HTTP层先验Host/duplicate Host、再ScopedAgentAuth trusted_ui/CSRF proof，然后匹配项目route/GET/无query/body，service做owner；返回前重验同一credential/principal/session。ScopedAgentAuth:47–79校验重复敏感header、same-origin/referrer、cookie/通道、proof hash、revocation/expiry。没有将原Gateway匿名cookie直接升格成UI授权。
- CreationApplication.handleWorkbenchSession先处理session入口，再显式交created-workbench HTTP；created service close随应用关闭。此GET不是MCP route，不新增native身份、不授予执行或采用权限。
- preview=null、native_sync=unknown符合CP01:51/57与CP02:64的“没有实际native producer/ack就未确认”。CP Context仍unknown/null是正确保守事实。即便Supervisor已有窗口，此DTO仍可不承诺已打开/已loaded；后续接真实producer需显式版本演进schema，不能绕过当前const。

## 非阻断但真实的后续语义问题

`created-workbench-service.ts:36` 用 `projection.clips.some(c => c.kind==='sound')` 判narration=present；而 `src/adapters/openfilm/openfilm-engine-adapter.ts:139–145` 仅按源文件扩展名将音频分为sound，未区分旁白/音乐/效果。**具体反例：工程仅含授权背景音乐时会错误显示“旁白present”。** 当前零帧工程无sound→absent正确，不阻止空created读链与后续已授权工作。首个实际有声工程接线时应读取真实narration asset/track角色关联；证据不足则unknown，不用“有音频”等同旁白。配套保留音乐-only与真实旁白的正负对照，不能只改空fixture。

schema history maxItems=256，而service未分页/截断；超过256个committed事务会validation失败。这是较长编辑历史的可用性边界，不是当前短片/零帧安全阻断。扩展历史显示时应明确窗口/分页语义，不能无说明丢记录。本次未要求打断MAIN当前检查。

## 当前证据边界

已读测试源码覆盖真实HTTP创建→零帧GET、匿名/driver/cookie-only/跨Origin/foreign owner拒绝、source drift拒绝、service关闭、schema伪字段拒绝、读完后credential撤销不泄露projection。未在本次执行，不把测试存在写成通过。后续native Gateway delegate、实际原生loaded观察、M5 union挂载、Run/assembly/Review/Delivery等仍按A目标继续；本预审没有新增人工模块门。
