# M5 捕获 `6e9b8ed...`：报告截图路径缺陷

状态：自动命令与逐 case 证据全部通过，但本捕获**不得作为最终人工审查包**。

捕获 `6e9b8ed199dcdeb8c61f9a68022a748bd08944ca` 的 19 个命令均为 exit 0，`overall=0`，Headless
为 15 PASS / 0 FAIL / 0 BLOCKED / UX-12 NOT_RUN，原始截图文件也都存在。捕获结束后的人工可读性核查发现，
生成的 `acceptance-report.html` 把截图地址写成：

```text
captures/captures/6e9b8ed.../screenshots/UX-01.png
```

正确地址应只有一个 `captures/`。因此命令 PASS 只证明报告工具成功退出，不证明报告内截图能被浏览器加载。
这是证据呈现缺陷，不是环境问题，也不得用原始截图存在来代替修复。

处置：保留本捕获及其 manifest/integrity 原文；修复 `tools/m5-acceptance-report.mjs`，增加从 HTML `src`
反解到实际文件的回归测试，并在新冻结提交重新执行完整 M5 捕获。新捕获 overall=0 且报告图片地址全部可解析前，
不得声明最终 `M5_HEADLESS_EVIDENCED`。
