# D1 环境与上游事实审计

状态：Gate D1 已通过（带显式限制）  
日期：2026-10-12  
证据原则：只记录真实执行结果；未知、失败和人工 Gate 必须显式保留

## 1. Narralens 仓库

- 工作目录：`C:\workSpace\videoWorkLine\Narralens`（WSL：`/mnt/c/workspace/videoworkline/Narralens`）
- 远端：`https://github.com/ljx418/Narralens`
- 分支：`main`
- 初始状态：远端未返回分支引用；本地原目录只有 docs/原型，无生产源码或 Git 元数据。

## 2. 已探测上游

| 上游 | commit | commit 时间 | 版本/许可证 | 当前结论 |
|---|---|---|---|---|
| OpenMontage | `9327439db69021ab4b0e2776729bf3b58fdb5a87` | 2026-10-03T12:28:55-04:00 | AGPL-3.0 | Agent 是控制面；YAML pipeline + skills + Python tools + checkpoint，无统一 Python orchestrator |
| Hypit | `85e01c76716498e6ec5b8bdfb6b374ca67f0195a` | 2026-10-10T02:03:31+08:00 | `0.3.1`；附加条件的 Apache-2.0 衍生许可 | `check/plan/build/get/studio` 为真实入口；Author/Run/Result/Runtime 分离 |

许可证结论仅适用于当前本地、单组织自用开发；多租户、SaaS、商业再分发或改变上游标识必须重新审查。

## 3. 本机初始环境

| 工具 | 实测值 | 要求 | 初判 |
|---|---|---|---|
| Node | `v22.22.1` | Hypit `>=22.15.0` | 满足 |
| npm | `10.9.4` | 用于包元数据与兼容安装 | 满足 |
| Python | `3.12.3` | Hypit 可选本地服务 `3.10–3.13`；OpenMontage `3.10+` | 满足 |
| FFmpeg/ffprobe | `6.1.1` | recent stable | 待真实构建确认 |
| pnpm | `10.33.0`（由项目 package manager 选择） | Hypit `10.33.x` | 满足 |
| Chrome/Chromium | Chrome for Testing `152.0.7928.2` | 本地 HTML rasterization | 满足；官方 zip MD5 校验后装入 Hypit cache |

## 4. Hypit 代码基线事实

- 根包：`@hypit/hypit@0.3.1`，`packageManager=pnpm@10.33.0`。
- CLI 开发入口：`node bin/hypit.mjs`；仓库脚本 `pnpm hypit`、`pnpm studio`。
- 日常验证：`pnpm check`、`pnpm test`。
- Run Source 指向 Author Source 和 target；只有 `build` 提交工作，`plan/check/doctor` 不提交 Build。
- Project 由 `package.json` 的 `hypit.project=true` 定界；Result 默认在 `.hypit/results`，不得作为 Author Source。
- Studio 可以写回 Source；修改使用实际 Source 绑定并拒绝过期冲突，不允许 Narralens 维护第二时间轴。

## 5. OpenMontage 代码基线事实

- pipeline 状态：`idea → script → scene_plan → assets → edit → compose → publish`。
- 规范入口：`pipeline_defs/*.yaml`、`schemas/artifacts/*.schema.json`、`tools/tool_registry.py`、`lib/checkpoint.py`。
- 可用于 Narralens 的提案边界应读取 canonical artifacts/Proposal Packet，不允许 OpenMontage 直接写 Hypit Author Source。

## 6. 执行日志

后续每项记录命令、UTC 时间、退出码、日志/产物路径、断言和限制。

### D1-DIFF-01 编码容差冻结（计算 SSIM/PSNR 前）

- 首选判据仍为解码后 RGB 帧 SHA-256 精确相同。
- H.264 跨 GOP 预测使后置非目标区可能出现解码像素微差时，回退门槛固定为：单帧 `SSIM ≥ 0.995` 且 `PSNR ≥ 40 dB`；两个条件必须同时满足。
- 目标镜头的抽样帧必须低于上述回退门槛，从而证明修改真实可见，而不是只改变容器元数据。
- 此门槛在尚未计算任一 SSIM/PSNR 数值前冻结，后续不得根据结果降低。

| 测试 ID | 状态 | 结果/证据 |
|---|---|---|
| D1-GIT-01 | 通过 | `main`；origin 精确为批准 URL；`git ls-remote` 退出 0，远端当前为空。首次 push 属阶段 Git 同步，不伪装为已完成 |
| D1-UPSTREAM-01 | 通过 | submodule 固定 OpenMontage `9327439...`、Hypit `85e01c7...`；许可证 SHA 见 evidence manifest |
| D1-HYPIT-01 | 通过 | CLI `0.3.1`；上游 `pnpm check` 退出 0；Linux-native npm cache 解决 DrvFS 冷启动超过 Worker 10 秒的问题 |
| D1-CHECK-01 | 通过 | Author：2 units/2 assets/14 modules/27 outputs；Run：1 target；Studio 写回后复检仍 `ok=true` |
| D1-PLAN-01 | 通过 | 7 个 local request、0 provider request、0 unresolved/unsupported；preflight OK |
| D1-BUILD-01 | 通过 | build `...51F9BB9B7D`；30.000 秒 H.264 1280×720@30 + AAC 48k stereo |
| D1-REOPEN-01 | 通过 | Runtime/Studio 关闭重开，Source 第 2 镜头 frame 持久为 8%–92%；第二 build `...C400AC1235` |
| D1-DIFF-01 | 通过（无字幕夹具） | 5 个精确帧索引全部满足预冻结门槛；完整解码 PCM 哈希一致；详见 `artifacts/build-diff.tsv` |
| D1-STUDIO-01 | 通过（UI 手势覆盖受限） | 3 张 Studio snapshot 合成预览帧（非 UI 截图）；revision 1 写回返回 202/revision 2，旧 revision 写入返回 409；HTTP 摘要已落盘 |
| D1-OM-01 | 通过（仅发现/校验） | 13 pipelines、20 artifact schemas、137 tools；45 available/3 degraded/89 unavailable；未调用 Provider |
| D1-SEC-01 | 通过 | `detect-secrets 1.5.0` 0 命中；显式凭据模式 0 命中；固定 OpenMontage commit 哈希作为已审计误报排除 |

## 7. 失败记录、修复与限制

- 初次 `corepack pnpm` 获得不匹配版本；固定 `pnpm@10.33.0` 后闭环。
- Hypit 自动下载浏览器两次发生 TLS socket 中断；改用同一官方 URL 手动下载，验证官方 MD5 后解压到预期 cache。
- Hypit distribution 位于 DrvFS 时冷启动约 40–60 秒，超过 Worker 10 秒窗口；把同版本官方 npm 包按 registry integrity 安装到 Linux-native cache 后，CLI 冷启动约 0.70 秒。
- OpenMontage venv 因本机缺少 `python3.12-venv/ensurepip` 失败；依赖改装到隔离 target 目录，上游 contract tests `109 passed in 18.64s`。pip 打印的全局依赖冲突属于宿主环境告警，target 运行未使用全局包解析结果。
- D1 使用可追溯的本地合成媒体，不能替代 D6–D7 真实母项目；无字幕流，禁止声明字幕保留已验证。
- Studio 已验证合成预览、服务端 Source 写回与过期修订拒绝；当前 PNG 是 composition frame 而不是 Studio UI 截图，全部浏览器 UI 手势仍由后续 UI E2E/人工验收覆盖。
- Windows System.Speech 旁白在当前机上是真实中文输入，但跨 voice/OS 不保证 bit-stable；manifest 的 WAV 哈希标识本次验收输入，重建时应记录新哈希而非强求相同。
- OpenMontage 仅证明 manifest/schema/registry 事实；89 个 unavailable 工具不得包装成“已可用”。

## 8. 出门结论

Gate D1 无未关闭致命/重大阻塞，允许进入 D2 的计划、审计与实现。D1 不代表业务 UI、Proposal 生成、事务 Apply、真实素材重关联、字幕或 V1 总体验收完成。机器可读证据见 `docs/evidence/D1/evidence-manifest.json`。

