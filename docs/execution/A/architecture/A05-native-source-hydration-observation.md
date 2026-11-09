# 012 — native source hydration / preview readiness 最小扩展规格

2026-11-10，PRODUCT Codex，只读固定上游 `e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3`；MAIN读取时HEAD `824b7dba9cd37ced3da597e2b490c555c17e8c01`。不修改vendor/MAIN/OwnedProjectEntry/010候选，不跑测试、构建、Host或浏览器。本文是下一批可实施规格，不是当前source完整加载或媒体验收证据。下列V路径前缀均为 `packages/openfilm/`，位于只读vendor。

## 结论 / 最小分层

当前010的film原文SHA+实际useFilm/DOM证据只证明 **document_loaded**。同样film字节可能引用不同版本scene、字幕、settings或asset，不能单凭它把完整source_digest判为“所有内容已在原生读取/呈现”。最小补齐分成三组、分别报告：

1. Host exact workspace / source binding：真实committed closure的每个文件可验证、当前native workspace全部字节匹配，所有读取受同一project/nativeID/generation绑定。证明可用/来源正确，不声称浏览器已消费所有字节。
2. 实际native editor hydrated：原有settings、subtitle style/captions、必要markers的**请求结果+同一实际store提交+effective value摘要**，经DOM提交后回报。新元数据附在原hooks/state里，不增加另一份文档store/clock。
3. preview_media_ready：按当前可见viewport/time/frame单独观察的媒体/页面/字幕overlay状态，默认unknown；不与document_loaded或NativeAck混成一个ready。整片解码、ASR、字幕burn、音质/画质仍由真实执行/QC/人验完成。

## 真实读取与消费路径

| 文件/实体 | 当前读与消费触点 | 能证明什么 / 现状缺口 |
|---|---|---|
| film.html | `studio/ui/src/api.ts:24,99`→`ProjectView.tsx:201,232,234`→`editor/use-film.ts`→`:517` timelineTracks/`:2714` Timeline；010已带full hash/native rev/epoch并修P2 request fence | 实际文档store/DOM。不能证明所引用scene字节或video帧已读 |
| `.film/settings.json` | `ProjectView.tsx:542–548` api.settings/setSettings；api.ts:105去掉response wrapper；`:556–565` effective FPS/timecode/trackNames；`components/use-editor-tools.tsx:159–168` trackHeights | fps、trackNames、trackHeights确实hydrate同一native timeline。当前读失败同样setSettings({})，settings非null不是成功证据 |
| settings服务器语义 | `studio/server/project-settings.mjs:56–85` parseProjectSettings/readProjectSettings；:122 GET | parser会trim/限长/筛选，fps限定FRAME_RATES；缺失、坏JSON、读失败均返回{}，原始raw hash不等同parsed/effective digest。不能仅收到200{}认定存在的配置已正确读取 |
| `.film/subtitles.json` | `lib/use-subtitle-style.ts:22–54`；`lib/subtitles.ts:177–181` GET subtitles→parseFilmSubtitleStyle；`server/captions.mjs:43,294–298,426` | startingStyle先来自browser localStorage或default；kept=null保留浏览器偏好。dirty赢过返回的kept。当前style对象不表示snapshot style已hydrate，saved ref不是完成读标志 |
| 旁白/视频transcript及translation sidecar | `lib/use-film-subtitles.ts:48–82` fetchFilmCaptions，latest ask抑制同hook旧请求；`subtitles.ts:155–173` FilmCaptions/GET captions；`server/captions.mjs:223–263`读取真实film、heard clips及readTranscript/translationsOf并按trim派生cues | cues/sourceLanguage/languages/untranscribed是派生读模型，不是原始VTT字节。hook初始null/读失败保留旧cues，250ms事件debounce，且现有ask没有绑定film document epoch/source generation |
| 字幕显示 | `ProjectView.tsx:654,2591–2595`→`components/SubtitleOverlay.tsx:28–52`，cueAt(cues,timeMs)、style.on、filmSubtitleStyleFor(frameBox) | overlay是editor React DOM层，按当前时间显示，不是film iframe内烧录。无当前cue或style off是可解释的未显示，不等于读取失败；DOM存在不证明导出burn |
| `.film/markers.json` | `components/use-editor-tools.tsx:81–105` api.markers+parseMarkers→placed，:379 markerLane；`lib/markers.ts:1–8,41` | marker是timeline注释，不改变film。当前失败保留默认[]，read成功状态与缺失/空的语义仍需标记；如果把它纳入editor hydration profile，必须观察该实际state，不能仅核文件 |
| raw listing / probe / thumbnail/poster | `ProjectView.tsx:203,273` api.files/mediaFetch(probe)→facts；`lib/media-queue.ts:43–107` mediaFetch/mediaImage/useMediaImage(s) | listing/mtime/probe是目录/元信息；Image.onload仅该图片载入，不等于视频decoded。media queue cap URL归一化只是权限transport，不是实际asset载入证明 |
| scene/page/视频/图片 | `editor/Preview.tsx:274–285` iframe `${folder}film.html?load=key&film-missing=skip`；`src/timeline.mjs:360–384,533–565,587–601`加载实际clip/page；:595明确ready只包含长度/布局/page ready、视频按帧懒加载 | page HTML/CSS/JS/font/data由film realm读取。只在被唤醒/所需时间读取；未上屏的资源无需假装已read。skip missing使ready仍可继续，不能把它当整片asset齐备 |
| preview消息 | `studio/server/bridge.js:39,45–66,76–81`→`editor/Preview.tsx:195–220`→ProjectView onInfo:505，viewerReady:2334 | ready无rev/hash；seeked在watch/frame与1s（behind20s）timeout Promise.race之后也会发送；Preview未把seeked严格绑定current document epoch/request seq。Boolean(info)、ready、seeked均不能单独证明decoded/current picture |
| native声音 | `editor/Player.ts:72–90,111–142` load/fetchSounds/film-sound/decodeAudioData；头注释及RESUME_WAIT_MS | 真实唯一clock与WebAudio已有。buffer按mtime缓存，unknown version可被当相同；decode/fetch失败catch→null，204无音轨也null；浏览器可silent播放。onInfo调用load不证明decoded/可听见 |

SettingsModal是另外的Studio全局设置界面，不能因它有Settings名字而当snapshot `.film/settings.json` hydrate。主题、近期字幕样式、solo、音量、播放器暂停位置等本地偏好需与source属性分开；不要为了证明snapshot偷偷改用户偏好或另建clock。

## Host保障哪些文件，无需把它们都强制载入UI

上游 `studio/server/closure.mjs:1–18,35,168` 包括film引用页面/媒体、页面依赖、小型邻文件、transcript/translation、settings/markers/subtitles；也说明动态拼文件名采用启发式，非浏览器实际完整加载oracle。不能拿该heuristic替代MAIN冻结snapshot的闭包规则。

MAIN `created-native-workspace.ts:107–123` 依据CommittedSnapshotAuthority读取完整entries并逐文件copy/verify、形成film hash；:98与:142重验workspace和binding。沿用该authority核所有闭包文件exact bytes，禁止另外扫目录“发现权威”。场景未唤醒的scene/图片/视频、未选择语言的translation、尚未访问时段的素材、版本附属源数据可以只标 `available_verified`，由Host验证路径/大小/sha/权利与workspace未漂移；不要求浏览器提前decode整片或读每个文件才能编辑。

这不让Host替浏览器说“已呈现”。对实际当前UI已经消费的settings/style/cues/markers则必须观察store；scene当前viewport真呈现要用preview通道。不存在/缺失的被要求资源、未证明的动态依赖、未知外部URL或rights不能伪装成optional。样片/正式导出/QC与source授权另走原门，不由readiness状态放行。

## 最小可实施 editor hydration 协议（内部版本化，不改CP31）

保留现有film observation。新增managed observation protocol的明确版本/profile，例如 `native-editor-hydration@1`（建议名，未注册），不静默改变旧document_dom_committed的意义。所有分量绑定同一 `editor_view_id/project_id/native_project_id/workspace_generation/document_epoch`；Host私有session决定真实binding，客户端不得提交期望Host revision来冒充观察值。

每个必需分量 `part=settings|subtitle_style|captions|markers` 回报：

- `state=pending|hydrated|absent_default|dirty|failed|unsupported`；`request_epoch`、对应当前document_epoch；`origin=project|explicit_default|browser_preference`（按分量适用）；failure为有限reason。
- `effective_sha256`是canonical JSON(明确schema版本+已由实际native store消费的字段) UTF8 SHA256。settings包括parsed settings及resolved_fps/fps_source、resolved track names/heights；style包括实际parsed style及来源；captions包括完整cues/sourceLanguage/languages/untranscribed；markers包括实际parsed markers。不能只对GET response在wrapper里hash后报hydrated。
- 原始文件path/hash/不存在事实与captions输入闭包digest由Host workspace authority保存。UI不需要拿到磁盘路径或原始token。Host用同一pin的parser/派生规则建立expected effective值（captions若需duration使用真实授权media facts；不触发ASR/翻译/下载），对比实际UI报告；原始raw字节证明与parsed/effective证明分列。
- Promise成功与store当前值必须同token；请求起点捕获generation+document epoch，dirty/另请求/外部source事件/切换/卸载失效。caption现有ask只管同hook竞态，需补跨film/generation。layout effect在实际ProjectView/Overlay/Timeline提交后才可报hydrated；P2 stale-request不能铸新epoch原则适用于所有分量。

需要修改的真实接缝（本轮不实施）：ProjectView.settings的success/error/read marker与derived fields；use-subtitle-style的pending/fetched-null/dirty/browser-fallback来源；use-film-subtitles的caption success/error/input epoch；use-editor-tools的marker success/error及解析结果。元数据随原有state/refs，不复制字幕/影片文档到新store。可以在ProjectView同一commit里汇总这些现有hooks暴露的evidence。原reducers/写防抖/撤销/clock不改，纯观察callback异常不应破坏编辑。

**默认与失败必须分开**：

- 如果source没有settings，Host明确expected absence；UI成功读返回{}后还须报告effective fps。它可能来自footageRate而非snapshot/项目固定fps；例如footage29.97与A committed30不等，不能伪造fps30。需要MAIN通过真实受控源提交明确settings或将profile标mismatch。
- 如果source应有settings但文件坏/丢失，server当前吞错{}；Host严格预验能拒绝workspace，但不能仅靠HTTP200判hydrate。持续源漂移或api不能区分读取错误时fail closed，必要只读adapter metadata显式报告read outcome，不动原native写协议。
- subtitle style absent返回null时，当前hook可能用浏览器偏好。报告browser_preference+effective digest，不能当snapshot style已载入。要获得严格snapshot一致profile，真实source应有明确style或协议明确“该分量是用户偏好/不属于snapshot呈现保证”。不得在workspace私自写default再称它是原snapshot；不静默丢掉用户偏好。
- captions=[]不能单独证明“没有字幕”：需成功read、对应film/caption inputs及expected empty。untranscribed>0只是缺transcript，绝不是ASR完成；读失败沿用旧cues只能stale/failed。

## NativeAck怎样使用这些事实

冻结NativeAck仍只有project/bridge-session/generation/loaded revision/snapshot/source/selection_version/observed_at，不能新增字段或把internal probe当新MCP工具。MAIN在native-bridge session里保留上述分层evidence并做现有ack门：

1. 验private session/nativeID/window/workspace generation/owner及当前snapshot/source绑定；workspace exact闭包重验通过。
2. 实际document_dom_committed匹配film全hash/native rev；所要求editor hydration profile各分量在同一document epoch已成功、effective与Host实际expected匹配，无pending/dirty/failed/unsupported/浏览器fallback冒充项目样式。
3. 只有这时才把服务器绑定的revision/snapshot/source_digest映射到真实bridge NativeAck。source_digest表示**这个原生编辑状态绑定的exact源闭包**，不能在产品文案中延伸为“所有素材全部解码/整片已呈现”。缺required分量则继续unknown/pending，不能拿Host exact workspace或重复film hash填上缺口。
4. 任一required part改变、source事件、dirty/unmount/断连立即使该profile失效。selection_version仍来自当前native真实选区，不能借此升级approve。

document_loaded可以先独立显示“文档已载入”；完整profile未成立时UI继续说明“字幕/工程设置待核对”等实际分量。当前只有film observer时不能给新的完整source profile标PASS。本方案为持续A实现的adapter边界，不新增人工模块门，也不降低既定最终A验收。

## preview_media_ready 是按viewport的单独状态

最小事件建议 `preview_viewport_observed@1`：同一会话/项目/workspace/document epoch，实际显示iframe key、加载generation、最后应用document update seq、seek request seq、requested/observed time，当前visible clip refs；`state=loading|observed|failed|unsupported`，并分别报告page/image/video/audio/overlay证据。范围必须标 `current_viewport`，从不用一个bool声称整片ready。

现有Preview可复用elements/up/born/shownRef/updates/seq，不建立新iframe/timeline。先使update/ready/seeked与**当前shown frame**及最新document token关联，旧frame/旧seq/切换禁止回绿；frame swap的React DOM commit之后才能称该frame已显示。subtitle overlay的当前cue/style/时间与同一viewport一起观察，off/no_cue是明确状态。原生clock仍由Player提供时间。

但仅增加callback仍不足以证明decoded：bridge.js超时也seeked，timeline watch可按live逻辑不等compositor，skip missing可继续，film realm是作者内容。应至少把实际timeout/failed/skipped分开，必要managed bridge给出真实frame-completion结果而非Promise.race无条件成功；单靠untrusted film消息仍是telemetry，不能当可信授权或全片QC。若不允许改该bridge/renderer，**严格decoded preview readiness=NOT_SUPPORTED**，保留existing seeked为“原生预览有响应”。不要凭opaque timing/DOM截图推断整片正确。

音频严格ready需要在原Player fetch/decode completion处观察每个实际sound的decoded/204_no_audio/failed及version/source ref，和AudioContext状态、muted/solo/silent分别报告；现在catch(null)无法区分这些。不能把player.load、audio ctx running或meter有值当所有旁白已正确解码/可听见。即便新增这些，也只说明当前声音数据可用，未证明语言、音质或最终渲染音轨。

## 明确NOT_SUPPORTED / 后续验证观察点

本次均未实现、未执行：所有文件被浏览器读取/全时段scene呈现、所有视频full decode、所有音频实际被人听见、ASR已完成/正确、字幕已burn、最终render/QC/交付ready、任意动态外部依赖可用。现有film observer、Image.onload、probe、ready/seeked、captions/样式GET均不能单独支持这些声明。

下一批真实测试应包含：同film bytes仅改settings/字幕/VTT/scene/asset（每次source不同）不能复用旧profile；project settings读失败{}与真实absent分开；浏览器旧style与项目style不一致；caption A晚到被film B/dirty废弃；metadata ready但video seek超时/skip missing；旧iframe/seq消息；纯背景音无旁白；caption empty/untranscribed；当前时间无cue vs真正失败；最后给一个真实当前document+各hydrate正向与真实viewport正向，防止全拒绝假通过。Host-only闭包不可用、source漂移及rights缺失仍按原安全门拒绝。运行时需由MAIN预约资源，本文不占槽/不代签。
