# 代码编程规范

## 1. 总原则

增量实现、最小权限、类型优先、失败显式、证据可复现。不重写已通过模块；修改现有行为前先固定回归。生产能力不能依赖 test-only shortcut、spike、手工 JSON 或隐藏 fallback。

## 2. TypeScript 与模块

- 保持 `strict`；禁用新增 `any`、无校验 type assertion 和 `@ts-ignore`。必要未知输入先 `unknown`，经 schema/type guard 收窄。
- 公共 union 用 discriminant；状态和 operation 不用裸字符串散落。
- 对外 schema/type/validator 同提交；默认值只用于非安全 UI 偏好，不能补出许可、费用、锁或成功事实。
- 文件聚焦单一职责；use-case 与 infrastructure 分离。构造器注入 clock/UUID/process/fs/provider 以便真实边界测试，不设全局可变 singleton，Host 组装点除外。
- import 使用现有 ESM `.js` 约定；不跨层深引 vendor 内部路径。
- 每个新模块导出最小 surface；内部 helper 不为测试而 public。

## 3. 命名

- Type/interface/class：`PascalCase`；函数/变量：`camelCase`；常量：`UPPER_SNAKE_CASE`。
- JSON/API 字段保持现有 `snake_case`；边界处显式映射，不让两种命名随机混用。
- 状态名用完成事实：`source_validated`，不用含糊 `done2`。
- 布尔命名回答问题：`isEligible/hasAttention/canAdopt`；避免 `flag/statusOk`。
- 测试名包含 case ID 和可观察结果，如 `TX-07 same key commits exactly once`。

## 4. 错误和结果

- 用户/协议错误使用稳定 `HttpError(status, code, safeMessage, details, correlationId)`；内部 cause 仅入脱敏日志。
- 不 catch 后返回空数组/成功；未知事务结果进入 attention。
- adapter 错误映射集中定义并有测试；不依赖脆弱 message substring，除非上游确无结构化错误且有固定版本回归。
- 终止/超时/取消区分；费用未知与 0 区分；工具不可用与媒体无效区分。
- `finally` 清理 stage/process/listener；清理失败不能覆盖主错误，但必须记录并可能进入 attention。

## 5. 异步、并发与进程

- 所有长任务接受 `AbortSignal` 和明确 timeout；终止进程树并限制 stdout/stderr。
- 项目写操作必须使用 ProjectCoordinator；禁止 `Promise.all` 并行修改同一项目。
- 并发限制显式、可观测、可测试；不得依赖事件循环“通常顺序”。
- lease 用数据库 CAS + expiry + attempt；回调和 outbox consumer 幂等。
- 不把内存 Map 当持久事实；内存 cache 必须可丢弃并以 durable source 复建。

## 6. 文件、数据库和摘要

- 用户输入永不直接拼路径/命令；命令使用 argv，不用 shell 字符串。
- stage 用专用临时目录，明确允许根；成功后内容寻址/不可变，失败保留审计或按策略安全清理。
- SQL 使用参数绑定和显式 transaction；schema migration 有版本、向前/回退演练。
- 时间/金额/帧使用整数或 rational，不使用浮点作为持久合同。
- canonical hash 调用唯一库函数，禁止模块自写近似序列化。

## 7. React/UI

- 服务端事实使用 query/read model；组件不推导“已采用/已保存”假状态。
- optimistic preview 只能标 draft，失败恢复服务器 projection。
- 可操作元素使用原生 button/input；键盘、焦点、ARIA、文本状态、reduced-motion 同步实现。
- 不以颜色唯一表达状态；无真实百分比显示阶段/活动。
- 真实媒体监听 `loadeddata/timeupdate/error`；动画缩略图不算视频预览。
- API 调用集中在 HostApiClient；组件不持有 token/path/provider secret。

## 8. 注释与文档

注释解释不变量/原因/上游怪癖，不复述代码。临时兼容写明 upstream SHA、issue/ADR、删除条件。公开 port/state/schema 配简洁 TSDoc。禁止 TODO 无 ticket/owner/gate。

## 9. 测试规范

- 先写失败测试，后实现；测试不能以 `skip/todo` 变绿。
- 单元测试用于纯规则；合同测试用真实 validator；HTTP 测真实 server；集成测真实 stores/files/process；Gate 的媒体/导出/provider 使用真实对象。
- mock 只能隔离明确边界，并在 evidence 标注；不能用 mock 关闭真实能力 case。
- 并发测试使用 barrier/fault injection，不用脆弱 sleep；时间使用注入 clock。
- 每个 bug 添加最小回归；旧测试不得删除/弱化/换成只断言状态码。
- fixture 有来源、许可、SHA、生成命令；真实用户素材不进入 git，证据只存批准的脱敏产物。

## 10. 提交与审查

一个提交一个可观察能力或一个文档/测试门；message 建议 `M2.1(engine): ...`。提交包含关联 case。禁止混入格式化全库、依赖大升级或不相关重构。review 必查 AC ID、失败路径、兼容、测试真实性和 evidence。

## 11. 完成定义

代码完成不是“实现编译”。模块 DoD：合同、实现、负向/故障/回归、真实边界（若适用）、命令与日志、SHA256 evidence、文档/traceability 同步、内审无 major、冻结 commit 外审。缺一项状态仍是 `IMPLEMENTED`，不能是 `PASSED`。

