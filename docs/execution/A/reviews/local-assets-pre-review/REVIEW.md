# A05 本地素材登记只读预审

输入：实际MAIN `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`，HEAD `d15e44d1d9739febdc0f47e260b06b4a3881ab1c` 加未提交新localasset模块。精确输入见input-hashes.json。本人未运行测试/Host/ffmpeg，未改MAIN。MAIN exec84370是其独占单worker验证，不属于本人运行。

结论：**NEEDS_WORK（未冻结预审）**。下述三条具体源码路径已发MAIN，不签本地输入链/装配完成或完整A。

## L-R1：存储根未排除snapshot命名空间（P1配置隔离）

LocalAssetRegistry constructor只比较storageRoot与projectsRoot，未接收/检查Host snapshotsRoot。若配置storageRoot为既有snapshot/source或其子目录，只要私密权限满足runtimeRoot（实际启动器umask077可满足），constructor会在immutable snapshot里mkdir objects/staging并发布输入blob。Host-only配置可以决定允许输入根，但不应越过本批明确的author/snapshot隔离约束；不能依赖常见fixture的0755恰巧拒绝该配置。

可复现方案（未执行）：使用私密临时Host根创建真实snapshot，在新LocalAssetRegistry配置storageRoot为该snapshot/source或其下新目录。它在projectsRoot外，因此当前guard不拒，创建objects/staging改变snapshot闭包。建议传Host固定snapshotsRoot与其他保留写域，在创建任何存储目录之前核canonical重叠。至少拒存储树落入author/snapshot，且不要通过祖先别名/根漂移绕过；实际允许包含关系可按Host布局决定，不临时把全部runtime父目录一律拒绝。

## L-R2：catalog读取的exact keys漏source（P1当前功能阻断）

LocalAsset构造包含source；#row的keys却期待`asset_id,attestation,bytes,license,media,project_id,registration_digest,rights_ref,sha256`，遗漏source。首次insert可回asset，但下一次list/replay/resolve会因多出的合法source属性抛REVISION_CONFLICT。现首正向list、幂等及并发case足以覆盖，不能通过删source事实或放宽其hash来调绿，应修正合法字段集合并保留不可变facts核验。

初始绑定registry `6ec401253872de4f146f5bc44723ec07978e89001ab913108fa6d02ab03fd3b3`。已只读看到MAIN main-local-assets-r2 tests.exit1、3failed/8passed；这不是本人执行，也不自行把3项失败全部归同根，具体修复依MAIN真实失败日志。原fail保留。

## L-R3：允许source根每次重解析，未固定批准范围（P2路径边界）

constructor未核/保存sourceRoot canonical身份；每次import执行realpath(resolve(options.sourceRoot))，然后以该新结果作允许根。配置`/allowed/input`后若目录改名并换symlink指向另一目录，relative_path在新目标下仍满足realpath(path)===path，即可读新目标；拒子路径symlink不能保护根本身漂移。

建议初始化时固定canonical source root（明确初始alias是否允许），之后核配置根仍在批准路径/身份，根缺失或alias/替换变化时拒绝，不静默扩大范围。保存不可变配置快照，避免后续直接修改options.sourceRoot同样扩大根。此问题基于本批已使用的外部文件漂移/alias模型，不宣称普通MCP能改Host配置。未运行根替换测试。

## 已核正确边界

- 调用者必须有真实TrustedCallerContext brand；注册还需trusted_ui channel/source，native/authenticated driver不能登记权利。工程须当前owner且已提交created origin，先权限再读源。input复制canonical JSON并冻结caller快照，内部枚举/精确key/hash/相对路径校验先于导入。
- 原始operation_idempotency单表/同RevisionStore连接；requestDigest绑定完整input及principal。同key重放先owner/可信UI检查，再核原ledger digest及catalog事实，回原回执，不因源文件后来缺失重导入。不同key但同registration core复用同asset，不伪新attestation；asset_id截断digest但校完整registration_digest/core，碰撞拒绝。
- staging独占wx0600、源fd NONBLOCK/NOFOLLOW/regular及最大bytes，复制时hash和前后fingerprint，实际探测解码私密staging而非外部路径；导入后再hash。以link no-clobber发布内容寻址blob，已存在目标须同hash，实际fsync blob/objects/root后才SQL。
- SQL原子边界同库写immutable catalog、原ledger response、业务outbox；fault逃出会回滚。末尾核blob inode/size/timestamps未变并复核owner/schema/abort；异常只清本次UUID staging，遗留未引用blob不自动变素材。created_local_asset固定DDLnamespace首验且schema_version漂移复验，immutable触发器无update/delete。
- media固定ffprobe/ffmpeg及本地协议/format白名单，无shell/provider/任意命令；视频复用真实CFR/完整视频decode，音频要求唯一audio/no video、真实时基/采样率/声道及全量audio decode。权利status unknown/restricted和recording_origin synthetic/unknown保留，不因成功decode自动cleared。derived lineage要求本工程已有catalog。

## 事实与尚未接线的边界

MAIN已自行指出video codec='video'是占位并将修为实际probe值；本报告不把其重复列为新发现，也不在修正前当真实codec证据。音频codec已直接来自probe。视频可能带有额外audio等流，当前登记仅声明并解码video role，不能把视频内未检查audio当已登记旁白。

当前测试是先真实HTTP创建工程，然后直接调用Host配置下localAssets.import并由测试构造可信UI context；不是已挂生产HTTP资产登记/真实UI权利确认入口，更不是人类A旁白。诊断蓝色视频/400Hz sine明确synthetic，许可为fixture声明，不证实实际素材授权/真实中文录音。

list/resolve可给本工程authenticated owner消费，绝对路径只在内部resolve返回；LocalAsset回执不含配置/relative输入路径。source/label/可选uri是原用户声明的来源元数据，不应把其当服务端验证过的网络/许可来源。后续公共producer仍需单独审查隐私投影；当前无新public route或虚构capability。

本批未实际组装author source、不递增revision；真正采用/Run/Task仍需Coordinator/base/source/锁/许可/审批及snapshot。待上述三点修复、MAIN运行终态和新冻结SHA后再独立验证，不签整A05/A。


## R8修正只读复核（未冻结）

新字节见r8-input-hashes.json。MAIN仍为HEADd15e44d加dirty；本次读registry `d0a92d0237525e86131a043ca4efd14db6e4e6d7d05481b8df961d1687af6030`、media probe `f2b0c7492161c5e6c564bc5a9d2b21b206e603e74010bebf1ccb17b27560cd68`。本人未运行tests/Host/ffmpeg，未改MAIN；exec92226是MAIN独占R8，未以其进行中结果签PASS。

**L-R1初始配置门 SOURCE_ADDRESSED。** canonicalLocation对未建目录也沿现有祖先realpath，初始化mkdir前检查storage与projects/snapshots/source的双向重叠；CreationApplication从真实SnapshotStore.projectRoot('')注入snapshotsRoot，不由调用DTO选择。新增snapshot受保护alias配置case，拒绝前不创建unwanted目录。

**L-R2 SOURCE_ADDRESSED。** #row exact key现在包含source，仍保留whole fact/core/registration digest及完整ID冲突校验，未通过删来源或跳hash调绿。MAIN报告R4/R5/R7通过仅标MAIN执行。

**L-R3 SOURCE_ADDRESSED。** sourceRoot在constructor要求canonical非symlink目录并捕获dev/ino，固定存储字段，不再保存可变options.root；复制前、后及最终SQL重验目录路径/身份。源码新source root symlink替换case拒绝。旧key回原登记不重新读外部input依旧是刻意原回执语义。

### L-R4：private存储父目录漂移会先写受保护域，再拒绝（P1隔离剩余路径）

与source根不同，#root/#objects/#staging只有constructor canonical/权限检查，实际open(staging,'wx')和link(staging,destination)之前不验证固定存储目录身份。mkdir前的静态域检查不能覆盖实例运行期间的目录替换。

具体复现调度（未执行）：真实Host已完成registry构造，在mediaObserver观察ffprobe启动后，把storage/objects改名，原路径symlink到已有snapshot/source。probe继续完成，`link(staging,destination)`跟随目标父目录，先在snapshot/source内创建sha.ext；之后#hashFile发现realpath(path)!==path而拒绝，但遗留未引用blob已经改了不可变snapshot。类似地，在import之前改staging为author/source alias，open(...,'wx')会先创建输入文件；O_EXCL保护叶文件，不保护父目录symlink。

这是原“存储不能写author/snapshot”的剩余运行期路径，不是要求新模块gate。应在发起真实写/发布前核固定private目录身份与边界，防止父alias被跟随；对检查后竞争的强保证可使用directory-fd相对操作/发布，而非事后hash才拒。未知存储域不得被当成允许缓存位置。

### L-R5：ctime fallback重hash后缺ctime稳定性检查（P2 proof边界）

#assertBlob对合法hardlink unlink导致ctime变化重新计算完整sha，而非直接忽略ctime，这个方向正确。但fallback读取前取current，读取后只sameContentIdentity比较dev/ino/size/mtime，与初始#hashFile的完整fingerprint首尾检查不同；没有检查post.ctimeNs===current.ctimeNs。

若fallback读期间外部写已读取区域并恢复mtime，流式hash仍可能是原expected，最终文件却已变化，读后检查也可能通过。该复现需要外部并发写和保留/恢复mtime，不是普通同key重放本身造成。建议以fallback开始时的current为基准核完整首尾metadata，不稳定就冲突重试；不要拿旧proof ctime作基准误拒已经发生且稳定的合法unlink。此是原byte proof的一处局部缺项，不要求另开验收阶段；本人未运行并发篡改实验。

### 生命周期、容量、媒体事实核对

LocalAssetRegistry.import在关闭前登记pending promise，shutdown signal与调用者signal组合；close先closed+abort再等待全部pending，后续新import明确拒绝。CreationApplication共享closePromise并同时等待creator和localAssets，Host再关DB。#importWithSlot先权限/结构校验后最多2个active，FIFO等候队列的cancel会真实移除且不占后继slot；finally释放已取得slot，没有以capacity字段伪造限制。

runLocalMediaTool用真实spawn、固定args、输出上限/timeout/abort触发SIGKILL，但等实际child close才resolve/reject并移除timer/listener；不存在只reject Promise留下子进程继续用文件的路径。新增真实Host.close在ffprobe spawn时触发，等待imports和子进程、slot归零，再拒新导入，是有针对性的源码case，不把它当已由本人执行。

video codec现来自实际ffprobe codec_name，不再占位；新严格decode包含所有video及可选audio并使用-xerror/-err_detect explode，对异常audio等流不静默忽略。旧report关于video仅声明video-role的限制由此源码修正覆盖。URI现在限制http/https、无userinfo/query/hash且有长度上限，原始路径不进入public asset回执。

原shared连接、ledger digest、immutable catalog与outbox同事务未改变；final blob检查之后仍重验source根/schema/owner/abort。R6合法hardlink ctime碰撞原失败应保留，不能通过放松字节核验处理，见L-R5的精确补项。

本轮不要求额外模块gate，不重复完整A；L-R1..3已修，当前仅上述L-R4/L-R5两处具体剩余路径供MAIN收口，未冻结预审NEEDS_WORK。


## L-R4/L-R5 retained-fd修正复核（R10后未冻结）

实际新输入见r10-input-hashes.json，registry `2104ca9995d2003cc0450d6e54e8a75636aa6871f7e5ba40a3183fb54eee3ccc`。MAIN finalexec65232进行中，本人没有运行测试/Host/ffmpeg或改MAIN。MAIN报告R10 tsc0/23真实Host assets通过，仅标MAIN执行。

**L-R4 SOURCE_ADDRESSED。** constructor保留source/root/objects/staging的真实O_DIRECTORY_NOFOLLOW fd，校路径canonical/dev/ino/uid/mode与held fd一致。实际stage创建、blob link以及staging cleanup使用`/proc/<HostPID>/fd/<retained-dir-fd>/<name>`，不是重新跟随可替换canonical父路径。边界在检查之后将路径换symlink时，实际写仍去旧的持有目录；后续canonical检查拒绝，不把文件写入替换snapshot。Input walker逐层父目录O_DIRECTORY_NOFOLLOW，不靠仅末级leaf检查保护来源根。

核到两个before_stage_create/before_publish实际race hook的测试源码，直接把目标父路径换为真实snapshot/source，断言rejected、snapshot names/film bytes未变、原staging清空。这些case覆盖原先“先写snapshot后拒”的具体问题，没有换成伪目录对照。

**L-R5 SOURCE_ADDRESSED。** fallback仍重新计算完整sha；读后改为fingerprint(current)===fingerprint(post)，以fallback开始时身份为基准同时核dev/ino/size/mtime/ctime。既不因旧proof与合法已发生hardlink unlink的ctime差异直接失败，也不允许fallback过程中继续变更。没有通过省略bytes检查处理原并发误报。

**资源生命周期补强核到。** import和resolve都被#track登记pending；close先closed/abort，等待全部pending后才关闭retained directory fds，CreationApplication继续等待localAssets.close再关同DB。resolve结束前的权限检查会在closed状态拒绝，未观察到关闭DB后继续回调访问它的这一路径。import的finally多层try/finally在source.close失败时仍执行parent close及本次retained staging unlink，不用错误路径去清理替换snapshot。

### L-R6：#openInput leaf打开后realpath抛错未显式close（P2局部资源清理）

#openInput先成功`const handle=await open(leaf)`，再`await realpath(/proc/HostPID/fd/handle.fd)`。普通返回不匹配分支会close handle，但realpath自身抛错时落到外层catch，那里只close parents；已打开leaf没有显式关闭，也没有成功返回给#import的finally接管。

可复现调度（未执行）：leaf open完成后、其/proc fd realpath前，外部unlink该leaf；持有fd仍有效，但/proc链接对应(deleted)目标的realpath可ENOENT，进入上述异常路径。重复失败会依赖FileHandle的GC兜底，可能积累descriptor，不应把GC当确定释放。建议用可见于catch/finally的leaf变量，只有成功return时转交ownership；未转交则显式close leaf并close所有parent。此是新增walker的一处窄cleanup补项，不要求额外pipeline/module gate，不扩大到整A。

当前L-R1..5原问题均已源码修复；仅L-R6显式异常close待补及后续冻结独立验证。没有找到新的实际rights/跨scope/SQL原子性阻断，不签本批未冻结PASS或完整A。
