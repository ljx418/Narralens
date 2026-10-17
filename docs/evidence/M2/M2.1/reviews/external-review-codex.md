# M2.1 独立外审（Codex）

- 审查日期：2026-10-17（Asia/Shanghai）
- 审查对象：`fc3efb4a53e19bca5ad939bd93e40b1af50a428d`
- 分叉点：`1eec29062156356d29e5adc5016b5403a4e3002d`
- 分支：`migration/m2.1-engine-governance`
- 审查角色：独立只读外审；不是实现会话自签
- 结论：`FAIL_REWORK_REQUIRED`
- 严重度：`BLOCKER=2, MAJOR=5, MINOR=0`

## 1. 已复验通过的门

| 命令/检查 | 结果 |
|---|---|
| `corepack pnpm check` | exit 0；25 files / 227 tests；TypeScript 与 production build 通过 |
| `corepack pnpm test:m2.1` | exit 0；8 files / 93 tests |
| 固定 OpenFilm 上游真实探针 | exit 0；PIN-01/02、OF-01..06 报告 PASS |
| `tools/m2.1-gate-mutation-check.sh`（输出到 `/tmp`） | exit 0；MUT-A..F 均能让所属门失败 |
| 变异门后 `git status --porcelain src tests contracts tools package.json` | 空 |

测试通过只证明现有断言通过。以下 findings 表明部分断言没有覆盖所宣称的生产行为，因此不能据此签署 Gate。

## 2. Findings

### B-01 BLOCKER：外部 source 变化没有生产接线进入 attention，测试使用手工置位替代

证据：

- `src/host/server.ts:216-225` 每次请求先计算当前 digest，再把同一个当前 digest 作为 snapshot 传给 adapter；这使该路由没有“已提交基线”可供比较。
- 新增生产代码没有在 `SOURCE_CHANGED` 上调用 `RevisionStore.markAttention()`。
- `tests/m2.1/native-bypass.test.ts:117-139` 没有触发检测链，而是在第 130 行直接调用 `revisions.markAttention(...)`，随后只证明既有 Actor 会拒绝 attention 项目。
- 计划和 ADR 要求 scene/字幕/设置/资产变化导致旧 digest 写入 409、进入 attention、且不自动接受；当前只分别证明了“adapter 可抛 409”和“手工 attention 后 Actor 会拒绝”，没有证明二者相连。

影响：外部变化可以被读取路径重新采样为新基线；项目不会因实际检测自动进入 attention。EN-04 的生产体验和安全终态未实现，现有证据存在虚假闭环风险。

修复门限：引入由 Host/Coordinator 持有的已提交 digest 基线；检测到不一致时在同一受控项目序列中持久标记 attention；增加真实 HTTP/生产 use-case 测试，从外部改 bytes 开始，到 409/attention/后续写拒绝结束，禁止测试直接调用 `markAttention()` 代替检测。

### B-02 BLOCKER：SourceDigestV1 没有覆盖 Hypit 引用的视觉资产内容

证据：

- `HypitEngineAdapter.sourceDigestFor()` 只传入 run、narration 和 manifest 三个 roots，没有把 manifest 内引用的视觉资产作为 `declaredAssets` 读取并散列。
- 独立复现实验在 D1 fixture 副本中给 `assets/generated/visual-10s.mp4` 追加一个 byte，digest 前后均为 `57259ca4...5307`，`equal=true`；manifest 的 `assets[]` 只包含 narration。
- 当前 EN-04 测试修改的是 manifest JSON，而不是保持 manifest 不变后篡改被引用视觉资产 bytes，因而没有发现缺口。

影响：视觉资产被篡改、替换或损坏时，source digest 仍可能不变，stale base、snapshot 和后续采用边界都可建立在错误内容上。

修复门限：从 Manifest@2/legacy manifest 解析实际引用资产，将每个受引用资产的当前 bytes SHA 纳入 digest；增加“manifest bytes 不变、视觉资产 bytes 改变”的负向测试和 HTTP/adapter 集成证据。

### M-01 MAJOR：CapabilityMap 违反冻结计划，空表会把“未报告”当成可翻译

证据：

- 冻结计划 §7.2 要求 `CapabilityMap` 对 registry 每条 operation 给出状态，且 OpenFilm 在 M2.1 没有 translated operation。
- 两个 adapter 的 `capabilities()` 都返回 `entries: {}`。
- `NativeWriteGateway.decide()` 只在显式 `state === "unverified"` 时阻止；条目缺失会继续按全局 registry 翻译。测试还明确断言“不传 capability report 时同一请求被 translated”。

影响：一旦 M2.2 接线，缺失 capability 的 OpenFilm 操作可能沿用 Hypit 的 translated 策略，违反 fail-closed 和单引擎能力隔离。

修复门限：能力表按 engine 完整覆盖 registry，或让缺失条目等价于 unverified/blocked；增加 OpenFilm + `timeline.set_visual_fit`/`replace_visual_asset` 的拒绝测试。

### M-02 MAJOR：冻结证据没有绑定冻结候选，且清单引用的日志未进入 Git

证据：

- `evidence-manifest.json` 的 `repo_sha` 是 `7879e4c...`、`repo_dirty_at_capture=true`，不是外审对象 `fc3efb4...`。
- `docs/11_V1_Traceability.md` 仍把 `905c433...` 写为冻结提交。
- manifest 引用 `logs/*.log` 并记录 SHA256，但 `.gitignore:13` 排除全部 `*.log`；这些日志不在 `git ls-files` 中，新克隆无法取得或核验。

影响：逐 case 证据不能从冻结 commit 独立复核；当前 artifact SHA256 指向本机未跟踪文件。

修复门限：把日志改为可跟踪扩展名或显式纳入 evidence commit；重新生成绑定修复候选完整 SHA、clean 状态和实际外审记录的 manifest；校验所有 artifact path 都是冻结 commit 中的 tracked file。

### M-03 MAJOR：realpath 后的 canonical path 没有用于 visited，内部 symlink alias 会产生重复条目

证据：

- 冻结计划要求 resolve→realpath→包含性检查后，用 realpath 得到的最终相对路径进入 visited。
- `source-digest-v1.ts:251-286` 在 realpath 前用逻辑引用路径检查/写入 visited。
- 独立复现让 `assets/alias.css` 指向 `assets/tokens.css` 并同时引用二者，最终 manifest 出现两条完全相同的 `assets/tokens.css`。

影响：canonical manifest 可含重复身份，对 symlink/别名顺序敏感，并与冻结算法及跨平台可复现目标不一致。

修复门限：队列保存 realpath 后 canonical relative path，在入队时去重；加入内部 symlink alias 和多路径命中同一文件测试，manifest 每个 canonical path 恰一条。

### M-04 MAJOR：固定上游只校验 HEAD，不校验 dirty tree、lock/package/license 摘要

证据：

- `openfilm-upstream.ts:80-113` 只读取 `.git/HEAD`/ref，然后动态加载工作树模块。
- 架构要求完整 SHA、lock digest、许可证和补丁清单；M1B 已记录 package、lock、license hashes，但生产加载器没有核对。
- 在 HEAD 不变但模块被本地修改时，当前加载器仍会加载修改后的代码。

影响：`engine_upstream_sha` 可声称固定 commit，但实际执行 bytes 并非该 commit，破坏供应链锁定和外审可复现性。

修复门限：加载前证明 checkout clean，或校验允许加载文件及 package/lock/license 的固定摘要；dirty 或摘要不匹配必须 `ENGINE_UNAVAILABLE`。真实探针增加 dirty/tamper 负向用例。

### M-05 MAJOR：真实探针 OF-06 没有断言 `rebased === true`，却无条件记录 PASS

证据：

- probe 把 `nativeRebasedTrue.rebased` 写入 detail，但调用 `record()` 前没有 `assert.equal(..., true)`。
- probe 也没有让真实 upstream 的 `rebased:true` 结果经过 adapter；adapter 拒绝 rebased 的证据来自独立 stub 单测。

影响：上游行为改变或探针构造失效时 OF-06 仍会报告 PASS，属于错误测试 oracle。

修复门限：显式断言真实上游返回 `rebased === true`；将 adapter 拒绝路径与同一真实场景关联，或诚实拆成“真实上游行为”和“adapter stub 合同”两类证据，不把二者合称一个真实端到端断言。

## 3. 非阻塞但必须在 Wave 1 内处理的观察项

- `OpenFilmEngineAdapter.stage()` 在部分异常路径中会遗留 staging 临时目录；M2.2 接线前应以 `try/finally` 或 stage owner 清理。
- `absoluteServerPath()` 对 adapter 公开，且 OpenFilm adapter 自行调用，和“只有 Host 能构造”注释不一致；M2.2 接线时需冻结真正不可伪造的 ownership API。
- OpenFilm projection 当前返回绝对 `file://` URL；接入 HTTP 响应前必须替换为 Host token/loopback route，禁止暴露服务器绝对路径。

## 4. 出门判定

`fc3efb4a53e19bca5ad939bd93e40b1af50a428d` 不通过独立外审，不能声明 `M2_1_CONTROL_BOUNDARY_READY`。允许的下一动作是修复 B-01/B-02/M-01..M-05、补齐失败测试、重新跑 25/227 基线及 M2.1/真实探针/变异门、生成绑定新冻结 SHA 的 tracked evidence，然后由独立会话复审。

根据最新四波次授权，修复后的 M2.1 是 Wave 1 模块检查点，不要求单独等待第二次人工批准；但上述 BLOCKER/MAJOR 未关闭前不得进入 M2.2 实质实现。

---

## 5. 第二轮独立复审（返修候选 `971d02a`）

- 复审日期：2026-10-17（Asia/Shanghai）
- 复审对象：`971d02aac88b8f6f1513cbfa52b91923dd033d56`
- 证据捕获代码提交：`172321c831793e4674bbd157468068c16c13bfe7`
- 分支：`migration/m2.1-engine-governance`
- 复审角色：独立 Codex 外审；不是实现会话自签
- 结论：`FAIL_REWORK_REQUIRED`
- 本轮新增严重度：`BLOCKER=0, MAJOR=2, MINOR=0`

### 5.1 独立复验通过项

| 命令/检查 | 独立结果 |
|---|---|
| `corepack pnpm check` | exit 0；26 files / 254 tests；TypeScript 与 production build 通过 |
| `corepack pnpm test:m2.1` | exit 0；9 files / 120 tests |
| `corepack pnpm test:contracts` | exit 0；3 files / 21 tests |
| Python SourceDigestV1 黄金向量 | exit 0；10/10 |
| `hypit-visual-asset` 复现实验 | exit 0；manifest 不变而资产变化时以 `SOURCE_CHANGED` fail closed |
| `symlink-alias` 复现实验 | exit 0；canonical occurrence = 1 |
| 固定 OpenFilm 真实上游探针 | exit 0；PIN-01/02/03/04、OF-01..05、OF-06a/b/c 共 12 项 PASS |
| `node tools/m2.1-evidence-integrity.mjs` | exit 0；26 个引用证据文件可取得、受跟踪、摘要一致；冻结后代码未变 |
| `tools/m2.1-gate-mutation-check.sh`（独立 `/tmp` 输出） | exit 0；MUT-A..K 11/11 均使所属门失败；完成后工作树干净 |

上述结果确认第一轮 B-01/B-02/M-01/M-02/M-03/M-05 的目标行为已得到实质修复，M-04 的固定文件摘要与 tamper 拒绝也有效。但现有断言仍漏掉下述 fail-closed 分支，且权威状态文档未完成同步，因此不能仅凭全绿测试签署 Gate。

### 5.2 R2-M-01 MAJOR：无法证明 checkout clean 时加载器会跳过该条件并继续接受

冻结 ADR D-16 明确要求 OpenFilm 可用性由三个独立事实**同时**成立：固定 HEAD、无 tracked 修改、每个被执行/读取文件摘要匹配。生产实现 `trackedModifications()` 在 Git 调用失败时返回 `null`，而 `openFilmAvailability()` 只在结果非 `null` 时检查 dirty；因此“无法证明 clean”被当成“可以跳过”。

独立最小复现保持真实固定 checkout 和所有固定文件 bytes 不变，只在调用前令子进程无法找到 `git`：

```text
process.env.PATH='/definitely/missing'
openFilmAvailability(<real pinned checkout>)
=> available=true, reason="all pinned files match their digests"
=> checked 中没有 git_clean
```

复现命令以 exit 42 标记错误接受路径，真实输出确认为 `available: true`。现有 `openfilm-upstream-lock.test.ts` 只检查源码包含固定 `git status` 调用，没有模拟该调用失败；MUT-J 也仅移除摘要校验，未覆盖 clean-verification unavailable。

影响：实现和 manifest 对 ER-M-04 的“availability requires ... no tracked modifications”声明不成立。虽然固定的执行文件摘要仍能阻止已知加载文件被篡改，但 ADR 要求的第三方 checkout 完整状态证明会在 Git 故障、超时或不可用时 fail open。

修复门限：`trackedModifications()` 失败必须使 availability 返回 `available:false`（`ENGINE_UNAVAILABLE`），不得返回可跳过的 `null`；新增 Git 不可执行/超时/非零退出的失败测试，并增加对应变异门。真实上游正向探针仍须确认 `checked` 包含 `git_clean`。

### 5.3 R2-M-02 MAJOR：主 traceability 与架构状态仍描述第一轮旧实现，和当前候选冲突

独立检查发现：

- `docs/11_V1_Traceability.md` 顶部和 M2 表仍把 `fc3efb4...` 写作当前候选，并要求关闭已经返修的 2 BLOCKER/5 MAJOR；Gate M2.1 小节又写“返修后候选 `4f2dfea`”，并非本轮冻结候选 `971d02a...`。
- `docs/03_Architecture.md` 的 EnginePort/EngineBindingStore/NativeWriteGateway/SourceDigest/OpenFilmAdapter 状态表仍声称 Host-only path 未关闭、生产 attention 未接线、CapabilityMap 为空、视觉资产未进闭包、realpath alias 重复、加载器只验 HEAD、OF-06 oracle 未修复；这些描述与当前源码和本轮复验结果相反。
- 同一组权威文档因此同时表达“已返修”和“仍是旧缺陷”，无法作为 M2.2 的可靠输入。

影响：后续 Claude Code 可能重复实现已经完成的修复、依据错误架构状态设计 M2.2，或错误识别当前冻结点，正是迁移流程要求避免的返工与规格漂移风险。

修复门限：逐项同步 `docs/11_V1_Traceability.md` 与 `docs/03_Architecture.md`，明确区分第一轮历史结论、第二轮返修事实和仍未关闭的 R2-M-01；当前候选使用完整 SHA `971d02a...`，证据捕获点继续使用 `172321c...`，旧 Gate 历史保留但不得冒充当前状态。增加文档一致性检查，至少机械拒绝“当前候选 SHA 多值”和已关闭 finding 在当前架构表中仍标为未实现。

### 5.4 第二轮出门判定

`971d02aac88b8f6f1513cbfa52b91923dd033d56` 不通过第二轮独立外审。第一轮 2 BLOCKER/5 MAJOR 的核心代码缺陷大部分已关闭，但 R2-M-01 与 R2-M-02 未关闭前仍不得声明 `M2_1_CONTROL_BOUNDARY_READY`，不得进入 M2.2，更不得声明 M2、Gate D4.2、Gate V1-P0 或 V1-Full。

下一允许动作仅为：修复 Git clean 检查的 fail-closed 分支与测试/变异门；同步两份权威状态文档；重新冻结并跑受影响专项、全量 check、真实探针、完整性门，然后由独立会话做第三轮复审。
