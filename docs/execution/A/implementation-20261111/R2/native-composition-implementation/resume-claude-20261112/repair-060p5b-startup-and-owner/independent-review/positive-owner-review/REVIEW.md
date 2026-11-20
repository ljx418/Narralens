# R5B 最小 N pilot 持责与启动路径独立静态复核

**REQUEST_CHANGES** — 6 MAJOR，其中 R5B-O06 仅影响 legacy 入口；O01..05 涉及精确 standalone pilot 的安全、恢复或预期故障资格。不能签 STATIC_SAFE_FOR_EXACT_MINIMAL_N_PILOTS。本报告不授予任何 runtime/source release，不是实现者自验或 N1N2 验收。

W 当前9份 dirty 输入起始 hash/bytes 与 INPUT_SNAPSHOT 一致，release 明确保护7份也逐项吻合。绑定 accepted handback **msg_2ff3b08e2fb6 / task_af87a2249ff8 / ctx_f6b0485fe1f0**；前两次 stale R5A worker_done 不作为交还权威。历史 HEAD **1d348d419120f23f45d958112ea8c43df5a04675** 不是新接受冻结。末尾重核所有登记输入；SHA256 与范围见 INPUTS.json。

## 真实调用路径结论

完整读取了新工具与14例 pure test，核对实际 supervisor 的 reserve/start、requestCancel、diagnosticSnapshot、failed-start proof、held/reconcile、原错误及 C 的 census/持续动作接线，而非按报告勾选项认可。

- **O01：原 owner barrier 仍未成立。** root551、constructor579、reserve591、start594 全在 try606之前；registry604才出现，部分建根失败无条目。postbirth异常在catch只 cancel+inspect一次，finally没有等待raw settlement或 fresh reconcile，便能返回。Map保引用不等于继续承担未知资源的结算。
- **O02：预期故障资格与真实错误不一致。** 生产requestCancel1648经 #latchFailure1796创建新 DRAW_CANCELLED，未保留传入原Error；pure StubSupervisor却回同一Error。judge687仅要求任意非空settlementFailure，能把另一已锁存错误当预期；也没要求无image/无unexpected cleanup。held分支634恢复后不读原startPromise，丢原终局结果；catch还覆盖先前原错误。
- **O03：known不是同一live epoch。** observeIdentity217省略state，Z也known；waitForLiveWorker446不比pid/startticks，GO462不绑定pid。可能在原N已为Z或观察错epoch时注入预期故障。应在最后同步cancel前核同一epoch+真实live。
- **O04：报告边界未接线。** reporting537接null stream、单参数wrapper，且从未report；settled738是空等。main的真实stderr写777/784/787绕过边界，未监听异步EPIPE/error/callback。最终判定发生在真实报告之前，不能声称 reporting_failure=null已证。
- **O05：已hold的无worker启动分支仍无法恢复。** actual run proof已区分no-birth+真实close、born/no-authorisation+exit/close；但reconcile1585先要求worker/forkedPid。启动暂时未知后即使C后来真实结束，原promise仍不能通过同一fresh proof结算。不能因此放行已AUTHORIZE但fork/receipt缺失的另一支。
- **O06（仅legacy）：替换入口仍降级。** wrapper用磁盘当前C的hash自签expected值，并以exit或5秒timer作runner清理结束、用Host组数作无fork旁证。两个固定standalone CLI不执行此wrapper，故不要求先跑mixed文件；也不把wrapper retarget当R3-C02/I05已闭环。

精确行号、触发、最小修正及可执行的actual-branch mock反例逐条在 FINDINGS.json。这些是静态反例，未回退/变异执行旧源，不称“捕获旧代码失败”。O01..05不依赖修完无关workspace R7 finding。

## 可保留的改进与证据边界

R3-C04 **部分改善但 STILL_OPEN**：异步无PID error后真实close、failed exec的精确worker terminal wait可以证明失败cleanup，而successeligibility继续拒绝exec=false；完整late recovery仍有O05，错误身份仍有O02。新test976实际驱动supervisor却只断言reconcile继续拒绝，没有证明鲜活恢复后成功返回原失败。

R3-C05的指定缺口可 **CLOSED_STATIC**：worker_pid存在即进入真实census，unknown不会变空；同一 TerminationActions贯穿后续结算，欠KILL会升级，每次signal重新核可用组。新三个单元进入实际 _settle_domain/KernelSettlementOperations，mock proc/wait/clock边界，并非仅FakeOperations。但全部kernel证据NOT_RUN；不据此关闭R6的任意多后代、wait语义、溢出、背压等原发现。

实际requestCancel/diagnosticSnapshot消费者是此Host-private工具与对应测试；未发现它们新增HTTP/MCP/EnginePort权限。foreign issuer检查在副作用前，diagnostic返回冻结副本、已限target表，不暴露ticket/socket/child authority。它仍是诊断而非可传回的清理凭证；不应拿“含snapshot”代替最终域证明。

14例新工具测试真实调用orchestration，但只注入StubSupervisor；它的cancel直接结算为原Error，恰好掩盖生产差异。无constructor/reserve/部分建根故障用例、无catch之后保持pending用例、无真实默认stderr callback/error接线测试。identity测试默认mock spawn在effect前throw；新工具测试mock了child_process避免真实spawn，但不是全真实producer/内核覆盖。

固定CLI仅允许mode与两个hash、Python路径固定、entry guard避免import autorun、正常picture检查逐字节与sha一致，均保留。正常1024×0x4a只是synthetic protocol，不是JPEG/video。源码检查source hash后copy，但目标副本未再hash；最小修法已在O01列出，不把未知可执行输入作为公共攻击面。

## 精确下一门仍未释放

两个具名CLI均保持 **NOT_RUN / NOT_RELEASED**；expected C pin为 **01a3636b890ae4b4c929cd4653ab3af0ec8b96c0d2af1242f298bf209967ae12**，fixture pin为 **e3f4ccb1c4016a54356ce04be344b4ffff23f2f88698efe191570ad8407d03ab**。本轮结论不改变它们。修订源码后须重新冻结/hash/静态复验和MAIN精确runtime assignment，不能沿用旧pin。

先补持久partial registry与无条件终局finally、真实原错误/终局结果、同epoch live注入、实际报告边界、启动held恢复，再评估这两个case。normal须真实exact payload与无unexpected失败；expected-fault只在精确注入、原cancel错误、null image、全部cleanup/receipt/新鲜终局且无其它错误时qualify exit1，不能把任意exit1算通过。OWN §9的“picture_is_the_exact_one（②无picture）”应改为明确故障case **picture=null且picture_is_the_exact_one=false**；summary固定1024参考值须标expected，不冒充该case实际image。

后续真实证据应保留C/N epochs、actual exit+close、receipt summary/段摘要、最后fresh group/known-ID观察及时间序和产物SHA清单。当前工具只存summary/outcome和一个diagnostic snapshot，未另存完整最后fresh观测/产物manifest；在实际门前补齐，不能拿布尔terminal_proof或Host组数代替可复核事实。这里不要求先跑R6的全部负例，不给mixed lifecycle整文件运行许可；C持责不能设置有限expiry，不能为此KILL C或裸杀组。

## 捕获、交还与未验项

MAIN_CAPTURE_AUDIT的19份complete result逐项存在，实际log SHA均匹配；6份最终门绑定当前源（generate仅manifest前值，delta只JSON），早期绿门的source drift按历史保留，不能代当前字节。实际保存的最终日志为 identity68/68、Python46/46、工具14/14；本审查没有重跑。

**python-001：INCOMPLETE/INTERRUPTED，exit UNKNOWN。** claim/cmd/inputs、32字节dots日志与stop-evidence存在，无.exit/.result。stop-evidence只记录作者声称TaskStop ba0m4qsfk成功且无精确PID；MAIN后来bounded/proc无当前匹配不证明历史exit code，缺result也不是processgone证明。不得补造、改绿或重复运行恢复旧日志。

release保护7是权威，本轮允许6源/测试更新+2新增工具/测试+OWN报告；不采用OWN错述旧start SHA或“全部25不变”覆盖release授权与真实snapshot。所有旧报告、失败、stale交还记录均未修改。

仅新增本目录三份审查文档。所有reviewer业务runtime、真实新C/N/kernel/FD/wait/reap/signal、Host/HTTP/probe/media/browser/fullgate均NOT_RUN。R5A C01/C03静态结论不被重开，旧C nofork真实验收仅历史；R6/R7、原17、ISO18、N1N2、A057-04与NEXT全部维持未接受。
