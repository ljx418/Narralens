# Wave 2 组合冻结候选

状态：`WAVE2_EDITABLE_ADOPTION_READY`（独立组合外审 PASS：BLOCKER=0 / MAJOR=0）

## 1. 绑定

- 分支：`migration/m2.2-coordinator-persistence`
- 组合候选提交：`f0a558e492884651935c6c2f67e1bc10be1f9ce0`
- 组合候选 tree：`5b8604942e3d51a71936f46aabcb3881564f042a`
- 最后生产实现/完整捕获提交：`0f67594866582770b4ffb06e1af18d797344ceb0`
- `0f67594..f0a558e` 的 `src/`、`contracts/`、`package.json`、`pnpm-lock.yaml` 差异：空
- origin/main：`304c89134fdf9f834f7d69e3f4d5c89a68044c60`
- OpenFilm 上游：`e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3`
- Hypit 上游：`6fdd8c0f02c17b9970aee6deb4550a70e9d57acf`

## 2. 模块证据与独立外审

| 阶段 | 捕获/候选 | 独立外审 | 当前结论 |
|---|---|---|---|
| W2.0 | `docs/evidence/WAVE2/evidence-manifest.json` | 随 M3 组合复核 | 兼容层关闭；历史聚合失败如实保留，不作为当前组合绿灯 |
| M3 | 捕获 `f2a41ff...` | `reviews/external-review-m3-final-2026-10-20.md` | PASS，BLOCKER=0 / MAJOR=0 |
| M4A | 捕获 `6172751...` | `reviews/m4a-external-review-claude.md` | PASS，BLOCKER=0 / MAJOR=0 |
| M4B | 捕获 `25df0cb...` | `reviews/m4b-external-review-claude.md` §11 | 第十轮 PASS，BLOCKER=0 / MAJOR=0 |
| M4C | 实现/捕获 `0f67594...`，候选 `c67b162...` | `reviews/m4c-external-review-claude-round3.md` | PASS，BLOCKER=0 / MAJOR=0 |

每份阶段 manifest 与外审均保留自己的声明边界；组合候选不把后续代码导致的 current-tip historical gate 非零
改写为绿色。历史证据的职责是证明其冻结树，当前组合门的职责是证明最新树上的集成回归。

## 3. 当前 tip 组合回归

Codex 在工作树干净的 `f0a558e...` 上实际执行：

```text
corepack pnpm check
exit 0
84 test files / 1040 tests PASS
Python impact golden: 8 vectors / 0 failures
production vite build: PASS, 31 modules, 959 ms
duration: 4377.53 s
```

该次命令的逐段终端输出保存在本次编排会话中，没有伪造为仓库内的原始日志；因此它是当前 tip 的独立
复验记录，而不是新的 append-only capture。可追溯的冻结原始日志仍是
`docs/evidence/WAVE2/logs/0f67594866582770b4ffb06e1af18d797344ceb0/`：其中同样记录 84 files / 1040 tests、
黄金向量和生产构建 exit 0。两次运行之间生产代码和合同无差异，只有外审文档、case 证据文字和收紧后的
`document-status-fitness.test.ts` 发生变化。M4C 外审曾复跑 25 个定向测试；组合外审另行复跑收紧后的 2 个
document-status fitness、21 个合同测试以及当前 tip TypeScript，均 exit 0。

媒体与上游复现边界：固定 OpenFilm checkout 位于仓库外
`/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b`，固定 SHA 如 §1；900 帧媒体夹具由测试 harness 在隔离目录
生成且被 `.gitignore` 排除，不把未跟踪媒体冒充仓库产物。若换机缺固定 checkout 或 ffmpeg/ffprobe，相关真实媒体
case 必须记为 `BLOCKED_ENV`，不能降级为 mock 或跳过后仍宣称通过。

## 4. 组合不变量

1. 一个项目只绑定一个引擎；Hypit 不与 OpenFilm 双写。
2. OpenFilm 是目标原生可编辑工程，迁移、采用、恢复后仍是三个独立原生 clip，不以扁平 MP4 冒充。
3. `ProjectCoordinator` / controlled adoption / history restore 共享 Host 串行边界、三类锁、source/currentness、
   snapshot、journal、outbox 与 revision exactly-once 约束。
4. materialize 只产生 proxy/native plan/lineage，不写 author source 或 revision；impact 只生成 15 分钟授权；
   adopt/restore 才能在显式 approval 下受控写入。
5. 取消后的晚到结果不自动采用；恢复旧内容生成新 revision，不回拨 pointer；所有导出仍须绑定 committed snapshot。
6. native timeline/Inspector/import/history/undo/redo/provider/CLI 均须 translate 或 block；未知 operation fail closed。
7. 外部路径、symlink/junction、跨项目 snapshot、未知 projection、rights/asset/source drift 均 fail closed；
   瞬时资源错误不冒充持久 drift。
8. 自动化为 headless、静音、loopback、无窗口、不抢焦点；headed/human 仍为 `NOT_RUN`。

## 5. 允许与禁止

独立组合外审已在 `a038e4a...` 上以 `BLOCKER=0 / MAJOR=0` 通过，本候选已提升为
`WAVE2_EDITABLE_ADOPTION_READY`；下一允许阶段为 M5 同页 Studio UX 开发。

即使组合外审 PASS，仍不得声明 Gate D4.2、Gate V1-P0、V1-Full、完整同页 Studio、生产 render、长片性能或
headed/human 已验。M5 的人工体验门和 M6 的交付视频门必须分别用自己的真实证据关闭。
