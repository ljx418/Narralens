# 修复004类型检查常设放行

MAIN对本轮内部资源调度的补充。此后无需逐次问MAIN即可在唯一源实现者ctx_e5e736e1846b中串行执行下列确切命令；不是追认此前执行，也不改变源码十路径边界。

工作目录 /mnt/c/workspace/videoworkline/Narralens-agents/main-integration。
唯一允许argv：corepack pnpm exec tsc --noEmit。
必须经现有 docs/execution/A/implementation-20261111/integration/e1-main-takeover/run-recorded.py 使用全新唯一捕获名执行，不改记录器。每次编译前后的全部源输入哈希由记录器记录；执行期间不修改src/tests/tools/config/index，实际终止后才能继续改源码。保留全部exit2等失败，不覆盖捕获、不从日志中滤除诊断。一次只跑一个，不与Host/媒体/测试/构建并发。不得让pnpm安装、下载依赖、访问provider或网络；本地工具不可用则报告而非修配置。

编译仅证明类型检查，不算业务验收。不要求无变化机械重复编译；新增修改或诊断才重跑。最终请求测试批次时汇总全部实际命令、退出码及输入哈希。源码改动仍由唯一Claude负责，MAIN独占索引与提交。新的429立即停止，不能因该放行自动重试或改实现者。

此文件只放行上述编译argv；vitest/Host/ffmpeg/ffprobe/Chromium/build等仍需独立批次资源放行。
