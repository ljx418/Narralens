# 实现任务释放边界与实际分工

2026-11-09；这是可供审批的任务设计，**不是ReleaseAssignment**。当前仅文档工作，CP-A0未冻结，生产实现NOT_RELEASED，四个实现角色会话均NOT_STARTED。文档作者的准备工作不等于这些实现会话已启动、Claude已领取任务或已生产注册新能力。

## 实际目录、角色和状态

| 角色 | 实际目录 | 后续责任 | 实现会话状态 |
|---|---|---|---|
| MAIN | `/mnt/c/workspace/videoworkline/Narralens` | 公共合同/DDL/鉴权/核心事务/bootstrap/注册/旧核心挂载、跨lane接线与统一验收 | NOT_STARTED / 无release / 无当前实现writer |
| BRIDGE | `/mnt/c/workspace/videoworkline/Narralens-agents/bridge-observability` | 目录内Codex设计/文档/验收；Claude Code CLI实现MCP/入口Skill/launcher/观测 | NOT_STARTED / 无release / 无当前实现writer |
| PRODUCT | `/mnt/c/workspace/videoworkline/Narralens-agents/product-workbench` | 目录内Codex设计/文档/验收；Claude Code CLI实现创作/工作台及R4新增组件 | NOT_STARTED / 无release / 无当前实现writer |
| MEDIA | `/mnt/c/workspace/videoworkline/Narralens-agents/media-delivery` | 目录内Codex设计/文档/验收；Claude Code CLI实现snapshot render/QC/交付与后续受控能力 | NOT_STARTED / 无release / 无当前实现writer |

目录确实存在。现有`../Narralens-agents/workspace-receipt.json`仅为历史准备回执，preparedFromCommit=95087de9bfafdf2f2e339f3d2f2e8991ca11c8a7；本次源码HEAD=fd3021c336387b4c6405b3db08abaafa81c842ff。不能据旧回执宣称当前四树已同SHA/干净或安装依赖。MAIN发放前只读核每树HEAD/dirty/branch/运行根，保留用户dirty，再用审核提交对齐同一冻结合同；不得reset/stash覆盖或自动push/合main。

## 路径和单一所有者

静态路径政策完全沿用`../parallel-plan.json`。以下白名单是上限，实际任务只能释放其中具体文件；protectedFiles/protectedPrefixes优先，不能以宽前缀授权旧同名实体。

**BRIDGE**：`src/mcp/`、`skills/narralens/`、`skills/narralens-lib/`、`src/launcher/`、`src/host/observability/`、`tests/agent-driven/bridge/`、`tools/agent-driven/bridge/`、`docs/parallel/lane-bridge/`。

**PRODUCT**：`src/app/observation/`、`src/app/system/`、`src/host/creative/`、`src/host/workspace/`、`tests/agent-driven/product/`、`tools/agent-driven/product/`、`docs/parallel/lane-product/`。

**MEDIA**：`src/host/render/`、`src/host/preflight/`、`src/host/delivery/`、`src/host/providers/`、`src/adapters/comfyui/`、`src/adapters/retrieval/`、`src/adapters/voice/`、`src/adapters/subtitles/`、`src/adapters/cover/`、`tests/agent-driven/media/`、`tools/agent-driven/media/`、`docs/parallel/lane-media/`。

MAIN独占保护前缀：`src/contracts/`、`contracts/`、`src/host/projects/`、`src/host/engine/`、`src/host/m5/`、`src/host/agents/`、`src/host/jobs/`、`src/host/agent-driven/`、`src/app/m5/`、`vendor/`、`docs/evidence/AGENT_DRIVEN/`、`tests/agent-driven/integration/`、`src/host/system/`。

MAIN独占保护文件：`AGENTS.md`、`CLAUDE.md`、`package.json`、`pnpm-lock.yaml`、`tsconfig.json`、`vitest.config.ts`、`vite.config.ts`、`vite.m5.config.ts`、`src/host/server.ts`、`src/host/api-error.ts`、`src/host/security.ts`、`src/host/persistent-job-store.ts`、`src/host/job-defaults.ts`、`src/host/job-store.ts`、`src/host/outbox.ts`、`src/host/start.ts`、`src/host/recover.ts`、`src/host/creative/project-creation-service.ts`。

一般新建工程拟`src/host/projects/project-creation-service.ts`由MAIN唯一拥有；PRODUCT只消费BootstrapPort。原OpenFilm adapter的render接缝位于受保护旧核心，MAIN实现或单文件显式例外，不落在MEDIA宽前缀。生产schema/validator/registry/DDL始终MAIN；业务producer不是注册owner。旧M5/唯一selection/clock/Coordinator/EnginePort七方法保留。

保护例外不能只写“允许跨目录”：必须列单文件、理由、owner、有效任务/期限、合同/消费影响和MAIN审核。未列例外默认拒绝，worker在本lane `docs/parallel/lane-*/requests/`提交请求；MAIN改公共文件或另发单文件任务。同一文件只一owner，正式evidence与跨lane集成测试归MAIN。旧s0/R4冻结与历史evidence本轮不可写。

## 首轮具体任务单（尚未释放）

所有任务依赖及验收族以iteration-plan.json原DAG为准；冻结port后模块可提前编码但包验收不能跳依赖。以下不修改17包顺序。

| 包/验收前置 | 具体责任与输入→输出 | 接线及停止条件 |
|---|---|---|
| IT-P02 / IT-P01 | MAIN汇总4准备包及独立文档审查，冻结schema/TS/validator/registry/DDL/向量/错误/权限/恢复+资源+媒体计划 | 当前只此文档范围；没有精确同hash/用户实现授权/MAIN任务释放即不启实现 |
| IT-A01 / P02 | BRIDGE纯launcher/instance/健康模块；MAIN实例生命周期注册/owned-shared/持久目录 | 冷/热/重复启动、停止/重开、5s/15s TTL，A-COLD；共享实例不得kill |
| IT-A02 / P02 | BRIDGE MCP facade+入口Skill，用MAIN冻结AppPort→真实Codex发现/read/reconnect；客户端分别实测 | MAIN注册/鉴权，A-MCP；未知名字/版本不得自造alias，未授权端阻塞留证 |
| IT-A03 / P02 | MAIN共享仓储/Job/幂等/恢复/事件水位与签名cursor；PRODUCT读模型问答；BRIDGE事件投影；MEDIA仅Comfy只读目录 | A-EVENTS/CANCEL/ENTRANCES/CATALOG；未冻结scope/签名/消费原子性就停相关链 |
| IT-A04 / A01,A03 | MAIN一般bootstrap/new-migrated/初始commit/补偿；PRODUCT摘要与脚本消费者 | 两主题创建/重放冲突/真实中断，A-CREATE；不能假迁移或第二库 |
| IT-A05 / A02,A03,A04 | PRODUCT固定流程、样片/首章/章节审阅、单镜真实候选、WorkflowTopBar/SystemControlPanel；MAIN旧M5/Coordinator/原生ack；MEDIA真实候选素材 | 必须覆盖T12安全与T15/R4体验；A-FILM/WRITE/ENTRANCES/EVENTS/UI，禁另建根/时间轴 |
| IT-A06 / A01,A02,A04,A05 | MEDIA committed SnapshotRead→真实render/QC/完整包；MAIN持久Job/注册/原adapter接缝；PRODUCT真实状态 | A-REOPEN与T20-A..H（E四崩溃点分别）；无真实encode/decode/原子发布不能签完成 |

第一批MAIN公共冻结/装配与三lane纯模块并行；第二批一般新建→真实MCP/UI/准备→采用/ack→snapshot render小链持续接线。不能等三lane模块绿后才首次连Host。A末统一冻结候选、适用全量/真实媒体/恢复/独立复核/用户验收，最多声明AD_SHORT_FILM_READY。

B1须A_ACCEPTED+CP-B0+本轮授权；B2须RESOURCE_JOB_ASSET_READY与对应包依赖；C须B_ACCEPTED+CP-C0+授权。稳定授权、模板自由组合、RunPlan调整、真实模型/网络/声音制作及长片不能借A任务暗中实现。B/C详细任务先保留原计划PLANNED，阶段开始前再报具体释放，不逐模块增设人工停点。

## ReleaseAssignment机器记录要求（设计，不填伪SHA）

下面是MAIN未来每个任务必须填全的字段约束；不是已签发实例。`null`、占位值、短SHA、笼统“all”或空验收命令不能通过释放检查。

| 字段 | 必填规则 |
|---|---|
| `assignment_id,ticket,phase,status` | 唯一任务ID、已有IT编号、A/B/C、明确RELEASED；当前文档全为NOT_RELEASED |
| `authorization` | 用户具体授权来源/原文范围/时间；文档认可不替代实现授权；费用/外传另按范围记录 |
| `base_sha,contract_sha,contract_manifest_sha256` | 完整40hex Git SHA与64hex摘要；producer/consumer签同一合同版本/向量及错误表 |
| `directory,branch,owner,writer,session` | 上表绝对目录、实际分支、唯一文件owner、当前唯一writer、真实已启动session ID；未启动写NOT_STARTED不能伪造ID |
| `allowed_files,allowed_new_prefixes,protected_exceptions,forbidden_paths` | 精确列本任务文件；新增目录受静态白名单限制；protected例外逐文件MAIN记录；不得空泛全仓授权 |
| `inputs,outputs,producer,consumers,dependencies` | 冻结port/schema版本/fixture摘要→具体输出及接缝；包依赖逐项状态与证据；未到前置不能签包通过 |
| `acceptance_case_ids,commands,fixtures` | 本文A case/EX/R4/T20及适用旧门；实际存在的完整argv/cwd/预期exit；不存在脚本先作为本任务交付并标NOT_RUN；媒体manifest/rights/hash |
| `runtime,resource_reservation` | 独立var/dist/DB/staging/profile/node_modules/端口；CPU/RAM/GPU/ffmpeg/多Host/大fixture预约所有者/时间/容量/自有PID清理 |
| `business_scope,network,external_transfer,cost` | 项目/run/动作/输入/费用与外传明确允许或禁止；owned/shared；不得默认下载模型/访问J盘/切凭据或provider |
| `rollback,stop_conditions` | 新挂载关闭保留旧编辑器；内容回退受控restore新revision；DB不可降级时只读/导出；未知结果先对账；冲突/越范围/合同漂移停止并请求具体修订 |
| `handoff,evidence,independent_review,human_gate` | TASK/HANDOFF、日志与实现SHA/dirty清单、未参与者身份/结论；人验另签；失败/未跑保留 |

释放前MAIN先给用户可审核的目标/范围与不承诺项、任务包/依赖、实际角色目录状态、公共改动责任、测试/回退及阶段人验步骤/阈值。用户具体批准本轮实现后，MAIN才签发有范围的记录；不是用户签一次就全仓/全阶段永久授权。模块正常失败自行修复，第3次返工接管共同根因；涉及人工事实/高风险契约/范围扩大或真实外部阻塞才升级。

## Codex/Claude交接与429

每lane Codex先写TASK/HANDOFF，Claude只接已释放实现。同目录仅一writer；Claude写时Codex只读，不并发改文件、索引、分支、运行根。Claude交代码/测试/复现/产物摘要，Codex冻结实现SHA再独立读代码/重跑；MAIN接线后重跑组合链。TASK/HANDOFF记录base/contract/HEAD/dirty、writer、命令/PID/子进程/日志、未完工作与接手原因。

429时无需再次问用户，先确认原调用及全部子进程已结束或受控停止，记录错误/未完工作，复核HEAD/diff保留dirty，移交唯一writer给Codex，仅续已授权剩余任务。不reset/stash、不换凭据/provider、不追加付费请求。Claude恢复仍停直到显式交还。Codex参与实现后的验证只能称内部验证；由未参与实现MAIN/其他干净上下文独立复核，MAIN也写过则另找未参与者。审查暂不可得REVIEW_PENDING，不能越相关门。

## 文档出口与真实阻塞

文档可审核需四准备包互相引用、路径/状态/向量/任务/验收一致，并记录文档独立复核；不是要求本轮运行生产测试。`readiness-check.json`区分DOCUMENTED、SELECTION_PENDING、REVIEW_PENDING与NOT_RUN。真实媒体/录音授权和hash、客户端连接、fresh/old DB升级与崩溃、生产身份/审批消费、签名cursor/原生ack、render/decode/发布恢复、模型/receipt/未知费用与人验均不能由文档检查解决。
