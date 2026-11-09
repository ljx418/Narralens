# A06 正式渲染的已提交快照读取权威

基线791fd1dfb8958889c101715a68cc628898ed650c。MAIN唯一writer，BRIDGE只读复核。允许新增src/host/agent-driven/committed-snapshot-authority.ts、CreationApplication最小Host-only装配、对应真实Host/快照集成测试及证据。不扩公开合同/DDL，不注册尚无事实的render/Delivery能力。

必须从同一RevisionStore的committed project_transaction绑定project/snapshot/source/revision=base+1；不从当前active pointer推断历史revision。读取仅使用该snapshot的source与不可变created_source_fact、固定上游真实解析，并复验DB事实。拒绝孤儿、跨项目、目录/源/依赖符号链接逃逸、FIFO与摘要不符。实际渲染服务须消费既有SnapshotReadPort，不另建渲染器。

源/素材角色按不可变事实和digest类别决定，不默认第三方许可；没有许可、字幕/rights附属声明、零帧仍由既有preflight阻断。新工程空draft不是可交付影片。此任务不替代真实Run/Task/lease/fence/Delivery、短片双导出或A整体。

独立预审发现parser阶段FIFO窗口并已在真实固定上游复现main-parser-fifo-before：初始digest成功后，在readProjectFilm调用边界把film换FIFO，旧实现阻塞，20秒signal未被消费。允许MAIN定向修改src/adapters/openfilm/openfilm-upstream.ts与openfilm-engine-adapter.ts：同fd nonblock/no-follow读取film bytes→私有随机目录仅写film→委托原固定上游readProjectFilm→finally清理；不改vendor/解析语法/EnginePort方法。Adapter检查解析文本SHA及字幕SHA仍等于初始digest，字幕同fd安全读取，显式检查取消信号。须回归m2.1/m4a真实投影与固定上游探针，不把私有读取目录当正式stage/提交。

R3真实114项里113通过、1个旧AC-004失败：旧mock返回text='<html>'与实际文件不同，新增SHA门正确返回409而不是该用例要测的解析失败503。允许只修tests/m2.1/engine-port.test.ts与tests/wave2/m4a/openfilm-projection-completeness.test.ts的假text，让mock文档映射仍测试原分支而text来自真实被摘要文件；所有旧期望/负向不删除不放宽。新增“parser返回结构等价但bytes变化仍409”实际生产上游测试保护新门。

历史M2.1探针不适用于当前tip：final捕获里它在原M1B已提交的shot-02 overrides处按旧“问题必须空”断言失败；当前M4A明确要求overrides产出completeness问题，且M4B/C已开放受控写，不能修改旧探针把历史约束调绿。原失败保留。允许新增pinned-snapshot-inspection.test.ts当前版本真实三镜/旁白/字幕探针：在隔离副本先证明原overrides明确不可完整映射，再经真实固定上游mutator显式移除仅该副本override，检查900帧/三个page/一个sound、strict409/no bytes write、取消和UTF8摘要拒绝；原M1B文件原样保留。这不是正式render或真人音频验收。
