# 内部验收工具最终发布语义：MAIN技术裁决草案

仅规划，待R5D两正式复审合并后写入下一精确票，不释放源码/运行。不是PRD/API/EnginePort变更，不推翻R5D旧捕获退出码；历史计数/结果照旧保留。

## 为什么单纯补authoritative标志不足

final.json写入可能先留下完整字节，随后close/EIO抛错；再次覆盖“失败final”也可能失败。因此不能承诺靠重写文件必能抹去所有旧绿字节。只让main返回1也不足，因为1正好是故意断言失败验收通过的预期退出。返回对象、序列化文件、真实外层结果必须共同拒绝。

## 选择：内部CLI版本化退出码，联合准入

下一工具版本拟明确：0=正常合成draw证据全部有效；1=已发布有效记录的预期故障（普通业务失败若沿用1也必须final.kind明确failed，不能只看exit）；2=参数/入口拒绝；3=必需证据/报告/资格发布不可靠。所有必须artifact read/list/hash/write/report错误均为3。此为本地验收工具私有协议，MAIN可以协调全部现有消费者，需在下一票显式冻结并列旧新对应及测试修改，不隐式更改历史捕获期望，不影响Host公开错误码。

final只有与外层recorder真实退出码及候选/manifest实际hash一致时才可作为联合准入事实；任何final文件或返回对象单独绿均不构成通过。final字段写明joint-authority版本，manifest不自哈希，final由MAIN外部hash。发生final写后抛错时不再必需反复写最终文件来“修绿”，保留其未可靠发布事实和外层exit3即可明确拒绝，即使文件JSON完整。

## 实现不变量

1. 先聚合所有单项artifact错误、必需candidate/manifest的非空完整SHA以及写/报告错误，再形成候选qualification。不得在judge后静默读取hash，不得返回null当成功。
2. 对最终文件写入用可观测success/failure结果。失败立即更新返回kind=failed、faultCasePassed=false、authoritative=false、exitCode=3；原业务Error/原图片/cleanup事实保留，不改成成功或丢首因。
3. main按返回最终状态退出，不在main之外用expectedexit1掩盖发布失败；所有当前消费者含legacy normal都核authoritative、无证据错误、有效joint-record与外层/返回码，不能只看image或kind。
4. 必需发布失败后没有额外“必须成功报告”操作；原owner已terminal可如实报告证据失败，不因报告流损坏再失去仍活动owner。原C/N清理权限不受此协议修改。

## 决定性测试

使用实际main/runner与文件形状的writer：beforewrite抛EIO及把final序列化为字符串保存后再抛EIO两类。必须比较序列化后bytes的JSON快照，禁止把同一可变对象塞进数组后观察到evidenceErrors后来增长就声称磁盘记录已被改写。两类均返回failed/false/3；即便bytes中残留绿字段，联合validator因退出码不匹配拒绝。validnormal仍0，validexpectedfault仍1。逐项hash失败和最后linkhash失败、reportEPIPE同样不绿。旧断言的退出码更新列明是本次内部协议变更而非删除失败测试。

## 测试隔离必须先于上述反例运行

下一票先在两个TS文件对process.kill作failclosed spy，未显式模拟的调用记录并抛错，afterEach即使生产吞掉异常也断言未授权调用0；synthetic PID绝不交给real kernel。Python全部危险raw接口默认deny，显式case注入才可用；_FakeOs不能通过__getattr__回落真实kill/fork/exec/wait/prctl。不重跑之前漏mock的危险实验；先封边界、检查，再跑旧业务反例与修复，保留全部越界/失败证据。
