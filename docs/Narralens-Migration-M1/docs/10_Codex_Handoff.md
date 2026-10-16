# Codex开工指令、运行边界与外审交接

## 1. 首轮交接目标

本包可直接驱动M0/M1A/M1B，不授权在未复核源码的情况下盲写完整M2–M7。后续阶段已有合同、Ticket、测试目标，但每阶段仍需要在前一门真实证据基础上落本地源码定位并完成独立开工审查。这是阶段化开发，不是“文档交出去就无人值守直奔V1”。

## 2. 首轮提示词

```text
你是本地 Narralens 仓库的迁移实施负责人。请读取我随消息提供的 Narralens-Migration-M1 文档包，并在现有仓库上做增量实现，不新建替代项目、不重写已通过模块。

【已知起点，先复核】
用户报告的基线是 main/origin main=304c891，工作树清洁；D1/D2/D3/D4.0/D4.1 已通过；D4.2.1 是候选完成、内审通过、外审待完成且存在逐编号直接证据缺口。D4.2.2/D4.2.3/D5/D6/D7/P1未完成；自动开发保持暂停。不要把报告当你已执行的验证，不要reset回304c891。遇到当前SHA/源码/测试与报告不一致，先输出差异并保留用户工作。

【阅读顺序】
先读文档包 docs/00_Read_First.md、01_Baseline.md、02_Architecture.md、03_Spec_Delta.md、07_Development_Plan.md、08_Acceptance.md、10_Codex_Handoff.md；再读其余合同/迁移/UX/安全文档。读取本地真正的 docs/11_V1_Traceability.md、当前03_Architecture.md、D4.2.1冻结矩阵、implementation内审文档、路由/合同/Actor/journal/recovery、package scripts与真实evidence。本包HTML给我看，Markdown为同内容镜像；contracts是目标草案，不冒充既有API。

【目标架构】
保留Host、资产导入/Manifest@2、真实Claude CLI多提案、费用审计、typed edit、revision/lock/journal/补偿。OpenFilm Studio成为目标原生UI与默认渲染，引入EnginePort和受控OpenFilmAdapter；Hypit隔离为旧引擎/回退，一个项目只绑定一个引擎，不双写。VibeMovie只借鉴结构化提案方法，不引入第二份完整timeline、Gemini服务或Remotion全片后端。OpenMontage/HyperFrames/HeyGen后续按能力接入，不前置插件市场。

【本轮允许执行】
1. 执行M0：只读核对完整SHA、工作树、实际目录/接口/阈值和逐case证据；建立安全分支/worktree与可验证legacy备份，输出baseline-observed、code-map、route-inventory和CR-MIG-001。更新主traceability和架构所有状态不一致项，保留旧Gate历史，不覆盖本地权威编号。
2. 执行M1A：补D4.2.1真实multipart顺序/重复/大小、媒体流和工具失败、256项/并发2/单项超时/重复GET、真实import与D4.0 edit并发、未开materialize/adopt路由404及虚构op422测试。与完整冻结矩阵逐项映射，不用126/126总数替代。跑实际全量门禁、生产构建和证据，再用独立Claude Code会话审阅冻结commit；不能自签外审，工具不可用即REVIEW_PENDING。
3. 在隔离worktree执行M1B：固定OpenFilm完整SHA/依赖/许可证，不用latest。用独立临时工程完成30秒中文音画/字幕、原生精剪、首导出、关闭重开、改一镜、再导出；证明所有原生写入口可翻译到Coordinator或明确禁用。特别验证native base不一致时的rebased行为不能绕过叙镜严格409。不得写生产Hypit目录，不用扁平MP4证明可编辑迁移。
4. M1A/M1B可隔离并行；两者都通过后只输出M2开工包和GO/NO_GO，本轮停在该边界，等待下一阶段指令。任何门失败则修复本门或报告阻塞，不顺跳旧D4.2.2。不要恢复之前的后台自动开发任务，不force push、不删除旧工程、不未经批准产生付费/外传。

【后续强约束】
M2先完成原生写入治理、三类锁、持久Job/SSE/lease、snapshot/journal和回退，再做M3素材化。native timeline/Inspector/import/history/undo/redo/provider/CLI全部受控；不支持的操作禁用，不能裸转发。source依赖摘要包括film.html、scene、字幕、设置及引用资产，而非只看一个文件。物料化只能准备proxy/segment plan/lineage，不写author source或project revision。M4采用要求服务器impact/hash、base/锁/许可检查、幂等、revision恰好+1；三镜方案必须仍有三个原生可编辑clip。恢复旧内容产生新revision，取消后晚到结果不自动采用。所有导出绑定已提交snapshot。

【交付及报告】
每个ticket含代码、测试、复现、实际命令、日志和带SHA256产物。独立审计绑定冻结commit；修复后重新验收。保留旧测试及legacy执行入口，合理新增新引擎合同测试。Headless、headed自动化、人类体验分别记录。先用包内tools验证文档/合同一致性，这不算业务验收。
结束时输出：当前阶段、真实repo/upstream SHA、改动与未改动项、逐case通过/失败/未执行、证据目录、内审/外审状态、回退验证、下一个允许ticket、禁止提前宣称的范围。M6仅为Gate V1-P0；只有M7A–D及P0/P1全部真实证据通过，才允许V1-Full。现在从M0开始，不只复述计划。
```

## 3. 独立审计提示词（在本地复用现有Claude审计入口）

```text
请独立审计本次冻结commit，不信任实现者的PASS描述。先读取当前门的冻结规格、测试矩阵、真实源码与evidence manifest；再逐case核查实际HTTP/媒体/并发/恢复证据。
重点：既有D4.2.1负向组合和真实import/edit竞争是否直接测到；未开路由是否HTTP断言；OpenFilm原生写入口是否可绕revision/锁/impact；所有engine-specific旧证据是否被错误继承；生产构建/输出/重开证据是否与冻结commit一致。
返回GO/NO_GO、按严重度的问题、每条源码/测试/证据定位、未验事项和允许声明。没有执行或证据不足的项标NOT_VERIFIED，不靠测试总数或截图推定。不得替实现者修改状态为PASS后结束。
```

## 4. M2之后的续跑模板

每次明确一个阶段，例如：“基于已通过的M1A/M1B evidence执行M2，不跨M3。先检查sha/代码/门禁，填本地实现定位和合同差异；完成M2 ticket及独立审查后停止。保持legacy可回退，不让native端点绕控制。”

不要让新的提示词与旧暂停的自动开发任务同时修改同一工作树。若有任务scheduler或Agent进程，先只读查状态，再按用户本轮授权启动前台工作，不自动恢复旧计划。

## 5. 命令规则

读取根目录、status、log、测试脚本与工具版本是首步。运行命令以本地package scripts和固定上游文档为准；本包不伪造本地已有`npm run gate:*`。引用上游的开发命令只用于隔离探测；不把其默认项目目录或全局link直接接管用户现有应用。

每个长命令给出超时、工作目录、退出码、stdout/stderr路径。真实provider失败要报告，无预算/无凭据可停止对应任务，不能改用假响应让验收变绿。生成给我的HTML报告时不嵌入密钥、本地绝对敏感路径或未经授权资料。
