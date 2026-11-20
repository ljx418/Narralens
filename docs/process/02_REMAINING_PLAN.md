# 剩余开发计划（2026-11-20修订）

## 当前事实
当前A/N1N2/R6，未完成代码保全于main-integration。R5I最小normal002/fault001曾接受；R6改协议后不继承真实运行PASS。R6文档rev2 PLAN_READY，源码partial，续做被429中断；本轮只流程/整理。原17与ISO01..18、C09、R7、R8及NEXT全在，不重编号。

## 近期连续交付顺序
|段|范围与内部闭环|实现/设计/审查责任|验收门与停点|
|P0流程准入|修订后先构建命令白名单/预约与在途拒绝、交还case验证，保原记录器；先解决挂起pipe fixture与工具违规，不能延长超时掩盖|MAIN冻结工具合同/样例；Claude实现；独立Codex核实际负例|元数据自证/非法命令拒绝/重复或挂起拒绝/取消后真实状态；不是产品PASS|
|R6-A协议语义|完整绑定、epoch/completion、终态wait/N-last、有界map和no-birth/no-fork/failedsetup；producer/consumer同闭环|一个Claude writer，Codex先独立期望|具名C06正反例和生产直接入口；不据数量交还|
|R6-B终局与输出|raw-tree→stream→wire→Hostclose分层；全期输出/EOF/EIO/公平服务；overflow只失败收敛、unknown持责|同一writer，不并行改C/Host|C07/C08 direct及晚wait/原cause/真实通道error；最终同源六门；独立源码安全审|
|R6-C递进真实验证|新pin正常/指定失败→小规模late stream/背压→新授权fixture的ready/adoption/TERM-live→overflow/peer/权限/unknown|MAIN实际验收操作，独立观察；Claude修实现|每场景精确票/原始记录/原epoch终局；C09只有真实链证后关闭|
|R7资源闭环|普通拒绝/失败、closure/PRE/POST/drain/文件FD、幂等不冒fresh、late handle可恢复|领域Codex细化；MAIN审合同；单Claude实现|真实生产接缝、unknown不释放、原promise/close至多一次；受影响回归|
|R8组合冻结|原17+ISO18全覆盖、当前Chrome帧/poster/Q2、真实媒体双片、全量/build/security/PRD与架构一致|MAIN总验收，独立Codex审冻结SHA|不留伪绿；缺项不宣称N1N2；新冻结commit|
|NEXT开工包|把下一接线合同/28个既有S01等case/回退锚定实际接受commit|Codex方案与独立文档审|按原goal在接线开工门停止，未实施下一接线|

内部R6-A/B是同一R6交付内的工作顺序，不新增用户审批/完整外审往返；实际安全敏感运行前的独立门保留。只有已释放内容全部齐，才送正式源码外审。C09变更fixture需单独精确release，不能挪用旧pin。

## 随后产品阶段（不提前释放）
A剩余IT-A01..A06：Agent→MCP→真实工作流可见→候选/章节/音频/封面确认→受控采用→原生加载→正式导出；两个主题60–180秒真实短片、可编辑概念说明、改单镜双导出、重启恢复、中文HTML报告后A人验。
B（A人验通过后）：下载/版权与素材、完整监控/并行、Comfy与声音、标题封面/QC，IT-B01..B06及全部适用P0/NFR。
C（B人验通过后）：原PRD精修、真实10–15分钟母工程/3–5分钟20+镜章节、三驱动及恢复性能，IT-C01..C03，全部P0/P1/NFR/体验+独立审+人验后V1-Full。

不新增第二时间轴/独立工作台、不换引擎、不重写已验模块。近期不安排全面拆分7100行核心；先逻辑职责与直接证据，确有耦合再具名提取私有模块，保持公开接口及EnginePort七方法。

## 开工依赖
本维护轮结束只提供下一goal，不自动重启Claude。下一轮用户启动goal后核窗口/唯一writer、保全版与当前源码SHA，补发P0精确票，再连续R6/R7/R8与NEXT。429再次出现仍立即停。当前无可信吞吐样本，不用历史工时或命令数推算完成日。
