# ADR-A05-005：真实created工程的受控原生入口

范围属于已授权IT-A05，MAIN生产源码唯一writer。旧Agent CP31合同、旧migration workbench合同及原OpenFilm完整pin不改。

## 事实与边界

1. 同一Host新增UI-only POST /api/ui/v1/projects/:id/native-open，empty object、bounded1024B/5s body；真实trusted_ui Origin/cookie/origin proof、读取body后及完成后再次鉴权。CreationApplication检查真实owner，prepare已提交snapshot副本，真实Supervisor ensure完成后验证同一prepared对象及当前scope，然后Host-only签发native grant。输入不能携actor/path/role/nativeID。它没有approval/run/adoption权限。
2. ControlledStudioAccess 的一次性5分钟fragment ticket→HttpOnly SameSite cookie+editor origin sessionStorage proof；固定Gateway transport cookie避免跨标签互踢，proof按owner session/project/nativeID/Host generation/revision/snapshot/source精确scope复用且不滑动续期。不同scope仍不同权限。64上限保留，失效owner/prepared/过期记录回收；仅bounded256个5分钟hash tombstone留409，无回调/权限。Node真实owner与prepared object/根FD目录身份+实际原生子进程isAlive均为当前性门，不用重hash巨大素材充当每次凭据检验。
3. Gateway A-mode所有原生项目API必须proof+scope；项目列表只当前nativeID，media/poster可接受per-scope只读token但不能升级其它API/写入。film URL为/s/<read>/film/p/<当前native HMAC>/...，同时核scope与HMAC；原不带/s路径拒绝。film与editor、Host origin仍分离。
4. WebSocket仅editor精确Origin+只读subprotocol，项目流必须nativeID匹配；全局events映射当前project stream，不能收到其它project open。每条帧及定期liveness复验；浏览器只可发visibility/control frame，不裸转命令。
5. 所有raw native写继续403。受控narralens workbench只调用grant绑定真实owner read，完成后对project/revision/snapshot/source再比对。未知控制surface保持503，匿名旧cookie不提升trusted_ui。上游失败只返回固定错误，不泄filesystem/launch key。原legacy未配置controlled时保留。
6. 原生子进程死后，旧grant因精确isAlive失效，发请求前即拒；替换子进程onStudio先关闭旧Gateway，再发布新入口，避免遗留特权listener。constructor-only关闭诊断hook不经HTTP开放。已测实际owned child graceful close/replacement；本条测试不冒充SIGKILL故障矩阵。
7. 原M5同页组件采用显式created/legacy联合读模型，保留原stores/clock/Timeline。受控入口默认refine当前工程，不落旧idea占位；created不显示固定3proxy/录制提案，尚无写producer的按钮禁用。Native UI其它写控件的产品级能力呈现仍需随真实translator接线完成，不能把后端拒绝当整体验收。
8. 浏览器实际抓到运行时Ajv compiler触发CSP而面板不挂载。改静态standalone validators，输入三份schema摘要、build --check拒陈旧，Node和浏览器共享同一静态校验。CSP不增加unsafe-eval。真正浏览器在原CSP下原生workspace、timeline及M5面板同时挂载，刷新、只读WS、跨port cookie泄漏后无proof仍拒。原生DOM可见不等于NativeAck，当前仍unknown/unconfirmed，cp_a0_native_ack无伪造行。

## 实际执行及失败保留

- r2/r3真实HTTP各1失败：测试错误假设film标签、以及缺Origin请求先被403挡住未触达401 proof门；分别改用?film-host=0与真实author bytes逐字节比对、为读token负向提供正确Origin。并未放宽拒绝门。
- r4 tsc/3项HTTP/build0；两个误写的panel/selection测试过滤路径并不存在，没有执行这两文件，不能算覆盖。
- r5实际headless失败：原生editor存在，面板未挂；r6静态CSP修后无异常、面板仍落idea；r7修controlled默认stage后实际浏览器通过。三个截图/JSON分别保留，后续positive亦不覆盖。
- r8受影响10files56tests及type/build通过，包括legacy Gateway/workbench/contract/WS和真实created/native工作台。
- r9、r10生产范围测试分别8/9项通过，随后变异捕获器因断言匹配错误返回1，不能把整条命令报绿。源代码均finally逐字节恢复。r9首先击中proof稳定性，r10因issue阶段抛503而非HTTP断言而不匹配，均是工具门失败；未掩盖。
- r11：最终type、2项容量component、2项故意退化门、build通过。容量80重开与64已撤销scope回收是组件transport证据，不冒充真实影片/业务验收。变异子测试均exit1并证实503断言，外层exit0，原始源码逐字节恢复。r9组件临时nonce随fixture关闭已失效，从未真实Host或用户凭据。

## 未完成及下一工作

NativeAck生产者/完整SourceDigest UI hydration未实现；受管原生观察patch仅候选（PRODUCT修P2后原依赖type/build0、MEDIA SOURCE_FIXED），原运行时仍pinned legacy UI。Root启动入口的真实owned project选择、实际Run/Task/local assembly/review/Coordinator adoption/render/QC/Delivery、真人素材/中文录音/两主题/双导出/整A回归与HTML服务就绪均不能凭本链宣称通过。A保持IN_PROGRESS，未进入B。

回退：停用新的native-open委托/controlled入口，保留所有已提交author/snapshot、schema、证据、旧legacy入口；禁止reset/删除已提交项目。
