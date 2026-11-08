# M5 UX-12 人工体验与签署清单

状态：`READY_FOR_HUMAN`。三路独立复审已 PASS；本文件不能由自动化签署。未取得项目负责人明确结论前，
UX-12 保持 `HUMAN_NOT_RUN`，不得进入 M6。

交互式辅助页面：`docs/evidence/WAVE3/M5/ux12-human-acceptance-guide.html`。页面提供计时、逐步判定、
本地记录和验收摘要复制功能；其记录不能替代项目负责人的最终明确签署。

## 1. 启动边界

- 旧捕获 `2a8337d...` 与 `74dd568...` 已被语义审计否决，只能作为失败历史，禁止用于人工验收前置。
- 当前自动捕获 `4b2e168c3d3024e5e96832e00bcbd2d8610dd3fe` 为 16 PASS、0 FAIL、UX-12 NOT_RUN；
  UX-11 已证明快捷键窗口内 Document loader `5→5`、WebSocket created `2→2`、closed `0→0`。
  三路独立复审结论见 `reviews/ux12-preflight-independent-review.md`；当前允许在提前告知项目负责人后运行
  可见 launcher。
- 已知非阻塞观察项：固定上游诊断可能出现 9 条可选接口 422、一次 aborted fetch 与一次跨 origin
  `postMessage` warning；若页面出现可感知错误、断线或功能中断，人工验收必须判失败。
- 可见 Chrome 可能抢占焦点，只有项目负责人已经在电脑前并明确要求启动时才运行。
- launcher 仅访问 `127.0.0.1`，使用临时数据库、迁移副本和隔离浏览器 profile；不读取 `J:\`，不联网，
  不调用 provider，不产生费用，不写生产工程。
- 启动命令：`NARRALENS_ALLOW_VISIBLE_UI=1 corepack pnpm experience:m5`。
- 关闭 Chrome 应用窗口或在启动终端按 `Ctrl+C`；launcher 必须清理 Host、Gateway、临时工程与隔离 profile。

## 2. 项目负责人实际操作

请从页面首次可操作时开始计时，不预先观看自动化截图来记按钮位置。

1. **一分钟定位和比较**：在 60 秒内从章节/镜头区域定位中间镜头，确认播放器、原生 timeline、Inspector
   指向同一镜头与时间范围；打开“已录制提案（原始生成审计）”，切换并比较三个真实 proxy。
2. **十秒找到恢复**：完成第 1 步后重新计时，在 10 秒内找到 History/历史入口及恢复动作；只需找到并说明
   下一步，不要在不理解 impact 时盲目确认。
3. **理解 impact**：选择一个候选，依次观察素材化、impact 和确认步骤；用自己的话说明“哪些镜头/范围会改变、
   哪些锁或许可会阻止采用、成功为何 revision +1、失败为何 revision +0”。
4. **理解错误和限制**：观察至少一个 disabled 能力或受控错误，确认页面给出原因，而不是可点击的假按钮；确认
   Idea 草稿不会冒充已创建工程，Delivery Preview 明确标注 M6 尚未开放。
5. **恢复与重开**：执行一次受控采用，再通过 History 创建恢复意图、查看 impact、确认恢复；在当前窗口刷新页面，
   或返回 Idea 页后重新打开同一目标工程，确认 revision/history 与选择上下文能够重建。恢复必须产生新 revision，
   不得回拨指针。不要在此步骤关闭 Chrome 应用窗口；关闭窗口会结束隔离验收会话并安全删除临时工程。
6. **键盘核心路径**：至少使用一次键盘完成镜头移动/选择、打开核心操作并返回，判断焦点位置与文字状态是否清楚。

## 3. 必填结论

项目负责人需在对话中明确回答以下内容，Agent 才能落盘签署：

- 一分钟定位与三路比较：`通过/未通过`，实际耗时与卡点；
- 十秒找到恢复：`通过/未通过`，实际耗时与卡点；
- impact、锁、许可、revision +1/+0 是否能用自己的话解释：`能/不能`；
- 错误、disabled 能力、Idea/Delivery 边界是否清楚：`清楚/不清楚`；
- 恢复、重开、键盘路径：`通过/未通过`；
- 视觉与交互问题清单：每项写明页面位置、现象、严重度（阻塞/重大/一般）；
- 最终结论只能是：`M5_HUMAN_ACCEPTED` 或 `M5_HUMAN_NOT_ACCEPTED`。

若任一核心路径未通过，必须保留问题证据并回到 M5 修复，不得以自动化截图替代。通过后才允许同步
`docs/03_Architecture.md`、`docs/11_V1_Traceability.md` 与本阶段签署证据，并开始 M6 文档门。
