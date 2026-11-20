# 060P1R4：独立无fork身份pilot工具，仅实现与mock自验证

MAIN已核R3+R3A两审37/136输入一致，均REQUEST_CHANGES。全部生产缺陷保留OPEN_PRODUCTION_FINDINGS.json；本票不再同时改整条生产链。原Claude仍唯一实施，MAIN负责设计/独立验收。新429立即停，不自动重试/重启/换provider/Codex接手。

W=/mnt/c/workspace/videoworkline/Narralens-agents/main-integration。读本RELEASE.json及两审R3-C02/R3-I05和原ADR060rev3/privatecontract。仅新增两个文件：tools/native-cache-nofork-pilot.mjs、tests/agent-driven/integration/helpers/native-cache-nofork-pilot.test.mjs；不得修改任何既有源码/测试/manifest/配置/AGENTS，25份受保护字节全保持。无Git add/commit/reset/stash/checkout/push。OWN只新增n1n2-claude-060p1r4-*报告。源码HASH/只读git检查允许。

## 下一体验是一个很小的真实事实门，当前不执行

工具以后独立于Vitest运行，只启动固定/usr/bin/python3.12 -I -S -B <W>/src/adapters/openfilm/cache-process-custodian.py，detached:true，stdio ignore/pipe/pipe/pipe/pipe。不加载任何vendor/浏览器/媒体/Host，不fork目标N，不向任何通道写AUTHORIZE_FORK、GO或任意控制帧。无N invariant是工具结构保证（控制通道只有读API）；不能把这个工具的C终止能力复用于可能已经fork N的生产路径。

计划CLI：node tools/native-cache-nofork-pilot.mjs --mode identity|assertion-failure --expected-custodian-sha256 <MAIN受审当前sha>。只这两个mode；不提供任意可执行文件/argv/脚本/信号/PID可配置项。默认cwd核为W、使用var/native-cache-pilot下唯一mkdtemp owned root，先登记root再任何后续步骤；固定Python原sha e50d468e8b0adfb05733f5b87b3cff34829c4a8c1aea50c865aa8bdfe4bb150f，custodian原sha必须匹配参数和真实固定路径，失败不spawn。全部read-only运行前检查证据落root，不读userenv/config/.env，子环境固定白名单且HOME/XDG/TMP均自有root/private目录，Hostprocess.env不改，不加NODE_OPTIONS/PYTHONPATH。无需浏览器配置。

导入模块不得运行main/自动spawn。export有限helper/class供纯单元注入clock/observer/spawn边界；实际命令main只在自己作为入口时运行。不要依赖TS loader、production supervisor、upstream或包安装。标准库node:child_process/fs/crypto/assert/events等即可。

## 核心：真实的一次性child/error/exit/close账本

spawn返回后、任何await/expect之前，同步注册child/error/exit/close与stdout/stderr/control end/error/data账本；保存child对象、spawned PID、实际fresh proc完整epoch、no-authorize不变量、共享持久closePromise、独立exit/close已见事实（含close先于cleanup），有界诊断。任何结果不靠cleanup时新加close监听。

cleanup返回明确tagged result：closed / no-child-confirmed / unknown，closePromise resolve须是明确closed对象，不是void后与true比较。error不是exit/close；kill抛错、false、超时都不是已结束。重复cleanup共享同一promise且不重复信号/误算结束。

只在这个从未AUTHORIZE的工具中，可对精确issued ChildProcess调用TERM→3s动作观察→KILL→15s确认；每次signal前同步核账本未exit且child.exitCode/signalCode未终端，再fresh proc PID+startticks+PPID/PGID/SID匹配，无await夹在核验与child.kill之间。绝不裸process.kill旧PID/组，不信pid存在就拥有，exit已见但stdio未close只等close/查端点，不再signal。never fork invariant丢失则拒绝信号、UNKNOWN保全升级。

只有实际close且exit/no-birth事实一致、fresh原epoch已gone，才标closed/no-child-confirmed；spawn异步失败无PID也要记录error和真实close，不能因为没有exit事件假挂或因为error直接算关。stream close/error分别记，control read结束不当process结束。

deadline只可触发unknown。unknown时保留完整活owner/原closePromise/root/事件，不删除、不置settled、不process.exit。standalone主程序保持责任并等待真实close，输出一次结构化HELD让MAIN能精确定位，不能timer race之后正常return任Vitest杀runner。未知进程由持有同child的工具负责，不抛出顶层令owner消失；程序被外部意外杀死另记风险，不能称这里解决了所有进程异常。

已证真正结束后可关闭本工具持有的父端，写最终evidence与sha索引，再按正常成功/失败结束runner；证据root作为产物保留，不afterEach rm。失败原error与cleanup对象都存，不吞。单重型槽、真实运行时另精确release，当前不执行。

## 身份与控制读

control decoder4byte长度前置上限16KiB+4，严格UTF8/JSON/C_HELLO protocol@3/seq1/subreapertrue；不累积无限buffer或等待期间丢块。不发送任何数据。stdout/stderr各64KiB累计、8KiBtail，超限失败仍ownedcleanup。30s totalHELLO截止只锁存失败/进cleanup，不是C退出证明。必须保error监听避免异步EventEmitter崩runner。

读真实/proc/<pid>/stat，只按最后右括号后Linux字段解析state/ppid/pgrp/session/starttime精确string，gone仅ENOENT/ESRCH，其他UNKNOWN不假空。校验C_HELLO pid==spawn pid、ppid==工具自身pid、pgid==sid==pid、startticks与freshproc一致。Python真实SET/GET只由将来C_HELLO subreaper提供，不把mock当内核证明。

mode identity正常核对后进finally cleanup。mode assertion-failure在合法HELLO与epoch成立后故意抛已知EXPECTED_ASSERTION_FAILURE，finally完整清理；只有真实观察这个错误+closed+epochgone才可标该fault-case通过，不能任意reject过门。两者均无N/成片/whole-production声明，实际C exit可能SIGKILL（因无N的C恢复逻辑仍持责），不能为这个noforkcase要求创作成功exit0，实际事实如实记。

## 纯mock门，先修真实harness的事件逻辑

使用node:test/assert，注入ChildProcess/EventEmitter/streams/proc/clock边界，无任何真实spawn/kill/fork/prctl/Host/网络。断言真实账本/cleanup/runner函数：close-before-cleanup、exit-before-delayedclose不signal、TERM后真实close不KILL、KILL后真实close、永无close返回unknown但owner/root保留、killthrow、PID复用/UNKNOWN不signal、异步spawn error+close无exit、socketerror、HELLO后的故意断言失败仍close、重复cleanup一次、split/coalesced/oversizeHELLO、有界diag。末尾全局mock实际spawn零调用assert；不要只测试辅助if或复制另一份ledger为oracle。覆盖完整main orchestration通过注入adapter运行，但模块import绝不运行CLI。

## 只准三条命令，所有第一次就recorder

cwd=W，所有试跑严格 `python3 docs/execution/A/implementation-20261111/integration/e1-main-takeover/run-recorded.py <fresh n1n2-claude-060p1r4-name> <argv>`：
1. node --test tests/agent-driven/integration/helpers/native-cache-nofork-pilot.test.mjs
2. node --check tools/native-cache-nofork-pilot.mjs
3. node --check tests/agent-driven/integration/helpers/native-cache-nofork-pilot.test.mjs
失败新名字002/003保留。没有许可的其它运行：不得预跑确认/运行CLI主入口/实际C/目标child/内核/真实信号/tsc/vitest/generation/fullcheck/build/浏览器/网络/配置凭据/J盘；只读文件hash/源检索允许。运行时源冻结，不偷偷把mock替换成真实系统调用。之前多次UNRECORDED是过程缺陷，不补造，本票不得再这样。

交付OWN/n1n2-claude-060p1r4-report.md：两个新文件sha、三门原始captures（含所有失败）、25旧文件原sha全未变、原source缺陷继续OPEN、owner状态/cleanup truth表、nofork invariant、准确下次CLI两条正常/故意断言失败计划、NOT_RUN和风险。worker_done交还sourcewriter，不自行运行真实pilot。MAIN只独立审这两文件与准确noforkcase安全，过门后发实际首pilot；生产N正向与所有生产finding需另修另验，不跨进度。
