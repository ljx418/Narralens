# PRODUCT NativeExpected 生命周期修复（MAIN精确释放）

## 基线/所有权

本票为新Claude实现任务，非429后Codex接手授权。用户报告Claude额度恢复，A实际开发授权继续有效；若新Claude调用429，立即停止该票、保全并报告，未经用户明确授权此次接手不得由Codex/MAIN继续，也不得自动重试或重启旧429窗口。Codex仅设计/文档/验收监督，一次一个Claude writer。不得读配置/凭据或更换供应商/模型/权限。

PRODUCT目录 `/home/administrator/orca/workspaces/Narralens/Narralens-A-R1-PRODUCT`，已交付HEAD a809f8d7e53fb90dbd1f56aa956c48c9600d508f；实际先复核HEAD/status并保留dirty流程文件。MAIN de438d17dfc777a9d113c7207b98e1923ab72e6c 与当前PRODUCT的两目标文件git blob相同：
- src/host/m5/openfilm-native-expected.ts = 9a1104fc16c5065c1737a208c5efcaa0a704f7c4
- tests/agent-driven/integration/created-native-ack.test.ts = 34b43e0e089667d0a017b98ae8b3531555ba25e6

仅释放上述两路径及自身 docs/parallel/lane-product/A-R2-20261112/native-expected-lifecycle/ 文档/证据。禁止修改NativeObservation/NativeAckStore/pin/批准manifest/原合同/Host/其他source/依赖。不得写MAIN worktree，MAIN当前4path业务恢复另有Claude唯一writer。此票不实现SourcePort或NativeAck生产接线。

## 已观察风险与要求

当前prove() projection catch中 `for(file) file.close()` 首个异常会跳过余下资源并覆盖主错误；release() 先删除HELD_FACTS再forclose，首个异常后其余句柄失去可达清理；close() 首个release异常会跳过其他proof。prove()只在最初检查#closed，await loader/source期间close后，晚到source可生成新的proof/句柄。这些是源码观察，先写最小反例证明旧代码真实失败，不将推断称实际复现。

1. 保留NativeExpectedPort prove/assertCurrent/release/close签名和所有固定consumer/投影/hashing/pin契约。修的是私有生命周期，不让任何unsupported变成loaded。
2. 一旦收到source.readSource已返回的retained资源，即负责在失败/晚到/关闭路径释放全部自己拥有的资源。投影主异常与每个cleanup异常一起保全。首个关闭失败不能阻止后续；一次release/close也不能阻止其他proof清理。先撤销proof权威，不能抛出后仍可assertCurrent；重复close/release不能因已移除记录而把不确定清理伪称成功，不得重试裸FD数字。真实同一资源重复出现应避免双关闭误伤重用FD，必要时按对象身份去重；不同对象是否同FD不猜。
3. 清理不确定应sticky fail-closed，之后prove/assertCurrent不可重新绿；close仍尽力处理其余自己拥有资源并保留全部失败。错误不能公开绝对路径/凭据，内部errors字段可非枚举。保留原projection primary failure，不仅保留最后一个close错误。不得用隐藏catch吞掉。
4. after await loader、after await source、计算/记录proof前均检查当前关闭/会话状态。source在close后晚到时，释放所有其已交来的资源并拒绝，不再次签发/泄漏；关闭期间未返回的source由其owner继续负责，返回之后责任立即交给本类。synchronous close不能改成async契约，不虚称可等待无法取消的source promise；必须通过late-result清理使其最终收敛。
5. release不得凭全局HELD_FACTS释放其他实例的proof；只管理自己签发并跟踪的proof。伪/JSON/外部实例proof拒绝且不释放别人的资源；自己的已释放proof保持幂等，但已有cleanup不确定不被抹平。使用模块私有身份/记录，不能仅instanceof/可覆盖公开方法当权限。不要影响原assertCurrent外来/失活/字段变更/closure/file guard判定。
6. 尽量遵守原同步API和错误名称兼容：现有已released proof断言仍可识别，原主错误无cleanup异常时不改其含义。所有新增API仅私有。NativeExpectedProof可公开方法不作为底层权威；HELD_FACTS/本实例set先撤销并有内部持久不确定记录。

## 测试和证据

只可纯FS/FD/SQLite/受控promise单元、tsc，不许Host/listen/ffmpeg/browser/build/全量/网络/下载/付费/J/真实runtime。既有stageLibrary是明确unitfixture，不能冒充实际固定上游nativeHydration/Host接线。必要时使用自己创建的真实文件句柄+计数包装模拟close抛错，确保测试确实区分primary与cleanup且实际释放其余fd；模拟close不明结果不能断言OS句柄必已释放。

至少测试：projection primary+首个close失败后余下close仍执行；release首个失败后全部尝试/原proof已无权；多proof close首个失败仍清理其他；重复release/close不重新绿；loader延迟时close后不调source或拒绝晚到；source延迟时close后late handles全清理且不签出proof；foreign/fake/JSON proof不会清理原owner；自己普通释放/原现有用例无回归。每条重大负例先用原source跑同字节test证明旧失败，再用fixedsource跑通过；保留原source hash/恢复hash/所有失败日志，不改旧测试断言来调绿。

命令argv/cwd/exit/logSHA256/输入前后hash齐全。纯模块测试可并行于MAIN不同worktree，fixture如启动Host/媒体则先停并预约。任何unexpected provider/429停下。实现完成交Codex只读审核，未独立审查不得宣称通过；Codex若参与实现不能自签。不要git add-A/commit/reset/stash/push，先报精确dirty列表，等MAIN/父Codex协调显式冻结；保留dirty用户流程和未跟踪历史证据。不能升级为NativeAck、A/V1通过。
