# 固定8638ee1只读审查与隔离准备：REVIEW_PENDING

固定输入完整SHA：`8638ee182fd53251b6461904016ddce62b9bc4eb`。本次源/manifest/日志均通过`git show <SHA>:<path>`读取Git对象字节，不把MAIN后续dirty tree当审查输入。MAIN仍唯一writer，本人未改MAIN代码、索引或运行根。

**状态：源码定向修正确认，独立验收REVIEW_PENDING。** 本次尚未执行tsc/build/测试/Studio，没有独立PASS，更不签A05/A或人验。

## 固定字节及发现状态

created-native-workspace-evidence.json的7source_hashes与9artifact_hashes逐项比对该commit实际对象：16/16 hash一致，见manifest-check.json。evidence.json是该冻结manifest的逐字节副本。MAIN日志regression-r5.txt确有8files85/85、275.65s，仅标MAIN内部执行；本次没有重跑或扩大它。

N-R1撤回保持：当前依赖runtimeRoot在mkdir前沿现有ancestor校lstat/realpath；初始constructor后简单alias污染推断错误，不要求按误报改生产。N-R2修正已在固定对象：cached verify及诊断await后#check(binding)才返回。N-R3修正在固定Supervisor：真实#start之后、HTTPopen之前，以及实际open响应后重新targetRootOf并比对本次captured root，closing同样复验。

测试边界如固定manifest明确说明：新增case验证cached关闭窗口、同commit cache损坏重建后的root身份变化；不是合法新revision adoption竞争。新public created Gateway delegate、真实loaded ack、Run/assembly/Delivery均未交付，不把内部native working copy当完整工作台。

## 已实际完成的隔离准备

MAIN随后只授权准备，尚未释放Studio/重型槽。实际exec session10250已terminal exit0：

1. `git -C /mnt/c/workspace/videoworkline/Narralens-agents/main-integration archive 8638ee182fd53251b6461904016ddce62b9bc4eb` 经tar导出到BRIDGE自身目录；未创建共享Git worktree或修改MAIN索引。
2. 在下列source目录执行 `COREPACK_ENABLE_NETWORK=0 corepack pnpm install --offline --frozen-lockfile --ignore-scripts`，exit0，reused262/downloaded0。独立node_modules是真目录，不链MAIN；没有网络补包或换lock。

隔离目录：

`/mnt/c/workspace/videoworkline/Narralens-agents/bridge-observability/var/independent-native-8638ee1/source`

原始archive/install命令、stderr/stdout、exit及preparation.json保留同目录。isolated-source-check.json证明7manifest源码、2依赖源码、package/lock共11份与固定Git对象逐字节一致，安装后lock未变。该source不是Git checkout，身份由Git对象及逐文件hash证明，不能用父BRIDGE旧HEAD冒充8638ee1。

## 待明确资源消息后执行的确切命令

工作目录固定为上述独立source；所有命令raw日志写当前review目录，runtime/profile仅用该source私有var或测试自己的mkdtemp。Readonly pinned vendor沿fixture已批准绝对路径，不改其工作树，不共享MAIN DB/源缓存/Studio状态。

```sh
COREPACK_ENABLE_NETWORK=0 corepack pnpm exec tsc --noEmit
COREPACK_ENABLE_NETWORK=0 corepack pnpm build
COREPACK_ENABLE_NETWORK=0 corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/created-native-workspace.test.ts tests/agent-driven/integration/host-close-lifecycle.test.ts --maxWorkers=1 --minWorkers=1
```

先在隔离目录build生成其自身dist/panel，不借MAIN后续可能变化的构建产物；测试范围11项新workspace+1项共享关闭接缝，共12项，覆盖当前变更，不无差别重复85项旧组合。需要正式native/轻量槽后才能执行；无browser/ffmpeg/headed/网络/J盘/付费计划。缺环境/缺离线包原样报告，不安装替代工具。

目前已明确停在准备完成状态。后续只有MAIN明确授权资源消息才启动上述顺序命令；在真实独立执行、冻结字节仍匹配和日志绑定完成前保持REVIEW_PENDING。
