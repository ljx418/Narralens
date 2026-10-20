# M4A Codex 返修失败捕获

本目录是失败捕获，禁止作为冻结证据或改写为全绿。

- capture commit：`002461bcf780c2d08fa40e678c317e8938dd3328`
- `check-1.exit=1`：70 files 中 69 通过，850 tests 中 849 通过；唯一失败为
  `M4A-NW01 ... leaves source, revision, commit... identical`，首次 impact 请求返回 503 而非 201。
- `check-2.exit=0`：同一提交原样第二轮 70 files / 850 tests 全绿。
- `wave2-m4a.exit=0`：8 files / 98 tests 全绿。
- contracts、M3、W2.0、M2.1、fitness、历史门、真实 OpenFilm 探针、Python hash、向量重建、
  凭据扫描均通过。
- `wave1-integrity.exit=1` 是已知历史门：它断言 Wave 1 冻结后无代码变化，不计入本次 overall。

`check-1.txt` 没有输出 503 的结构化错误码，不能把它归类为 ENOMEM。能够确认的是：失败只发生在
`maxWorkers=2` 的全套聚合负载中；相同 M4A 专项和第二次全量通过。下一候选降低全量测试 worker 并发，
不删测试、不放宽超时、不改变断言，然后在新提交上重新捕获两次全量门。
