# 验证分层、交还与执行工具合同

## 层次
D0=metadata/schema；D1=真实生产分支pure/unit；D2=真实kernel；D3=真实媒体/端到端；D4=人工。层次不能替代。工具check-delivery-spec.py只检查交还元数据和字节引用，exit0表示METADATA_READY_FOR_REVIEW，不是业务PASS。exit2表示缺项或格式/摘要不符；不是产品函数测试失败。

## packet必需项
format、status、release={path,sha256}（MAIN权威case/source/contract清单；packet不可自行删减）、contract={path,sha256}、source=[{path,sha256}]、required_cases完整数组、cases数组。每行原id/production_entry/implementation=COMPLETE/test_name/level/command_capture；capture需cmd/inputs/result/exit/txt真实全套，exit与result相等、无source_changed/added、loghash一致、inputs对当前source匹配。每case.expected_exit默认0，非0还需expected_failure_artifact真实JSON含case_id、case_passed:true与绑定；不能光有exit1。

当前packet为PARTIAL，checker必须拒绝；不得删required_cases或改status抹缺项。定义ready不代表测试覆盖所有用户规格，MAIN检查可达性、独立审查和实际证据仍必需。公共产品合同/schema不变。

## P0执行包装器（待实施）
保留原run-recorded.py，新增薄工具包装，不建通用CI平台。输入精确release（命令枚举、source/pin、task/owner、case/expected exit、唯一capture、资源slot）、调用既有recorder；默认同步串行，不用shell拼接/timeout wrapper；在途状态UNKNOWN/RUNNING阻止冲突验证及写入租约更新。记录真实pid/epoch/原进程树/退出结果，取消不等于终局。

不允许自身挂起后后台继续下一套；定期只读心跳只是诊断，不是cleanup通过。若scope需要真实C/N，先独立安全审/当前pin runtime release，工具不得基于unit PASS升级。source静态锁不是OS隔离；若以后用只读源码快照，必须核真实producer消费的就是该snapshot与所有依赖，不能只对影子目录算hash。

工具自身应负验：命令外项/重复capture/陈旧pin/在途重复/伪exit/缺日志/未知取消被拒，真单次完整链可准入；保护记录器旧字节。当前尚未实现此执行包装器，不能声称已阻止任意原始Bash。

## 集成及审查
局部改动只跑对应反例与受影响依赖；完整交还固定源后同源全部门；阶段冻结再全量/真实链。任何失败记录保留，不从多次捕获挑绿；old-code红灯与行为mutant区分，fixture NameError不冒充产品语义反例。终止的测试如实标MAIN_STOPPED，不写普通failed/pass。
