# ADR-A05-001 本地素材及旁白输入权威

状态：实施候选；独立冻结复验待完成。公开CP-A0、原Manifest@2及旧video-only导入合同保持原字节。

## 真实分层

`CreationApplication.localAssets → LocalAssetRegistry → local-media-probe.runLocalMediaTool → 固定ffprobe/ffmpeg`。Host配置允许源目录，输入只有相对路径及实际bytes SHA；同一个RevisionStore连接下新增不可变created_local_asset事实表，复用原operation_idempotency及outbox。未创建第二数据库、第二幂等状态机或第二工作时间线。

登记是素材准备：不写author source/snapshot，不递增项目revision，不授予Run/采用/导出批准。普通MCP和native token不能登记许可；来自服务端品牌化trusted_ui的用户及项目归属是前提。内容中的rights_refs不是权威。

本机owned runtime仅在配置NARRALENS_LOCAL_ASSETS_ROOT时挂载该允许目录，私有存储固定到自身root/local-assets；不扫描文件、不自动登记素材、不把空目录或进程存在当生产能力。未配置时localAssets=null，完整视频生产能力仍未注册。工作台上传、MCP可发现输入及Run/Task组装仍需下步接线，不宣称用户已能完成本轮任务。

## 存储、许可及提交

登记输入先按值固定，防异步阶段元数据变化。源目录canonical/dev/ino固定，输入逐级directory-fd/O_DIRECTORY/NOFOLLOW读取，固定source_root被重定向即拒绝。流式复制至独立私有staging，hash与实际字节及原文件首尾身份一致，2GB是继承既有导入资源限制，不是模型次数预算。

视频保留旧CFR校验，再严格解码所有支持的视频/音频流；音频必须有真实时长/采样/声道并严格解码。FFmpeg/ffprobe固定协议与格式白名单，无shell、网络provider或请求指定的命令。音频帧数由duration_ts/time_base直接以整数有理数算出，不经显示毫秒二次取整。实际codec入库；合成诊断音明确synthetic，真人性质只能由实际用户来源证据配合人验，不从波形或标签伪证。

blob fsync后no-clobber hardlink发布，原子SQL同时登记不可变事实、原命令响应和事件。失败时没有可用登记；未引用blob只是缓存，可按同key安全重试。相同内容但许可/来源声明不同产生不同registration_digest/asset ID，原事实不更新。资产ID/rights_ref在CP 64字符限制内，完整digest用于碰撞与事实验证。

private root/objects/staging的directory fd保持到所有admitted import和resolve结束。写入、发布、清理使用本进程proc-fd相对路径；父路径在检查后变成alias，也不会跟随写入snapshot。读取/写入前和最终SQL均检查原路径、inode、权限。ctime变化若来自并发发布者删除staging硬链接，不直接豁免内容门：重新实际hash并要求该次读取前后完整metadata稳定。关闭服务取消排队/运行、等待工具close、清理staging及目录句柄，然后Host才关闭共享DB。

## 内部接口

- import(LocalAssetInput, trustedCaller, signal)：可信用户登记；同key重放原响应，异输入409。
- list(project, trustedCaller)：读取该项目不可变登记元数据，不等于当前可用/许可通过。
- resolve(project, assetId, trustedCaller)：重新证明blob bytes后返回Host-only路径和许可事实，调用方必须在派发/采用时检查许可、来源及ExecutionBinding。
- capacity：真实running/queued/limit=2；不是持久Job，不伪造工作流步骤状态。

未知/受限许可保留原状，不自动cleared。实际登记事实与输入闭包、项目/Run scope、批准、snapshot的最终绑定留给Task/Coordinator接线；此模块不替代那些门。

## 实证与限制

真实本地生成1秒诊断视频/合成音频，不能替代A的授权60–180秒素材和真人中文录音。已测完整解码、真实损坏AAC音轨（旧video-only检查能通过而新门拒绝）、截断WAV、1600sample一帧、真实取消/超时/PID消失、并发重放、四个SQL失败边界、两个父目录alias竞态、未知许可与关闭顺序。原失败捕获保留。

UI文件选择/上传/可信确认入口、原生组装、Run/Task副作用、正式Delivery、全量A/T20/HTML/人验仍未完成；不签A05整体或A通过。
