# 固定8638ee1独立native副本链验证：PASS（限定范围）

**精确`8638ee182fd53251b6461904016ddce62b9bc4eb`的committed snapshot派生副本及内部native启停/版本身份接缝 PASS。** 不签A05/A、公开created UI、真实loaded ack或人验。此前REVIEW_PENDING只读阶段已原样保存在READONLY-BEFORE-VALIDATION.md，只有本次真实独立运行完成后才更新为限定PASS。

## 隔离输入及执行

MAIN继续编辑的新created UI不属于本次输入。本人从上述固定Git对象archive到自身独立目录，没有checkout/reset/修改MAIN或共享其运行根：

`/mnt/c/workspace/videoworkline/Narralens-agents/bridge-observability/var/independent-native-8638ee1/source`

真实准备exec10250：git archive/tar exit0；`COREPACK_ENABLE_NETWORK=0 corepack pnpm install --offline --frozen-lockfile --ignore-scripts` exit0，reused262/downloaded0。独立node_modules真实目录，不链接MAIN；无网络补包、外部工具安装或锁文件变更。7manifest源码+2依赖源码+package/lock共11份在准备后及测试后均逐字节匹配固定Git对象。独立archive没有自己的.git，身份由固定对象及hash证明，不借父BRIDGE旧HEAD冒充。

获MAIN明确Studio资源后，实际exec55515严格顺序运行：

```sh
COREPACK_ENABLE_NETWORK=0 corepack pnpm exec tsc --noEmit
COREPACK_ENABLE_NETWORK=0 corepack pnpm build
COREPACK_ENABLE_NETWORK=0 corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/created-native-workspace.test.ts tests/agent-driven/integration/host-close-lifecycle.test.ts --maxWorkers=1 --minWorkers=1
```

**tsc exit0、build exit0、两文件12/12、tests exit0，54.54s。** 11项workspace与1项共享Host关闭接缝，未重跑MAIN 85项旧组合。真实pinned Studio及Gateway均使用测试独立tmp root；未运行browser/ffmpeg、联网/J盘/付费/headed或人验。自身test/Studio进程退出后已明确释放Studio/轻量槽。

原始archive/install/typecheck/build/tests命令、stdout、stderr、exit均保留同目录。validation-start.json/validation-final.json绑定独立source目录、固定commit、实际句柄及结果；validation-final.json记录六份新建隔离dist产物的bytes/SHA256。未借MAIN后续构建产物，也没有为通过修改测试、断言或源码。

## 固定manifest核验

固定commit中的created-native-workspace-evidence.json：7 source_hashes及9 artifact_hashes逐项与Git tree实际字节SHA匹配，16/16；manifest-check.json和evidence.json留原核验及副本。MAIN r4日志11/11、r5 8files85/85只标MAIN内部执行，本次独立结果严格为上述12项+tsc/build。

MAIN后续dirty tree/新commit不在验证范围，因此没有对MAIN当前HEAD/clean作无关承诺；本验证没有写它的源、索引、dist或日志。源一致性以isolated-source-check.json及validation-final.json为准。

## 发现收口及证据界限

| 项目 | 固定源码与本次独立证据 | 结论 |
| --- | --- | --- |
| N-R1初始alias判断 | 已明确撤回；导入runtimeRoot在mkdir前检查已有ancestor/realpath。实际ctor后父alias的lazy-prepare负向确认snapshot内未创建workspaces | WITHDRAWN，不冒充实修bug |
| N-R2 cached verify尾复验 | cached verify及Host-only诊断await后#check(binding)才返回；本次after_cache_verify开始close，prepare拒绝 | CLOSED（本链） |
| N-R3 Startup/HTTP open root身份 | #start之后/open前以及实际open响应后重新targetRootOf且与本次captured root比较；真实startup gate和本地open-response proxy两负向均拒旧preview | CLOSED（本链） |
| 文件与关闭边界 | 真实HTTP创建、固定snapshot closure→私有FD复制、坏copy/symlink拒并重建、author/snapshot/revision不变、native停后才dispose、late Gateway4监听关停 | 本次独立通过 |

**没有实测合法DB新revision提交竞争。** N2新增用例验证关闭窗口；N3两用例通过损坏cache、从同一真实snapshot重建到新root来验证派生root身份替换，断言原commit未变。active commit tuple漂移的源码#check已读，但不能把同commit cache replacement写成新revision adoption竞争的运行证据。

## 权威、I/O与生命周期结论

prepare从真实TrustedCallerContext校owner、created origin、active commit及project_state/recovery gate开始；flight按project/transaction/principal收敛。新副本只来自CommittedSnapshotAuthority真实reader，不由临时目录声明变成项目事实。保留dir FD、父O_DIRECTORY_NOFOLLOW、leaf regular/NONBLOCK/NOFOLLOW、entry bytes/full stream SHA及完整前后fingerprint；目标wx不覆盖。cache损坏时只有真实snapshot重新证明才重建，不推进项目revision。

实际Node Studio写.film只在派生copy；测试真实打开后author/snapshot根仍只有原film.html，bytes和commit未变。旧copy在native消费者停止前继续held，不以重建动作删除正在使用的目录。准备/lookup均重验当前binding；Supervisor把本次root身份与启动前后/open前后对应，漂移不发布旧preview。未知/未prepared工程不回退author root。

app.close先停copy I/O并等待operations，Supervisor close等待startup/open inFlight，late onStudio Gateway publish遇Host closing会关闭局部Gateway；已确认native停后再关Gateway、dispose副本/FD。实际4监听关闭与并发Host close均本次独立通过。

## 明确保留的交付边界

此PASS仅为**固定8638ee1的派生副本链和Host内部native startup/open/close接缝**。prepare/rootFor仍Host-only，不代表公开created工程工作台已启用。owner/project/Host代际绑定的ScopedGateway delegate、原生Studio实际loaded-version ack、完整UI读合同及面板、Run/task/local assembly/adoption、正式render/QC/Delivery仍不由本报告证明。

没有实际授权人类视频/中文录音、成片/双导出、整A恢复或人验；native ack保持unknown，不能用Host revision或.film/id伪填loaded。之后新实现须另绑SHA，不能据本次12项把整个A阶段标通过。
