# CR-R1-002：公开预览类型与读取输入协调

状态：MAIN_APPROVED_IMPLEMENTATION_DIRECTION。只协调已批准R1的生产者/消费者，不新增业务功能或HTTP。原封存relaunch包及其历史标识不改；与本节冲突的旧措辞仅保留作历史。

## 受控下载引用

冻结contracts/agent-driven-a.schema.json的ReviewPart.download_ref定义为null或opaque ID，正则`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$`。因此ID token为权威；旧review-media registry中“字段本身为loopback URL”的一句是规格冲突，以本裁决覆盖，不能扩大冻结schema容纳URL。

Gateway从经过校验的token构造本实例固定媒体alias，Host依据真实project/run/package/version/Ref/receipt/object关联查找。用户不提交路径或URL，外部URL、HTML source、伪造token均不授读取权。不存在真实发布绑定时503，不伪造可播放。原31 Host、5附属Host、2Gateway计数及原闭集RPC保持。

## 公共类型层

MAIN将在src/contracts/prepared-preview.ts提供唯一公开PreviewMediaDescriptorV1及其引用的实测timeline/media_facts/part/receipt类型与纯max-read常量。该模块仅依赖原公开ReviewPart类型，不依赖任何Host类、TaskReservation、文件路径/FD或环境变量。assembly-ports维持类型重导出兼容，私有completed source/proof/readport留Host；APP从contracts消费并删除临时结构类型，保持app不可importHost的fitness规则。搬移不改变既定wire字段或摘要。

## 附属读取的分页输入

来源与库存RPC读取输入为闭集对象：project_id可省略；如存在必须为当前delegate项目的有效字符串；limit可省略，为1..64整数，默认32；cursor可省略或null，存在非null值必须为opaque字符串。除这三键外拒绝，禁止把未知字段筛掉再调用Host。项目权限来自Host delegate，不来自该字段。HTTP对应query仅允许limit和cursor，project来自path。Host现有opaque cursor绑定principal/project/operation/filter/root-generation与900秒过期仍不变。

输出沿既有cursor_next，客户端加载下一页传cursor=cursor_next；410须清空旧游标、说明失效并从第一页刷新，不自动把不同generation拼为全集。UI应提供继续加载/下一页，第一页不能显示成完整库存。source-file和inventory拥有各自游标，不可混用。此处将已承诺分页派生为明确输入名，不允许随意root/path/filter扩大源读取。
