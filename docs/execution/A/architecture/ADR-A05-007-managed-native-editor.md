# A05-007：受管原生编辑器的显式复合固定版本

MAIN新增managed-editor模块/固定产物，A-mode明确启用；原vendor和legacy UI保持只读。它仍是原OpenFilm App/useFilm/Timeline/Player/clock的薄观察补丁，不是第二编辑器。原上游probe/renderer/guard pin继续执行，新UI用独立复合pin，不将其冒充旧上游dist。

## 输入与发布

固定上游e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3、原lock SHA、原生依赖闭包、patch/source SHA、10文件逐bytes/SHA、dist manifest与压缩包全部记录managed-editor-pin.json。父仅从代码旁固定压缩包读取；按预期10文件、tar校验和和regular-only USTAR验证，在已验证私有runtime root建独占stage再发布到以build SHA命名的目录。路径、链接、额外文件或旧产物被篡改一律拒绝；不递归删未知缓存以“修复”。

原PRODUCT gzip tar含PAX时间戳头，严格regular-only解析拒绝（r2/r3两case失败保留）。MAIN依据原archive hash逐文件校验后重新打确定性USTAR，时间0/uid0/权限444；原source_archive_sha/bytes和新archive SHA都保留，10文件bytes和dist SHA未变，不放宽tar解析。输入目录不得从浏览器/项目请求体选择。

## 启动与运行

父在prepare时验证固定上游HEAD、tracked清洁和原lock；child从私有启动参数收到directory/runtimeRoot，独立重复固定pin/目录/每文件验证后才传给原startStudio。保持原离线loader、媒体进程策略、独立HOME变量命名空间/库/临时目录和退出等待；没有开放新网络/付费/原生写路由。

父持有产物目录与10文件/devino/mtimeNs/ctimeNs指纹，每次liveness还检查canonical祖先；runtime父目录被改成指向同一文件的alias也失效。isAlive失效会使已有受控scope被拒；再次打开须重新通过既有Supervisor启动/准备门。已损坏固定产物不自动覆盖。原生child实际退出检查仍独立存在，不能把UI字节检查当进程存活。

## 观察边界

当前固定patch仅film document实际DOM提交full hash/native rev/epoch和失效；尚未给Host装callback或映射NativeAck，系统继续unknown。settings、subtitle style/captions、markers的同store hydration由下一补丁做，完整profile未匹配不能签source绑定NativeAck。film ready/seeked有超时语义，不能当全片decoded/QC/人验。

## 回退

关闭A-mode managedEditor开关回原固定UI；项目、author/snapshot、原vendor、manifest和历史证据保留。回退不意味着可以对source版本不明的原native UI发loaded声明。
