# 014 — MAIN expected settings / markers：固定纯函数与可决定边界

2026-11-10，PRODUCT Codex，只读固定上游e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3。所有V路径均相对vendor的`packages/openfilm/`。未改已编译候选shape、MAIN/vendor、Preview/Player，未为本报告运行原生/Host/browser/ffmpeg或build。013 H-R1的获准helper unit/type/build另有精确证据，本报告不把它们当expected adapter/browser验证。

结论：**可以复用同一原生纯layout/placement函数构造一个无UI的受管expected-projection adapter；不能保证仅凭snapshot文本+一个film parser就能对所有原生状态算出相同hash。** 原生timelineTracks还消费preview spans、实际probe facts、pending UI state。已冻结013候选保持不变；缺失这些依据时MAIN标profile不支持/待核对，不能抄UI observed rows生成expected来调绿，也不能偷偷用另一套Host timeline算法。固定A数值时长/位置+已验证素材事实的子集可以直接接同一套纯函数，并用真实browser正向核同值。

## 函数清单 / 真实链

| 目的 | 固定实体/行 | 输入/关键语义 |
|---|---|---|
| 原文/原生value | `studio/server/film.mjs:33` readProjectFilm；`src/film-doc.mjs` readFilmFile/clipSpan | native useFilm消费返回value；不能改用另一schema自行补id后当相同value。MAIN可用自己已验证快照reader喂同pin parser |
| settings normalize | `studio/server/project-settings.mjs:56–85` parseProjectSettings/readProjectSettings | 严格验证原始source是否存在/合法后，复用parse函数；fps限原FRAME_RATES，name.trim/40字符、数量上限、heights round/clamp。不可绕HTTP吞错把坏文件{}当成功 |
| 影片→TimelineFilm | `studio/ui/src/lib/film-shape.ts:57` filmShape(doc,spans,mediaFacts,guess=false)；:43 guessedSpan | spans来自真实Preview info；mediaFacts为src→{audio?,duration?秒}；缺span时仅有numeric placement+trim/known duration才plain fallback，guess会给5秒stand-in。不要强行guess=true生成expected成功 |
| TimelineFilm→native rows | `studio/ui/src/lib/timeline-layout.ts:805` layoutTracks；:604 withDocTimes（内部）、:586 layered、:663 badgeRows、:993–1045 add/rows/main | 复用导出layoutTracks即可；内部处理重叠分行、docIndex、row.index、lane、main。不能照Host engine projection每轨一行模拟 |
| 保存名称定位 | `studio/ui/src/lib/timeline-nav.ts:117,142` placeSaved / trackNamesOf | 先按保存clip集合最大匹配且每doc轨只取一个，后fallback到合法原index。是doc index→override name Map，不是每个overlap row独立名字 |
| 保存高度定位 | `studio/ui/src/lib/track-heights.ts:41` trackHeightsOf(saved,doc.tracks)→placeSaved→clamp；:27 ownTrackHeight(row) | own default main68、visual56、audio44；clamp28..160、四舍五入。不是M5 CSS高度 |
| native显示高度 | `studio/ui/src/components/use-editor-tools.tsx:159–168` heights/shownTracks | h=live?.sameDocIndex ? live.height : heights.get(docIndex)；h不存在保留row，最终Timeline高度=row.height??ownTrackHeight(row)。013.settings取同一tools.tracks序列 |
| fps fallback | `studio/ui/src/lib/timecode.ts:37,46` namedRate / footageFps；`ProjectView.tsx:550–558` | explicit settings.fps优先。否则按时间排序的native video blocks的fps，再按native listing.files顺序补其他video，取第一个可用FRAME_RATE，最终30。不得拿Host render fps替代 |
| probe规范化 | `studio/ui/src/lib/workspace-resources.ts:118` factsOfProbe；`ProjectView.tsx:273–281,515` | durationMs=Math.round(durationSeconds*1000)，mediaFacts再除1000；audio=Boolean(probe.audio)，fps原probe值。用已授权的真实持久media facts同样normalize；不要悄悄重probe/page render |
| marker normalize | `studio/ui/src/lib/markers.ts:42` parseMarkers | id去重、t取毫秒精度、name trim、color默认blue、上限1000；使用原函数，勿只JSON.parse当规范化 |
| marker placement | `studio/ui/src/lib/markers.ts:75,84` clipMarkerMs / placeMarkers | 用真实timelineTracks block；有clipId且loc才入clip map，source t/inMs/speed→film ms，边界允许±0.5ms（不是另一个半开帧规则）；移出trim/缺clip则不placed。最后按ms稳定排序 |

原生`ProjectView.tsx:515–521`是准确入口：`layoutTracks(filmShape(film.film,info?.spans??[],mediaFacts,Boolean(previewError)))`，再在pendingDrops非空时`withPendingBlocks(base,pendingDrops)`。`useEditorTools`接这套timelineTracks计算placed与heights。013 hash保留实际Map/rows/placed，而不是Host catalog/inspection DTO。

重要边界：native overlap row.index从1开始，docIndex从0开始；lane可能`doc-0`/`doc-0#2`。同一个main doc轨的重叠行都会被标main，ownTrackHeight都为68，不能只给第一行68。layoutTracks:1015在所有轨没有block时返回[]，因此空工程即使film有两个空轨，actual track_heights也是[]；用两个Host empty-track DTO行来算expected会错。track_names仍来自doc轨Map，不随“没有显示rows”而擅自删除。

## 最小受管纯adapter轮廓（建议，未实施/未验证）

MAIN生成一个受管node/纯函数bundle，仅re-export并调用上述同pin函数；没有React App/DOM/SelectionStore/Player/clock，不调用任何native写/seek/render/replay。这只是给**同一个native editor**校验expected read profile，不是建立第二条生产timeline。bundle/原文件/依赖闭包都进managed pin，不能从任意未校验路径dynamic import。

给adapter的事实：同snapshot的native parsed value；严格预验并parse的settings/markers；按真实asset digest绑定的规范化mediaFacts/fps；必要时可信resolved clip spans及其source/renderer provenance；native listing的相同顺序。普通固定A数字at/time和完整真实媒体事实可优先支持，动态scene/不确定duration不得用猜值放行。

算法顺序保持原样：

1. `names = trackNamesOf(settings.trackNames??[],doc.tracks)`。
2. `base = layoutTracks(filmShape(doc, trustedSpans, normalizedMediaFacts, false))`。对明确数值at/time的闭包，可以用空spans+完整mediaFacts走相同plain fallback；但需要真实browser证明该子集与最终实际info一致，不能把empty spans当所有scene通用解。
3. `heightMap = trackHeightsOf(settings.trackHeights??[],doc.tracks)`；无live拖拽时按原shownTracks逻辑给同docIndex行附height，保持row顺序。生成013精确`track_heights`投影；names按docIndex排序生成`track_names`。
4. fps优先explicit；否则按原ProjectView顺序喂`footageFps`（包括rawListing.files的实际排序和probe规范化）。`studio/server/files.mjs:166,215–216` listFiles使用path.localeCompare(undefined,{numeric:true})；不要用DB insertion order或普通字典排序代替。若跨runtime locale差异不能证明，优先source显式fps或沿同native server读已绑定listing作为只读事实，不能抄UI期望fps。
5. `placed = placeMarkers(parseMarkers(rawMarkers),base)`；height-only附加不改blocks，故无live/pending时用base与UI相同；按原结果映射{marker,ms,clip_id:clip?.clipId??null}，不自行整数化ms。最后用013同canonical envelope SHA256。

任何可信事实缺失或snapshot/generation变化，adapter必须fail closed/unsupported；可继续document_loaded及真实编辑，不虚构complete hydration。不能因为observed hash不一致便直接以观察payload回填expected。尚未有可靠spans的动态scene需要受控producer的真实求值证据或后续显式profile版本；这属于常规接线依赖，不是追加人工大阶段门。

## Runtime import依赖与打包注意

静态runtime imports（type-only import不计）：

- film-shape.ts → film.ts → `src/film-doc.mjs`（film.ts其余d.mts为类型）。filmShape中的TimelineFilm/TimelineBlock/ClipLook是类型，无需加载React组件。
- timeline-layout.ts → film.ts、`src/film-doc.mjs`的clipSpan、timecode.ts(DISPLAY_FPS/exactRate)、timeline-drag.ts(trimFence)。trimFence:282自身只做数值比较，不调用snapToFrame。
- timeline-nav.ts → timeline-drag.ts、timeline-edit.ts、timecode.ts；timeline-edit.ts → timeline-drag.ts/timecode.ts；type api.ts不会在正确TS编译后载入网络API。
- track-heights.ts → timeline-nav.ts(placeSaved)；markers.ts → timecode.ts(snapToFrame，供编辑辅助)，placeMarkers/parseMarkers自身不调clock或写函数。
- timecode.ts → React(useSyncExternalStore)，还有模块local currentFps/listeners。`footageFps`/namedRate/exactRate是纯值函数，不得在Host调用setTimecodeFps/useTimecodeFps/stepFrames默认项目clock。可用受管tree-shaken bundle仅保留所需纯exports，或显式固定同native React依赖后直接import纯函数；不能静默混用MAIN React版本或模拟全局clock来凑hash。
- workspace-resources.ts(factsOfProbe) → `src/film-doc.mjs`、media-queue.ts → React。只需要原pure normalize函数，禁止为了normalize启动mediaFetch。tree shaking可以避免无关transport，但实际bundle须审查/固定hash；本轮未构建该adapter。
- server parseProjectSettings → Node fs/path、atomic/http/projects.mjs；projects.mjs有studioHome/key等非纯服务能力。可由已pin server模块的纯parse导出使用，或build只留该export；不能调用studioKey/写目录当“读取设置”。

原生TS imports含`.ts`/extensionless和type-only符号，不能假设Node直接import所有UI源码无需loader。MAIN可以在其受管离线构建中生成一个独立纯exports bundle，记录完整上游SHA/模块hash/工具链/产物hash；不改vendor、原UI，且不创建第二可交互timeline。不要直接import ProjectView/useEditorTools或调用React hooks以求expected。没有Node适配器实际测试/构建结果，以上是源码事实地图。

## 不能仅由snapshot决定 / 当前profile不包含的状态

- Preview info.spans是运行期scene/page求值结果；相对at表达式、无显式trim、page自有duration/size、embedded内容可能必须真正求值；previewError影响guess/stand-in，不能由snapshot parser单独知道。这是运行事实，不应当伪造为“纯UI偏好”。
- 未完成probe时的facts、解码/ready/超时、browser缓存是否新鲜是运行事实；013只是观察当前effective值，MAIN匹配前必须有可信expected依据。复用读取函数不等于授权在校验时启动ffmpeg/browser/page render。
- pendingDrops及withPendingBlocks是临时拖放/上传UI，snapshot无该行；Host不应把临时行算到expected以取得一致。013候选保持不变，相关hash可能不匹配，应待操作完成/新干净view。若业务需要显式pending标签需后续版本化扩展，而非改已编译shape。
- useEditorTools.live高度是未保存拖拽；013已标settings dirty，当前view不得出hydrated。已保存高度来自settings，可纯重建。
- 浏览器localStorage记忆的subtitle style不在snapshot，013显式browser_preference/unsupported；不能由Host生成一个同值default冒充source。SubtitleOverlay自己的livePos拖拽、captionsOn开关、当前cue/time不是013 base-style/raw-caption hash字段。它们属于瞬时显示状态；profile不等于当前像素/overlay已显示。
- zoom、滚动、选择、solo、音量/mute、播放/暂停位置、主题不由snapshot决定，也没有加入013 settings/markers有效值。不要因其存在重建另一clock或扩大NativeAck含义。

NativeAck持续表示真实native state与项目/snapshot/source的受控绑定；绝不等于媒体decoded、ASR、字幕burn、所有时段均呈现或正式交付。当前compiled候选没有为适配Host偷偷删减上述字段。MAIN可在支持域内直接完成纯adapter与真实对照；不能支持的域明确unsupported，继续既定A实际验证。
