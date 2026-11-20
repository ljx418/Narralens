# 用户明确恢复原 R5E 任务（续接 StageB）
用户已确认额度恢复并要求继续原任务。原 writer 已由 Orca 确认 stopped/exited；这是同 task_cee119e0c0e4 的 retry，不创建新范围。

先读本文件、USER_RESUME_001_PREFLIGHT.json、RELEASE.json、SPEC.md、MAIN_STAGE_A_APPROVAL.json、MAIN_GUARD_FIRST_CAPTURE_DIAGNOSIS.json、429_PRESERVATION.json。当前八文件必须匹配本次 preflight；原 release startsha 是历史起点，不得覆盖当前 partial dirty bytes。保护七文件、AGENTS、旧日志、Approved015 与索引保持。

StageA已经静态批准，正式回复 msg_ba614742777d；续接 StageB，不重做已完成的文档/摘要审批。停工前生产修复尚未开始，三份测试含未完成guard组织修正。首两identity捕获均exit1，不能作PASS；原全局任意PGID信号0→ESRCH不被批准。请优先核对当前末次修改是否已完成如下两点：默认全部deny、每需要的case/fixture显式限定synthetic PGID+signal脚本并断言；afterEach/tearDown以try/finally隔离复位但保留原失败，不能先清空再断言。不得通过删除守卫/放宽断言获得绿灯。少量共同helper可复用，但不是全套件默认gone。新增安全漏mock反例正确消费预期拒绝，或显式证明遗漏预期导致ledger断言失败；不要让整套件故意永久红。不要真的测试固定PID存活。

之后连续完成SPEC四类根因（guard、原group证据义务、必需hash、联合发布v2和legacy consumer），不要仅修guard就交还。publications内部exit0/1/2/3已锁定；不再为报告格式反复请求审批，追加勘误即可。报告只用原指定ownreport。

仅原八现有文件+自身报告；六种approved命令首跑即用原run-recorded.py与唯一n1n2-claude-060p5e-名字，不timeout包裹recorder。不能覆盖已有capture；执行期间源码不可变。生产变更和完整最终轻量证据完成后worker_done，MAIN独立复核再另发真实N许可。本票禁止实际C/N、混合lifecycle执行、Host/browser/media/Q2/full/build/network/付费、J盘、配置凭据和Git变更。源码、失败、INCOMPLETE、历史审查均保留。

新429立即停止上报，禁止自动重试/改供应商/自动接手。用户这次授权仅恢复原Claude任务，不授权Codex替代实现。实际新Task/Dispatch以Orca注入为准。
