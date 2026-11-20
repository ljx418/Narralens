# R5I 真实正常模式失败：先验证终局通道顺序，再最小修复
你是原ClaudeCode唯一实施者，继续原八路径当前字节。读本票RELEASE/START_INPUT_BINDING/MAIN_DIAGNOSIS_AND_RULING，读取normal失败证据、其POST_COMMAND/OBSERVER、原runtime root的candidate/final/manifest/helper.events，和R5H静态审查。MAIN首个真实normal CLI实际exit1，无图、CHANNEL_ERROR control read ECONNRESET；不是expectedfault PASS。C/N确实被独立观察到出生，随后二者原epoch均不存在、两原group只读0探测ESRCH。实际recorder及source651无漂移，所有失败root/log保留。

当前MAIN只读推断，不允许当已证实根因：supervisor onDrawEnd虽然cacheDrawEndFailure(finalizeAfterOk)允许正常finalize后EOF，但仍无条件_requestCustodianCancel；Host先FINALIZE控制C结束domain，N关闭draw时补发CANCEL可能在C控制读循环退出后造成unread bytes/reset，继而正确latch CHANNEL_ERROR。helper已go/answered、没有finalized；不能凭这几条反推完整原始控制帧（未保存）。

先用已批准guarded实际supervisor+FakeChild/协议回调写精确纯反例：区分“完整candidate/closed acknowledged→FINALIZE已授权→draw EOF/C退出收据”与“未授权EOF”。捕获实际control写序列、latch及terminal结果；前者不应再补无意义CANCEL、后者必须失败并有owned cleanup。真实ECONNRESET/EPIPE/child error在candidate后即使有收据也仍须失败，不可忽略、改为warn、吞错误、将资源清理证明当成功。测试自然触达actual onDrawEnd/_requestCustodianCancel，不另写纯oracle。若该假设不成立，给出实际状态/帧顺序的根因而不是照猜改；普通pure诊断仍可本票进行。

最小实现只能修终局状态顺序/幂等性；保留C sole-wait owner、原group/identity/revoked authority、unknown持有原promise、normal无自取消、first error不变、one CANCEL、replacementPID保护、最终实际bytechecker/完整事实合同。不要重写custodian算法或协议，不改protected fixture（它不是通过sleep补时序的地方），不换引擎。不以屏蔽ECONNRESET/加预算/等待到碰巧通过/删除断言求绿。未授权EOF、closed:false/fatal/半帧、foreign receipt、genuine reset-before/aftercandidate、延迟close、fault同原Error等受影响纯反例同时保留。原两20s预算不变，不把新通过当旧mock超时根因已证实。

同票顺手关闭已披露R5H-O01 MINOR：null-baseline参数化tuple直接带真实field key并实际使用，断言target与label一致；candidate receipt_summary/accumulator_summary/terminal_proof_observations和final proof分别覆盖delete/wrongtype/undefined/合法non-null object，显式null ordinary1正控不改。现有production nullable门已静态正确，别改生产来迁就错label。报告计数final27/主record总54，旧report不覆盖，新报告附勘误。

仍只准RELEASE六种FIRST-recorder轻量命令，不可运行真实C/N/CLI或混合kernel suite（MAIN再独立放票）。所有首跑有唯一n1n2-claude-060p5i-捕获，运行期间源不变；generate仅改原integrity JSON，最终完整六命令同源；failed/INCOMPLETE全部留，不timeout包裹recorder、不造PID/exit/rawsegments/无影响结论。安全旧逻辑红灯若用mutant须保存差分与真实sha，仅称mutant，不声称exact历史重放。

源码最多原八existing文件+指定ownreport，无新source。不碰protected7/AGENTS/Approved015，禁止配置凭据/网络/付费/J盘/Host/Chrome/media/Q2/full/build/Git add或commit/reset/stash/checkout/push/merge。真实normal001 root保留，不删runtime evidence、不手工改其内容。新429立即停上报，不自动重试/重启/换供应商/Codex接手。

连续完成精确反例→最小修复→受影响回归+六同源自验再worker_done，报告用实际序列证据区分已证实与推断；不自签真实normal/fault/N1N2/R6R7R8/17+18/冻结/NEXT/V1。交还MAIN受影响独立安全复核，通过后新pin另票normal002，不跳过失败门、不先开fault。
