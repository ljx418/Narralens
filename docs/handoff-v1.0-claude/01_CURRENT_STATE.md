# 当前事实快照

## 1. Git 与上游固定

- Narralens：`main`，远端 `https://github.com/ljx418/Narralens`；当前本地冻结实现 HEAD `84775af32950b06c90ed7c2555cf9e46d0c5095c`，文档/证据提交与推送待外审闭环。
- OpenMontage gitlink：`9327439db69021ab4b0e2776729bf3b58fdb5a87`。
- Hypit gitlink：`6fdd8c0f02c17b9970aee6deb4550a70e9d57acf`，开发分支 `narralens/d4-typed-media-mutation`。
- 已通过的 fault/race 实现提交：`7872329`；对应文档提交：`f93d245`。
- Headless 浏览器门禁实现提交：`84775af32950b06c90ed7c2555cf9e46d0c5095c`。

## 2. 已完成并可复用

| 阶段 | 已验证能力 | 不能外推的范围 |
|---|---|---|
| D1 | 30 秒真实 Hypit 工程、双导出、重开、改单镜、ffprobe/帧样本 | 不代表真实母项目或字幕通过 |
| D2 | 同页面真实 Claude CLI Runner、单提案、SSE、NOWRITE | 不代表多提案或采用 |
| D3 | typed visual fit、revision、visual lock、journal/恢复 | narration/duration 主动锁与用户历史恢复未完成 |
| D4.0 | 已登记本地素材的 typed `media.replace`、补偿、真实 build | 不包含多提案、导入或实体化 |
| D4.1 | 3–6 多提案只读比较、真实三案、费用/模型审计、NOWRITE | 不包含 materialize/adopt |
| D4.2.1 候选完成 | runtime contracts、共享队列、Hypit @1/@2 lease/expected SHA/TOCTOU、AssetRegistry/journal、严格 multipart、真实媒体验证、导入路由、公开库存、可访问 UI、64 MiB/backpressure、fault/race、Headless 100%/原生 200% | 内部总审计通过，外部总审计未关闭；不得进入 D4.2.2 |

最近一次冻结实现上的全量门禁：16 test files、126/126，TypeScript 与 Vite build 通过；命令和计数记录在 `docs/evidence/D4.2/D4.2.1/evidence-manifest.json` 的 `automated_gate`。fault/race Claude 外审为 `PASS / 0 critical / 0 major / 0 minor`，最终 D4.2.1 外部总审计仍待执行。

Hypit 全仓测试不能声明全绿：完整并发运行记录为 1126 passed、3 个 runtime-local process timeout、2 cancelled、23 skipped；受影响用例独立复跑通过。D4.2.1 只能声明 Studio 专项门禁和受影响隔离用例通过，详 evidence manifest 的 `full_hypit_suite_boundary`。

## 3. 当前待提交文档与证据

实现与证据脚本已冻结在 `84775af`。当前工作树应只剩状态文档、内部总审计、canonical/attempt 浏览器证据和本交接包；外审前不得丢弃或覆盖。

- `docs/evidence/D4.2/D4.2.1/artifacts/d421-browser-import.json`：100% canonical pass。
- `docs/evidence/D4.2/D4.2.1/artifacts/d421-browser-zoom-200.json`：原生 200% canonical pass。
- `docs/evidence/D4.2/D4.2.1/screenshots/`：canonical 与失败 attempts 的截图证据。
- `docs/implementation/D4.2.1-internal-implementation-audit.md`：最终内部总审计。

已在冻结实现 `84775af` 上于 2026-10-15 重跑 `corepack pnpm check`：TypeScript、16 test files、126/126 和 Vite production build 全部通过。

## 4. 浏览器证据已证明与未证明

已真实证明：

- Chrome 选择一个真实 MP4（自动化使用 CDP `setFileInputFiles`，不是伪造 JS File）；
- 其余表单以 Tab、文本输入、Enter 提交；
- HTTP 201、manifest @1→@2、journal `committed`、库存重读、300 帧、eligible；
- revision 保持 2、attention=0、Author Source/Run/narration SHA 不变、页面不显示 `project_path`；
- 1440 CSS viewport 无横向溢出，axe violations 为 0。

- 2026-10-15 已在全新临时 fixture 用 Headless Chrome 重跑：HTTP 201、@1→@2、journal committed、revision=2、attention=0、Author/Run/narration SHA 不变、库存重读、无路径泄漏、无横向溢出全部通过。
- axe violations 为 0；`.frame > span`、`.frame > strong` 显式不透明背景后由 axe 判定，`#intent` 仍为工具 incomplete，但人工计算对比度 15.37:1 并已独立记录。最终 artifact 明确不声明屏幕阅读器兼容。
- Headless Chrome 原生页面缩放 200% 已通过：隔离 profile 的 `partition.default_zoom_level.x` 对应 factor 2，DPR 1→2、外层窗口尺寸不变、无控件裁切；没有使用 device scale、viewport 缩半、CDP page scale、CSS 注入或 headed 自动化。此前 headed 探索不作为证据并已移入回收站。
- 未证明：真实屏幕阅读器兼容、OS 文件对话框本身、操作系统 DPI/放大镜；这些均未被 artifact 冒充为已通过。

## 5. 环境清理

本轮创建的 `.d421-*` 临时工程与 Chrome profile 已移入系统回收站；4173/4174/924x 测试进程及可见测试浏览器已停止。仓库 canonical fixture 未被浏览器导入修改。未来复跑仍须按 `05_D421_RESUME_RUNBOOK.md` 再次清理当次临时目录和进程。

## 6. 当前禁止声明

- 不得声明 D4.2.1、D4.2、P0-08 或 V1 完成。
- 不得把“资产已登记”写成“已素材化/已准备采用/已采用”。
- 不得把失败 attempts 当成 canonical pass，或从 axe/ARIA 结果外推真实屏幕阅读器兼容。
- 不得开始 D4.2.2 文档或生产实现，直到 D4.2.1 独立外部总审计、发现闭环、状态提交与 Git 推送全部完成。
