# R7资源闭环预研（未释放）

实施者仅在写PROC-0工具时，MAIN只读三个未改的产品文件和原验收计划作后续准备。本稿不扩大当前writer范围，不执行测试，不给R7完成结论。

## 现有实体与责任
CreatedNativeWorkspaceService持有工作副本、ref/generation、serving owner、production pending及scope phase；CreatedNativeSourceReader持有reads/children/acquisitions及已交付租约；RetainedNativeClosure按allocation身份持有目录/文件/negative guard与共享descriptor pool。
R6负责执行域可靠终局；R7接着证明parent drain、PRE/POST双树释放、scope释放、最终witness激活顺序。logical release不能替实际资源结束。

## 需要直接对照的静态风险候选
1. workspace disposeAfterNative逐个目录close/rm没有逐项catch；前一个目录或root close失败可能中断后续释放。serving owner失败虽收集，路径仍继续删除。后续合同必须明确每类失败是否准许删除及如何保留原错误+全部cleanup error；当前仅静态候选，不据此声称已复现。
2. workspace close使用Promise.allSettled(...).then(()=>undefined)，需核上层是否另保存genuine cleanup错误，不能静默把失败当成功；从已跟踪pending promise中分离业务拒绝与资源终局。
3. closure close/release的already-closed早退可能隐藏首轮cleanup失败；虽uncertain/pool未归还，重试者是否误以为fresh success须直接用真实调用者验证。每allocation最多一次close，不允许为重试数字FD而破坏新分配。
4. reader close目前依次停止准入、kill已登记children、等待done/reads/acquisitions，最后报告cleanup ledger。要核重复close同一等待、late acquisition实际release一次及genuine errors归属，不因纯拒绝或回调先结束就冒充全drain。

## 后续最小闭环
原cleanup_uncertainty/per_allocation_fd_lifetime/drain_and_delivery等ID保持。用真实producer/caller触发第N次open/stat/verify/close与重入，断言主因不丢、所有原资源被尝试、unknown不释放capacity、重复close共享原promise、旧handle不生新fresh资格。
原ISO-06/07/10/11/12/13/14/15/17由同一组合责任映射；真实range stream/probe/Chrome仍另票，不能由mock跨层代签。详见SCOPE_AND_SOURCE.json，完整原17+18的原权威计划不改。

## 本次补充核对的真实调用点
reader的OwnedChild.kill当前在约443行按closed/exitCode/signalCode判定后调用child.kill；close约350行每次遍历同一children并调用kill，实际done登记在约450行。后续反例必须驱动真实close入口与真正登记的OwnedChild，不能只替换外层包装方法来声称at-most-once或已reap。
workspace #admit（约308行）登记实际operation promise，并以then成功/失败两臂移出集合；close约1277行冻结准入后等待当前operations快照，disposeAfterNative才关闭serving owners并删除roots。需要对照late acquisition是否仍在所属已登记promise内、serving close失败是否还有未知读者、以及allSettled是否把genuine cleanup错误洗掉，不能只断言集合为空。
后续R7最小反例应分别区分：纯业务拒绝但资源全终局；serving drain失败且读者未知；第一个目录close失败而第二资源仍需尝试；同一fd数字被新allocation复用；close期间晚到的acquisition成功/失败；cleanup handle重复reconcile不冒新证明。这里未执行任何反例，不能据行号宣称已发现可复现缺陷。
