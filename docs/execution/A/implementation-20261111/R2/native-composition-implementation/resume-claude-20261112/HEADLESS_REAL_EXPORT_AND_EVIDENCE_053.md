# 053 真实导出测试的Headless隔离、生命周期与持久媒体证据

MAIN已核实052四组实际exit0，54/2/91/44PASS，四capture全部626inputs匹配，只有批准LF04测试改变。主体回归绿不掩盖Studio资源与媒体证据缺口。仍无完整Gate/反事实/冻结独立审查PASS。

## 已有源码事实与范围

固定上游bin/openfilm.mjs:205..219在render前检测project/.film/opened缺失则open(project)；studio/client.mjs:150..179 ensureStudio会spawn detached supervisor。这是上游交互CLI既定行为，不能只凭残留进程推断Narralens生产Host.close失败。当前自动化test调用普通CLI没有隔离该交互前置，属于本路径测试生命周期/副作用未闭环。本轮只允许tests/m2.3/migration-real-export.test.ts和该测试自产的新证据目录；不改生产adapter/Host/固定上游/合同或配置。

## 修正路线

保留固定上游CLI render、真实多clip可编辑/重开/改单镜/两次完整导出，不换扁平视频或mockrenderer。先只读确认上游CLI判定与现有离线Headless机制，再在测试**自己拥有的临时工程**中明确抑制交互Studio自启动。可为本测试私有项目创建受测上游支持的.film/opened存在性标记，并明确它仅为Headless harness准备，不是人类已打开/UX通过证据；文件仅在自有temp项目、不能写用户项目或固定fixture/上游。或者使用等价已证实的离线机制，但不能为绕过副作用修改固定上游代码。

每个CLI child用自己独立的OPENFILM_HOME/OPENFILM_LIBRARY临时目录和OPENFILM_NO_UPDATE_CHECK=1，禁止设置/改写HOME或用户配置/凭据，禁止复用真实~/.openfilm；若需要Studio才能真实render，则由test显式拥有和收敛其runtime，不能广域按进程名kill或清共享端口。禁交互浏览器/OS打开器，单测有-headless断言/实际进程证据。

命令前后记录该test所有实际启动PID/进程身份、私有根和端口，按拥有关系确保退出；即使失败也finally结算。不要用全局cmdline匹配或“端口空”单独充当归属证明。已有共享/他项目进程不关。本轮正常路径应不产生detachedStudio，因此新Studio匹配出现即测试失败+按实际身份保全清理，不把测试外手动SIGTERM算作内部清理通过。固定CLI实际子进程要有退出码、失败路径保证已创建进程回收（能用同文件最小case验证harness fail/finally，不mock主渲染链）。

## 输出可复核的真实媒体证据

052只在内存比较hash，afterEach删全部temp，没保存实际十六进制值，不足以交付带SHA256产物。本轮把每个实际export在被覆盖/临时目录移除之前复制到显式授权的W/docs/evidence/N1N2/real-export-053/下唯一名字，不覆盖历史失败/产物；保留至少初次与改单镜后的两个完整MP4。记录JSON：case/阶段、项目与clip IDs、真实framecount、音频采样/时长、actual sha256/bytes、实际render/probe/decode argv与exit、caption/narration与编辑前后事实、上游SHA、候选test/source摘要、实际capture标识。日志打印实际sha，不用占位。证据不是author/expected/commit authority。

目标MP4须完整ffmpeg decode（-nostdin固定参数），ffprobe真实900帧、音频存在/采样/时长事实，源诊断视频音频probe/decode保留；不是只说运行耗时就证明。MIG03两次文件hash不同、帧数相同、中镜真实原生编辑、关后重开、源bytes不变；EN05仍不宣称fresh Hypit付费渲染。诊断媒体不冒充A轮两条60–180秒中文有声作品，也不宣称旧migrator保留源视频画面。

## 连续验证权限

单Claude writer按JSON准确一测试文件实施，完整bytebackup/hash；原recorder053-tsc-NNN编译、053-real-export-NNN跑这个文件，串行且运行中全部输入冻结。允许在此文件内闭环已证明harness/证据问题后新编译和新capture，每个失败保存具体根因，不盲重跑、不放宽断言/预算、不改生产或其它test。若发现生产缺陷/上游限制不可在范围内解、出现新429/工具格式失败/其它guard漂移即停止报告。新429禁止自动重试/切供应商/Codex接手。

最终test绿且内部自有清理证明后，交MAIN实际MP4与manifest、源码diff、原始命令/日志和进程清理证据。无任何其它suite/full/build/mutation授权；后续Expected84回归、两条反事实、全量构建、冻结独立复审由MAIN再释放，不在本轮顺跳。禁git索引/提交/reset/stash/checkout/push，保护AGENTS/Expected015/pin/配置/运行器，Headless静音loopback，无J盘/下载/付费/外传。保持所有工作区直接videoWorkLine同级，不新增workspace套娃。
