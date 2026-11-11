# CR-R1-001：R1生产者/消费者与可信UI接缝锁定

状态：MAIN_SELECTED_FOR_BOUNDED_INTERFACE_CHECK。仅补齐已批准A体验的具体接口，尚非产品实现/验收；不修改已封存relaunch包、CP-A0四文件/80defs/31 Host路由或旧Gate。凭据处置与writer交接门保留。

## 1. 事实与决定

PRODUCT I1：当前Studio Gateway在created模式仅readWorkbench，Host trusted_ui proof按origin/端口隔离。决定保留原Studio/M5注入，不另做Host父页面、第二编辑器或任意CORS；由Host在真实trusted_ui native-open成功后附带独立目的的UI delegate，Gateway只承载同一Host应用服务的闭集调用。Native bridge cookie/proof/read_token本身永远无UI批准权限。

该决定显式增加2条Gateway别名HTTP：POST /narralens/api/ui/call、GET /narralens/api/ui/review-media/:ref。既有/narralens/session/exchange响应可增加可选ui字段（独立format/csrf/expiry）；不增加兑换路径，不改NativeEntry的Host响应DTO。原31 Host + 原附属5 Host + 新2 Gateway分别计数；不得声称总暴露面仍只有31+5。目标运行时registry contracts/agent-workbench-ui-v1.registry.json由BRIDGE唯一编制，Gateway负向fitness覆盖每条别名。属于同目的传输适配，不增加新的业务写操作。

## 2. 独立UI delegate（Host-only，不能从请求JSON构造）

NativeStudioGrant可选只读ui字段类型NativeStudioUiGrantV1，由controlled-studio-access.ts导出类型。实际值只能由CreationApplication已认证trusted_ui分支创建：捕获真实AgentPrincipal、project_id、owner_session_ref、instance_generation、expires_at、isCurrent、invoke与openReviewMedia闭包。isCurrent每次查询真实parent会话活性/owner/generation；不能接受body actor/Boolean授权、driver或native_bridge构造。invoke/open均重验同project owner，不把Gateway传来的主体当可信来源。

UI有效期不超过parent且至多8h；与native view的revision/snapshot有效性分开：commit后原native会话按旧规则stale，UI仍可读新Context与显示未加载，不能继续原生写。需要重开native view由受控UI命令调用原native-open服务重新取得真实入口，不把旧native session强行改为current。

兑换原one-use native ticket时，只有确有上述UI grant才签发独立随机UI cookie与UI CSRF proof，ui格式narralens.gateway-ui-session@1；没有ui字段的原native入口仍只能读native。分别保存map/expiry/撤销身份，UI鉴权不从native proof派生，也不因旧native revision stale而误清除仍有效parent UI权限。cookie唯一名称、HttpOnly/SameSite，proof仅该origin/tab会话；凭据不入URL/query/log/Ref/素材目录。Native cookie、native_read、Host/MCP bearer、另一个project/port/generation都不能替代UI cookie+X-Narralens-Workbench-CSRF。无需复制、转发或暴露Host cookie/CSRF/operator secret。

Gateway UI边界先验Host/Origin、重复头、独立cookie/proof、parent活性，再查资源。跨域/Authorization头拒绝，不开放CORS。每次调用及异步返回前复核；关闭清空delegate。原native写入口/strict409/七方法EnginePort不变。

## 3. 闭集UI调用合同

RPC envelope严格只有surface/operation/input三字段。surface只能agent.v1、local-assets.v1或workbench.v1；允许组合由本包contracts/gateway-ui.registry.json列明，未知组合拒绝。input是对应原始DTO或附属读取输入，不丢弃未知字段再校验；复用原request+response validator、同owner/Run/base/锁/批准等应用服务，不能invoke绕过原DTO校验。call返回原status/body及原错误语义，缺生产handler503，不伪造available。

workbench.v1只允许native.reopen，input严格为空对象，project由delegate固定；BRIDGE将现有native-open服务提取成同一内部方法供旧Host入口和此调用复用，返回原NativeEntry验证结果，不新增Host路由、不授予原生写权限。它只是为当前项目重取真实视图入口，不修改author/版本。

新增Host-only NativeStudioUiGrantV1.invoke({surface,operation,input,correlation_id}) => Promise<{status:number,body:unknown}>；所有project字段必须与delegate固定project一致，非project的health请求只读。由BRIDGE CreationApplication创建该闭包并调用同实例dispatcher/素材服务，不用HTTP回环转发秘密。Gateway负责传输验证，BRIDGE服务负责业务权威。

UI client仍在原M5，增加独立UI proof头而非修改workbench-session的Host proof。原CONTROLLED_NATIVE_TRANSPORT_SCRIPT可保留native自动头，新的UI边界要求独立UI头与cookie；同时出现native头不表示拥有UI权力。新ui字段runtime验证失败则显示入口未就绪，不能退回用native proof授权。

## 4. PRODUCT I2：复用原M5预览区域

onOpenPart只接受当前真实ReviewPackage中已验证的part Ref，先经独立UI fetch到上述鉴权媒体读别名；不把相对路径、file URL或native_read交给播放器。复用M5Panel现有proxyRefs/视频预览区域的单活动槽，created模式显示清晰“准备预览，尚未采用”；不是新增timeline、编辑器或在CreativeReviewPanel自己创建播放器。VTT/JSON在既有content-views逐项安全展示，HTML/脚本拒绝。

共用现有PlaybackClock，在review模式只驱动该预览槽，不向原生author选区发送seek/select；进入前保留已观测native frame，并通过固定上游已有seek命令（该命令会pause）停在同一观测位置，不捏造不存在的pause命令。退出或操作原生时间线即停止/revoke预览，回到native模式；原snapshot/选区已变则保持未确认，不伪造恢复或自动播放。只有一个活动音频焦点。预览receipt的真实fps必须与该项目clock配置匹配，不能猜测帧率；不匹配明确拒绝并保持原clock。无真实Ref/读取失败就显示具体不可用，不用committed镜头冒充prepared。

Binary fetch可用Blob URL交既有video/audio呈现，abort/切换/unmount时精确释放对象URL和请求，不把Blob当已提交素材。UI总模式、单clock、原时间线仍可编辑及键盘/焦点必须真实Headless联调，组件mock仅组件证据。

## 5. MEDIA I1：目的分开的准备源证明

assembly-ports.ts定义CompletedPreparedSourceV1（Host-only）：真实TaskReservation、producer_attempt、原成功Job及SOURCE_ONLY/local.native-draft@1/stage/sourceDigest回执、PreparedTaskFact、Host解析root。BRIDGE从同库真实行构造/复验，不接受浏览器JSON；MEDIA不冒称自己拥有Job DB权威。

PreparedReadBindingV1包含purpose=impact|preview、project/run/execution、prepared_source_id/job/factDigest、base_revision/control_revision/source_digest/selection_version；不含虚构transaction/approval。新proveForRead(completed,binding,registryFacts):Promise<object>与assertCurrentForRead(completed,binding,proof,assertCurrentAuthorAndRights:()=>void):void只给读取/impact/preview。

PreparedAdoptionBindingV1在相同真实身份/基线之上，purpose=adoption且必须有transaction_id/impact_id/impact_hash/plan_sha256/approval_id/target_snapshot_id。proveForAdoption(completed,binding,registryFacts):Promise<object>及assertCurrentForAdoption(completed,binding,proof,assertCurrentAuthorAndRights):void只用于完整受控apply，不能在impact准备时伪造批准。成功Job无live lease，不能重新claim或借旧TaskLease proof。

两个proof由MEDIA弱映射区分purpose/完整binding并重开FD核真实闭包、固定parser/侧车/资产bytes/rights；不能把read proof传给adoption断言。BRIDGE在同一受控SQL边界复核真实Run/Job/Approval/impact/base/锁/许可并调用同步assert。异步前验不代替最终同步校验。release/close沿既有明确生命周期。真实未实现adoption caller只算R1端口证据，不能签R2通过。

## 6. MEDIA I2：预览receipt/FD reader

assembly-ports.ts导出PreparedPreviewRequestV1（completed + purpose preview readBinding + verified readProof + signal），PreparedPreviewReceiptV1和PreparedReviewMediaReader。PreviewPreparedSource只在独立副本调用既有NativeRenderer.render(NativeRenderRequest)，无SnapshotClosure伪装、正式Delivery或author写入。请求/结果独立域，与committed render receipt不混。

Receipt包含format、project/run/plan_version/step/execution_attempt、prepared_job_id/prepared_source_id、source_digest/plan_digest/rights_digest、producer attempt及五part实际产物描述（slot、opaque object_id、content_type、bytes、sha256），receipt_digest覆盖确定性canonical内容。slot仅preview/narration/subtitles/shot_summary/rights_quality；不放私有绝对路径或尚不存在的package hash，不让package哈希反向循环引用receipt。

BRIDGE在真实ReviewPackage建立时将receipt_digest/object_id与package id/version/hash/slot/input/output/quality/attempt绑定，按既有Ref权威/私有不可变事实登记；这个关联不能改MEDIA receipt。读前验证owner/当前package/part及登记，随后通过Host-only reader.open(receipt,object_id,{signal})取已验证FD：返回content_type/bytes/sha256、read({offset,length}):Promise<Uint8Array>、close():Promise<void>。offset/length安全整数/有界，单read最大1MiB；不接受path或URL，完整校验实际bytes/固定对象域/无symlink与当前登记，descriptor不作为业务状态。

BRIDGE stream负责每条响应成功/断开/取消/Range错误/抛错finally关闭reader；close幂等。MEDIA负责打开过程失败释放所有FD；不由GC兜底。Host与Gateway媒体别名复用同一authorised reader，Gateway先独立UI鉴权，native_bridge仍不能读该面。所有公开响应不暴露FD、路径、token或类名。

## 7. 具体所有权增量与验收

BRIDGE新增唯一文件contracts/agent-workbench-ui-v1.registry.json；仍独占CreationApplication/原应用服务/DTO验证与opaque Ref/媒体登记。PRODUCT本票追加openfilm-studio-gateway.ts（原03既定owner）、controlled-studio-access.ts、controlled-studio-browser.ts、tests/agent-driven/integration/created-native-ui-transport.test.ts；前三者仅传输/授权目的分隔，不能定义第二业务批准权威。MEDIA仍12文件，接口放assembly-ports/verifier/preview服务，不改其他owner或vendor。增量清单在ownership-delta.json，不改封存03。

新增必须会失败的用例：native-only/driver/错误origin/port/重复头/过期/撤销/异project UI调用拒绝且零业务副作用；同UI父会话在commit后可读新Context而native仍stale；原DTO未知字段拒绝；UI当前body不冒充actor；read proof不能用于apply；pre-impact无虚构批准且prepared文件/author/版本不变；错package/part/媒体hash/Range拒绝；完成/断流/取消均close；preview单clock/音频焦点与原timeline键盘保持。

实际实现、重型验证、独立产品审查均未运行。本补充需三个领域做有界接口事实核对，不重启整包设计外审；MAIN关闭具体反例后释放对应文件。Claude调用仍待实际凭据处置与writer交接，不能把本CR当已启动代码。

## 8. P-CR-01 / CR-R1-MEDIA-FPS 的最终字段闭合

PreparedPreviewReceiptV1顶层明确新增fps:{num,den}与frame_count，来源是已证native计划时间基，且必须与实际编码视频probe和完整decode帧数相符；不能只复制项目默认值/renderer请求参数。每个video产物描述另有media_facts:{kind:video,fps:{num,den},frame_count}，fps为实际成品ffprobe有理avg_frame_rate经正整数/gcd规范化，frame_count由实际count/decode确认。VFR、不可证、计划与实片不符不给成功receipt。两处fps/frame_count均进入receipt_digest。

audio产物media_facts为kind:audio/sample_rate/sample_count/channels，来自实际样本/完整decode，按已证顶层fps转换的长度必须符合对应旁白范围；不伪称音频有视频帧率。subtitles/shot_summary/rights_quality的media_facts.kind分别text/json，不能假造视频facts。reader.open的只读metadata增加相同media_facts与timeline:{fps,frame_count}，由固定receipt与已校验object hash绑定，不从HTTP参数决定。读取只查证固定对象，不重新编码/渲染。

沿已增加的唯一RPC别名新增一个闭集只读操作：surface=workbench.v1，operation=review.part.describe。input严格为{run_id,package_id,package_version,part_kind,artifact_ref}，ID/版本/5种part_kind及artifact_ref复用原Ref validator。project来自UI delegate，不许客户端加actor/project/path字段。BRIDGE先查同项目当前真实包，严格匹配part.kind与artifact_ref的id/version/sha256，再核不可变包→receipt/object关联；通过同一MEDIA reader.open取得受控metadata并finally close。

返回格式PreviewMediaDescriptorV1，字段严格为format=narralens.review-media-descriptor@1、project_id、run_id、package_id、package_version、package_digest、part（原ReviewPart完整值）、receipt_digest、object_id、content_type、bytes、sha256、timeline:{fps:{num,den},frame_count}、media_facts（上述判别联合）。package_digest来自真实包，sha256/bytes/content_type/object_id指当前part实际产物，receipt_digest绑定包括真实媒体探测在内的producer事实。无路径/凭据/FD。descriptor是同已准RPC的一个只读操作，不增加第三条Gateway HTTP，不改冻结ReviewPart。

PRODUCT先验证descriptor与当前project/run/package/part的全部Ref/版本/摘要，再要求video实际media_facts.fps与timeline.fps、该项目现有PlaybackClock配置精确有理相等，实际frame_count与该预览slot语义相符；narration以实际样本事实与timeline验证后共用同一clock。缺少或不符拒绝该预览并说明具体原因，不猜30/1、不改原clock/选区/工程。随后用part.download_ref读既定media别名；BRIDGE只有实际绑定的同一对象才返回二进制，响应ETag为带引号sha256，PRODUCT核与descriptor一致，二进制blob hash/bytes必要校验后才显示ready。未知/旧包/Ref或对象hash变动不得复用此前成功metadata。

必须负向：真实25fps视频对30/1项目/clock拒绝；伪报30但实际probe25不能发布receipt；媒体缺fps/帧数、错误package/part/receipt_digest、metadata到bytes间对象变化均拒绝；audio不按视频fps猜样本时长；所有metadata/binary打开成功和失败分支均关闭FD，preview失败不改变原clock/author/version。此项只补精确字段和同一路由读取，不更改其余已ACK语义。
