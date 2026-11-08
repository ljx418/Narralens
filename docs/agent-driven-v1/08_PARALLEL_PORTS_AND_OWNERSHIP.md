# 并行架构：公共端口、代码所有权和集成接缝

状态：执行设计，精确运行时合同待CP-A0冻结；本文定义责任与必需字段，不冒充已经新增API或schema。

## 1. 架构调整的原则

保留单Host/单库/单引擎事实源/唯一Coordinator；多Agent是开发组织方式，不把产品拆成三个重复Host或三条timeline。以构造函数注入的小型typed port隔离模块，先不引入新的微服务框架/DI容器/通用插件市场。

MAIN在`src/host/agent-driven/composition.ts`（拟新增）装配新子系统，再由既有server调用；旧server路由/生命周期仍由MAIN修改。schema、migration、静态注册由MAIN维护，模块不能动态向生产注册任意代码、任意SQL或可写原生路由。

## 2. Producer/Consumer合同清单

| Port/DTO（拟定） | Producer/owner | Consumer | CP-A0或后续冻结必须明确 |
|---|---|---|---|
| HostInstanceDescriptor / ApplicationPort | MAIN，BRIDGE消费 | MCP/UI/launcher | 实例/版本/端点/鉴权/owned-shared归属，不回传凭据 |
| ProjectRead/ProjectBootstrapPort | MAIN | PRODUCT、MEDIA | origin new/migrated、binding、revision/snapshot、项目目录控制、失败补偿 |
| CreativeRepositoryPort | MAIN存储接缝；PRODUCT业务 | PRODUCT | 单连接/DDL/事务、brief/script/artifact/input版本、分页、版本CAS |
| Question/DecisionPort | PRODUCT业务，MAIN可信身份 | BRIDGE/UI | question版本、回答/跳过/默认值、选择与可信人类批准分开 |
| WorkflowRead/RevisionPort | PRODUCT | BRIDGE/UI/MEDIA | DAG版本/环检测、artifact refs、依赖stale/重算、input摘要 |
| JobExecutionPort | MAIN | 全泳道 | prepare/read/cancel、job/child、attempt/lease/fencing、未知结果、幂等 |
| ResourceClaimPort | MAIN | MEDIA、BRIDGE观测 | 全机资源池/归属/容量、等待与取消、跨实例GPU租约，不限死业务调用次数 |
| AssetRead/RegisterPort | MAIN现有资产底座 | PRODUCT/MEDIA | 许可/来源/hash/相对ref、验证/暂存、去重、不可直接发布工程 |
| SnapshotReadPort | MAIN | MEDIA | committed身份/归属/闭包摘要、可访问素材、render输入固定、不可读任意绝对路径 |
| ChangePrepare/ApplyPort | MAIN | PRODUCT/MCP | server impact、approval/base/锁/许可、严格409、幂等与一次revision+1 |
| EventSnapshot/CursorPort | MAIN日志源、BRIDGE投影 | PRODUCT/UI/MCP | 初连无漏窗口、回放/乱序/重复/旧attempt、cursor过期、重同步 |
| Health/Resource/QueuePort | BRIDGE观测、MAIN lifecycle | PRODUCT/MCP | readiness区别、observed_at/TTL/null/unknown、权限/脱敏、受影响节点 |
| ComfyManifest/ExecutionPort | MEDIA | PRODUCT/BRIDGE | 图格式/hash/模型/输出节点/外部job、质量/许可/取消、注册模板参数白名单 |
| Render/QC/DeliveryPort | MEDIA | PRODUCT/MCP | 绑定snapshot、输出artifact与ffprobe/完整decode、QC阻断/附属包、取消/晚到 |

MCP只是应用端口的协议映射，不把每个内部方法都注册为工具；媒体大对象通过受控引用返回。UI沿HTTP/SSE读取相同应用服务，不强制走MCP。

## 3. 合同变更与消费者测试

每份合同具有version、runtime schema、TS、validator注册、错误alias/状态表、序列化/canonical规则与fixture。冻结commit由MAIN发布，worker任务报告引用合同SHA。DTO可添加兼容字段也需消费者证明；改变语义/必填/错误码/DB CHECK走新版本或ADR。

producer在自己的lane跑合同输出验证；consumer跑同一共享fixture的输入验证；MAIN再跑真producer→真consumer和错误路径。fixture只能说明模块按合同开发，不能代替Host装配或真实MCP/渲染。

`ContractChangeRequest`至少列ticket、旧/新字段、动机、受影响producer/consumer、兼容迁移、数据库与回退、case。请求放lane文档，不直接改共享schema。MAIN不允许为合并降低additionalProperties、放宽错误码或删除fitness断言。

## 4. 存储与事务分工

MAIN持有RevisionStore一个连接与DDL/迁移、项目写队列、commit/snapshot/journal/outbox一致性。PRODUCT通过CreativeRepositoryPort保存创作对象；MEDIA通过Job/Asset/Receipt接口写准备结果；BRIDGE只读projection/观测（服务控制走MAIN命令）。

创作artifact版本和workflow修订可以变化，不代表影片revision变化。任何泳道不能在后台回调里直接更新engine binding、source、active snapshot或project revision。新建项目的初始commit也由MAIN实现，不能用假的migration record绕过origin。

## 5. UI与原生Studio分工

PRODUCT拥有新`agent-workbench`组件、API client抽象、状态呈现与监控面板；使用唯一selection/clock的桥接，不维护可独立重建全片的clip数组。旧M5挂载点和原生Gateway由MAIN接线/审核，避免与BRIDGE同时修改M5Panel。

任务状态来自Host/事件，不用浏览器计时器模拟生产进度；服务指标带来源、采样时间/TTL，不支持就unknown。原型的模拟仅在明确demo模式，不进入业务验收或混入真实监控。

## 6. 三种统一验收证明

1. 模块级：各lane依自身commit证明组件与合同、局部负向；无跨lane缺口自签。
2. 集成级：MAIN每次接线在集成commit跑真实Host→MCP/UI→Job→Asset/Engine→Preview/Export，检测未注册、占位值、空helper、fixture绕行。
3. 轮级：A/B/C冻结同一组合commit，运行适用全量与实际用户路径、恢复/性能/安全/Headless，独立外审+人工签署。

全量通过前不得靠不同worktree的模块日志相加得出“整体PASS”。独立审查不能由该实现作者自签；同样不能将主Agent的集成权当成外审权。
