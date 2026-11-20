# A剩余开发与大阶段验收协调计划

状态：准备阶段计划，代码IMPLEMENTATION_NOT_STARTED；正式启动必须由MAIN在本Goal结束后发布具体release。D01-D15是跨领域合同决策，03是唯一文件owner表；领域TASK的旧名单若不同，先按03向负责人核对，不自行扩大。

## 总目标和复用边界

A的出门仍为真实外部Agent驱动同一持久工程：两主题、60–180秒真实中文人声与授权本地素材、可编辑概念与每镜原生clips、样片/完整首章及章包/封面/QC审阅、受控改单镜、关闭重开、两次正式导出、可带走文件。保持原Studio/M5，仅增量Bar/系统侧面板与必要审阅/素材入口。旧D1至迁移及M5的历史门保留，不宣称旧UX面板PASS等于此次A/V1。

先保留已有创建、同库创作、实际准备processor/verifier、原生渲染/字幕、UI013/expected015、媒体/QC/包原语；不从零重写。每个用户路径内连续实现/局部审查，不把每个函数变成完整外审或人验停点。

## R0：可重现共同基线（MAIN协调，BRIDGE Codex核查）

本轮已经备份/核对25项MAIN及310项BRIDGE dirty，不因此把其视为已提交/最终审查通过。未来明确激活实施后，在MAIN现有worktree先对照完整838ba5f2c8500f0103f56dbe51264ea9f70086fc、baseline-observed/source-map/归档逐字节核对；复核当前processor/store/worker/verifier并做必要受影响验证，显式路径冻结保留来源。历史closure与380b verifier manifest不能当当前ffef/current overlay PASS。

MAIN得到实际共同commit后，将其完整SHA及已审合同摘要填入每lane ReleaseAssignment，并由Orca为同仓实施checkout准备独立目录；原研究worktree分支/310文件候选不reset/stash。运行根/DB/dist/profile各自独立，vendor只读。R0是机械/工程启动前置，不再让用户审批每个小模块；本轮不执行这一步的代码冻结/业务检查。

## R1：三领域并行交付可联调生产者/消费者

- BRIDGE Claude：BR-A-ENTRY/HOST/FACTS。复用已落地MCP/启动器并接真实应用；实现实际ProductFactPort/TrustedAdoptionAuthority，注册workflow handlers与任务/Job/context一致回执；Host先恢复/动态排除generic reaper、关闭await；实现素材附属transport。没有四真实生产能力就保持Run unavailable，不发空202。
- MEDIA Claude：A-MEDIA-1及A-MEDIA-3的独立媒体部分。保全processor/verifier，补只读adoption proof与安全prepared preview；抽取阶段化encode/inspect/publish端口，先保存可恢复EncodedFact，复用原始renderer/QC/包原语，不在章节阶段发布Delivery。不得操作共享DDL/Coordinator。
- PRODUCT Claude：P-A1/P-A2。复用既有组件，完成真实本地素材登记UI、预览审阅、原有Bar/非模态系统面板、013/015原生观测/独立expected与显示；限定挂载和native gateway文件按03独占。无真实接口时显示blocked/unknown，不填模拟数据。

并行以真实已审port/同一fixture开始，MAIN收首次consumer→producer联调，不等三条独立“全部写完”。自测只证明对应范围。重型build/多Host/ffmpeg/浏览器/全量按全机单槽排队，不能三个窗口各跑一份全量。

## R2：审阅—受控采用—原生加载

BR-A-REVIEW + A-MEDIA-2 + P-A2：真实准备闭包→ps_不可变映射→可读审阅包/原result_ref→一次可信Decision/Approval→原change.*服务入口→窄共同guard→唯一Coordinator的created typed提交→CreatedSourceFact→真实NativeAck。

必须组合证明：准备不写工程；纯accept+0，采用+1一次；同key重放不重签/重算/重复+1；base/control/selection/锁/许可/源bytes变化拒绝；当前job terminal_reason SOURCE_ONLY而非新JobKind；成功Job无live lease时仍用新的adoption proof合法复验；取消/暂停/过期/旧attempt不自动采用；Host commit后UI未观测时保持未确认。旧migrated M3路径不借ps_；旧Hypit/strict409/EnginePort恰七方法不回归。

## R3：正式导出、最终QC决定与恢复

A-MEDIA-3 + BR-A-RECOVER + P-A3：committed snapshot固定编码→EncodedFact/技术QC事实→章节/封面门→delivery阶段最终QC完整章包（私有gate binding明确qc）→可信用户一次确认当前质量报告/warn处置→同Job新lease继续package→持久ready/receipt/outbox→鉴权下载。

编码、QC、published包receipt与DB业务可见性四证据分别核对；读不渲染，重复包不重编码；producer编码attempt与publication winner及执行lease分别记。先媒体模块增量、再真实Host入口、再进程丢失矩阵；T20-E四边界必须终止自有真实进程，throw不是替代。保留全部失败捕获；不得把未知异常一律写ENOMEM。

## R4：A组合冻结与人工入口（MAIN负责）

按05及三领域ACCEPTANCE跑同一组合冻结SHA适用回归、真实首端MCP、两主题60–180秒、完整decode/probe/字幕/许可、改单镜变化与不变区、重开/两正式导出、T20-A..H、安全与Headless；关键候选由未参与实现的独立上下文复核。更新实际架构、traceability与中文HTML截图证据，准备启动入口/服务及最小体验步骤后停在人验，不代签。

未来只有用户完成A人工验收且B开工条件满足，才进入B（完整制作/监控/Comfy等），C再长片/全P0P1NFR。此处不前置B，也不缩掉A承诺。

## 汇报、修复和人类输入

每lane Codex控制唯一writer；Claude输出实际SHA/文件/命令/逐case/日志及SHA256、失败/未运行、进程归属及清理、剩余依赖。领域先复核再交MAIN，MAIN负责共同根因和跨lane冲突；同阶段超过两次返工由MAIN接管，不循环机械退回。429要确认原调用/子进程停止才移交Codex；恢复后不自动抢writer。设计作者/实现者不自签独立验收。

真实中文录音/授权本地素材尚需合法输入，不访问J盘猜文件、不把tone当人声；这是A媒体验收的输入条件，非全部软件开发的先决阻塞。当前PRODUCT子Claude自报读取配置并将token带入工具输出，事件见audit/CREDENTIAL_EVENT.md；不复述值/不改凭据，由凭据持有人处理，后续模型核对只用会话自报。

本轮停点：设计/验收方案/任务包审核结束，三个可见Claude均只读检查并待命；不启动R0以后的实际实现，不启动产品服务或进入B。

## 独立复核排程（MAIN负责组织，不在本轮启动产品验收）

R0冻结前由未参与当前被审实现的干净Codex上下文审核overlay实际字节与受影响验证；R2由未参与BRIDGE共享事务及相应PRODUCT原生观察实现者核对真实集成；R4由未参与组合候选实现者审冻结commit与完整实证。BRIDGE共享68项不能由自身签独立PASS。领域Codex自验证/交叉设计ACK与独立产品审查分别记录。若无合格上下文，该审查仍REVIEW_PENDING，不由MAIN或Claude冒签；此处是明确验收依赖，非本轮新增审查任务。
