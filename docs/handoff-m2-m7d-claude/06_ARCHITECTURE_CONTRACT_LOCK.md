# 架构契约锁定（ACL-1）

状态：`FROZEN_FOR_M2_IMPLEMENTATION`。以下契约是 M2–M7 的不可静默偏离项。每条必须有架构测试或阶段验收；确需修改时先走 CR/ADR/PRD 影响审查，不能以实现方便为由先改代码。

## 1. 核心不变量

| ID | 锁定契约 | 自动验证 | 人工/审计验证 |
|---|---|---|---|
| AC-001 | 单项目只有一个可写 engine binding，禁止 Hypit/OpenFilm 双写 | unique constraint、integration | migration report |
| AC-002 | Host/ProjectCoordinator 拥有 commit、revision、locks；adapter 无 commit 权 | import/API test | code review |
| AC-003 | 所有 native UI/API/CLI/history/provider/file 写入口必须 translated/blocked/read_only；unknown 默认拒绝 | registry completeness、bypass tests | 入口清单复核 |
| AC-004 | stale base/source 一律严格 409；OpenFilm rebased 不得作为 Narralens 成功 | OF-04、TX-05 | frozen evidence |
| AC-005 | author source 只从隔离 stage 生成不可变 snapshot；reader 只经单一 commit record | crash/concurrency tests | snapshot audit |
| AC-006 | source digest 覆盖 film、引用 scene/html/js/css、字幕、设置、字体和引用资产内容 | golden vectors、EN-04 | dependency manifest review |
| AC-007 | revision 单调；成功编辑/恢复恰好 +1，失败 0，恢复不倒退数字 | TX-06..09 | event log review |
| AC-008 | visual/narration/duration 三类锁由服务端按实际影响和共享消费者执行 | TX-03/04/13 | headed bypass |
| AC-009 | materialize 只生成 binding/native plan/proxy/lineage，不写 author source/revision | MT-04/NOWRITE | diff audit |
| AC-010 | impact 由服务器从当前 snapshot/control/rights 算出；客户端只能回传 ID/hash | TX-01/02 | payload review |
| AC-011 | 三镜采用后是三个原生可编辑 clip；flattened MP4 不能通过 | TX-14 | headed + render |
| AC-012 | Job/Event/lease/cancel 在 M3 前持久化；晚到结果 quarantine，不自动采用 | JB-01..06 | DB/event audit |
| AC-013 | 所有导出绑定已提交 snapshot；新 revision 不改变在途导出 | TX-12 | artifact ownership |
| AC-014 | AssetRegistry/Manifest@2 为资产台账；库存条目不等于已入片 | contract/UI tests | wording audit |
| AC-015 | SQLite/read model 不保存可独立重建影片的第二份最终 timeline | schema test | architecture review |
| AC-016 | provider/Runner/worker 只能写 staging/derived，不能直接写 source 或 callback adopt | security tests | permission review |
| AC-017 | 外传/费用必须逐任务授权和留 receipt；unknown cost 不按 0、不盲重试 | provider tests | ledger audit |
| AC-018 | 自动 UI 默认 Headless 静音无干扰；headed/人工分别记录且不得互代 | test metadata | report review |
| AC-019 | 旧 Gate、legacy 入口和回归保留；新架构不追溯改写历史证据 | legacy suite | traceability review |
| AC-020 | M6 只能声明 V1-P0；M7A–D、P0/P1 全证据后才可 V1-Full | report assertion | independent audit |

## 2. 数据与事务契约

### AC-D01 身份

project/shot/clip/track/segment/asset/proposal/materialization/impact/job/snapshot/transaction 均使用稳定不透明 ID。数组顺序可变，不能作为长期 identity。

### AC-D02 时间

所有对外选择使用整数半开帧；fps rational；OpenFilm 秒值只在 adapter 内存在并须往返回相同整数帧，误差不超过半个目标帧。首个已验目标规格 30/1；其他 fps 未验即 capability blocked。

### AC-D03 内容寻址

资产、source manifest、proxy、render、证据都记录 SHA256。文件路径不是身份，客户端永不提交服务器绝对路径。

### AC-D04 原子可见性

多文件 source 不能靠“依次覆盖”声称原子。先完成不可变 snapshot，再原子改变单一 commit record/数据库指针。混合 revision 的读取是致命缺陷。

### AC-D05 幂等

幂等范围为 project + operation kind + key；缓存保存 request digest 和完整响应。同 key/digest 重放；同 key/不同 digest 409。callback/event 重试不得触发第二次 commit。

## 3. 安全契约

- 认证/Origin 在资源查找前执行；错误不泄漏其他项目。
- 所有路径 canonicalize/realpath 后验证允许根，拒绝 absolute、`..`、symlink escape、设备路径。
- scene/worker 无 Host secret、无通用 FS、默认无网络；需要网络以 capability allowlist 开放。
- 上传有 body/metadata/file/time/stderr/process 上限；中断及时清理。
- 日志/evidence 不含 bearer、API key、原绝对路径、私有内容正文；安全扫描报告不回显秘密。
- 资料文本始终作为数据，不作为系统/工具指令。

## 4. 兼容与演进契约

- 保留现有 `/api/projects/:id/edits`、导入、proposal 和 legacy 测试，除非独立 versioned migration 和用户批准。
- OpenFilm 固定完整 SHA；升级需独立 ADR、补丁 diff、许可证和全 adapter/native/recovery 回归。
- Manifest@2 不因 engine 迁移偷偷加字段；engine binding/commit metadata 用独立 sidecar/schema。
- API 错误兼容通过 alias/version 实现，禁止同一 code 在不同版本表达相反语义。
- 删除 Hypit/legacy 是 V1-Full 后的独立决策，不在 M2–M7 默认授权内。

## 5. 契约变更程序

1. 新建 `CR-*`，说明触发事实、PRD/UX/安全/数据影响和备选方案。
2. 新建/更新 ADR，列出可逆性、迁移/回退和被影响 AC ID。
3. 先更新本锁、API、追踪和测试计划；新增失败测试。
4. 内部从架构、实现、体验、验收四角审查，无重大项后请求用户批准。
5. 实现、真实验收、冻结 commit、独立外审；修复后重新冻结。
6. 在 contract changelog 记录旧/新版本与生效阶段。

未完成以上步骤时，偏离项状态为 `ARCHITECTURE_DEVIATION_BLOCKED`，不得合并或通过 Gate。

## 6. 架构 fitness functions

M2.1 起在 CI/`pnpm check` 加入：禁止 UI→host/adapter imports；禁止 production→spikes；枚举 port 不含 commit/任意 shell；所有 native registry entry 有非 unknown 策略；路由开放阶段匹配 registry；schema/type error union 同步；source digest golden vectors；单 engine DB constraint。

后续加入：materialize NOWRITE、snapshot immutability、revision exactly-once、Job lease CAS、SSE cursor、provider callback non-adoption、export snapshot pin、P0/P1 completion assertion。

