# M1A 独立外审 R4

审阅工具：Claude Code CLI 2.1.300（新的独立只读会话）

审阅冻结实现：`c0f101b964f9cfe492095440eba1bb9b0edad42d`

审阅证据提交：`5b5c5d67ef2fae7fa4efc52840071d1cddb8b3cf`

结论：`ALLOW_M1A_CLOSE=YES`

统计：critical=0，major=0，must-fix=0，minor=6

## 独立核验结论

- 8/8 M1A manifest artifact 与 22/22 D4.2.1 artifact 的 SHA256 均与磁盘内容一致。
- 五份浏览器 artifact 均绑定冻结实现 SHA，均为 `status=passed`、`failures=[]`。
- R3 两个阻断已真实关闭：裁切扫描覆盖所有可见 `body *`；200% PNG 的 IHDR 为 952×3635，与文档宽高一致，确为完整页面。
- IM-01..IM-26 与完整 D421 冻结矩阵逐项检查，没有以 134/134 总数替代直接证据。
- 测试 seam 仅能通过构造器注入，HTTP 请求不能触达；生产 bundle 未发现测试开关。
- R6 ENOMEM、R7 timeout 以及 R1/R2/R3 的 NO 结论均保留。

## 非阻断 minor

1. `source_commit` 仍属于操作员提供并校验 40 位十六进制的声明，不是工具自行读取 Git。
2. artifact 没有单独的 scan-scope 字段，扫描范围需从证据工具源码核对。
3. manifest 未完整登记所有 canonical PNG；200% PNG hash 当时只写在 README。
4. 内审文档引用的 4.176 秒来自单项复跑，不等于 R8/R9 日志中的 4.685/4.068 秒。
5. README 的 D421-LARGE-01 行仍残留旧 artifact 路径。
6. `pnpm-check-r9.log` 自身没有内嵌 commit SHA，绑定依赖 evidence manifest。

其中 3/4/5 在本外审后做文档卫生修订；1/2/6 作为非阻断证据链限制保留，不重写已执行 artifact。

## 强制声明边界

- Headless 自动化：PASS。
- headed 自动化：`NOT_RUN`。
- 人类体验：`NOT_RUN`。
- legacy bundle 已验证可读与完整，但本轮没有执行真实旧工程重开/导出。
- M1B 是独立技术 spike；OpenFilm 尚未接入生产路径。
- 只关闭 M1A。P0-08、P0-09、Gate D4.2、Gate V1-P0、V1-Full 均不得据此声明完成。

外审还指出：包内不存在 `11_External_Review_Prompt.md`；该位置实际为 `11_Risks.md`，审计提示位于 `10_Codex_Handoff.md` §3。
