# 双击启动 Narralens

桌面双击 **Narralens** 图标，或双击仓库根目录 `Narralens.cmd`。
启动窗口会检查本机依赖、构建导演面板，随后预热本地视频、示例迁移、Host、OpenFilm Studio 与 Gateway，准备好后打开 Chrome。
启动期间保留状态窗口；失败时窗口显示原因并等待确认，不会自动下载依赖。

当前入口为 **M5 隔离体验**：每次新建临时数据库和示例迁移副本。关闭 Chrome 体验窗口后自动清理服务及临时工程。
本次体验里的采用、历史和恢复不会成为下次启动的持久工作；这不是正式生产工作区。
不调用生成服务，不产生模型费用。不需要手动输入命令，不读取移动硬盘。

打开后跟随 [人工体验指南](evidence/WAVE3/M5/ux12-human-acceptance-guide.html)；
提案框中的示例编号为 `comparison_m5_recorded_1`。
正式导出及从想法全自动成片尚未开放。

启动器当前适配本机 `Ubuntu-24.04` / `administrator` WSL 环境；迁移电脑后应重新核对发行版、用户及固定 OpenFilm checkout。
维护者可运行 `tools/windows/Install-Shortcut.ps1` 安装桌面快捷方式，已有同名快捷方式会保留并报告。
只读启动检查可使用 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/windows/Start-Narralens.ps1 -CheckOnly`，不会打开体验浏览器。
