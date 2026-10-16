# OpenFilm e70d9d93 原生写入口清单

这是 M1B 源码盘点，不代表生产适配器已实现。M2 必须逐项翻译到 Narralens Coordinator 或禁用。

| 类别 | 原生入口 | 现状与 M2 策略 |
|---|---|---|
| timeline / inspector | `POST /api/projects/:id/edit`；`film.mjs editProjectFilm`；UI `api.edit` | 可执行 insert/remove/move/split/set/fields/props/stage/track/reorder；必须由 CommandGateway 白名单翻译。原生 stale base 会 `rebased:true`，网关必须先严格 409 |
| subtitle | `PUT captions/line`、`PUT subtitles/style`、`POST subtitles/transcribe|translate` | 修改字幕文件/样式且可能调用 provider；M2 未适配前禁用，后续纳入 digest、lock、费用/外传审批 |
| history | `POST history/commit|discard|restore|checkout|merge`；branch PATCH/DELETE | 可改 film 与工程分支；M2 未建立 snapshot/新 revision 恢复前全部禁用 |
| asset import/file | `POST files/bring|relink|collect|still|audio`；`PUT/PATCH/DELETE files` | 能直接写、移动、删除工程文件；只允许通过 Host asset token 与受控 staging，原生任意路径入口禁用 |
| marker/settings | `PUT markers`、`PATCH settings` | 若影响输出则进入 dependency digest/commit；纯视图偏好单独分离 |
| provider | `POST /api/get`、asks；provider key/use PUT/DELETE | M2 默认 deny；费用、外传、receipt 与取消合同完成后按能力开启，绝不裸转发 |
| export | `POST/DELETE exports` | 只允许绑定 Narralens 已提交 snapshot；reveal/open 属于人类显式动作，不进入无头自动化 |
| project/library | projects/folders create/rename/delete/move/fetch/open | 工程生命周期由 Host 管理；删除、远端 fetch、系统 picker 默认禁用 |
| CLI/filesystem | `openfilm open/look/render/get` 及 agent 直接写 `film.html`/scene/assets | `look/render` 只读执行可适配；`get` 需 provider gate；直接文件写由 watcher 检测为 source changed/attention，不能自动接受 |
| WebSocket/callback | `/api/projects/:id/events`、`/api/events` | 只作投影刷新；事件不得触发 commit，断线后从 Host 持久 cursor 恢复 |

特别结论：上游 `editProjectFilm` 明确把过期 base 重新应用到当前 clip-id，并返回 `rebased:true`，不是严格冲突协议。Narralens 不得把该响应当成功采用；M1B probe 已用临时副本验证，生产严格 409 仍属于 M2 网关实现。
