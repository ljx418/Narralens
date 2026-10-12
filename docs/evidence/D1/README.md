# Gate D1 验收摘要

结论：**通过（2026-10-12）**。该结论只覆盖真实底座与适配边界，不代表 Narralens 业务 UI、真实模型提案或 V1 母项目已经实现。

## 已证明

- `main` 与批准的 Git origin 一致；两个上游以 submodule 固定到精确 commit。
- Hypit 0.3.1 真实执行 `check → plan → build → get`，生成两份 30 秒、1280×720、30 fps、H.264 + AAC MP4。
- 关闭/重开后只改变第 2 镜头画面范围；帧 300/450/599 显著变化，帧 150 精确一致，帧 750 满足预冻结 SSIM/PSNR 门槛；完整解码音频哈希一致。
- 通过 Studio `snapshot` 得到的真实合成预览帧可读（不是 Studio UI 截图）；服务端 Source 写回事务从 revision 1 提交到 2，旧 revision 写入得到 409，证明持久化与冲突保护。
- OpenMontage 13 个 pipeline、20 个 artifact schema 可校验，registry 发现 137 个工具；未调用付费 Provider。
- `detect-secrets 1.5.0` 与显式凭据模式扫描均为 0 命中；固定的上游 commit 哈希被规则明确排除，不是凭据。

## 明确保留的限制

- 测试素材是本地生成的真实媒体夹具，不替代 D6–D7 的 10–15 分钟真实母项目。
- 夹具没有字幕流，因此不能声明字幕保留已通过。
- Studio 已验证合成预览、服务端写回与冲突控制，没有浏览器 UI 截图，也没有遍历全部 UI 手势。
- Windows System.Speech 的中文旁白是真实输入，但跨语音/系统版本不保证 bit-stable；每次重建必须记录新 WAV 哈希，manifest 哈希只证明本次验收输入。
- OpenMontage registry 中 45 个工具可用、3 个降级、89 个不可用；“发现”不等于外部 Provider 已配置。
- Git 远端当前为空；D1 只验证 origin 可访问，首次 push 留到阶段 Git 同步。

机器可读索引见 `evidence-manifest.json`，小型 JSON/PNG/TSV 证据位于 `artifacts/`；两份 MP4 与生成音频因体积未纳入 Git，以哈希和可重建脚本为证。
