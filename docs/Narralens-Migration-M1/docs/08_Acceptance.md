# 验收、故障矩阵与审计证据计划

## 1. 验收判定

`NOT_RUN → IMPLEMENTED → INTERNAL_EVIDENCED → REVIEW_PENDING → PASSED`，或`FAILED/BLOCKED_INPUT/BLOCKED_ENV`。新包所有业务case起始NOT_RUN。阶段PASS要求所有该门case、适用回归和本地冻结矩阵都有直接证据；测试文件数/测试总数只作辅助统计。

M1A的IM编号是本包补证据索引，不替换旧冻结测试编号。M0须建立old_case_id→IM-id→test_name→evidence；旧矩阵若有额外项也必须补齐。对每个参数组合分别执行并记录，不把一条happy-path当“所有multipart都覆盖”。限额/具体错误码从冻结规范读取，本包不猜文件大小、metadata大小或超时值。

独立外审对象必须是冻结commit及该commit生成的证据。修复后旧审查不能自动覆盖新commit。外审结论只接受真正运行的独立审阅，禁止实现会话自签。Headless不能关闭“人工可用性/真实200%桌面体验”等门。

## 2. 各层证据

契约测试证明结构和拒绝语义；HTTP集成测试证明实际路由/认证/队列；真实文件证明媒体验证；真实render证明画音输出；headed浏览器证明真实UI交互；人类试用证明用户目标。各自有作用，不能互相代替。

每条记录至少：case id、本地冻结ID、代码SHA、适配器/上游SHA、环境、fixture manifest hash、真实命令、exit code、日志、输出路径与SHA256、预计不变量与实测结果、reviewer/时间/状态。frame截图不是视频输出的替代；光有MP4也不是可编辑性的替代。

## 3. 决定性验收场景

**IMPORT/EDIT真实竞争：** 用barrier暂停实际import commit与D4.0 edit，两个HTTP请求争用同一项目；验证两种先后顺序、可串行化结果和manifest/source不混写。不能只测通用queue类。

**原生绕过攻击：** 直接调用旧native edit/history/provider/CLI路径、在UI锁定后操作native Inspector/trim/undo；必须经Coordinator或明确拒绝。截图里按钮禁用不能代替HTTP安全测试。

**三镜采用：** fixture中 `[1932,2100)` 拆56+56+56，前132帧/旁白/相邻镜不变；native timeline有3片段可再改，不用flattened片段充数。

**崩溃：** 在prepare、stage、validate、prepared、commit-record、outbox边界终止进程；重启前不接受写入；验证exactly-once revision或attention。晚到job不得采用。

**发布：** QC机器扫描与内容/事实人工审阅分开。黑帧等检测阈值按固定输出profile和已知错误fixture校准，不能宣称扫描器自动证明事实准确/版权有效。

## 4. 计划用例矩阵（以下全部未执行）

| Case | Gate | 场景 | 直接判定 | 证据 |
|---|---|---|---|---|
| IM-01 | M1A | metadata→file | 真实multipart依冻结字段成功；登记后source/revision不变 | http+media |
| IM-02 | M1A | file→metadata | 逆序与正序相同；流式过程不预信任缺失元数据 | http+media |
| IM-03 | M1A | 重复metadata相同/不同 | 两种值各测；按冻结合同拒绝且无半资产 | http |
| IM-04 | M1A | 重复file part | 同名和不同名各测；不得只取最后一个 | http |
| IM-05 | M1A | 多文件 | 请求含多个文件拒绝；每个暂存均清理 | http |
| IM-06 | M1A | 缺metadata/缺file | 两个缺项分别拒绝，状态不变 | http |
| IM-07 | M1A | metadata大小边界 | limit-1/limit/limit+1实际HTTP；limit读取冻结规格 | http |
| IM-08 | M1A | 非multipart/缺boundary/坏boundary | 类型和解析错误分别断言 | http |
| IM-09 | M1A | 未知part/坏JSON/重复关键字段 | 按旧冻结规范明确拒绝或允许，不能默认吞掉 | http |
| IM-10 | M1A | 文件大小/中断流 | 阈值边界与客户端中断；受限内存，无泄漏/半commit | http+recovery |
| IM-11 | M1A | 无视频流 | 真实音频-only文件不得按MP4视频登记 | real_media |
| IM-12 | M1A | 多个视频流 | 真实或可复现mux文件按冻结策略拒绝 | real_media |
| IM-13 | M1A | 零帧/损坏容器 | 可控探测fixture＋真实坏文件；不能以扩展名放行 | media+unit |
| IM-14 | M1A | ffmpeg缺失 | 依赖注入/隔离PATH；稳定错误码/用户提示 | process |
| IM-15 | M1A | ffprobe缺失 | 独立错误分支，不能伪造探测结果 | process |
| IM-16 | M1A | 媒体工具超时 | 进程及子进程终止/有界清理；退出原因可查 | process |
| IM-17 | M1A | stderr上限/工具非零退出 | 超长输出截断及exit code保留；无内存无限增长 | process |
| IM-18 | M1A | 库存256项 | 真实注册/完整结果顺序和状态；第257按冻结规范 | http |
| IM-19 | M1A | 库存并发上限2 | 实际库存GET流程记录活跃探测，最大不超过2 | integration |
| IM-20 | M1A | 单项探测超时 | 只有该项降级，其余255保持结果；请求可完成 | integration |
| IM-21 | M1A | 重复GET重新验证 | 两次GET间修改/移走文件，第二次反映变化非过期缓存 | integration |
| IM-22 | M1A | import与edit同项目并发 | 使用真实两条服务/HTTP入口和barrier；serializable，只一套ProjectActor | http+recovery |
| IM-23 | M1A | import commit故障恢复 | 在manifest与文件安装边界注入crash，恢复不丢旧清单 | recovery |
| IM-24 | M1A | materialize/adopt路由关闭 | 直接HTTP全部旧目标路由404；不得返回模拟job | http |
| IM-25 | M1A | 虚构adopt operation | 走真实edit端点得到冻结422，无工程变化 | http |
| IM-26 | M1A | Origin/token/路径/TOCTOU | 非法Origin/token、恶意filename、替换文件和许可状态边界；旧安全行为不降级 | security |
| OF-01 | M1B | 原生30秒首导出 | 中文独立旁白/字幕/3镜可编辑工程；ffprobe/frame样本 | real_render |
| OF-02 | M1B | 重开与修改再导出 | 关闭服务/浏览器再开；fit/media原生改一镜，source和画面同步 | real_render+headed |
| OF-03 | M1B | 原生写入口探测 | 记录所有UI/API/CLI/history/provider入口；原生指令可截获/禁用 | source+http |
| OF-04 | M1B | 旧base行为实证 | 在临时副本复現rebased；叙镜网关拒绝过期采用 | http |
| OF-05 | M1B | native scene可编辑 | 修改真实DOM文字/位置并再导出；不是一条烘焙MP4 | real_render |
| OF-06 | M1B | 版本和运行环境 | 完整上游sha/lock/license/ffmpeg/browser/字体；可复现命令 | inventory |
| EN-01 | M2 | 双适配单引擎 | 同一project不能双写；legacy功能合同保留 | integration |
| EN-02 | M2 | 原生绕过覆盖 | timeline/inspector/subtitle/history/asset/provider/CLI逐入口translated或blocked | http+headed |
| EN-03 | M2 | 受限转换 | 三镜fixture loss report零未说明；旧工程hash不变 | migration |
| EN-04 | M2 | 意外外部源修改 | scenes/字幕/资产也改变digest；进入attention不是自动同步 | security |
| EN-05 | M2 | 回退演练 | 旧应用+旧项目真正重开导出，新分支结果保留 | real_render |
| EN-06 | M2 | 资源隔离 | scene网络/任意文件/秘密不可读；数据与UI/Host执行域隔离 | security |
| TM-01 | M2 | 帧往返 | 时间UI→engine seconds→整数帧，在起始/末尾/跨章点一致 | integration |
| TM-02 | M2 | 区间能力 | 选择半开合法，零长/越界拒绝；unsupported跨镜编辑422不假改 | http |
| TM-03 | M2 | 素材长度/变速 | 短asset不隐式循环/变速；显式速度才影响source span | integration |
| JB-01 | M2 | Job持久与重启 | 重启保留真实状态，running无lease不假succeeded | recovery |
| JB-02 | M2 | 双worker lease | 只有一个CAS owner；重复callback不重发commit | concurrency |
| JB-03 | M2 | SSE断线 | cursor去重/补发，render/proposal事件不执行编辑副作用 | integration |
| JB-04 | M2 | 取消后晚到 | cancelled仍终态或quarantine；无source/revision变化 | recovery |
| JB-05 | M2 | 费用不确定 | 外部超时记录unknown，不自动重发付费调用 | integration |
| JB-06 | M2 | outbox提交后崩溃 | commit一次；event续发不重采用 | recovery |
| PR-01 | M3 | 沿用D4.1 | 真实Claude Runner返回3–6个结构提案，所有base/费用/模型审计完整 | real_provider |
| PR-02 | M3 | 预览只读 | 开关比较、选候选、试听无source/revision变动，无新增收费 | integration |
| PR-03 | M3 | VibeMovie适配约束 | 引用未知asset/完整新timeline/锁定范围变更均拒绝 | contract |
| MT-01 | M3 | 绑定资产 | 真实asset内容/source入出点/fps/rights，源长度不足拒绝 | real_media |
| MT-02 | M3 | 三候选代理 | 至少3个真实proxy可解码；最终native segments独立存在 | real_media |
| MT-03 | M3 | derived lineage | hash、父资源、变换、工具版本、范围、审批链可追溯 | contract |
| MT-04 | M3 | 只读素材化 | source digest/revision前后完全相同；标ready_for_adoption | integration |
| MT-05 | M3 | 取消重启陈旧 | 改变binding/base/control时结果过期；重启不写主工程 | recovery |
| MT-06 | M3 | 帧边界 | split前后、first/last frame抽样；clip时长和目标范围一致 | real_render |
| TX-01 | M4 | 缺impact | 真实adopt HTTP无impact 428，工程不变 | http |
| TX-02 | M4 | impact篡改/过期 | hash/范围/asset/expiry/control不匹配拒绝 | http |
| TX-03 | M4 | visual/narration锁 | 原生和导演/CLI路径都阻止相关写，未锁项可操作 | http+headed |
| TX-04 | M4 | duration与共享消费者 | 共享block任一受影响锁保护；长度不意外变更 | integration |
| TX-05 | M4 | 过期source/base | 409，不接受native rebased作为采用成功 | http |
| TX-06 | M4 | 并发采用 | 同base两个请求只有一个commit；另一个409；相邻不变 | concurrency |
| TX-07 | M4 | 幂等 | 同key同payload只+1并返同结果，同key异payload409 | http |
| TX-08 | M4 | 逐journal故障 | prepare/stage/validate/prepared/committed/outbox边界逐一注入恢复 | recovery |
| TX-09 | M4 | 用户历史/撤回 | 恢复内容为新revision；锁仍生效；不删费用记录 | headed+integration |
| TX-10 | M4 | native undo/redo | 原生按钮走Coordinator，不能直接改文件/git回退 | headed+http |
| TX-11 | M4 | 真实两次导出 | 至少一条新工程改变后重开再导出；旁白/字幕保持 | real_render |
| TX-12 | M4 | 多文件原子可见 | 读取固定snapshot；没有混合revision依赖；attention阻写 | concurrency |
| TX-13 | M4 | 锁与外部变更竞争 | lock控制更新和adopt共队列，commit前再核对授权/摘要 | concurrency |
| TX-14 | M4 | 三镜仍可独立精修 | 采用三镜方案后native UI可独立裁每段，不仅播放composite | headed+real_render |
| UX-01 | M5 | 任务导入 | 真实CreativeTask/聊天文本校验、错误定位、保留原话 | headed |
| UX-02 | M5 | 新项目重开 | 创建不是套三镜fixture，关闭后任务/章节/素材绑定仍在 | headed |
| UX-03 | M5 | 章节镜头地图 | 真实6章/120镜导航；stable IDs，顺序改变不误配 | headed |
| UX-04 | M5 | 语义到镜头 | 点击句子定位所有对应clip，返回上次选区 | headed |
| UX-05 | M5 | 共享clock/selection | 地图/时间码/native Timeline/Player双向一致，逐帧无跳镜 | headed |
| UX-06 | M5 | 尺度连续 | 全片→章→镜→细节；平移不重排，空间分支不增片长 | headed |
| UX-07 | M5 | 三路自动预览 | 真实video frame计数增长；max3 decoder；暂停/离屏/autoplay失败路径 | browser_media |
| UX-08 | M5 | 六类选择 | 画面/解说/音乐/音效/台词/过场独立；不改其他类别 | integration+headed |
| UX-09 | M5 | 一击采用/跳过 | 低风险仍取impact并服务端校验，成功才推进；失败保留上下文 | headed |
| UX-10 | M5 | 导向原生精剪 | 同页切模式不重新载项目/失选区；native变更地图刷新 | headed |
| UX-11 | M5 | 可访问 | 键盘/焦点/文字状态/原生200%/reduce-motion；无关卡强制阻塞 | headed+axe |
| UX-12 | M5 | 用户实用 | 零号用户一分钟定位/三路比较，十秒找到撤回；独立填写体验记录 | human |
| PF-01 | M5 | 120镜性能 | 900秒/6章/120镜，每类100次；event→paint p95≤100ms，原始样本 | performance |
| PF-02 | M5 | 真实proxy负载 | 3路720p/规格固定，首帧/内存/丢帧记录；不推断4K表现 | performance |
| PF-03 | M5 | 冷/热重开 | 分别测量、捕捉长期内存增长和任务抢占；无隐藏崩溃 | performance |
| DL-01 | M6 | 真实章节 | 3–5min/20+镜与10–15min母项目关联，3真实位置比较→准备→采用→导出 | real_render+human |
| DL-02 | M6 | 标题候选 | 实际8标题，基于正文事实；人工选择，不以占位符通过 | real_provider+human |
| DL-03 | M6 | 封面候选 | 4方向并有可观看实际候选，来源/合成标识/许可和正文一致 | real_provider+human |
| DL-04 | M6 | 发布检查 | 缺素材/字幕越界/音量/黑帧/未知许可/未决事实各独立fixture | integration+human |
| DL-05 | M6 | 后期与交付 | 声音/字幕/基本画面/过场效果在输出体现；问题可回镜头；同revision发布包 | real_render |
| DL-06 | M6 | P0终审 | 13P0/6NFR evidence无遗漏；中文HTML验收报告；独立审计和用户签署 | independent+human |
| P1-01 | M7D | StyleProfile | 全片风格版本/override/锁保护与恢复 | integration+human |
| P1-02 | M7D | TTS/ASR对齐 | 真实服务生成/识别中文，文本变化使消费者stale并可局部更新 | real_provider |
| P1-03 | M7D | 远端来源/预算 | 至少一种许可检索和一种生成真实回执，外传/费用限额/unknown处理 | real_provider |
| P1-04 | M7D | 反馈锚点 | 评论绑定revision/shot/range，重剪迁移或orphan显式；不自动改生产模板 | integration |
| P1-05 | M7D | 完整长片 | 10–15min真实影片含全部P1；双导出/重开/恢复/风格/声音/内容评审 | real_render+human |
| P1-06 | M7D | 完整V1终审 | P0和P1独立清单全关闭，真实运行与成本记录，不含自动发布/P2 | independent+human |

## 5. 输出画面与性能的测量边界

源媒体hash必须保持；导出MP4的二进制hash不要求前后相同。对视觉改动前后，采用同引擎固定环境比较不变区解码帧、source span和音频内容；保存完整样本位置/容差。同步要求在30fps夹具中边界、字幕事件和声音内容不超1个输出帧；严格原声保留还要对引用的原文件及裁切参数比对。平台预览seek真实解码延迟和播放器逻辑帧要分别记录。

PF-01的p95是本地控制交互，不是AI响应或渲染；每种操作单独计数，不能挑最快的混合样本冲淡慢项。真实项目、120镜性能夹具和三个短fixture分别验，不可互相替代。

## 6. Gate报告与范围口径

每阶段产出中文HTML验收报告，嵌入摘要、case列表、失败说明、截图、视频相对链接和commit/环境。`tools/validate_evidence.py`只检查证据清单是否完整和hash一致，不判断图像质量、事实或reviewer真独立；人工审查仍需保留。

M6只能声明`Gate V1-P0 ACCEPTED`；M7D才能在全部P0/P1证据关闭后声明`V1-Full ACCEPTED`。分母包含所有需求，不把未做P1移出统计后宣称完成。

## 边界补充：合同黄金向量和跨版本导出

TX-02同时覆盖摘要黄金向量：不同键序输入归一后相同hash，改变source依赖内容或scope产生不同hash；不存在字段不得被默认补成可信。TX-09覆盖恢复不改当前锁/许可；TX-12覆盖导出开始后新revision提交，旧导出仍只属于旧snapshot。EN-01包含合并候选commit复验，不能仅引用分支各自的通过记录。
