# A05 真实工作台会话入口

基线 cb444229e37d7503daf13c5fd886ea2bfb7d5fd2。MAIN 唯一写入者。当前 BRIDGE 本地素材独立审查已结束，33/33、57项摘要核验通过，仅输入链。

本批允许新增 src/host/agent-driven/workbench-session.ts、相应真实 Host 测试；CreationApplication、server.ts 和 start-runtime.ts 最小装配；新增 src/launcher/workbench-entry.ts 与 tools/agent-runtime.ts 的显式 open 命令。operator私有文件逐代生成，读取复用既有安全PrivateJson和前后实例探针；不自动弹窗。保持31条 CP-A0 Agent路由/schema与原工作台，不新增第二前端根。新入口为Host UI安全传输，不是MCP能力，不能改变任何创作/项目/许可事实。

Host-only operator凭据与driver connection分离。operator通过本机启动器请求一次性短时入口票据，URL fragment传递，浏览器同源POST兑换HttpOnly/SameSite=Strict cookie与CSRF；不在query中携带，不把凭据写入普通诊断。重开可以由operator再取新票据，无需重启Host；普通MCP bearer不可取票，不允许请求指定principal/channel/expiry。UI读会话与续期要求实际cookie，写要求CSRF；本模块不授予任何人类批准。独立实例cookie隔离，重启代际旧凭据失效。

仅loopback+精确Host/Origin，重复安全头拒绝，application/json、严格字段、小体积和有界读取；无外部调用、付费或可见窗口。测试含真实HTTP、票据一次性/超时、普通Agent拒绝、CSRF、跨源、多个实例、关闭失效。生产启动器/浏览器接线未完成前仅标该链部分实现，不签A05/A。

最小浏览器接线允许新增src/app/workbench-session.ts以及现有main.tsx/HostApiClient.ts的会话传输适配，不重设UI/路由/时间轴。fragment在任何异步请求前移出地址栏，不进localStorage；React StrictMode之前只兑换一次。A模式/api/session只声明trusted_ui模式，不返回legacy bearer；旧模式仍按原token行为。当前根页面固定d1-30s的业务入口尚需后续A接线，不能因会话可建立宣称创建工程原生工作台已通过。

安全预审W-S2明确扩展scoped-auth.ts为本批允许公共例外：仅有真实workbench配置时所有trusted_ui读写均需proof；无配置保留旧模式。浏览器sessionStorage只存按origin隔离的CSRF proof，防同IP跨端口Cookie泄露后被直接重放。新增两端口HTTP攻击测试，后续真实headless reload/cookie泄露矩阵；不能把仅cookie加SameSite算隔离证明。

真实浏览器验证新增tests/agent-driven/headless/workbench-session.test.ts，复用已有本机Chrome/CDP工具，不下载依赖；隔离profile、headless/mute、仅loopback、finally关闭自身实例及profile。测试实际生产build页面兑换/清fragment、HttpOnly、sessionStorage重载、忽略续期body后的共享cookie兼容，并真实导航另一loopback端口证明Cookie确实泄露但proof不可读、窃取后读写403。此仅登录传输实证，不冒充原生剪辑或人工体验通过。

同一可信上下文边界的公共例外：agent-http-router.ts在await body后重新认证相同session/principal/channel，使用新principal调用handler，防过期/撤销后仍落人类确认；不变路由/schema/现有验证。实际SQLite intake.confirm慢body两项负向须401且零confirmation，新凭据同操作成功对照。此为会话生产接线暴露的既有边界修正，不新开门、不要求用户逐项审批。
