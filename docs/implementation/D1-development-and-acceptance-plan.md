# D1 真实底座探测——开发及验收计划

版本：v1.1（2026-10-12，执行结果已回填）  
授权：项目负责人已批准进入实际开发  
阶段：V1 第 5 步，D0/D1  
范围：只证明真实底座、冻结上游事实和适配边界；D1 全绿前禁止开发业务 UI

## 1. 阶段目标

1. 把现有目录接入 `https://github.com/ljx418/Narralens`，固定 `main` 与 `origin`。
2. 固定 OpenMontage 与 Hypit 的源码 commit、许可证、运行时版本和真实命令。
3. 建立一个不依赖付费模型的 30 秒中文声画 Hypit 工程，完成 `check → plan → build → get`。
4. 关闭并重开工程，修改一个镜头，再次导出；证明修改持久、非目标区受控、旁白/字幕满足编辑声明。
5. 用真实文件与命令确认 Hypit Author Source、Run Source、Result、Studio 写回及时间模型边界。
6. 用 OpenMontage 的真实 pipeline/schema/tool registry 建立 Narralens Proposal Adapter 的输入输出事实记录；不把 Agent 指令体系假装成 HTTP 服务。

## 2. 固定基线

| 项目 | 固定值 | 验证方法 |
|---|---|---|
| Narralens Git | `https://github.com/ljx418/Narralens` / `main` | `git remote -v`、`git branch --show-current` |
| OpenMontage | `9327439db69021ab4b0e2776729bf3b58fdb5a87` | commit、LICENSE、pipeline schema、registry 探测 |
| Hypit | `85e01c76716498e6ec5b8bdfb6b374ca67f0195a` / package `0.3.1` | commit、package metadata、CLI `version/check/plan/build/get/studio` |
| Node | 本机实测并落盘，最低 `22.15.0` | `node --version` |
| pnpm | 固定 `10.33.x` | `corepack pnpm --version` |
| Python | 本机实测并落盘，支持 `3.10–3.13` | `python3 --version` |
| FFmpeg | 本机实测并落盘 | `ffmpeg -version`、`ffprobe -version` |

上游以 Git submodule 或等价的固定 SHA 获取方式接入；不得依赖浮动 `main`。

## 3. 交付实体

- `vendor/OpenMontage`、`vendor/hypit`：固定 SHA 的上游引用。
- `fixtures/d1-30s/`：30 秒中文真实工程、Author Source、Run Source和项目清单。
- `scripts/d1/`：可重复执行的环境探测、构建、导出和证据采集脚本。
- `docs/implementation/D1-environment-audit.md`：事实、命令、边界、限制和失败记录。
- `docs/evidence/D1/evidence-manifest.json`：机器可读证据索引；产物只记录路径、哈希和媒体事实，不提交大文件。

## 4. 开发顺序

1. `D1.1` 仓库/运行时/许可证与上游 SHA 固定。
2. `D1.2` Hypit 安装和 CLI 能力探测；先运行上游类型检查或最小官方测试。
3. `D1.3` 创建本地 30 秒无付费 Provider 工程，运行 `check` 和 `plan`。
4. `D1.4` 启动所需本地 Runtime，真实 `build` 并 `get` 第一份 MP4。
5. `D1.5` 修改目标镜头，关闭/重开后第二次 build/get；采集双 MP4、ffprobe、帧和工程哈希。
6. `D1.6` OpenMontage pipeline/schema/registry 探测，冻结 Proposal Adapter 契约。
7. `D1.7` PRD 检视、证据清单、内部审计。全绿后才制定 D2 子阶段计划。

## 5. 测试与门限

| ID | 操作 | 通过门限 | 证据 |
|---|---|---|---|
| D1-GIT-01 | 检查本地仓库和远端 | `main` 且 origin 精确匹配批准 URL | 命令输出 |
| D1-UPSTREAM-01 | 检查两个上游 | SHA、许可证原文和依赖入口全部可读 | SHA、license 哈希、清单 |
| D1-HYPIT-01 | CLI 版本/帮助/检查 | 版本与命令来自真实可执行程序，退出码 0 | stdout/stderr、退出码 |
| D1-CHECK-01 | 检查 Author/Run Source | 无 schema/类型/导入错误 | JSON 或完整日志 |
| D1-PLAN-01 | 计划 30 秒 Build | 能得到真实 target/operation plan，无付费外部请求 | plan 输出 |
| D1-BUILD-01 | 第一次构建/导出 | MP4 存在，时长 30 秒容差不超过 1 帧，含预期视频与音频流 | MP4 哈希、ffprobe、日志 |
| D1-REOPEN-01 | 关闭/重开并修改目标镜头 | 新 build id；Source 修改持久；第二份 MP4 可导出 | Source diff、build/result |
| D1-DIFF-01 | 双导出比较 | 执行前冻结像素/音频容差；目标区符合声明，前后非目标抽样不超容差 | 5+ 时间点帧、音轨/字幕信息 |
| D1-STUDIO-01 | Studio 打开和写回探测 | 真实预览可打开；若自动化不能安全验证交互则明确保留人工 Gate，禁止假通过 | URL/进程日志/截图或阻塞说明 |
| D1-OM-01 | OpenMontage 能力探测 | pipeline 可验证，registry 可发现，Proposal 输入/输出来源于真实 schema | 命令、schema、输出 |
| D1-SEC-01 | 凭据与路径检查 | 提交候选不含凭据；上游/产物路径不越界 | 扫描报告 |

## 6. D1-DIFF-01 预冻结规则

- 两次输出必须使用同一分辨率、帧率、编码器参数和输入资产。
- 至少抽样目标镜头起始、中点、结束以及前后相邻非目标区各一个时间点。
- 对无变化的非目标区，先用解码后帧 `framemd5` 精确比较；若编码链路导致非确定性，再在看到测试结果前于环境审计中声明 SSIM/像素差阈值及理由。
- 旁白未修改时，其输入资产 SHA-256 必须相同；导出音轨的时长差不超过 1 视频帧对应时长。
- 字幕时间范围和文本必须与 Source 声明一致。若当前最小工程无独立字幕流，必须记录为测试夹具限制，不得声称字幕流已验证。

## 7. 停止条件

出现任一情况，D1 判定失败并停止业务 UI：

- Hypit 无法在固定版本真实 check/plan/build/get。
- 无法得到 30 秒真实 MP4，或重开修改不能持久。
- 只能通过直接修改生成产物而不是 Author Source 完成编辑。
- OpenMontage 能力必须依赖未记录的人工复制，无法形成可审计 Proposal 契约。
- 许可证边界与当前本地单组织自用目标冲突。
- 证据缺失、使用 mock 代替真实输出、或测试门槛在看到结果后被修改。

## 8. 出门条件

全部测试有真实退出码与证据，D1 事实回填同步到架构、追踪矩阵和 Draw.io；无未关闭致命/重大风险。D1 通过只允许进入 D2 计划与审计，不代表 D2 已实现。

执行结论：上述条件已满足，Gate D1 通过；字幕夹具缺失、Studio UI 手势覆盖和真实母项目等限制已显式写入环境审计及 evidence manifest，不被当作已完成范围。

