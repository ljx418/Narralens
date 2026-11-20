# 014：原N1/N2独立审查缺口统一修复释放

精确writer/path/baseline见同名JSON。接受修订提案REVISION1的方向；本文件及MAIN回复覆盖旧草稿冲突。此为原G01–G07全部缺口的一轮修复，不能将缓存生产见证推迟为“后续实现”而声明本票完成。

1. G01 用Host内部实际清理失败的身份账本/标记，普通EIO cause不触发永久不确定；沿closure→authority→reader→迟到raw拒绝合并实际全部cause，不替换或裸FD重试。G02最后callback/await之后立即检查closed/uncertain再同步交付；保留交付后Expected拥有资源规则。
2. G03默认只改authority：固定pinned parser只接收已限额、已保持文本创建的私有不可变解析副本，排空后清理自己的副本，原source最终围栏保留。旧render路径行为和断言必须保持；新增legacy测试只追加，不重写旧断言。新wrapper改动仅G04私有producer factory，不能顺便重写旧read/edit/rev接口。
3. G04 新 native-cache-witness 模块必须是真实固定producer包装器。Witness公开形状/JSON本身不构成权威：包装器以WeakMap/issued品牌证明真实调用与同一workspace/ref/generation，workspace registry拒绝lookalike/克隆/foreign登记；失效与新generation绑定，不新增持久权威。请求rel/ms/上游归一化width/精确overrides/key均参与，三件文件及依赖的内容摘要和identity必须匹配前后已保持闭包。要求deps包含请求rel且都在受控闭包，不允许empty/unrelated自行构造stamp过关。film-poster仅确切配对的已见证派生图片，可以表达last，不表示当前source已渲染；duration仍不得当独立probe事实。
4. 固定pageFrame可能直接命中磁盘cache。未知/未见证的预存三件，不能因为调用了cache-hit分支便签发“生产完成”见证。Wrapper须拒绝该实例，或明确在真实受控预览生产操作中保全并隔离该精确key旧三件，强制实际producer重画并核对返回JPEG与读回文件；不得在reader只读时删除、洗白未知项，不得泛清整个workspace/cache。若选择保全隔离，限定已知key、持有代次与路径，记录旧摘要/结果，失败不得覆盖用户source，所有临时与错误可追踪。任意改一件、伪造正确key/stamp、foreign/generation/JSON-clone均需精准拒绝测试。实际正常producer与原proof失效→新round可接受必须真实执行，手工拼装三件只算负向或算法fixture。
5. src/adapters/openfilm/openfilm-upstream.ts 只允许新增Host内部guarded factory，复用现有fullSHA/clean/pinned-file校验再加载同一固定tree的pageframes.mjs；允许pageFrame及closePageFrames生命周期包装，不改原OpenFilmUpstream三方法合同、pin字段、seam_exports或artifact。记录新增加载文件的实际摘要。固定模块共享browser的事实要纳入拥有者账本：停止单实例准入并排空其实际调用，不能一实例close杀掉另一实例在途render；只由真正Host/最后owner在全部原始调用结束后关闭共享browser，headless不等于已清理。
6. G07明确选择显式、可验证身份的pool实例参数，不是模块进程global singleton。一个reader持有一个pool，源树/工作树/并行proof共享；同pool品牌验证拒绝lookalike。保留独立每closure cap，open前reserve，失败回滚，uncertain close不假退额度。所有目录/空目录、负事实parent分别持有；regular-file nlink>1入场拒绝，创建新外部硬链接也使旧proof失效，目录不套nlink规则。不得宣称所有OS配置下不可能EMFILE。
7. G05真实OS故障子进程与真实成功ffprobe分开标注：不能造成功媒体事实；目标branch命中、version不抢timeout、stdout/stderr独立阈值、真实pid/exit/close/promise/FD顺序可核。G06补真实缺失consumer默认→birth、孤立identity交换、owner/base/control/generation/ref await窗口与真实foreign消费，不接受提前别处拒绝的假覆盖。
8. 提案中的18/34/107不是新增用例后的强制计数。新增用例须实际枚举，pure/component/browser分区互斥且并集覆盖本票全部测试；G04浏览器单列新test文件，原旧文件/旧断言保留。先编译和快速目标，闭环后完整scope；不使用新排除项掩盖失败。
9. 本release仅允许实现及不并发修改时的原记录器串行 `corepack pnpm exec tsc --noEmit` 站立授权。所有vitest/Host/media/真实browser/完整build须fresh MAIN grant，申请应附全变动路径/哈希、实际case清单、精确命令/唯一capture/所有子进程与清理方案。真实browser必须headless静音、只loopback/离线自带资源、CSP/请求控制阻止外联；不得安装下载、更改凭据/provider/config、付费或访问J盘。缺本地依赖明确报告，不能假生成缓存。固定上游launch默认headed=false，不能擅改headed。
10. writer先ACK已读本文件后实施。一次修复包含全部G和原17台账要求；任何不可解技术约束明确保留UNPROVEN并交MAIN技术裁决，不能写成PASS。失败历史完整保留。完成后交回唯一写权，MAIN显式路径冻结真实commit并做绑定commit的独立验收，最后再重锚下一接线合同/计划。本票不授权下一阶段实施。
