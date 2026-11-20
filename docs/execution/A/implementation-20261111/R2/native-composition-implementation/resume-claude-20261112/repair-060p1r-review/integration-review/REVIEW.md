# 060P1R 独立静态集成复核

**REQUEST_CHANGES**。10项MAJOR、1项MINOR、2项NOTE；不因真实P2尚未运行本身制造finding。22份实际dirty快照文件开始/结束均匹配；HEAD `1d348d419120f23f45d958112ea8c43df5a04675`仅历史base，不是P1R接受提交。适用W及父AGENTS已只读检查，目标子目录无额外AGENTS。未运行产品、测试、custodian、子进程实验、Host/HTTP、Chrome或网络。

## 结论依据

F03的具体supervisor issuer、reserved/start及held/handoff门确已加入；F08入口首await前责任登记、producer共享close promise和获准后draining复核也确有改善。F10 error与实际close分开、destroy异常保存，F11按真实pgid查询均已出现。它们不能证明整个修复已闭环。

|发现|实际代码与反例|
|---|---|
|IR-01 MAJOR|workspace:750–760即使tree receipt=false、mint=null、complete=false仍release；factory:526没有把实际scope交给supervisor，hold不会标根held。PRE/POST真实close失败使service uncertain，却归还全局root/容量，另owner可进入。必须完整阶段结算后才release，未知维持wholeProduction barrier。|
|IR-02 MAJOR|scope:387接受caller手造settled布尔receipt，418消费不标spent。所谓私有completion没有owner/reservation/真实阶段issuer，且可重用。现有scheduler测试自己手造true即mint；这不是公共HTTP漏洞，但直接违反私有能力合同。|
|IR-03 MAJOR|supervisor:698/1223证明函数不读取facts.receipt，run:1180只看DOMAIN_REAPED的kind；未知outcome、错误draw/C/N、ECHILD=false、C异常退出没有成为拒绝门。#terminate还会杀唯一custodian，再以C close+已知组gone结算，不能证明全部后代已reap。|
|IR-04 MAJOR|supervisor:762在latched=candidate时拒绝锁存后来的失败。候选后的缺receipt、协议/洪水/取消事实可能不再有原primary；held reconcile仍可沿candidate成功分支。candidate必须可被失败/取消撤销。|
|IR-05 MAJOR|upstream:1148按producer+root选最后登记项。A执行/held时B同root先登记排队，会让A inspect/reconcile命中B，并把A父drain结果写给B。责任应按实际draw/bridge opaque identity贯穿continuation。|
|IR-06 MAJOR|责任数组只append，outcome保存完整JPEG Buffer，长期producer累计每draw至多8MiB；live scope预算不限制已settled历史。应移除已结大对象、仅保留有界摘要和真实held责任。|
|IR-07 MAJOR|direct bridge无workspace ambient时，由producer取得execution-only scope并在585归还，bridge随后才1546父drain。下一同root生产与producer.close都可能越过旧父资源；bridge必须持有包含parent阶段的完整责任。|
|IR-08 MAJOR|decoder外controlFrames/drawFrames无限push完整帧，绕过其内部未消费buffer限制；三次READY等待又各重置30秒。还缺draw EOF立即转C取消；必须全队列/阶段有界、单个总READY截止。|
|IR-09 MAJOR|故障worker取go.ticket_digest，但Host GO只给ticket，因此先撞PROTOCOL_FOREIGN；foreign HELLO场景也在HELLO之后才选模式。probe用unref interval+未决顶层await不保证保活，测试expect失败无finally可漏child。custodian正常用例调用的是fixture而非真worker，且只看Host组计数，无法证明目标组/Z回收。|
|IR-10 MAJOR|identity纯门:182调用start，supervisor:825立刻spawn `/usr/bin/python3.12 -I -S -B /nonexistent/custodian.py`，并非“什么也没有spawn”。29/29捕获未记child PID/close；源码可证spawn调用，不能据此声称真实custodian/prctl已运行，但报告“无任何真实进程”也不能保留。|
|IR-11 MINOR|workspace:733没有把已有#abort signal传给scheduler；close时队列只能等grant或30秒，虽后续lease门避免late GO，仍未实现及时取消排队。|

机器条目给出精确path:line、可达触发、影响、最小修法与反事实case映射。不会把Host-private接口误说成HTTP可铸造权限。scope/parent/tree问题必须通过真实原责任修复，不能从错误对象flag或裸boolean构造结束授权。

## 实际责任链与未完成处

workspace仍在PRE前取得scope，并包住bridge、POST、tree释放与最终witness；source reader保持对应root准入/交付忙态检查，没有新增generic lease自锁。问题在于阶段receipt没有实权威，completion不是release必要条件。父drain await本身没有递归serving.close自锁，但归属由“最新root”推断且direct bridge过早释放scope，仍破坏同root排他及reconcile可达性。

旧F01/F03/F08/F10/F11的部分修订是静态存在，不能直接改成独立验收PASS；F02/F04/F07/F09仍有上述实质缺口。完整原17及ISO01..18在FINDINGS.json保持NOT_RUN/未整体验收，NEXT仍待N1N2接受后完成。P2测试名字或export数组不等于真实执行/断言覆盖。

## 捕获与新失败证据

独立核对11条实际capture的cmd/result/exit/log SHA256与MAIN_CAPTURE_AUDIT匹配，每份inputs有646项，已覆盖22份快照的源码摘要匹配；MAIN对646当前文件全比较的审计作为其证据引用，本审查没有读取用户配置来重做该部分。现有identity日志29/29、scheduler11/11与m2.1静态门成功，仅证明实际被跑断言；IR-10说明identity不是严格零spawn门。

`n1n2-claude-060p1r-generate-001`是较早许可generation后的同字节重复，source_changed=[]及产物hash匹配，不能宣称捕获了首次mutation。报告§96承认另有两次P1R开发失败未经recorder；这些与旧P1两次失败不同。搜索W/docs、W/var中的060p1r失败命名路径未找到其原cmd/exit/log/input。具体原argv、时刻、日志路径仍UNRECORDED/UNKNOWN；成功capture的argv已逐条存INPUTS/FINDINGS，不能移作旧失败argv。违反“第一次运行前recorder”的事实保留，不补造历史或覆盖报告。

## non-browser P2a前置

先修关键owner/receipt/末端barrier并重新冻结静态检查；修正helper协议/保活和所有真实child无条件finally收割，故意断言失败也须完成KILL/close/reap，UNKNOWN保留根。预先登记真实child身份和唯一owner，独立验证正常成功、预期故障原因、C receipt及实际close/ECHILD/Z，不能任意reject/Host组计数过门。

P2a精确票据须分开非浏览器custodian、真实loopback/源FD、Q2真实ffprobe及注入事件，固定argv/cwd、目录、单heavy slot、deadline和清理回执。当前settlement/witness/reader整文件含浏览器路径，不能把报告§7的全部建议当non-browser授权；Chrome另P2b。固定解释器/Node/worker/policy/integrity原字节及owned HOME/XDG隔离先落实；现有childEnvironment仍沿父HOME/XDG，不能为核对它去读用户配置。Q2默认上游promise保留，真实事件pilot后MAIN才条件批准窄owner，不提前签普遍reap。

本轮所有产品/内核/FD/回收/Chrome/全量与人工运行均NOT_RUN。审查只写本目录三个文件，未改源码、旧报告、快照、Git索引或运行根；INPUTS记录实际读取输入及末尾摘要一致性。
