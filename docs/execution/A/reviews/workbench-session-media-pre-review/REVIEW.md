# 工作台真实会话：MEDIA独立安全/恢复预审

2026-11-10；审查上下文a_media_independent_review未参与本批实现。基线 `cb444229e37d7503daf13c5fd886ea2bfb7d5fd2`，MAIN工作树候选尚未提交。精确读取字节副本和SHA在inputs/input-hashes.json。MAIN唯一writer；本次没有运行测试、浏览器、Host、工具探针或扫描，没有改MAIN源码/Git/运行根，仅本review目录写入。

结论：**REVIEW_PENDING / NEEDS_WORK；2项具体P2恢复/认证时序缺口。** 未发现现有“跨端口只盗Cookie即可取得proof”绕过。前两项BRIDGE指出的cookie读proof和renew body后复验已确认修复，不重复算未修发现。

## WS-M1 · P2 · 有效会话反复续期耗尽64容量，operator也无法恢复

workbench-session.ts:74-78每次#issue都创建8小时session并保留predecessor，达到LIMIT=64立即503；:37-39只清过期。renew:108-115每次都无条件#issue；exchange:103也依赖相同容量。

前置：一个有效UI session及其proof（不需要operator参与后续续期），在8h内连续renew63次，或等价多次打开/续期。结果：当前session仍可GET，但renew和新的operator ticket exchange全部503；即使operator私有凭据有效，重新打开也不能恢复，须等首批session自然到期或重启。新owner/同代stable proof解决多tab与丢body，但不减少session map增长。

源码路径确定，**本次未执行64次HTTP探针**。MAIN已接受并拟改成同owner/同代复用active session/token，Host-only受控延长未过期/未撤销trusted_ui有效期，维持稳定proof，operator遇已撤销/过期旧session则新签发。方向合理，不应只增大cap或静默抹去仍需恢复的predecessor。

建议：80次真实HTTP renew后再operator取票exchange仍200，map/auth记录不线性增长；并发renew、丢renew body、新tab旧proof、revoke后operator重新打开，旧token不可复活。严格区分body丢失与整份响应头丢失：若浏览器未收到更新Max-Age，cookie自身仍可能到期需operator新票据，不宣称任意丢包后永久可用。

## WS-M2 · P2 · 真实业务POST仍可在慢body跨撤销/到期后沿用旧trusted_ui principal

相邻既有边界 `src/host/agent-driven/agent-http-router.ts:65-103`：body读取前authenticate并保存principal，await jsonBody后直接dispatcher.invoke旧principal；`application-dispatcher.ts:20-23`再将其映射成无expires_at的TrustedCallerContext。intake.confirm等真实可信UI业务已注册。

前置：合法UI cookie+origin proof在有效期末通过请求头认证，body分段发送，在5秒body上界内让cookie到期或被revoke，再完成有效JSON。结果：业务仍可记录可信决定/修改，因为dispatch未重认证，而WorkbenchSession /renew已经正确在body后再次认证。不是仅凭被盗Cookie越权，不声称取消任意已完成业务；是撤销/期限在读取不可信body这一可控等待之后没有落实。

**本次未跑慢body业务复现。** 建议在validated input调用dispatcher之前对同headers和required channel再次authenticate，确认principal_id/session_ref/channel与初始一致，使用当前认证principal；保留初始认证在route/body前，不能为了末尾验证反而提前泄露路由/资源。以真实trusted_ui业务POST分别跨expiry/revoke为负测，断言无content/confirmation/outbox变化。是否已有grant/审批内部期限重验另由各业务事务负责，不能用session复验代替。

## 已成立的源码防线

- operator secret与MCP driver bearer分离，私有workbench-operator.json同代写入，launcher用既有safe PrivateJson+前后RuntimeProbe检查instance/generation/origin；不接受body自选principal/channel/expiry，Agent工具未注册取票能力。
- ticket为256位随机、map仅存hash、5分钟到期、一次性；不在query。browser在任何await前replaceState清fragment，StrictMode mount前只执行一次exchange；operator token、ticket、cookie不进localStorage。只有origin隔离的proof进入sessionStorage，memory作同tab后备。
- 生产workbench配置令ScopedAgentAuth.requireUiReadProof=true，trusted_ui所有GET/HEAD/写均需cookie+正确proof，UI token不能作bearer。被其他127.0.0.1端口收到的cookie缺proof不能读取session/API、不能renew；新service响应不提供无proof引导读。
- boundary检查literal loopback与精确Host/Origin、重复安全头、JSON/content-encoding、1KiB body和5s上界。session/open仅私有operator bearer且拒cookie；exchange接受有效ticket，不把任何普通bearer当UI authority。
- 当前renew在body后重新认证并核session同一性，close期间拒新发票/兑换，close撤销session token并清tickets。owner同Host代proof稳定避免共享cookie更新后其他已有tab旧proof立即失效；不同Host代新secret/proof及scope auth map使旧凭据失效。
- HostApiClient的A模式只取trusted_ui标记及session proof，不取legacy bearer；HTTP/SSE/XHR相应携带proof，不组合cookie与旧bearer。旧无AgentApplication入口仍按旧token工作；生产A legacy写入口依旧拒绝，不因新会话放行原生采用等高风险写。

## 必须保留的限制

sessionStorage不属于cookie端口命名空间，防的是“仅cookie泄漏”绕过；能运行本origin脚本者本来可读proof，不能把它当XSS隔离证明。其他同IP服务仍可干扰Cookie可用性；本次未签所有浏览器攻击矩阵。证明真实浏览器reload、同origin多tab、真实跨端口Cookie泄漏、fragment清除/丢响应行为需要MAIN已预约的headless证据及最终冻结独立复核，不能用Node HTTP手填Cookie完全替代浏览器。

登录只建立transport身份，不自动生成创作决定/许可/Run批准。当前工作台仍有旧业务入口，A原生workbench/assembly/Run/正式Delivery未据本批完成。新session接口、build或headless正常画面不等于A05/A最终验收。
