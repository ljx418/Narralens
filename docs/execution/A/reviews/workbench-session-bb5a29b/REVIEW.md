# 冻结bb5a29b UI登录链独立复验：PASS（限定范围）

**本批UI登录与可信传输链 PASS。** 输入为MAIN实际目录 `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration` 的精确冻结提交 `bb5a29bde02fdc77db6332384ffa3ada80e1259a`。源实现提交 `e6c5773bfd58120ac9abe2b3d5a9126eccfb89b9` 到该候选仅文档计数纠偏，src/tests/package/lock/config无差异。

本人未实现本批MAIN源码，仅只读审查和实际执行授权复验。MAIN在复验期间保持源码/索引冻结。此报告不签A05/A，不签创建工程原生Studio/Run/assembly/影片或人类批准。

## 实际独立命令与证据

顺序执行：

```sh
corepack pnpm exec tsc --noEmit
corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/workbench-session-host.test.ts tests/app/WorkbenchSession.test.ts tests/app/HostApiClient.test.ts tests/agent-driven/integration/scoped-auth.test.ts tests/agent-driven/integration/agent-http-router.test.ts tests/agent-driven/headless/workbench-session.test.ts tests/agent-driven/integration/owned-runtime.test.ts tests/agent-driven/integration/host-application.test.ts --maxWorkers=1 --minWorkers=1
```

- tsc实际exec57042 terminal exit0。
- 指定八文件实际exec41675 terminal exit0，38/38，128.76s：owned runtime/SDK MCP7、工作台会话11、router7、ScopedAuth6、app4、旧client1、原Host1、真实headless1。
- 使用本地Chrome/156.0.8078.80，headless/muted；自身browser/profile/Host/worker均finally退出，未启动headed/外网/J盘/付费或全A重跑。

原命令、stdout、stderr、exit保留在同目录typecheck.* / tests.*；SQLite experimental warning原样保留。没有重跑scanner或MAIN三条旧行为变异，不把MAIN结果伪作本人执行。

## Manifest与构建字节

最终manifest `docs/execution/A/workbench-session-evidence.json` 使用sources字段：19source与62artifact，共81项，逐项比较manifest bytes/SHA256、`git show bb5a29b:path`冻结tree、当前工作树bytes：**81/81一致**，详见evidence-check.json。package/lock/config虽列为source背景，本批相对cb44422未改。

现dist六份实际原构建产物的bytes/hash全部匹配manifest，测试后复核仍匹配，见build-check.json及final-state.json。因此未另build；这不是独立重建可复现性声明。真实headless实际加载的就是这些已绑定原构建产物。

manifest的base cb44422/capture_dirty:true是提交前记录，不是本次冻结源码为dirty。MAIN内部build/38tests/517规则扫描0 findings、三条旧行为变异实际exit1仅作为已核hash的MAIN历史证据，未扩写成独立scanner或独立变异重跑。

## clean与唯一受控测试产物的完整记录

input.json记录开始时精确bb5a29b且porcelain空。指定headless测试自身硬编码生成MAIN `docs/execution/A/logs/workbench-headless-1794256130421/result.json`，这处输出在启动后阅读harness时发现并立即报告；MAIN明确限定允许本次唯一新目录，保持原handle，不改测试/源码、不触碰原tracked三个目录。

post-test-state.json如实记录测试后唯一untracked路径，不声称全过程clean。该JSON为434bytes、SHA256 `63f3e5c9111282eba085fb67cd012df78ac9d53283011f35685770bd8f00fdb5`。MAIN唯一writer核owned untracked后逐字节移动到本目录 `generated-headless/workbench-headless-1794256130421/result.json`；本人再次核bytes/hash完全一致。没有为归档改变冻结源、索引或历史证据。

final-state.json记录归档后HEAD仍精确bb5a29b、porcelain空、六构建产物仍匹配。最终clean核验后明确释放轻/浏览器槽。后续MAIN源码不属于本报告输入；不能用后续dirty状态否认本冻结记录，也不能反过来据本报告覆盖后续接线。

## 安全发现收口

| 发现/边界 | 冻结实现与本次独立证据 | 状态 |
| --- | --- | --- |
| W-S1 renew认证后慢body跨expiry/revoke续签 | body结束后再认证同session，失效401且不Set-Cookie；真实partial HTTP expiry/revoke两负向通过 | CLOSED |
| W-S2 cookie不按端口隔离 | 所有workbench生产trusted_ui GET/HEAD/写均要求origin proof；/session不裸cookie发proof；真实浏览器B端口收到cookie却无A sessionStorage proof，伪精确Origin read/renew均403 | CLOSED（本链） |
| 同instance多tab/丢renew响应 | 单活跃cookie/session/proof在有效期内原位受控renew，不累积64会话；80次续期及operator重开、忽略renew body、实际page reload均通过 | CLOSED（本链） |
| 业务router慢body后过期/撤销仍确认 | await body后重新authenticate并核principal/session/channel，再dispatch current；真实SQL intake confirmation两负向不落记录，fresh成功对照通过 | CLOSED（本链） |

当前没有发现该冻结UI登录链的剩余具体安全阻断。scope说明：会话传输的trusted_ui身份不等于自动生成确认/素材许可；实际open/exchange不会写project或confirmation，headless project_count0。

## 实际源码边界复核

Operator token逐代随机、仅private独立workbench-operator.json，不在driver connection/MCP descriptor中。requestWorkbenchEntry复用真实probe及前后snapshot身份，私密JSON核generation/instance/origin、literal loopback、redirect:error；open只对已验证实例，不擅自launch/自动开浏览器。短时ticket hash-only、一次消费、5min TTL/64上限，严格body和精确Host/Origin/重复安全头拒绝。

Cookie虽HttpOnly/SameSiteStrict，报告明确仍可能被同IP其他port收到；安全边界来自独立proof而非cookie命名。生产CreationApplication启requireUiReadProof；ScopedAuth与WorkbenchSession、legacy /api/session/其它只读及Agent可信UI都验证proof。proof仅存按origin含port隔离sessionStorage/本页内存；ticket/operator/HttpOnly token不入storage。fragment在await前移出地址栏，StrictMode前只交换一次，失效显示固定textContent。

单活跃UI会话避免renew/open累积容量；Host-only renewTrustedUi只允许未过期、未撤销trusted_ui记录，lifetime非递减且不由HTTP指定。revoked旧cookie不能renew，新operator票据可恢复；Host close同步清票并revoke当前会话，后续新代次operator/票据/凭据独立。Browser storage不可用时fail-closed重开，不提供cookie-only恢复proof后门。

ScopedAuth默认无workbench模式兼容旧内部fixture，未据此扩大生产权限。MCP driver bearer仍不能开operator票据、换UI角色或充当UI cookie；legacy A写路径仍fail-closed。真实runtime/MCP复测证明本次新增operator入口未将driver升级为trusted_ui。

## 真实浏览器结果与不证明项

归档JSON实际记录fragment_removed/http_only/reload/lost_renew_body=true；cookie_leaked_across_ports=true且leaked_cookie_read_status/write_status均403，foreign_origin_proof_absent=true。它证明实际已构建登录页的cookie/storage隔离，不证明原生工程编辑区载入。

根页面仍固定d1-30s；新建工程选择/原生Studio真实loaded-version ack、Run/task/local assembly/adoption、正式snapshot render/QC/Delivery、真实授权素材/真人中文录音与60–180s影片、整A恢复/服务报告/人验均未由本批闭环。当前Instance整体仍诚实degraded，不把UI登录当制作ready。

最终结论只覆盖**精确bb5a29b的UI登录与可信传输链**；不自签完整A05/A、不代签人验、不开B。
