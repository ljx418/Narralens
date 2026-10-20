# M4A 独立外审

审查状态：`M4A_EXTERNAL_REVIEW_PASS`  
审查方式：全新、无会话持久化、只读 Claude Code CLI 会话；禁止写入、提交、reset、stash、push、联网与付费调用。  
实现与正式捕获提交：`617275139d41171997616e65c121fdb5fa389bbe`  
证据封存提交：`62a737cd4a3d4c35840f5c20da067a46cad386da`  
分支：`migration/m2.2-coordinator-persistence`  
审查日期：2026-10-20。

## 独立执行结果

- `corepack pnpm test:wave2:m4a`：exit 0，8 files / 101 tests；
- `corepack pnpm evidence:wave2:m4a:integrity`：exit 0，`checks_failed=0`；
- `corepack pnpm test:wave2:fitness`：exit 0，3 files / 44 tests；
- 审查前后工作树均 clean，HEAD 未变化。

## 关键结论

此前外审 MAJOR 已关闭。Impact 创建的最后一道 materialization currentness 通过
`MaterializeService.read()` 重新验证 ledger、rights 与 source，而不是用 raw store 绕过。`after_graph`、
`after_locks`、`before_insert` 三个 rights-drift 故障点均返回 428，使 materialization 进入 stale，且不产生
impact row。测试具备变异敏感性：只改变 ledger、保持 materialization row 不变时，旧 raw-store 行为会返回 201。

锁的首检/终检、TTL、CAS、幂等、M4A no-write、OpenFilm changed-malformed source 分类、路由关闭边界与失败捕获
保留均与实现一致。TX-02A..05A 继续保持 `INTERNAL_EVIDENCED_SUBSET`，没有越权声明 M4B/M4C/Wave 2 或 V1 Gate。

## 分级

- BLOCKER：0；
- MAJOR：0；
- MINOR：3；
- NOTE：4。

三项 MINOR 均为证据门/历史文档强度：expected-failure 语义未强制、缺摘要可跳过、manifest 为 current capture
单槽位。前两项已在外审后加严；第三项由追加式 capture 目录与 Git 历史提供不可变追溯，不改变现有证据结论。
历史文档中的 1 MiB 与“revision 0 增长”字面错误也已同步为真实 64 KiB 与“revision 零增长”。

## 声明边界

本结论仅关闭 M4A 外审。未声明 M4B、M4C、Wave 2、Gate D4.2、Gate V1-P0、V1-Full、M5、M6、headed 或
human 体验通过。
