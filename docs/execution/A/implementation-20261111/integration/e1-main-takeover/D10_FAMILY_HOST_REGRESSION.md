# 实际 family 接线的既有 Host 回归

实现冻结6ff5a14f5fc72db00d6ce8d5b87a57394c5a216e，real041-families 实际退出0，**17 PASS / 36 SKIPPED / 53 total**。只选与本改动直接相关的两个原测试文件；不是完整 M4B/C 或全项目门禁。命令/筛选表达式/日志/原退出均原样保留。

M4B真实 Host路由10项通过：6个发表前边界重启后中止且revision+0，损坏request的旧 attention/error code，同域多个pending行，保留其他legacy模块事务，以及孤立adoption暂存目录清理。M4C真实Host7项通过：同6个发表前边界，加发表后收敛同一次提交revision+1。新源码未导致这些旧场景回归；各测试的模拟中断方式按原代码，不将异常抛出泛称为SIGKILL。

捕获及封存前复验的612个输入摘要完全一致，source_changed/source_added空。日志SHA256 `43218267b3d1771df9295be176abda490b0900280768ba7adef34add73e0b712`。已记录两个实际测试PID均未列出，观测范围见real041-process-observation.json。

新 created 恢复、真实三个family长交错链、generic排除与Host进展调度尚未接线；本次不能关闭 RCV-D10-08/10，更不能代替created SIGKILL/NativeAck/双正式导出或 A人工验收。D10_FAMILY_ORDER_REPORT.md 的早期received receipt/source证据缺口仍保留；原测试的state/revision通过不等于补验其全部wire错误响应。
