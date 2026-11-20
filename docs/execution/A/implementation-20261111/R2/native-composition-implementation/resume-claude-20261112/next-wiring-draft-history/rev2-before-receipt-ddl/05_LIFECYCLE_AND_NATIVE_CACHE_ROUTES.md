# PROPOSED：启动/关闭偏序、native GET与回退

DRAFT_NOT_RELEASED。实际014方法名/实例身份需最终绑定；此处不宣称生产接线已存在。

## 启动偏序

|顺序|owner/动作|准入与失败语义|
|---|---|---|
|1|owned-runtime/start-runtime取得原FD9、前代退出可证→打开原RevisionStore与原schema迁移|无public/listener/task/reaper/native入口；跨所有权/全局DB失败中止，不删锁inode|
|2|Host唯一装配显式安装/校验S01及review receipt私有schema、独立marker/receipt|四象限拒绝，不repair/补0；其他原migration rows不变|
|3|同S01 settleInterruptedObservations + reconcileBaseline|无pending不为重启盲增epoch；有durable pending按原S01一次CAS restart_unfinished，baseline同时变合并一次；损坏项目有限诊断，健康项目继续|
|4|构造同DB/verifier/task/assets/selection的专属family recovery与有限scheduler|每family按真实kind/marker，原generic分类与dedicated task lease排除在startup和timer同时生效|
|5|专属恢复扫描→generic recovery/reaper按真实归属收敛，发布每project recovery gate|不能只看返回counts/一次pass；已受理全扫描有限终结，未证published保全，不要求先开Studio|
|6|安装原正常prepare/apply/review、Native/Context/worker入口，再开始listener与timer|全局ready需全局依赖可用；局部blocked保持项目gate，不能全部假ready或全局误冻结|

每次新prepare/apply/native/context入口，在公开准入后先reconcileBaseline，创建/完成异步mapping与真实commit/control变更也按S01 owner规则invalidate/reconcile。最终同步guard只比较新鲜DB/S01 token，不调用会写事务或await的reconcile。所有read/write face来自一实例；新session仍需要真实issued binding，不从持久session_token恢复live mapping/Ack。

## 关闭偏序

|顺序|动作|必须仍存活的依赖|
|---|---|---|
|1|关闭public/task/native新准入，冻结新event，撤live loaded/对外grant；记录host_shutdown cause|不为服务关闭统一bump epoch；不调用普通user-close语义重增版本|
|2|停止新timer调度，排空已接受完整recovery scan、apply/publisher、mapping、Expected/Context read、raw acquisitions和probe/cache生产调用|S01业务/epoch读面、原DB、task/assets、文件根及已受理许可仍可读；caller取消不是raw完成|
|3|收敛未完成mapping shutdown_unfinished；对所有accepted操作真实settled做检查|若进程仍在/排空失败，不提前关DB或删native根；保留主错误与cleanup，报告未结束对象，不宣称已停|
|4|撤native session能力；停止受控gateway/native supervisor；排空producer共享browser，最后真正owner关闭browser|一producer实例停止不能杀peer任务；raw子进程exit/close先于输入FD/根释放；不得仅用关窗口当无子进程|
|5|释放Expected/reader/workspace/private parse及cache quarantine等实际owner资源，关闭S01读面与业务依赖|目录/lease按各自owner，不裸FD重试；永久不确定明确报告|
|6|最后关闭原RevisionStore/DB/WAL并释放owned-runtime FD9|所有accepted业务已settled；真实SIGKILL不声称运行过finally，重启另按启动序|

## 受控native GET/后台派生调用绑定

统一入口拟在openfilm-studio-gateway.ts/controlled-studio-access.ts做已认证created origin绑定，实际producer/witness来自CreationApplication构造的014服务，不能在route里new第二个registry/pool。所有请求参数先安全校验并映射到Host issued workspace/ref/generation；opaque origin/root由supervisor/Workspace提供，不来自URL/body。

|原native路径/动作|拟执行路径与事实|失效/拒绝|
|---|---|---|
|GET /api/projects/:nativeId 原document，可能warmFilmPoster|原auth/owner/ref→同Host producer注册并跟踪必要poster生产/预热；原server.mjs:349后台warm也必须纳入同owned调用，不能直接绕过wrapper产生无见证cache|新cache使旧proof失效；期间Context unknown/pending，不能先loaded。无法接管后台warm时本case不达门，不能宣称GET无写副作用|
|GET .../media?what=poster 或 frame 且path为page|Host从真实committed doc/clip取得rel/overrides，校验ms/w按固定上游归一化；调用014实际producer→三件文件及依赖核对→issued witness登记→返回原native响应形状|未知key预存三件不因cache-hit补签；按014拒绝或精确key保全隔离+真实重画；JSON clone/foreign/refgeneration变化拒绝|
|GET .../poster 整片last poster|同producer全片(-1,480)生产/配对；保留last非author语义，与当前source证明分开|不能把旧图片称当前已渲染；重开新workspace先新真实生产/证明，不恢复旧witness|
|GET .../media?what=probe|媒体固定probe依014保持FD；pageFacts若会触达page renderer也必须进同producer生命周期|nativecache只作为派生物，不供独立expected；未知副作用保持未证|
|GET .../media?what=wave/poster/frame 非page|复用固定derived producer与014核定media-key/参数规则，读取前后owner/source围栏|晚到字节变化使旧proof失效；不能靠目录名泛白名单|
|GET files/fonts/settings/markers/subtitles、film-origin素材读取|按已登记路径与014正/负/目录依赖供应；不得临时构造第二source facts|源无sidecar却新增不是cache；native directwrite按原策略拒绝|
|GET history/history-files/loudness及未来proxy/export派生|保留原明确能力限制；例如loudness会写独立cache类别，必须先有producer/文件/dependency精确规则与原真实需要case，才能接入created可证路径|未覆盖不能无条件proxy或泛忽略；如果实际原Studio开工所必需，则补依赖且该门保持NOT_RUN，不偷偷删承诺|
|原native document/selection/四hydration事件|认证profile/sequence→S01 acceptMapping pending COMMIT→mapper/Expected→finish/permit/Ack|浏览器观测是观测，不是源权威；事件不能自报epoch/witness|

pool由一个reader实例创建，source closure经authority acquisition传同pool，workspace closure及并行proof也传它。Witness registry属于issued workspace；新代次/关闭/重启丢失，生产wrapper可重新取得真实见证但不能持久化成审批/source权威。所有close/drain与peer browser所有权以014最终实现为准，下一阶段必须有R04/G04/G07消费回归、J03/J04/H02。

## 回退到不兼容binary

关闭新入口不足以安全回退。任何已使用S01的created项目，在缺同authority的旧binary中，bootstrap/prepare/apply/recovery授权/native loaded/Context必须read-only或CAPABILITY_UNAVAILABLE，不走legacy selection0。保留schema/receipt/epoch、原DB/WAL/source/snapshot/Ack与全部日志；不down migration、不delete ledger。只由兼容且独立审查的binary恢复写。Hypit/migrated legacy原行为与已提交receipt仍真实保留，不能为回退改历史。
