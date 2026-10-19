# Wave 2 / M3 四视角内部审查记录

状态：`BLOCKER=0, MAJOR=0`（首轮 4 BLOCKER / 12 MAJOR，全部修复并各有会失败的测试）
审查范围：M3，提交区间 `1f1a4fc..4bc7e1c`
执行方：实现会话（**不得**自签外审；外部审查独立进行）

## 0. 审查方式

四个视角由四个独立代理并行执行，各自只读，互不共享结论。修复在代理全部结束后统一进行，
避免重演"审查代理与实现同时改文件"的冲突。工作树在审查开始前为 clean。

| 视角 | 关注 |
|---|---|
| 架构 | 单引擎绑定、Host 独占 commit、无第二 timeline、单一项目权威、NOWRITE、七方法 port、冻结历史、阶段门 |
| 正确性 | 崩溃原子性、取消竞态、信号量、恢复完备性、幂等、渲染器、绑定重读 |
| 真实体验 | 用户实际会遇到什么、错误是否可操作、终态是否说明、无 worker 时会怎样 |
| 验收 | PR-01..03、MT-01..06 逐 case 判定、证据与断言的落差 |

## 1. 首轮结论

| 严重度 | 数量 | 代表项 |
|---|---|---|
| BLOCKER | 4 | 生产环境无 worker；完整 proxy 被当作 stale 丢弃；并发重放变成 500；观察者抛异常永久占用信号量 |
| MAJOR | 12 | 取消竞态、孤儿 job、恢复承诺了做不到的事、staging 扫错目录、ready 缺事实校验、plan/segment 静默分歧、comparison 漂移、MIME 未重读、derivedRoot 可指进工程、路由绕过合同、PR-01 标记只存在于单测、MT-04/MT-05 仅组件级 |

其中三个 BLOCKER 由**两个独立视角各自独立发现**（无 worker：真实体验 + 正确性），这提高了
它们的可信度。

## 2. 修复与验证

每个修复都有一个"去掉修复即失败"的测试。M3 门从 112 增至 125，其中 13 条即本次新增。

| 编号 | 问题 | 修复 | 证明 |
|---|---|---|---|
| B1 | 生产无 worker | Host 启动时 `recover()` + 定时 `drain()`，close 时清理 | `materialize-routes.test.ts`：POST 后只轮询 GET，渲染由 Host 自己完成；重启后分类遗留行 |
| B2 | 完整 proxy 被 stale 丢弃 | catch 区分"前提被推翻"与"仅提升被中断" | `changes no author fact` 之外新增 `keeps a completed materialization when only the promotion is interrupted` |
| B3 | 观察者抛异常吃掉信号量 | 两个回调都放进释放槽位的 `finally` | 语义边界，构造性论证；无公开路径可达，记录为不可独立证明 |
| B4 | 并发重放 500 + 孤儿 job | `create`/`rememberOperation` 用 IMMEDIATE 事务；幂等判定前置于任何副作用 | `concurrent identical requests create one row and one job, not a 500` |
| M1 | 取消竞态 | 检查与提升之间无 await | `a cancellation landing between the check and the promotion is still caught` |
| M2 | 孤儿 job | `transition` 而非 `recordCallback`（后者对无 lease 的 job 无效） | 同 B4 测试 |
| M3 | 恢复承诺做不到的 retry | 终态 job 改为 park | `recovery parks a row whose job is terminal instead of promising a retry` |
| M4 | staging 扫错目录 | 扫描 `staging/`（其中文件名无 `.tmp` 后缀） | `cleans a staging file left by an encoder that was killed` |
| M5 | ready 缺事实校验 | `#assertReady` 要求三个 digest 非空 | `cannot reach ready without the facts the worker proved` |
| M6 | plan/segment 静默分歧 | 渲染器拒绝两者不一致 | `refuses media that is not an MP4 container…` 之外的 plan/segment 用例 |
| M7 | comparison 漂移 | 请求时 pin comparison digest，worker 重算比对 | `refuses a comparison rebuilt after the intent was prepared` |
| M8 | MIME 未重读 | ffprobe 校验容器与视频流数 | `refuses media that is not an MP4 container even when its bytes match` |
| M9 | derivedRoot 可指进工程 | 组装时做包含性检查 | `refuses a derived root that would put proxy bytes inside a project`（经 Host 构造） |
| M10 | 路由绕过合同 | 走 `validateMaterializeRequest` | `materialize-routes.test.ts` 各类非法 body |
| M11 | PR-01 标记只在单测 | 路由接受 replay 声明，stdout digest 取自 comparison 自身 audit | `stamps RECORDED_PROVIDER_OUTPUT_REPLAY with both digests` + `refuses a replay that cannot be substantiated` |
| M12 | MT-04/MT-05 仅组件级 | Host 级前后事实 diff + control revision 漂移 | `changes no author fact while a real materialize runs end to end`、`goes stale when the control revision moves…` |

## 3. 逐 case 复判

| Case | 审查后判定 | 依据 |
|---|---|---|
| PR-01 | CLOSED | replay 标记由生产路由产生，stdout digest 不可由客户端伪造，payload digest 必填，两者都记录 |
| PR-02 | CLOSED | MT-04 已在 Host 级前后 diff（commit / binding / ledger / ledger_record / 目标树 / 源树） |
| PR-03 | PARTIAL | 第二 timeline 与越界/重复绑定已覆盖；**锁定范围（locked range）尚未建模**，属 M4 锁类范围，本波明确记为 claim_limit |
| MT-01 | CLOSED | rights / hash / MIME / 帧长 / source span 均已重读；短素材拒绝 |
| MT-02 | CLOSED | 三 clip 稳定唯一；单 clip composite 被合同与 store 双重拒绝 |
| MT-03 | CLOSED | lineage digest 对每个事实、tool profile 与 version 均敏感，交换 output 区间也会改变摘要 |
| MT-04 | CLOSED | Host 级 diff，非仅组件级 |
| MT-05 | CLOSED | 取消、晚到、lease 竞争、崩溃边界、base/control/inventory 漂移、重启恢复均有测试 |
| MT-06 | CLOSED | 总帧数与完整解码为真实 ffprobe；分段边界用"更接近自己的源帧"判定，因为重编码有损、字节相等不可能成立 |

## 4. 已知且明确不声称的部分

1. **锁定范围（locked range）未建模** —— PR-03 的该子句属 M4 的三类锁范围，M3 不虚构。
2. **produced-frame-count 守卫不可独立证明** —— 每个 segment 的帧数检查先于编码执行，
   编码器只会拿到它能满足的输入；保留为后置断言，如实记录。
3. **信号量 release 幂等守卫不可独立证明** —— 无公开路径可达；保留并注释。
4. **环境导致的 ENOMEM** —— 见证据 manifest 的 `check_stability` 与说明。已通过诊断通道归因，
   且正是它促成了"失败原因携带错误类别"这项修复（`SOURCE_TREE_UNREADABLE:ENOMEM`）。
5. **headless / human 体验** —— 本波无 UI 变更，headed/human 记 `NOT_RUN`。
