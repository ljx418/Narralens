# PROC-0 独立合同审查

**REQUEST_CHANGES**。请 MAIN 将 G1–G4 合为一次合同、票据样例和案例表修订，再按新摘要复核。当前合同足以确定工具边界，尚不足以让 Claude 无歧义地实现交还资格、分层验收和异常记账。

## G1

定位见 合同 §2、§2A、§4，PLAN 交还步骤，RELEASE_SHAPE，checker.check。

现有 checker 采用 packet 自选的 release 路径和摘要。新命令模板只有空 commands，没有权威 case→command 关联。即使检查 argv 属于全局白名单，另一条合法命令仍可替错误 case 交还。

定义单一明确的外部信任入口（MAIN 指定的 release 路径和摘要），明确 command-release 与 delivery-release 的关系及 recorded_source 映射。按 case 固定允许的 command_id、cwd、argv、capture 或分配规则、expected_exit、证据层与失败凭据。显式允许一套件服务多 case 的对应关系。逐项比对原 claim.name/argv/version、cmd、实际 capture 路径、精确 inputs、log/exit/result 与受保护输入旁证。失败凭据绑定该次 capture、case、输入及具体断言/清理证据；语义由复核者裁决。

验收增量覆盖 PROC0-14/15 加入替换整套 packet+release、互换两个合法 case 的 capture、复用另一运行的非零凭据、额外 inputs 键。均拒绝；授权共享套件可准入。

## G2

定位见 合同 §2、§2A、§5，PLAN 第2–4段，原 recorder 第3–11、24–33行。

原 recorder 强制在脚本所在目录写六件套，capture 只能是 ASCII 字母数字、连字符、下划线。合同同时限定自证文件仅在 var 下，且要求使用原字节及 W 的实际扫描。另有排序循环：交还预检要求完整证据，真实争抢和 helper 退出却须在源码审查后才获准。

明确原六件套在 W 原 recorder 目录的唯一新 basename 写例外；var 仅放状态、旁证与 helper 自有数据。分开 bootstrap FIRST、纯代码候选审查、另票 MAIN helper 验证和最终工具交还。列每层 case/证据/责任人及状态，保留16项；先审源码所需的一级材料可齐，二级待票不签总 ready。FIRST 由原 recorder 直接启动已冻结 direct tests，标明无需新工具给自己发 lease。每个实际运行票绑定类、命令、唯一实际 capture 与源码。

验收增量覆盖 PROC0-03/04/09/13：路径穿越、任一已有 suffix 均被拒绝；源码审查前真实 helper/双客户不能执行，审查后另票记录两个不同请求、一个原 claim/Popen 与胜者真实 wait。

## G3

定位见 合同 §3 的 run、request-cancel、终局、rebind 与 PROC0-06/08/09/16。

短锁边界与多次落盘的优先序未固定。持锁直到 wait 会阻塞取消；从旧 RUNNING 快照写终局会抹掉在途请求；state replace 与 journal 之间中断可能造成两份记录分歧。

指定单一权威 state，锁内提交 STARTING 后再 spawn，短锁释放后保留逻辑 slot 和同一 Popen owner，等待不占短锁；每次更新在锁内重读并核 run_id/generation，合并不可逆 CANCEL_REQUESTED。约定 state/journal 部分失败、PID 身份读取/写入失败、终局保存失败的保守读法。Popen 已返回就由同一 owner 等待；wrapper 死亡或归属不明持 UNKNOWN。无证据不得回 IDLE。明确 end-write 允许记录授权改源后关闭原租约、旧 pin 失效，以及有租约时 rebind 的唯一合法顺序。

验收增量覆盖 PROC0-05/06/08/09/16：注入已返回 child 后读取身份失败、state/journal 各自失败、请求与终局交错、改源后正常 end-write；保原 wait、请求、历史，不重复执行。

## G4

定位见 原 recorder 第27–33行，旧 complete-python-003.exit/result，合同 §3–4。

原始 .exit/result 保存内层 returncode，而 recorder 自己 sys.exit(returncode)。旧记录内层 -15；在 POSIX 上正常执行 sys.exit(-15) 的外层退出码为 241。把两个整数无条件相等会误判；仅见 241 也无法倒推出内层受何信号。

分别记录 recorder 的 Popen.wait、原始 .exit/result 与 release.expected_exit 的定义域。只有完整原件相符时才比较相应的退出码编码；若 recorder 本身被信号结束或原件不全，保留 wait 原事实并拒绝 metadata。expected nonzero 的 case 资格独立核对。

验收增量覆盖 PROC0-10/13：mock 内层 -15/外层241、原 recorder 自身受信号、缺 result、预期1却得到别的失败原因。分别断言资源状态与 metadata 判定。

## 已核边界与历史证据

预约属于同项目协作协议。write lease 表示写入许可，进程状态依原 epoch 与实际 wait，metadata ready 只授予送审资格。PID 重用、Z、无法核明的组或后代保留阻塞。取消只记录请求。保留既有 recorder 和单一 Popen 等待责任，本工具无需引入 subreaper、组杀或超时强制解锁。跨进程排他只有另票在实际 W 文件系统用两客户验证后才能声称。

W 的 complete-python-003 原 result 与 exit 均为 -15，列出六个发生变化的输入；日志摘要吻合。当前 fixture 第2552–2582行用 mkstemp，写入后重新只读打开，调用两次 drain 并检查预算。这段只能支持文件计数路径的静态判断。原 17、ISO01..18、R6 C06–C09、R7、R8 及 NEXT 的停止位置按原计划保留；真实 pipe/晚输出、C09、媒体及人工门仍依原票验收。

当前 R6 packet 为 PARTIAL，其18个交还行均为 NEEDS_REVALIDATION。其引用的旧规范摘要也与当前 W 的规范字节不同；保留原件作为拒绝样例。本文只读审查，未启动任何产品、helper 或运行验收。基线与逐文件审查深度见 INPUTS.json。
