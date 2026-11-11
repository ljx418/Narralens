# D09 MAIN 根因修复候选

独立原审查 ctx_627c36d9ba50 / msg_d293e56fe66a：REQUEST_CHANGES。该旧结论不覆盖、不删除。当前修复独立审查 PENDING。

## B1：最终授权有效期

registerApproval 在返回已有审批或插入新记录前，完成全部读事实/哈希/绑定比较后重新采样时钟；校验请求/可信 confirmation，并对真实 prepared scope 校验 impact active、plan/impact/grant/授权 confirmation 到期及实际 session。保留原 common guard 与私有同事务读证明，未增加批准权威。

real025 的两条实际 SQLite late-list 首次/重放和一条真实 SOURCE_ONLY 字节核验期间 confirmation 到期均在原实现失败；real026 修复后通过。不会用后续 source commit 的最终检查替代审批自身检查。

## M1：清理结果不得由重放掩盖

CreatedSourceFactsReader 使用已有内部 PublicationCleanup，在撤销 token 前登记 verifier proof 与 original guard 对象；所有对象均尝试关闭，失败责任与历史不确定性保留。acquire 的 stage 关闭失败会撤销已发放但尚未返回的 proof 并清理其他资源；失败实例拒绝继续 acquire/assertCurrent，close 可继续原对象清理但不清除历史故障。

CreatedRunAuthority 保留 acquire/release 的清理故障，对该实例的 review/confirmation/Approval 包括普通幂等重放均 fail closed，提供资源 close；不把已经提交的 review/Approval 假称回滚。故障只属于资源实例，不创建第二持久业务状态机；生产生命周期装配与恢复仍待 MAIN。异常原因保留在非枚举诊断中，公开错误保持既有 CAPABILITY_UNAVAILABLE503/nonretryable/reconciliation。

real025 原实现的 post-commit 清理失败后重放实际成功，因而新增测试失败；real026 修复后首次失败/正常重放拒绝/已提交事实诚实保留/authority close 保留不确定性/最终资源 FD 清空均通过。

## 真实证据

- real025：4 FAIL，25 未选；当前依赖下原 D09 实现反例，不称全旧版本。
- real026：相同4 PASS，25 未选。
- real027：两文件63/63 PASS，authority31（含12实际 Host/SOURCE_ONLY 用例）、workflow32。补实际 Reader release 与 acquire-stage 清理失败用例；只允许本测试的已知注入错误参与专属 teardown，其他异常仍失败。输入扫描无变化。
- typecheck32..35 exit0，35 对应最终字节；raw .txt/.cmd/.exit/.inputs/.result 全保留，runner v2 必须读取子命令 .exit 而非外层退出码。测试用 PID1844498 已观察退出。
- N3 原0ab24b2 的 real02439/39实际通过并存于 afdff1b，不能据此宣称后续 Reader 字节下39重新通过。

## 未完成与声明上限

当前仅内部修复候选。D09 修复独立审查待完成；生产 CreationApplication prepared 依赖与 change/apply 组合、专项 crash recovery、正式 snapshot 绑定 render/native hydration/NativeAck、授权中文影片与 A 统一验收尚未完成。原包引用在专项测试中是隔离元数据夹具，不能充当真实预览/人验。未进入 B，未 push/合 main，未新增网络/付费/J 盘读取。
