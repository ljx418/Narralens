# PF01–PF03 收口设计约束（待实施释放）

状态：DESIGN_PENDING_SOURCE_RELEASE。当前 036 全量命令仍在运行，所有源码输入继续冻结。本文件只用于唯一 Claude writer 的只读实施方案准备，绝不授权写码、运行或重试。

依据：independent-pre-freeze-review-021/REVIEW.md 和 MATRIX.json。0 BLOCKER／3 MAJOR 为独立静态预审结论，未执行反例，最终冻结外审仍待实际 commit。旧失败与当前失败全部保留。

## PF01：真实页面服务必须与被签发的根同源

- 保留 Host、既有受控 folderFiles/pageFrames、原项目和单引擎；不新建应用、不改 EnginePort 七方法、pin、015 构建产物或公共 DTO。
- 不能以调用者提交的任意 base 字符串证明页面来自被签发工作副本。生产者品牌只能证明执行了固定代码，不能证明 HTTP 回答来自那个根。
- 推荐扩展现有 Host-private folder serving owner，使其自己创建／持有实际 loopback listener、固定 handler 及 root 身份；模块私有 WeakMap 绑定不可伪造的活 serving capability 与实际 origin、canonical root、精确 dev/ino、listener 代次。由生产路径从该私有记录取得 origin，不信任对象公开字段或客户端 JSON。
- 若保留现有 handler-only 入口，仅作非授权工具；不能让调用者将它挂到任意 server 后自报 origin 来取得可签字 capability。listener 的绑定及 handler 必须由受控 owner 实际拥有。
- 原生缓存生产接口使用真实 serving capability。未知／复制／伪装／已关闭／重开的旧 capability、另一 root 的真实 owner，必须在 producer 运行前被拒；拒绝不得产生页面请求或派生缓存写入。即使两个根文件相对名相同也不能互换。
- 源／输出最终复验和资源结算后、见证激活前再次核对 serving owner 及根仍为同一分配。关闭停止新受理，已受理绘制和实际 raw probe 必须正常结算；不能为通过测试全局杀进程或把 aborted 当结算。
- 至少一条真实异目录 origin 反例：另一个自有根中有可运行但内容不同的影片，由真实受控 serving owner 提供；本根 lease 加外根 owner 必须在绘制前被拒，记录请求和副作用。保留本根真实 pageframe／poster 成功以及 peer close 行为。

## PF02：film-duration 依附真实生产见证

- 该文件不是独立时长权威。匹配 film mtime/size 且数值 finite 仅是形状校验，不能证明其由固定 producer 产生。
- 固定 pageFrames 真实生成 film-duration 时，POST 闭包必须保留它的完整输出身份及原始内容；PRE／POST／最终复验及结算后激活规则同其他受控输出。未见证、同字节新 inode、改后恢复、数字伪造、来源不同的文件必须拒绝。
- 使用现有 service-owned 见证账本查询真实 active 输出归属，不引入第二套可自签权威或任意文件补签接口。可以增加同账本按输出查找，来源仍是那一次实际 guarded production。
- 避免把每个旧 frame 见证永久捆在当时的全局 duration inode 上：后续合法绘制更新同一 duration 输出时，当前 metadata 应由最新匹配的 active 输出见证证明；原来的 frame 三件套只验证其各自实际输出与依赖。不能因合法第二次绘制使全部旧 frame 永久不可消费，也不能给陈旧 metadata 自动再授权。
- 补独立无 producer 伪造 duration 反例和真实产出稳定消费正例，及两个不同合法 frame 连续生成后的消费验证。原有未知缓存拒绝、海报配对、全身份、未完成清理不得交付的规则全部保留。

## PF03：PRE／POST 多清理错误合并必须实际触达

- 保留现有失败 producer＋PRE、成功 producer＋单清理失败用例。新增联合场景不能只引用纯 closure 的多错误测试。
- 真实 producer 成功后 POST 必须实际打开；可以在 POST acquisition 的已有 Host-private observation seam 对自有工作副本制造确定性内容变化，使真实比较得到 SOURCE_RACED 主因，再对 PRE、POST 的不同具名分配注入独立 release failure（真实 close 后报告故障）。这不是伪造媒体事实，也不需要新增公共 hook。
- 独立记录 allocation id、phase、path；不以 fd 数字作为分配身份，不手动销毁 owner 仍持有的 FD，不做裸数字重试。
- 断言预定主因确实触达且未被覆盖；每个独立 genuine Error 对象恰一次保留；PRE／POST 均有实际分配和释放命中；所有受理资源都尝试结算；失败后任何见证不可见、服务粘滞拒绝后续生产。若静态控制流使某种组合不可达，要说明真实可达组合，不能在永不触达的 hook 上签通过。
- 如果新联合测试暴露实际合并丢失，再按 MAIN 审核的最小实现修补并复验，不能改变预期去适应错误实现。

## 实施前交付与停止点

唯一 Claude writer 先只读给出：三个 finding 的可达调用链、拟代码实体／私有接口、精确写路径、旧接口调用方、每条负向命中与真实正向证据、原 17 项映射、资源归属／关闭策略、回退和受影响门禁。说明上述约束与自己最小实现的差异。

当前所有 code/test/config/index 仍冻结，036 命令与其自有资源终态和清理确认前不放行修改。收到新 source release 后才能实施；完成后录独立编译、实际字节和新的精确 runtime 授权。独立预审不是最终 PASS，最终仍须绑定冻结 commit 复核。

遗留迁移夹具缺失与17字节非视频声明风险另列，不归咎于 PF01–03，也不能绕过全量门禁。新429立即停工保全，不自动重试、切换或接手。
