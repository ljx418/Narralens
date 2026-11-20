# PROC0 B3自检夹具错误：一次修完同类问题

MAIN已核bootstrap-002全部实际原件：B1=23/23、B2=23/23，inner/outer0；B3 inner/outer1，全部原组CLEAN、零输入漂移。原六件套及observer原件保留，源码快照见bootstrap-002/MAIN_CAPTURE_VERIFICATION.json。本票只有WRITE许可。

真实根因：build_synthetic_fixture把captures[*].sidecar/artifact等声明路径作为JSON字符串返回（对packet是正确的）；self_test多个mutator直接将该字符串作Path调用read_text。B3在outer_mismatch就AttributeError，后面同类sidecar和credential mutator也会逐个报同错。它不是有效语义反例，不归类为资源/内存/产品问题。
请在checker self_test的文件I/O边界统一把声明路径解析为正确Path（需要时结合fixture.root）；保持fixture对外JSON路径仍为字符串，不能将Path对象塞进packet去破坏serialization。检查所有captures[*]字段赋给path后调用read_text/write_text的同类点，覆盖sidecar与artifact，不能只修第一个错误逐次重跑。
mutate→check→restore在finally保留还原责任；每个负例前/还原后明确原始正例仍准入，避免前一项坏状态使后一负例以错误原因假绿。这个要求保持已审负例独立，不新增产品契约。
在test_delivery_handoff.py增加调用真实checker.self_test()的direct测试（仍pure，不spawn、不绕到副本谓词），断言顺利完成、scope为SYNTHETIC_METADATA_ONLY且关键既定负例被执行，不能catch AttributeError算PASS。现有负例/退出码/错误断言不放宽。B3真实CLI --self-test仍须单独录制。
仅tools/check-delivery-spec.py、tests/process/test_delivery_handoff.py及OWN报告可改；runner/admission/helper/原recorder/产品/旧capture保持不变。修后给两新SHA，冻结再ask MAIN新bootstrap-003。未取得新票不测试/编译/生成/运行helper；bootstrap-002不再授权任何复用或重试，新429立即停不接手。
