# A-R1-MEDIA focused preflight / TASK

日期：2026-11-11。状态：PREFLIGHT_COMPLETE_WITH_INTERFACE_ACTIONS；ReleaseAssignment仍为PREPARED_NOT_RELEASED；IMPLEMENTATION_NOT_STARTED。本次task_53b31efc815b / ctx_51ef3a281194，run_399f9dd3ce5a；MEDIA Codex终端term_4513c300-1424-43ab-bef2-6017ce3055b7，MAIN term_a731c232-35c7-4f55-a75d-9b2beeade398。

## 基线与权限

实际目录 `/home/administrator/orca/workspaces/Narralens/Narralens-A-R1-MEDIA`；full base/HEAD `9f583239714835a89332fcae9363aa39d887821d`；contract commit `ca5b67a8285b130c79055317c6202f73cfbb99c8`；合同文档commit `f0c4f4f34fb1b81cf1ea0e0af2fd22a9eab38450`；固定OpenFilm `e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3`。
初始git status --short --untracked-files=all仅 `?? docs/parallel/lane-media/A-R1-20261111/ReleaseAssignment.json`，tracked diff为空。MAIN提供ReleaseAssignment SHA256 `dbca1ce94ec80aa32d1da30fda748c2ff41428189d64b911912e5e1cd2bf2ba9`，未修改。准备包artifact-manifest SHA256 `2a847488f59259b196caeb22e0407327583fed6985516ed16fa9bf9a87aad0c0`，与assignment相符。

最新A开发授权覆盖旧暂停/仅文档历史；本dispatch明确只做preflight。当前writer=MEDIA Codex，仅TASK.md、HANDOFF.md、CLAUDE_IMPLEMENT.md三文档。Claude未启动、未调用、未获writer；无产品代码、索引、分支或运行根修改。已读本地AGENTS、delivery process11、relaunch02/03/04/05/06、MEDIA DESIGN/ACCEPTANCE/TASK及完整implementation-prompts/media.md；D01–D15继续有效，不重审架构。

冻结合同实测（只读hash，不是合同测试）：

| 文件 | 当前SHA256 | 对freeze |
|---|---|---|
| `contracts/agent-driven-a.schema.json` | `088a451e9646199618261a6cc95a84e3767dbf4cc87004f3e5995dda86b60964` | MATCH |
| `contracts/agent-driven-a.registry.json` | `05f29d947ec65398fee37851a583afc781adc87d6b7d382b1da45eb46f80dc4f` | MATCH |
| `src/contracts/agent-driven-types.ts` | `54356697802c0bf048e5cbcde1f54eb33713d4fe58943b346406804011cb3644` | MATCH |
| `src/contracts/agent-driven-validator.ts` | `f11a68bad982b7914e73f396ce48e99195ffc8fa88e842f137ffabf31900ea73` | MATCH |

R0/current-inputs.json的13项当前bytes/SHA256全部一致；不是重新审计或继承旧PASS。R0 decision记录PASS_SCOPE_ONLY，0 blocker/0 major/1 minor，tsc exit0、8文件123测试exit0、Python10vectors0fail，均为MAIN既有证据、本轮未重跑。R0-M01归BRIDGE：生产注册前完成同步同DB graceful lease release与pending CP/checkpoint/event，真实CP shutdown/reopen/resume回归，保留cancel分支；MEDIA不接管其store/worker公共修改。

## 用户路径和精确子集

R1提供真实SOURCE_ONLY准备闭包、成功Job无live lease的只读adoption复证、隔离prepared预览及已证读取能力，为BRIDGE审阅/采用与PRODUCT原播放器提供输入。prepare/preview不改author/revision/active_commit；不做author publish、committed encode、Delivery、R2事务或R3/R4验收，也不要求它们先完成才能交R1模块。

以下12文件是未来允许候选上限（8源码+4测试；10 existing+2 new），逐项属于03的media-Claude，最终实际差异可更少。无缺陷不重写R0通过模块。

| 精确路径 | 本地事实 |
|---|---|
| `src/host/agent-driven/created-draft-processor.ts` | EXISTING |
| `src/host/agent-driven/prepared-draft-verifier.ts` | EXISTING |
| `src/host/engine/source-digest-v1.ts` | EXISTING |
| `src/host/render/native-draft-assembler.ts` | EXISTING |
| `src/host/render/native-draft-plan.ts` | EXISTING |
| `src/host/render/native-draft-io.ts` | EXISTING |
| `src/host/render/assembly-ports.ts` | EXISTING |
| `src/host/render/preview-prepared-source.ts` | PLANNED NEW |
| `tests/agent-driven/integration/created-draft-processor.test.ts` | EXISTING |
| `tests/agent-driven/integration/source-digest-resource-boundary.test.ts` | EXISTING |
| `tests/agent-driven/media/native-draft.test.ts` | EXISTING |
| `tests/agent-driven/media/preview-prepared-source.test.ts` | PLANNED NEW |

最小预计实现触点：prepared-draft-verifier.ts、assembly-ports.ts（Host-only接口，如需要）、preview-prepared-source.ts、created-draft-processor.test.ts、preview-prepared-source.test.ts；其余7项只在实现证明确有R1必要性时触碰并记理由。processor测试现有真实fixture把证据写到docs/execution/A/logs；释放后在该已允许测试内改成MAIN批准的私有证据/临时根再运行，不新增旧目录证据。

永不默认扩大至render/ports.ts、native-renderer.ts、render-snapshot.ts、committed-render-phases.ts、delivery、server、DDL、contracts、package/lock/config/vendor或BRIDGE/PRODUCT文件。可以只读复用现有导出；接口必须放本票允许文件，不要求改renderer才能做preview。

## 当前接口与producer/consumer

| 实际/计划 | 调用和职责 |
|---|---|
| EXISTING | CreatedDraftTaskProcessor.execute(task,lease,signal)经真实registry.resolve→PinnedNativeDraftAssembler.prepare→verifier.prove→store.recordPrepared/finishPrepared；resume使用readPrepared/preparedLeaseAttempt→proveExisting；finally release。源Job完成是SOURCE_ONLY，不是commit。 |
| EXISTING | PreparedDraftProofPort在created-draft-processor.ts：prove、proveExisting、assertCurrent、release、close；verifier当前仅TaskLease绑定。assertCurrent同步回调拒绝Promise；保留这个运行中路径，不把adoption伪装新lease。 |
| EXISTING | assembly-ports.ts的NativeDraftRequest/StagedNativeDraft承载私有root、files/roots、plan、fps30/1、frame_count、clips、assets、storyboard_plan字幕；PreparedTaskFact来自created-task-store.ts，plan_digest类型nullable但本native路径必非null。 |
| PLANNED R1 | DESIGN末节定案proveForAdoption(completedSource,adoptionBinding,registryFacts):Promise<object>；completedSource由BRIDGE持久task/job/fact/receipt/producer lease_attempt+Host root构造，严格检查succeeded/SOURCE_ONLY/local.native-draft@1/stage/source_digest及execution；MEDIA重开FD、校验目录身份/闭包/hash/parser/当前许可，WeakMap按purpose与binding绑定，不重claim成功Job。 |
| PLANNED R1 | 对应同步adoption专用assert方法（建议assertCurrentForAdoption，最终命名交MAIN与BRIDGE一致确认）在BRIDGE原受控事务内调用，核transaction/impact/plan/approval/base/control/selection/prepared/target binding及当前author/rights；release/close与异常finally释放。文件proof不替代Run/grant/锁/批准/同DB权威。 |
| PLANNED R1 | PreviewPreparedSource在preview-prepared-source.ts消费Host已验证prepared闭包，FD校验后复制到独立UUID私有workspace；只对副本调用现有NativeRenderer.render(NativeRenderRequest)，真实输出MP4及旁白/VTT/镜头概述/许可质量五类part字节receipt；不调用SnapshotReadPort/整体render facade。缺必要输出诚实不可用，不造假ref。 |
| PLANNED BRIDGE | created-source-change-service/created-source-adoption-service消费MEDIA复证；BRIDGE持久ps_映射、impact/review package/ref注册、result_ref、同DB与HTTP装配，后续typed事务消费专用proof；MEDIA不写这些文件。 |
| PLANNED BRIDGE→PRODUCT | review-media-http GET /api/ui/v1/projects/:id/review-media/:ref依审定registry校owner/UI读证明或owner-scoped driver，再解析真实package/version/input/output/quality/producer attempt，调用MEDIA已证FD读取；PRODUCT原播放器/VTT/转义JSON消费，不拿私有路径。 |

错误维持真实语义：无当前证明/坏bytes或binding→REVISION_CONFLICT；缺固定能力→CAPABILITY_UNAVAILABLE；EMFILE/ENFILE等按现asHostResourceError保留HOST_RESOURCE_EXHAUSTED。HTTP状态由BRIDGE按review-media registry映射401/403/404/409/416/503，MEDIA不能把一切异常归成源漂移或伪404。读取同FD regular-file/hash/范围校验、正常/取消/416/error均幂等close；HTML/任意路径/旧包/跨scope拒绝，读不编码、不写DB，无Delivery ready前置。

## MAIN需收口的具体调用细节（不重议D01–D15）

I1：D02/D03要求impact准备时复验成功prepared闭包，但DESIGN的adoptionBinding含transaction_id/impact_id/approval_id，此时后二者尚未齐备。请MAIN给BRIDGE明确调用分工：建议R1 proveForAdoption仅供已有完整binding的apply/typed事务；impact/preview调用同底层只读完整复验证明但独立purpose、无提交能力，绝不伪造approval/transaction或复用TaskLease。确认pre-impact proof方法/类型是否放本票assembly-ports/verifier，及BRIDGE怎样提供current author/rights同步检查；不要让Claude自行选择nullable批准语义。

I2：审定review-media registry锁定语义但未给TypeScript签名。建议MEDIA在assembly-ports.ts定义preview输出receipt与受控read handle，BRIDGE独占opaque ref注册/包scope校验；read输入是Host解析并绑定实际receipt的对象而非URL/path，返回受限content type/bytes/hash、range读取及幂等close。MAIN请确认BRIDGE采用的导入符号和完成/取消/流断开close归属、五part receipt与包hash交接结构；不需新wire/表/额外文件。真实producer→consumer联调由MAIN编排，不因消费者未来未实现把R1模块写成产品PASS。

I1/I2是release前接口action，不是新独立审查门；不要求R2–R4整套实现。缺实际调用方只能先标模块证据，不能宣称生产可用。

## 验收映射与释放后命令（当前全部NOT_RUN）

| 范围 | 本票case/断言 | 对应测试 |
|---|---|---|
| M01/M07、IT-A03/04/05 | 真实registry→原生各镜clip/完整旁白/字幕闭包，author/revision/pointer不变；取消、失lease、资源错误/恢复和FD关闭 | existing created-draft-processor、source-digest-resource-boundary、native-draft |
| M17/D13（M03/M08模块部分） | succeeded SOURCE_ONLY且lease已释放仍复证；旧TaskLease/伪JSON/跨transaction/impact/base、篡改同尺寸bytes/rights拒绝；当前author变化拒绝；同步检查拒异步回调；成功/异常/close FD回收 | existing created-draft-processor新增proof cases；BRIDGE后续created-source-adoption证明真实+1，不由本票代签 |
| M02/M16/D03 | 隔离副本真实预览且原准备树/author无写；五part事实；同FD/Range/断流/错误关闭、路径HTML/坏hash拒绝、重读零编码；取消不暴露晚到结果 | planned preview-prepared-source；BRIDGE后续review-media-transport+PRODUCT真实播放器联调 |

cwd固定为本票directory。MAIN先提供独立依赖与资源槽；不得复制/链接共享可写node_modules/var/dist/profile/DB。只读vendor pin可复用。node>=22.15.0、corepack pnpm10.33.0由目标实施窗口核查；本轮未调用包管理器，避免隐式下载。缺依赖停报MAIN，不安装。

```sh
corepack pnpm exec tsc --noEmit
corepack pnpm test tests/agent-driven/integration/created-draft-processor.test.ts tests/agent-driven/integration/source-digest-resource-boundary.test.ts tests/agent-driven/media/native-draft.test.ts tests/agent-driven/media/preview-prepared-source.test.ts --maxWorkers=1 --minWorkers=1
corepack pnpm test:contracts --maxWorkers=1 --minWorkers=1
```

preview测试先创建再加入运行，不能现在报已有；processor fixture含真实Host/ffmpeg，preview真实render含Chromium/ffmpeg，因此上述组合属于MAIN重型单槽，全部Headless静音，不抢焦点。可单独运行纯native-draft/resource检查仍须implementation release及本地依赖就绪。build/check及真实MCP/UI/同DB回归由MAIN集成安排，本票不默认全量。现有命令入口由package.json/vitest.config.ts读取确认，不编造test:media。不把stub renderer单测当真实preview验收；真实媒体缺环境记NOT_RUN/BLOCKED，不假PASS。

## 交付、回退、停止

本次交付三文档及只读hash事实；不提交Git。后续实现需MAIN release、I1/I2接线约定、凭据事件处置/Claude调用许可和显式唯一writer移交。输出应有完整实现SHA（现在不存在）、实际dirty、逐case结论、命令cwd/开始结束/exit、日志及产物SHA256、自有PID/后代结束证据、剩余consumer依赖。没有实现证据时一律NOT_RUN，不代签独立审查/人验。

回退限关闭新能力/调用并保留事实/已提交快照；只清确属本任务的未发布UUID副本，未知进程仍在不得删；不reset/stash用户工作、不删原准备树、内容回退走新revision。合同/HEAD漂移、跨文件、缺资源/授权、writer不明或新高风险契约即停报MAIN。429必须确认原调用及子进程已停止并保全dirty再经MAIN明确交接Codex，本preflight不得借429编码；超过两次返工由MAIN接管共同根因。无Claude凭据读取/环境dump/换provider/模型下载/J盘/付费/外传/新worker，无B。

## 当前候选文件字节（只读记录）

| 文件 | SHA256 |
|---|---|
| `src/host/agent-driven/created-draft-processor.ts` | `6727b0b64bc07cfdea0346e7f885d0ffcbd74832a66f939056735c66872eeef5` |
| `src/host/agent-driven/prepared-draft-verifier.ts` | `ffefbd4169dfd07930723e2606997845fc1bc4a1aa9d0f6b60b7bfd6eb5276db` |
| `src/host/engine/source-digest-v1.ts` | `d32dfc433865865749efd5e5f44f00eceff27b93d7607603c5eb9233708c599d` |
| `src/host/render/native-draft-assembler.ts` | `1b8a6bc403053091e74a3357815b35fddc3d9fb71aa5e8448782f66feb58877e` |
| `src/host/render/native-draft-plan.ts` | `b4091aa1ffa786fe703a59296b291ae0485e5032e57f9aa4dfa31e9d37631d3e` |
| `src/host/render/native-draft-io.ts` | `4228400591b5561b795a72cfab551bed9b214378e6222b49f415b91ac0d7436a` |
| `src/host/render/assembly-ports.ts` | `d80b7d1e82366e507617c6d5496eaa771a8b85b7387dac436b3da6712da41547` |
| `tests/agent-driven/integration/created-draft-processor.test.ts` | `a1df47e95f6bb7a8e7825ced877a9a03d74bfe5b899b131821e99c164f7bb3ec` |
| `tests/agent-driven/integration/source-digest-resource-boundary.test.ts` | `b6aa70b3fde614a30a43dbe0505c39d6dec1cae2e90c2c5eabbf6fac073c3ed5` |
| `tests/agent-driven/media/native-draft.test.ts` | `e3f7a92723034cfcf24b2fdaca64c8b152b8fd7e649e58985350f0ee6dd88fdb` |


## CR-R1-001有界接口复核（2026-11-11，覆盖此前I1/I2待选择记录）

当前task_471be68020ee / dispatch ctx_0e80cd5e9454，Codex handle term_83ef49d9d2eba905bd1c62ac57984446。实际HEAD仍9f583239714835a89332fcae9363aa39d887821d；本dispatch仅追加TASK/HANDOFF，其他原有untracked文档保留。读取MAIN canonical实际三文件：

- canonical `/mnt/c/workspace/videoworkline/Narralens/docs/execution/A/implementation-20261111/CR-R1-001-INTERFACE-LOCK.md` SHA256 `a5694b60e86b07ba05495625310bdac18c6cdc30315e0bd4e4b046a570e42a1b`。
- canonical `/mnt/c/workspace/videoworkline/Narralens/docs/execution/A/implementation-20261111/contracts/gateway-ui.registry.json` SHA256 `40af12a3bd4a6b0a2dba4aee7a4d4092b155a2352bf9b2fb790a34c8eab7d765`。
- canonical `/mnt/c/workspace/videoworkline/Narralens/docs/execution/A/implementation-20261111/ownership-delta.json` SHA256 `8027fb4fd83eab107c140a7aea3e5a8c803c8e31a5898d4fdd82040f62367d06`。

结论：核心接口ACK；有一个精确字段反例需MAIN补齐，不重启总体设计/独立产品审查。原I1由CompletedPreparedSourceV1 + purpose=impact|preview的prove/assertCurrentForRead与完整adoption binding的prove/assertCurrentForAdoption明确关闭：前者不造transaction/approval，后者不得收read proof或旧TaskLease，成功SOURCE_ONLY不重新claim；BRIDGE提供真实同库身份和同步author/rights/Run/批准重验，MEDIA仅持有文件proof并release/close。原I2的producer/consumer及FD归属关闭：MEDIA immutable receipt先于package且无反向hash引用，BRIDGE登记真实包/part/input/output/quality/attempt映射；reader.open仅Host receipt+object_id，固定对象域/同FD核hash，有界read≤1MiB，MEDIA开失败释放，BRIDGE每响应正常/断流/取消/416/error finally幂等close。读不渲染、不交付、不写author。

独立UI delegate只由真实Host trusted_ui创建，独立cookie/CSRF与parent/generation/owner检查，native-only/driver/native proof不获批准权；commit后有效UI可读新Context而native仍stale。closed registry、原DTO与错误语义保持，native.reopen严格workbench.v1+空input、同既有native-open服务；31冻结Host+5附属Host+2新Gateway分别计数。四新owner路径与既有gateway归属均清楚，MEDIA仍12文件，无越owner修改。

唯一具体反例 CR-R1-MEDIA-FPS：第4节要求“预览receipt真实fps与项目clock匹配”，但第6节PreparedPreviewReceiptV1列出的字段及reader返回仅content_type/bytes/sha256，没有fps或已登记fps的消费者入口；冻结ReviewPart也无fps。实际M5Panel.tsx:160创建30/1 PlaybackClock，assembly-ports.ts的StagedNativeDraft有真实fps和frame_count，NativeRenderRequest亦需fps；PRODUCT若仅拿受控MP4字节/ref和当前明列receipt结构，就只能猜30/1或拒绝所有预览，不能据已有元数据完成要求的匹配。请MAIN在本Host-only receipt明确增加verified fps {num,den}（及frame_count用于帧边界），从已证native计划及实际编码参数一致性取得、纳入receipt_digest，并明确经受控part元数据供PRODUCT读取；不能改冻结ReviewPart/凭空从项目默认值复制。若MAIN已有另一条受控fps读取路径，请锁定具体producer/consumer字段即可，无须扩大本票文件。这个缺口只影响严格port字段闭合，不反对单clock方案、不要求R2/R3/R4先实现。

原M5 proxyRefs/现有视频区单活动槽、共用clock且review不seek/select author、进入按已观察frame用既有seek暂停、退出/切换/卸载精确abort/revoke/停播与单音频焦点均ACK；真实Headless联调未运行，不能按mock签通过。后续M02/M16增加fps不匹配明确拒绝且不改clock的断言，M17验证read proof不能apply；其他反例沿MAIN第7节，无新独立审查门。

依赖离线准备3/3成功且package/lock未变为MAIN本次通知，MEDIA未重复安装或自证运行结果。Claude调用、正式release/writer handoff仍未发生；产品/测试/重型检查全部NOT_RUN；R0仅scope freeze，无B。


## CR-R1-MEDIA-FPS最终闭环ACK（2026-11-11）

本次task_50fc302096b7 / ctx_e5ca0d39282f，Codex handle term_33eca251294dfb46dc166222fc947a9b。仅读取canonical CR-R1-001第8节和gateway registry及MAIN更新的本地Assignment，并追加TASK/HANDOFF；不扩大审查范围。

**ACK：CR-R1-MEDIA-FPS字段缺口已关闭，本领域此项无剩余反例。** 第8节明确receipt顶层timeline fps/frame_count与video实际probe有理fps及完整decode/count帧数相符，规范化后纳入receipt_digest，不以项目默认值冒充探测；audio用真实sample_rate/sample_count/channels验证旁白范围，text/json保持判别类型。MEDIA reader metadata、固定receipt/object hash与BRIDGE包/part关联形成同一事实链，metadata打开也finally close。

既有RPC闭集新增workbench.v1/review.part.describe，严格输入run_id/package_id/package_version/part_kind/artifact_ref，project来自独立delegate；精确PreviewMediaDescriptorV1提供timeline/media_facts及package/receipt/object/bytes/hash绑定。PRODUCT据此先核真实fps与现有clock，再核下载ETag/hash/bytes，旧包或metadata到bytes间对象变化拒绝；25fps对30/1、伪报fps、缺事实、音频错误样本时长和FD关闭负向均已有明确断言，失败不改原clock/author/版本。无第三HTTP、无冻结ReviewPart/CP31修改，前轮其他ACK保持。

当前完整HEAD `9f583239714835a89332fcae9363aa39d887821d`；contract `ca5b67a8285b130c79055317c6202f73cfbb99c8`。本地Assignment仍PREPARED_NOT_RELEASED，MEDIA精确12文件不扩展。现测Assignment SHA256 `1ade994ceda67b7353c40fc2aea533d4c805edce3df954a93b4649b79c57ea12`；interface SHA256 `7e9b61b339d9cf2bc80c7925e09139f6362eeee6ecc373a2bd142d4be0f895b8`、gateway registry SHA256 `8416e1abeec71b4e063df53c9e4974ea4ab1bab3b8f1f5ddfc280f5b5261e54f`均与canonical当前字节匹配。旧Assignment/hash与前轮缺口记录保留为真实历史，由本节覆盖当前结论；不改封存包或CLAUDE_IMPLEMENT。

本次是具体R1字段/port闭合ACK，不是实现、测试、独立产品审查或人验PASS；未调用Claude、创建children、写代码或运行重型检查，未改Git索引/分支。后续仅待MAIN正式release、凭据处置和唯一writer移交，Claude无需另作架构决策；R0仍scope-only，无B。
