# 060P1 开工准备：私有进程隔离与完整生产责任

状态：DRAFT_NOT_RELEASED。060P0 仍持有唯一写入权及重型运行槽，本文件不授权任何代码写入、启动worker或新增测试运行。不得与已签发的060P0并行实施。最终发布前须填入060P0实际交还证据与当前源文件摘要。

## 唯一规范依据

ADR_060_ISOLATED_CACHE_DRAW.md rev2 与 ADR_060_APPROVAL.json。架构图仅辅助说明，不能代替ADR和真实验收。原17条N1/N2要求、已通过模块、固定上游与Approved015不减。059修复的A01/02/03/05/06和静态fitness修复应保留；060只关闭仍开放的A057-04以及它需要的真实资源所有权接线。

## 代码边界草案

拟新增 src/adapters/openfilm/ 下：

- cache-production-scope.ts：Host内唯一调度器；私有签发scope；物理dev/ino与canonical事实核对；完整生产两槽、32总排队、8同根排队、30秒排队截止；可取消队列；active与cleanup-required只读根状态。不能只锁worker阶段。
- cache-process-supervisor.ts：私有DrawHandle、HELLO/GO、真实内核身份核验、长度受限协议、候选与结算分离、分阶段精确清理、异常无转移barrier、inspect/reconcile；不把超时或包装promise拒绝当结束。
- openfilm-cache-worker.mjs：单draw原始固定模块加载；出生策略先安装；握手前不加载上游/启动Chrome；保住leader；错误/关闭封出生；私有二进制管道，不把ticket放argv/env/URL/log。
- cache-worker-policy.mjs：仅worker局部策略；固定Chrome调用闭包；复用当前media-process-policy原字节，不改正式render；未支持的逃组入口明确拒绝。
- cache-worker-integrity.json：实际加载的worker/policy/复用guard与固定producer依赖原字节摘要；不制造自引用清单。MAIN在正式发票前锁定生成/检查工具的精确文件名与CLI。

允许现有接线的拟定范围：openfilm-upstream.ts（工厂与桥、真正源stream/probe/准入账本），created-native-workspace.ts（PRE到最终激活的scope），created-native-source-reader.ts（读取准入和最终交付guard查询真实根状态）。保留public owner签名与issued品牌、EnginePort七方法、源事务和Expected算法。

如确需新的guard facade或protocol helper，先具名获得MAIN范围许可；不得从“必要辅助文件”自行扩展路径。不得修改render worker entrypoint/policy、上游、锁文件、vendor、Approved015、公共合同或用户AGENTS。

## 子步骤与验证顺序

1. P0真实reader/cache回归交还后，MAIN锁定dirty基线、源摘要和精确允许路径，再发P1。当前不得启动。
2. P1实现私有模块、父资源账本、workspace/reader接线与确定性协议/调度测试。期间只允许正式ReleaseAssignment列出的命令；运行时源文件必须不变，每次唯一recorder捕获。
3. 真实进程/Chrome测试需要独占重型槽及单独明确命令。先以固定policy字节做真实Chrome继承与整组退出pilot，证明实际调用闭包；不足则修复本门，不能跳到“全量绿”。
4. 完成下表全部资源/异常边界和受影响旧回归。普通故障应真正回收并可继续下一draw；无权限/未知归属分支才保留责任等待人工处置。不能把全部失败改成永远pending来规避验收。
5. 所有直接证据与受影响回归之后，再执行真实fullcheck、生产构建、安全与输入/日志完整性门。MAIN冻结新SHA，再由独立审查者审核冻结字节。实现自审不是外审。

## 不可合并省略的直接证据清单

|编号|必须证实的行为|
|---|---|
|ISO-01|真实连续两帧与poster可生成；缓存key/算法不变；跨draw进程隔离不破坏成功体验|
|ISO-02|真实seek15秒与JOB45秒原始错误可达，外层60秒不遮盖JOB；每项真正结束原生执行域|
|ISO-03|capture30秒通过真实资源与明确标注transport barrier命中；不得声称自然卡顿|
|ISO-04|late launch/newPage continuation在错误后也不能越过执行域清理；无旧work继续读PRE|
|ISO-05|不同物理根两个真实worker并行，清理A时B存活并成功；同根别名仍共享锁|
|ISO-06|完整同根锁覆盖preexisting-output/PRE/worker/drain/POST/两个tree释放/最终门/witness激活|
|ISO-07|close/cancel/私有断管含GO前、GO后；重复close只结算释放一次；不交付晚到结果|
|ISO-08|真实协议、JPEG、stdout/stderr洪水有界拒绝并真正清理；无先反序列化巨对象|
|ISO-09|TERM-ignore转KILL实际回收；child close+组ESRCH+已知后代消失含Z，信号成功不是结束|
|ISO-10|leader意外退出、EPERM、未知归属不盲杀/伪settled；PRE、FD、scope、容量均不释放|
|ISO-11|真实私有handle reconcile以新鲜证明结算恰好一次；伪handle、旧JSON/PID不能签发成功|
|ISO-12|真实range源流在响应中止后曾存活且最终close；响应close不能替代源FD close|
|ISO-13|真实父frameDuration probe跨worker结束仍被等待并reap；需明确原回调是否覆盖真实child close|
|ISO-14|执行域消失后同步封资源准入；冻结边界的新请求不访问源/创建probe；下一draw显式重开|
|ISO-15|完整候选→单调FINALIZE_AFTER_OK→授权终止→真实结算→最终源/witness门；不得倒填或由SIGKILL推成功|
|ISO-16|两活跃scope、32全局/8同根排队、30秒队列截止；超额/取消在PRE前拒绝且不生child/泄漏FD|
|ISO-17|reader准入及最终交付同时查对应物理根；generic production lease不因自己的活跃scope自我失效|
|ISO-18|当前worker/policy原字节下真实Chrome/zygote/renderer/utility继承与整组退出；旧policy证据不复用|

这些是ADR实证条件的映射，不改写原17需求编号，不自行把旧Gate标绿。测试double可以证明协议分支，但不能替代标有真实的进程、媒体、FD、probe、Chrome证据。明确区分组件证明、Host接线、真实工具、headless、headed与human；后两者未跑仍NOT_RUN。

## 发布前仍缺的事实

060P0实际完成结果、源码dirty摘要、真实清理与写入权交还；新增integrity生成工具/测试helpers精确路径与命令；当前工作树无越权变化核对。以上未闭合前本文件永远DRAFT_NOT_RELEASED。此处不批准下一接线/S01/NativeAck/Studio/A片/V1，也不批准付款、联网、下载或供应商/本机配置变更。新Claude429立即停工，禁止自动重试或Codex接手。
