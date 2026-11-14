# N1N2 021 候选：最终逐项结果、命令、摘要与 cleanup 限制

候选 = 14 个 N1N2 候选文件 + 1 个 D1 回归文件（031 授权）。HEAD `e2eff61b464d75d36598103d718cd2a75db5dfda`；git 索引空；
`AGENTS.md` `37300463a72a612ae16e0a5fcfb496502c57c722b83781e0e2e8c9480594542b` 未动。
唯一编译捕获（最终字节）：`n1n2-claude-021-tsc-020` exit=0、空日志、source_changed=[] source_added=[]（001..020 全部保留）。

## 1. 最终候选哈希（15 份；逐字备份在 source-captures/，INDEX.json 十代候选）

776331d6397191ee7fc97a4859f8d3ff95031efaf2d4fe7a7ee875451d85eb30 src/host/agent-driven/retained-native-closure.ts
85b1e804b3956165a6f8e171aa1fb8800cd8337290ad2d16ac05d3906ba2501a src/host/agent-driven/native-cache-witness.ts
32d5adae9d737b6799f20531e50956413a619e048a8f2f225fccb064205afbd2 src/host/agent-driven/created-native-workspace.ts
f00e02781c8531a74a1034a6a1c992c463f49ff1cbf9c49b203e8449d8360d7d src/host/agent-driven/created-native-source-reader.ts
1c53360e3c618c603cfcbe61d0c2d57004c5bd33dc26a92c2fdec72a1844bd6d src/host/agent-driven/committed-snapshot-authority.ts
19110e45a83b6d5b611b4260620ce873f923f1e5a5b907bc6176c4b734fbeed3 src/host/m5/openfilm-native-expected.ts（受保护，未改）
29a0827a6130c2f382de93d1738b1be003c5ef15ded253d256585e6214d2aa69 src/adapters/openfilm/openfilm-upstream.ts
eb5c71c99b749509b304bc925ec47469099f1049746e63f145ae851c6281bcb1 tests/agent-driven/integration/native-cache-witness.test.ts
8d740f83883fd42c13f8e0e2ea63bee406f8d9edf19ea02a1005c72e26616e60 tests/agent-driven/integration/created-native-source-reader.test.ts
7160a285930e61b7927d90bb517e7d9575f5f0888394d228b192baff80daf622 tests/agent-driven/integration/helpers/native-source-fixture.ts
59788a8f9c08415a808b2418e86b4dac6bb7de65297ad5d1cb19b5f26eb22d27 tests/agent-driven/integration/helpers/created-draft-fixture.ts
439d469032c9af2b83ceb826e0aead7cf5c2fe5c5693be7cbf18c8e67f0f615f tests/agent-driven/integration/created-native-workspace.test.ts（受保护回归，未改）
bfd0c6373b254050d32a6a99e7b6f8b9827dc24b6b2587515ab4c5aad2cd9037 tests/agent-driven/integration/committed-snapshot-host.test.ts（未改）
5f50db85c7c07a2ecf4faefc20ec2ec6c7ad4910fafe549c2edc76bbad729c7c tests/agent-driven/integration/created-native-ack.test.ts（未改）
684df1c287890a13ecd8b08a4cd32d5053c2868e80494eca2fcc6412cdc4e0b6 tests/agent-driven/integration/created-draft-processor.test.ts（031 修正）

## 2. 逐项运行结果（全部经 run-recorded.py；每步的 result 在独立工具步骤读取）

| 步骤 | capture | exit | 实际结果 | 日志 SHA256 | 用例字节 |
|---|---|---|---|---|---|
| P08 | n1n2-claude-021-run-P08 | 0 | 1 passed / 15 skipped | d40a71d10ff08ae6215ad0ca4afff93e72974ffb13338d964a0a567750c19575 | 028 |
| A3c | n1n2-claude-021-run-A3c | 0 | 6 passed / 10 skipped | ecc5adcb72017832d245cf40e22a8918b609c00fcf01aaf1012e72c450e5ad3e | 029 |
| B1 | n1n2-claude-021-run-B1 | 0 | **88 passed (88)** | 685e1523386e4b56b5063e6f3ca1f10907ba73e6226f59757f13539a86e9df64 | 029 |
| B2 | n1n2-claude-021-run-B2 | 0 | **16 passed (16)** | 88ee6dbb8ffcd141b8e7f59188bac613adbdfba6573c66c0467fb79a22e45a06 | 029 |
| C1 | n1n2-claude-021-run-C1 | 0 | 11 passed (11) | d3cd7e9feaa2c54b9f53c7cd59880ccd2650c6a5f39ab9abb566cf3f596f2c1f | 029 |
| C2 | n1n2-claude-021-run-C2 | 0 | 11 passed (11) | a4c5c65b5dcd10c39b6aa8824f657c4c116f9ae5e6ac86703292ec99b71a747e | 029 |
| C3 | n1n2-claude-021-run-C3 | 0 | 85 passed (85) | f9a25574b242cdba126d89ef3fb231baaa167743a5235a127bc1ff9c655632e2 | 029 |
| D1（修前） | n1n2-claude-021-run-D1 | **1** | 1 failed / 6 passed | 7e212802821a7fe665de341b6fb03ba01682b7ecbca304262e03e38f5acff593 | 028 |
| D2 | n1n2-claude-021-run-D2 | 0 | 36 passed (36) | a0ae19656ebe74cecf63f7acf6ab13bb2e6957a326f260331a586f4855ecd5ea | 028 |
| D1b | n1n2-claude-021-run-D1b | 0 | **7 passed (7)** | 57a061dc301e77c43b2c519707c7bb97dfe20f1b64585e541de975e0c6f5ef2d | 031 |
| D3 | n1n2-claude-021-run-D3 | 0 | 50 passed (50) | 48eb9736ff6076a5e78c677994ac382ca1ff95bc34dab28d6979b65b6182e8f3 | 031 |
| D4 | n1n2-claude-021-run-D4 | 0 | 33 passed (33) | d8ed6f9754dff654b5ced231c828d1d2d974336ea5bea407f25c89c0952e2cd5 | 031 |
| D5 | n1n2-claude-021-run-D5 | 0 | 14 passed (14) | 435246bdc3c3fe86c80ab59e9ba6c878af27cb4bdc85ec29d2f8e8f75da2a5bc | 031 |

全部步骤 `source_changed=[] source_added=[]`（无输入漂移）。
**每个文件的回归都在其最终字节上执行**：029 的 14 个文件与最终候选逐字节相同，031 只改了 D1 测试文件 ✔。

### 2.1 过程偏差（如实披露）
D1 失败后，我本应停止余项，但把「读 D1 结果」与「启动 D2」写在同一条命令里，**D2 在 030 的首失败停余项条件之外被启动**
（runner 2433169 / vitest 2433295）。D2 正常结算并清理了自己的资源，其 capture 为真实记录。此后所有步骤均改为
「启动 → 独立工具步骤读取 result → 独立启动下一步」✔。

### 2.2 D1 的基线既存漂移（已闭合）
`created-draft-processor.test.ts` 的期望自 `9f58323`（2026-11-11）起就少了 `concept-s1`，而同提交让
`prepared-draft-verifier.ts:219` **要求**该 id ⇒ 陈旧的是断言。031 修正为合同的原生顺序
`['concept-s1','shot-s1','shot-s2','shot-s3','narration']`（固定 parser 的正文顺序：概念段在前），并从**实际产出的 film.html**
证明 shot-s1 的 video 与 concept-s1 的 iframe 是各自独立的 clip、路径与首镜时间（按数值 31/30 比较）✔。
**未删概念层、未改夹具或生产行为** ✔。

## 3. cleanup 限制（实测，非全机独立不存在性断言）
无 chrome/chromium/ffprobe/ffmpeg/vitest 残留（仅 IDE 自带的 playwright-mcp，etime 22h+，先于本轮）；
`/tmp/narralens-n1n2-film-*` 今日新增 **0** 个，历史 **170** 个（Nov 12）未删未改（只记录归属）；
上游 headless browser 由每个用例 finally 的 `owner.close()` → `closePageFrames` 关闭；
页面 origin 由 `server.close()` → `await serving.drain()`（上游真实结算，含其真实 ffprobe 探测 promise）→ 关连接；
无裸数字 FD 重试、无全局 kill、无本轮遗留临时目录；git 索引空、HEAD 未动、AGENTS 未动；
未 add/commit/reset/stash/checkout/push；未联网/安装/付费/J 盘；未改配置/凭据/provider/pin；未 build/全量/迁移。

## 4. 尚未关闭的事项（不因上述结果而关闭）
- **原 17 项验收账本**与**冻结外审**未关闭；本候选只是内部运行证据（`N1N2_INTERNAL_EVIDENCED` 级别）。
- 两条 60–180 秒中文有声 A 影片仍 **NOT_RUN**：本轮素材只是本地合成的诊断媒体（无声或合成音），不冒充 A 影片。
- 未接 NativeAck / Studio / Context / selection DDL；未宣称 loaded 或 Ack 落行。
- D2 的越条件启动仍在案（见 §2.1），需 MAIN 处置。
