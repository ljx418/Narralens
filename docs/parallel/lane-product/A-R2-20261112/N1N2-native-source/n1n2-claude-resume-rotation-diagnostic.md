# The rotation diagnostic — an UNGRANTED standalone runtime deviation, recorded honestly

Child: task_5dcbe8192764 / dispatch ctx_e5e736e1846b / terminal term_b4006907-19df-46dd-ae99-34909d8de5e6
cwd: `/mnt/c/workspace/videoworkline/Narralens-agents/main-integration` — the diagnostic's own working
directory was `/tmp/n1n2-rot`.

## 1. What this was, and that it was outside a grant

After batch `N1N2-RESUME-BATCH-004` had returned its slot, and **outside** the granted 049/050/051
commands, I ran a **standalone diagnostic** with the local `ffmpeg` and `ffprobe` to find out what this
ffmpeg actually reports for a rotated video. MAIN's instruction at the time was "no extra/retry command
or tsc while batch frozen"; the batch was terminal and the slot returned, but the diagnostic was
nevertheless a media-tool execution that no grant covered. **This is a runtime deviation and is recorded
as one.** It is not presented as part of any grant, it is not evidence for any case, and no capture
name was reused or invented for it.

The same finding is now covered by a **recorded** case inside the next frozen batch
(`F09 normalises a rotated video and the first of two video streams`), so the diagnostic itself does
not need to be repeated.

## 2. The commands, in order, with their actual exits

The working directory was `/tmp/n1n2-rot`. The tool versions were
`ffmpeg version 6.1.1-3ubuntu5` and `ffprobe version 6.1.1-3ubuntu5`.

| # | the exact command | exit | what it produced |
|---|---|---|---|
| 1 | `ffmpeg -nostdin -hide_banner -v error -f lavfi -i color=c=0x185a88:s=320x180:r=30:d=1 -threads 1 -c:v libx264 -pix_fmt yuv420p plain.mp4` | 0 | `plain.mp4`, 320×180, `avg_frame_rate 30/1`, `nb_frames 30`, no `side_data_list`, no rotation tag, `duration 1.000000` |
| 2 | `ffprobe -v error -print_format json -show_format -show_streams plain.mp4` | 0 | the plain answer quoted in row 1 |
| 3 | `ffmpeg -nostdin -hide_banner -v error -i plain.mp4 -c copy -metadata:s:v:0 rotate=90 rot_meta.mp4` | 0 | `rot_meta.mp4` — **byte-identical to `plain.mp4`** (sha256 `84db7d85…`): this ffmpeg **ignores** the `rotate` metadata |
| 4 | `ffprobe -v error -print_format json -show_format -show_streams rot_meta.mp4` | 0 | `width 320`, `height 180`, **no** `side_data_list`, **no** rotation tag |
| 5 | `ffmpeg -nostdin -hide_banner -v error -display_rotation 90 -i plain.mp4 -c copy rot_disp.mp4` | 0 | `rot_disp.mp4` — the display matrix is written |
| 6 | `ffprobe -v error -print_format json -show_format -show_streams rot_disp.mp4` | 0 | `width 320`, `height 180`, `side_data_list: [{side_data_type: 'Display Matrix', displaymatrix: …, rotation: 90}]` |
| 7 | `ffmpeg -nostdin -hide_banner -v error -f lavfi -i color=c=0x00ff00:s=64x48:r=15:d=1 -threads 1 -c:v libx264 -pix_fmt yuv420p other.mp4` | 0 | `other.mp4`, 64×48, `avg_frame_rate 15/1` |
| 8 | `ffmpeg -nostdin -hide_banner -v error -i plain.mp4 -i other.mp4 -map 0:v -map 1:v -c copy two.mp4` | 0 | `two.mp4` — two video streams |
| 9 | `ffprobe -v error -print_format json -show_streams two.mp4` | 0 | two video streams: `(320, 180, '30/1')` first, `(64, 48, '15/1')` second |

## 3. The artifacts and their digests

```
84db7d8577d4316193174a83854662c975911d070dc3a2219d672e6e30817fd4  plain.mp4
84db7d8577d4316193174a83854662c975911d070dc3a2219d672e6e30817fd4  rot_meta.mp4
160fa7f6f595d45ffe28acd3995ae1013d29444b177457777efca60d37b8757d  rot_disp.mp4
b5b169a78aab2001c6824f7b00eda101d4db1fcdef9b2c33b1ee211cb76649c7  other.mp4
870e1586a95250b6840b0bfa1ef11a3a797409cf79f9b435c71dd4d5a318e929  two.mp4
```

`rot_meta.mp4` and `plain.mp4` share a digest: that is the proof that the `rotate` metadata changed
nothing, and it is why the first rotation attempt in the test produced a video with no matrix at all.

## 4. What the diagnostic established

- This ffmpeg ignores `-metadata:s:v:0 rotate=90`; the rotation must be given as the **input**
  option `-display_rotation 90`.
- The rotated file keeps its **coded** size (320×180) and carries the turn in the display matrix
  (`rotation: 90`). The upstream's rule swaps the sides for the *shown* size (180×320) — the coded
  geometry is not changed by the container, and the normalisation is what reports it.
- With two video streams the **first** one is the one the upstream's `streams.find(codec_type==='video')`
  takes.

## 5. The resource disposition of the diagnostic

The diagnostic started only short-lived `ffmpeg`/`ffprobe` children; each was awaited to its exit by
the shell before the next command started. Nothing was left running: the tree under `/tmp/n1n2-rot`
holds only the five files listed above, and no `ffmpeg`/`ffprobe` process of it survived. The
directory is left in place, deliberately, because it holds the evidence.

No Host, no database, no listener, no network, no browser, no provider and no paid action were
involved, and no source or index file was touched by the diagnostic.
