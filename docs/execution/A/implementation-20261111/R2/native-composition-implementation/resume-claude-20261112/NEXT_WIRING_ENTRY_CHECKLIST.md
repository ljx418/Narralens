# 下一接线阶段开工条件（准备清单，尚未放行）

当前目标不变：先由现有 Claude 完成 N1/N2 原范围实现及缺陷闭环，MAIN 完成真实验收与独立复核，再准备接线阶段正式合同与计划。本文件不是实现授权，不把静态设计视为已执行结果。

## 前置门

1. MAIN_CORRECTIVE_RELEASE_004 的 F01–F10 和原 R01–R07 逐条有代码位置、具体断言、实际捕获与结果。组件注入、真实文件系统、真实工具、真实生产链路分别标注。NOT_RUN/UNPROVEN 不得被133项绿色总数覆盖。
2. 现有 Claude 交回唯一写权及资源清理收据；MAIN 核对实际完整 SHA、十路径哈希、保护 AGENTS、索引状态和未纳入用户工作。源码提交只能显式路径，不广泛 add。
3. 建立真实冻结候选 commit，独立审查绑定该 commit；修复后重验相应门，不把此前只读缺口审查声明为外审 PASS。当前十路径只在后续正式释放后才可再改。
4. N1/N2 所有原范围要求真实成立后才能将 S01 合同重锚到验收 commit；当前 e2eff61 设计基线只是历史定位，不能直接当未来接线基线。

## 下一正式计划必须一次明确的交付

- S01：同一原数据库、单实例项目选择权威；持久 epoch 无ABA；区分可读 epoch 与业务 currentSelectionVersion；pending mapping 不被伪装为空映射。schema安装、原bootstrap原子初始化、已提交重放只读、旧项目缺账本拒绝/隔离，均各有验收，不自动补0。
- 组合：将实际 N1/N2 authority/workspace/reader/Expected 的已验签名与关闭语义接入现有 NativeObservation、mapper、NativeAck、Context；只实例化一份权威，不用默认0或新建第二份选择状态。
- bootstrap与迁移：冻结DDL及独立schema_migration收据的四象限审查；与原 ProjectCreationStore 同事务，不改九字段采用提交和cp_a0；故障抛出只证明事务回滚，真实进程终止另列。
- Host生命周期：owned DB/FD9前置；关闭新准入、排空接受任务、原始工具与描述符所有权、最后关闭数据库。当前 recovery 类已通过组件测试，不等于生产 Host 已挂载。
- 恢复：原三类事务统一有界顺序及各自kind/marker所有权，不跳过永久defer、不虚构执行；确认job reaper与原恢复不会双写。未知/损坏历史保留实际状态与阻断原因。
- 原公共链路：prepare/apply/review绑定真实producer与素材事实，实际Studio传输和四种hydration、Ack与Context末端同一选择围栏；UI加载成功、Ack写行、Context可用分别证明。

## 实施和验收顺序

A. MAIN先核对S01提案与最新已验N1/N2源码差异，确认合同/所有权/目录及精确改动表；未解决签名或生命周期冲突不得下发。
B. 在同一个大阶段计划中安排持久选择权威、bootstrap原子接入、消费端围栏、Host恢复与关闭接线，按依赖集成。模块自验不代替大阶段端到端审查；不得把同一实体交给两个并行写者。
C. Claude实施、自验证和缺陷闭环；Codex负责架构裁决、需求覆盖及大阶段独立验收。沿用headless无干扰、记录失败、逐命令哈希与资源清理。新429立即停止，不自行切换实现者。
D. 完成组件到真实Host/Studio的贯通证据、真实进程丢失恢复与原回归后，输出中文可视化验收材料和明确体验步骤。真实授权中文影片、首章及人工创作确认属于后续体验门，不从诊断色块/正弦音推导。

禁止提前声明：N1/N2完全通过、S01已实现、公共Native/Ack/Context已接线、中文影片可用、A阶段完成或V1通过。

## 014统一修复引入的接线关注项（设计输入，待实现及验收后重锚）

本节不表示014已实现或通过，真实方法名/签名/文件哈希以其后冻结提交为准，不把本节中的设计实体当既有API。

- 原N1/N2 reader实例内共享一份显式FD预算对象；authority/source closure与workspace closure及并行proof必须传同一对象。接线不得漏传而退化成两份局部cap，也不得改成进程global或复制used值。
- 私有清理失败身份账本跨closure→authority→reader连续传播；普通EIO的cause不代表清理不确定。上层Host不得把真实不确定转换为成功，或把瞬时读错误一概永久锁死项目；close要等raw child与原始获取promise，而不是只等用户取消promise。
- 页面cache的Host私有真实producer/witness是后续受控GET的实际实现依赖。必须使用同一issued workspace/ref/generation，调用固定native producer，不能让HTTP JSON或磁盘cache自签见证；未知既有key的cache-hit不自动证明来源。实际frame/poster/源文档GET含哪些后台cache写入，需按固定上游调用图逐项核对并纳入唯一路径；若转发绕过wrapper、或只有测试注册witness，不能声明loaded/Ack已接线。
- witness当前内存态属于该workspace实例，重开/新代次失效；不得持久化成第二份source或审批权威。恢复与重新生成preview走实际producer和新proof，而不是回填历史witness。filmPoster的last图片语义不等于当前source新鲜渲染，UI与Context/导出不能混淆。
- producer的共享headless browser按实际Host owner管理。停单实例准入、排空它接受的调用；不能提前closePageFrames杀掉另一个实例在途生产。Host最终关闭顺序需要列出native producer、cache witness、Expected/reader、workspace、recovery、outbox、DB及实际子进程依赖，最后关闭原DB。
- 新private parser副本仅用于已限额保持文本，不是新的author project或timeline。接线不得重新使用原可换位路径进行whole-read解析；遗留render port及已通过行为维持原合同。

这些条目必须纳入下一正式合同的参数传递图、实例唯一性检查、真实Host/Studio组合case与重启/关闭故障case。若014验收改变方案，本节先按实际冻结实现修订，再发下一阶段精确释放；当前不创建任何下一阶段生产任务。
