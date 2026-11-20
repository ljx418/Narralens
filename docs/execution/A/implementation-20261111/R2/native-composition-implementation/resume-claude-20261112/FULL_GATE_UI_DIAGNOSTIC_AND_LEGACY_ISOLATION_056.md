# 056 完整门禁真实失败后的精确诊断与测试隔离

055完整check实际exit1，tsc通过、188files/2593tests：2591PASS/1FAIL/1SKIP。失败owned-project-entry.test.ts:31，Python golden与两个vite均NOT_RUN。MAIN核实rawlog SHA 6c1f873507550cc9ce834d4d5e3a35cba7b947432c0413ff3fed46eb3b9aabc4及626当前inputs，35原guard恢复。Expected85与LF03/PF03反事实已独立核实，不能因为full红把它们抹掉，也不能把full红说成绿。

只允许同名JSON三个测试文件，禁止生产/前端源码/公共合同/配置/固定上游改动。候选原35guard加这3条共38条，所有其它文件固定。

## UI：先取真实状态，不把一个布尔合取当根因

owned-project-entry第30行waitFor仅判.workspace-shell和panelready，第31行合并判hash和.tl-scroll。先记录两个条件分别值、当前URL（脱敏）、实际DOM加载状态、frame结构、console异常及相关网络失败、原生入口请求/响应状态与时间顺序；失败前后截图/诊断写新只读证据，不能只等assert后才截图。先据真实运行区分hash错误、nativeDOM异步未就绪、选择器变更或原生页面报错，不能未经验证归为“环境噪声/ENOMEM/仅race”。

若证实只是panelready早于原生timeline，应把已有同一个waitFor的就绪表达式覆盖真正原生.tl-scroll与hash，不额外延长30s预算，不sleep掩盖，不删掉最后原生断言，保留chooser/刷新/打开原生/无legacy访问/无异常/无commit变动/无NativeAck的全部规格。若实际DOM/layout或hash规格偏移，不能改期望接受错误产品；报告生产路径及精确必要改动给MAIN，当前不改app或server。只在此test内闭环已证明的就绪/诊断问题。

## 其余旧render测试：精确隔离交互前置

adoption-route.test.ts和history-media-and-failure.test.ts各自render helper仍直接execFile固定CLIrender，缺私有OPENFILM_HOME/NO_UPDATE_CHECK与headless存在标记。原CLI缺.film/opened会交互open+detachedStudio已证实；本轮修这两个自有test harness，不改历史功能或生产migrator/合同，不复制500行新框架。

每个case自有temp项目范围内预置CLI支持的Headless .film/opened存在标记，明确不是UX人验；child OPENFILM_HOME/OPENFILM_LIBRARY绑定自有temp目录，NO_UPDATE_CHECK=1，HOME不碰。保持原600000ms/8MiB预算、真实编辑/恢复/clip结构/实际ffprobe900frame等原断言，不弱化adoption/rollback/restore错误门。新runtime必须自己拥有并结算；正常无需Studio，若有不明残留则failclosed不全局kill、不依赖MAIN事后SIGTERM代签。只对本test确切私有根操作，不把共享vendor/用户状态改成测试数据。

对前次orphan归属只能据实际PID/创建窗口/私有home/启动命令判定，不将代码grep两候选说成已经定位具体PID来源。新isolated门与full结束后验证自己无detachedStudio/媒体后代、共享进程不动。

## 顺序验证

原recorder056-tsc-NNN编译→056-owned-entry-NNN单文件UI真实Chrome。原行为诊断允许红灯，保存根因截图/日志；同test已证明harness问题可在终态/清理后修后新capture验证，不盲重跑、不加预算。再056-legacy-media-NNN跑上述两旧test，允同白名单harness隔离问题闭环，每轮完整bytebackup/hash、运行中inputs冻结、其他guards固定。真实生产缺陷/越界必要文件、新429/工具格式故障/失控清理立即停报。

三个test全部真实绿、候选稳定并清理后冻结所有源码。先补上此前NOT_RUN的三个独立步骤：Python impact golden、vite build、vite.m5 build，经唯一056 capture分别真实读exit/产物；不改build配置/Expected015来过门。三个都绿且hash稳定后，条件再一次corepack pnpm check，capture056-final-check-001。准确argv在JSON。不得跳过全量或从零散绿拼凑整体绿；全量非零/漂移就停，不自动自修/重跑，不以echo0代替实际exit，&&后NOT_RUN据实。

使用新evidence捕获ID不覆盖053/054历史工件，所有失败及不可信工件保留，未触碰的Accepted84/新修复仍需原编号映射。全绿也只是dirty候选门，Git冻结及独立审查随后由MAIN。禁add/commit/reset/stash/checkout/push、改AGENTS/配置/Expected015/pin/运行器/生产文件，不作A中文影片或V1/humanPASS、不进入下一接线。Headless静音loopback单heavy槽，无J盘/下载/付费/外传；新429立即停，不retry/切换供应商/接手。Orca工作区直接videoWorkLine单层平铺，不创建新worktree。
