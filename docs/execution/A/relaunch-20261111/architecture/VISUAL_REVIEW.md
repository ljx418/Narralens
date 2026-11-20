# 架构摘要图视觉核查

输入与输出绑定deliver-receipt.json；最终visual-check的artifact SHA256为b19a0222755d02f8b8455244cff5a034940fa52067fb9b36d2e74e8a48bc346e。

- deterministic validation：9/9 showcase，0 errors / 0 warnings。
- automated browser：passed；1440×900、1600×1000、1920×1080、2048×1320，无横向/纵向溢出；初次默认Chrome未找到后使用本机现有Playwright Chromium，未下载浏览器。
- perceptual visual_review：passed，MAIN实际读取2048×1320 light与1440×900 dark截图，节点/标签可见、无线穿节点、无遮挡；此为图样检查，非独立产品体验验收。
- 产品源码基线与目标状态见source-map.json及02_MAIN_CONTRACT_AND_DECISIONS.md，图中虚线为待接线，不宣称A完成。
