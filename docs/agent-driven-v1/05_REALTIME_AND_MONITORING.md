# 实时工作流与本机服务监控设计

> 2026-11-09用户纠偏（前端实施优先）：保留现有OpenFilm剪辑区和M5导演面板，仅在原导演面板中新增工作流展示、Agent控制台两个可折叠section；服务监控归控制台。工作台呈现同一项目的真实剪辑状态，禁止另建agent-workbench独立前端/聊天入口/时间轴。详情与当前原型见`s0-r2/README.md`（本段路径按当前文档目录解析）。原始PRD功能目标和后台制作计划继续保留，既有审阅/批准/编辑尽量复用原入口。新S0 R2仍待用户核验，不是生产实现release。

状态：目标合同草案；没有实现生产监控或读取本机实时指标。对应PRD AD-E20/E21、架构AD-A13、测试AD-T32..35。

## 1. 用户可见内容

| 位置 | 内容 | 用户动作 |
|---|---|---|
| 常驻顶栏 | 服务总状态、活动任务、待审批、连接状态、最后同步时间 | 一键打开监控或待处理节点 |
| 项目工作流图 | 当前step/attempt、输入输出版本、真实阶段/进度、耗时、等待原因 | 查看产物/日志、修改、受控重试或取消 |
| 服务总览 | Host、MCP façade、Studio/Gateway、workers、Comfy、已配置provider adapters | 读就绪/降级/离线/未知与依赖，定位受影响任务 |
| 队列与资源 | 运行/排队/等待资源数量，CPU/RAM/GPU/显存/磁盘、采样时间与来源 | 按项目/资源池筛选，调整已允许优先级或取消自有任务 |
| 告警与诊断 | 故障、首次/最近发生、关联project/job/service、恢复建议、脱敏日志 | 跳转节点；导出脱敏诊断，不暴露凭据 |

服务健康、模型能力可用性、任务进度三种事实分开。不要以进程存在、TCP端口可连、队列空、WebSocket连通中的任一项单独宣称业务ready。

## 2. 拟新增实体及责任

- `WorkflowEventProjector`：复用现有Job/outbox/SSE，把创作任务/decision/artifact/资源等待变化投影到版本化业务节点，不建立第二套任务状态机。
- `ServiceHealthRegistry`：supervisor与受控probe登记服务instance_id、版本、归属、状态、依赖、observed_at、TTL、reason、受影响能力；健康数据不是业务提交权限。
- `ResourceSampler`：按配置采CPU/RAM/磁盘与可支持GPU遥测，标明宿主/WSL/进程与采样范围，避免把WSL限制误作整机容量；失败返回unknown，不吞成0。
- `MonitoringQueryService`：汇总队列、资源、告警、健康和关联节点，提供脱敏read model；MCP和工作台读同一事实。
- `ServiceSupervisor`：独立于媒体worker/业务Host的启动器职责；有限本机健康端点或等价受控通道使Host故障可见，不暴露通用进程管理shell。
- `WorkflowStatusStore` / `MonitoringPanel`：前端只存投影缓存与游标，读服务端事实并显示陈旧/断线状态，不自行推断成功。

拟路径：`src/host/observability/{workflow-event-projector,health-registry,resource-sampler,monitoring-query}.ts`、`src/app/m5/monitoring/`；supervisor维持原规划落点，避免重复新增进程管理器。

## 3. 事件同步与断线恢复

首次连接：读取一致性snapshot+cursor；订阅该cursor之后事件（或先缓存事件后应用快照），消除“读完再订阅”的漏事件窗口。事件含event_id、project_id、workflow_revision、step_id、job_id、attempt/epoch、entity_version、observed_at与payload/ref。

前端按实体版本/attempt去重与有序应用；旧attempt晚到不能把新节点回退为running。资源遥测可合并/丢弃中间采样，业务状态变化不可静默丢失。游标过期/事件缺口时明确要求新snapshot，不假装回放完整。重连退避有上限并显示状态，连接恢复不触发重做业务任务。

工作流执行状态与观测连接状态独立：running + disconnected表示最后看到运行中，不表示仍确认在线，也不表示已失败。等待GPU、等待用户、依赖stale分别表达；取消请求在worker/外部执行器确认之前保持requested_cancel。

## 4. 服务与资源read model草案

`ServiceHealthSnapshot`：schema_version、snapshot_id、server_time、instance_id、service_kind、ownership(owned/shared/external)、health(starting/ready/degraded/offline/unknown/stopped)、readiness_checks、reason、dependencies、affected_capabilities、observed_at、expires_at、allowed_actions。

`ResourceSample`：source、scope(host/WSL/process/device)、device_id（适用）、capacity/used/available、unit、observed_at、采样失败reason；缺指标使用null+unsupported/unknown，不编造显存/温度/利用率。

`TaskQueueSnapshot`：按项目和资源池聚合running/queued/waiting_resource/waiting_user/failed/cancel_requested，附job引用与重试attempt；摘要计数可追溯到实际行，不能重复计parent与child当作总任务。

拟read接口族：`monitoring_snapshot`、`services_read`、`diagnostics_read`、既有workflow/jobs events；具体HTTP/MCP名称与schema在S1冻结，本文不宣称现有API。

## 5. 观测时限、降级与隐私

- 状态变化延迟从Host接受并持久化事件到浏览器呈现测量，目标p95≤2秒；不把模型实际运行时延算成状态推送延迟。
- 健康/资源默认5秒采样，超过15秒样本过期标unknown；页面显示真实observed_at，不能用浏览器本地时钟刷新旧值伪装新样本。远端不可达与确认已停机区分。
- 浏览器后台可能节流，回到前台先校准快照/样本年龄，不承诺隐藏页2秒绘制；相应条件写入验收。
- Host进程不可达时显示断线与最后状态；supervisor健康通道独立失效也标unknown，不能给出缓存绿灯。
- 监控默认只读，不扫描无关目录或移动盘，不读取/显示进程环境和凭据；异常堆栈与日志需脱敏、分页、保留策略，历史诊断可导出。

## 6. 控制与恢复

owned服务可按显式动作启动/停止/重启，先检查权限、任务与快照；有活动任务时展示影响和可选等待/取消/恢复，不直接kill。shared/external服务只读健康与接入说明，不能擅自重启、清全队列或卸载模型。服务监控的按钮也走受控command及审计/幂等；自动重试或重启必须有次数/退避/熔断策略并获相应授权，防止重启风暴。

任务重试仍校验旧输入是否有效、授权/费用与idempotency，不因监控提示“重试”就绕过审批。重启后的job恢复采用现有lease/recovery机制；监控不另建一套恢复状态机。

## 7. 分阶段交付与直接验收

- S1：服务发现、基本健康/就绪与last observed、supervisor故障可见；T32的服务采样基础/T34的控制边界。
- S2：创作短片业务图实时状态与输入输出；T33的事件/快照首链；不用手动刷新才看见完成。
- S3：完整MonitoringPanel、资源/队列关联、版本乱序/重连与节点编辑状态；T32–35主要负向和人验。
- S4：Comfy进度、prompt/外部子job、GPU等待、在线但缺模型、共享取消边界；T32/34联测。
- S5：长片/多客户端负载下延迟、采样开销、Host/worker真实进程退出恢复与监控一致性；T35终审。

T32：服务进程在但API失败、依赖缺失、遥测不支持、采样超时/15秒TTL、Host与supervisor分别中断，不能出现假ready。
T33：SSE断线重连、cursor过期、重复/乱序/旧attempt、读快照订阅竞态、取消晚到与事件回放，结果与Host最终事实一致。
T34：只重启owned实例、活动任务影响提示、拒绝共享服务kill/全局interrupt、日志凭据脱敏、权限隔离/幂等、重启后恢复。
T35：正常连接p95≤2秒（记录原始样本、机器与负载）、5秒采样/15秒过期、后台恢复校准、CPU/内存采样开销、用户定位故障服务→受影响节点→可执行恢复步骤。采样性能预算在S1探针后冻结，未测不声称无开销。

以上均为待实现门槛，审阅页的动态示意使用明确标记的模拟数据，不接本机服务，不能计为这些测试通过。
