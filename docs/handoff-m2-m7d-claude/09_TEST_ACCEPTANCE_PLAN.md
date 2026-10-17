# 全阶段测试与验收计划

## 1. 状态模型

每个 case 独立使用：`NOT_RUN → IMPLEMENTED → INTERNAL_EVIDENCED → REVIEW_PENDING → PASSED`，或 `FAILED/BLOCKED_INPUT/BLOCKED_ENV/NOT_APPLICABLE_APPROVED`。测试总数不能替代逐 case 状态。

M2.1/M2.2/M2.3 等小节是波次内模块检查点，不分别触发完整外审。case 可以先到 `INTERNAL_EVIDENCED`；在波次组合 commit 上统一全量复验、独立外审后才批量进入 `PASSED`。这减少重复审核，但不减少任何 case 或真实证据。

## 2. 证据层级

| 层 | 能证明 | 不能证明 |
|---|---|---|
| schema/unit | 纯规则、结构、确定性 | 路由、真实进程/文件 |
| HTTP/integration | auth、状态码、队列、数据库/文件边界 | UI/真实媒体质量 |
| fault/concurrency | crash、lease、原子性、竞争 | 人类体验 |
| real media/render | 真实解码、帧/音轨、导出 | 原生可编辑性本身 |
| Headless browser | 无声无干扰 DOM/布局/媒体事件 | headed/人类体验 |
| headed browser | 真实窗口/键盘/缩放/媒体交互 | 用户主观目标 |
| human | 任务可懂、审美、事实与内容质量 | 事务正确性 |
| independent review | 冻结代码/证据无重大缺口 | 替代未执行测试 |

## 3. M2 验收

### M2.1

- `EN-01`：双 adapter 但单项目单引擎；旧 Hypit 合同保持。
- `EN-02`：timeline/Inspector/subtitle/history/import/provider/CLI/file watcher 每个入口 direct bypass 均 translated 或拒绝。
- `EN-04`：scene/字幕/设置/字体/引用资产任一改变都改变 digest 并阻止旧 base。
- `EN-06`：scene/worker 不能读取 secret、任意文件或未授权网络。
- `TM-01`：frame↔seconds 往返，边界和跨章点一致。
- `TM-02`：合法半开区间；零长/越界/unsupported 跨镜拒绝。
- `TM-03`：短素材不隐式循环/变速。

门限：native registry 无 unknown；materialize/adopt 仍关闭；旧全量 check/build 通过。

### M2.2

- `JB-01` 重启保留 Job，失 lease running 不假成功；
- `JB-02` 双 worker CAS 只有一个 owner；
- `JB-03` SSE cursor 补发/去重；
- `JB-04` 取消晚到 quarantine 且 NOWRITE；
- `JB-05` 未知费用不重发；
- `JB-06` commit 后崩溃只续发 outbox。

另测三类锁、同项目写串行、snapshot 混读、commit-record durability 和每个 journal 边界。门限：Job 不再以内存作为事实；任一不确定 commit 进入 attention。

### M2.3

`EN-03` 已知三镜 fixture migration loss report；`EN-05` 旧应用/旧项目真实重开导出；组合复验全部 EN/TM/JB。旧项目 bytes SHA 不变，新项目三 clip 可编辑，回退保留新结果。

## 4. M3 验收

`PR-01` 保留真实 Claude 3–6 提案；`PR-02` 比较/试听只读且不产生新费用；`PR-03` 拒绝第二 timeline、未知 asset 和锁定范围变更。`MT-01` 真实绑定/长度/rights；`MT-02` 三候选 proxy 与 native segments；`MT-03` derived lineage；`MT-04` NOWRITE；`MT-05` 取消/重启/stale；`MT-06` 首末帧、split 和 clip 时长。

门限：source digest/revision 前后相同；三镜 native plan 三段；成功只到 `ready_for_adoption`。

## 5. M4 验收

`TX-01` 缺 impact；`TX-02` impact 篡改/过期；`TX-03` visual/narration 锁；`TX-04` duration 与共享消费者；`TX-05` stale source/base；`TX-06` 并发采用；`TX-07` 幂等；`TX-08` 六个 journal 边界；`TX-09` 历史/撤回；`TX-10` native undo/redo；`TX-11` 双导出；`TX-12` snapshot 原子读取；`TX-13` 锁/外部变更竞争；`TX-14` 三镜独立精修。

关键断言：成功 exactly +1、失败 0；旁白/字幕/总时长/相邻区符合批准 impact；重开一致；OpenFilm rebased 不绕 409。

## 6. M5 验收

`UX-01` 任务导入；`UX-02` 新项目重开；`UX-03` 章节镜头地图；`UX-04` 语义到镜头；`UX-05` 共享 clock/selection；`UX-06` 连续尺度；`UX-07` 三路真实预览；`UX-08` 六类选择；`UX-09` 一击采用/跳过；`UX-10` 同页原生精剪；`UX-11` 可访问；`UX-12` 用户实用性。`PF-01` 120 镜交互，`PF-02` 三路真实 proxy 负载，`PF-03` 冷/热重开。Headless 负责可自动路径；headed 负责真实键盘/原生 200%/媒体交互；用户亲自执行一分钟定位/比较和十秒撤回。120 镜每类操作 100 样本，p95≤100ms，保留原始样本/硬件/浏览器/编码。

门限：地图/Timeline/Player/Inspector 同一 selection/clock/snapshot；无第二 timeline；三路是真视频事件；人类 case 未签即 M5C 未过。

## 7. M6 验收

`DL-01` 真实母项目/章节及三处完整链；`DL-02` 8 个实际标题；`DL-03` 4 个封面方向和实际候选；`DL-04` 每类 preflight 缺陷 fixture；`DL-05` 后期和同 revision 交付包；`DL-06` 13 P0/6 NFR 独立终审。

真实内容、许可、provider 授权或用户签署缺失时用 `BLOCKED_INPUT`，不得生成模拟证据。门限仅 `Gate V1-P0`。

## 8. M7 验收

- `P1-01` StyleProfile 真应用/override/锁/恢复；
- `P1-02` 真实中文 TTS/ASR/对齐和 stale；
- `P1-03` 授权检索/生成真实 receipt、预算/unknown；
- `P1-04` feedback revision/range 迁移或 orphan；
- `P1-05` 完整长片双导出/重开/恢复/风格/声音/内容；
- `P1-06` P0+P1 分母完整，独立审计和用户签署。

## 9. 全量命令基线

阶段计划必须记录实际命令，不预设未来 script 已存在。最低保留：

```bash
corepack pnpm check
corepack pnpm test:contracts
```

并增加 ticket 专项 script、真实 Host HTTP、故障注入、Headless、ffprobe/完整 decode、secret scan、evidence validator。命令输出、exit code、版本和耗时落盘；测试失败不可用重跑后删除前次日志掩盖。

## 10. 非功能与安全回归

每门都复跑 Origin/session、path traversal/symlink、日志脱敏、body/process 上限、credential scan、legacy routes、materialize/adopt 阶段开关。性能阈值只用于已定义操作；安全/恢复门零容忍。

## 11. Evidence manifest 最低字段

```json
{
  "case_id": "TX-07",
  "status": "PASSED",
  "repo_sha": "<full sha>",
  "upstream_shas": {},
  "environment": {},
  "fixture_manifest_sha256": "<sha256>",
  "commands": [{"command": "...", "exit_code": 0, "log": "relative/path"}],
  "assertions": [],
  "artifacts": [{"path": "relative/path", "sha256": "<sha256>"}],
  "evidence_kind": "integration",
  "review": {"internal": "PASS", "external": "REVIEW_PENDING"}
}
```

所有 path 相对 evidence 根；manifest 自身生成后再由上级 checksum 文件覆盖，避免自哈希循环。

## 12. 四波次正式验收频率

| 波次 | 增量检查 | 正式组合验收 |
|---|---|---|
| Wave 1 / M2 | 每模块合同、fitness、受影响回归 | EN/TM/JB + legacy、真实重启/导出/回退、一次内审和一次外审 |
| Wave 2 / M3–M4 | binding/materialize/adopt/history 增量矩阵 | PR/MT/TX 完整真实链、故障恢复、双导出、一次内审和一次外审 |
| Wave 3 / M5–M6 | UI/性能/QC 模块测试 | UX/PF/DL、P0/NFR、Headless + 集中 headed/human、P0 终审 |
| Wave 4 / M7 | Style/Voice/Provider 增量测试 | P1-01..06 + P0/P1/NFR 全量、真实长片与用户签署 |

