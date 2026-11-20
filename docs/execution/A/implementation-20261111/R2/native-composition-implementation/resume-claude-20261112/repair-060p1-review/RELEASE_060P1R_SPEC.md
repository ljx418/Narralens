# MAIN_RELEASE_060P1R_REV3_CUSTODIAN_REPAIR

060P1已交还且经独立代码复核REQUEST_CHANGES（1 BLOCKER/9 MAJOR/1 MINOR），不是P2 PASS。现在批准你作为原唯一Claude实施者，按rev3完整修订并自验证初始轻量门；MAIN Codex不接手实现。用户已明确恢复Claude额度；任何**新的**429仍立即停工报告，不自动重试、重启、换provider或交Codex。旧429和全部失败保留。

W=/mnt/c/workspace/videoworkline/Narralens-agents/main-integration。C=/mnt/c/workspace/videoworkline/Narralens/docs/execution/A/implementation-20261111/R2/native-composition-implementation/resume-claude-20261112/repair-060p1-review。先完整读RELEASE_060P1R.json、ADR_060_REV3_CUSTODIAN_AND_REPAIR.md及binding、060P1R_PRIVATE_CONTRACT.md、REV3_DOCUMENT_APPROVAL.json、rev3-document-review/REVIEW.md、code-review/FINDINGS.json/REVIEW.md、lifecycle-design/REVIEW.md及PROPOSAL.json、PYTHON_ENVIRONMENT_BASELINE.json。这些均已落盘且来源摘要在JSON固定，读完整消息，不head截断。旧ADR rev2保留，rev3明确覆盖对应进程拓扑/修订。

先核JSON base_head/branch/index/现有14文件原字节与7个新文件不存在、AGENTS保护摘要，不reset/stash。逐F01..F11、R3-R01..03实施，原17与ISO18不减；真实新源码只准JSON allow_existing/allow_new，其他helpers/协议共享模块/声明文件需具名向MAIN申请，不能自行写“必要辅助文件”。

## 一次性实施重点

采用目标组外存活的Python标准库custodian C及独占Node/Chrome组N，C唯一waitpid，Host只reap C；WNOWAIT保N锚至最后reap，包含Z，不依赖PID1、死worker或未来timer。固定Python /usr/bin/python3.12 -I -S -B，其本机版本/原字节已给；prctl真实能力尚未运行，不宣称已证明。Python ctypes不调用会启动额外工具的find_library，不编译/安装依赖。两级握手、两管道单writer、FD dup2/close/CLOEXEC、bounded buffers/queue/diagnostic/identity table均按PRIVATE_CONTRACT，不把secret放argv/env/URL/log。

彻底修两个proc parser，把state当state/PID绑定真实spawn/fork；kernel查询gone/known/unknown严格区分；C真实close/reap+receipt+新鲜目标核验才解除execution。所有候选/close/洪水/取消阶段有真实生效截止和锁存outcome，任何已知先发生异常不能变成成功；原native error要有有界结构化事实，Host原primary/cleanup对象不丢。foreign supervisor真实handle也拒，不能只拒{}；失锚不能朝旧组TERM。

F04按PRIVATE_CONTRACT分execution gate与whole production：真实owner入口同步登记queue至settlement的同一责任；supervisor fresh reconcile只解除execution以恢复原bridge continuation，不等父drain也不清整个scope；bridge freeze/drain真实HTTP/source/probe，再endDraw；workspace完成原失败清理或POST、两tree释放与最后guard，真实scope owner一次性私有completion清held后原outer finally同步release，不能裸clear或互等自锁。真实Host-only bridge/workspace inspect/reconcile可达但无新HTTP/DTO；ref过期只允许结束cleanup，不恢复创作权。排队owner.close必须取消未GO且等accepted，获准后重验，重复close共享promise。源error不是源close，保存原error/destroy异常并等真正FD关闭。

默认不新增cache-frame-duration-probe.ts，不擅自替换原probe路由；先写后续Q2事件pilot文件但本票不运行。纠正旧报告的“关闭stdio就能让活child发生close”论证；execFile error callback与真实close/reap不是同义。旧报告不覆盖，以新报告逐项回应原finding。正常TERM-ignore不可退化为永久CLEANUP_REQUIRED。新故障helper用同一个cache-worker-fixture.mjs scenario modes，不复制无谓三份worker。

## 本票运行与证据

JSON十条初始命令全部串行经原run-recorded.py，唯一n1n2-claude-060p1r-* capture。Python语法仅ast.parse，不执行custodian主程序/内核动作；identity整文件测试必须纯解析/实际self身份读取和private issuer校验，不能偷偷spawn helper。scheduler/lock门不运行Host或浏览器。两份新helper只node --check，不执行。生成清单只允许具名--generate单独源生成且只写该JSON，必须真实记录source_changed；runtime期间源字节不变，不在check时隐式generate。

本票**不准**真实custodian/子进程故障/HTTP/Chrome/ffmpeg/probe/fullcheck/build。这些P2a/P2b另发精确票，原全部ISO真实门仍必做，不能拿静态绿叫A04已关闭。所有测试首次执行就使用recorder；开发期失败也保留原命令/exit/inputs/log，不挑绿、不覆盖。P1旧两次未记录失败标UNRECORDED/UNKNOWN，不能补造历史；新反事实另命名新日期。不得提高默认并发/timeout/预算、删旧case、放宽fitness/unknown调用来掩盖问题；新增Host-private调用确需静态登记只做精确条目并留负向用例。

全程headless静音loopback，无用户窗口/焦点，无联网/下载/付费/J盘/配置凭据/.env/fullenv读改；不全局patch共享Host，formal render/V/pin/lock/Approved015/public DTO/EnginePort/源事务保持。新源generation包括py及固定解释器原字节校验；原recorder已覆盖.py，不修改recordertool。

OWN=docs/parallel/lane-product/A-R2-20261112/N1N2-native-source/，输出n1n2-claude-060p1r-*的实际ACK、原finding逐编号修订与有意义测试映射、完整命令/exit/log/输入sha、逐ISO实现/NOT_RUN、私有接口与FD表对应实际行号、剩余风险以及**下一P2a精确命令/fixtures/资源清理步骤**。初始门不过自行在许可范围内修，任何需改架构/范围/预算/保护实体先带证据问MAIN。完成后交还writer/资源worker_done，等待MAIN代码审查后发P2a，无需再向用户要普通实施批准。

禁止git add/commit/reset/stash/checkout/push/merge和实现者自签外审；最终新冻结SHA及独立验收由MAIN组织。Goal止于N1N2全部真正接受后下一接线合同/计划开工门，不提前开S01/NativeAck/Studio/A/V1。
