# M4A Codex 返修内部审查

状态：`BLOCKER=0 / MAJOR=0 / MINOR=0`（独立外审仍待下一会话执行）。

## 返修范围

仅关闭 Codex 对冻结候选 `803a7959a8c1f50de6438f9e0db2caf697314f0a` 的两项发现：

1. impact 落库后真实 `film.html`/资产/rights 漂移仍可通过 `requireCurrent()`；
2. 直接消费在 TTL 边界把 `active` 错记为 `stale`，而不是 `expired`。

没有开放 M4B/M4C 路由，没有增加 EnginePort 方法，没有改变 author source、revision、snapshot 或
materialization 的写入权威。

## 四视角复核

### 架构与契约

- 消费重验复用 `ActivatedProjectionService → EngineRegistry → pinned EnginePort.inspect`，未复制 OpenFilm parser；
- 资产与 rights 重验复用 `MaterializeService.read()`，未新增第二 inventory/rights 算法；
- TTL 仍使用注入时钟，`now >= expires_at` 执行 `active→expired`；
- TX-02A 仍为 `INTERNAL_EVIDENCED_SUBSET`，真实 commit-time 竞争继续属于 M4B。

### 实现与并发

- replay 与直接消费都会在已证明漂移时 CAS `active→stale`；
- 只有 `IMPACT_STALE` 会终结 impact；可重试 503 不会被误写成永久 stale；
- 源字节在 inspect 后、未来 commit 前再次变化仍需 M4B 在同一写入边界做最终重验，本轮没有越界宣称关闭。

### 完整体验与安全

- 所有新增验证 headless、静音、无窗口、无焦点抢占；
- 未访问网络、provider、付费接口或 `J:\`；
- 错误响应沿用既有 428/503 合同，不增加路径、adapter 类型或凭据泄露。

### 测试真实性

- `film.html` 与 ledger 引用资产均在 impact 创建后修改真实文件字节；
- rights 用 ledger 事实变化驱动 `MaterializeService.read()`，不是直接改 impact/materialization 摘要；
- TTL 测试直接调用未来消费 seam，而不是只走 replay；
- 瞬时失败通过生产对象的 inventory seam 注入 recoverable 503，并断言 impact 保持 active；
- 旧的数据库字段变异用例全部保留，未降低断言或延长测试超时。

首次干净证据捕获 `002461b...` 在 `maxWorkers=2` 下第一轮出现一次未结构化的 503（849/850），同提交
第二轮 850/850、独立 M4A 98/98。失败目录完整保留。后续捕获将 worker 降为 1；这不删除测试、不延长
超时、不改变断言，只隔离多个独立 Host、ffmpeg 与 135 MB fixture 的聚合资源竞争。NW01 断言同时增加
响应 body 诊断，若再次失败不会只留下状态码。

## 已知边界

- M4B 写入口尚未实现，因此 impact 重验和 commit 之间的最终竞争仍未关闭；
- restore_snapshot 仍 capability blocked；
- headed/human 仍为 `NOT_RUN`；本阶段没有 UI。
