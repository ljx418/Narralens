# 039 集中预检修复裁决与源码放行

用户恢复授权继续有效。唯一writer Claude ctx_ae73a82c85e9，HEAD e2eff61b…不变。独立review ctx_9614731cbcda已结束，报告3aa47916…/矩阵fe0d839e…，实际35输入及其备份起止一致。038实际exit1/32pass1fail保持历史。现在解除037/038审查冻结，按同名JSON精确9路径实施本次集中修复；不是全18路径续期，不新建项目或模块。不需要用户再裁决，MAIN已明确技术路线。若确需白名单外路径，说明精确必要性再请求。

先完整读取 independent-pre-runtime-review-037/REVIEW.md 和 MATRIX.json、BATCH_038_MAIN_RESULTS_AND_PREFLIGHT.json及你自己的039设计回应。报告为请求修改，未取得任何业务/冻结外审PASS。下面覆盖其六项MAJOR及遗漏的PF03/N8证明，必须一次合并，不能只修静态测试列表后跑全量。

## Q01 — 创建、关闭与并发注册

servingFor整个操作在第一个异步挂起之前登记为service受理工作，close等待它；按确切HeldWorkspace/view实例single-flight，两个合法并发请求只创建/返回同一受控owner。失败清除pending，仅在事实仍有效时未来显式请求可重建；不能隐式复活已失效view。

工厂自己的listen/后置realpath/stat/验证失败由工厂结算部分listener/folder；它没return的owner不能要求service负责。service得到owner后，任何closing/lease/current-record/rootFD比对失败都**立即**关闭该owner并保留primary+清理异常，不等未来dispose才回收。失败清理不确定要如实粘滞/报告，不能覆盖主因。

测试必须命中：创建await间close、创建await间dispose、注册失败、自身listen后的root校验失败、并发同一view。记录真正已创建端口/资源身份及终态，证明关闭后无晚到注册/活listener，不以目录计数或任何throw代替。可在这两模块及fixture里添加最小Host-private具名生命周期观察点，专用于确定性时序；观察返回值不产生authority，回调后重验真实事实，不加公共请求字段/EnginePort方法。

## Q02 — 实际绘制租约而非HTTP计数

接受你039回应中的serving-specific admission方案。仅Host-private桥调用**真实已登记producer**，root/origin取模块私有serving事实，begin/end覆盖其真实pageFrame Promise（失败也结算）。不允许任意callback、调用方rawbase、伪造producer/owner获得签字权。

owner.close首次设置closing拒新受理，等待**全部已受理draw**真实结算，期间保留其未来页面/iframe/媒体HTTP请求；之后结算folder实际rawprobe/HTTP，再关listener及闲置连接。多次close返回同一结算Promise，不能closed=true立即返回。不得为关一个serving关闭共享producer/browser；root等服务资源最后释放。最终激活仍要检查closing/liveness，晚到结果不因资源完成而自动得到authority。

测试需要真实draw在两个HTTP请求之间、当前HTTP=0但draw未结束时close；后续依赖请求能完成，close不提前settle；第二次close也等待同一结算。保留原producer peer-close正例及closed-before-draw拒绝，别用这两项冒充新场景。

## Q03 — duration只能证明本次真实输出

只在固定上游实际写duration的film.html分支，并且POST相对PRE为新的输出身份，才进入pending输出记录；非film绘制、film未产有限duration、原文件未变均不能替旧文件补签。任何有限值+stamp形状不等于producer出处。若无法充分证明是实际output则fail-closed/不授权，不能用存在性补签。

增加真实非film绘制+事前伪造metadata反例，断言没有得到新的duration授权、reader仍拒绝；保留改后恢复、等字节新inode负例。N8必须真实连续两次不同frame（例如ms0/ms1）绘制、两个key各自三件套可消费、当前duration由最新active授权，不把旧frame绑死旧duration inode。另证明最新授权revoke后不回退到更老授权。使用同一既有ledger，禁止第二个duration签字仓库。

## Q04 — 门禁覆盖语义入口与真实数据流

当前producer:unknown是合法fail-closed边界，不改为特定接口只为测试发现它。五个入口的索引可用明确能力登记或模块私有producerRoots.get语义导出；不能靠vendorRoot/req/body词名、expect数组数量或参数type文本假完备。

必须补报告中的**原样反例**：import{createPinnedOpenFilmUpstream as load}后load(req.url)、namespace OF.createPinned…、loader自身本地openFilmAvailability(requestDerivedRoot)无self-import、helper(root:string){sink(root)}从外层helper(req.url)传入。解析导入别名→真实export、namespace、同模块函数及实际参数到helper形参传播；保留先前header/body/变量别名/参数改名/函数返回值、producer位请求值、装配期可信参数及无关文件正控。不要只添加永远red的字符串检查；用同一实际gate分析器检测正负代码。若采用保守有限数据流，明确范围并在这些原样反例上闭环，不扩大宣称为通用静态安全证明。原pin/fixedargv/shell/伪造verdict断言保留。

## Q05 — 私有真实媒体准备必须可达

现cp会复制3个opaque文件，ffmpeg -nostdin无-y必拒绝覆盖。只处理测试自己创建的私有temp路径：可在生成之前移除这三个**精确已复制文件**，或使用固定-y且先证明路径属于自有临时fixture；绝不动canonical固定opaque字节或用户媒体。禁止全局清理前缀。保留源副本/manifest真实hash和原有两次固定上游目标render、完整decode900帧、中镜真实编辑、关后重开、不同结果断言。

视频和音频均须真实probe及完整解码（不仅容器metadata/视频count_frames）；要保留命令/exit及源媒体摘要、帧数/采样时长对应实证。诊断媒体不等于A影片；旧migrator标题页不等于原画面迁移；Hypit摘要/既有产物回调不是freshHypit渲染，声明边界不能扩大。新增-y/删除只是私有fixture准备，不改生产migrator或付费权限。

## Q06 — 真正跨项目authority负例

不得用不存在的imp_of_another_project或只改原输入project_id并接受任何throw。必须在**同一真实DB/authority**内构造第二个项目的实际impact/transaction，调用前断言对象存在及真实foreign归属，保持两项目其余合法链及关键输入有意义。

分别驱动真实foreign-impact、真实foreign-transaction拒绝，断言对应明确authority/ownership/CAS错误及两项目完整事实未变（source/revision/pointer/approval/impact/transaction/snapshot/idempotency/outbox）。若拒绝来自更早合法绑定检查就如实记录，不能称命中更深的SQL CAS。保留真实storedhash篡改与事务后故障回滚、静态归属负向。优先在现有test内通过现有生产setup准备第二项目；需要白名单外helper时先精确请求，不引入第二数据库或新production状态机。

## PF03与LF03证据补全

K05-c目前仅匹配message和两root fault，不等于精确Error对象保留或所有分配均结算。保存每个独立genuine Error引用，按namespace+allocationid+phase+path记录全部受理分配；断言primary未覆盖、每个genuine对象恰好一次、所有分配恰一次close尝试，真实close后抛，无裸fd身份混淆。失败后无见证可见且服务sticky。不能删除旧K05a/b或reader多因子用例。

LF03已实现的published-only同FD同步二次证明暂未发现新增代码缺陷，保留其安全检查与N9/N10，补同内容不同key的一次业务事件断言（本轮第9个精确授权路径仅为local-assets-host.test.ts，不开放对应生产文件）。实际旧严格comparison和丢失POST原因等反事实执行仍待独立精确runtime grant；不得把新测试不存在/编译失败算业务old-red。

## 编译、自验证交付与停止规则

本次授权完整修复及**串行typecheck**，不是业务运行。编译通过原记录器，唯一新capture n1n2-claude-039-tsc-NNN / corepack pnpm exec tsc --noEmit。每轮前保存全部候选完整字节/hash及本轮准确路径；运行期间所有输入冻结；终态后另一个工具调用读取结果、核对无漂移与自有清理。仅引入的TS类型/作用域错误可在白名单内修正并用下一唯一编号编译，无次数上限，红灯不可覆盖，不能把多轮编译当新增业务授权。新429立即停，不自动重试。

完成集中批次、编译绿后交一个完整候选：Q01..Q06+PF03+N8逐项代码/有效负例映射、所有源码字节/hash、实际编译记录及精确提议命令。业务case、媒体、浏览器、Host、ffmpeg、变异、build/full均等MAIN针对该候选新的运行授权。MAIN将先让高判别力新反例与回归序列运行，通过才启动耗时全量，减少返工。

不add/commit/reset/stash/checkout/push、不改AGENTS/Expected015/公共DTO/EnginePort/pin/配置/运行器/旧Gate，不进入下一接线源码，不自签冻结外审或A/V1通过。这个039source release完成后仍需实际业务验收与冻结commit独立审查。
