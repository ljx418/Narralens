# Native UI transport 精确实现支持（只读）

固定vendor根 `/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm`，实际HEAD `e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3`，tracked status空。18份原始vendor文件SHA见vendor-input-hashes.json。本人未改vendor/MAIN，未运行服务或测试；这是对MAIN受控Gateway方案的实现支持，不是新增独立外审门或A验收。

本清单穷举本固定web Studio入口`packages/openfilm/studio/ui/src`中的项目media/poster生成点及实际WS消费者；desktop shell/chat及*.test不属于这份Studio web bundle，不应为修该入口改桌面产品。

## 必须处理的非fetch资源URL

下表的components/、lib/、editor/与api.ts均缩写为`packages/openfilm/studio/ui/src/`下的精确路径，行号绑定上述HEAD。完整vendor绝对根见首段。

| 文件:行 | 实际生成/消费 | 处理含义 |
| --- | --- | --- |
| components/ProjectView.tsx:289–295 | mediaSources的poster/wave/pagePoster构造`/api/projects/:id/media?what=...`；file/pageSurface拼folder | API图片URL需readURL；film file由folder prefix覆盖 |
| components/ProjectView.tsx:1642–1644 | timeline frame构造器，含ms/w/v/clip | 需readURL，保留所有原query |
| components/ProjectView.tsx:1694 | raster clip poster URL | 需readURL |
| components/ProjectView.tsx:1702 | waveform URL，BlockWaveform经mediaFetch取JSON | fetch proof可覆盖；若统一readURL也须只读scope |
| lib/studio-refs.ts:27–28 | 集中frame media URL，供stillUrl:41–42、clipFrameUrl:49–58 | 一个helper覆盖截图/clipFrame生成 |
| components/ProjectsLibrary.tsx:34 | posterOf(project)；57/67写入library项目卡 | 一个构造点；library后台结果仍必须只当前project |
| components/ProjectHistoryControls.tsx:284 | 当前film poster直接传Thumb | 需readURL |
| lib/project-history.ts:159–160 | commitPoster历史封面，ProjectHistoryControls:461使用 | 需readURL；不能因此自动开放无producer历史路由 |
| components/ProjectHistoryControls.tsx:437 | Thumb直接`<img src={src}>` | 自定义header不可用，不能只patch fetch |
| lib/media-queue.ts:56–66 | mediaImage直接`new Image(); img.src=url` | fetch wrapper不生效，是重要集中消费点 |

`lib/media-queue.ts:83–90`的useMediaImage最终返回原URL用于实际渲染；`mediaImage`仅预加载boolean。若只在`img.src`临时换URL，实际`<img>`仍拿原URL、LOADED/WAITING key亦会不一致。因此优先在上述生成点统一包一个受控readURL helper；或在队列入口、cache key和returned URL全部一致正规化，并仍补直出Thumb等旁路。`lib/retry-image.ts:13–15`只添加retry query，保留已有capability URL即可，无需另发proof。

## 纯fetch点与最小薄patch建议

- `api.ts:56–65`集中call负责大多数JSON API；但不能只patch它。直接fetch还有ProjectView:273(media probe)、1824(projectApi/media probe)、lib/export-jobs.ts:99 probeFps、lib/use-fonts.ts:84 fonts以及多个history/files helper。
- `lib/media-queue.ts:41–42` mediaFetch是JSON/probe/wave的集中队列，底层仍fetch。
- 所以MAIN所述“只向同editor origin私有API加proof”的受控fetch wrapper可覆盖散落JSON请求，必须校origin/私有path，不能把proof附给film origin或外部source URL，也不能把存在fetch等同后端已允许。
- 对图片建议薄patch仅在managed源码副本引入一个identity-default的`nativeReadURL(raw)`，接入ProjectView各构造点、studio-refs、project-history、ProjectsLibrary与当前history poster。helper在非managed模式原样返回；managed时只处理同editor origin、当前nativeProject的明确media/poster路径，保留query，用URL API拼readtoken，遇别项目拒而非替换成当前项目。
- pinned vendor本体保持不写；薄patch必须有该HEAD/hash断言，不以模糊replace误改其他URL或运行原型。

## WebSocket集中点及全局漏口

`api.ts:144–160`是唯一浏览器WebSocket创建点：146拼`ws(s)://location.host/api/${path}`（watch时已有`?visible=`），160 `new WebSocket(url())`。浏览器不能像fetch设置任意proof header；可以受控URL capability/子协议，但后端必须独立校精确Origin、session、Host代次、当前native ID和只读权限。Token参数用URL.searchParams添加，不能在已有visible query后硬接第二个问号，也不应把secret参数透传上游/普通日志。

实际两个调用：

1. `api.ts:232`项目订阅`${p(id)}/events`。
2. `App.tsx:41`全局`listen('events',...watch:true)`，收到`type:'open'`直接`go(event.to)`。

固定upstream server.mjs:657–689的upgrade，仅证明全Studio launch key/cookie，不能证明MAIN project范围；672–679的/api/events是全editor流（接受visibility消息），681–685项目流按任意projectById订阅。普通origin+nativeID检查若只覆盖项目流，仍会漏全局open事件，可能把UI导航到另一工程。

A模式应拒绝全局流、仅代理受控过滤后的当前工程事件，或managed listen把global watcher映射为当前project流；原非managed入口保留。若保留global open事件，必须逐消息验证event.to的native ID并过滤别项目，不是仅握手时校一次nativeID。服务端route不得接受任意/api/projects/:other/events；WS数据除必要visibility/control-frame外不当写能力转发。

## film folder prefix：可以覆盖的实际路径

将项目JSON folder重写为`filmGatewayOrigin/s/<session-readtoken>/film/p/<upstreamHmac>/`，且保留末尾斜杠，可覆盖以下现有相对拼接，无需把Host proof送到film：

- `ProjectView.tsx:291/295`文件与页面surface；1340页面source fetch；1658 still thumbnail。
- `editor/Preview.tsx:274` iframe `${folder}film.html?...`；79/105的postMessage origin取folder.origin，仍对应filmGateway origin。
- `lib/font-menu.ts:225`本地@font-face path拼folder；226已有s.url仍需遵守实际闭包/CSP，不能当受控本地资源。
- `ProjectView.tsx:507`player以folder.origin载入；`src/timeline.mjs:517`发出的Sound.src是已解析URL.pathname，因此含/s/.../film/p/...；`editor/player.ts:117–122`再以film origin解析它并添加film-sound/v，scope前缀不会天然丢失。
- `src/host.mjs:43/71–84`和timeline:465的`__film`脚本/辅助调用是相对当前film URL，也保留prefix。frame-duration的`of` query另含src.pathname；如要代理此辅助功能，应单独验证并按当前capability转换，不盲目剥任意项目路径。上游host.mjs:141–147只把它当根内地址，不能把新prefix原样解释为另一个filesystem授权。

只重写folder不能修复`/api/projects/...`图片API。根绝对`/p/...`、CSS root URL、显式其他HMAC也不靠“相对资源大多正确”保证；film代理必须验证readtoken绑定当前HMAC/root。只剥/s/token前缀后放行任意/p/other，是明确跨project漏口。

## 其它需要保持关闭的跨project口

1. 项目列表：api.ts:85 GET /api/projects。即使图片URL全带token，返回全Studio项目仍泄其他id/name并支持Library导航；A模式只当前owned nativeProject（不是仅前端隐藏）。
2. 全局WS /api/events及event.open.to，见上；握手鉴权不等于payload已限项目。
3. 任意:project读路径都需同session当前nativeID，包括files/fonts/history/media/poster，不只GET主project。query里的path/clip/what要有原安全边界，readtoken不能升级成“所有只读API”。
4. 上游film pages.mjs:147–153可从token查任意listed project，194 folderUrl按每project HMAC生成。新Gateway必须同时验证session-readtoken和对应当前HMAC；拒旧未/s/前缀路径、其它HMAC、规范化/多次解码逃逸。
5. JSON返回中的folder必须按当前session重写；其它project.path绝对路径继续redact。当前MAIN gateway通用rewriteValue会重写所有film-origin URL，它不是新project scope校验。
6. history/poster路径本身不在旧MAIN ALLOWED_READS，不能为了图像成功把history/exports/browse/get/provider/native writes通配打开。api.ts:93–121还含pick-folder/open/newProject/edit/answerAsk/openBilling等，统一fetch proof不授予这些动作。
7. 媒体/film URL携readtoken是可转发读能力，应短时、撤销/关闭跟session/Host代次绑定且只GET/HEAD及明确子资源；响应no-referrer、日志redact，不能把它作为native ack、写权或人类批准。

本调查无测试/修改，不要求新门；用途是让MAIN薄patch和Gateway范围一次对齐。后续实际接线证据需按新固定源码运行，当前不签任何完成状态。

多tab实现注意：同一Gateway editor origin内的不同nativeProject不要共用一个可被后来标签覆盖的“当前project”变量/存储键。每个delegate的proof/readtoken仍要绑定其自己的owner/project/Host代次；客户端根据URL取得当前受控上下文，服务端独立校验。不能以另一个tab打开项目B为由让项目A的token自动访问B。此为MAIN方案实现支持，未以尚未实现的代码宣称有现成漏洞。
