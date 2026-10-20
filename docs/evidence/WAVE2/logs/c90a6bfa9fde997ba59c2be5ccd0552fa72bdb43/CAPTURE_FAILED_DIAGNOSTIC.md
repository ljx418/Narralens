# M4A 捕获失败：第二轮全量门未到达 after_locks fault

状态：`CAPTURE_FAILED`，禁止作为冻结证据或改写为全绿。

- 捕获提交：`c90a6bfa9fde997ba59c2be5ccd0552fa72bdb43`
- 启动工作树：clean；捕获过程中未修改；脚本 `overall=1`。
- `check-1.exit=0`。
- `check-2.exit=1`：70 files 中 69 passed/1 failed，852/853 tests passed；唯一失败为新增 TX-05A
  `after_locks` rights fault 用例的 `changed=false`，说明请求在目标 fault point 前提前返回。原断言未携带 response
  body，日志不足以把原因归类为资源失败、业务拒绝或生产缺陷。
- 拆分门：typecheck/contracts/M4A(101 tests)/M3/W2.0/M2.1/fitness/Wave1 historical/真实 OpenFilm/
  hash vectors/credential scan 均 exit 0；Wave1 current integrity exit 1 为预期历史项。
- 处置：保留全部日志；先让 fault-not-fired 断言打印 response body，执行定向重复复现并据实际错误修复。不得以
  拆分 M4A 通过替代第二轮全量失败，不得在同一目录补跑或更新 manifest。
