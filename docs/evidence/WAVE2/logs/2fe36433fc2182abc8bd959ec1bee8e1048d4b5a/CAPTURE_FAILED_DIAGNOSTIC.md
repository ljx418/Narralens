# M4A 捕获中止：捕获期间工作树发生文档变化

状态：`CAPTURE_INVALID_ABORTED`，禁止作为冻结证据或改写为全绿。

- 捕获提交：`2fe36433fc2182abc8bd959ec1bee8e1048d4b5a`
- 启动时：`repo_dirty_at_capture=0`
- 中止时：`check-1` 尚未完成，没有 `.exit` 文件；捕获进程收到 SIGINT，shell exit 130。
- 原因：捕获启动后，同一工作树新增 M4B 开工门文档与 Archify 产物。生产代码没有在捕获期间变化，但后续
  命令、凭据扫描和 `git-status-after` 将不再描述同一棵 clean tree，因此不能形成可信正式捕获。
- 处置：保留本目录及不完整日志；先提交文档，从新的 clean HEAD 重新运行完整追加式捕获。不得复用本目录、
  补写 exit 或把其中任何局部结果计入通过总数。
