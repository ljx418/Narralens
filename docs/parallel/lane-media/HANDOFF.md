# IT-A06 handoff

Base/contract ca5b67a8285b130c79055317c6202f73cfbb99c8. Upstream fixed e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3 (verified by `git rev-parse` in /mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm; tree clean). Claude session 25d0705c-223a-4408-a5c6-2222e7c59c1e. Current writer: Claude Code CLI; Codex read-only until this process exits. Branch agent-driven/lane-media, HEAD ca5b67a, **未提交**（Codex冻结后提交）。

## 本轮做了什么

按 `docs/parallel/lane-media/TASK.md` 释放的 A MEDIA IT-A06 范围实现了生产模块（源码+测试+工具+文档），**没有跑任何命令**：MAIN A-BASELINE-CHECK exec62928 RUNNING，只允许源码编辑与读取。

新增（全部在允许路径内）：

- `src/host/render/`：`ports.ts`（MAIN要实现的 SnapshotReadPort/AttemptFencePort/DeliveryCommitPort 与 RenderPort）、`render-profile.ts`（固定选项+配置摘要）、`openfilm-render-pin.json`（上游渲染模块与worker摘要）、`upstream-pin.ts`（commit/干净树/模块摘要/worker摘要校验）、`openfilm-render-worker.mjs`（无shell固定argv worker）、`native-renderer.ts`（进程组取消并等待退出）、`snapshot-copy.ts`（快照闭包不可变复制与摘要复校）、`render-snapshot.ts`（编排）。
- `src/host/preflight/preflight.ts`：渲染前事实检查。
- `src/host/delivery/`：`qc.ts`（真实ffprobe+完整解码）、`manifest.ts`（精确DeliveryManifest DTO，用冻结schema校验）、`package-layout.ts`、`published-package-store.ts`（一次rename的原子发布、不覆盖）、`download.ts`（单range/ETag=真实SHA）、`delivery-service.ts`（只读读模型）。
- `tests/agent-driven/media/`：9个文件（support夹具 + snapshot-copy/preflight/qc/manifest/published-package-store/render-snapshot/download/delivery-service/upstream-pin/render-worker）。
- `tools/agent-driven/media/`：`render-delivery.ts`（模块harness）、`verify-render-pin.mjs`（pin探针）。
- `docs/parallel/lane-media/A06-MODULE-NOTES.md`（模块说明与T20-A..H对照）、`docs/parallel/lane-media/requests/A06-MAIN-INTEGRATION.md`（MAIN接线请求）。

未改动任何受保护路径（server/DDL/contracts/旧adapter/Job/包配置），未改 `package.json`/`vitest.config.ts`/`tsconfig.json`，未提交、未push、未reset/stash。

## 真实命令与结果

全部 **NOT_RUN**（资源预约未释放，按MAIN指示不跑）：

| 命令 | 状态 | 说明 |
|---|---|---|
| `pnpm install --offline --frozen-lockfile` | NOT_RUN | MAIN释放后执行 |
| `pnpm exec tsc --noEmit` | NOT_RUN | 同上 |
| `pnpm exec vitest run tests/agent-driven/media --maxWorkers=1` | NOT_RUN | 同上 |
| `pnpm exec tsx tools/agent-driven/media/verify-render-pin.mjs` | NOT_RUN | 同上 |
| `pnpm exec tsx tools/agent-driven/media/render-delivery.ts …` | NOT_RUN | 需资源预约+真实媒体/上游浏览器 |
| 真实T20-A..H（ENOSPC/截断/并发/取消/四个真实杀进程/篡改/新revision/重启重复下载） | NOT_RUN | 需MAIN全机预约与授权媒体；模块测试是替身渲染器与替身解码器，**不是**真实进程崩溃验收 |

只执行过的只读命令：`git rev-parse/status`、`sha256sum`（worker与上游模块摘要）、读取上游 `packages/openfilm/src/{render,host,shared,film-doc,timeline,seekable,overrides,media-links}.mjs` 与 `contracts/openfilm-upstream-lock.json`。未运行node/tsc/vitest/ffmpeg/browser。

## 产物摘要

- worker `src/host/render/openfilm-render-worker.mjs` SHA256 `87c29133a553ea30bb4d2dba50ff246bb8ba43e1f7e8ae3a6b4918b3c2d88dd1`（记录在 `src/host/render/openfilm-render-pin.json`；改动worker必须同步更新）。R1修复轮后离线守卫两个文件的摘要为 `0eb01964e17f61867c34b619b63aa35fc9914a5a53e50480156b45227314ae22`（wrapper）与 `1f73d6b61741062d8b2419323174743ea42ffc93ae282a08cab6f97fe1a7f1ee`（hooks），同一pin文件记录。
- 上游模块摘要（render/host/shared/film-doc/timeline/seekable/overrides/media-links）记录在同一pin文件；其中 host/shared/film-doc/media-links 与 MAIN 现有 `contracts/openfilm-upstream-lock.json` 逐字节相同，另四个MAIN的lock未覆盖，已在requests里请求并入。
- 上游commit e70d9d93…，tree clean（`git status --porcelain` 空）。

## 需要MAIN做的事

见 `docs/parallel/lane-media/requests/A06-MAIN-INTEGRATION.md`：实现三个端口与读模型端口、接线render job与delivery.read/下载路由、用 `computeRenderConfigDigest` 算 `RenderSpec.config_digest`、在 `commitReady` 内发 `ready_committed`/`events_published` 两个边界、把四个上游模块摘要与worker摘要并入canonical lock、配置每worktree独立的交付根。

## 限制与声明

- 实现候选**未经**任何测试运行验证（NOT_RUN），**未经**独立复核，**未经**人验；不得据此签A或T20通过。
- 模块测试使用替身渲染器/解码器，只证明编排与边界行为；真实encode/decode/崩溃/并发未证明。
- 本泳道实现由Claude完成；Codex冻结SHA后需由未参与实现的上下文独立复核。
- 未自签外审、未代签人验、未合main、未push。

## 进程

Claude初始 PID3509997 / exec41695 已被Codex负责人显式中断（为补充受信上游精确路径并停止广泛查找）；进程与子进程已确认停止，无源码改动、无429。恢复后的会话 25d0705c… 为当前唯一writer；无并发Codex写入，未派生子进程（未跑node/ffmpeg/browser）。Codex接手实现的候选同样须未参与者独立复核。

首轮Claude exec44824 exit0且PID3518322及子进程停止，writer转Codex文档/审查。初稿静态审查NEEDS_WORK；资源未释放，测试NOT_RUN。完整stdout/stderr保留于evidence目录（receipt记录hash）。

初稿冻结commit677d02f；Codex静态审查REVIEW-R1.md=NEEDS_WORK。现在明确移交同session Claude修复R1，Claude是唯一writer，Codex只读。测试仍NOT_RUN。

## R1修复轮（本轮，唯一writer：Claude 25d0705c…）

按 `REVIEW-R1.md` 的十条逐条修复，**仍然没有跑任何命令**（MAIN资源预约未释放：只允许源码编辑与读取）。未提交、未push、未reset/stash，未动任何受保护路径。

改动的源码：

- `src/host/render/render-profile.ts`：去掉对象字面量里的非法`readonly`（R1-1 编译阻断）。
- `src/host/render/openfilm-offline-wrapper.mjs`（新）、`src/host/render/openfilm-offline-hooks.mjs`（新）：**离线守卫**——用Node module hooks把固定上游的`host.mjs`换成带守卫的模块（不改上游字节），强制`offline:true`+`network.allow:[]`、死代理、`--host-resolver-rules`、上下文`serviceWorkers:"block"`；守卫摘要进pin。（R1-3）
- `src/host/render/openfilm-render-worker.mjs`：装守卫、守卫未生效即拒绝渲染（`OFFLINE_GUARD_NOT_INSTALLED`）、`seekable:false`、校验守卫与自身摘要；**允许正小数scale**。（R1-3）
- `src/host/render/upstream-pin.ts`、`openfilm-render-pin.json`：pin覆盖守卫与worker摘要。（R1-3）
- `src/host/render/native-renderer.ts`：预取消不起worker；取消后等进程组真的消失（`groupExists`轮询），未消失则上报`requires_reconciliation`；stdout/stderr有界；升级信号前确认组仍在、组回收后清定时器。（R1-8）
- `src/host/render/ports.ts`：`SnapshotClosure`加`expected_frames`/`expected_duration_seconds`、entry加`role`；`RenderRequest`加`required_supplements`；`RenderOutcome`加`requires_reconciliation`；`DeliveryCommitRequest`加`package_id`/`object_id`并写明attempt与execution各指什么；`commitReady`必须在事务内再查fence。（R1-4/5/7/8/9）
- `src/host/render/render-snapshot.ts`：preflight的每一项都进入交付的QC清单；附属件按快照提交的摘要核对；包里带原生可编辑源（`native_film.html`+`native_source.json`）；引用id带交付身份；发布前与提交前各查一次fence；`applyDispositionGate`抽出可单测。（R1-5/6/8/9）
- `src/host/render/snapshot-copy.ts`：随闭包形状更新（role）。
- `src/host/preflight/preflight.ts`：附属件也要许可；新增`inputs_complete`（承诺的附属件、原生文档、期望帧数）。（R1-5）
- `src/host/delivery/qc.ts`：解码`-xerror`+`-map 0`+单线程三条+`protocol_whitelist file,pipe`；ffprobe限协议；帧数/时长与原生文档比对；流个数必须一致；帧率按有理数值比较；附属件按角色与摘要检查；工具收到signal。（R1-4/5/8）
- `src/host/delivery/package-layout.ts`：引用id带交付身份；去掉已被receipt取代的index类型。（R1-9）
- `src/host/delivery/published-package-store.ts`：**对象+receipt两步发布**——对象在staging建完整后整体`rename`进`objects/<uuid>`，receipt用硬链接发布到`published/<package_id>`；败者只删自己的对象、从不触碰canonical路径；畸形receipt/别人的receipt失败关闭；文件与目录都fsync且不吞错；`verifyPackage`校验每个文件的形态/路径名/id唯一/与manifest每个ref对应并拒绝链接。（R1-2/7/9）
- `src/host/delivery/download.ts`：`O_NOFOLLOW`打开、**用同一描述符哈希并从它流出**，同尺寸篡改失败；416/200/206语义不变。（R1-7）
- `src/host/delivery/delivery-service.ts`：下载前必须读MAIN的持久记录（ready/qc/ref/manifest逐项相同）。（R1-7）
- `tools/agent-driven/media/render-delivery.ts`：随端口更新；并在文档里写明其内存fence/commit**只是harness，不是生产Job store**。（R1-10）

测试（全部仍NOT_RUN）：`tests/agent-driven/media/` 12个文件——新增 `offline-guard.test.ts`（守卫的pin/强制选项/真实进程装上守卫的探针）；`qc.test.ts` 加解码参数、帧数、时长、流、帧率、承诺附属件的检查；`published-package-store.test.ts` 改为对象+receipt模型（含并发、畸形receipt、冲突receipt、篡改、链接、缺失）；`download.test.ts` 加同尺寸篡改；`delivery-service.test.ts` 加未ready不供字节、记录不符不供字节；`render-snapshot.test.ts` 加preflight发现入清单、引用id唯一、原生源入包、取消未收敛不释放attempt、提交失败为可恢复；`preflight.test.ts` 加承诺附属件缺失。

文档：`A06-MODULE-NOTES.md` 增加R1十条对照表、新的模块地图与T20对照；`requests/A06-MAIN-INTEGRATION.md` 按**新端口**重写（含新快照字段、下载就绪门、事务内查fence、离线守卫、对象+receipt的运行根、host-only处置字段）。

产物摘要（改动后重算，见下）：

- worker `src/host/render/openfilm-render-worker.mjs` SHA256 见 `src/host/render/openfilm-render-pin.json`（改动worker必须同步更新摘要与本文）。
- 离线守卫两个文件的摘要同一pin文件。
- 上游模块摘要（render/host/shared/film-doc/timeline/seekable/overrides/media-links）同一pin文件；其中 host/shared/film-doc/media-links 与 MAIN 现有 `contracts/openfilm-upstream-lock.json` 逐字节相同。

限制与声明（R1后仍然成立）：

- **所有命令NOT_RUN**：install/tsc/vitest/ffmpeg/browser/真实渲染/真实网络拒绝探针都没跑。本轮候选**未经**任何测试运行验证，**未经**独立复核，**未经**人验。
- **真实T20-E不能由钩子抛异常冒充**：钩子只是MAIN杀进程的接点；真实四杀点未跑。
- `tools/agent-driven/media/render-delivery.ts` 里的fence/commit/hook是harness的内存实现，只作模块证据，**不是生产Job store**。
- 模块测试用替身渲染器/解码器，只证明编排与边界行为。
- 未自签外审、未代签人验、未合main、未push；本泳道实现由Claude完成，Codex冻结SHA后需未参与者独立复核。

R1 Claude exec31438 exit0；PID3593893已停止且无存活子进程。唯一writer现为Codex文档/验收，未接管实现；准备冻结并请求轻测槽。

R1冻结9e1de1879c214f4a1e00e195ced4bd8e8c6085e0，静态R2仍NEEDS_WORK；交同Claude session唯一writer修REVIEW-R2.md。Codex转只读。未运行测试，轻槽待MAIN。

## R2修复轮（本轮，唯一writer：Claude 25d0705c…）

R1冻结于 `9e1de1879c214f4a1e00e195ced4bd8e8c6085e0`；Codex静态审查 `REVIEW-R2.md`=NEEDS_WORK（七条具体缺陷）。按七条逐条修复，**仍然没有跑任何命令**：本轮开工前读了MAIN的资源预约文件 `/mnt/c/workspace/videoworkline/Narralens/docs/execution/A/resource-reservation.json`——状态`A-BASELINE-CHECK / RUNNING`，`lanePolicy`写明"BRIDGE one light slot; … other lanes source-only"，`admissions`里**只有BRIDGE-light**，**MEDIA-light未授予**。因此本轮为纯源码轮：没有install、没有tsc、没有vitest、没有ffmpeg/browser/Host、没有用别的lane的node_modules。未提交、未push、未reset/stash，未动任何受保护路径。

改动的源码：

- `src/host/delivery/published-package-store.ts`：object id改为store自己生成（`object_identity`仅测试可注入），对象目录用**独占mkdir**创建、文件链进这个私有目录（不再用rename覆盖）；`receiptVisible`标记——**receipt可见的对象一律不删**（链接后fsync失败也留着，失败照抛）；只删**自己创建**的对象；`createStaging`改独占mkdir+内部uuid。（R2-1/2）
- `src/host/delivery/download.ts`：`digestOf`改**定位读**（显式offset，fd位置不动），200的流显式`start:0`；描述符在流结束/出错/`close()`时都关闭；同尺寸篡改仍失败。（R2-3）
- `src/host/delivery/delivery-service.ts`：`sameDelivery`改为**整份manifest的规范化比较**（用仓库的`canonicalJson`）；新增`recordMatchesManifest`（记录的project/snapshot/artifact_ref/download_ref要与manifest一致）；**ready读取校验包里的每一个字节**（`verifyPackage`全量哈希）；下载要求持久ready+整份manifest一致。（R2-4）
- `src/host/render/openfilm-guard-rules.mjs`（新）+ `openfilm-guard-rules.d.mts`（新）：守卫规则从wrapper里抽出来，与上游无关因而可单测——页面`offline:true`+`network.allow:[]`、上下文`serviceWorkers:"block"`、**`context.routeWebSocket("**/*")`关闭每个socket**、浏览器加`--disable-quic`与`--force-webrtc-ip-handling-policy=disable_non_proxied_udp`。（R2-5）
- `src/host/render/openfilm-offline-wrapper.mjs`：改用上面的规则模块。（R2-5）
- `src/host/render/native-renderer.ts`：`group_settled`在**所有**失败路径上传播（超时/非零/无响应/取消）；写完请求文件后再查一次signal才spawn；`awaitChildExit`/`awaitGroupEnd`导出为可用假child与假group驱动的函数（`group_exists`/`signal_group`为测试缝）。（R2-6）
- `src/host/render/render-snapshot.ts`：任何未收敛的进程组（渲染失败或QC被取消）都产生`requires_reconciliation`并**保留attempt**；A固定要求的两个角色`["subtitles","rights"]`与请求角色合并后交给preflight与QC；原生清单改为诚实范围（`scope`/`editable_project_complete:false`/`copied`与`referenced`分开）。（R2-6/7）
- `src/host/preflight/preflight.ts`：新增`MANDATORY_A_SUPPLEMENT_ROLES`并在检查里与请求角色合并（请求不能减）。（R2-7）
- `src/host/render/openfilm-render-pin.json`：pin新增守卫规则模块的摘要；wrapper摘要随其改动更新。

测试（全部仍NOT_RUN）：`tests/agent-driven/media/` 13个文件——新增`native-renderer.test.ts`（假child：干净退出、被停止且组已消失、组仍在、从不退出）；`offline-guard.test.ts`改用**假browser/context**断言守卫真的施加限制（上下文`serviceWorkers:"block"`、`routeWebSocket("**/*")`被装上且socket被关闭、flags含QUIC与WebRTC的UDP禁用），保留真实进程"守卫已装上"的探针；`published-package-store.test.ts`新增链接后fsync失败仍完整且重试不覆盖、对象目录被占用时不接管、staging目录被占用时拒绝；`delivery-service.test.ts`新增QC/render_spec/附属件不符都不供字节；`preflight.test.ts`新增缺A必需角色即block；`render-snapshot.test.ts`新增失败留下活进程组时保留attempt；`download.test.ts`保持整文件字节断言。

文档：`A06-MODULE-NOTES.md`加R2七条对照表并更新模块地图；`requests/A06-MAIN-INTEGRATION.md`更新必需角色规则、发布模型（对象独占创建、receipt可见的对象永不删）、以及"包里那份原生源到底是什么"的诚实范围说明。

产物摘要（改动后重算）：worker `87c29133a553ea30bb4d2dba50ff246bb8ba43e1f7e8ae3a6b4918b3c2d88dd1`；守卫wrapper `3da8a0b3a817d80bc9fad8be3d92f022b638c6919e4c959b9a5d895b62a08d30`；守卫hooks `1f73d6b61741062d8b2419323174743ea42ffc93ae282a08cab6f97fe1a7f1ee`；守卫规则 `001f30e71e68a2d4e849e3d8851a870135d2af2df44ae16cc3119196dc8b221c`（同一pin文件记录；改动这些文件必须同步更新摘要）。

限制与声明（本轮仍然成立）：

- **所有命令NOT_RUN**：install/tsc/vitest/ffmpeg/browser/真实渲染/真实网络拒绝探针都没跑。本轮候选**未经**任何测试运行验证，**未经**独立复核，**未经**人验。
- MEDIA-light未授予，因此本轮连"纯模块测试"都没有跑；测试是写好的，不是跑过的。
- **真实T20-E仍不能由钩子抛异常冒充**：钩子只是MAIN杀进程的接点；真实四杀点未跑。
- `tools/agent-driven/media/render-delivery.ts`里的fence/commit/hook是harness的内存实现，只作模块证据，**不是生产Job store**。
- 守卫的WebSocket/UDP限制在**模块层**用假browser/context验证过；真实"渲染时尝试访问外网并被看到失败"的探针属重型验收，`NOT_RUN`。
- 未自签外审、未代签人验、未合main、未push；本泳道实现由Claude完成，Codex冻结SHA后需未参与者独立复核。

R2 Claude exec20750 exit0，PID3628459已终止，writer现为Codex文档/验收。仍未安装或运行测试。等MAIN MEDIA-light后独立执行冻结候选检查。

MAIN正式准入MEDIA-light；Codex唯一writer执行独立offline frozen --ignore-scripts install→tsc→1worker纯模块。禁止ffmpeg/Chrome/Host/全量；源码冻结4a369d601793cd39dfb81117594c20f3c943aca5。

第三次返工由MAIN按用户后续明确指令授权Codex接管共同根因；不再以仅429为限。旧Claude exec20750 exit0/PID3628459及全部子进程已终止；当前唯一writer=Codex，范围仍lane白名单。保留首tsc2/125测116PASS9FAIL原始日志。PRODUCT使用轻槽期间仅源码/文档修复；复验需重新排槽。后续只能称内部验证，独立审查由未参与者承担。
