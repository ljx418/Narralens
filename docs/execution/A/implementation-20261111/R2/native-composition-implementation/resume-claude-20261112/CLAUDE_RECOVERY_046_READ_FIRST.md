# 046 用户授权的工作空间整理与Claude干净上下文恢复

用户已明确要求：清理项目工作空间、由MAIN恢复ClaudeCode工具调用后继续剩余测试修正与验证。旧ctx_ae73a82c85e9已通过Orca guarded stop确认process_stopped/liveness exited，再worker-release封存transcript；另两个已退出的旧Claude窗口ctx_297f7b8da2e1/ctx_b4086093cd96已释放。没有改供应商/模型/凭据/配置，没有reset/stash/删工程、证据或临时fixture。

## 新Claude首次接手只读门

使用相同task_5dcbe8192764、同工作区 /mnt/c/workspace/videoworkline/Narralens-agents/main-integration、branch agent-driven/main-a-integration，HEAD e2eff61b464d75d36598103d718cd2a75db5dfda。当前dirty必须保留，index必须空；AGENTS.sha256=37300463a72a612ae16e0a5fcfb496502c57c722b83781e0e2e8c9480594542b。不要恢复旧上下文的MiniMax异常工具文本。

**这是最新覆盖入口：所有历史021..045源码与runtime许可启动时暂停。先只读工具probe。** 用声明的Bash工具执行 python3 -c "print('NARRALENS_TOOL_CHANNEL_OK')" ，然后通过Bash读本文及CORRECTIVE_TEST_AND_RUNTIME_045.md/json和BATCH_045_FOCUSED001_MAIN_VERIFICATION.json。可只读核对git HEAD/status/index、protected AGENTS、最后045focused001.inputs.json与当前全部626文件hash。不得读用户配置/凭据/env、不得联网/安装/启动业务服务/浏览器/media/build/test，不得修改源码和索引。

先向MAIN报告真实工具probe exit、当前HEAD/branch/index/hash匹配与当前新Dispatch身份。**收到MAIN单独重新激活045之前，不继续编码/测试。** 工具仍异常如实TOOL_CALL_FORMAT_BLOCKED，不输出伪工具结果，不自动重试相同损坏格式，不擅自换供应商。

## 真实已有进展与唯一剩余修正

静态044-static003已53PASS；045focused001真实14PASS/1FAIL/16filtered，所有原始失败保留。唯一失败Q01 service registration cleanup用例在末尾调用f.productionLease()，工程root此前被测试移走，fixture重新取lease先同步REVISION_CONFLICT，没到真正production。真实非film scenes页已提供window.film.frame并已绘制通过，不能再删除该负向验证。异常MiniMax文本说Restore analyzer未执行且禁止执行；gate现为a4f1d676e8a246cc79cf5de6547e7df23a0298941132c6ded34bea7155b400b2，保持。

后续MAIN激活范围仍只有witness测试中的该oracle：在破坏root/注册之前保存真实lease，用保存的真实lease验证清理不确定后的拒绝，精确依据生产先后顺序，不伪造lease、不改生产、不接受任意throw。代码实现由新Claude独占，MAIN只设计/复核。当前witness文件SHA 4e24ec70a59498787734f33e11fd94a2124685f9d63100d2be7aeacc6abe3949。

下一可用capture045-tsc-002/045-focused-lifecycle-002，前提MAIN激活且路径不存在。重点15项全绿才允许045-native-cache-full-001，其它suite/full/build/mutation仍未放行。新429立即停，不自动重试、重启或Codex接手。无A/V1/原17项通过声明。

## 用户后续补充：平铺

Orca9工作区已全部no-parent，无任何children。所有后续Agent复用当前平铺实施区，禁止new-child/新worktree套娃，参见主文档仓docs/WORKSPACE_LAYOUT.md。旧writer已process_stopped/exited且released，当前新writer须MAIN登记新Dispatch后才有权限。
