# PROC-0实施准备（DRAFT，不是release）

本文件只减少合同通过后的派发等待。必须先取得rev2独立PLAN_READY，再核真实W HEAD、旧writer终局、无在途recorded、全部保护摘要；未满足前不执行。

## 唯一writer与允许路径
ClaudeCode使用用户现有供应商，在Narralens-agents/main-integration编码；MAIN不并发改该目录的源码或Git索引。
候选仅tools/run-delivery.py、tools/check-delivery-spec.py、tests/process/test_delivery_admission.py、tests/process/test_delivery_handoff.py、tests/process/fixtures/admission_helper.py及自身docs/process/proc-0/OWN_*材料。新增其他路径需先由MAIN具名补票。不能改src/contracts/依赖/配置/原recorder/R6夹具或旧evidence。

## 实施与冻结后bootstrap
阶段A：先编码和准备direct tests，不运行尚未绑定的测试或新runner。全部16项直接反例/正控按合同L1准备；mock Popen、身份及失败注入，不实际启动产品、helper或signals。通过Orca ask向MAIN交该次改动清单、当前完整SHA与待运行精确命令，冻结源码并结束turn。
阶段B：MAIN在同一实施任务内核范围/保护项及所有真实recorded输入，将原recorder FIRST的纯测试命令与唯一capture精确绑定后回复。不是再次完整外审或新的人类审批。没有该绑定前不执行；CLI参数不套timeout，不后台运行；每次命令实际结束后才能修改源。若纯测试失败则保留录制原件、按票范围修复，下一冻结输入再由MAIN绑定，不覆盖失败或沿用旧pin。
阶段C：全部L1反例/同源direct命令与case表齐，提交CODE_CANDIDATE_FOR_REVIEW；独立源码复审之后，才可由MAIN发L3有限真实工具自证票。最终L4需全部16项各层证据，不能用L1 status冒充最终工具通过。

## 案例与交还
逐PROC0-01..16：实际实现入口、测试名、mock与实际证明边界、command/capture/inner和outer exit、source与protected摘要、原件SHA、未完成L3证据。G1–G4新增反例不得遗漏。实际跨进程排他不由mock声称。
保留当前R6 partial packet与所有历史失败，不将原R6交还缺项调绿；新文件加入后记录器扫描集合必须重新发现，不硬编码652或历史651。

## 停止与连续工作
普通实现错误同票闭环；合同真歧义给MAIN一次合并提问。新429即时停止并保全，不能自动重试、重启、换供应商或Codex接实现。无用户新决策时MAIN连续推进工具门后原R6/R7/R8/NEXT，不在本准备稿处缩减goal。
