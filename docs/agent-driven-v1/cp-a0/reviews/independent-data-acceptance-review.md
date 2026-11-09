# 数据与验收包独立文档复核

状态：PASS_WITH_DOCUMENTATION_NIT；2026-11-09。审查者为合同准备作者，未编写本报告范围内的5个文件；因此本结论是对数据/验收/任务释放包的独立交叉复核，不是对自己合同的独立审查，也不是生产外审或人工验收。

只读检查了上述文件与最新候选schema/registry/wire向量。实际重新执行 sql-check.py 全部40个隔离SQLite案例，PASS，SQLite 3.45.1。复核采用原脚本内存副本，唯一替换是取消写sql-check.json的末尾语句；执行仍创建/删除原脚本自身系统临时fixture，不修改原文件、结果JSON或生产DB。没有启动Host、模型、浏览器、provider或ffmpeg。

## 发现与已闭环项

1. 初读发现 Approval wire有rejected但SQL不允许，SQL另存wire没有的expired。已向MAIN/数据作者报告；复核最新SQL已统一active/consumed/rejected/revoked，过期依expires_at判断。实际新增expired拒绝与rejected终态不可恢复案例通过。此项已闭环。
2. 初读发现seed用purpose=review的确认发放execution_grant，SQL只FK检查ID，未检查确认用途/主体。已报告；最新SQL新增grant confirmation trigger，要求run.authorize、actor=principal、scope摘要一致、期限不扩大。Approval另要求change.approve与input/action摘要。seed拆分不同可信用途记录；实际review/adopt→grant、跨actor/scope和run/review→approval负向通过。此项已闭环。身份/Origin/会话真实性仍需Host实现，SQL不能证明。
3. A最小问答新增Question/QuestionAnswer已映射不可变题/答版本、当前答案head CAS及typed JSON。复核实际wire题答往返、错input、错题/旧intake、skip禁止、content_only、不可变与CAS案例通过。03/04将实际T27交互留NOT_RUN，没有用fixture代签UI。
4. 03的EX-01..23 Markdown表头初读缺GFM分隔行。已通知验收作者，属于展示格式小项，不改变验收含义；若后续作者补行，可直接关闭此nit。

## 范围、信任与真实运行边界

固定模板ID/local-short-film@1、JCS execution_digest、A plan_version=1与wire一致；scope_json持久完整闭包，另有真实wire->SQL映射fixture。run/plan/step状态不移动影片active_commit，旧Coordinate事务保持唯一影片权威。新origin仅created，既有migration按真实绑定读取；没有假迁移。bootstrap幂等预留、复合scope FK、append-only与approved/prepared辅助约束可复现。02明确SQLite不能证明真实Coordinator同事务接线，没有把Pythonfixture冒充Host恢复。

03保留所有EX-01..23及T20-A..H真实导出/故障子case，区分A安全子集与B/C完整关闭范围。现有pnpm命令只核存在未运行；拟新增runner均标未存在/未释放。媒体授权/hash留SELECTION_PENDING，客户端/生产/native/真decode/磁盘满/进程终止留NOT_RUN。未发现把旧30秒fixture当成A真实60–180秒短片或把历史evidence重算冒充本轮通过。

04保留MAIN公共保护路径及producer/注册owner分离；拟新建工程服务归MAIN；lane目录只是存在/历史准备，不声称已同SHA干净或实现Agent启动。所有实现状态NOT_STARTED/NOT_RELEASED，正式ReleaseAssignment需用户授权、完整合同SHA、唯一writer和真实任务/资源/验收。未发现宽前缀放开旧核心、自动push/reset/stash或绕过阶段人工出口。

## 仍需实施后的实证

真实鉴权/CSRF/Origin与trusted session、时间/撤销/主体重验、全部写入口统一门、旧Wave/M5受控副本升级、Node同连接原提交接线、真实journal/publisher崩溃与磁盘满、snapshot cursor与原生ack真实闭环、ffmpeg完整decode/QC和no-replace发布恢复、人验均未执行。文档结论不释放CP、生产或后续B/C。

## 审查输入SHA256

- `02_DATA_AND_RECOVERY.md`: `89e9b89ee7d12522ece6aac8a2b851417c8492db382c76b9e42fab3693bbf4a0`
- `migration.sql`: `2939e6bc69aba0f3b66d20939def301f8d21b04d8ec000b0f752bdc5098bcd3f`
- `sql-check.py`: `b3f21d8c0703a1cb2c423930db625c1c151d7fa3f513c3d5c4ae7984c8751b15`
- `03_EXECUTABLE_ACCEPTANCE.md`: `701fc60ff1c4f86a5126db283893a7c6c074f6ee07eee81cef8aee870e7038d9`
- `04_RELEASE_ASSIGNMENTS.md`: `891e0d08a6044c5293c95b803be70c800f478b987c3e25b45c50f8693cb252a9`
