# 058 统一修复：MAIN 验收门槛（待方案审定，非代码或运行授权）

原冻结候选 `1d348d419120f23f45d958112ea8c43df5a04675`；独立 A/B 结论均 REQUEST_CHANGES，0 BLOCKER / 6 MAJOR / 1 MINOR / 2 NOTE。原17项与批准体验范围不变。Claude dispatch ctx_cb50f012865b 当前仅获只读方案权限，运行与源码写入均未释放。正式实施票据必须在方案审定后另发；本文件不能用作开写许可。

|正式项|修复后直接证明|必要保留的对照/回归|
|---|---|---|
|A057-01 请求边界|独占自有 child 启动真实 pinned serving，原始 TCP HTTP target `//[` 实际到达原handler，返回有界400；子进程仍活着，随后合法素材200；连接、listener、probe真实排空|不使用会预先规范化路径的fetch；已有auth/Host/path/headers/range及文件拒绝原样保留；不能靠全局uncaughtException吞掉异常|
|A057-02 文本首次读取前预算|真实authority和workspace reader分别驱动单项文本溢出与累计溢出，所有底层数据read（含首次hash及verify）都被计数，超额文本在首次读字节前拒绝；实际FD全部settled|原8MiB/总文本、UTF8/BOM/CRLF、媒体流式路径不放宽；只监听readText解码阶段不够；不得把实际数据读取移到计数器之外|
|A057-03 哈希增长界限|外部owned writer在stat与真实hash读之间按barrier增长文件；retainFile/hashFile/verifyFile/verify各自实际命中；最多捕获size加有界增长探针，增长/截短/身份漂移拒绝而非截断成功|要测普通生产方法，不只verifyFileExact；同步guard不能挂在持续EOF；实际读取及清理证据，不靠较短耗时猜测有界|
|A057-04 原生超时与底层排空|真实pinned seek/job timeout，准确记录raw page/context/browser生命周期、真实进程与serving/closure owner，endDraw及输入释放必须晚于真实settlement；另一个合法producer保有所有权，不被Host误杀|Promise.race拒绝、endDraw计数归零、重复调closePageFrames、固定sleep均不是底层结束证明；不能修改vendor/pin或改为永不运行真实producer；无法证明时保全资源并诚实报告不确定，但不能靠永久fail closed冒充成功生命周期|
|A057-05 duration-alone|真实draw film.html ms0→稳定正向reader；只删三件frame triple仍可证明稳定duration-only；随后in-place改film再恢复bytes与mtime，记录ctime确变，fresh reader因历史witness依赖身份变更拒绝|保留最新输出授权、两frame、撤销无回退、非film不能补签duration、last poster语义；不能要求无关历史triple永远在盘来规避此路|
|B01 loader静态门|类方法/constructor/arrow/function expression/初始化及嵌套实际call可枚举；真IncomingMessage taint在各词法scope拒绝，同名非request阴性保留；有实际Host调用点被检查的直接证据|旧alias/namespace/local/helper/capability位置等正反测试保留；不只增加合成vector却继续漏实际类；不声称当前已经存在HTTP vendorRoot可控漏洞|
|A057-06 MINOR 未证派生媒体|正确native media key但伪poster/frame/wave各走实际reader明确拒绝，或由准确固定producer输出证明；区分已证probe/pageframe/film-poster与未证媒体类别|不得削弱R04成“文件名正确就可信”；若明确拒绝暂未支持类别，要保留下一Studio必需GET能力的待开发任务，不偷删目标体验|

## 实施与验证组织

1. MAIN先审定058方案的精确接口、路径和A057-04路线；同一个Claude唯一writer、同工作树增量修复，不重写已通过模块。尚无依据的修法先以精确diagnostic gate检验，不能盲改固定上游。
2. 优先用现有生产接口写能暴露旧实现缺陷的反例。旧候选上的失败必须是所述断言/实际路径而非编译、缺模块或新API不存在；失败原日志保留。若临时切换源码变体，使用自有逐字备份与显式路径，禁止git restore/reset/stash，结束逐字核对恢复；须另有MAIN精确授权。
3. 类型检查与pure/static/真实SQLite、reader/media/owned HTTP child、真实headless producer timeout分区。全部命令用原run-recorded.py唯一capture记录argv/cwd/HEAD/前后输入SHA/真实exit及完整stdoutstderr。未知原因保持未知；不改默认超时/并发/预算调绿。
4. 类型与定向反例通过且源码稳定后，才预约一次完整门禁，包括check、显式build(validator --check)、原Expected与受影响regression。当前fullcheck opt-in REAL_TOOLS仍NOT_RUN；不能把30s诊断片变成中文A片。受影响真实媒体产物重新绑定本次源字节，原坏工件和失败capture不覆盖。
5. 跨fixture/派生缓存规则变动须覆盖原调用者、真实reader、native cache、Expected/Ack、legacy snapshot/迁移和静态loader门。最终按实际影响运行；若不需要完整重跑某独立历史门，必须有明确未改依赖/旧Git tree证据，不伪称当前tip重跑。
6. 资源独占MAIN重型slot；只headless、静音、loopback。每个真实child/browser/listener/temp/FD都登记实际owner，结束清理自身、不得关闭用户或peer资源。未知状态不推断退出；不能仅靠测试总数验收生命周期。
7. MAIN复核逐项case/原17追溯、原始logs与产物hash后，显式路径冻结新commit，再请未参与实现者对新SHA复审。实现者不能自签外审。原候选和A/B报告完整保留。
8. 只有独立接受后，下一接线包accepted_native_commit才能写入，重新核对所有真实签名/DDL/路径/关闭次序并完成独立文档审查；停止在开工门。此轮不实施S01/NativeAck/Studio新接线、不代签人验或A/V1。

## 保护边界与停止条件

用户AGENTS.md、无关dirty/untracked、Git索引、固定vendor/pin/lockfiles、Approved015五个文件及原媒体失败证据不可改。MAIN持有Git冻结权；实现者无push/merge权限。不读凭据/配置/.env/全量env、不联网/安装/下载/J盘/付费或素材外传。新Claude429立即停工并保全，不重试/换provider/Codex接手。遇新公共合同/额外路径请求MAIN精确裁决，不自动越界。
