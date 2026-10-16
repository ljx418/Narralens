# M1A 独立外审 R1

审阅工具：Claude Code CLI 2.1.300（独立只读会话）  
绑定提交：`8f8632e723441372bc14c9ba65bff6ebe2f8fc49`  
结论：`ALLOW_M1A_CLOSE=NO`  
统计：critical=0，major=2，must_fix=4

## 原始发现（保持结论语义）

1. `D421-UI-01/02` 的既有浏览器证据没有代码 SHA，不能证明由冻结提交生成。
2. “第 257 项”测试实际因重复 identity 失败，没有命中容量上限分支。
3. IM-04 缺不同文件名的重复 `file` part 直接用例。
4. IM-16/17 仅注入错误，没有证明实际媒体子进程超时终止与真实 stderr 上限。
5. IM-19/21 直接调用 registry 且使用 mock bytes，没有走 HTTP GET 并在两次 GET 间真实改文件。
6. 旧内部实现审计绑定 `84775af...`，没有覆盖本轮 production test seam。

正面结论：外审确认 test seam 的默认生产行为不变、HTTP 不可触达注入依赖；制品哈希匹配；没有越界宣称 M1B/M2。

## 闭环动作

- 增加同名/不同名重复文件 part。
- 使用真实超时 shell 子进程并验证 PID 消失，使用真实 stderr overflow 可执行文件。
- 256 项通过真实 HTTP inventory route；两次 GET 间以同长度真实改写 bytes；单项 timeout 独立降级；对第 257 个合法唯一 entry 直接断言容量 409。
- 浏览器证据脚本强制记录完整 `source_commit`，将从新冻结实现提交重新 headless 执行。
- 新增绑定新实现提交的内部审计；然后启动全新 Claude Code 会话复审。

R1 是失败审阅历史，不能被后续报告覆盖或删除。
