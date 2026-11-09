# 冻结cb44422 本地输入链独立验证：PASS（限定范围）

**本批Host-only本地素材登记及私有blob准备链 PASS。** 冻结输入为实际MAIN `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration` 的完整提交 `cb444229e37d7503daf13c5fd886ea2bfb7d5fd2`。前置源码提交为`a8e020452d2ee49e65d977b79d8cfe3f2d24aa97`，到cb44422只有文档后续，src/tests无差异。input.json、final-state.json记录前后HEAD相同且status空，最后capture UTC2026-11-09T19:55:15.485171。

本人未参与本批MAIN实现，仅只读审查及在MAIN实际依赖上执行已授权验证；日志/报告仅写BRIDGE自身目录。MAIN在本次验证期间冻结源码及测试。未启动浏览器、网络、模型、J盘或新增其他生产入口。

## 本次独立实际命令

同一exec session14888，严格顺序：

```sh
corepack pnpm exec tsc --noEmit
corepack pnpm exec vitest run tests/agent-driven/integration/local-assets-host.test.ts tests/agent-driven/integration/product-sqlite-repository.test.ts tests/agent-driven/integration/host-close-lifecycle.test.ts --maxWorkers=1 --minWorkers=1
```

类型检查exit0；测试3files33/33，exit0，70.03s。其中真实Host localAssets23、真实SQLite repository9、并发Host close1。授权本地ffmpeg生成蓝色视频/音调及probe/full decode仅执行这一批，静音无窗口。typecheck/tests的.cmd/.stdout.txt/.stderr.txt/.exit全部原样保留；SQLite experimental warning不是失败。

本次进程terminal后自身vitest worker已退出，测试中的媒体取消/timeout/关服断言确认对应媒体子进程真正关闭。已通知MAIN释放独占资源槽，之后MAIN变更不属于本报告输入。

## 发现收口与冻结复核

| 发现 | 精确修法与验证范围 | 结论 |
| --- | --- | --- |
| L-R1 storage静态配置未排snapshot | mkdir前canonicalLocation核已有祖先及storage对projects/snapshots/input双向重叠；App传真实SnapshotStore根；实际snapshot alias配置拒且不创建目录 | CLOSED（本链） |
| L-R2 exact keys漏source | #row恢复合法source字段并保留全fact/core/registration digest与ID核验；本次实际list/replay/resolve/并发通过 | CLOSED |
| L-R3 source根漂移 | 固定canonical source/dev/ino，保留source fd、逐层NOFOLLOW walker，并在复制前后/SQL末核根；替换source根即使hash正确仍拒 | CLOSED（本链） |
| L-R4 storage父alias先写snapshot再拒 | source/root/objects/staging保留真实dir fd；实际stage/link/cleanup走Host /proc fd路径。两个before_stage_create/before_publish实际alias race断言snapshot names/film bytes不变及staging清空 | CLOSED（本链） |
| L-R5 ctime fallback重hash缺读后ctime | fallback完整sha+fingerprint(current)===fingerprint(post)，基于fallback开始时而非旧proof；不通过忽略bytes/ctime放宽并发 | SOURCE_VERIFIED；本次并发/篡改成功负向通过 |
| L-R6 leaf打开后realpath异常未显式close | leaf变量在open成功立即持有，任何失败catch以allSettled关闭leaf+parents，仅成功return转交；成功import外层多层finally即使leaf close异常仍清parent/staging | SOURCE_VERIFIED；没有专门独立重现旧unlink时隙 |

L-R6修正不存在未转交leaf依赖GC的旧异常分支；本次没有为了该局部清理另建模块gate或伪称跑过专门旧race。其余初始发现和MAIN失败capture均在预审/manifest保留，不覆盖为历史PASS。

## 事务、权利与文件边界

登记要求可信brand+trusted_ui channel/source+同owner已提交created工程，普通authenticated/native不能登记权利。canonical复制输入并冻结caller防异步篡改；同key实际原ledger digest绑定input/principal，回原response而不重读后来已删除源，不更换key重试。旧OperationIdempotencyStore、catalog/outbox共用同一RevisionStore连接，没有第二DB/第二command authority。

catalog不可变DDL namespace在初始化及schema_version变化时独立核验；最终SQL原子写catalog+原ledger回执+业务outbox，fault点全部回滚；未引用blob仍为缓存不自动成为素材。截断asset/right ID核完整registration digest及完整core，不能靠短ID碰撞覆盖权利。源fd复制及blob验证实际hash/fingerprint，先fsync/no-clobber link再SQL；后续读取须重新hash。

retained private目录阻止父路径alias把本服务写入重定向到author/snapshot；Host关闭先abort并等imports/resolves及实际媒体child close，再关directory fd和同DB。capacity确实最多2active，queued cancel移除且不泄slot。test hooks仅观察/注入边界，不替代真实fsync/codec/decode。

视频codec来自实际probe；视频含audio时也严格全流decode，损坏audio不能靠video-only旧validator混过；音频唯一audio stream，时基直接转project frames，不先round展示毫秒制造额外帧。录音来源synthetic/unknown及license unknown/restricted保持事实，不因字节成功自动cleared。Derived lineage限本project catalog。绝对存储/输入路径不进入LocalAsset回执，URI限无secret的http(s)来源声明；内部resolve路径仍为Host-only消费，不是新任意路径MCP入口。

## Manifest字节验证

`docs/execution/A/local-assets-evidence.json` 的5source+52artifact，逐项比较manifest SHA256/bytes、`git show cb444229e37d7503daf13c5fd886ea2bfb7d5fd2:path`冻结字节以及当前工作树：**57/57一致**。详细evidence-check.json及本报告日志hash见artifact-hashes.json。

manifest base d15e44d/capture_dirty:true是提交前捕获事实；本次冻结验证前后均clean。MAIN final23/tsc0/scanner511files0 findings、leaf清理前组合44、R6 runtime/context通过但总capture因1import失败，均如manifest说明，不合并成全部独立重跑。本人独立结果只为上列33+tsc。原keys漏source的3项失败、hardlink unlink ctime的1项失败未删除，未改断言掩盖。

## 限定范围

本批测试经真实Host创建工程，再以Host-only服务接口和测试mint的可信context登记素材；它不是生产UI上传/选材/权利确认入口的验收。诊断蓝色视频和400Hz sine明确synthetic，不证明用户真实授权视频、真人中文旁白或人验。

运行入口新增允许源根配置不等于媒体制作capability ready；Instance仍诚实degraded/缺producer。素材准备不写author/snapshot或推进project revision，实际Run/task/native assembly仍未在此批接线。没有正式encode/export/Delivery、整A回归/T20/native UI载入或A人验结论。

因此本报告只签本冻结local-input链，**不签完整A05/A，不签装配或真人事实**。后续实现须另绑SHA，但无需将本次已通过模块无差别重新跑一遍。
