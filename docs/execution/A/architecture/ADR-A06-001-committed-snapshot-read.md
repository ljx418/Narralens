# ADR-A06-001 已提交快照到正式渲染的读取边界

状态：实施候选，独立冻结复核待完成。公开CP合同/DDL不变，既有渲染器保留。

`CreationApplication.committedSnapshots → CommittedSnapshotAuthority.readerForTransaction → SnapshotReadPort.readSnapshot → SnapshotRenderService`。前三者现已装配为Host-only读取端口；正式Task、fence、Delivery提交和UI下载接线仍须后续完成，不据此登记完整渲染能力。

## 明确权威

读取器绑定同一RevisionStore中指定的committed project_transaction，保存project_id、transaction_id、snapshot_id、source_digest及base_revision+1。不能靠当前active_commit猜历史版本：一个内容寻址snapshot可以被多次restore使用，影片版本必须来自此次具体commit。输入不得改项目、snapshot或digest；每次读取前后重核该事务、快照与不可变created_source_fact。

所有字节来自SnapshotStore该项目/该snapshot/source；不读取live author source。逐级拒绝目录symlink/junction、文件canonical逃逸或非regular条目。SourceDigestV1重新覆盖完整依赖，asset清单hash/bytes与事实相符；固定上游实际解析证明fps/帧数/完整性；每条文件打开时nonblocking/no-follow并在同句柄stat/hash，避免FIFO挂请求。快照只是存在但无committed事务，不可取得本读取器。

## 许可和附属品

许可来自不可变source fact，不由Agent在请求中宣称。媒体引用的asset ID/hash/bytes必须完全匹配，字体/未知文件不默认first-party source；无许可的附属品保持不可交付。当前事实能声明字幕路径；rights附属文件的完整生产声明尚须后续组装链补齐，不依据文件名猜成“许可文件”。零帧草稿及缺少必需附属品会由既有preflight阻断，不能冒充已输出影片。

## 错误与恢复

作用域/已提交事实不符直接拒绝；读路径错误或上游不可用通过稳定错误隐藏绝对路径；只有结构化可识别资源错误才分类HOST_RESOURCE_EXHAUSTED。不置永久attention，不修改project revision/active pointer。上游初始化失败不缓存为永久失败；恢复固定上游可用后同服务可重试。

此模块不证明Run批准、Job/lease/attempt/fence、原子发布、业务outbox或Delivery已经接线，也不证明已执行正式渲染、真人录音或人验。现有媒体服务的preflight/copy/QC/package门全部保留。

## 解析阶段复验发现与修复

真实负向捕获main-parser-fifo-before在初始digest后、实际pinned readProjectFilm前替换film为FIFO，旧实现阻塞。固定上游readProjectFilm内部只有读取film.html和既有parser；因此MAIN供应链包装先用nonblock/no-follow同fd读取regular bytes，将这份原始bytes写入私有700随机目录的600 wx film，再调用原已固定readProjectFilm，finally清理。上游代码/解析语言/写入口均未更换。Adapter另核解析返回text的SHA和字幕bytes SHA与初始闭包一致；非法UTF8重编码不符即拒绝。信号检查仅是显式取消检查，不虚称20秒硬中断。

旧AC-004/投影映射单测曾给实际文件不同的假text，与新SHA不变量冲突；只把mock text改成真实被摘要文件，保留原doc/problemlist/503等所有原期望。新增结构等价但文本bytes在digest后变化必须409，保护严格源版本边界。
