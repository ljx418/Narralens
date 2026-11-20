# Managed native document observation：独立只读预审

日期2026-11-10；a_media_independent_review未参与该4文件候选。范围为PRODUCT product-workbench/docs/parallel/lane-product/requests/010-managed-native-observation候选及固定vendor e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3。没有改PRODUCT/MAIN/vendor，没有运行测试、构建、浏览器、Host或其他服务；只读代码/摘要/归档成员，在本review目录落证据。

**结论REVIEW_PENDING / NEEDS_WORK：1项已反馈的P2 request-epoch缺口，MAIN已交PRODUCT修。** 其余已读同步dirty、hash late检查、StrictMode/unmount及实际DOM入口没有新增已证实P0/P1/P2。本报告绑定下述旧patch，后续修复需重建、重hash与浏览器验证，不能沿用旧dist宣称修复已构建。

## 输入与产物绑定

原候选patch SHA256 `71135c54f97672d698e9d24741b67f7e98fca4900757b7484ec9d324a06c867a`。独立重算与source-manifest一致；4个vendor原文件prehash及4个私有候选posthash均一致。10个实际dist文件与build manifest字节数/SHA一致；tar.gz的10个成员全regular、安全相对路径，无额外条目，成员逐项bytes/SHA与dist manifest一致，archive SHA与声明一致。仅读tar未解压/执行。细项见evidence-check.json和inputs副本。

原use-film post SHA `b68d40c3630c41ffa2339bdcc70ec0e478fc4e06d62ef1109ebee814d0f0fc95`，ProjectView post SHA `0344b39cbad1356651b31a8ac72d881cfbf2e92ecbd4fce8a8057f5747a92d70`。已读ui-checks.json记录PRODUCT原依赖离线tsc/build退出0，**不是本审查者重跑**；Browser/Host实际native DOM-loaded仍NOT_RUN。

## MN-R1 · P2 · 旧HTTP读可在新dirty/replaced失效之后重新铸更大epoch的证据

定位（候选私有树）：editor/use-film.ts:112-127 fromServer在发GET前invalidate refresh，但await api.film后无请求启动时的epoch/token比较，直接serverDocument；:54-58只看mounted/pending/text，在响应返回时铸新的epoch。:130-136 SSE只执行queue.current.then(fromServer)，没有把这些读取互相串进queue，所以可有多个并发读；本地edit的queue也不能撤销已经在途的旧读。

确定复现调度建议（**本次未执行**）：

1. 以已加载A开始，触发刷新/film SSE，挂起GET A的返回。
2. 本地dirty编辑B并让实际edit响应完成（pending回0），或完成较新的refresh B；相应B evidence可真实DOM commit。
3. 最后放回先发的A。现候选会让旧A走serverDocument，取比dirty/replaced/B更大的epoch。React随后实际渲染旧A，layout hash也能通过，从而发一个“更年轻”的A committed事件。

该事件确实对应此时被旧reducer响应改回的DOM A，**不是伪造DOM B或GET直接当ack**。缺口是：已被后续dirty/replaced输入淘汰的请求，仍能重新获得current观察资格。MAIN若只按更大epoch处理会把被淘汰请求当新鲜结果；MAIN最终snapshot/workspace绑定仍必须独立防御。

建议仅给观察元数据加request-start epoch/request-id fence：响应不属于当前读/操作代次时不授document evidence；原native reducer/UI写路径可保持原样，不能为修观察另造文档状态机。多个refresh和edit响应都应验证“这份server text来自仍有效的请求代次”，不能只在异步SHA完成时看新铸的evidence指针。MAIN已接受该具体P2并交PRODUCT修；本报告仍绑定修前71135 patch。

## 其他逐转换判断

- dirty在applyOps成功后、ref/setState/preview更新前同步invalidate；pending ref在请求串行队列中增减，未全settle不授proof。失败时清document，brokenRev阻止继续授权，refresh有失效事件。没有把settled()/selection直接转成ack。
- 成功edit的rebase分支使用实际done.value与done.text；非rebase/相等分支必须done.doc、done.value、pending0、JSON相等才可授proof，并以rendered here.value指针绑定，不能只改rev沿用旧text。并发setState若value指针不一致则document=null，isDocumentCurrent进一步拒绝。
- evidence不是第二个reducer：放在同useFilm state及ref上。ProjectView真正workspace-shell绑定ref，useLayoutEffect在真实commit后hash确切server text；late hash须同evidence token、value/rev、mounted、pending0、非broken、同root且root仍connected。dirty先清obs token可挡React尚未commit前完成的旧hash；layout cleanup取消旧hash回调。
- full UTF8 SHA256与16hex native rev prefix一致才发document_dom_committed；大小为TextEncoder实际bytes。不能凭native16hex rev单独当full-source身份。Host需以期望原始文档hash匹配，并另验source closure，尤其非法UTF8/字幕/assets不由该事件证明。
- StrictMode cleanup先发unmounted失效，再mounted=false；setup只从同一coherent value/rev/text、无pending/broken的旧document更新新token。实际App key={id}与随机editor_view_id隔离项目view；真正unmount后的old hash因cancel/root disconnected/mounted被挡。没有看到当前正常key切换可把旧项目hash冒充新项目的路径。尚无浏览器实证，不给“所有并发React/StrictMode矩阵通过”结论。
- optional observer同步throw被捕获，不破坏native编辑；它丢失了通知时MAIN必须依赖可信桥生命周期/超时清unknown，不能假设callback一定交付。异步Promise回调不属于此void合同的保证范围。
- media-queue只在image入口归一化URL，缓存key/ready/返回DOM URL保持同一scoped形式，无Host扩展时identity。Main helper必须在bundle前安装且对已scoped URL幂等；不能把此只读URL改写当新grant/许可。候选api.ts未改。

## 浏览器与MAIN接线必要限制

尚需初始空/非空document、缺失/不匹配hash、dirty/pending/rebase、重叠GET与晚hash、broken恢复、undo/redo、外部文件历史、快速导航、StrictMode/真正unmount、observer throw等真实浏览器用例。源码与tsc/build不替代这些。

document_dom_committed只证明film文档对应原生DOM状态；不证明preview媒体已解码、字幕/settings/assets closure已加载、首帧/声音可用。trusted bridge的event.source/origin/session、workspace owner/project、期望immutable snapshot与Host revision、严格epoch去重、最终CP NativeAck映射仍由MAIN完成。没有这些不能把任意window callback或selection/GET响应包装成NativeAck。

新patch若修request epoch，须更新4文件posthash、patch/preparation/build manifest与实际dist；旧archive只能证明修前候选。生产managed editorDir仅从验证的immutable composite artifact装配，不信浏览器传任意路径。当前未接managed producer/NativeAck，不签A05/A整体。

## MN-R1 P2修后固定候选只读复核

绑定patch `214c629238c2635f5c6212e5e9207eab18f61d17454c08ee64ccd32be41dffa6`，固定upstream `e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3`。use-film.ts postimage `9361b5cbbe4dc11984ec5b05305ff1a823c0f432b6b62f7cb796f037475d7b48`；其余三文件postimage与修前相同。独立只读验证4组固定Git preimage/实际候选postimage SHA全部相符；patch精确匹配。输入副本及摘要见p2/evidence-check.json。没有应用patch、运行构建、测试或服务。

MN-R1标为 **SOURCE_FIXED**：use-film.ts:113-119在refresh失效后记录requestEpoch，响应后仅mounted且epoch未变化视为currentRequest；:127仅currentRequest可serverDocument。新编辑、刷新、replacement、unmount或新proof都会提升epoch，旧响应不能重新获得证明。旧响应仍按原native reducer替换UI；但:119先同步invalidate清当前evidence并向Host报告更大失效epoch，再在:127建立document:null，故不会留下B的ack而DOM已经回A。isDocumentCurrent(:260-261)同时要求token、实际value/rev、mounted和pending条件，已开始的旧hash也不能越过这一失效。

复核原复现时序：GET A等待→编辑/更新B并产生B proof→A返回；现在A先使B proof失效、随后只渲染无proof的A，不能发A的document_dom_committed。两GET重叠若旧请求先返回，其失效会同时使较新请求保守失效，后者也无proof；这是unknown而非错误确认，需要后续新read/有效编辑恢复。未将此保守失效写成新的重大缺陷，也不承诺所有乱序响应后自动立即恢复confirmed。

本次差异仅上述五行代次检查和serverDocument条件，原reducer/UI写路径不变；未确认新P0/P1/P2。PRODUCT p2/ui-checks记录原依赖tsc/build exit0；独立只读核10个当前实际dist文件匹配p2/build-manifest，但未独立重跑。旧71135候选证据继续留存，README旧final build文字和source-manifest的准备期NOT_RUN状态不用于替代p2记录。

结论仅MN-R1源码修复成立；真实浏览器并发/StrictMode/native DOM与Host NativeAck仍NOT_RUN于本审查者，生产桥、workspace期望snapshot及最终NativeAck映射不在此patch证明内。不签A05/A整体。
