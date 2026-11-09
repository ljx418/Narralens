# 风险、约束锁定与回退决策

本表为实现前风险清单。等级表达失败影响，不等于当前已经发生的产品缺陷；已有底座的限制与新路线设计缺口分开。本轮不自签业务/外审或声称所有未来合同已冻结。

| ID / 级别 | 触发与架构影响 | 预防与必验证据 | 失败后的回退 / owner |
|---|---|---|---|
| R01 高：生产入口/一般创建 | 旧默认演示与迁移Resolver不能承载新工程 | MAIN bootstrap/new origin，初始snapshot/binding/commit同事实；两个主题、幂等与真实重开 | 关闭新建入口，保留可读工程；不能假migration / MAIN |
| R02 高：render未开放 | 七方法接口存在但两个adapter仍抛CAPABILITY_NOT_ENABLED | MAIN补接缝，MEDIA真实snapshot renderer；固定上游/输出、完整decode与双导出 | 停用导出声明，保留snapshot；不能拿proxy/探针顶替 / MAIN+MEDIA |
| R03 高：双事实/绕过 | 多MCP/第二timeline/裸native写产生分叉 | 单Host/DB/engine/Coordinator，HTTP/MCP同应用端口；fitness+真实绕过负向 | 关闭新注册和写入口，旧工程可读；不手改pointer / MAIN |
| R04 高：批准/选择混淆 | MCP伪human、旧hash或跨项目批准 | 可信UI身份，scope/base/input/expiry/consume同commit；选择只做Decision | 撤销未消费授权并重核；未知提交先对账 / MAIN |
| R05 高：提交与画面混淆 | UI将Host revision当native ack | 原生桥真实回报与project/snapshot匹配；故意延迟/丢ack | 保留待同步/unknown，重连核对，不报完成 / MAIN+PRODUCT |
| R06 高：系统卸载/未知任务 | 失联任务仍占资源，卸载与新准备竞态 | 服务端owned/任务/资源原子检查；模型加载/预热/卸载与准备互斥；共享只读 | 停用该动作、保留任务/receipt，等待核实或安全点 / MAIN+MEDIA |
| R07 高：外部副作用重复 | provider受理后断线、重试或取消晚到 | 外部ID/receipt/幂等与费用unknown；历史结果查询与受限重试 | 查证原请求，无法证明则unknown，不盲重提 / MEDIA |
| R08 高：库迁移/恢复 | 新表/CHECK导致旧库失效、专项恢复顺序变化 | 副本upgrade/reopen/中断/新库向量；保留现有专项优先恢复 | 备份恢复/兼容只读导出；不删库，不假称可逆 / MAIN |
| R09 高：下载/生成安全 | 任意URL/图/模型路径/节点安装、外传越权 | allowlist/SSRF/重定向/大小/超时/许可；固定模板与依赖hash；授权边界 | 停provider/模板，已验证资产保留，不能默认授权J盘或外网 / MEDIA |
| R10 中高：合同漂移 | 三lane不同schema/alias/owner，旧提示词启动错误布局 | CP精确hash、producer/consumer同fixture，业务owner≠注册owner；旧版本归档 | 不接线该模块，先合同变更请求；不放宽validator / MAIN |
| R11 中高：性能与关闭 | 多suite/GPU/Comfy负载耗尽；心跳晚于DB关闭 | 全机预约、有限并行、真实终止/关闭生命周期；未知原因不归因ENOMEM | 依设计分池重试/有界降级，保留失败和机器数据 / MAIN+MEDIA |
| R12 高：规格被阶段替代 | A短片或disabled按钮被当作完整V1 | P0/P1/NFR/AD-E/AD-T/R4逐条追踪；短片/Beta/Full声明分开 | 阶段仅签实际范围，剩余保持未实现 / MAIN |

## 锁定与待冻结事项

已锁定：用户R4体验、单事实/单提交/单引擎/原工作台、严格409、来源许可/费用授权、原型不作业务验收、Headless与单writer、旧Gate保留、A/B/C大阶段人验。

设计需审查但不向实现者默默转嫁：A具体协议/包版本和三端支持矩阵；实例私有目录与Windows权限策略；Question/Decision/Approval精确schema及TTL/字段编码；生产bootstrap与DDL；事件保留/cursor溢出界限；snapshot render实际上游接缝；参考机与性能样本；B provider/模板/声音许可证和预算/字幕对齐容差；C三端/全后期矩阵。每项有阶段owner与失败处理，未冻结前对应实现release保持BLOCKED，而不是让实施者自选接口。

DSH或特定本地模板真实不可用时，A可按首端/本地素材限定范围继续文档与获批实施；最终承诺仍保留。若不能消减，给用户明确选择：修兼容适配（保留体验、增加维护）、采用受控替代provider（更改依赖/许可、需新验证）、显式调整PRD（降低承诺、需用户批准）。不得静默fallback并宣称原能力通过。

## 审查结论的使用

代码现状与合同基线分别由未参与本轮文档编写的两个上下文核对；最终整包另做交互/验收视角复审。审查发现的矛盾在当前文档修正，旧内容归档。DOC-G0文档检查可以PASS，但CP、真实产品、独立代码外审、人验和V1仍需各自证据。
