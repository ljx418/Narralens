# ADR-A05-003 原生Studio隔离与受控投影（实施中）

A05连续实现，不新开大阶段，也不缩减真实短片/原生改单镜双导出目标。UI会话链精确bb5a29b已限定独立PASS，本ADR仍在内部实现与审查，不据此声明created工作台或A05完成。

## 已发现的真实上游行为

固定e70d9d93...的Studio openProject(create:false)仍写.film/id与.gitignore，并在OPENFILM_HOME/studio.json记录recent。GET有clip的film还会warmFilmPoster并通过host.launch运行Chromium。故不能把author source或immutable snapshot原地交给Studio后称“纯读取”，也不能只因openBrowser回调为空就宣称没有后台浏览器或外网风险。

## 第一实现切面

- 同一Supervisor/原生Studio/原M5 Gateway保留；仅owned A启动器注入isolatedStudioRuntimeRoot，按Host代际分目录。未配置的legacy入口保留。
- Studio服务在独立Node子进程，以私有OPENFILM_HOME/OPENFILM_LIBRARY和OPENFILM_NO_UPDATE_CHECK=1运行，不改HOME或父进程环境。启动key仅通过私有IPC回Host，不进页面、普通日志或DTO。
- 私有root复用已审runtimeRoot：在mkdir前校验既有ancestor canonical，禁止链接root/新路径借祖先symlink越界。测试须断言alias/new从未在外部创建。
- 使用已冻结render guard文件的原SHA256，加载相同offline loader/wrapper与media-process policy，后台poster/frames也必须离线且禁ServiceWorker/WebSocket等。guard未安装即拒绝ready，不能因0帧测试未触发browser而声称非空安全。
- 独立Studio进程组；policy禁止后代自行detached，Host关闭等待leader及受控组结束，必要时只终止自己spawn的组；父实际丢失时IPC disconnect关闭，child有终止自身组的兜底。不能把child.exit等同全部Chrome已退出。
- Supervisor关闭成为不可逆门，等待全部在途ensure，所有await后复查，阻断probe返回后再创建监听。隔离及legacy两支onStudio失败均必须先close实际Studio再允许retry，避免丢失旧监听引用。

## 私有IPC

ready: kind=ready、offline_guard=true、origin（127.0.0.1）、filmOrigin（固定上游localhost或127.0.0.1）、port、随机48位hex key。Parent只接受固定loopback形态和固定字段语义。failed只含枚举stage与固定reason码，不返回原异常/path/provider配置。close为唯一控制命令。此不是MCP工具或任意命令执行端口。

## 后续同批必须完成

committed snapshot读权威→独立可丢弃workspace；Studio元数据/缓存只写workspace，不改变author/snapshot/revision。工作台created读模型允许真实0帧、无伪migration；owner/project/代际授权绑定与native真实loaded版本接缝闭环之前不开放created UI或签native ack。Run/task/assembly/正式Delivery和整A人工报告仍未完成。

## 当前实证与失败记录

r1 typecheck因ForkOptions不存在windowsHide失败，改为固定spawn argv+IPC，不类型逃逸。r2/r3真实pinned启动失败源于parent误把原生filmOrigin限定127.0.0.1，上游实际localhost；按固定pages.mjs事实接受该私有alias。r4/r5真实pinned进程/0帧诊断projection/私有recent状态/实际SIGKILL父断联测试通过。r6 tsc+3files16tests含旧M5 workbench/gateway通过。r7 guard pin键是repo-relative却按render-relative读取，实际offline_guard:ENOENT拒绝，修正为repo根URL解析；原失败完整保留。最新修正的非空guard和关闭/别名负向仍须真实验证，不以先前绿灯替代。

非空r9实际frame请求被已有renderer guard的DNS规则阻断：原生filmOrigin是localhost，而该规则只EXCLUDE127.0.0.1，实际ERR_NAME_NOT_RESOLVED。保持原已冻结render文件不变，新增Studio专用薄wrapper，复用全部离线context/page/process规则，仅将localhost显式MAP至127.0.0.1，其他域仍NOTFOUND/closed proxy。不得改写原生URL造成依赖缓存origin错配。该wrapper同时强制headed=false与--mute-audio；真实非空JPEG与受控本地跨origin sentinel零命中、实际Chrome argv静音无头/同组以及关闭子代测试仍须验证。

r10/r11非空测试已实际产出JPEG、跨origin sentinel零请求且Chrome在本组，但argv静音断言失败。独立诊断r12/r13发现该Chromium会将/proc/cmdline改写为单个空格分隔process title（加末尾NUL），并非正常逐argv NUL数组；实际受控Chrome记录rawMute/rawHeadless均真。断言改为同时支持空格/NUL的精确flag边界，不用宽泛substring、不放松静音/无头要求。原始失败/诊断全部保留，不将其归因于内存或掩盖。

关闭复审补充：Supervisor close先abort所有在途native open HTTP（正常也有30s本地请求期限），再等ensure收敛，防等待永不响应的open导致永远无法收子进程。Host在Supervisor回调收敛后finally统一收Gateway，callback在start后若Host已closing则自行close、不发布新句柄；新Host请求关闭期间503。真实悬挂本地HTTP边界测试必须证明close能退出，不只close-during-probe。

PGID权限修正：父仅在child leader还活着且/proc start identity一致时发group信号；leader退出之后只观察组是否收敛，超时如实报GROUP_NOT_QUIESCENT，不能向后来同数字PGID发信号。child自身在disconnect的强制兜底可终止自己当前组。此不宣称跨进程任意PID数字存在即有信号权限。

当前内部收口：r18实际tsc与4files23tests通过（isolated10、旧Gateway9/Workbench3、Host关闭1）。真实非空诊断JPEG870bytes，SHA256=09d7df475beb66756147ccde1c834e83ce7405c89102ecde438077e0302b63ac；sentinel命中0、实际静音无头、profile私有、观察到的6个Chrome进程均停止。r17单独真实owned runtime/MCP7+Host关闭1通过、扫描523文件0规则命中。r16错误selector host-close.test.ts被Vitest过滤未跑，已明确记录而非冒充第4套件，r17/r18用正确文件补证。物理退出的owned Studio现在下次ensure先等旧会话安全收尾再换新子进程，避免缓存已解析但死亡的startup Promise；新增实际停服后重试用例。

这仅为组件内部证据，独立外审REVIEW_PENDING，Host-specific late callback须随真实created-workspace/Host接线实证；不关闭A05/A，不显示native loaded，不代签人验或进入B。
