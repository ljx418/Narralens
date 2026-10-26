# Wave 2 组合独立外审

结论：`PASS`；`BLOCKER=0 / MAJOR=0 / MINOR=15`。允许声明
`WAVE2_EDITABLE_ADOPTION_READY`。

## 绑定与复验

- 分支：`migration/m2.2-coordinator-persistence`
- 审查 HEAD：`a038e4a6cc48a7d09c240318da3ec1068e0e8bcc`
- origin/main：`304c89134fdf9f834f7d69e3f4d5c89a68044c60`
- 工作树：审查前后 clean
- `0f67594..HEAD` 的 `src/ contracts/ package.json pnpm-lock.yaml` 差异：空

独立审查亲自复跑：M4C integrity 22/22、M4B historical 8/8、M4A historical 6/6、Wave 1 historical
8/8、Wave 2 fitness 45 tests、当前 tip TypeScript、document-status fitness + contracts 23 tests，全部 exit 0。
未重跑 73 分钟 `pnpm check`；审计了 `0f67594...` 的 tracked 84 files / 1040 tests 原始捕获，并证明当前
生产代码/合同与该捕获逐字节一致。Codex 另在 `f0a558e...` 实跑当前 tip 的 84/1040、黄金向量和生产构建全绿，
但未把编排终端输出伪造为 tracked raw log。

## 组合裁决

单引擎/无双写、同一 Host 装配、materialize/impact NOWRITE、adopt/restore exactly +1、锁/rights/source/hash/
snapshot/journal/outbox/idempotency 的单一权威、三原生 clip 与真实 900 帧双导出、native 入口 translate/block、
真实进程丢失与路径/symlink/stale/rebased 负向边界、权威文档和证据无选择性摘绿，九项均 PASS。

## MINOR 处置

- 已在组合签署提交修正：Wave 2 read-first 基线、TX-13 证据过度表述、组合媒体/upstream 复现边界、组合状态与
  document-status fitness 同步、两组测试计数分开表述。
- M4C manifest 的 `review.external=REVIEW_PENDING` 保留为捕获时事实；第三轮外审与本组合报告是后续签署，
  不回写或重算冻结 manifest。
- 转入 M5 必须关闭：生产锁 API/持有者展示；undo/redo 必须明确显示“生成恢复意图”而非假装已撤回；同页状态不得
  依赖 legacy `pnpm recover`；UI 必须解释 permanent attention、500 粘滞幂等键并提供安全的新请求动作。
- 有界接受且不在 M5 重写：legacy canonical JSON 技债、legacy journal/visual_locked 历史权威、asset.import 未经
  NativeWriteGateway 的既有专用 Host 路径、早期 W2.0/M3 捕获缺 interaction 元数据。它们不得扩张到新 M5 代码。

## 声明边界

不得据此声明 Gate D4.2、Gate V1-P0、V1-Full、M5/M6、生产 render、长片性能或 headed/human 已验。
