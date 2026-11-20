# next-wiring revision6 独立文档准备审计

结论：**REQUEST_CHANGES**。发现1项MAJOR接口缺口、1项MINOR交接遗漏；未发现需要架构重写的BLOCKER。只审查文档方向及静态可实施性，不给 implementation-ready、实现验收或业务PASS。未修改草案/源码/测试/合同，也未操作Git索引或运行根。

审查对象为八份Markdown、manifest revision6及其12份权威输入。先核验manifest.files的实际字节，8/8相符；12/12引用文件摘要相符。07的七份历史源码摘要均由 `git show 1d348d419120f23f45d958112ea8c43df5a04675:<path>` 核验相符，没有读取变动中W源码作为基线。所有实际读取输入、字节数和SHA256见INPUTS.json；完成时再次校验输入未变。057是REQUEST_CHANGES历史候选，accepted_native_commit=null符合边界。

## 需要修订的接口缺口 NW6-A01（MAJOR）

来源：04:11、43与06:71、84。06要求媒体await后重验授权/session、包/运行、S01 lease及原像/marker；04只安排新模块实现现有ReviewMediaBindingPort并交给现有HTTP/reader。冻结源码review-media-http.ts:46–55的两个resolver不接收caller/session。实际HTTP在290鉴权，303 await reader.open，305–308只复查owner/binding；339 await read后到342 write只检查abort与长度。openMedia:231–238也没有逐read的currentness/session复核。describe:189的异步finally close还会产生返回前窗口。这些是现有接口的约束，不能用新的resolver内部校验包/receipt就代替请求session校验。

具体反例：合法同owner的GET通过鉴权，在reader.open期间撤销它的session但包和receipt不变。新resolver拿不到该session，原transport仍可交付。另一反例是在流已经打开后的一次bounded read期间切换package或破坏marker；此前的resolver已经返回，原transport依然write刚读出的字节。无需恶意native或伪造Host-private hook，是真实公开GET的异步窗口。缺陷属于拟议接口/路径方案，不是在追责057未实现未来W3规格。

最小修订：04为受信媒体请求定义窄read-scope/final guard，携带真实caller/session、owner、当前package/run、receipt/双marker及需要的S01租约；CreationApplication装配，transport调用，不把guard放到wire。把review-media-http.ts窄修改列入候选路径，或给出等价且真正携带caller的适配接口。定义异步open、最后binding读取、bounded read/backpressure及descriptor close窗口后的检查和真实close/drain归属；最终检查至交付间不能留下另一个await。只拒绝变更后的新交付，不承诺撤回已经写入socket的字节。无需改公共DTO或重写renderer/审批。

映射PUB-RD01、PUB-DB02、NW-API03、S01-L01/L02：在上述真实窗口分别单点撤销session、换包、改marker；证明陈旧后不新增交付、GET零写零render、read/close真实排空、DB最后关闭，并保留正常对照。当前均NOT_RUN。

## 交接清单 NW6-A02（MINOR）

03:5仍要求先读00–05，应改为00–07并明确06的规范地位及07最终重锚要求。06的双marker和原像拒绝不能从实现者必读清单中遗漏。详细机器条目见FINDINGS.json。

## 其余设计核对与反例

|维度|静态审查结果与具体反例边界|
|---|---|
|体验全链路|SOURCE_ONLY→真实五part preview→impact→同事务package/binding/receipt→trusted decision→apply→native proof顺序一致；preview与commit均不等于loaded。02逐项保留原S01的28条id/level/steps/expected，机械比较零差异。真实Studio、中文影片、导出及人工门未被组件计数代替。|
|authority|S01单原DB/唯一owner、epoch读面与pending业务拒绝、mapping先提交pending、Ack opaque permit与同事务最终guard、Context lease末端验证方向一致。新publication无审批/revision字段，不取代原workflow或原九字段commit。重复publication必须先读原像，不能依04正向首跑步骤重新render；06:67/99已明确此限制。|
|双marker原子迁移|06正确使用原schema_migration既有id/from_version/to_version/applied_at/backup_path/detail六列；冻结job-kind-migration.ts:121起定义可支持这一判断。新增唯一行+六显式对象+私有marker在同原连接原子事务；四象限、未知同族版本、任一marker畸形均拒绝，不能静默补装。未执行SQLite。|
|schema覆盖|06明确修正原prefix helper遗漏异名附着trigger/index的问题；两表、四trigger与两个隐式pk/u index分开核验，INTEGER PRIMARY KEY不虚构第三index；SQL token不宽化CHECK/FK/STRICT/literal。外部marker使用literal prefix查询避免LIKE下划线通配。|
|新鲜性与丢失|marker逐操作最终重读，不以schema_version替代DML检查；历史binding缺receipt preimage时读/prepare/apply拒绝，不再render补历史批准。只删namespace或外部marker可检测；两marker+全namespace一起删或整DB回滚无法提供密码学防回滚，06诚实保留此边界。媒体请求侧如何完成新鲜检查仍需A01接口补充。|
|回退|06:103选择兼容build关闭新入口并保留最终保护，真实旧binary支持另证；与02/05的保护目标相容。没有要求未修改旧binary魔法识别新表，也没有把手删表/reset当回退。最终release须锁定实际支持方案。|
|生命周期与API|05入口先停、已受理工作/句柄排空、依赖保留、DB/FD9最后关与07对workspace.close立即失效的说明相容；允许明确取消/Ack+0，未承诺停服中所有操作成功。显式共享预算对象、issued ref/producer/witness、无虚构production.release()均与历史API一致。060后的真实owner/scope必须重新锚定，不能复用057共享browser叙述签实现。|
|验收直接证据|原28项不删，PUB-DB/TX/RP/MD/RD/RC与NW-API增加真实迁移/变异/崩溃/GET/重启证明；实际producer、零render replay、同DB同root crash及资源归属有明文目标。当前文档没有声称这些已执行；不能用本次静态推导当实际断言通过。|

逐字DDL（LF，保留末LF）SHA256为 `be75d5683a25861ab2cbe14d0a12c4bbde050a342288e2f254f577a2a6623e56`；canonical migration detail（无末LF）SHA256为 `b021a477274708f2695cd4676d1c806ddef0d5f2d25be6c5c8e9142bc01e4dce`，均独立按文档字节重算相符。这是摘要核验，不是SQL执行成功证明。

## 正常待办，不作为本次缺陷

060修复冻结接受后，07及05的sharedbrowser/cachequarantine/关闭语义必须绑定实际接受commit；当前null及NOT_RUN正确，未接受本身不是缺陷。最终ReleaseAssignment还需完整路径、私有DDL/marker归属、错误码、argv/cwd、资源预约、证据根与支持回退。源修复验收、下一接线开发、原28项及HC/A/H/J/PUB运行、两条真实60–180秒中文影片和人工验收全部仍待完成，本报告没有替它们签字。

本轮业务runtime、SQLite/迁移执行、Node生产代码导入、单测/集成/构建、Host/HTTP、浏览器、media/probe、SIGKILL恢复及人工体验全部 **NOT_RUN**。只做读取、git show、SHA256与文本/契约逻辑核对。完整findings、case映射与输入账本分别在同目录FINDINGS.json、INPUTS.json。
