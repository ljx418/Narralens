# A05 LocalAssetRegistry / media probe 独立只读预审

日期2026-11-10；上下文a_media_independent_review，未参与实现。MAIN工作目录main-integration，基线 `d15e44d1d9739febdc0f47e260b06b4a3881ab1c`，新文件尚未提交。MAIN唯一writer；审查期间MAIN已根据发现改动，故本报告区分初始问题与随后读到的修复，不冒充一致冻结候选。原始读取副本/摘要在inputs及input-hashes.json；后续副本在latest-read及latest-input-hashes.json。

**结论REVIEW_PENDING / NEEDS_WORK。** 本次未执行测试、ffprobe/ffmpeg、媒体、Host或任何探针；仅读源码和MAIN已经终态的日志，只有本review目录写入。没有批准A05完整组装/RunDispatch、A06或A整体。

## 发现与已反馈修正

### LA-R1 · P1 · 已插入row必在读取/重放时被误拒绝（随后SOURCE_FIXED）

初始local-asset-registry.ts:108的#row精确keys期望遗漏source，而LocalAsset构造、INSERT fact_json实际包含source。任何注册row在list/replay及并发后到读取都会REVISION_CONFLICT。MAIN r2真实11项中8pass/3fail均落#row，分别是正常素材目录读取、重放、并发；不是审查者重跑。

已向MAIN指出共同根因，随后源码把source补入精确键集合，仍保留source进入canonical core/registration_digest，方向正确。该具体缺陷可标SOURCE_FIXED，冻结回归未由本审查者执行；不得把r2失败日志删除或改为PASS。

### LA-R2 · P1 · 初始“完整decode”遗漏视频内音轨且容错错误可放行（随后SOURCE_FIXED，需真实坏媒体负向）

初始local-media-probe.ts:34复用旧validateImportedMedia；旧media-validator.ts只-map 0:v:0、vfrdet验证视频，不读取视频内音频。音频分支:60没有-xerror/严格错误识别，返回0时stderr被忽略；FFmpeg可容错结束，因而不能据此断言全部媒体流无坏数据。

随后MAIN新增独立严格decode：视频-map0:v与0:a?，音频-map0:a:0；-xerror/-err_detect explode、-v error，非空stderr拒绝，并拒绝不支持的stream类别；旧CFR检查保留。静态已修正原遗漏，**真实损坏音频、带坏音轨视频/截断文件负向仍需跑**，本次不宣称已复现某个具体坏文件成功闯关。旧Manifest@2/旧入口未为此改合同。

### LA-R3 · P2 · 音频双ceil导致帧数多算（随后SOURCE_FIXED）

初始音频计算先ceil到毫秒，再将毫秒ceil到fps。例：48kHz PCM的1600 samples恰好1/30秒，在30fps应1帧，旧代码算34ms→ceil(1.02)=2帧，影响后续原生片长/对齐。

随后MAIN改为BigInt duration_ts*time_base直接对fps分子/分母作ceil，duration_ms独立展示，避免双重取整和乘积溢出，源码方向正确。建议真实1600-sample WAV、非整帧尾部与分数fps边界用例，不仅用1秒tone；该计算正确性不证明音频来自真人。

### LA-R4 · P2 · 视频tool域错误被旧validator再包装成永久坏素材（目前OPEN，除非后续源码另修）

local-media-probe的自定义execute/tool会把取消或工具不可用/资源故障抛ProductError(CAPABILITY_UNAVAILABLE/HOST_RESOURCE_EXHAUSTED)。但旧media-validator.ts runTool会再次捕获，既不识别这些ProductError也不保留域码；最终包成HttpError422 INVALID_MEDIA，新的video外层又转成INVALID_REQUEST。实际有效素材可能因取消、ENOENT/ENOMEM等被误报内容不合格；音频直调用tool则行为不同。

另tool只识别ENOENT/EACCES/ENOEXEC/ETIMEDOUT，Node execFile timeout/overflow常以killed/signal/ERR_CHILD_PROCESS_STDIO_MAXBUFFER表示，当前未单独处理，也会落INVALID_REQUEST。不能把工具deadline或资源终止说成永久坏媒体。

建议在A05 wrapper保留底层域错误，或在明确release后调整共享runTool边界，不放宽真正坏媒体拒绝。真实取消/工具缺失/有界deadline负向应验证正确稳定错误码、无row/operation/outbox；本次为确定异常包装路径分析，未执行新探针。

### 生命周期待证事项（未虚报成已复现泄漏）

tool使用promisify(execFile)+AbortSignal/killSignal SIGKILL，没有显式close确认。AbortError可在kill请求后先于实际close出现，随后registry finally会清理staging。此路径没有renderer/Chrome，FFmpeg仅固定null输出，不要求照搬浏览器进程组方案；但若对用户或资源调度宣称“取消已完全停机”，须确认close或明确未知，不能仅凭发过信号。建议真实取消时记录本次child身份与close/退出，证明返回后不再占用媒体工具。本次未执行，列待证而非声称已经有残留。

## 主要正向防线

- 实际probe和decode固定ffprobe/ffmpeg程序与参数，无shell/客户端工具命令。demuxer whitelist为mov,wav,mp3,flac,ogg，protocol为file/pipe/fd，未加入网络协议；无provider、模型、付费或上传。codec='video'已被MAIN按真实probe codec_name替换，不重复把已知占位当新发现。
- sourceRoot由Host配置，客户端只能相对路径+明确expected SHA。最新源码把sourceRoot canonical inode身份固定并重查，拒绝别名/被替换root；storage与author/snapshot/source域不重叠，storage/objects/staging为私密运行根。输入先nofollow/nonblock/regular/max2GiB，再流式1MiB复制并同步，源fd前后dev/ino/size/mtime/ctime fingerprint与实际SHA验证。工具读取私密staging，不读取之后随时变化的用户原路径。
- blob由内容hash+已观察容器形成内部token，hardlink no-clobber发布；EEXIST只验证既有字节，不覆盖，不删winner。blob/objects/root fsync后才进现有RevisionStore.atomic；最终#assertBlob再核inode/fingerprint。SQL失败遗留的是私有未引用缓存，不能当作已登记素材。
- 同一原DB/OperationIdempotencyStore/outbox，row+receipt+业务事件同事务，4个SQL fault点rollback；不增加project revision，不改author/snapshot。临时staging在finally清理。双key同registration可复用不可变fact，完整registration_digest/core用于截断ID碰撞核验；CP asset_/rights_长度<=64。
- branded可信UI+project owner才可登记许可；authenticated driver/native bridge不能用body伪造许可来源。许可unknown/restricted不会自动清为cleared，音频recording_origin会保留synthetic/human_recording/unknown。来源是**操作员经可信UI对特定bytes的attestation**，不是机器证明该声音为真人；synthetic fixture不能改称中文真人录音验收。
- 重放原幂等回执无需重新读取已变化的外部source，这是正确的已绑定bytes语义；实际消费必须走resolve重新核blob，不把ledger历史成功等同当前磁盘永远可用。source URI等用户来源元数据不被自动fetch；Host storage绝对路径只在内部resolve返回，不能接成公开DTO。

## 建议回归与范围

除R1–R4外，建议覆盖真实FIFO/源root替换、copy阶段源inode/内容漂移、no-clobber预置同名错误blob、取消与SQL末尾取消、不支持的playlists/网络媒体引用拒绝。无测试跑过的项明确NOT_RUN，不以当前正常color/tone fixture通过推导恶意媒体安全或所有process故障已验。

本轮真实Host测试使用synthetic color与tone，只是本地登记诊断；即便最终通过，也没有真人授权素材/录音输入，没有公共UI登记闭环、原生素材组装、Run/Task调度、采用提交或完整影片导出。A05/正式Delivery/T20/整A不得据此关闭。后续需冻结同一fullSHA与最终输入摘要再独立复核及授权真实重跑。

## R7/R8修复只读复核追加（仍未冻结、未独立运行）

读取MAIN本轮源码与已落日志；未运行测试/媒体/Host，不修改MAIN。逐文件副本及摘要见r8-read和r8-input-hashes.json。MAIN R7真实21项exit0、R8组合3文件31项exit0及tsc0已读取；它们是MAIN执行，不称本审查者重跑。

- LA-R1 SOURCE_FIXED：#row精确字段集合含source，source仍参与不可变事实与core摘要，不再让正常list/replay/并发回执必失败。早期r2 8/11失败保留。
- LA-R2 SOURCE_FIXED + MAIN_TARGETED_EVIDENCE_PASS：视频保留旧CFR门并另以-xerror/-err_detect explode、错误stderr门严格解码所有v/a；不支持流组合明确拒绝。真实坏AAC音轨视频在旧video-only validator通过，却被新import拒绝；真实截断WAV拒绝，有对应case，非替身decoder。
- LA-R3 SOURCE_FIXED + MAIN_TARGETED_EVIDENCE_PASS：BigInt直接从duration_ts/time_base到fps ceil，1600 samples/48kHz真实WAV断言34ms展示但恰为1帧，避免双ceil。
- LA-R4 SOURCE_FIXED + MAIN_TARGETED_EVIDENCE_PASS：新runLocalMediaTool固定spawn程序/参数，输出4MiB及120s上界；所有Promise成功/拒绝只由child.close回调结束。abort/deadline/output超限标原因并SIGKILL本次ChildProcess，先等close再返回。spawn资源错误保留HOST_RESOURCE_EXHAUSTED，工具不可用/终止/取消/deadline保留CAPABILITY_UNAVAILABLE；video的executeFailure存原错误，跨旧validator的INVALID_MEDIA包装还原。实际import在ffprobe spawn时取消，断言CAP及PIDgone，无row/staging残留。
- 原“取消结束未等close”的生命周期待证在本定向路径已闭环：真实-re FFmpeg分别100ms取消/deadline、等待返回后PID已不存在；没有用fake timer或stub进程。只针对固定ffmpeg/ffprobe单child，不泛称浏览器/任意进程树均可如此处理，也不宣称内核不可中断I/O有硬wall-clock终止保证。
- 新关闭契约合理：registry拒绝新入场、内部shutdown信号取消admitted/queued，再await全部pending；CreationApplication.close等待worker及registry，最后Host才关共享DB。实际ffprobe spawn触发Host.close用例断言工具已退出、槽归零、staging清理、新import被拒绝。内部2槽队列是非持久import限流，不另造Run/Job状态机。

另已核对sourceRoot固定canonical inode及storage与author/snapshot/input双向交叠保护（含alias规范化）；metadata/caller在首个await前按值捕获，异步期间外部对象改许可不能升级权利；视频codec为真实probe观察值，普通URI只接受无userinfo/query/hash的http(s)，不取回网络内容。shared blob ctime因另一个staging硬链接删除而变时，仍保留inode/size/mtime并重新实hash，不直接豁免字节门；此改动未放宽成“ctime变化总忽略”。

本次未发现需要继续阻断该源码候选的新增具体P0/P1/P2。**原LA-R1..R4及所列取消/Host.close缺口源码闭环，MAIN定向实证成立；最终独立冻结复核仍REVIEW_PENDING。** 不因只读复核把MAIN未提交tree签为最终PASS。

仍限定：成功登记只是同bytes可信操作员attestation与实际技术facts，human_recording值不等于机器证明真人；当前synthetic测试保持synthetic。正常FFmpeg decode不证明原生工作台支持每一种合法codec或已组装影片。未提供公共UI审批链、真实A授权素材/中文录音、原生组装/采用、RunDispatch、完整Delivery/T20或整A验收，本轮不得据此关闭这些门。
