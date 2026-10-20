# M4B OpenFilm 原生操作隔离探针

日期：2026-10-20。范围：固定上游 + `/tmp` 隔离副本；未修改生产源码、迁移工程或证据目录，未联网。

固定上游：`e70d9d93c7bebe3d634ff2caa6f7a738cdde59d3`。输入为 M1B 三镜工程，初始视觉 clip 为
`shot-01/02/03`，另有独立 narration clip；舞台 1280×720。

## 被否决的配方

1. 三条 `insert` 会在既有三镜上追加，结果成为六个视觉 clip；
2. op 的 `src` 不能写 `...mp4#t=0,10`；固定上游以末尾扩展名判断类型，source trim 应写入 `time` 字段；
3. page clip 的 selector override 不能原样带到 video clip，固定上游会拒绝。

## 已验证配方

adapter 对三个既有视觉 clip 各生成三条 closed `set` op，顺序固定为：

```json
[
  {"op":"set","clip":"<stable-clip-id>","field":"src","value":"assets/<sha256>/source.mp4"},
  {"op":"set","clip":"shot-01","field":"time","value":[0,10]},
  {"op":"set","clip":"<stable-clip-id>","field":"overrides","value":null}
]
```

真实调用为 `editProjectFilm(stagedRoot, before.rev, ops)`，随后用 `readProjectFilm(stagedRoot)` 回读问题清单。探针
结果：edit 返回类型本身不含 `problems`，其 `rebased=false`；权威回读返回 `problems=[]`，视觉 clip
仍恰好三个，ID 与 timeline `at=0/10/20` 不变，source time 均为 `[0,10]`，narration clip 与 1280×720 stage
保持不变。该结果只证明 op 语义可行；M4B-1 仍须以三个不同 materialized asset/source range、完整渲染与边界帧
作为正式证据。

可复验脚本：`docs/migration/WAVE2/tools/m4b-openfilm-op-spike.mjs`；本轮结果：
`docs/evidence/WAVE2/spikes/m4b-openfilm-op-spike.json`。脚本只在 OS 临时目录复制并在 finally 清理，不修改输入工程。

Host-specific validator 只接受上述 `set` 三元组：field 仅允许 `src/time/overrides`，src 必须是 Host 生成的
content-addressed token，time 必须由 NativePlan 帧区间和 rational fps 确定，overrides 必须为 null。不能把固定
上游 `OpenFilmOp` 的宽 `insert.clip` 类型误称为 closed schema，也不能裸转发客户端 ops。
