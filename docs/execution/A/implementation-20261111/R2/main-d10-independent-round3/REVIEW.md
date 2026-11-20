# D10 第三轮独立复审

**结论：bounded ACCEPT，仅限冻结四路径模块；BLOCKER 0 / MAJOR 0 / MINOR 0。**

冻结：`abf34c9a04ae31639ce9ea2180fda32458413a17`。原目录：`/mnt/c/workspace/videoworkline/Narralens-agents/main-integration`。未参与实现，未派生其他审查者或实现者；只读审查原 recovery/adoption 两份源码和两份 integration 测试。

## 审查判断

完整执行绑定共因已在两个历史分支闭环，未发现本轮新增 BLOCKER、MAJOR 或 MINOR。最终命令结果和交回结论见文末。

- `created-source-recovery.ts:546`：adoption存在时，除与adoption.execution比较，还与不可变plan.producer_execution完整canonicalDigest比较。请求与adoption重复记录一起损坏也不能自洽通过。
- `created-source-recovery.ts:574`：adoption缺失但prepared authorization存在时，完整execution比较在plan/project/base/source/facts_digest证明中执行，之后仍检查原approval的impact/base/control/执行字段。authorization_id不再遗漏；不以“另一个grant有效”代替原执行绑定，也没有从plan回填请求。
- 两处都位于#legitimacy内、owner/author proof和资源操作之前。失败经#decision返回原Coordinator的持久REQUEST_NOT_LEGITIMATE attention；不abort、不补偿、不消费authority。
- 真正无adoption且无prepared authorization的早期分支未被新增强制条件封死，仍需原owner、committed base与完整author证明；无adoption但授权完整匹配的正向对照仍运行。已committed的原请求与原plan绑定不依赖当前grant仍有效，本次没有引入这种退化。

前轮 MAJOR-R2-01 在本轮关闭；首轮早期guard清理和扫描关闭问题沿用第二轮已确认修复。源码相对1349636只有上述两条新增检查，无删除/改写；原adoption源码及其测试字节未变。继承的严格wrapper/schema/hash/project/base/family/队列内重读、DB真实进展与有限扫描、attention/recovering保留、原published lease/Publisher/closed commit、补偿closure/fsync、原receipt校验与不重复消费均未因本次变化放宽。原sticky清理、主错误保留、真实abort结果及整轮受理close等待路径字节不变，不以重复运行次数替代这些已有证据。

## 测试本身的核查

`created-source-recovery.test.ts:633`起两个真实producer回归先确保替换authorization_id后的请求仍符合ApplyChange schema，再重算请求hash；分别删除adoption，或将adoption.execution与请求一起修改，保留独立immutable plan与原authorization。受控损坏seam恢复原数据库trigger，不以关闭FK或替身授权制造通过。

断言覆盖返回attention、实际transaction attention、ownerOf/retained verify未调用、authority witness及author字节不变、dev/ino/size/mtime不变。witness具体包括approval消费状态、impact状态、project revision/source/control、active pointer、step、outbox/idempotency数量、journal phase；这是有界业务保全检查，不宣称逐字节覆盖整个数据库。代码路径确认拒绝发生在owner/author proof之前。

已读原old-full-execution008完整输出：两个案例在1349636实际返回aborted/PROVEN_ABORTED，预期attention的真实断言失败；不是fixture/schema失败。原失败日志、第二轮REQUEST_CHANGES及更早历史全部保留。

## 命令与历史证据

唯一重型argv，在MAIN原目录运行一次：

```sh
corepack pnpm exec vitest run --config vitest.config.ts tests/agent-driven/integration/created-source-recovery.test.ts -t "MAIN full execution|MAIN authorization still permits|commits the original published transaction exactly once"
```

精确argv/cwd、完整stdout/stderr、实际子进程exit和log SHA分别保存在 four-cases.command.json、four-cases.log、four-cases.result.json。含两个新负向、匹配surviving authorization安全abort、原published commit/replay；不等于全33项独立重跑。

历史核对见 historical-verification.json：四文件均匹配票据SHA与冻结blob，旧008 exit1、新full009 exit0和type010 exit0日志SHA一致；full009/type010各620项完整捕获输入均匹配冻结当前字节。MAIN内部full33PASS/full tsc0明确归属内部证据。本轮不重复未受影响的50项adoption测试、上一轮已通过的原生命周期探针和tsc；此选择符合正式票许可，不冒称本轮运行它们。

before.json/after.json记录648项源码/测试/工具/合同/根配置/AGENTS及93项原报告和捕获证据、HEAD与索引前后核对。reviewed-diff.patch保存审查过的精确差异。新增证据只在本轮独立目录，无源码、测试、工具、配置、索引、分支写入，无reset/stash/checkout/commit。

## 验收边界

本结论只覆盖四路径模块及上述冻结。生产Host挂载/generic/scheduler组合、真实SIGKILL、真实合法后继、NativeAck、Studio、两影片与A人工验收仍NOT_RUN；synthetic pointer测试不是合法后继，端口或同进程fixture不是生产验收。后续目标按原审定包继续，不以本模块结论降级或关闭这些门。

## 最终结果与只读交回

独立精确四例 **4 PASS / 29 skipped / actual exit 0**，完整日志已核读。648项原文件和93项原证据无变化，HEAD/索引不变，唯一dirty仍为原保护AGENTS。所有自有命令已真实退出，无待运行探针或自有后台命令；只读交回并释放独占重型槽及源码冻结交接，未实施修复。MAIN可按后续授权推进生产组合，但本模块接受不替代上列NOT_RUN门。
