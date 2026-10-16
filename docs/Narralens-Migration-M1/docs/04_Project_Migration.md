# 工程迁移、兼容策略和可执行回退

## 1. 三条迁移路线明确优先级

| 路线 | 用途 | 结果 | 是否证明可编辑迁移 |
|---|---|---|---|
| A 受限语义转换（首选） | 已有三镜fixture、已知fit和media.replace | clip级OpenFilm元素＋独立音轨/字幕＋稳定ID | 逐项通过才可声明 |
| B 从原始素材/任务重建 | 任意Hypit源码无法机械映射 | 新项目，old→new人工映射与来源记录 | 是新建/重建，不冒称无损转换 |
| C 旧引擎渲染后导入MP4 | 应急保留观看结果 | flattened资产，可剪但内部不可改 | 否；不能作为M1B或M6可编辑性证据 |

不做任意Hypit DSL→OpenFilm通用编译器。只有M0盘点出来的真实已用功能列入第一版转换范围。不存在的历史长片不要预设为已经迁移。旧提案记录保持original engine/base；新引擎采用必须重新投影、绑定、审阅，不能把旧approval直接复用。

## 2. migrate-copy流程

1. M0制作旧repo分支/完整SHA、业务工程、manifest@2、资产、journal、run/export和测试产物的可验证清单；凭据排除。
2. 获取旧项目一致读快照；若旧journal未恢复，先恢复或标attention，不从半提交状态转换。
3. 创建新projectId和新EngineBinding，写 `migrated_from {project_id, engine, revision, digest}`；旧目录保持字节不变。
4. 做supported-feature inventory，任何未知CSS/动画/字幕绑定/速度/字体等输出 `unsupported[]`，不能悄悄栅格化。
5. 转换到staging；稳定clip-id与shot-id映射，保留时间/asset内容哈希/原声和文字。仅注册资产，不把D4.2.1库存全插入timeline。
6. 校验source closure，真实OpenFilm预览、导出、重开、改变一个已迁移镜头、再次导出。
7. 出具MigrationReport和回退演练结果。M2通过后才激活该新副本；工程起始revision按本地项目创建约定，旧历史单独只读保留。

## 3. 文件迁移与记录

目标布局示意（先映射当前代码路径，不要求搬空目录）：

```text
<existing-repo>/
  <existing-host>/               保留并抽取EnginePort
  adapters/hypit/                旧适配器与legacy合同测试
  adapters/openfilm/             新适配器
  vendor/openfilm/               固定源码/补丁清单（M0按仓库规范落点）
  <project-root>/
    assets/<content-hash>/       引用已登记资产；兼容原Manifest@2
    .narralens/engine.json       projectId,engine,upstream_sha,parent
    .narralens/commits/          commit-record与snapshot索引
    .narralens/journal/          旧journal兼容读取；新增版本显式定义
    staging/<txn>/source/        唯一可写编辑草稿
    snapshots/<id>/source/       film.html/scenes/subtitles/settings
    derived/<job>/              proxy/render结果，内容哈希与lineage
```

每个snapshot有dependency manifest。资源路径解析以项目允许根目录为边界，拒绝绝对路径、目录穿越、symlink逃逸；同一资源路径重新绑定后必须再次内容校验。UI使用assetId/media token，不暴露任意磁盘访问接口。

## 4. 验证标准与损失报告

- 对已支持的硬切本地媒体fixture，总时长、片段边界、源入出点、旁白资产、字幕文字和时间必须一致；帧边界按整数输出帧验证。
- 浏览器字体/CSS和编码可能不同，不要求整段MP4文件哈希相同。比较解码帧、声音样本、时间码、视觉覆盖/裁切及原有对象可编辑性。
- fit=cover/contain、crop和速度分别做实际夹具；不能将某个引擎的参数名直接当作相同语义。
- 编辑外区域对新引擎同环境前后导出的解码画面/音轨比较，记录容差，不拿旧新引擎视觉差异掩盖局部修改污染。
- 音频基线为相同资产/路由和同一输出采样率；先排除编码延迟影响，不能把压缩字节差异当声音内容变化。

## 5. 回退动作（不是git reset）

在切换前保留可启动的legacy配置和旧项目。触发条件：M1B失败、受控写入口无法覆盖、恢复不确定、数据损失或核心精剪能力缺失。操作：停止新项目写入 → 等待/隔离在途任务 → 保存新branch/snapshots和失败日志 → 切回旧应用配置并打开原Hypit项目 → 运行旧回归与一次旧短fixture导出。

新OpenFilm项目在切换后新增的编辑不会自动出现在Hypit里。回退必须保留这些工作，并提示用户“旧工程不包含迁移后修改”；可额外导出新视频用于参考，但这不算无损恢复。已经花费的模型费用也不会撤销。

Manifest@2与新元数据变化不得反向污染旧项目；没有删除/GC的许可，保留全部被引用产物。legacy分支仅在完整V1和单独退役决定后考虑删除。
