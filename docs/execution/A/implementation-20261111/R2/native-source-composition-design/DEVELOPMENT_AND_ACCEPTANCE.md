# 连续实施任务与真实用户路径验收

本设计没有运行tests/Host/media/browser/build/network，也没有启动Claude。下列新case全部NOT_RUN，命令是未来release建议，不是本次许可。最大范围仍为relaunch包A真实中文影片/原生编辑/改单镜/重开/双导出及T20，不变成只有四hydration通过。

## release前MAIN需冻结的三个决定

1. **S-01 shared selection持久语义**：采纳CONTRACTS推荐private epoch账本或给同等真实替代；BRIDGE/MAIN唯一实现者、迁移指纹、历史无账本prepared的对账策略、恢复读取版本行为必须写进精确公共票。未决定不允许normal apply/recovery各塞`()=>0`，也不允许把永久defer算可恢复。
2. **F-01 retained probe能力**：批准仅Host内部parent-PID FD路径、child终止与FD归属、bounded输出/时间和工具固定策略；复用原runtime/资源slot，不改公开DTO/任意root。同时冻结允许的具体native cache文件生成规则与是否允许现有GET history相关派生物；未知cache不靠宽泛忽略调绿。
3. **L-01公共装配和关闭唯一owner**：MAIN合并本设计与BRIDGE ctx410的server/CreationApplication范围，按依赖关闭，晚到grant及reader都在admission账本，DB最后。原cp_a0/NativeAck SQL不改；private selection DDL另审，不能偷偷并入本reader子票。

以上是精确release的技术依赖，不要求用户重复批准已授权A研发；MAIN可以先批准不依赖S-01的reader/facts子阶段，但不得据此宣称整个组合完成。所有阶段最终必须合到同一个冻结组合SHA再独立复核，不能各自半通过替代真实用户链。

## 实施分解与唯一文件owner

| 阶段 | 可实施实体与完成标准 | owner/前置 |
|---|---|---|
| N1 | CommittedSnapshotAuthority私有verified lease；保留render合同/legacy拒绝；NativeWorkspace增加issued-ref/lease；新RetainedNativeClosure与source reader。正负file/dir、同bytes media probe全部真实闭合。 | MAIN精确释放给单一Claude writer；F-01；不得改原Publisher/RecoveryFiles/D10源码。 |
| N2 | loader暴露已批准parse exports；固定pure sidecars供应facts完整；numeric native order/native_rev；fresh vs cached media一致性；预算和异常cleanup。 | 同一writer，N1；pin/artifact变更不在票内，缺export时升级MAIN不直接改pin。 |
| N3 | 真实doc/consumer selection mapper、shared selection authority；Context created分支；Observation round/loaded lease/control baseline/close drain；Ack事务permit。 | S-01落定，MAIN/BRIDGE先交shared authority，PRODUCT实现mapper和observer。禁止两个writer同时改同一文件。 |
| N4 | CreationApplication实际构造、#openNative grant与Context注入、Host shutdown总序；ControlledStudioAccess重入/晚到exchange最终recheck；原Gateway/原Studio读入口回归。 | MAIN单写公共装配。原UI delegate保留跨commit查看能力但关闭/owner失效拒绝；native grant因commit失效。 |
| N5 | 实际Agent受控采用→原Studio→Ack/Contextloaded→选镜改镜/重开闭环；冻结源、全输出、独立审查，再进入A组合人验。 | 依赖BRIDGE正常change.prepare/apply/可信review生产handler和MEDIA真实producer，独占heavy slot。若缺生产handler，标DEPENDENCY_NOT_READY，不用灌表替代。 |

每阶段先精确base/路径/输入/命令/slot release再实施。失败保留原captured inputs和actual exit，修复新capture；Claude429立即停止、核原writer子进程状态并报告，不自动重试/换provider或由MAIN未经本次授权接手。

## 验收矩阵（均NOT_RUN）

| ID/层级 | 真实触发与必须证据 |
|---|---|
| R01 FS/DB | real creation+producer+adoption生成committed source，rich box/style/volume/concept；两个独立树FD与原digest、rights、producer graph/IDs一致。reader.prove成功，legacy未知语义另例仍拒绝。不能手填SnapshotClosure/全部true verify替代。 |
| R02 FS/DB | 源/副本同字节rename新inode、父目录换位、符号链接、same-size写并改回mtime；prove等待中和assertCurrent/Context缓存读取前分别触发。全拒绝，Ack行数+0，旧live loaded清空，FD全部有归属。 |
| R03 FS/DB | 新增/删除style/settings/markers、media旁原字幕/语言translation、缺失目录出现（含空目录）、listing顺序/成员改变；所有negative/directory依赖能指出失败，不因不在旧manifest漏检。 |
| R04 FS/DB | `.film/id`不匹配、未知metadata、probe cache同key伪duration/audio、合法cache晚到、atomic tmp存在；未知拒绝，合法生成使旧proof失效而下一稳定round可证，不能无穷pending掩盖缺白名单。 |
| R05 media/独占 | 对实际授权中文录音/视频held FD执行真实ffprobe，与原生derived规范化逐字段比；字幕末尾/trim长短与真实duration不一致时仍以实际probe为准。probe中源/父目录换位、child慢/挂/异常/关闭时cancel，等待真实exit后才关FD。 |
| R06 pure+真实listing | pinned native_rev五向量；video2/video10/非ASCII等实际numeric collation；caption原readdir顺序独立；同宿主locale/ICU证据。纯向量证明算法，真实FS向量证明供应来源，缺一不得称reader通过。 |
| R07 fault FS | 第N个open失败、ENOMEM/EMFILE/EIO/EACCES、文本/FD/输出预算、构造verify抛错、close第一项失败/第二项重入；保留primary+全部cleanup、sticky拒新proof、其余资源全attempt、绝不重试rawFD。 |
| S01 real mapping | 实际原Studio选择visual/concept同shot去重；narration-only/未知layer/混入unknown拒绝；track依据实际index，overlap全部合法shot；range/fps边界、片尾、0frame/uncommitted无伪区间。截图选择高亮与Context shot IDs/frame证据一致。 |
| S02 DB/lifecycle | repeated same selection不增epoch；不同selection、新session/失效view推进；重启恢复private epoch但无live Ack；missing/corrupt ledger不回0；恢复和正常adoption取同一实际值，不能从plan抄值。 |
| A01 real Host | document+settings+markers但style/captions未证：pending/unknown，Ack+0；browser_preference、unsupported、failed、旧epoch、旧sequence同样拒绝，不能只检查UI显示字样。 |
| A02 real Host/DB | proof各await处改变commit/control/owner/session/generation/workspace/selection；同步final callback重入关闭；permit事务内最后guard失败；Ack+0。用一个受控barrier精准触发，保留真实DB与文件，不能只mock expected返回false。 |
| A03 real Host/DB | 同round并发document/hydration/selection和重复报告；一次permit最多1行，最高ack_seq按真实插入；成功后release失败，历史事实保留但live loaded失效且错误可见。 |
| A04 real Host/DB | cached loaded后改源/新增sidecar/替换inode/control变化/cleanup不确定，再读Context，不发新UI事件也必须不loaded。Context final fence与read之间发生更改也拒绝。 |
| A05 real auth | wrong cookie/Origin/CSRF、native桥直调change、跨owner/project/nativeId、伪workspace_ref、旧票重放拒绝；native UI delegate仅原允许集合。close与open/ensure/exchange/sessionOpened callback交错，晚到不得返回可用grant或留FD。 |
| H01 原Studio/真实用户链 | 见下方顺序，必须真实原入口，不以测试直接method call或端口桩冒充采用与确认。 |
| H02 reopen | 关UI重开同project、commit后reopen、关Host再启动；旧bridge/epochs/proof/receipt都不能自动loaded；新actual document四hydration和选择后才加载。原timeline可继续编辑，不出现第二timeline。 |
| H03 改镜 | 从原Studio选镜→原Agent/影响确认批准→真实单次adoption→源revision+1→同工作台重新打开新source→新Ack/Context。未改镜片段保持，concept/narration仍独立可编辑；直接native写口仍按原受控策略拒绝。 |
| H04 原体验 | 顶部Bar可折叠、节点详情、非模态系统面板、焦点/快捷键/原预览clock正常；缺expected/probe显示未确认而非假完成；job完成、decision接受、commit、loaded四事实分开。 |
| GATE A | 两条60–180秒中文有声片、真实授权本地素材/录音、双导出绑定各自committed snapshot、完整decode、T20-A..H、独立外审和中文HTML截图人验入口；诊断色块/正弦音频、module tests与本设计均不计影片门。 |

### H01可供执行者照做的实际路径

1. 用MAIN配置的原可信工作台会话创建/打开owner项目；通过原登记UI选择已获授权本地视频、中文旁白，Agent由原HTTP/MCP读取inventory，不手输或伪造rights/asset_id。
2. 原Agent内容/脚本/素材/风格决定→原任务produce SOURCE_ONLY；原review.read与可信UI展示真实样片/必要首章合包，用户/已批准scope作真实选择；原change.prepare→批准→change.apply，记录单次revision、原事务/approval/impact/outbox/idempotency。若服务尚未装配，停止此case为NOT_RUN。
3. 原`native.open`进入现有Studio，抓取同project/nativeId的原document及四hydration，点击实际visual/concept镜头；Independent reader自行读快照/实际副本/媒体，不读取浏览器观测值生成expected。
4. 在同一个RevisionStore查询唯一相应Ack历史行，再从真实Context入口读loaded及selected shots；独立比对commit/control/snapshot/source/selection/generation/bridge-session，不仅截图“已加载”。捕获无credentials的event顺序、源和目录identity、probe输入digest、各四part expected/observed摘要。
5. 重复同状态无重复Ack；执行R02/R03/A02/A04负向确认0新增Ack和loaded失效；之后新合法proof恢复，不能通过删除污染文件覆盖失败证据。
6. 执行H02/H03/H04，再将其作为A组合的子证据，不能提前签GATE A。

## 建议命令（未来批准后；本轮未运行）

纯模块回归（现存文件）：
```sh
corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/created-native-ack.test.ts tests/agent-driven/product/native-effective-sidecars.test.ts
corepack pnpm exec tsc --noEmit
```

N1/N2新文件建议（尚未存在；release后才可运行）：
```sh
corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/created-native-source-reader.test.ts
```
其中真实ffprobe/Host case即使叫integration也归重型slot；可将明确纯FS case用精确-t分组，MAIN核对真实命中数量再授予，不擅自提高workers。

真实DB/Host已有回归与新组合（后者待实施）：
```sh
corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/committed-snapshot-host.test.ts tests/agent-driven/integration/created-native-workspace.test.ts tests/agent-driven/integration/creative-context-host.test.ts tests/agent-driven/integration/created-native-composition.test.ts tests/agent-driven/integration/created-native-ui-transport.test.ts
```

真实原生Headless（新组合case必须写入并有精确-t，不只复用旧入口用例）：
```sh
corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/headless/created-native-entry.test.ts
```
managed Studio archive及expected runtime缺失时由MAIN单独核批准artifact并物理复制到本worktree私有root，目的端逐文件hash重验；不链接PRODUCT var/node_modules，不从网络补pin。需要build改变artifact则另票独占重型slot与新的approval，不能借本测试命令安装或构建。

所有capture记录完整SHA/四类输入hash、argv/cwd、actual exit、完整stdout/stderr、probe子进程终止/FD归属、DB/文件前后、原生图像与可复核case ID。每个case明确pure、诊断素材、真实Host、真实素材、真实browser或人验层级；失败/NOT_RUN保留。普通实现缺陷按当前授权修复后新冻结外审；独立者未取得原组合证据不能只看计数签通过。

## 停止与回退

输入/索引变动、跨owner写、pin漂移、权限/资源不足、未配置真实selection/probe/生产handler、Claude429均按实际原因停在该子门，不代填默认成功。MAIN只做明确路径回退其新接线，使状态诚实回到unknown/unconfirmed，保留快照/Ack历史/所有失败；不删账本/用户工作、不reset/stash、不把legacy未知问题移除。

## 与Host恢复联合验收及release顺序（均NOT_RUN）

先由MAIN裁决S-01并冻结新基线/差异、F-01和L-01，再给单writer Native模块票；Host装配票引用已交付真实reader/mapper/selection能力，不写端口桩解锁生产。BRIDGE HC_CORE与Native N4共用creation-application/server，必须合为MAIN装配票或严格串行移交。BRIDGE旧HC_NATIVE_PREREQUISITE的文件名和旧生命周期假设由本设计替代，其他恢复算法与crash范围仍独立。三项core过滤修复以MAIN实际新冻结证据另审，不因在HEAD里出现即计组合PASS。

|联合case|关联既有case|要求新增的可判定事实|
|---|---|---|
|J01 selection恢复与ABA|BRIDGE HC08；本设计S/A/H02|同一authority实例身份；非零plan重启、零plan新session、stale首次抛错后再次调用、缺失/坏账本及迁移；依MAIN选定S-01逐项记录commit或补偿/保全结果，绝无回填plan或零兜底|
|J02 无Studio启动恢复|HC04/HC08；H02|真实pending生产记录在没有原生session/Ack时完成可证明的恢复或有限诊断；健康项目可用，受阻项目gate保留；不得先要求native.open才能解除startup gate|
|J03 close交叉|HC09/HC10；本设计A生命周期|实际接受startup最后一项目扫描、publisher和reader延迟/probe在途后close；新入口拒绝，旧恢复仍可读selection；晚到FD全清、probe真实退出、native停止前根存在、DB不早关；主错误+cleanup错误都保留|
|J04 同根/同库/同实例|HC01/HC12；H01|记录实际DB identity、verifier/task store实例、publication/stage根与native opaque workspace provenance；正常adoption→重启recovery→原Studio→同DB Ack→真实Context，不能用直接SQL代替合法生产前史|
|J05 跨基线与路由所有权|HC01/HC02/HC03|新冻结中确认MAIN三个filter差异、startup reaper真实排除、generic fresh分类；旧未知/错误kind保持合法owner，Reader继承84断言保留；单模块计数不代替Host观测|

J01要求新增私有ledger测试仅在MAIN选择并授权该方案后；若采用无session=0政策，则必须给出跨session防ABA机制及旧published0/nonzero两个分支真实证据，不能删此验收来消除冲突。所有联合用例等待准确argv、命中case数和单重型slot；本任务无继承测试权限。HC07合法多prepared链、HC11真实后继、HC13 SIGKILL与公开prepare/apply生产者仍独立NOT_RUN；本设计不宣布它们可由mock/private方法替代。A影片/双导出/T20/人验限制完全保留。
