# 054 复审闭环：子进程预算与证据可采信索引

MAIN已核对053-final003真实exit0/2PASS、626当前inputs一致，5份003manifest逐文件SHA/bytes与实际MP4一致、900frame与audio记录一致；001名实不符文件实际hash为7870320d…，已拒绝并保留，001/002的audio字段不可采信。MAIN没有另跑probe/decode，不能把hash检查说成独立媒体复验。

只允许tests/m2.3/migration-real-export.test.ts和新自产docs/evidence/N1N2/real-export-054/，保留053全部历史文件。禁生产/其他测试/上游/配置/运行器改动。

## 必须修的子进程边界

你本轮runCli把原execFile(timeout600000,maxBuffer8MiB)换成spawn，当前stdout/stderr无限字符串累积、没有超时/abort/kill/reap，context.children在Promise close之后才push记录。vitest超时/上游挂起时无法在finally结算已经创建但未close的CLI。恢复既有600000ms预算与8MiB输出上限（不可放宽），实时记录已spawn child identity后再await；失败/超限/超时/取消路径必须等自己真正退出并结算自己子进程，保留原因及cleanup原因，不能仅reject留下后台继续写。Timer/listener应清理，close/error相互竞争一次settlement；缓冲本身有界，不是收完无限stdout再slice尾。

用同文件最小table/case真实node子进程验证挂起超时和stdout/stderr超限杀停/reap，可用更小的test-only预算以快速验证同一runner逻辑，生产render预算仍固定原值。失败时实际PID与退出/信号可证，测试结束无自有后代；不mock主render链、不为测试引入public可控argv。正向真实两个render场景必须仍真实通过。

settleOwnedStudio如private run.json存在但无可验证PID/ownership，应该settled=false并使case失败，不可写“什么都没kill所以clean”。有PID也不能仅信可变JSON就发信号：核对实际存活身份/创建窗口/属于本私有home的事实，无法证明不kill他人且不声明清理成功。正常路径无Studio，保持不会触碰共享配置/目录。无需为了负例真正启动交互Studio；可对本private run事实缺失状态测failclosed，不kill任何无归属PID。

## 证据索引与保持

旧053001/002是harness缺陷证据，不能删除/覆盖；生成机器可读validity-index（允许写新054证据目录）逐一指向053所有相关manifest/工件、实际digest、可采信/错误字段/拒绝原因，主验收入口只允许明确active的一组。至少明确003的5份工件可采信及001first-export名实不符拒绝，001/002audio字段无效，不把整个证据目录glob当PASS。索引也须SHA并在报告链接。修复后新054产物用新目录和唯一capture名，不覆盖053，完整两次MP4与音频/视频probe/decode继续保留。

原报告部分句子将耗时当decode证据，以及“adoption test是untracked”与git事实冲突，后续报告只据实际命令/exit/字节和git状态，不沿用这些错误描述。修改的是harness，不能冒充修了生产Host。

## 验证许可

完整bytebackup/hash；原recorder054-tsc-NNN→054-export-harness-NNN，串行同文件允许围绕上述已证明harness问题与新测试自修闭环，每轮独立result/rawlog读取和自有cleanup，运行期间输入冻结、其他053guards全部固定；失败逐个保留，不盲重跑、不改断言预算。唯一准确vitest命令跑本文件（新增真实child边界tests+原2实际render）。最后完整test绿、所有owned child证明结算、可采信索引与新产物hash齐全后报告MAIN并冻结；其它Expected/full/build/mutation尚未授权。

Headless静音loopback单资源槽，不J盘/网络/下载/付费/外传；不设置HOME/改用户凭据配置，privateOPENFILM隔离保持。新429/工具格式错误、生产缺陷/白名单外必要改动则立即停并报告，不能自动重试/切供应商/Codex接手。无索引/Git操作、工作区不新增套娃、不自签原17/A/V1/冻结独立审查。
