# Narralens A PRODUCT Claude · 只读启动检查

你是 PRODUCT Codex 下属 ClaudeCode，由真实 Orca worker-start 启动。当前仅检查能否接手，不执行开发。用户要求使用现有 MiniMax 配置；仅依据本会话可见模型报告记录是否一致，不读凭据/环境密钥/配置秘密，不更换模型供应商；无法确认写 UNKNOWN，不能由 claude 名称推定模型。

工作目录为 Orca current 实际目录，请记录 pwd/CLI实际路径。canonical=/mnt/c/workspace/videoworkline/Narralens，同Windows C:\workSpace\videoWorkLine\Narralens；MAIN事实=/mnt/c/workspace/videoworkline/Narralens-agents/main-integration，HEAD期望838ba5f2c8500f0103f56dbe51264ea9f70086fc且有dirty processor/verifier；PRODUCT候选=/mnt/c/workspace/videoworkline/Narralens-agents/product-workbench，HEAD07399c230023591b84fa2872b45b2a8b58b286f4。路径映射本机可达即用，不造替代项目。

阅读顺序：canonical AGENTS.md；docs/agent-driven-v1/11_AGENT_DELIVERY_PROCESS.md；execution-planning/01_EFFORT_AND_STAGE_PLAN.md；implementation-design/07_EXPERIENCE_SPEC.md、08_WORKFLOW_MCP_CONTRACT.md（均在docs/agent-driven-v1下）；docs/execution/A/contract-freeze.json；docs/execution/A/relaunch-20261111/baseline-observed.json；同目录 product/DESIGN.md、ACCEPTANCE.md、TASK.md、本文件。然后只读MAIN package.json、creation-application.ts、creative-service.ts、fixed-workflow-service.ts、product-repository.ts、created-workbench-service.ts、created-native-workspace.ts、M5Panel/observation/system、相关合同与测试；旧lane requests013/015 active-candidate/CONTRACT/results作为候选证据。不要从旧lane推断MAIN没实现。

本次具体任务：核实四文档是否足以在MAIN正式release后接手A连续路径：Agent内容定义→真实样片/首章→可信受控采用→原Studio NativeAck→改单镜→双导出。检查真实实体/调用/逐字段约束/Host独立expected与真实observed/旧身份与stale/错误幂等取消恢复、R4增量UI与单clock/selection；检查立即实施与依赖实施范围、白名单、合同提案、验收反例及命令是否真实存在。指出具体文件/符号/错漏，不把请求公共合同直接改为生产API；记录哪些必须MAIN裁决与哪些文档可直接闭环。

唯一可写文件：/mnt/c/workspace/videoworkline/Narralens/docs/execution/A/relaunch-20261111/product/CLAUDE_READINESS.md。其它文件包括四份文档、代码、测试、配置、AGENTS、索引、工作树均只读。禁止运行任何产品测试、build、安装、渲染、启动产品服务、业务脚本、git提交/合并/push/cherry-pick/rebase/reset/stash、配置更改、新外传、读取密钥/J盘、子agent。允许只读 cat/rg/git status/rev-parse/hash/path和已有依赖目录存在性检查，不运行或导入产品模块。资源无预约，不擅自拉起工具链。即使旧AGENTS有A开发授权，本轮限制仍优先。

只读输出模板：实际CLI及cwd；路径可达与HEAD/dirty匹配；会话报告模型/证据或UNKNOWN；四文档审阅结论READY_FOR_MAIN_REVIEW或BLOCKED（并非开发已释放）；必须修订的准确位置/理由/建议；现有工具链依赖存在性与未来资源要求；立即可实施票据/依赖票据；公共合同请求；本轮业务验收全部NOT_RUN；未做独立验收。开发启动必须等待MAIN设计/验收审定与完整ReleaseAssignment，当前不启动编码。

未来开发自验证规则仅供检查计划，不是本次授权：MAIN批准后按TASK单writer/精确白名单实施，ACCEPTANCE命令从package scripts出发，记录逐case前后事实/产物hash/退出码/首次失败和变异反例；整体链和重型资源由MAIN预约；正式交付按TASK HANDOFF模板，停A人工门不进B。429不得擅改配置或模型，按Orca报告并由领域Codex确认writer已停。

完成后通过Orca injected preamble的worker_done准确返回，指出已写readiness路径、可闭环问题与阻塞；不用自建PTY或终端输入操控。任务有失败按outcome failed，不隐藏；无实现/产品验收PASS声明。


补充必读：MAIN 02_MAIN_CONTRACT_AND_DECISIONS.md、05_MAIN_ACCEPTANCE_AND_REVIEW.md及PRODUCT四文档末尾新增章节。P-A1需检查可信UI选择已配置sourceRoot受控相对目录中的实际视频/中文录音，填写source/license/recording_origin，Host验证登记，Agent只读inventory接同一asset_id，不要求用户复制ID；没有任意路径/上传/J盘扫描。LocalAssetRegistry只有内部import/list，不等于生产入口。MAIN将冻结独立附属UI transport及只读MCP inventory合同，不动原80defs/31routes；RP-P5与新增纯组件/验收仅提案，当前绝不实现。请将这条路径及Host现有字段/错误/幂等/取消对账纳入readiness检查。


补充D-01..D-07：请核对MAIN 02末尾裁决候选及PRODUCT DESIGN末表ACK。特别检查D-03真实JobReceipt.result_ref→review.read包版本/hash，D-04一次可信决定+限定Approval已持久但commit未完成时显示采用pending（现有decideReview可能让gate accepted/run running，不得早绿），D-06只有015两部分不够全Ack；素材inventory仍是独立附属提案、不可暗扩原31tools。可在readiness记录这些尚待MAIN实现release的依赖，仍只读不测试。


最新补读MAIN 02中的D-08..D-12与D-01精确DTO，以及同包contracts/asset-inventory-v1.schema.json、registry.json（只读设计文件）。UI POST是candidate_id+meta/project/source/license/recording_origin，Host解析路径/hash/attestation，目录不hash全部文件；原31不改但明确附属5HTTP+1resource扩面（素材4+review-media 1）。请核对change HTTP→验证服务→Host-only effect、review.decide一次批准/自动apply并发幂等/采用pending、完整source恢复、真实Ack；报告自身工具链若未知写UNKNOWN，不运行安装或产品测试。四文档末尾同步更新。


最终修订指令：本次只读子任务已完成，本文不自动重启任务。未来重新使用前先读TASK最终HANDOFF与MAIN 03 exact owner列表、DESIGN readiness闭环表；仅有MAIN正式release才能从只读切到开发。禁止读取/grep任何用户配置或凭据（包括为核实模型）；仅以会话自报，未知写UNKNOWN。此前子任务发生过配置读取导致token工具输出的违规，不能重复、复述或自行轮换。workflowHandlers10路由注册必须与facts/adoption注入同批；created采用走D08..10新消费分支，不把prepared源塞旧M3 ready_for_adoption路径；旧service测试归BRIDGE，PRODUCT仅明确分配UI/native接线。完整精确白名单以TASK最后表与MAIN 03为准，取代早期提案；素材测试采用local-asset-registration.test.tsx。不将缓存存在性当实际corepack pnpm已验证，不联网补工具链。


最终优先补充D13–D15（仅未来正式release后实施；本文件不自动唤醒旧任务）：阅读MAIN02的D13..15及03、DESIGN最新ACK、ACCEPTANCE P14、TASK最终交接。新内部事实表一律created_*，不动精确cp_a0 schema及冻结SQL。SOURCE_ONLY是succeeded Job terminal/provider receipt的事实，成功任务无running lease，MEDIA proveForAdoption重建当前proof。编码encoded与qc_inspected各自不可变持久化，技术QC不得自签accepted；五项chapter_pack在Host created_review_gate_fact绑定qc门，PRODUCT以RunGate.kind=qc+绑定包显示交付质量确认，原review.decide可信接受后才publish。展示全部warn并绑定当前quality/decision/disposition，block绝不可accept覆盖，普通章包/样片接受不代QC，无新wire kind/target_gate/决定API。待审释放lease同Job queued，确认后真实package才running；UI区分技术完成、待人确认、发布中、正式就绪。按03独占分配UI+native Host模块、既有单clock/selection，不重造状态权威。现无release是正常停止边界非需反复报告的文档缺陷，业务测试全部NOT_RUN；凭据违规记录保留，绝不再读配置/凭据，仅会话自报模型或UNKNOWN。
