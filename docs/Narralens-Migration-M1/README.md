# Narralens · M1.0 架构迁移实施包

给用户：用浏览器打开 `Narralens-Migration-Control.html`。单文件包含所有规格、架构对照、阶段Ticket、97个计划验收场景及可复制提示词。`html/`含同源独立阅读页面，禁用JavaScript也可读。

给Codex：按 `docs/00_Read_First.md` 与 `CODEX_START_PROMPT.txt` 执行。首轮只到M0/M1A/M1B，旧自动开发保持暂停；M2接管必须双门通过。所有业务case初始NOT_RUN。

文件分工：
- docs/：完整Markdown规格，与HTML同源。
- contracts/：目标JSON Schema，不是仓库已实现API。
- examples/：虚构身份/哈希的格式例子，不是运行产物。
- templates/：阶段/追踪/验收矩阵与待本地填写的版本/路由清单。
- tools/validate_package.py：校验本包格式与引用，不运行项目测试。
- tools/validate_evidence.py：只验证实际提交的本地证据结构/文件hash，不替代独立审阅。
- sources/：用户报告摘要、早期文档副本（非304c891代码）与公开来源。
- qa/：仅本次HTML/文档包检查，不能作为业务Gate证据。

可选文档校验：在隔离Python环境安装 `tools/requirements.txt`，运行 `python tools/validate_package.py`；完整性检查运行 `python tools/verify_checksums.py`。

日期为本次编制2026-10-16，不改变用户报告时点。没有在本包中固定或安装OpenFilm，full SHA留待M1B，不能据网页源码可读声称已联调。所有后续规格合并以本地11_V1_Traceability/冻结规范/真实代码对照为前提。
