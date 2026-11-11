# Publisher 身份接线整组回归

绑定实际实现 `d8fdc1a0b16cd5a594ba7516dd0cb932d3cc910f`。独占资源 `R2-MAIN-D10-PUBLICATION-IDENTITY-001` 下串行执行 real040，完整原 adoption/N3 测试文件 **43/43 PASS**，exit0，duration346.17s（337.62s tests）。没有筛选或跳过；不是全项目门禁。

原始命令与日志见 real040.cmd.json/.txt/.exit；日志 SHA256 `b19b726d68d1af2afbd5d8ac83d22d8b8cf492293c0dffb56b80447e32fbc038`。捕获包含 611 个文本输入，source_changed/source_added 均空，封存前再逐字节重验全部摘要。原先 real02439通过未被拿来替代本次结果。具体正向/负向/故障、审批/step/outbox/源树与清理测试均在该原始文件，未宣称这些 fixture 的 accepted review 是人验。

独立复审：msg_2ce4b8868317 / ctx_a229c4656342 对不可变 d8fdc1a 的 bounded integration ACCEPT，未识别 B/M，仅覆盖当时已完成专项与控制；复审时 real040 在运行，审查者未读取它，不能冒称独立外审重跑43项。MAIN 现在单独核对本次原始结果。另一个调度组件64884a8 bounded ACCEPT 见 D10_COMPONENT_INDEPENDENT_REVIEWS.json。

命令已终止，记录的测试与父进程 PID 均未列出；范围限制见 real040-process-observation.json。专项进程崩溃恢复、实际三域恢复/Host接线、NativeAck、正式双导出及 A 阶段验收仍未完成；RCV-D10-01..10 NOT_RUN。
