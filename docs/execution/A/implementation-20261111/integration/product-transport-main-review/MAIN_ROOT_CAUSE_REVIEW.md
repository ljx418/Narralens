# PRODUCT 传输子阶段：MAIN 接管根因复核

状态：IN_PROGRESS。超过两次返工后，MAIN 接管本子阶段诊断与必要修复；不重新发起整包设计审查，不把四次夹具修正隐去。当前 source 副本及 SHA256 见 inputs.json；PRODUCT 原工作树由其 writer 保全，MAIN 尚未改其源码或索引。

## 已观察的事实

原始组合日志摘要为 805d5ba727e94cedfd52897c110b8bc1d1fa94c98f4a1854ba2724ae034bd837，四次运行 exit 为 1/1/1/0，最后 21/21。首轮 cookie 名匹配与无法签发的 revoked-native 前置错误；后续重复头夹具没有发送真实重复头，最终用原始 socket。保留负向断言与原失败，未据此认定生产守卫通过。记录 shell PID 768624 已经 MAIN 查询确认不存在；逐例端口未采集，不能反向补称端口核验。

现有21项仅为 stub Studio 的真实 HTTP 组件测试，并无真实 Host dispatcher、Studio 或 prepared 文件。这些结果不能支持 A 验收、正式批准与采用。

## 当前实现直接可见的剩余缺口

1. `#uiReviewMedia` 在 open 后仅通过 openUiMedia 复核，随后 `readBounded` 的多个异步 read 与 HEAD/GET 响应前没有再次复核 UI parent。原生 revision stale 不应撤 UI，但 UI 自己的 owner/session 撤销必须在异步返回后生效。需要增加读中撤销的确定性失败用例，证明无后续读取/发送，reader 恰好关闭。
2. `readBounded` 虽每次读不超过1MiB，仍把全对象保存在 chunks 后 Buffer.concat，HTTP range 也可任意大。这不等于有界流式传输；真实视频会产生双份全量内存峰值。应按响应背压逐块发送，检查每块实际长度，失败中断响应而非错误标为完整成功；保留客户端整对象 hash/bytes 校验。
3. request/response 断开未接线至媒体读取生命周期。若 open/read 未完成，finally 只能在该 await 结束后运行；没有取消/晚到 reader 清理约定。需要在受控接口内传播取消，或可靠管理 late resolution 和幂等 close；不以超时放宽或删除自动服务解决。

## 处理边界与下一步

MAIN 已要求 PRODUCT 停改三个传输路径，提供明确 writer hold 与稳定摘要；其 Claude 继续独立 UI 消费者。收到 handoff 后，由 MAIN 在自己的 integration 工作树执行必要修复及针对此因果链的测试，不双写活动 lane。接口若需新增可选内部 AbortSignal，仅影响 Host 内部调用，必须向 BRIDGE 精确同步，不改变两条HTTP别名、冻结业务 DTO 或授权模型。不能靠测试替身伪装真实生产者。

验证至少保留原21项，并增加：read await期间撤销、读取期间客户端中断、open晚到清理、背压下不贪读、短读中断与关闭、HEAD/Range负向、可重开UI与native stale隔离。记录确切输入、命令、退出、日志摘要和真实清理证据；重型测试排在 BRIDGE/MEDIA 单槽队列后。该报告是 MAIN 实施期诊断，不是独立外审 PASS。

## 实际修复与复验结果

MAIN在独立integration工作树从df32311的三个固定文件接管，未混入PRODUCT其余app候选。实现逐块背压传输、每次read await后和发送前核验UI parent、内部可选AbortSignal、断连/关闭取消、late open释放和幂等close。既有native stale与仍有效UI的区分保留，不扩HTTP别名或业务批准权威。

类型检查exit0。新原合计28项HTTP测试exit0；另与旧native容量/真实Host+pinnedStudio入口合跑3文件34项exit0，所有输入摘要一致。把两生产文件暂换为immutable df32311，仅测两个因果新用例，得到明确2失败：撤权返回200而非409、64MiB对象完整贪读64块而非首块提前送达。随后从内存备份精确还原修复版；负控的非零是预期检出，保留原日志，不将捕获器exit0当测试通过。

本修复为MAIN实施及自验证；独立审查仍PENDING，真实BRIDGE dispatcher+MEDIA预览组合、前端A体验仍NOT_RUN。未用stub Studio组件证据替代业务验收。所有进程清理声明以cleanup-observed.json限定，不声称全机没有其他服务。
