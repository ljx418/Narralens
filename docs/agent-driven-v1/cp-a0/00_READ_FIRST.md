# CP-A0：A轮精确合同与开工前准备包

2026-11-09。范围：文档开发；产品实现 NOT_RELEASED。观察源码为 `fd3021c336387b4c6405b3db08abaafa81c842ff`，保留现有工作树。最新统一入口是 `../final-review/index.html`。

## 本包承诺什么

1. `01_PROTOCOL_AND_AUTH.md`、schema/TS/registry/向量：A固定流程、最小创作问答、内容relay与可信批准分离、运行门、事件游标、原生确认、正式交付。
2. `02_DATA_AND_RECOVERY.md`、migration.sql、canonical向量：在既有RevisionStore共享连接上的目标数据与恢复；用隔离SQLite验证候选迁移，不操作生产DB。
3. `03_EXECUTABLE_ACCEPTANCE.md`、acceptance-plan.json：A实际可执行验收设计，保留35个AD-T族、23个EX子case与T20-A..H，后续B/C完整关闭范围明确。
4. `04_RELEASE_ASSIGNMENTS.md`、readiness-check.json：MAIN及三个lane的目录、保护文件、唯一writer、依赖、资源预约和实施准入。实际实现会话均NOT_STARTED。

固定模板为 `local-short-film@1`、A plan_version=1。A不开放动态编排、稳定豁免、运行中改计划、GPU/runtime写或下载/付费能力。B必须通过新版本合同冻结，不可利用预留字段静默开放。

## 状态和冻结含义

`candidate-lock.json`（完成交叉复验后生成）只锁定这次交付的**文档候选字节**，不是生产CP发布、用户实施授权或真实业务外审。schema中的published也只是候选固定模板状态。本目录不被产品导入、未注册生产路由，旧S0/R4冻结与历史Gate保持。

本轮独立交叉审查实际修掉：A延期入口错误放行、安全取消策略、问答DTO缺口、Approval状态不一致、可信确认用途/主体串用。审查过程与复验见reviews；实现后的完整鉴权、原子提交和故障实证不能由文档oracle代签。

## 文档自检

```sh
node docs/agent-driven-v1/cp-a0/contract-check.mjs
python3 docs/agent-driven-v1/cp-a0/sql-check.py
```

运行使用现有依赖，无安装/升级。生成器会重写本目录自身派生报告/TS/registry；代码验收/独立外审应只读核查冻结输入，不能以运行生成器后改变字节来掩盖偏差。具体检查数量以当前报告为准。

## 实施前与验收前尚需的事实

- 用户尚未授权本轮产品实现；MAIN需要先汇报A目标和实际Agent分工，再发精确ReleaseAssignment，复核worktree基线与资源。
- A末尾需要授权的60–180秒素材、真实中文录音及完整许可/hash/探测清单，目前SELECTION_PENDING；不能用小fixture或AI概念图替代。
- SDK/三客户端真实联调、新Host生产装配、旧库副本升级/崩溃、可信通道/native ack、正式render/full decode均NOT_RUN，按A任务逐一实现；不是文档完成后即可声称已具备。
- B的Comfy实际模板/模型指纹/许可、真实音频字幕质量阈值须实施前冻结；本轮不探测J盘、启动模型、外传或付费。
- A/B/C各阶段独立审查与人工签署均保留；不能保证零返工，只能把已知分歧提前暴露并锁定。
