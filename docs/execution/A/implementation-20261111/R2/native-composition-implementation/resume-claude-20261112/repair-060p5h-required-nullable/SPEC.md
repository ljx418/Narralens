# R5H 必需nullable字段：一次统一存在性收口
继续原R5G交还字节，原Claude唯一实施。读本票RELEASE/START_INPUT_BINDING/MAIN_ADJUDICATION及release.findings/REVIEW，再读原R5G已审完整契约（SHA493f86e334b25a4d2fa240b2248f485c910f379747b9c7e1e91ec4b82f124319）。这是同F07/F10义务，不是新增产品或kernel范围。

本票通常只需改tools/native-cache-normal-pilot.ts与现有pure pilot测试，加自身报告；原八上限不扩，新source不增。R5G其它原错误/实际cause/diagnostic门已静态关闭，不退化、不重写，不再另造checker。

统一修法：在verifyPublishedRun进入baseline/mode/ordinary分支前，给已发表v2记录设置完整own-property必需key门（Object.hasOwn或等价），随后既有类型/语义门仍执行。不允许把undefined当null，也不能用in接受继承属性。不要只补review列的三四个if，全面扫所有“!==null && !==undefined”以及optional跳过是否违反既有必需合同。

以下是当前producer始终发表的key清单，请据真实writer逐项核对后建局部required-own-field表（内部tool，非新公共schema）：
- candidate: kind, authoritative, mode, root, custodian_sha256, fixture_sha256, copied_fixture_sha256, scenario, expected_image, actual_image, original_failure, settlement_failure, cleanup_facts, terminal_proof, terminal_proof_observations, receipt_summary, accumulator_summary, raw_segments_saved, timeline。
- manifest: kind, authoritative, root, artifacts, listing_error, excluded, exclusion_reason, required_artifacts。
- final: kind, authoritative, publication_protocol, mode, root, exit_code, kind_of_run, fault_case_passed, terminal_proof, picture_sha256, picture_bytes, picture_is_the_exact_one, original_failure, settlement_failure, cleanup_facts, reporting_failure, reporting_failures, evidence_errors, evidence_problems, manifest_error, required_artifacts, candidate_sha256, candidate_bytes, manifest_sha256, manifest_bytes, terminal_proof_observations, diagnostic_snapshot。
- 每个artifact row: name,digest,bytes,error。producer的artifactRowProblems也应拒绝缺error，error-free必须显式null；有效非nullerror仍使证据不可靠，不可删error来表示无错。
存在性全表可集中；值类型沿已审合同：无错final.reporting_failure/manifest_error、manifest.listing_error、row.error必须显式null。缺字段、undefined、错型、同类型矛盾均3，不accepted。

baseline===null不能跳过candidate.receipt_summary/accumulator_summary/terminal_proof_observations及final.terminal_proof_observations：四字段必须各自存在且明确null。final.diagnostic_snapshot也须存在明确null；没有snapshot时不能创造一个mock证明来过门。保留helper已拷贝后createSupervisor抛普通Error的合法完整ordinary1控制，不把所有setup失败偷换3；no-root仍先拒绝3，不能去读不存在的final/cwd。

测试必须证明统一门真实使用：用现有受守卫fixture+realFsDeps/tamperWith，写边缘只删/改一key再委托真实writer/publisher，让实际mapper/hash/length/links自然对应坏字节，actual唯一checker和关键actual main给3，root保留。参数化逐个删除上述完整发表key表（含每一row.error）；关键nullable项另覆盖显式undefined（JSON删掉）/错类型/合法非null错误。测试表标签必须真实wrong-type（string字段用array/object/number，不用另一个string谎称类型反例）。null-baseline ordinary场景逐个删除/错型/非null矛盾四字段，未修改显式null对照仍reliable=true/accepted=false/1。正常0、确切fault1、wrappercause、ordinary1、参数2、mandatory证据3与原186例全部保留。不重开已关闭kernel/原guard。

只跑RELEASE六种FIRST-recorder命令，capture前缀全新n1n2-claude-060p5h-；每条首跑留cmd/inputs/log/exit/result，源码运行期固定，final完整六条同源，generate仅可改原manifest。禁止timeout包裹、继续增加20s预算、改生产deadline/断言求绿。旧5s/20s超时根因未知；afterEach清表不是等待旧promise已终结，报告不能夸大。旧26red只能称helper-neutralization mutant，不宣称exact存档R5F重放；不伪造rawsegments/PID/exit。需要红灯就用安全新反例/不弱化guard，保留完整实际输入与失败。

禁止真实C/N/产品signals/fork/wait/prctl、混合kernel lifecycle执行、Host/Chrome/media/Q2/full/build/network/费用/J盘/配置凭据/Git add或commit/reset/stash/checkout/push/merge。保护七文件/userAGENTS/Approved015/旧capture与review不动。新429立即停止上报，不自动重试/重启/换供应商/Codex接手。普通实现失败同批自行闭环，整体完成后交还：逐key/case→代码→实际consumer→recorded证据、八hash/保护检查、失败索引与限制。只内部自验；MAIN再独立受影响复核，实际N另票，R6R7R8/原17+ISO18/冻结/NEXT仍原目标。
