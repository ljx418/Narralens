# 下一接线票：原生闭包读取的具体边界

状态：MAIN 只读核查与前置实证；未释放额外实现文件，不改当前 Claude 捕获输入。以现有 NATIVE_EXPECTED_READER_INTEGRATION_CHECKLIST 和 PRODUCT_NATIVE_COMPOSITION_PLAN 为约束，非替代计划。

## 已核实的上游事实

固定上游 e70d9d93 的 packages/openfilm/studio/server/film.mjs:26 revOf(text) = SHA256(UTF-8 text).slice(0,16)。readProjectFilm 使用 UTF-8 readFile，再把完整文本送入 revOf；不得使用 project revision，也不得先 trim、改换行、去 BOM。实际导入原函数生成五向量，Python 独立复算完全一致，含中文/emoji/CRLF/BOM。源码文件与 Git HEAD blob 逐字节一致；此非生产 native_rev 接线通过。

settings 路径 .film/settings.json，markers 路径 .film/markers.json，style 路径 .film/subtitles.json。上游 settings/markers 读异常会降级为空；Host 权威读取不能把 I/O/损坏当作独立证明的缺失。只有已证 ENOENT 的负 lookup 可以取明确默认；权限、资源不足、JSON 损坏分别拒绝/可重试。

## 工作副本 API 的缺口与接线要求

CreatedNativeWorkspaceService.isPrepared 目前只验证真实 issued 对象、数据库绑定、根及副本目录 dev/ino，不证全部字节。rootFor/#verify 重读旧 closure.entries，不枚举新增文件。均不能独自签发 ExpectedSourceFacts。

下一票须在该服务内部建立私有 opaque workspace lease：保留 issued view 与目录句柄，证明同一 owner/transaction/snapshot/source/revision；实际枚举相关目录和文件并保持 dev/ino、大小、摘要及负 lookup；严禁从客户端 source_root/workspace_ref 造 authority。读取已提交 SnapshotClosure 与实际副本须独立比较，不能把相同输入摘要当两次证明。不得新增第二 timeline 或直接开放原生写入口。

NativeSidecarInputs.directories 必须是真实原生枚举顺序；现有 pure 函数只计算 supplied facts。files:null 只有读者证缺失才可填；media.duration/audio 来自同一字节的真实 probe，不能从字幕长度/trim 猜。由结果 consumed_paths/negative_lookups/directory_lookups/media_lookups 反向核对所有依赖均被 retained closure 覆盖。遗漏、未知外部引用、符号链接、同字节新 inode、相关新增/删除全部 fail closed。原生派生缓存白名单要逐项定位固定上游出处，不能泛忽略 .film 全目录。

最终同步验证：原生实际目录顺序/正负项与已读内容、数据库及工作副本 lease、session/generation/selection/control 完整一致；Expected 中所有可重入端口读取在最终私有 fence 前完成。close/晚到结果遵循已冻结 PRODUCT 生命周期，不在 MAIN 重新复制一套凭证状态。

## 精确验收与执行顺序

1. PRODUCT 0ddacd4 生命周期独立复审闭环；当前仍 REVIEW_PENDING。
2. 当前 D10 Claude 四文件捕获真实完成、恢复字节及唯一 writer 移交后，MAIN 才能导入两个 PRODUCT blob；不能边捕获边合并。
3. 冻结下一精确文件 release，先实现 workspace retained lease 和 source reader，再做 consumer/selection/Context 接线。不得仅用现有 isPrepared 替代闭包，以求早报 loaded。
4. 真实 FS/DB 证明：完整快照及实际副本一致、加入字幕/translation/style/设置/marker 变化、同字节换 inode、重命名/软链、权限/ENOMEM、错误 rights/probe、owner/commit/control/session 漂移及晚到 close，均须验证拒绝及无 Ack 落行、句柄释放。
5. 预约独占重型 slot 做实际已采用 source→同一 Studio→document+四 hydration+选择→Expected→Ack→Context loaded，以及重开、改单镜、原生选择变化与失效。纯端口测试不替代它。

此票尚未实现；尚不能宣称 NativeAck、影片、人验或 A 出门通过。T20、双中文短片、正式双导出和阶段独立审查仍保留原目标，不缩范围。


## 素材枚举顺序补核（固定上游源码事实）

files.mjs:166–216 的 listFiles 最终将 files 按 path.localeCompare(other.path, undefined, {numeric:true}) 排序；server.mjs:500 再过滤 kind=video。因此 video_files_in_native_order **不是原始 readdir 顺序**，也不是普通字典序。caption/transcript directories 的实际查询顺序是另一类依赖，不能把两者混为同一个排序规则。后续读者须复现同一原生执行宿主的排序语义并保留完整素材枚举事实；不能只遍历 film 引用、从浏览器列反推，或借 storyboard 顺序代替。出处及源码blob摘要见 listing-semantics.json。本轮仅只读源码核查，没有运行 listing/hydration/探测验收。
