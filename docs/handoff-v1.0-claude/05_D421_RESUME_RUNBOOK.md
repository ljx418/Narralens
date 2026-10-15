# D4.2.1 中断恢复操作手册

## 1. 首要目标

只关闭 D4.2.1 的独立外部总审计、状态提交与推送门禁。浏览器/200%/全量回归/内部总审计已经完成；不要重跑无关门禁，也不要开始 materialize 或 adopt。

## 2. 开始前检查

```bash
cd /mnt/c/workspace/videoworkline/Narralens
git status --short
git log -1 --oneline
git submodule status
git diff --check
```

预期实现 HEAD 为 `84775af32950b06c90ed7c2555cf9e46d0c5095c`，并看见 `01_CURRENT_STATE.md` 列出的文档/证据 WIP。若状态不同，先解释差异，禁止 reset/checkout 覆盖用户修改。

## 3. 已关闭的浏览器证据门禁

`d421-browser-import-evidence.mjs` 已完成以下修订：

- `aria-prohibited-attr` 等语义 incomplete 必须失败；
- `color-contrast` incomplete 不可静默忽略，必须配套记录计算色值、对比度、背景最浅值和人工结论，或修改样式让 axe 可判定；
- 报告字段区分 `violations`、`incomplete_adjudicated` 和 `manual_checks`；
- 不记录 token、绝对路径、浏览器 profile 或临时 fixture 路径。

## 4. 已完成的全新临时 fixture 复跑

1. `pnpm check`，确认角色修复未回归。
2. 在 Windows `C:\workSpace\videoWorkLine`（本机 WSL 映射为 `/mnt/c/workspace/videoworkline`）下创建唯一临时 fixture，复制仓库根目录 `fixtures/d1-30s`，不修改 canonical fixture；`tests/fixtures` 不是该工程 fixture。
3. 使用 `d421-browser-fixture-host.ts` 启动 4174 或动态端口。
4. 启动无头 Chrome 和 CDP；使用复制后工程内的真实 `assets/generated/visual-alt-10s.mp4`。
5. 运行浏览器证据脚本，要求 201、@1→@2、journal committed、revision=2、attention=0、Author facts 精确不变、库存重读、无路径泄漏、无横向溢出。
6. 验证截图与 JSON 的 SHA；失败产物保留为 attempt，不覆盖最终成功证据。
7. 关闭 Chrome/Host，把临时目录移入回收站。

## 5. 已完成的真正 200% 页面缩放

门禁已经用隔离 profile 的 Headless Chrome 原生 `partition.default_zoom_level.x` 完成：factor 2、DPR 1→2、相同外层窗口、无可见窗口/声音/焦点抢占。CDP 只用于观测和文件注入，不用于伪造 page scale。

后续只有在外审指出证据缺陷时才复跑；仍不得启动 headed Chrome 或桌面键鼠自动化绕过用户约束。

不得接受：`--force-device-scale-factor=2`、仅把 viewport 缩半、CDP `Emulation.setPageScaleFactor`、截图放大或 CSS 临时注入。它们可做补充重排探针，但不能命名为“真实 Chrome 200% page zoom”。

200% 门限：核心表单、状态、库存和操作仍可见；无横向溢出/文本截断/控件覆盖；键盘路径可完成；axe 无 critical/serious violation，所有 incomplete 有独立裁决。

## 6. D4.2.1 最终收口

- 已更新 evidence manifest、核心状态文档和 D4.2.1 专项计划，并新增最终内部实现审计。
- 现在启动新的 Claude Code CLI 只读总审计；0 critical/major/must-fix 且 `ALLOW_IMPLEMENTATION_OR_CLOSE=YES` 才允许关闭。
- 把外审原文落盘并校验 SHA；如有问题先闭环并重审。
- 外审通过后把状态从 pending 改为 passed，提交文档/证据并推送 `origin main`。

## 7. 退出判定

D4.2.1 通过只表示用户能安全登记并查看本地资产；P0-08 仍是 partial，D4.2 仍未通过。下一动作只能是 D4.2.2 文档开发。
