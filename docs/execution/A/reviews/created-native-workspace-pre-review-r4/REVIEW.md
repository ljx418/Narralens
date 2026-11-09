# Created native workspace只读预审（未冻结）

输入：MAIN实际目录 `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`，HEAD `6ff718ec7b799fbf24791569be4a01dae86820ea` 加未提交新workspace及app/server接线。精确九份源码/依赖/测试输入见input-hashes.json。本人未运行tests/Host/native/browser/ffmpeg，未改MAIN。MAIN报告tsc/7项通过仅为其内部运行，不是本文独立执行。

当前结论：**NEEDS_WORK（预审）**，两处明确版本复验窗口N-R2/N-R3；N-R1撤回，不作为未修阻断。不新增人工/模块gate，也不签完整A05/A。

## N-R1撤回：漏读已实现的runtimeRoot祖先校验

本审查初始推断“constructor后cache-parent换symlink，再lazy mkdir会先写snapshot后拒”不成立。实际导入owned-runtime.ts SHA256 `9ff6bca28da8f9d9537eda9a013149ef5789616ce98d43066eb91d8872fda8e4` L28–31在任何mkdir前沿已有ancestor lstat并realpathSync拒alias，L32才mkdir。因此简单构造后父alias场景应先拒，不应要求MAIN按误报改生产。

误报来自本人未先读当前导入实现，已明确向MAIN撤回并致歉。真正check→mkdir的跨进程并发TOCTOU没有本人实测，不将它偷换为已证实的原发现。MAIN拟补lazy-prepare实际alias负向可作为对照，但不是本文发明新gate。

## N-R2：prepare缓存命中缺尾部绑定/关闭复验（P2接口版本一致性）

created-native-workspace.ts cached命中分支为`try { await this.#verify(cached); return cached.view; }`。只在进入operation时#check(binding)，没有#verify后的#check。fresh copy分支以及rootFor都有尾部check，只有命中分支漏掉。

确定性调度建议（本人未运行）：先prepare建立cache；再次prepare命中，让异步cache verify期间推进同工程active commit tuple；cache自身bytes不变所以verify成功，当前分支仍回旧revision/root。类似close发生在最后一次#read/close await之后、return之前，也可能回已closing view。应在verify后、return前#check(binding)，不以缓存内容没坏代替active绑定仍有效。

范围：Host后续rootFor会重验，故该缺项不直接证明当前公开URL能打开旧commit；是prepare完成重验承诺的明确接口缺项。当前public created UI/执行commit入口尚未挂，复现可在组件并发真实RevisionStore/Coordinator提交调度中完成，不假称当前HTTP已有任意revision写路由。

初始workspace hash `a2bb191e08c1cba6d81a1b7d7c806147ce5dfbb9feb5647054343e7469a41cf0`。

## N-R3：Supervisor校root后启动/打开期间commit可推进（MAJOR内部实际open版本窗口）

OpenFilmStudioSupervisor.ensure L203先await targetRootOf(projectId)，L205再await #start（真实Studio/Gateway启动），L207使用先前root调用异步#openInStudio；其间仅检查closing，没有再验证该root/binding仍对应active commit。rootFor内部尾部检查只能覆盖rootFor自己的I/O，不能覆盖随后Studio启动与HTTP open等待。

可用现有studioBeforeGatewayPublish gate做调度（未运行）：缓存prepared revision1，ensure启动并在Gateway publish hook暂停；此时推进合法新commit/revision2，放行后当前ensure仍POST旧revision1 workspace。实际旧copy只落.film，不会直接改author；问题是返回旧版本preview，而非自动loaded ack或工程commit。

建议实际open前和HTTP open后都重验本次捕获root/commit tuple。不能只取“当前任意有效root”而不比较本次打开root：若并发新prepare发布了不同workspace，新的root有效仍不能证明刚刚打开的是它。旧copy可依生命周期继续保留到native停，但发生版本漂移不发布旧preview。现native ack仍unknown且public created UI未接，不将此内部窗口夸大为已出现的公开权限绕过。

初始Supervisor hash `d2fec538dad76d55846d7f5f08f555e3676bbc9d8125ad866c2ddc92735eb3d7`。

## Cache权威与I/O边界核对

prepare只接受真实TrustedCallerContext，native_bridge拒，先校created工程owner/origin/active commit与project_state revision/digest及recovery gate，再进行目录I/O；foreign owner负向先拒不建cache。Tuple包括principal、project、transaction、snapshot、source digest、revision，flight按project/transaction/principal收敛；prepare没有将副本写成新revision/transaction。

新copy的唯一内容来源是CommittedSnapshotAuthority.readerForTransaction，真实snapshot closure已核固定pinned engine/SourceDigest/registered fact/entries/rights；cache每个entry再以FD锚定、父目录O_DIRECTORY_NOFOLLOW、leaf regular/NONBLOCK/NOFOLLOW、完整bytes/stream SHA及前后dev/ino/size/mtime/ctime验证。目标wx不覆盖已有文件。Node Studio写.film仅在独立copy，不在author/snapshot；额外.film元数据不当成新的committed事实。

root构造前canonical prospective域重叠检查包含author/snapshot/vendor/隔离Studio状态；runtimeRoot当前在mkdir前拒祖先alias。Root/工作目录均以held fd与canonical路径dev/ino交叉核；路径不用公开DTO回传，PreparedNativeWorkspace是Host-only绝对路径句柄。

缓存坏字节/叶symlink由rootFor拒；prepare可从仍真实证明的snapshot重建，不把坏copy当恢复权威、不变revision。旧copy保留到native停以免删除活动消费者；cache命中仍核原closure每个entry及当前tuple，但须补N-R2尾部check。未发现此次read/copy路径把snapshot/author变成可写root。

## 生命周期/实际接线核对

app.close先令nativeWorkspaces.close停止新I/O、abort并等待已admit operations，保留native仍可能使用的目录。Host再关闭Supervisor；Supervisor等inFlight确保startup callback已收敛，Host随后收取/关闭Gateway，只有确认nativeStopped才closeAfterNative dispose缓存/FD。onStudio局部Gateway在late publish遇#closePromise会立即close并抛，不把晚完成listener丢在#field之外。不能确认native停止时保留copy是保守行为，不以清cache假装终止了native。

MAIN测试源码确有真实HTTP创建→实际Supervisor/Gateway打开、.film只落copy、author/snapshot/revision不变；真实late Gateway publish gate下实际4个listener关闭。上述7项本次仅只读，无独立运行，不把它们扩大成所有IO异常/原生版本已加载的证据。

本A模式targetRootOf只使用已prepared rootFor，不回退legacy author目录；未知/未准备项目拒绝。rootFor无caller是明确Host-only接缝，public created UI/ScopedGateway delegate尚未注册，之后对外必须绑定owner/project/Host代际，不因当前内部lookup存在就视为匿名可打开。Native ack保持unknown，不拿Host revision抄入loaded。

当前模块只是native可写派生工作副本，不是第二时间轴，也不是Run/assembly/adoption。后续新字节须另绑SHA，不签新建工程完整工作台/A05/A或人验。


## N-R2/N-R3修正只读复审（R4未冻结）

输入仍为MAIN HEAD `6ff718ec7b799fbf24791569be4a01dae86820ea` 加dirty，逐文件新字节见r4-input-hashes.json。本人没有运行测试/服务/浏览器/ffmpeg，也没有修改MAIN。当前源码结论：**N-R2/N-R3 SOURCE_ADDRESSED，未见新增具体阻断；冻结独立验证PENDING**。N-R1撤回继续有效，不重复当未修问题。

**N-R2源码收口。** cached分支在`await #verify(cached)`及Host-only after_cache_verify诊断await之后，调用#check(binding)才return view；closing/abort和owner+active tuple均重新验证，与fresh分支、rootFor的完成检查一致。关闭时错误不会被catch降为可返回旧view；tuple冲突的catch随后#check也拒绝，不删除真实旧记录冒充新事实。

**N-R3源码收口。** Supervisor.ensure捕获root后，#start成功/open之前调用#assertSameRoot，真实异步#openInStudio完成后再次调用，再检查closing才发布preview。#assertSameRoot重新经Host targetRootOf→cache rootFor完整验证，并比较current字符串与本次root完全相同；不只证明“某个当前root可用”。因此启动/HTTP响应期间被替换的prepared root不再发布旧URL。A模式workspace root按具体tuple新建UUID，rootFor本身还#check active binding；与legacy固定author路径的含义分开，不宣称该字符串校验能让所有legacy路径变成版本化工作区。

### MAIN运行证据与准确范围

MAIN报告r4 tsc0且11真实集成全部通过。本人已只读核`/tmp/narralens-native-workspace-test-r4.txt`的11/11、47.46s，并逐字节复制到本审查目录main-r4-tests-reported.txt，SHA256 `ca8028b7662b6f21d2ddb3f9ff6b97ae535d3105049a4ca7f16ada84835be430`。这是MAIN运行日志，不是本人独立重跑；本报告不自行补造原exec handle/exit捕获。

新增4项源码case：cached verify后实际close应拒；ctor后父alias在lazy prepare之前被当前runtimeRoot拒且snapshot不多workspaces；实际Studio startup gate期间坏copy重建应拒旧root且旧root无.film/id；真实native-open响应经本地proxy gate后坏copy重建，应不返回旧preview且旧copy确已发生实际native open。

证据界限：N2新增case直接覆盖关闭窗口，并未实测新active commit/revision；N3两case通过损坏cache→从同一真实snapshot重建到新root来验证root identity漂移，断言原commit不变，不是两个合法DB revision竞争。active tuple变化的拒绝由#check源码绑定和这套投影逻辑支持，不能表述为已跑过新revision提交竞争。这个区别不要求新增模块人工门，也不否认这些真实集成case的针对性。

### 生命周期与当前未交付边界

复读app.close仍先停workspace I/O；Supervisor close等待startup/open inFlight，onStudio late publish以closePromise拒并关局部Gateway；native确认停后，再关闭Gateway并dispose workspace/FD，源/索引未变。原测试真实4 listener关闭保留，cache上.film允许但author/snapshot bytes/revision不变。

当前公开created UI/owner+project+Host代际ScopedGateway delegate仍未接，native ack保持unknown。Host-only rootFor存在不等于匿名URL可准备工程；公开入口必须在后续实际接线验证，不能因为本次内部cache/Studio集成通过就签新建工程完整工作台/A05/A。

本次源码复审完成，等待MAIN冻结及明确资源预约后可独立复测；在此之前不启动任何测试或服务。后续新字节须另绑SHA。
