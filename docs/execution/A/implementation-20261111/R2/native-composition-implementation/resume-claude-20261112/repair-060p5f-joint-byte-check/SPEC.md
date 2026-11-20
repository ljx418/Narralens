# R5F 原范围收口：一个真正读取字节的联合校验器

你是原ClaudeCode实施者，继续R5E交还字节，不reset、不新建替代项目、不重写已验模块。先读RELEASE、START_INPUT_BINDING、MAIN_COMBINED_ADJUDICATION，再读release.findings和同目录REVIEW，以及R5E SPEC/自身报告。MAIN已核验两审95/705读取输入与当前SHA一致、六捕获651输入一致。startup静态safe有companion前提，owner的2MAJOR优先；当前无真实N许可。

本票仍为原八existing路径（含supervisor，仅增加有界私有摘要），无新源码文件。报告只写RELEASE.report；metadata/log按原recorder。原pure guards已经批准且经独立审查，不再重开StageA；保持Node默认deny/精确case脚本/ledger finally隔离、Python全局os/ctypes/signal守卫。不得用默认所有组ESRCH求绿。原始组证明义务与destructive authority分离保持，不改其已闭环逻辑。

## 三个交付组，连续做完再交还

1. R5E-O01：检查每一个被发布manifest行，不能只看candidate/helper。每行必须合法简单文件名、无重复、无error、完整lowercase64hex SHA、完整安全非负整数字节数；不能包含逃逸路径或保留的manifest/final自引用。另要求两个必需名存在，核对candidate实际链接。真实artifactFacts在第三文件events/scenario上单项EIO即使top error=null也必须令producer/main的证据不可靠（failed/faultfalse/authorityfalse/exit3）。默认真实FS read边界注入只在scan阶段发生EIO，别把整份artifactFacts替换后称为实际mapper证据。真要可选项只能明确排除，不可发布error行又忽略。

2. R5E-O02：在现有tools/native-cache-normal-pilot.ts内实现唯一内部实际byte/protocol checker。允许从该工具模块导出一个明确标注internal的函数/类型供现有legacy测试文件和pure测试调用，这不属于Host API、DTO、EnginePort或新源码文件。删除两份消费副本，不保留注释说共享却代码三份。actual main、lifecycle里的实际消费/证据根删除条件、可执行pure consumer测试必须调用同一函数。混合lifecycle文件仍只typecheck不可执行；它改成薄调用，具体checker通过现有pure pilot suite实际运行覆盖。不允许给legacy另写更简化predicate。

checker需读取actual root内final/manifest/candidate和所有发布artifact的实际字节；默认真实FS读取、pure可显式注入byte reader且用真实临时FS覆盖。对三主记录核对fullhash/bytes与outcome.publication、final links、manifest row；对helper及其他列出文件逐项读取/复算/匹配hash+bytes。解析JSON失败、schema缺字段/类型错误、重复/逃逸名称、链接错误、root/mode/protocol不一致、行error、任何mandatory read不可靠均拒绝且exit3，不抛未处理异常、不删除证据。不要只检查digest非null或string。验证当前发布v2契约、原结果、terminal proof、原settlement及最终diagnostic cleanup、report/evidence failures与mode特定结果，而不是只信outcome或final的一个green字段。保持同root独占temp→完整write→close→rename，失败不再写坏final。

明确区分 evidenceReliable / accepted / exitCode（名称可自选但语义固定）：
- normal完整可靠+真实成功条件：accepted=true，exit0；精确1024×0x4a及hash，所有必须事实一致。
- assertion-failure完整可靠+确切EXPECTED_ASSERTION_FAILURE/同一取消主因+null图像+无额外failure+完整terminal：accepted=true，exit1。
- 普通业务失败有完整可靠证据：accepted=false，exit1；不能把这个1当expected fault PASS，main返回普通业务1仍合法。
- mandatory证据/发布/读取/parse/protocol/link不可靠：accepted=false，exit3；旧入参拒绝2保持。
CLI不能读取自己未来OS exit。checker只验证内部协议与真实字节；最终外层recorder/acceptor另核actual observed exit。不要声称内存exit就是outer退出证据。也不能通过把普通failed1一律改3偷换已批准协议。

必须执行的pure反例：真实publisher完成后，使final/candidate/helper或第三列artifact读取EIO/丢失/篡改；实际checker/main拒绝、实际消费调用返回不接受且保留root。合法hash但JSON mode/protocol/link/length错误仍拒绝；ordinary failed1与extra-error fault1不得accepted。正常0/精确fault1保持。所有测试直接调用actual shared checker，不能copy consumerAccepts。actual legacy调用点替换/共享关系用静态断言或直接导入同一checker证明；不要运行混合kernel suite。负向mutation只做安全验证，不还原guard，不触真实OS；首跑recorded，保留真实失败，不能把未达fixture的失败当semantic red。

3. R5E-O03/NOTE02：从supervisor已经计算并验证的receipt/accumulator复制events_digest/waits_digest/identities_digest有界字符串到readonly/frozen诊断摘要，未具备合法值可显式null，不造摘要、不重新构建不同oracle。runner候选/final自然持久化实际摘要。actual supervisor+mock协议例断言这些字符串与实际receipt/accumulator值一致、重复snapshot不会突变/不暴露可变内部对象。报告引用真实捕获中实际digest值和证据位置，不能再说counts满足digest。raw_segments_saved=false保持；完整raw segment/R6不在本票。

## 执行与交还

唯一writer；不改protected7（包括user AGENTS）、Approved015、旧捕获/审查/FAIL/INCOMPLETE。不要git add/commit/reset/stash/checkout/push/merge；不读改凭据/CLI配置。所有六种RELEASE.approved argv的首跑都经unchanged recorder和全新capture_prefix；执行期源不变，不timeout包裹recorder。允许原guarded纯套件/tsc/generate/check，禁止真实C/N/产品fork/signal/wait/prctl、Host/Chrome/media/网络/费用/J盘、Q2/full/build、混合lifecycle运行。generate仅改manifest，最终六命令必须同源且输入无漂移，失败全部保留。观察到新429立即停上报，禁止客户端自动重试/换供应商/Codex接手。

先把以上三组作为同一完整实现批完成；普通实现/测试错误自行修，不在报告文案或已决契约重复等待。无法在原八文件内兑现时先ask给出具体接口最小请求，不静默扩大范围。交还报告需逐finding→producer→实际consumer→测试→捕获、八SHA/保护检查、完整失败索引及限制；只称内部自验证，不能自签独立审查或真实N/N1N2/R6/R7/R8/V1。交还MAIN后冻结字节接受独立受影响复核；安全通过后另发真实N票，后续完整目标不缩减。
