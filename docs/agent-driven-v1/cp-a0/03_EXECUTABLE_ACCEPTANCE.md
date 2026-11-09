# A轮可执行验收设计（不是执行回执）

2026-11-09；DOCUMENT_CANDIDATE。产品全部NOT_RUN，CP-A0/实现release均NOT_RELEASED。配套机器清单为[acceptance-plan.json](acceptance-plan.json)。本文把步骤、输入、oracle、责任和未来命令落到可审核粒度；未实现的新runner不能直接执行。基线源码fd3021c336387b4c6405b3db08abaafa81c842ff；合同SHA尚未冻结。权威仍是implementation-design/03、04、07、08和R4门，不重写旧冻结。

## 执行顺序与输入冻结

1. MAIN在明确本轮实现授权和具体ReleaseAssignment后冻结生产合同、实现SHA、配置、上游/模型/客户端/机器版本；producer与consumer分别签同一合同hash。检查新工具确已生产注册；不存在即BLOCKED，不调用worker.run替代。
2. 先跑隔离模块正负向，再真实producer→consumer小链；同一组合SHA跑A全场景、适用旧回归与生产构建。模块日志不可相加成整轮PASS。
3. MEDIA提出授权本地媒体和真实中文录音，MAIN核许可并冻结manifest。当前只确认文本fixture及测试poster存在；其真实hash见JSON，均非A成片/授权证明。`fixtures/d1-30s`是旧30秒参考，不能冒充60–180秒验收。没有媒体/录音授权与闭包hash时SELECTION_PENDING，禁止填写伪hash。
4. 待创建的fixture manifest（建议`tests/agent-driven/integration/fixtures/a-fixtures.json`，MAIN保护路径）必须包含每文件相对ref、bytes、SHA256、rights/许可或授权引用、probe音视频时长/帧率/采样、来源、用途；两主题简报、golden和非法/旧输入/过期/取消/无权向量、全新原始DDL和旧库副本。staging/输出不得回写fixture。录音真实非空；额外模型/下载/付费不在A授权内。
5. 媒体选择后冻结一条60–180秒原生逐镜可编辑短片、两个主题创建对照、改前改后snapshot、保留旁白/时长与未改区hash。样片选择理由/章节/镜头和复用摘要留证，不临时规定新时长或质量阈值。

## 命令及路径的真实性

以下现有命令只核过package.json，**本轮均NOT_RUN**：

| 现有命令 | 用途 | 执行约束 |
|---|---|---|
| `corepack pnpm test:contracts` | 既有合同回归 | 隔离模块，待实现后关联新合同测试 |
| `corepack pnpm test:m5` | 既有M5回归 | 不证明R4新组件已实现 |
| `corepack pnpm test:m5:headless` | 既有真实浏览器脚本 | MAIN预约；Headless静音不抢焦点 |
| `corepack pnpm test:wave2:m4c` | 既有恢复回归 | 不证明A创建/交付恢复 |
| `corepack pnpm build` | 当前双bundle生产构建 | MAIN预约；不得绕过M5 bundle |
| `corepack pnpm check` | 当前全量与双构建 | MAIN全机预约，不在文档阶段跑 |

拟新增、尚不存在/未释放的命令接口（参数占位须换成冻结实际值后才可执行）：

| 拟命令 | 未来责任及交付 |
|---|---|
| `node tools/agent-driven/a-run-evidence.mjs --plan docs/agent-driven-v1/cp-a0/acceptance-plan.json --fixture-manifest <frozen-manifest> --evidence-root <isolated-root>` | MAIN新增runner，调用真实Host/MCP/Gateway与生产render，逐case原始日志和失败保留 |
| `node tools/agent-driven/a-evidence-integrity.mjs --evidence-root <isolated-root> --code-sha <frozen-sha>` | MAIN新增完整性门，缺case/hash/独立审查/人验不能全绿 |
| `node tools/agent-driven/a-mutation-check.mjs --evidence-root <isolated-root> --case <case-id>` | MAIN新增负向变异验证，在隔离候选副本执行并记录修复后重新绿 |

这些是拟交付的CLI设计，不是现有package script；具体实现任务须锁argv/exit语义。BRIDGE/MEDIA/PRODUCT模块命令待其释放任务列真实文件路径后填写，当前没有可执行新模块路径可声称通过。既有历史evidence命令只能验证其历史冻结范围，不能更新旧freeze/current-tip来替新A背书。

## A逐项步骤与判据

每行前置为已冻结输入、真实已注册Host/执行器与隔离DB/端口；case状态全部NOT_RUN。机器清单记录逐行owner/package/family。

| case | 实际操作 | 通过门槛 |
|---|---|---|
| A-COLD（AD-T01/32/34） | 隔离空运行根冷启动→重复启动→API未ready→ready→关闭UI→受控停止→重开同实例 | PID/instance/ownership/observed_at；只一实例，关闭UI不删工程；shared不kill |
| A-MCP（AD-T02/03/04/22） | 真实Codex发现工具/资源→读同工程→非法字段/版本/无权→断Host→按Skill重连 | 真实stdio记录与Host日志对应；严格拒绝无业务写；Claude/DSH分别NOT_RUN或BLOCKED不签兼容 |
| A-CREATE（AD-T05/07/27） | 两个不同主题确认简报→创建→同key重放/异内容冲突→初始化关键点真实进程终止→恢复；new与migrated分别重开 | 不同项目和内容，重放同结果/异内容409，初始commit唯一，origin真实；无假迁移或删库恢复 |
| A-FILM（AD-T06/10/11/15） | 授权本地媒体+真实中文录音→固定工作流→样片/首章→原生可编辑60–180秒→选镜准备真实候选 | 每镜asset/proxy/native refs可核；首链所选候选真实映射；比较/拒绝+0；A未交3–6案不得关闭T10 |
| A-WRITE（AD-T12） | 每个现有与新增公开写入口逐一成功对照；分别篡base/source/project/选区/锁/rights/impact/approval/期限/输入及agent human伪字段；并发重放 | 失败source/revision/active_commit/批准消费/成功commit业务outbox不推进；合法拒绝审计可写；确认成功恰+1且重复不再+1 |
| A-ENTRANCES（AD-T02/12/34） | 枚举实际生产registry/HTTP/Gateway/native/worker dispatch/child/retry/resume/runtime入口，对每项在样片/首章/风险待审时调用；再成功对照 | 入口清单与生产注册diff闭合；即使direct task_prepare/另建run/伪独立声明仍服务端拒绝或等待；未实现入口明确unregistered非测试通过 |
| A-EVENTS（AD-T33） | snapshot与订阅间插入提交，重复/乱序/断线重连；cursor篡改/跨项目/过滤器不符/过期/保留窗外；Host提交后延迟或丢nativeack，再发旧ack和正确ack | snapshot watermark无漏窗口、业务去重；签名cursor失败不降级重放，过期resync；Host新值不填ack；仅实际匹配project/revision/snapshot确认同步 |
| A-CANCEL（AD-T09/33） | 准备前/受理后/回报前中断真实CLI；任务取消/重连；旧attempt/输入/审阅回报晚到 | checkpoint/幂等/attempt/lease留证；已知/unknown区分；无重复执行/扣费/提交，无晚到采用 |
| A-UI（AD-T15/32/34/35） | 三视口键盘改单镜；展开顶部Bar/节点弹窗/非模态系统；原区继续编辑；停止健康采样/断线；错误恢复定位 | 1440x900/1366x768主操作可达，390x844仅审阅；5秒采样15秒unknown；Host到DOM p95≤2秒；首次比较≤60秒恢复≤10秒，人验单列 |
| A-REOPEN（AD-T07/08/20） | 导出旧snapshot→只换一镜保留旁白/时长→导出新snapshot→关闭CLI/UI/真实停服→重开同工程再下载 | 两snapshot/manifest/bytes/hash/decode；未改范围及音轨不变；source/revision/history同事实；GET不重渲染 |
| A-COMFY-CATALOG（AD-T26） | 只读识别已授权模板/版本/模型/许可并记录缺依赖；不调用模型 | 目录检查非smoke，未授权模型/模板blocked；B真实smoke/生产闭环仍NOT_RUN |

A-WRITE/ENTRANCES的“全部”必须交付生产入口inventory：Host HTTP/MCP facade/Gateway native/Coordinator调用/dispatch/child/retry/resume/runtime准备；列入口注册位置、冻结版本、同一server gate及对应负向case。尚未实现的B入口记UNREGISTERED并由B重新验收，不能用未存在入口测试PASS填空。检查/health/read不产生媒体执行；准备不写author source。每入口至少成功对照和等待/越scope/旧输入/未授权路径，防止全拒绝伪通过。

A-EVENTS消费本包01/registry候选签名cursor（HMAC-SHA256及scope绑定），冻结前核算法/编码/绑定字段/轮换/有效期向量与注册一致；这里不另造算法或TTL，真实生产密钥管理仍未实现。测试cursor篡1byte、签名错误、跨project/instance/filter、旧保留窗、乱序/重复和snapshot订阅竞态；拒绝或resync结果依冻结错误表，不以统一200遮掩。nativeack来自实际原生桥，分别延迟、旧revision、错snapshot、丢回执、重连与正确回执；job/commit事实不能推进native确认。

## T20-A..H正式导出与恢复（全部NOT_RUN）

前置：真实已提交snapshot，固定config digest、独立受控输出根，正常encode+ffprobe+完整decode先成功。每点记录attempt/PID/exit/staging/final目录、delivery/download/outbox与重启后的事实。

| case | 故障注入 | 通过门槛 |
| T20-A | encode时ENOSPC/写失败 | 明确失败，无ready/download/半成品，原snapshot/source/revision不变 |
| T20-B | 编码非零/截断/坏帧 | ffprobe或完整decode拒绝，QC未完不能ready |
| T20-C | 同snapshot/config并发同key及预置同名输出 | 只发布一个完整包，异输入不覆盖，loser只删自有staging |
| T20-D | 渲染取消后晚到成功 | 子进程/lease停止或持久待收敛，不重发，不ready/下载 |
| T20-E | encode后QC前、publish前、rename后DB前、DB后events前逐点真实终止 | 重启可恢复/明确失败/完整已发布，无DB ready却缺包，无重复发布 |
| T20-F | QC block、附属文件缺失/摘要不符，再修复 | block无交付，正确同snapshot包或明确新attempt，不跳QC |
| T20-G | 渲染同时新revision提交 | 旧job输出仍旧snapshot并显式版本，不能冒充最新 |
| T20-H | 完成后重复GET/同key，重启再下载 | 读取不渲染；digest/bytes/manifest相同，旧包不被重试清理，完整decode |

T20-E四个崩溃点分别留证，真实杀死本次测试自有子进程，不能仅throw模拟。ENOSPC使用隔离故障文件系统或可审计I/O注入，不填满系统盘。并发测试保留winner/loser独立UUID与目录清理记录；正式发布缺bytes/hash/QC/许可/字幕等A已承诺附属项不能ready。B补完整字幕/标题封面/费用与全QC包，A不能签完整V1交付。

## EX-01..23的A/B/C明确范围

全23项保留，A首链安全与交互子集不能关闭后续完整能力。下表“首个交付轮”按详细03的体验增补解释；C全部在长片/三端/完整制作复验。全部业务NOT_RUN。

| EX | 首个交付轮与门槛 | A范围/后续责任 |
|---|---|---|
| EX-01 | A：Agent确认主题、脚本、素材策略、风格；同版本内容Decision持久，relay不授安全权限 | A固定首链执行；B扩展完整创作对象，C长片复验 |
| EX-02 | A：真实项目/审阅链接直达样片；UI决定与Agent读回同ID，无第二次批准 | A固定首链执行；B多候选/多章，C完整制作 |
| EX-03 | A：默认阶段Bar，节点弹窗读真实attempt/输入/输出；关闭不暂停且焦点返回 | A固定首链执行；B完整子图，C长片与全视口 |
| EX-04 | A：固定版本首链样片接受后才过首章门；未接受不派发依赖它的高成本任务 | A固定首链执行；B多章/可复用模板，C长片 |
| EX-05 | A：单章同摘要同规格明确复用审阅；输入/质量改变必须重新审阅 | A固定首链执行；B多章交叉验证，C全规格 |
| EX-06 | B：稳定建议提供真实记录；无可信人确认保留首章门，不按次数自动放行 | A仅安全拒绝/保留现有门，整项不关闭；A安全子case：不存在稳定授权仍保留首章门；C复验 |
| EX-07 | B：稳定授权只省匹配范围首章门，样片/章节/QC/采用仍检查 | A仅安全拒绝/保留现有门，整项不关闭；A无授权不得省门；C完整范围 |
| EX-08 | B：变更模板/风格/模型或撤销后stale/revoked并恢复待过首章门，不误杀在途 | A仅安全拒绝/保留现有门，整项不关闭；A未实现稳定授权不得宣传；C复验 |
| EX-09 | A：单章音画字幕同包同版本，局部定位；接受/修改/关闭分开，封面独立 | A固定首链执行；B真实ASR/TTS/多章/封面，C完整后期；A不签T17/T19整体 |
| EX-10 | A：普通本地准备自动，相同未变待办合并，风险无依据标unknown | A固定首链执行；B费用/provider风险，C负载复验 |
| EX-11 | B：能力组合草稿/校验/发布分开，未知能力/环/缺依赖拒绝且零执行；发布不授执行权 | A仅安全拒绝/保留现有门，整项不关闭；A固定版本模板输入/未知能力/权限拒绝；不签自由组合 |
| EX-12 | A：驱动退出/UI关闭后已授权确定步骤继续；推理点waiting_agent，UI可满足既定门，不启动额外Agent | A固定首链执行；B多分支/多驱动，C三端与长片 |
| EX-13 | B：未执行计划patch列影响；拒绝不变、可信确认后CAS且影片revision不变 | A仅安全拒绝/保留现有门，整项不关闭；A无运行调整入口并验证不能绕门；C复验 |
| EX-14 | B：审阅期间节点开跑则旧patch拒绝重算；无热换/重复dispatch/旧attempt污染 | A仅安全拒绝/保留现有门，整项不关闭；A旧attempt/输入隔离，C复验 |
| EX-15 | B：登记模型按需资源申请/加载/预热，accepted/loaded/warm/ready有独立真实证据 | A仅安全拒绝/保留现有门，整项不关闭；A owned本地Host按需启动/健康，不签模型加载；C复验 |
| EX-16 | A：本地owned/shared/unknown任务边界拒绝破坏；未知先核对，不重复求确认 | A固定首链执行；B真实模型与GPU准备/卸载原子互斥，C复验 |
| EX-17 | A：未授权下载/安装/费用/外传blocked；无能力/许可硬失败不可继续 | A固定首链执行；B真实网络/provider成功与失败；C复验 |
| EX-18 | A：恢复/取消/重连匹配run/plan/attempt/input；旧决定不消费、晚到不采用、查询不重提 | A固定首链执行；B外部receipt/费用未知，C跨端 |
| EX-19 | A：首章/风险门对全部实际副作用入口检查scope/依赖，等待子图无生成；未知入口拒绝 | A固定首链执行；B新增子job/预热/重试/另建run全部重跑，C全入口 |
| EX-20 | B：Agent relay/confirmed=true不能批准活跃RunPlanChange，返回可信确认链接 | A仅安全拒绝/保留现有门，整项不关闭；A同类伪批准不能获得采用/越首章门；C复验 |
| EX-21 | B：计划审阅barrier仅挡受影响未执行子图，不占长期槽；独立分支继续、旧apply拒绝 | A仅安全拒绝/保留现有门，整项不关闭；A首章门阻塞下游，C并发/长片 |
| EX-22 | B：比较真实scope摘要，ID相同也核override/指纹/内容类型；未知不相等、不跨项目继承权限 | A仅安全拒绝/保留现有门，整项不关闭；A批准scope/input/project绑定负向；C全规格 |
| EX-23 | A：一次单章确认并采用，后端决定/批准分离且+1恰一次；纯审阅无写权、过期重审 | A固定首链执行；B批量多章，C长片 |

## 原始证据、失败复现与变异

未来MAIN证据根建议`docs/evidence/AGENT_DRIVEN/A/<frozen-code-sha>/<run-id>/`，当前不创建或写历史evidence。每case存完整argv/cwd/环境白名单/工具版本、code+contract+config+fixture+upstream+machine digest、exit/起止时间、stdout/stderr、before/after source/revision/active_commit/impact/approval消费/idempotency/成功业务outbox、project/run/plan/job/attempt/transaction/snapshot/native关联、媒体与manifest SHA256。脱敏不删除复现必需版本或把unknown写0。

失败记录包括最小输入引用和hash、从干净隔离根重放步骤、预期/实际、故障点、子进程状态、资源预约、清理边界。保留首次失败和重试日志，修复代码SHA另记，不能覆盖原FAIL。结果为PASS/FAIL/BLOCKED/NOT_RUN/REVIEW_PENDING且列原因；文档检查成功只能DOC_VALIDATED。

关键负向至少一次受控变异：移除additionalProperties校验；跳过base/approval/锁之一；让直达任务绕首章门；略cursor签名/范围检查；用Host新值填nativeack；取消后接受旧attempt；跳decode/QC；提前ready；扩大staging清理范围。仅在隔离候选副本逐一变异，既有测试必须非零或明确case FAIL，且对应安全oracle打红；全绿/仅无关报错即验收测试不敏感，应修测试再修复回归。记录mutation diff、测试argv/exit/失败断言及撤销后绿；不把变异放进生产候选、不改旧冻结。

## 资源、时延与人工出口

每worktree独立var/dist/node_modules/DB/staging/profile/端口，不复制/链接可写运行根。MAIN预约全量/多Host/ffmpeg/GPU/大fixture首建，记录所有者、区间、资源容量、清理自有PID；不增vitest默认并发。只读Comfy清单不启动GPU，不访问J盘/下载模型/付费/外传。所有自动化Headless静音且不抢焦点；真实人工窗口由MAIN提前告知。

正常连接Host持久事件→对应DOM可见p95≤2秒，预先冻结样本量/负载/同机时钟，丢失/断线分列并保留分母；不把它当native同步时延。健康5秒采样/15秒无观察unknown/stale。1440×900、1366×768和390×844审阅模式，键盘/焦点/状态播报见R4门。首次定位比较≤60秒、错误出现到正确恢复入口≤10秒，参与者/任务/起止事件和学习后时间分列。精确媒体/字幕容差在CP-B0先冻结，不能临场签质量PASS。

人验：双击自有生产入口→两个主题新建→首端Agent给真实链接→播放60–180秒→样片/首章或显式同摘要复用→选镜换画面保留旁白时长→比较/拒绝+0→确认+1→延迟native见待同步→开系统侧栏继续精修→双导出完整decode→停服重开同工程再下载。人类逐项签结论，Agent不代填。最终同一SHA适用自动/构建/真实媒体/负向/恢复全绿+未参与者独立审查+人验才可称AD_SHORT_FILM_READY。文档审核完成不等于CP冻结、实现授权、产品通过或B/C准入。
