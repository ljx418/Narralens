# 下一接线阶段：N3/N4与Host恢复组合草案

状态：DRAFT_PENDING_N1N2_ACCEPTANCE。不是实施release，所有新增业务验收NOT_RUN。accepted_native_commit=null；N1/N2已有真实冻结候选1d348d419120f23f45d958112ea8c43df5a04675，独立审查进行中且已提出候选MAJOR，尚不可接受。不能用历史基线或绿色总计代替独立结论。

目标：在现有Host、原数据库和原Studio内，把已验reader/Expected、持久selection、mapper、四hydration、Ack/Context、实际change/review生产服务与恢复/关闭接成一条真实链。保留顶部工作流Bar、非模态系统面板和原剪辑区，不新增第二应用/聊天页/timeline。

本目录为下一阶段待核定方案。01锁定合同与代码归属；02按依赖交付并保留原验收编号；03是待最终重锚的Claude提示词；04给出拟路径/私有端口/真实生产链；05给出生命周期/受控GET/回退；06是收据schema提案；07记录候选真实接口和下一阶段消费差异；manifest记录输入文档摘要与未解决条件。任何“新增/拟”实体不是既有API；实际方法签名必须在014验收后重新逐项核对。

权威输入：R2/shared-selection-authority-design/CONTRACT.md及ACCEPTANCE_AND_RELEASE.json；R2/native-source-composition-design三份设计与验收文档；R2/host-recovery-composition-review/ACCEPTANCE_CASES.md与RELEASE_RECOMMENDATION.json。上述R2路径相对docs/execution/A/implementation-20261111。

开工前必须：原R01–R07全部可证；014手回写权；真实冻结commit独立审查通过；将这里所有N1/N2接口与生命周期重锚该commit；保留用户AGENTS/dirty/index；确认本阶段精确路径与单writer；冻结S01 DDL/迁移收据；真实生产handler前置、资源slot、回退与停止点闭环。未满足任一条件，本草案仍非开工许可。

下一阶段完成也不自动代表A影片或V1通过。两条60–180秒中文有声片、授权素材、首章创作确认、改单镜双导出/T20及大阶段人验仍按原A门独立保留。

修订历史：rev1完整保存在同级next-wiring-draft-history/rev1-before-independent-corrections，独立审查原报告在next-wiring-draft-review，均不覆盖。当前增加receipt payload私有schema提案；最终逐字SQL/迁移指纹与签名仍须独立审定后才能开工。

rev4：保留rev3原件于next-wiring-draft-history/rev3-before-frozen057-api-binding；新增07候选静态接口核对。observed_candidate_commit不是accepted_native_commit，未释放代码实施。

rev6：W3收据表补齐独立外部marker四象限与历史原像丢失规则，字面DDL未变，待独立文档审定；没有提前开放下一阶段。
