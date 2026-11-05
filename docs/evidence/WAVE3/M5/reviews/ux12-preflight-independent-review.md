# UX-12 前置阶段独立复审

候选：`2e8bbad59595a5dd4b82c2ccea0fe747d8236975`  
正式捕获：`4b2e168c3d3024e5e96832e00bcbd2d8610dd3fe`  
日期：2026-11-06  
结论：**PASS，允许进入 UX-12 人工验收；本结论不代签 UX-12。**

| 独立视角 | 结论 | BLOCKER | MAJOR | MINOR |
|---|---:|---:|---:|---:|
| 架构与代码一致性 | PASS | 0 | 0 | 2 |
| 原始 PRD、阶段范围与体验 | PASS | 0 | 0 | 0 |
| 测试、截图、manifest 与证据真实性 | PASS | 0 | 0 | 1 |

## 已关闭的重大问题

1. 人工 runbook 与交付报告不再引用已否决的 `2a8337d...` 或 `74dd568...`；当前唯一放行捕获为
   `4b2e168...`，其中 16 个自动 case PASS、0 FAIL、UX-12 NOT_RUN。
2. UX-11 不再以相同 iframe `src` 推断稳定性。CDP 直接记录快捷键窗口前后 Document loader `5→5`、
   WebSocket created `2→2`、closed `0→0`；每个 loaderId、frameId、WebSocket requestId 均已落盘。

## 复验证据

- `overall.txt=0`；19 条捕获命令全部 exit 0。
- 全量 `check`、分阶段门、M5 Headless、Studio seam、生产构建与凭据扫描全部通过。
- `manifest.json`：114 个文件、17 个 case，SHA256 与字节数一致。
- `node tools/m5-evidence-integrity.mjs 4b2e168...`：45 captures / 0 failures。
- Headless Chrome、隔离 profile 与监听端口均已清理。
- Archify showcase：9/9、0 error、0 warning；WSL native visual-check 的 Chrome pipe `ECONNRESET` 保持
  环境失败，Windows Headless 截图仅作为补充，不冒充 canonical PASS。

## 人工验收观察项（非阻塞）

- 固定上游仍可能记录 9 条可选接口 422、一次 aborted fetch 与一次跨 origin `postMessage` warning；
  自动核心路径未受影响。UX-12 应观察页面是否出现可感知错误或功能中断。
- Axe 有两个 moderate 提示，但没有 critical/serious；人工应继续观察焦点、标签与缩放可读性。

## 声明边界

允许声明 `M5_HEADLESS_EVIDENCED` 和启动 UX-12；仍禁止声明 UX-12/M5 人工通过、Gate D4.2、
Gate V1-P0、V1-Full、M6/M7 完成、生产 render/MP4、标题封面或 preflight 已完成。
