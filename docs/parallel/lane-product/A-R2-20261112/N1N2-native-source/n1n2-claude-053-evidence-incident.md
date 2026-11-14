# N1N2 053 — 证据目录内的两个**已知缺陷工件**（必读，勿直接采信 001/002 的工件）

Writer: Claude implementation child, task `task_66a264bdb2f9`, dispatch `ctx_0ea444aa3ce7`。
证据目录：`docs/evidence/N1N2/real-export-053/`（本 lane 自产，未覆盖任何历史工件）。

本文件说明**证据目录里哪些工件不可信**以及**为什么**。`053-real-export-003` 的工件与 manifest
是**逐字节正确**的；`001`/`002` 的工件与 manifest **按原样保留**（不删、不覆盖），但其中两处
**是我自己的 harness 缺陷**，使用者必须知道。

---

## 缺陷 1：capture 001 的 `mig03-export-first` 工件名实不符

| 文件 | 名字声称的 sha256 | **实际** sha256（独立 `sha256sum`） | 结论 |
|---|---|---|---|
| `mig03-export-first-bbf30366cec4.mp4` | `bbf30366cec4…`（首次导出） | **`7870320dc14505149afd161abeab7f954aae83f3716feb1aba4943c58eadcf07`** | **名字说首次导出，字节是改单镜后导出的** ⇒ 不可作为「首次导出」的证据 |
| `mig03-export-after-middle-edit-7870320dc145.mp4` | `7870320d…` | `7870320d…` | 一致（碰巧，因为它是最后一次渲染） |
| `en05-export-copy-after-rollback-bbf30366cec4.mp4` | `bbf30366…` | `bbf30366…` | 一致（该用例只导出一次） |

**原因**：渲染器把 MP4 写到工程里的**同一个路径**，后一次导出会覆盖前一次；我的第一版 harness 在
用例的 `finally` 里才复制工件，那时第二次渲染早已覆盖了该文件，所以「首次导出」的工件里装的是
最后一次导出的字节。

**为什么仍然留下**：授权要求证据不可覆盖、历史失败必须保留；这份工件本身是**我方 harness 的缺陷证据**，
不是被接受的结果。`manifest-mig03-export-first-1.json` 如实写着被测量的 sha `bbf30366…`，
与文件的真实 sha 不同 ⇒ **manifest 会暴露这个矛盾**，这本身就是可核验的证据。
（`docs/evidence/N1N2/real-export-053/` 只放工件与 manifest，故这份说明放在 lane 证据根。）

**已修正**：每个导出**在它自己被产生的那一刻**复制字节，复制后**再读回并比对 digest**，
不一致即让用例失败；工件名带 capture id，历史工件永不被覆盖。

## 缺陷 2：capture 001 / 002 的 manifest 把音频写成了 `null`

`media.audio: null` 是**错的**：导出的 MP4 **确实有** AAC 音频（48000 Hz、双声道、30.0 s、1407 帧）。

**原因**：我的 ffprobe 音频探测请求的是 `stream=codec_name,sample_rate,channels,duration`，
**没有请求 `codec_type`**，而代码却按 `codec_type === "audio"` 去找那条流 —— 字段根本没返回，
于是恒为 `null`。这是**探测自相矛盾**，不是媒体没有声音。

**独立复核**（capture 003 的工件，真实命令与 exit）：

```
$ ffprobe -v error -count_frames -show_entries stream=codec_type,codec_name,width,height,nb_read_frames,sample_rate,channels:format=duration -of csv=p=0 <artifact>
h264,video,1280,720,900
aac,audio,48000,2,1407
30.000000                                  (exit 0)
$ ffmpeg -nostdin -hide_banner -v error -i <artifact> -f null -     (exit 0)
```

**已修正**：探测条目加入 `codec_type`；用例现在**正面断言**音频事实（音频流存在、48000 Hz、>29 s）。

## 哪些工件可以采信

- **可采信**：`…-n1n2-claude-053-real-export-003.mp4`（5 个）与 `manifest-*-3.json`，
  以及两份迁移导出的 manifest `manifest-mig03-migration-export-1.json`、
  `manifest-en05-migration-export-1.json`（它们的 `-1` 是 capture 003 产生的，`capture_id` 字段写明 `…-003`）。
  每一个工件的**文件名 sha 前缀 = 独立 sha256sum = manifest 的 artifact.sha256**，且已通过完整 ffmpeg decode。
- **不可采信**：`mig03-export-first-bbf30366cec4.mp4`（capture 001，名实不符，见缺陷 1）。
- **音频字段不可采信**：capture 001 / 002 产生的那六份 manifest
  （`manifest-mig03-export-first-1/2.json`、`manifest-mig03-export-after-middle-edit-1/2.json`、
  `manifest-en05-export-copy-after-rollback-1/2.json`）里的 `media.audio`（见缺陷 2）；
  同名的 `-3.json` 与两份迁移导出的 `-1.json` 的 `media.audio` 是真实值。
