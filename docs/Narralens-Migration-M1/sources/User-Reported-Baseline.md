# 用户本轮报告的基线摘要（非独立审计）

main与origin/main一致：304c891；工作树清洁；自动开发暂停；D1/D2/D3/D4.0/D4.1已通过。
D4.2.1本地素材导入候选完成、内审通过、外审待完成，Gate未关闭。最近TS、16测试文件、126/126、生产构建通过，自动交互均headless。
已实现的导入只表示素材登记可查看，不代表入时间轴/实体化/采用。

P0 13项：1完整（P0-06）；8部分（P0-02/03/05/07/08/09/10/11）；4未开始（P0-01/04/12/13）。NFR本地/恢复/可观察/可测/可访问部分，性能未开始。

直接证据缺口：multipart part顺序/重复metadata与file/多文件/metadata超限/非multipart；无视频流/多流/零帧/ffmpeg缺失/工具超时/stderr上限；256库存/并发2/单项超时隔离/重复GET重验证；实际import commit与D4.0 edit竞争；materialize/adopt404及虚构adopt operation422。

D4.2.2只读实体化、D4.2.3事务采用、D5恢复锁复用、D6统一工作台、D7交付、完整V1验收均未开始。
D4.2.2拟定segment绑定、异步Job、ffmpeg composite、derived lineage、帧边界/取消/晚到/重启，成功只可ready_for_adoption。
D4.2.3拟定impact snapshot/SHA/428、adopt_materialized_proposal、typed media.replace、revision+1、补偿与真实双build。
D5拟定narration/duration锁、对齐、复用、用户历史、新revision恢复、Job/SSE持久化。
D6拟定P0-01..05、真实播放器/时间码、timeline/区间/逐帧、3–5分钟20+镜及100+/120镜性能。
D7拟定标题封面、发布检查、交付包、3个真实位置比较→实体化→采用→导出、重开双导出、中文HTML报告和人工体验。
P1拟定完整10–15分钟、StyleProfile、TTS/ASR/字幕、远端检索生成、评论反馈、完整预算/重试/队列。

用户对文档支撑度估计：D4.2.1约85%–90%；D4.2.2/3约75%–80%；D5约35%；D6/7约40%–45%；P1约20%–30%；完整P0+P1约45%–55%。这些百分比是报告评估而非本包测算。
当前03_Architecture.md顶部写D4.2.1完成，但实体表/API仍写docs-only/待实现，需同步。
本地权威：Narralens/docs/11_V1_Traceability.md；内审：Narralens/docs/implementation/D4.2.1-internal-implementation-audit.md。
用户建议V1按P0+P1严格口径，不允许D7后宣称全部PRD完成。
