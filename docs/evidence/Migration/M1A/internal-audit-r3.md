# M1A 内部实现审计 R3

日期：2026-10-16  
冻结实现提交：`8f7007d8df53ff15ac73fc73c70ddafb25ed5e2a`  
结论：`INTERNAL_PASS / EXTERNAL_R3_PENDING / M1A_NOT_YET_CLOSED`

R3 在 R2 已确认的 IM-01..26 与 D421 非 UI 条目基础上，补齐冻结提交的完整 UI 矩阵。768px 首次直接复跑发现来源输入值横向滚动；未降低门限，最小把资产库单列断点从 760px 调整为 800px。随后新 SHA 完整执行：

- `corepack pnpm check`：17 files、134/134、0 skipped，TypeScript 与 production build PASS；最终日志 `pnpm-check-r5.log`。
- 360×900：viewport/document=360/345，clipped=0，axe violations=0。
- 768×1024：viewport/document=768/753，clipped=0，axe violations=0。
- 1440×1100：viewport/document=1440/1425，clipped=0，axe violations=0。
- 1920×1200：viewport/document=1920/1905，clipped=0，axe violations=0。
- native 200%：同一隔离 profile 的 DPR 1→2、outer 1920×1200 不变；viewport/document=960/952，clipped=0，axe violations=0。

五份成功 artifact 都记录完整 `8f7007d...`；失败/超时/裁切尝试全部保留。自动化均 Headless、静音、无窗口；headed 与人类体验 `NOT_RUN`。进程停止后 4174/9244/9245 无监听，临时目录已移入回收站。

M1A 仍须新 Claude Code 会话 R3 给出 `ALLOW_M1A_CLOSE=YES`。M1B 在独立 worktree 已完成技术 spike，但合并/迁移生产代码尚未发生；M2 仍未开工。
