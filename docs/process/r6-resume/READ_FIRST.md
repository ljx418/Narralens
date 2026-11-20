# R6续做准备：不是执行许可

本目录只为PROC-0审查等待期间整理原合同与当前字节，不修改受审合同或实施源码，不恢复旧Claude任务。

## 已确认的开工风险
当前cache-worker-integrity.json仍保存旧C/Host摘要；STATIC_PREFLIGHT.json列出真实差异。源码先完成再具名generate，保存生成的输入变化，之后新绑定同源验证；不先运行真实C/N，也不手填摘要冒充生成。
原protected列表的AGENTS.md已因用户批准流程固化改变，不能沿用旧hash；其他保护项逐项比较。原R6合同/验收draft与原共同根因说明保持历史原件，只新release绑定当前字节。
原recorded扫描范围按真实代码静态发现，不硬编码651；PROC-0新增工具/测试后本清单必须重新捕获。

## 下一实施释放的前提与范围
先PROC-0合同/工具完整验收，再按原R6 rev2合同释放原8条源码/测试与自身报告。C/Host一个writer，保留现有WIP，不reset旧冻结点。原17与ISO01..18不裁剪；C06/C07/C08所有已释放证据键必须齐，再独立源码审。C09真实helper与kernel始终另票，不能随纯测试准入而隐式释放。

## 内部闭环顺序
1. 当前协议producer→consumer逐启动分支，按epoch/completion建立有界事实，N专用wait与诚实failed terminal。
2. 全阶段stream服务→实际finish→receipt→Host close；预算/EIO失败保持原cause，unknown资源继续持责。
3. 原case直接正反例与生产入口对照；旧挂起fixture当前已用文件，仅补验不重复声称修复。
4. 原六FIRST命令具名录制，运行期不改输入，无timeout外壳；最终固定源后同源全部结果与逐case交还。
5. 独立源码审通过后，新pin最小normal/fault，再递进stream/backpressure、C09和其他真实场景；最后R7/R8及NEXT停止。

新429立即停，不能利用本准备文档自动重试或接手。当前所有运行NOT_RUN。
