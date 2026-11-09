# A06 诊断工具分类与真实编码修复

原harness把所有文件当native_source，固定字幕/许可门必block。现按真实文件识别subtitles/rights supplement；只有明确原生源码扩展可作native_source，字体、二进制及其他未知资源均为asset。删除凭空cleared，--rights-manifest需逐文件显式path/hash/asset/rights/status/commercial/evidence；实际bytes不符、缺文件、跨asset/ref别名或symlink拒绝。没有声明的资源仍无许可，不能自动通过preflight。此内部格式只为受控诊断，不是新的生产授权API。

新增make-diagnostic-project生成自有1秒/30帧、三个page clip、字幕、许可说明和测试音。测试音明确不是真人旁白、不是A片；三个iframe和window.film.frame由实际固定上游处理，不能用该诊断替代用户素材/完整A验收。

真实首跑main-harness-real-first失败，worker-response原文保留：本机FFmpeg标准输入使用fd协议，原file,pipe白名单拒绝。MAIN将本地描述符fd加入worker输入白名单，仍无网络协议，并更新guard固定摘要。main-harness-real-r2真实encode/full-decode/QC/包发布exit0，媒体SHA与各实体在artifact-inventory.json逐项记录，Root原本静态模块测试不能发现这个缺陷。

harness不连接DB，其commit sink不再虚构ready_committed/events_published回调。成功只显示MODULE_PACKAGE_CREATED，production_ready=false/durable_commit=false；实际观察边界仅encode_finished/qc_finished/package_published。生产Snapshot/Attempt/Commit/下载接线、真人成片、取消/崩溃/故障全矩阵T20仍未验收。
