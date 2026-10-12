# D3 真实选区写入证据

状态：Gate D3 已通过；内部审计与两轮 Claude Code CLI 实现外审闭环。

真实链路不是 mock：Headless Chrome 点击 UI，Host 经 SQLite journal 与 `ProjectWriteActor` 调用固定 Hypit Studio 的 `parameter.adjust`，将 `shot-002` 从 `cover` 改为 `contain`；关闭并重启 Studio 后修改仍存在，关闭并重启 Host 后 project revision 仍为 3。随后 UI/真实 API 通过第二个正常事务恢复 `cover`，revision 增至 4。

最终夹具 Source SHA 恢复为 `ae4edebf...fcab3a`；Run SHA `bff6a663...c738` 与旁白资产 SHA `ca8d3773...07a` 全程不变。真实 `hypit check` 与 `hypit plan` 通过。

证据入口：

- `evidence-manifest.json`：测试、哈希、限制和清理总表。
- `artifacts/real-write-e2e.json`：双事务、409、423、幂等、Studio/Host 重启和 check/plan。
- `artifacts/browser-write-e2e.json`：真实点击与布局断言。
- `artifacts/ui-contain-committed.png` / `ui-cover-restored.png`：r3/r4 页面状态。
- `security/credential-scan.json`：源码、构建物、descriptor 与证据扫描。

截图只证明 UI 状态；写入事实以真实 session、Source/Run/旁白 hashes、重开和 CLI check/plan 为准。
