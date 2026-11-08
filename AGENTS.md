# Narralens 多Agent工作约定

## 当前授权与权威入口

用户已认可截至`867b3b3`的Agent驱动路线文档，并授权并行架构/目录/任务规划。尚未把精确合同或产品原型冻结，也没有本轮生产实现release。先读 `docs/agent-driven-v1/00_READ_FIRST.md`、`07_PARALLEL_DEVELOPMENT.md`、`08_PARALLEL_PORTS_AND_OWNERSHIP.md`、`parallel-plan.json`。

有用户后续明确授权时以最新指令为准；MAIN将其记录为ReleaseAssignment（合同/基线/范围/owner/验收）。文档认可、创建worktree、模块测试通过均不能冒充生产准入或整体验收。

## 角色与范围

- canonical `Narralens` worktree的主Agent负责集成与公共文件；`agent-driven/lane-bridge|product|media`按parallel-plan.json对应白名单工作。
- 默认拒绝白名单外修改；protectedFiles/protectedPrefixes优先于allowPrefixes。需要公共改动，在自身 `docs/parallel/lane-*/requests/` 提交具体请求，不直接改server、DDL、合同、配置、旧核心或其他分支。
- 三lane从同一合同冻结SHA起步；一个文件一次一个owner；git显式add自己的路径，不reset/stash用户工作，不自动push/合main。
- 主Agent持续接线、负责冲突/真链；worker证据只证明模块，不能自签独立外审、人验或整轮PASS。

## 运行与验收

- 每worktree独立var/dist/node_modules/DB/staging/profile/端口；共享固定上游只读。禁止复制或链接可写运行根制造状态串扰。
- 轻量模块测试可并行；全量、多Host、ffmpeg/GPU/Comfy与大fixture首建须主Agent全机资源预约；不得提高vitest默认并发掩盖问题。
- 自动化一律Headless、静音、不抢焦点；真实人工窗口提前告知；不访问J盘/下载模型/产生付费或外传，除非当前任务范围明确授权。
- 无假进度、无测试替身冒充生产；失败与NOT_RUN保留，未知费用/取消结果如实处理；所有工程写仍经唯一Coordinator与base/锁/审批。

## 当前允许动作

基线复核、隔离目录准备、指定原型/文档/合同协作。没有MAIN正式实现release时不自行开生产功能。后续实际开发依本轮冻结计划连续推进，普通失败自己修复，第3次返工接管共同根因；仅在人工事实/高风险契约/授权或真实外部阻塞处升级。
