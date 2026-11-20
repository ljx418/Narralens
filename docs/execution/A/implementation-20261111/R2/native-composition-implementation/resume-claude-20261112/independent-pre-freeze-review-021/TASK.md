你是原 round3 独立 Codex 复核节点。本次为 N1/N2 021 候选的只读冻结前预审，不是最终外审签字。沿用原任务隔离身份，禁止业务执行与源码修改。

实际实现工作树：/mnt/c/workspace/videoworkline/Narralens-agents/main-integration，HEAD e2eff61b464d75d36598103d718cd2a75db5dfda，尚未提交候选。源码/测试由既有 ClaudeCode 唯一写入，当前全量门禁在运行，禁止干预。
MAIN 控制证据根：/mnt/c/workspace/videoworkline/Narralens/docs/execution/A/implementation-20261111/R2/native-composition-implementation/resume-claude-20261112
本次确切 15 文件及 7 配置摘要，以该根 BATCH_036_GRANT.json 的 source_sha256 / extra_guarded_inputs 为准。先只读核对实际字节与摘要，不把旧 HEAD 当候选。source-captures 保存实际字节，不以 git diff 漏掉 untracked。

必读 N1N2_021_FINAL_ACCEPTANCE_CHECKLIST.json（原17条及non-substitution rules），原 independent-coverage-audit-round3/REVIEW.md/MATRIX.json（只作历史019发现），ROUND3_K01_K06_CORRECTIVE_RELEASE_021.md，SOURCE_RELEASE_029_PAIRED_POSTER.json、SOURCE_RELEASE_031_D1_CONCEPT_TEST.json、SOURCE_RELEASE_034_ORIGINAL17_TESTS.json、BATCH_035_P09G07_MAIN_RESULTS.json、BATCH_030_*_MAIN_RESULTS.json、BATCH_032_D1b_MAIN_RESULTS.json、BATCH_033_*_MAIN_RESULTS.json。
实现树 docs/parallel/lane-product/A-R2-20261112/N1N2-native-source/n1n2-claude-021-original-17-evidence-map.md 是实现方映射草案，不是权威结论。核对每项真实代码/断言/capture；不照抄实现方自评。
实际录制在实现树 docs/execution/A/implementation-20261111/integration/e1-main-takeover。全量 n1n2-claude-021-final-check-001 正运行，不得把尚无result当失败或通过。

任务：逐原17条检查代码实现与测试是否真正支撑约束，重点复核原K01..K06修复、工作副本与提交源资源隔离、分配代次/真实FD、预算、raw child settle、主因与genuine cleanup、真实缓存生产者/租约品牌/配对海报与frame_key/全身份/最终重验、approved015接口/产物保护。检查是否存在绕过、假绿、未证明声明。可只读 inspect 原固定上游 e70d9d93...（/mnt/c/workspace/videoworkline/Narralens-openfilm-m1b/vendor/openfilm），不得执行上游/业务或改变pin。
区分：代码缺陷、真实测试缺口、现阶段预期未完成的冻结/最终外审/下一阶段重锚。缺commit/全量未结束是已知待办，不伪造成新增代码BLOCKER；也不能提前宣布通过。两条A影片/Studio/NativeAck/下一接线代码不属于本次已实现承诺，保持NOT_RUN、不扩大或缩小原17。
精确新增读取前后15源摘要，若漂移立即报告，不评价另一个候选。报告实质finding需具体代码行、可达调用链、为何现断言不足、最小修复建议；无证据的假设标为问题不当高置信结论。

禁止：所有运行测试/tsc/Host/ffmpeg/ffprobe/Chromium/build；不修改src/tests/contracts/tools/config/index；不新增分支/worktree；不gitadd/reset/stash/checkout/commit/push；不联网/安装/付费/J盘，不读取凭据；不得启动Claude或额外worker。只允许写本报告目录的REVIEW.md与MATRIX.json。
交付目录：/mnt/c/workspace/videoworkline/Narralens/docs/execution/A/implementation-20261111/R2/native-composition-implementation/resume-claude-20261112/independent-pre-freeze-review-021
REVIEW.md：PRE_FREEZE_READONLY_REVIEW、15源摘要、17条状态和证据、findings按严重度、已知待办/限制、具体后续复核建议。MATRIX.json：17原requirement逐条覆盖证据/缺口，不能仅计数。任何结论都不能叫冻结外审PASS；candidate_commit=null。完成用worker_done向MAIN汇报报告路径、摘要和实际finding计数。
