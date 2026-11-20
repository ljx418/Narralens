# 0ddacd4 冻结后独立探针发现（待审查者最终结论）

只读观察 independent-review/additional-probe.log + .mts，未改被审代码。

1. 第一资源 close 抛错后，第二资源 close 回调能重入 assertCurrent(other proof) 并取得投影；cleanupUncertain 只在整批 releaseResources 返回后才 latch。修复应在第一次 close catch 立刻私有 latch，再继续所有剩余 cleanup；保持释放所有权撤销/聚合错误/不重试原始FD。
2. canonical 回调或 verifyClosure getter 在 projection 已含 p1 后把 binding 改为 p2，随后 prove 才采集 binding_snapshot=p2。assertCurrent据此比较p2完全一致，却返回projection p1。不是只有不可用proof：独立脚本明确 prove 后 assertCurrent，并真实得到旧投影。

根因修复方向：在第一次外部/异步读取前取得单一不可变绑定基线；projection/事实/最终字段比较都约束该同一基线。加载/read/compute/canonical/getter/最后isCurrent若改变字段必须拒绝，并清理已取得资源。不能只在计算后重新采一份已改变的binding做权威。保留现有isCurrent末次调用与私有closed/cleanup/proof fence顺序；不循环调用外部verifier。

下一步待独立审查worker_done且全部验证命令终止、唯一writer交回，再由MAIN在同样两文件根因修复，新增真实FD回归并用旧0ddacd4同测试直接打红。不得删已有4用例或降低断言；不自签外审，不导入MAIN integration，不干扰D10唯一Claude捕获。
