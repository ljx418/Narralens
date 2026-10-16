# M1A 内部实现审计 R4

日期：2026-10-17

冻结实现提交：`c0f101b964f9cfe492095440eba1bb9b0edad42d`

结论：`INTERNAL_PASS / EXTERNAL_R4_PENDING / M1A_NOT_YET_CLOSED`

## 审计结论

R4 针对独立外审 R3 的两个阻断项逐项复核。证据工具现对所有可见 `body *` 检查横向越界以及 hidden/clip/auto/scroll 造成的内部裁切，并记录具体元素矩形、client/scroll 尺寸与 overflow。原生 200% 仍由隔离 Chrome profile 的 `partition.default_zoom_level.x` 配置；截图捕获扩大到缩放后的完整 surface，再按 1/2 输出，因此没有改变被测页面或缩放条件。

- 360×800、768×1024、1440×900、1920×1200：全部 PASS，`clipped_controls=[]`，axe violations=0。
- native 200%：DPR 1→2、outer 1920×1200 不变，`clipped_controls=[]`；最终 PNG 为 952×3635，目视包含从页头到资产库存末尾的完整页面。
- `corepack pnpm check`：17 files、134/134、0 skipped；TypeScript 与 production build PASS。
- `corepack pnpm evidence:d421-large`：64 MiB 真实 MP4、1024 次 drain、RSS delta 37,556,224 < 50,331,648；32 MiB cap=413；staging=0。

R6/R7 两次门禁失败均保留：前者为 423 个遗留 `/tmp/narralens-*` 夹具（约 14 GiB）触发 ENOMEM；后者为同机资源压力下 I/O 密集的 closed-route 测试超过默认 5 秒。清理本项目测试临时目录并把该证据项的显式上限设为 30 秒后，单项复跑 4.176 秒通过；完整 R8/R9 中该项分别为 4.685/4.068 秒，且两轮全量均通过。没有降低业务阈值、跳过测试或修改生产行为。

## 声明边界

- 自动化交互：Headless、静音、隔离 profile；PASS。
- headed 自动化：`NOT_RUN`。
- 人类体验：`NOT_RUN`。
- 旧 Gate、R1/R2/R3 外审结论均保留；R4 不自签外审。
- M1B 的技术 spike 位于隔离 worktree；本审计不声称 OpenFilm 已进入生产路径。

M1A 只有在新的独立 Claude Code 会话绑定冻结实现及其证据提交并返回 `ALLOW_M1A_CLOSE=YES` 后才能关闭。
