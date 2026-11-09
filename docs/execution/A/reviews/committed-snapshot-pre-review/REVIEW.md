# A06 CommittedSnapshotAuthority 独立只读预审

日期2026-11-10；审查上下文a_media_independent_review未参与本模块实现。目录main-integration，基线HEAD `791fd1dfb8958889c101715a68cc628898ed650c`，本批未提交。具体输入SHA256见input-hashes.json。MAIN唯一writer；本次仅读代码/依赖，不运行测试、Host、浏览器、媒体或任何探针，不修改MAIN源码/Git/运行根。

结论：**REVIEW_PENDING / NEEDS_WORK：存在1项有前置条件的P2文件替换生命周期缺口；冻结后仍需独立复核。** 不是A06整包或A通过。

## CSR-R1 · P2 · parser路径仍可在digest校验之后被FIFO替换，20秒signal未生效

定位：`src/host/agent-driven/committed-snapshot-authority.ts:77-82`先非阻塞digest，再await adapter初始化/inspectSnapshot，传AbortSignal.timeout(20000)。但 `src/adapters/openfilm/openfilm-engine-adapter.ts:229-246` 的#inspectLayout重新算digest后，调用upstream.readProjectFilm(root)，没有消费ctx.signal；`:342-344`读取subtitles也直接readFile。固定上游 `packages/openfilm/studio/server/film.mjs:33-35`的readProjectFilm直接fs/promises.readFile(film.html)，没有O_NONBLOCK/regular检查/AbortSignal。

前置：初次安全digest已成功，随后在adapter加载或其第二次digest之后、raw parser read之前，快照film.html被并发损坏/受控fault替换为无writer FIFO。调用前就放置FIFO的现有用例会被computeSourceDigest非阻塞拒绝；不能证明这个更晚阶段。只需本次文件有同用户修改能力，非声称远程攻击者可写快照。

结果：raw read可无限等待，传入的20秒signal不会中断它。快照read占用worker/attempt，不能仅靠末尾entries检查与DB重读收敛。此为静态调用链确定的缺口，**本次未执行竞态复现**；不是说正常immutable快照每次会挂。

建议：让实际固定parser消费已由安全descriptor读取/核验过的字节，或将实际读/解析置于可取消、有界且可确认终止的隔离边界；单纯再lstat一次或只传一个未被底层消费的signal不能消除替换窗口。若保留path-based parser，必须对底层读类型/身份/超时作真实约束。回归应在digest之后、parser raw read之前的确定阶段替换FIFO/符号链接，外层独立进程deadline、只清理自己文件；读应有界拒绝且无未收敛子任务。字幕raw read若后续producer能登记，也需覆盖相同路径。

## 现有实现成立的边界

- **精确committed transaction权威成立。** readerForTransaction核owner、transaction.project/state=committed、该transaction.snapshot/source_digest_after、同project/openfilm snapshot row与snapshotIdFor，再取transaction.base_revision+1。没有从当前active pointer推导历史revision。无需再用更宽的snapshotIsCommitted替代它：后者允许其他committed事务或migration，不能证明指定transaction。
- **同一事实复核成立。** 绑定保存project/transaction/snapshot/source/revision与经ProjectCreationStore验证canonical fact_sha的CreatedSourceFact；每次read前后重建并canonical比较。没有fact的snapshot明确CAPABILITY_UNAVAILABLE，不能凭磁盘文件补授权。
- **不可变字节读入口防线存在。** project/snapshot/source目录lstat+realpath精确匹配；computeSourceDigest本身O_NONBLOCK/O_NOFOLLOW并fstat regular，拒绝外部引用和越界。返回entries前再次read/hash/size及realpath核验；MEDIA后续还要copy/hash，不使用活动author目录。CSR-R1限定的是其间另一路未硬化的parser读取。
- **许可不虚构。** media assets与不可变fact.assets的path/hash/bytes逐项集合比较，rights从fact.license派生；字体/未建fact资源输出asset无rights即被MEDIA preflight挡。字幕仅从已登记fact.subtitles输出supplement/subtitles；没有rights supplement的producer，固定preflight仍block，不声称当前闭包可交付。
- **固定真实parser与错误边界。** createPinnedOpenFilmUpstream真实验证固定上游后才构建adapter；失败的Promise会reset，后次可恢复，不将init失败缓存为永久不可用。readSnapshot内将非ProductError异常转换成固定消息，资源错误映射HOST_RESOURCE_EXHAUSTED，避免MEDIA.failure把绝对路径带给client。factory的同步bind异常另属Host-only调用者边界，不是HTTP公开能力。
- **空draft范围明确。** 当前真实created source是0帧、无素材、无字幕/rights许可附属；read authority返回真实0而不补假影片，MEDIA expected_frames/mandatory supplements门应继续block。CreationApplication仅挂Host-only property，未注册Task/render/Delivery公开producer或capability。

## 测试覆盖建议与未证明范围

当前源码9个真实Host测试覆盖初始commit、author漂移、owner/request错绑定、transaction预先改prepared、snapshot字节改动、source目录外链、调用前FIFO、路径错误消息/恢复、失败adapter初始化恢复。R1原7Host+18media内部日志只属MAIN历史候选，R2测试仍由MAIN独占，本审查没有重跑或代签结果。

优先增加：

1. CSR-R1的parser阶段FIFO/链接替换负向，证明真实有界结束；不要只给Promise.race一个拒绝后让后台读仍占用。
2. 已存在的另一project/transaction、孤儿snapshot row（而非仅unknown transaction），确认恰当拒绝；prepared已测，但不能由snapshot row存在推定committed。
3. 暂停在实际I/O阶段后改变DB事实（现有测试是在read前改prepared），验证末尾assertBinding确实拦住中途变化。
4. 历史快照在真实下一次commit/revision推进后仍输出其特定transaction.base+1；当前author文件漂移测试不能替代真实revision推进/T20-G。
5. nonempty source/assets/subtitles/font、受限/unknown许可与必需附属项的组合：当前全部Host fixture为0帧空created工程，没有证明非空闭包分类/帧数/副本真实render可用。后续必须有真实immutable fact producer，不能用任意JSON或测试伪端口充当授权。

source-digest对内部symlink可canonical化；若未来source producer允许文档引用内部别名，需证明返回closure复制后保留所有实际引用路径，或在该producer明确拒绝别名。当前empty created producer无此输入，本节不将未发生的未来producer场景另列已证实P1。

本任务仅完成读取权威候选。Run/Task授权、AttemptFence、lease/cancel、DeliveryCommit/records/download/outbox/recovery均未由它实现，真实授权A片双导出、T20、全量/A人工验收保持未通过。最终结论需固定新fullSHA与输入摘要后独立复核。

## CSR-R1修复只读增量复核（未冻结、未独立运行）

MAIN已实际复现原parser阶段FIFO缺口，main-parser-fifo-before/tests.exit=1，唯一执行case在digest后原parser读取前安装FIFO，报“The pinned parser blocked after digest verification”，9项skip；清理释放旧挂起读。原静态P2现有真实打红证据，不将其覆盖为从未失败。

新差异源码修正成立：

- openfilm-upstream.ts返回的readProjectFilm先O_RDONLY|O_NONBLOCK|O_NOFOLLOW打开原film.html，以同一descriptor fstat regular并读取bytes，finally关闭；仅将该bytes写入mkdtemp私密目录内600/wx的film.html。随后委托**原固定loaded.readProjectFilm**解析，finally移除temp。不改vendor，不fork parser，不新增EnginePort/API；固定film.mjs的该函数只读root/film.html，不需要其他闭包文件，因此temp只复制入口文档可保持原解析语义。
- adapter.inspectLayout检查ctx.signal（明确不是硬20秒wall-clock deadline）；返回read.text的UTF8 SHA必须匹配本次digest的film.html记录。源路径随后改变不能让另一路rawparser读到FIFO，解析结果也不能换成与digest不符的text。非法UTF8被重新编码后hash不符时更严格拒绝，不应放宽此绑定以兼容错误fixture。
- 字幕改为同fd nonblock/nofollow+regular读取，并核对本次digest中的subtitle hash。原来源确认与最终closure再hash/DB事实重读继续保留。
- 临时目录/文件由本流程独占，raw文件系统错误仍经CommittedSnapshotAuthority.readSnapshot固定消息包装，projection只返回问题数量，未发现新增temp路径向该读port泄漏的路径。共享adapter其他入口仍须按其既有错误边界和回归检查，不因本次authority包装而推断所有HTTP错误已验。

**CSR-R1可标SOURCE_FIXED，最终冻结独立复核/实测仍待完成。** 本次未运行测试/Host/parser工具。没有把before/after信号检查夸大为可中断任意CPU或内核I/O的硬deadline。

MAIN R3日志只读状态：tsc.exit=0；10个Host用例（含parser阶段race）已显示通过，但整组9文件114测试结果为1文件失败、113pass/1fail。失败是旧m2.1 mock返回text='<html>'与真实film hash不符，原期望ENGINE_UNAVAILABLE503、实际SOURCE_CHANGED409；不能因新安全hash导致fixture不一致就降低绑定。应使mock text与实际disk film字节一致并保留原problems/doc测试目的；相同旧m4a mock也应按此修正。该日志失败保留，不签整组PASS。

非生产阻断的测试硬化建议：race case读取拒绝目前用reading.then(...,()=>undefined)，可能把设置FIFO的expect/mkfifo工具失败也吞掉。应另断言替换setup确实完成，并核对最终拒绝类型为非regular文件的ENGINE_UNAVAILABLE。旧实现相同case实际超时已证明此轮setup能生效，但更精确断言能避免未来假阳性。

总评保持REVIEW_PENDING：源码已修正定位P2，待fixture修正、完整相关回归和最终冻结后独立复核。未接Run/Task/AttemptFence/Delivery等生产者、真实A片/T20未通过的范围完全不变。

本次读到的未提交字节及日志摘要：

| 文件 | SHA256 |
|---|---|
| `src/adapters/openfilm/openfilm-upstream.ts` | `7593c4d7e0cbffeb309d29dd8204aa765b769d7d7c6ffffa3f1b32bcffcb19ca` |
| `src/adapters/openfilm/openfilm-engine-adapter.ts` | `90602061a4f8ef46ae6c77bddfba489114260c37eb70c4aaa0b8baa50b0ca3ce` |
| `src/host/agent-driven/committed-snapshot-authority.ts` | `91fd1e8b517bfbcf4dcc385d3b243df3e945b48f8fec27ea7bee71e80fb1d0aa` |
| `tests/agent-driven/integration/committed-snapshot-host.test.ts` | `f374fff28b8b184b51794376935f5204df027475a432672e09717e15c8301c1d` |
| `docs/execution/A/logs/main-parser-fifo-before/tests.txt` | `daa20a76749fc421e379b37c686ece235585da8bc1c51dc2cfb3ac9ed43dacda` |
| `docs/execution/A/logs/main-parser-fifo-before/tests.exit` | `4355a46b19d348dc2f57c046f8ef63d4538ebb936000f3c9ee954a27460dd865` |
| `docs/execution/A/logs/main-committed-snapshot-r3/tests.txt` | `40e756f89db4ac134b0d9031cc049cb91e99e7b062b8c8231c236fa5cd23255d` |
| `docs/execution/A/logs/main-committed-snapshot-r3/typecheck.exit` | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
