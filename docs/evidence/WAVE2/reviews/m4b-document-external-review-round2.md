# M4B 文档独立外审 R2（第四轮定向复审）

审查基线：`680832fece542404c53d0872cf9656ef8c7dfa75`；只读 Claude Code CLI；工作树 clean。

结论：`M4B_DOCUMENT_GATE_FAILED`，BLOCKER=1 / MAJOR=3 / MINOR=16 / NOTE=5。

## BLOCKER

- 文档冻结的“三条 OpenFilm insert”与固定上游不相容：会把已有三镜追加成六镜，insert 也不能表达文档声称的
  timeline/source/page/track 字段，且调用签名缺 root。

## MAJOR

1. film=after 的恢复承诺 revision +1 与 M4A 15 分钟 impact TTL 冲突；
2. §1 要求 integrity 全绿，却又要求两个 superseded current-tip integrity 门保留非零；
3. aborted 同 key 是重放失败还是允许新尝试未裁决。

## MINOR 清单

prepared→aborted 文案；intent 命名；roots 未包含新资产；isolated root 生命周期；rightsDigest 复用；锁集合来源；
gateway adopt 形状；M4B 行/幂等键识别；prepared 前恢复；snapshot/fact 允许残留；03 验收矩阵；上游 seam；
隔离上游路径；时序图未同步；Hypit 非 TypedEdit fail closed；R1 未落盘。

R2 后已通过隔离真实上游探针否决 insert，证明九条 closed set op 配方可行；该修订需下一轮复审确认。
