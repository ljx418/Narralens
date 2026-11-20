# PRODUCT实际集成与主Agent修复

源候选ed44a9b：12 app/tests+1 browser adapter，逐路径/摘要导入，MAIN transport/MEDIA/公共DTO保留。原候选/票据不改写。

实际命令与范围：最初136组件/传输测试PASS、生产构建PASS，但真实浏览器FAIL（workspace/timeline存在，panel为null、异常1），保留imported-browser日志/截图；不能据此声明UI可用。

MAIN将前端使用的5个原CP-A0定义由已有Ajv工具预编译成CSP兼容静态函数，未更改冻结schema或放宽CSP，未知定义拒绝。64原冻结正负向量与原Host validator一致+动态输出禁止测试共65项。工具guard两次拒绝未知equal runtime的发现未抹平；最终显式将该已有纯runtime映射ESM，guard不关闭。新wrapper只用于浏览器，Host原路由validator不动。fixed-consumers实际9files280PASS、fixed-build0、真实fixed-browser0。

扩展实际browser交互又检出真实冷启动workflow404+测试Host没有health配置503；保持observed-browser原始FAIL。前者MAIN修正为已授权、尚无Run工程只读返回revision0/nodes空/define_content，不制造Run、Job或能力；路由原owner检查保留。后者仅fixture可选observedHealth接入真正ServiceHealthRegistry，Host listen返回后记录实际已绑定样本，15秒TTL照常转unknown；不是生产launcher健康验收或硬编码成功DTO。cold-browser实际2files32PASS：真实浏览器中context/workflow/health经UI cookie+独立proof→Gateway→Host均200、同项目、折叠/展开、系统侧栏不抢焦点且不阻塞单一原生编辑器/时间轴，显示未收到原生确认。该条命令写了不存在的created-workflow-host路径，Vitest只实际运行另2文件；不冒充第三文件通过，后续补真正creative-context-host回归。

所有scope均非真实准备包采用/native加载、真实音视频两主题、正式成片、R1全局独立验收或A人验。失败截图与原日志保留，合成媒体不冒充人声。

最终补验：cold-host-regression实际14/14通过，含同真实已提交工程无Run时重复workflow GET为0/空nodes、外人和缺项目404、Run/command/commit/source不变；final-types原始日志exit0。全部仍为限定内部证据。
