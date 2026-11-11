# MEDIA 最终异步清理与公开回执边界修复

范围：34118 独立审查最后一条 MINOR；不覆盖 UI/R1/A 验收。

对象目录由服务保留一个 FD，close 等待 public preview 完整结束后释放。预览先完成所有 copy/workspace 异步清理，再将内部结果交给 public preview；public preview 同步检查取消、close、目录身份、proof 与 author/rights，成功返回路径无 await。失败只经原目录 FD 清理自己 inode，清理完才释放 active sentinel。

真实单 worker 14/14 PASS，包括三个 copy-source-directory.close 的确定性屏障：取消、关闭、proof 撤销。原 34118 实现用同样新测试得到精确 3 FAIL/11 SKIP（test exit1），失败为返回了回执而非拒绝；随后从持久快照逐字节恢复修复源码，SHA630d9222c33bcd44e01bd2dad46328e59c4db95dc90069af9b310be0d51fced0。类型检查29923 exit0。日志、时间、输入摘要与真实退出码见相邻 JSON。

保留原 05889 与 34118 NOT_PASS 审查，不改写。全程静默 Headless，仅合成3秒诊断媒体，非人工音频/授权素材或 A 验收。独立增量复核待进行。
