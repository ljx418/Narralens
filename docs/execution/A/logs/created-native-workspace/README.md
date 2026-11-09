# Created native workspace内部捕获

基于6ff718ec7b799fbf24791569be4a01dae86820ea之上的增量实现。r1类型检查失败记录保留；r2/r3分别实际5/7测试通过；r4类型检查及11个真实Host/SQLite/pinned Studio测试通过。r4测试47.46秒。

原exec5320已结束、当前handle不存在，结果由保存的原始日志复核，不因观察handle丢失重新运行。r5为受影响回归，完成后追加。

版本窗口测试覆盖closing和同commit派生cache身份替换，不宣称已实测新业务revision提交竞争。实际工作台读合同、受控跨origin身份、loaded观察、Run/assembly/正式导出尚未完成，不能签A05/A。媒体fixtures均非真人内容验收。
