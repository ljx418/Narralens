# A05-008：原生分镜源码准备

基于MAIN原有Host-only assembly port，纳入MEDIA冻结afa8627三个prepare模块及纯字幕burn-source helper。只输出SOURCE_ONLY，未注册public工具或生产任务能力，不写author/snapshot/revision/审批。按真实Script/Storyboard/已resolve资产及权利事实准备每镜原生video/page clip，完整旁白帧长等于全片，VTT按storyboard_plan时间、不是ASR。原生字幕settings及隐式侧车显式列digest roots，保留来源与录音类型；诊断unit字节不能冒充素材或真人录音。

MAIN独立静态审查确认ND-R1（目录stat A后open B没有身份比对），MAIN修根及嵌套目录。持有opened fd前必须比对created dev/ino，失配不登记为owned；清理仅原记录inode，替换目录保留，无法确认清理则DRAFT_IO_FAILED，不假称成功。构造器专用故障边界不来自请求DTO。16个unit/固定parser case通过；两次分别删除根/子目录identity检查的变异均使专门拒绝断言失败，源逐bytes恢复。

这是MAIN独占0700父目录下的受管准备协议，不声称POSIX mkdir与第一次lstat原子获取inode，亦不声称阻止任意同UID本机进程修改所有Host文件。原拒未知目录/别名/跨ID输入inode/源hash/rights/取消门保持。

纯burn helper按固定upstream exports私有模板适配、调用真实film-subtitle module；尚未接既有worker/pin/config，也未真实render，不能声明字幕已烧录。不新增第二导出队列或第二全片后端。后续MAIN在同一执行binding/job lease/Run门内准备，审批与唯一Coordinator提交，以及committed snapshot正式render/QC/Delivery仍需完整真实接线。
