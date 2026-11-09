# A05 本地素材/旁白登记至原生组装接线

基线d15e44d1d9739febdc0f47e260b06b4a3881ab1c。MAIN唯一writer；MEDIA/BRIDGE可只读审查；Claude无运行会话。保持公开CP-A0及旧Manifest@2/旧导入入口，不把video-only的旧合同冒充音频能力。

本批允许：新增src/host/agent-driven/local-asset-registry.ts与local-media-probe.ts；CreationApplication及start-runtime.ts最小Host-only装配；对应真实Host/SQLite/本地ffmpeg探测/解码测试和证据。后续同批组装/Run/Task接线逐实体扩展release后执行，当前不以空producer放行。

本地素材由Host配置允许源目录，输入只能是相对文件；存储位于独立私有根，不能写author source/snapshot。可信UI+项目归属+同请求实际bytes hash是登记前提。旧MCP authenticated/native_bridge不可伪装许可审批。使用同一RevisionStore连接下created_local_asset不可变事实表；沿用operation_idempotency和outbox，禁止第二数据库/第二幂等权威。媒体完成固定本地协议/格式白名单的真实probe与全量decode，成功blob fsync/no-clobber后一次SQL原子登记+回执+事件；中断遗留blob只是未引用缓存，不成为可用素材。

保留human_recording/synthetic/unknown来源事实，诊断音调明确synthetic，不冒充真人。A末实际真人中文录音/授权素材仍需真实输入，登记不等于A成片通过。资产导入不递增project revision、不写author source；真实采用时仍经Coordinator/base/source/锁/许可/审批与snapshot。

内部素材ID不得复用旧70字符assetIdentity冒充CP<=64字符ID；使用带完整registration_digest验证的<=64字符项目作用域ID，碰撞逐字段拒绝。许可不能因CLI传rights_refs字符串或字节恢复自动成立。无路径/凭据进入公共素材回执。全程Headless静音，无模型、网络、付费或J盘访问。
