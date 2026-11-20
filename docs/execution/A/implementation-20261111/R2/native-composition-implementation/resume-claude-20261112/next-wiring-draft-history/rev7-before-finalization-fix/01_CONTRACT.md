# 接线合同草案：一份权威、一份装配、一条交付链

状态DRAFT_NOT_RELEASED，N1/N2验收commit待定。以下是约束与目标接口，不声称已实现。

## 1. 已有实体与拟新增实体

|层|实际已有实体|本阶段拟做|唯一责任|
|---|---|---|---|
|DB/项目|RevisionStore、ProjectCreationStore、原bootstrap/闭合commit|在原bootstrap事务内初始化S01；九字段commit、cp_a0和旧审批不改|单Claude按MAIN精确公共释放|
|持久selection|尚无S01生产实现|新增created-native-selection-state.ts；一份同DBauthority，两张私有表及独立迁移marker|MAIN冻结DDL/Claude实施|
|源与原生事实|CommittedSnapshotAuthority、CreatedNativeWorkspaceService、Expected；014 reader/pool/witness待验|只消费验收后接口，同一reader预算owner和issuedworkspace，不复制状态|已验模块保护，必要增量另票|
|映射和观察|native-observation.ts、NativeSelectionMappingPort接口、controlled-studio-access.ts（mapper实现拟新增）|真实document/四hydration/selection→mapper→同S01；创建模式无默认0|同一接线writer|
|Ack/Context|native-ack-store.ts、project-context-service.ts|原record事务内私有permit最终核对，Context末端围栏|同DB、同authority实例|
|正常采用|created-source-facts-reader/change-service/adoption-service/publisher及application-dispatcher|真实生产handler装配、review/approval关联，不灌表替代|CreationApplication唯一装配|
|恢复/关闭|现有scheduler/families/CreatedSourceRecovery、owned-runtime、Host|真实startup/reaper排除、已受理扫描排空、最后关原DB|server/CreationApplication单owner|
|缓存生产|014拟native-cache-witness与固定native producer|后续受控GET使用同一生产wrapper/见证，禁止原生写旁路|Host trusted origin/ref，不接受浏览器见证|

当前源检查点：CreationApplication原context构造仍传undefined native port；现有dispatcher未通过该事实证明change.prepare/apply完整装配。此为待接线内容，不是新增第二套业务。

## 2. S01存储、两张脸与bootstrap

完整冻结DDL/迁移算法以原S01 CONTRACT为准，当前DDL SHA256为6c9804ca36e226cb28674eff742c1eb433f6c650fe7148bacb603a902f8ab896。只在原RevisionStore连接安装，复用原schema_migration表，仅写created_native_selection_v1这一marker；不改其DDL/其他行、不新DB/user_version。namespace与独立marker四象限严格校验，不自动补账本、DROP、REPLACE或猜0。

新项目epoch0只能在原verified bootstrap同一事务内：origin已建立之后、后续proof/lease/confirmation最终检查之前，由原store创建的一次性opaque active-scope许可触发；失败全部回滚。已提交bootstrap重放只返回旧receipt，绝不补缺账本。旧项目缺账本/损坏需要明确对账与保全，不能假称恢复成功。

Epoch读面与业务currentSelectionVersion读面来自同一行/同一实例。有效epoch且无mapping、无pending可读，但不代表loaded；accepted mapping pending时业务面拒绝/可重试延期，epoch面仍可用于证明新mapping，避免死锁。缺失/损坏/关闭/I/O不是0。新session/mapping变化/invalidate按CAS推进，cas token每次更新都变，旧异步回调和同数值ABA不被接纳。

## 3. 原文档冲突的明确裁决

历史HC08写“genuine no-session返回0”已由较新S01合同细化：created模式无session返回真实持久epoch（可能非零），不凭无session置0；有效且无pending时仍可正常恢复/采用。S01-M/B/E等原编号保留，HC08/J01按本裁决执行，不抹去旧文档。Hypit/migrated legacy仍保留原模式。

## 4. 事件与最终提交围栏

路径：真实源commit→工作副本issued ref/generation→原native session→document+settings/markers/style/captions真实hydration；selection事件先做认证/sequence/profile检查→同DB acceptMapping持久pending_token与新CAS COMMIT并撤销live loaded→才调用异步真实mapper→finishMapping同步最终CAS→新Expected proof/私有permit→原NativeAckStore.record事务→Context final fence。document/hydration的Expected证明允许在mapping前从epoch读面启动，不要求先有mapped selection，避免bootstrap死锁。

四part未全证、偏好/不支持/失败/旧sequence/旧epoch只能pending/unknown，Ack+0。NativeAck持久历史与live loaded分开；permit绑定同DBowner、project/commit/control/snapshot/source、session/profile、workspace/ref/generation、epoch+CAS和proof，必须在原record事务内最后同步检查。不得加cp_a0列、让caller提交callback或伪造rawDB许可。

Context在异步读取完成后再核同一围栏；即使没有新UI事件，文件/negative dependency变化、source identity、owner/control或cleanup不确定也撤销live loaded。job完成、review批准、commit成功、原生已加载分别表示，不相互替代。

## 5. 资源与关闭

Host一个装配owner构造同DBstore/verifier/selection；正常adoption、Publisher、Recovery、Observation、Ack/Context用同一authority，不各自fallback0。014共享FD pool、真实清理状态账本、原始获取promise、probe子进程和cache producer browser按实际owner贯通。stopAdmission不等于立刻销毁受理操作依赖；排空真实原始任务后关native资源，最后关DB/owned runtime。单实例关闭不能杀peer producer；原生后台cache写入必须逐路径纳入受控producer语义，不用cache-hit给未知输出补签。

## 6. 安全与失败合同

现有auth/Origin/CSRF/owner检查在资源查找前；native_bridge不能直接change；用户不能传root/fd/epoch/pool/witness/force。旧grant/session迟到结果不得再可用。保留原错误与所有cleanup原因，不能把普通瞬时EIO误判为永久清理不确定；实际不确定不得转成成功。

无法证明新账本、历史资源所有权或原始授权时保全具体事务/目录并有限诊断，健康项目仍可用；不能无限defer后宣称恢复完成，也不能SQL手动terminalize。真正不可判的人类高风险选择另列，不以设计掩盖。

详细的拟新增/现有端口、精确路径和真实生产链见04；启动/关闭/受控GET与回退见05。均为PROPOSED，不是当前源码既有接口。

rev6补充：W3收据publication安装采用06中的同库双marker，新增权限仅为schema_migration的created_review_publication_v1一行；S01行、旧job-kind行、原表DDL与CP-A0均不动。此为目标草案，未授权当前N1/N2生产修改。
