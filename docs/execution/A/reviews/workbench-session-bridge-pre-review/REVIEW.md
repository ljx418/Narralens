# Workbench会话链只读预审（未冻结）

输入为实际MAIN `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`，HEAD `cb444229e37d7503daf13c5fd886ea2bfb7d5fd2` 加未提交工作台会话改动。当前十一份输入见input-hashes.json。本轮本人没有运行测试/Host/browser/ffmpeg或修改MAIN。MAIN exec94198、后续31883等是其独占执行，本报告不以进行中命令或测试源码自签通过。

当前结论：**NEEDS_WORK / PRE_REVIEW**。W-S1定向修正核到；W-S2端口间cookie泄漏需修；MAIN提出的origin proof方案方向正确但尚待实际代码复核。下面不签A05/A，亦不将认证浏览器传输当人类批准。

## W-S1：续期body等待跨过expiry/revoke仍签新session（MAJOR，SOURCE_ADDRESSED）

初始/renew先#principal验证、await body后仅检查closed，再#issue。可在原session expiry前开始合法POST，在5秒body deadline内跨expiry后结束，继续得到8h trusted_ui新session；认证后auth.revoke也类似。已发MAIN具体时间窗，未由本人跑复现。

当前源码已在body结束后重新#principal，并核current.session_ref等于原principal且仍在#sessions，再issue；expiry/revocation/CSRF由真实auth重新评估。MAIN增加实际partial body clock越期/revoke负向，并报告其内部R4/R5进度；本次只读核修法，不替代冻结运行结果。

## W-S2：cookie按实例命名不等于跨端口保密（MAJOR，MAIN接受待修）

生产cookieName已由instance_id派生，因此两个正常独立实例不会简单覆盖同名cookie，不能误报“所有生产实例共用默认cookie名”。但HttpOnly cookie的host/path作用域不包含端口；当前127.0.0.1、Path=/、SameSite=Strict会随浏览器访问同一IP其他端口发送。HttpOnly只限制JS读取，不阻止目标服务从自己的请求头拿到cookie；同site不同port也不被SameSite隔离。

可复现方案（本人未启浏览器）：A真实票据兑换成功后，在同浏览器访问另一个loopback服务B的根路径。B服务器请求头收到A的trusted_ui cookie。B用Node向A GET /api/workbench/session发送Cookie+可自行构造的精确Origin，当前可取CSRF，再以Cookie+CSRF调用trusted UI写路由。它不需要operator文件、原fragment或MCP driver token。该问题是独立本地服务的隔离，不主张单纯公网跨site页面能读HttpOnly cookie，也不把XSS当本问题前提。

初始修正前#principal只要求GET cookie；ScopedAgentAuth对GET/HEAD跳过CSRF，/session直接回csrf，因此泄漏cookie可升级为完整UI transport。已有精确Host/Origin检查抵挡普通浏览器跨源请求，却不能让已获得cookie的另一个本机HTTP客户端无法自行设头。

MAIN接受并计划：有workbench配置的production auth对trusted_ui GET/HEAD也必须校既有proof；/session不再允许cookie单独换取proof。fragment一次兑换返回的CSRF保存在按origin隔离的sessionStorage，所有UI请求（含初始/api/session、XHR/SSE）携proof。只存独立proof，不存ticket/operator/token；旧无workbench内部fixture保留兼容模式。该方案可使B虽见cookie，却无A origin storage里的proof，不能取CSRF/读写UI。需要检查所有production入口都开启该严格模式，不允许仅session端点严格而legacy GET仍裸cookie。

## proof方案的续期/重开一致性约束

浏览器cookie在同instance全部tab共享，sessionStorage逐tab。当前exchange/renew会换token+csrf；新cookie可全局替换旧cookie，但旧tab只有旧proof。如果renew响应header已安装新cookie、body丢失，client仍只有旧proof，而正确禁止cookie单独GET取proof之后不能自动恢复。server仅保留前任token自然到期，浏览器却不能读取/重新发送旧HttpOnly token，因此“保留前任”本身不足以兑现丢响应恢复。

建议有有效ticket时加入已有浏览器会话、取回同一proof，避免每次open踢旧tab；续期保持同一浏览器会话proof或设计有界新旧proof过渡。不要为恢复打开cookie单独GETproof后门。初始fragment兑换可以不要求旧proof，因为一次operator票据本身是独立权限证明。测试应分清跨instance cookie隔离、同instance多个tab及丢响应恢复，不把它们混为同一现象。此是对MAIN已接受修法的接口约束，不额外要求新阶段gate。

## 已核到的正确边界

Operator Secret随机逐generation生成，只写private workbench-operator.json，与driver connection分离；requestWorkbenchEntry使用真实probe前后snapshot绑定id/generation/origin及private JSON校验，literal loopback且redirect:error。open命令不允许launch不存在实例，不自动弹浏览器，只有显式operator输出短期fragment，没有新增MCP取票/任意路径入口。

/open不接受普通driver credential、UI cookie或角色body；票据只保hash、有5min TTL/64上限；exchange消费时同步删票据，不因并发await重复兑换。普通body严格字段、application/json、1KiB/5s bound，重复安全头拒，精确Host/Origin与关闭标记在await后重验。close清tickets并revoke所有已登记session，重开新generation operator/旧cookie失效。

Fragment清理在任何await前history.replaceState，再同源POST；React StrictMode前单次执行，不把ticket写localStorage/日志。main错误仅textContent，未内插秘密/路径。A模式/api/session只回trusted_ui mode、不发legacy bearer；HostApiClient初始GET会话取得CSRF，用cookie而非Bearer，写入需CSRF。旧legacy模式仍保留原token行为。W-S2修法会改变当前“无browser storage”的注释，允许sessionStorage只存origin proof需要同步文档，不能仍宣称完全不存储。

Legacy A模式非GET/HEAD仍被Host #authenticate fail-closed，未因为工作台cookie接入直接开放旧写路径；scoped Agent写仍经现有trusted_ui auth/CSRF和domain owner/gate，未把工作台打开写入confirmation/rights/project事实。生产实例当前整体仍degraded。

## 交付边界

现根页面仍固定d1-30s，runtime catalog为空的新建工程原生工作台选择/加载、Run/assembly仍未接线。这是明确未完成业务入口，不以会话能建立宣称新建工程可用或影片完成。会话测试使用真实HTTP/独立runtime事实可以证明transport，不能证明真实人类按钮批准、资产权利或A阶段验收。之后冻结候选须另绑hash/运行结果，本报告不覆盖MAIN后续新代码。


## W-S2 origin proof及稳定续期修正实际代码复核（未冻结）

最新实际输入绑定proof-fix-input-hashes.json；本人未执行tests/browser/Host，未改MAIN。MAIN先前给出r6/后续验证进度只视MAIN执行，非本文独立重跑。

**W-S1 SOURCE_ADDRESSED，W-S2 SOURCE_ADDRESSED，当前未发现新的具体阻断；冻结独立验证PENDING。** 初始发现及NEEDS_WORK是旧字节历史，不应继续当最新状态。当前修正不是仅加cookie名或SameSite，也没有为了恢复再开放cookie单独读proof。

Production CreationApplication明确传requireUiReadProof=!!options.workbench；ScopedAgentAuth对该模式trusted_ui GET/HEAD也校匹配CSRF，所有scoped agent及旧legacy读同用该auth。server.#authenticate将X-Narralens-CSRF传入，包括/api/session；WorkbenchSessionService.#principal自行要求该header，即使内部默认auth fixture也不会裸cookie取proof。ordinary driver/authenticated channel逻辑不被升级为trusted UI，body字段不能开该选项。

Fragment成功兑换后只存随机proof于按origin（含port）隔离的sessionStorage，并有本页memory fallback；不存HttpOnly token、operator或ticket。HostApiClient.start的/api/session和会话GET都带workbenchProofHeaders，之后fetch/XHR/SSE均带同proof。旧tab reload从相同origin的sessionStorage取回proof，兄弟端口服务无法因cookie可见而读取A的sessionStorage；在没有proof情况下不能从/session取回它，也不能读legacy A-mode或Agent trustedUI路由。浏览器拒storage时仅本页内存工作，reload须operator重开，是fail-closed而非cookie恢复后门。

WorkbenchSessionService的browserProof在该Host service lifetime固定，所有同operator principal签发/续签的cookie仍随机独立、session_ref独立，但共享同proof。ScopedAuth.issue只接受Host-only第二options.csrf，限定trusted_ui且严格43字符格式；未spread进principal，HTTP body不可传。新cookie替换后，旧tab已有proof仍匹配；renew body丢失但header新cookie生效时也能用旧proof恢复，不依赖旧HttpOnly token可读。Host重启后proof/ticket/operator及auth内存全部新生成，旧generation无效。

新增测试源码明确新renew cookie+旧tab proof GET成功；偷cookie的另一个loopback服务模型尝试/session、Agent read及renew失败。该HTTP测试通过Node显式转发Cookie模拟已被兄弟服务读到的凭据，不是本人跑真实浏览器cookie jar泄漏实验；标准cookie不按port隔离的原威胁仍真实，保护来自独立proof。真实headlessreload/fragment结果由MAIN单独提供，不据测试标题签浏览器完成。

一个低影响注释项已提醒MAIN：src/app/workbench-session.ts仍写“No browser storage”，应改成仅proof使用sessionStorage、票据/凭据不入storage，与实际安全边界一致。它不是阻断，也不要求另开测试gate。

本轮实际启动接线仍为显式operator open→一次票据→cookie+origin proof。新建工程原生工作台/d1-30s替换、Run/assembly、素材UI权利与A成片仍未完成，不随transport源码修正通过而闭合。后续冻结需另绑字节和真实运行证据；不自签整体A05/A或人验。
