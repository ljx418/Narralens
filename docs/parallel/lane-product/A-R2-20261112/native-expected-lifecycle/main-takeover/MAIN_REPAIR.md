# MAIN 第三次缺陷返修与复验

本次接管依据用户“同阶段超过两次返工由 MAIN 解决”，不是 429 接手。原 PRODUCT Claude 的 Linux 进程已在 WSL 内核重启后消失；恢复的领域负责人只读复审并明确移交两个文件。此前候选及失败证据原样保留。

## 根因与改动

1. prove 在最后私有准入检查之后读取 source-port 的 verifyClosure 属性，其 getter 可关闭服务，随后仍登记凭证并遗留句柄。将该回调读取移至准入之前，已取得资源仍按原所有权清理。
2. assertCurrent 的三个验证回调可改变当前绑定却返回 true。全部回调后重新读取并比较完整绑定快照，再检查私有关闭/故障/释放/实例/所有权事实；其后不再调用外部代码。

MAIN 在继承候选上只补上述共因及四个永久回归；此前 Claude 生命周期修复同时纳入候选，不能将全部差异冒称 MAIN 新增。

## 实际验证

- root001-old：相同四个新增用例在保留旧源码上 4 FAIL / 73 filtered。失败是旧行为实际返回凭证/旧投影，非导入或配置失败。
- root002-fixed：77/77 PASS，原有用例均保留。
- root003-probe：未修改的独立原探针六场景均无缺陷；含两个撤销控制组。
- root004-tsc：完整 tsc --noEmit exit 0。
- 四次捕获 source_changed/source_added 均为空，日志摘要见 verification.json。42 个受保护用户文件摘要逐一相同。

## 证据边界

使用真实临时文件与保留描述符，Host/source/loader 为受控端口。此处只证明生命周期与绑定拒绝语义，不证明生产 NativeSourcePort、真实上游 hydration、NativeAck、Studio UI 或完整影片。历史 round3 捕获是 72 项，与重启后保留的 73 项字节不同，不伪称同一候选。

独立外审 REVIEW_PENDING。MAIN 参与了实现，不能自签。尚未导入正在由另一唯一 writer 实施的 MAIN integration，不改变该工作树的捕获输入。
