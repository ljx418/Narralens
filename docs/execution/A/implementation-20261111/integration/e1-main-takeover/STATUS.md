# E1 MAIN 根因接管候选

本目录记录从 cfadc136 候选接管后的实际修复；原始输入见 IMPORT.json，旧宽泛scope测试与旧publisher夹具原样归档。

- 修复：封闭同步commit、真实publisher proof/FD/完整闭包守卫、同DB私有scope、R1 geometry与新增adoption provenance分表。
- 真链抓出并修复：40位Git SHA被当64位内容摘要；roots排序改变entry；测试fixture遗漏worker启动、SQLite外键创建顺序和合法review URL。
- `real-007`：两文件19测试全部通过，其中8个真实Host/本地媒体/原生源码/快照与提交边界用例；输入未改变。
- `typecheck-06`：exit 0；`d09-python-02`：11向量一致。
- 原失败real-001..005全部保留；real-006为单条正向通过。

限制：接受review策略为明确模块夹具，未证明真实UI审核、全Run、独立外审或人验；未集成created-source-change-service，BRIDGE剩余模块/PRODUCT/MEDIA仍各自开发。当前只能称E1候选内部模块证据，不能声明R2/A完成。


## 后续存储修复候选

`impact-atomic-02` 5/5、typecheck-07 exit0；增加真实外层事务插入、修正read返回完整hash/初次重放规范化，尚未服务接线。real-007的19例绑定前一候选8f35330，不能冒称已覆盖这次存储修改；受影响真实回归等待重型slot，PRODUCT当前持有。独立审查仍绑定原冻结commit，未取得本次增量PASS。


## 独立外审返修中

8f35330实际独立结论REQUEST_CHANGES：1 BLOCKER/6 MAJOR/2 MINOR（含增补）；原始Orca回报与逐项矩阵已保存。当前已编码隔离token与私有record、末端新时钟、真实native/权利/consumer/ranges/上游对账、原FD跨rename跟踪、跨库poison、impact幂等冲突等修复。新增真实媒体边界用例尚未运行，因此不能写已闭环。

当前仅impact-atomic-04轻量两文件18例、typecheck-10通过。另发现旧accepted黄金向量只测hash未测validator，补上了真正接受断言并修复与原LockService一致的project scope空target。旧失败impact-atomic-03/typecheck-08保留。重型真实回归等待MEDIA与PRODUCT003之后的MAIN预约，不并发。


## 实际影响事实读取者（未接线）

新增CreatedSourceFactsReader：从真实完成任务与prepared映射取得目标摘要/预期snapshot，复用实际purpose=impact验证器，私有WeakMap token持有原author FD与完整prepared proof到最终同步复验；release/close失效。不写工程/Job/Approval/snapshot。RetainedSourceTree从publisher抽为共同文件守卫，retained-tree-01实际4例通过；typecheck11通过。现有真实adoption测试夹具已增加reader与独立手工计划事实逐项对比，尚未实际运行，不能宣称reader真链通过。

重读原冻结D03/D04确认impact允许先于ReviewPackage。BRIDGE E5先要求已发布review会造成循环，MAIN已按原冻结要求纠正；未新设临时包/第二Approval/伪运行状态，服务接线继续等待正确共同guard接口。MEDIA仍有许可，单次cwd空观察不证明它所有任务已退出，MAIN已请求具体执行边界/必要时先取得writer暂缓ACK再交回资源；未擅自抢占。


## 实际影响服务接线候选（未运行Host门）

按BRIDGE a6ee51e精确导入execution-guard.ts及其测试，actual E5 PreparedImpactFacts只从MAIN真实私有reader token同步投影，允许impact先包后，无假review/own gate。新增created-source-change-service.ts：真实当前brief闭包/固定plan/owner/grant/stage/前序门、base/selection、FD/registry/完成Job复核，与impact/完整plan/原幂等响应同一Host事务；active重放重新核世界，terminal重放不复活，不创建Approval或正式snapshot。真实adoption夹具正常路径已改用此服务及幂等重放；反例仍明确直接构造错误计划以检验最后拒绝边界。

Reader/publisher阶段目录现在严格由Host stageDomainRoot+原task.stage_token+真实prepared lease_attempt导出，先与映射/输入比较，再通过原FD读取metadata，不以存储路径字符串当定位权威。该Host-only构造配置必须由实际producer runtime root注入，不是wire字段。RetainedSourceTree增加bounded descriptor读取，5个文件系统测试含同字节替换拒绝。

prepare-foundation-light-02：4文件63例PASS；typecheck14 PASS。runner升级v2，输入绑定扩展到src/contracts/tests/tools文本、配置/锁、D09及自身，并检查新增文件；旧runner捕获范围较窄仍原样保留，不能扩大旧证据声明。新服务及现有20个真实Host/媒体边界例尚未运行，外审未通过、生产composition/能力未准入、无UI/人验结论。

三领域真实429后各Codex已按原授权成为唯一writer、旧Claude已guarded stop，保全报告由父节点给出。MEDIA REAL001夹具失败，phase NOT_RUN；PRODUCT003已取得slot并绑定原修正脚本。媒体报告另一Vitest heavy并发，MAIN读取旧BRIDGE源码证明这些文件是SQLite/临时FS+MEDIA doubles，不能凭文件名认定heavy；实际PID归属仍待原命令证据，保留旧观察不追认排他性。


## D10事务与实际Job关系补强

自审对照原D10补齐最后提交和发布前的journal marker：仅接受kind=edit且request.operation=agent.created_source.apply@1，拒绝借snapshot_publish事务写created source。原真实夹具之前误用了snapshot_publish，现已修正，并新增拒绝错误kind用例（NOT_RUN）。reader与commit也核对当前step_attempt.job_id为实际准备Job，新增脱离Job关系拒绝用例（NOT_RUN）。typecheck15通过；之前63轻量结果不扩大为本增量的真实Host验收。


## 实际整组定向验证 real-010

real-008在真实准备产物抓到新消费者图把旁白当视觉镜头：clip_ids实际含shot-*与narration。按固定生成器的真实身份/数量对账，完整graph保留独立narration范围与关系，不用数组下标猜镜头。real-009实际单正向通过；real-010三文件40/40（22个真实Host/本地媒体/源码发布/事务边界用例、其余18个计划/SQLite用例）通过；v2输入无修改或新增，原失败保留。typecheck16通过。这里的真实媒体是诊断素材输入与源码验证，不是正式视频导出或人类配音验收。

正常路径已实际使用新CreatedSourceChangeService在没有review包时产生impact并同key重放，project revision不变；之后review/confirmation/Approval仍为明确模块夹具，验证最终受控提交与拒绝边界，不能冒充真实UI可信审批或完整Run。API注册、专项recovery、整工作流推进、正式渲染、UI/NativeAck、整轮独立审查与人验仍未通过。
