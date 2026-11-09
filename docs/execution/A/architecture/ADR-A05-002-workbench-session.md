# ADR-A05-002 工作台入口与可信浏览器会话

状态：A实现内部候选，生产安全传输接线；独立审查待完成。不改变CP-A0的31条Agent路由，不授予创作批准。

## 事实与目标

旧A测试直接调用auth.issue(trusted_ui)属于测试装配，不能证明用户能启动工作台。driver connection.json只持authenticated凭据，不能拿它申请或模拟人类决定。创建工程原生工作台、Run、装配与Delivery仍需后续生产接线。

## 决策

1. owned runtime每代生成独立operator随机凭据，600私有workbench-operator.json，绑定instance/generation/origin。MCP连接文件/工具不包含它。明确这是本机operator边界，不承诺隔离同一OS用户的任意进程文件访问。
2. launcher显式open动作复用实际实例探针与安全私有文件读取，前后验证实例身份；只对该loopback origin发固定POST。响应只接受当前origin的根页面fragment和5分钟内期限；不追重定向、不自动弹窗、不产生付费。start/status普通日志不含此入口。
3. /api/workbench/session/open仅operator凭据可调用，严格空JSON，无body角色/身份/期限。票据256位随机、只在内存存SHA256、5分钟、一次兑换、最多64张，重开重新申请而不重启Host。
4. 浏览器在React挂载前同步清除fragment，然后同源兑换HttpOnly/SameSite=Strict cookie；不进query/localStorage。8小时session、CSRF写保护；生产cookie按instance隔离，重启旧session无效。
5. GET会话只接受trusted_ui cookie；renew还须CSRF，await读取body后重新认证并检查同一session，拒绝到期/撤销边界。已成功续签的前任保持自然过期，防丢响应导致锁出。最多64个当前session，过期清理；关闭service撤销其cookie会话并拒绝在途晚到兑换。
6. 精确loopback Host和Origin/同源Referer、重复安全头拒绝、严格字段与JSON类型、小body上限1024B、绝对5秒读取期限、no-store、错误不回显秘密/绝对路径。
7. A模式/api/session不再返回旧bearer，只返回trusted_ui模式。原HostApiClient消费cookie/CSRF，旧非Agent入口仍按原bearer行为。旧写路由在A仍禁止，不能因为UI登录绕过Coordinator或批准门。

## 验证与限制

真实HTTP兑换/重放/错误权限/跨源/期限/撤销/续签与真owned runtime重开/重启测试。原失败日志保留：r2为5/6通过，唯一失败是测试查错表名，并非产品拒绝。r3为6/6通过；r4 tsc与5文件19项（含actual runtime/MCP）通过。独立预审发现renew在await body后不重验过期/撤销，已补两条真实分块HTTP负向，不把旧绿灯当新门通过。

当前根前端业务仍有固定d1-30s入口；本ADR只证明可信会话传输，不能关闭A05、A06、原生ack、整A、人验。回退可禁用workbench配置与新UI会话入口，保留原legacy启动入口与事实；不删除项目/DDL/快照，不重置历史。

## 独立预审修正：同IP不同端口不隔离Cookie

按instance命名只避免覆盖，不能阻止Cookie被其他127.0.0.1端口收到。因此有workbench配置的生产ScopedAuth对trusted_ui所有方法（含GET/HEAD）强制校验既有CSRF header；UI会话读取也始终要求证明，Cookie单独不能领取CSRF。fragment兑换后仅CSRF proof保存在按origin隔离的sessionStorage，重载后继续使用；不保存ticket/operator/HttpOnly cookie，不使用localStorage。现有客户端首次/api/session、会话读取及后续请求都带proof。无proof的同IP其他端口即使窃取Cookie且伪造HTTP Origin，也无法恢复proof或读写trusted_ui。旧非workbench测试/入口的Auth默认模式保留，若提供csrf则始终验证，生产配置fail-closed。后续同源XSS属于不同威胁，不能声称sessionStorage隔离同源恶意脚本。

同一代Host的同一operator owner使用稳定随机browser proof（由service生成，Host-only auth.issue第二参数注入，不进入principal）。不同会话cookie仍随机，跨tab/sessionStorage原proof可验证续签后的共享cookie；即使浏览器已装新cookie而续签响应body丢失也不锁出。重启后cookie及proof均失效。此证明不是单独bearer，必须与同一owner有效cookie一起使用。原生film未来必须保持可信UI与执行内容隔离，不能把可执行的用户film作为同源可信UI脚本加载。

## 容量与恢复修正

原每次open/renew新增session会在64次内耗尽，导致operator也无法重新打开。当前同一owner/代际复用单个活跃cookie/session/proof，Host-only renewTrustedUi只对未过期、未撤销的trusted_ui凭据更新冻结principal的expiry副本。续期固定Host的8h期限，不取body lifetime。操作员新ticket可替换已撤销/已过期会话；普通旧cookie不能自我复活。保留ticket64上限，不通过扩大session容量解决。新增80次真实HTTP续期后同session且operator重开200、撤销后必须新ticket复原用例。此修正取代上文“每次产生新cookie/保留全部前任”的早期候选描述；稳定cookie仍必须伴随origin proof，每次请求仍重验有效期。

业务AgentHttpRouter同样在await request body后按原headers/channel重新认证并核同principal/session/channel，防旧trusted_ui context在凭据过期/撤销后进入真实intake.confirm。接近同步业务调度的认证不等于延续任意长期任务权限；长期任务仍依已绑定Run授权、lease/fencing与提交时具体事实检查。新增真实SQLite确认负向与新有效凭据正向，不只证明renew。
