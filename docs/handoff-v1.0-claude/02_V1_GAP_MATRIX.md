# V1 PRD 剩余缺口矩阵

状态以代码和证据为准；`partial` 不等于完成。

| PRD/NFR | 当前状态 | V1 剩余内容 | 计划关闭阶段 |
|---|---|---|---|
| P0-01 项目创建/任务包 | not-started | CreativeTask/可信来源包、合法/非法导入、重开 | D6 |
| P0-02 章节/脚本/镜头 | partial | 章节导航、脚本/语义入口与 stable shot 同步 | D6 |
| P0-03 真实播放器/时间码 | partial | 内嵌真实播放器、统一帧/时间码往返 | D6 |
| P0-04 全片/局部时间轴 | not-started | 全片时间轴、局部精修、缩放不改变选区 | D6 |
| P0-05 镜头/区间/逐帧 | partial | 区间与逐帧 UI、脚本锚点联动 | D6 |
| P0-06 3–6 提案 | done | 只做回归，不扩张范围 | D4.2–D7 回归 |
| P0-07 分项锁 | partial | narration/duration 主动锁；采用路径复验 visual lock | D4.2.3、D5 |
| P0-08 本地素材/来源/许可 | partial | D4.2.1 总门禁；segment binding、derived lineage/composite、许可审批 | D4.2.1–D4.2.3 |
| P0-09 局部差异确认 | partial | canonical impact、过期确认 428、采用前后真实 diff | D4.2.3 |
| P0-10 版本/撤回/恢复/冲突 | partial | 用户历史恢复生成新 revision、持久任务恢复 | D5 |
| P0-11 重开与 MP4 | partial | 真实 3–5 分钟、20+ 镜头、采用后重开与双导出 | D7 |
| P0-12 标题/封面 | not-started | 8 个标题、至少 4 个封面方向、人工确认 | D7 |
| P0-13 发布前检查 | not-started | 黑帧、字幕边界、音量、截断、来源/许可阻断 | D7 |
| NFR-01 本地优先 | partial | D4.2 审批/安全证据、V1 总扫描 | D4.2、D7 |
| NFR-02 可恢复 | partial | materialize/adopt/D5 任务和用户历史恢复 | D4.2.2–D5 |
| NFR-03 可观察 | partial | 持久任务、取消/晚到/费用状态统一 | D4.2.2、D5 |
| NFR-04 可测试 | partial | 每阶段 evidence manifest、V1 总证据 | 全阶段 |
| NFR-05 性能 | not-started | 100+/120 镜头 trace、p95 ≤100 ms、无 >100 ms UI 长任务 | D6–D7 |
| NFR-06 可访问 | partial | D4.2.1 200%；其余核心路径键盘/axe/200%/人工审查 | D4.2.1–D7 |

## V1 可用的最低真实用户闭环

1. 导入或创建真实任务包并打开 10–15 分钟母项目中的 3–5 分钟章节。
2. 通过章节、镜头、语义和时间码定位同一 stable selection。
3. 输入局部导演意图，比较 3–6 个结构不同且合同有效的方案。
4. 为所选方案绑定 cleared/commercial 本地素材，只实体化被选方案。
5. 查看来源、许可、synthetic、费用和 canonical impact；锁定旁白/时长后明确确认采用。
6. 采用仅产生一个 revision，旁白、总时长、相邻镜头和 stable shot identity 满足不变量。
7. 可撤回/恢复为新 revision，重启后任务、历史、媒体引用可恢复。
8. 真实 build/export，运行字幕/声音/黑帧/许可预检，交付 MP4、字幕、来源许可、标题封面、版本与生成记录。

以上任何一步只能靠 mock、截图或静态 HTML 证明时，V1 仍不可用。
