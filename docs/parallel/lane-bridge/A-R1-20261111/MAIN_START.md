# MAIN：R1正式实施令（覆盖此前仅预检/凭据等待的指令）

当前用户goal已明确授权A实际开发和各领域ClaudeCode实施。现在三local ReleaseAssignment均RELEASED，精确base=84deba07927fa59b45a24039b4740a2f9d3fd430；R0源码freeze=9f583239714835a89332fcae9363aa39d887821d，两个commit的src/tests/contracts/tools/package/lock完全相同。新增只是经过三领域最终ACK的协调文档与授权解释，不重跑刚过R0全部检查。三目录已经MAIN在文档writer settled后ff，原四票文档未覆盖；每目录独立离线依赖版本验证完成，无外部依赖链接。

## 已授权调用，不重复审批

AUTHORIZATION_INTERPRETATION.md已说明：实际凭据事件处置UNKNOWN，不假称轮换/风险接受；当前用户明确ClaudeCode实施已经授权既有研发CLI调用，MAIN此前待async答复门是过度解释，已纠正。不能继续把旧准备包/旧TASK中的该等待当阻塞，不读取凭据/配置来“验证”；不切供应商/模型、不扩大到产品付费provider或素材外传。后续用户明确限制则优先。

## 每领域现在做什么

1. 核实际cwd/base/dirty和本地ReleaseAssignment状态/文件hash、committed CR-R1-001第1–8节与registry/interface-decision。更新本票TASK/HANDOFF/CLAUDE_IMPLEMENT的当前执行节（旧记录原样作历史），使完整提示词携带新base、新scope、127总owner/本票55或23或12路径、真实fps描述和本实施令。不再整包设计重审，不让Claude裁决架构。
2. 通过Orca在本精确checkout启动一个ClaudeCode实施子窗口，keep-open，配置沿用用户既有MiniMax（不传猜测model flag，不读~/.claude/.codex/.env或dump env；仅会话自报模型，UNKNOWN也如实写）。使用完整本票CLAUDE_IMPLEMENT+本令+实际ReleaseAssignment，记录Task/Dispatch/handle/父子关系/输入绑定/unique writer。保持后台不抢焦点。CLI普通workspace trust只在核实自身已审仓目录后正常确认，不切换审批模式或加绕过权限开关；启动信息页可在精确核实后确认。先读实时Orca技能；spec-file是宿主路径，不把/mnt/c字符串当Windows路径，必要时用受支持stdin加载。
3. Codex写票据结束后移交Claude唯一代码/index/运行根writer，Codex仅只读；确认child真正收到任务，input_accepted/timeout不算已执行，不重复fresh launch。CLAUDE具体实现+子阶段自测，Codex读代码/证据与真实生产接缝后向MAIN回报，不拿组件/fixture当A全链PASS。

## R1并行先后与早期共享类型

MEDIA先实现assembly-ports中的本次CompletedPreparedSource/两purpose proof/真实预览receipt+reader/metadata类型，保证旧调用向后兼容，做最窄类型检查后显式提交一个可复用类型候选并报告MAIN；随后连续实现真实文件proof/隔离preview，不等待额外人工审批。PRODUCT先实现controlled-studio-access的独立UI grant类型及兼容旧native的最小接缝，并早交精确类型候选；随后继续Gateway/UI/预览消费者。BRIDGE可同时先修R0-M01同库关闭一致性、素材接口和事实服务，再消费已冻结类型接UI delegate与生产装配。

依赖另一领域的新export时不造生产替身/重定义第二协议来“通过编译”；报需要的明确producer类型commit，MAIN协调早期集成。只将有限缺producer动作标blocked，继续其他本票工作。跨分支Git集成由MAIN协调，源writer在安全边界确认停写后由本lane负责人处理index，不能在活动测试/并发writer期间merge。shared代码有唯一owner。

## 验证与资源

轻量typecheck/纯单元可在独立目录运行；任何Host/真实媒体/ffmpeg/Chromium/大型fixture/build/full gate先经Orca向MAIN申请全机重型单槽，不能三条各跑一套。原失败与NOT_RUN保留，未知问题不一律ENOMEM，不改超时或guard躲红灯。每条真实命令argv/cwd/exit/log/sha256与case覆盖落本票logs/evidence；旧docs/evidence与封存包不改。MEDIA先在允许的processor测试文件把新诊断输出转获准私有票据目录，不能继续向旧历史目录写新捕获。

R1只证明已授权模块和真实接缝，不要求R2–R4先实现：四真实能力全部接线前Run保持不可用；不能inject TestGrant或硬编码available为了让生产handler返回202。真实生产happy-path和完整影片在后续组合实现后验收，不伪称R1已经可用。原业务Actor/Coordinator/Job/lease/step/outbox/幂等、strict409、七方法EnginePort和单timeline/clock不变。UI别名31+5+2明确计数。

## 自主接管与停止边界

发生Claude429时MAIN现已按用户goal预授权本lane Codex安全接手：必须先证原调用及其子进程停止、保全全部dirty/实际命令/失败，记录唯一writer移交，再实现原释放范围；不需要为已经满足条件的接手再问用户，Claude恢复后不自动抢回。无法证明停止则报告MAIN，不冒险双写。同阶段超过两次返工由MAIN接管共同根因和必要修复，不机械重复退回。

模块实现/自测/小修闭环连续推进，完成本票后冻结明确实现SHA及scope证据交MAIN，等待必要跨域接线，不擅入未释放的R2/R3或B，不自签独立产品/人工验收。阶段末由MAIN统一组合实证与独立审查，停A人验。
