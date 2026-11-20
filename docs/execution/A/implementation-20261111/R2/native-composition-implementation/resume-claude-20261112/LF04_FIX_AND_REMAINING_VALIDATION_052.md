# 052 LF04第二项目真实构造修正与剩余验证

MAIN已核实051 localasset24PASS，authority组53PASS1FAIL，626inputs一致无源码变化。失败是LF04创建第二项目POST409而非202；foreign impact/transaction实际拒绝与不变性比较尚未触达，不能计为通过。051剩余真实export/reader/legacy全NOT_RUN。

唯一允许改tests/agent-driven/integration/created-source-adoption.test.ts中的LF04真实跨项目case及必要本地诊断，不改生产、其它测试/fixturehelper、配置或索引。旧失败证据保留。

## 先证实原因，再修case

MAIN读当前代码发现LF04复制相同definition:IntakePut:valid向量后没有换brief.meta，createdProjectFixture首次建项也用该向量。可能putIntake按同一key重放原intake，后来creation409是正确保护。此为推断，不是已取到的wire错误。

先只补HTTP响应诊断（每个响应body只读一次，保留原status/code/details；不得把token/headers/本机绝对路径写报告），用唯一小门执行原错误，记录真正409的code和已有intake/project绑定。读取原fixture真实creation.request.intake_id等可用事实，断言第二次创建前intake与首个不同。诊断红灯保存，不能当做新生产回归或试探性放宽expect。

原因证实后为本case第二流程的IntakePut meta设置独立幂等键/关联ID，后续confirm/create保持独立，要求真实新intake、新decision、新project且同一Host同一DB。同key重放/单intake项目约束不变。保留真实foreignimpact/transaction存在性与归属、两次精确拒绝及双方authority完全不变断言，不换不存在id、不手工造项目行/第二DB，不mock完整服务。若实际409不是此原因，按rawcode事实解释；发现生产defect或需要其它路径就停交MAIN，不改防护让case过。

## 执行许可

所有候选保存完整bytebackup/hash；原recorder串行052-tsc-NNN→052-lf04-NNN（只-t完整LF04该case）。仅此case已证实的测试构造/诊断必要修正可在命令真正终态/另tool读结果及自有清理后连续完成，每轮唯一capture、红灯均保留，不盲重跑、不扩超时。命令执行中全inputs冻结，所有非本test的051guard固定。

最新编译0且小门1PASS、实际触达两个foreign拒绝与完整不变性，hash稳定和自有清理完成后，冻结整个候选，条件顺序执行JSON的authority整组→真实export→完整reader→legacyfixture。任一非零/漂移/清理不确定立即停止，后续NOT_RUN，禁止自修或重复冻结后门。全部绿后也报告MAIN并保持冻结；未授权full/build/mutation/下一接线。

真实export诊断媒体仅自有temp副本，canonical opaque固定不动；真实音视频probe/decode、900帧双目标render/改单镜/重开按原test，不以常量替代，产物给SHA。旧标题页迁移不宣称原视觉保真、既有Hypit回调不宣称fresh付费render。reader耗时可报告当前真实capture，不加并发/预算。

唯一Claude重型槽，Headless静音loopback，不J盘/下载/付费/外传；新429立即停，不自动重试/供应商切换/接手。禁索引及git add/commit/reset/stash/checkout/push，保护AGENTS/Expected015/公共DTO/EnginePort/pin/config/运行器/旧Gate。工作区均直接videoWorkLine同级，不建立Narralens项目入口层或其它newworktree。全部原失败保留，原17/A/V1/冻结外审未通过不自签。
