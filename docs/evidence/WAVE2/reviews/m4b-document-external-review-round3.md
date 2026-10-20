# M4B 文档独立外审 R3

审查基线：`98a70e3225b0dd78c207d1337b358668b3db00eb`；只读 Claude Code CLI；工作树 clean。

结论：`M4B_DOCUMENT_GATE_FAILED`，BLOCKER=1 / MAJOR=2 / MINOR=8 / NOTE=5。

## BLOCKER

- 采用成功后 active snapshot、source digest 与 ledger roots 已变化，但 `ActivatedProjectionService` 仍强制使用
  migration target snapshot 与 immutable plan roots，导致关闭重开 inspect 必然拒绝。

## MAJOR

1. aborted 幂等失败 response 没有冻结 wire shape、HTTP 与逐字重放语义；
2. 要求新增 `evidence:wave2:m4b`，但全部最低执行清单遗漏它。

## MINOR

必读路径；edit 回值与回读 problems 区分；time 必须为 number；帧秒换算；MP4 扩展名；prepared 前态；
探针缺脚本/证据；diagram 一致性记录。

R3 后已冻结 immutable post-adoption projection fact、failure response contract，补齐捕获命令并新增可复验上游
spike 脚本与 evidence。该修订必须由下一独立会话确认后才可开工。
