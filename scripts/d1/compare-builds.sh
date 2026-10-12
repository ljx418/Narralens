#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <baseline.mp4> <modified.mp4>" >&2
  exit 2
fi

baseline="$1"
modified="$2"
for media in "$baseline" "$modified"; do
  [[ -f "$media" ]] || { echo "missing media: $media" >&2; exit 2; }
done

frame_hash() {
  local media="$1" frame="$2"
  ffmpeg -hide_banner -loglevel error -i "$media" \
    -vf "select=eq(n\\,$frame)" -vsync 0 -frames:v 1 -f rawvideo -pix_fmt rgb24 - \
    | sha256sum | awk '{print $1}'
}

frame_metrics() {
  local frame="$1"
  local log
  log="$(mktemp)"
  ffmpeg -hide_banner -loglevel info -i "$baseline" -i "$modified" \
    -filter_complex "[0:v]select=eq(n\\,$frame),setpts=N/FRAME_RATE/TB[a];[1:v]select=eq(n\\,$frame),setpts=N/FRAME_RATE/TB[b];[a][b]ssim" \
    -frames:v 1 -f null - 2>"$log"
  ffmpeg -hide_banner -loglevel info -i "$baseline" -i "$modified" \
    -filter_complex "[0:v]select=eq(n\\,$frame),setpts=N/FRAME_RATE/TB[a];[1:v]select=eq(n\\,$frame),setpts=N/FRAME_RATE/TB[b];[a][b]psnr" \
    -frames:v 1 -f null - 2>>"$log"
  python3 - "$log" <<'PY'
import re, sys
text = open(sys.argv[1], encoding="utf-8", errors="replace").read()
ssim = re.search(r"All:([0-9.]+)", text)
psnr = re.search(r"average:([0-9.]+|inf)", text)
if not ssim or not psnr:
    raise SystemExit("metrics missing from ffmpeg output")
print(f"{ssim.group(1)}\t{psnr.group(1)}")
PY
  rm -f "$log"
}

audio_hash() {
  local media="$1"
  ffmpeg -hide_banner -loglevel error -i "$media" -map 0:a:0 \
    -f s16le -acodec pcm_s16le -ar 48000 -ac 2 - | sha256sum | awk '{print $1}'
}

printf 'kind\tframe\ttimestamp\tbaseline_sha256\tmodified_sha256\tequal\tssim\tpsnr_db\texpected\tpass\n'
for sample in '150 5.000 non-target' '300 10.000 target' '450 15.000 target' '599 19.967 target' '750 25.000 non-target'; do
  read -r frame timestamp expected <<<"$sample"
  before="$(frame_hash "$baseline" "$frame")"
  after="$(frame_hash "$modified" "$frame")"
  equal=false
  [[ "$before" == "$after" ]] && equal=true
  read -r ssim psnr <<<"$(frame_metrics "$frame")"
  pass="$(python3 - "$expected" "$ssim" "$psnr" <<'PY'
import math, sys
kind, ssim, psnr = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
ok = (ssim >= .995 and psnr >= 40) if kind == "non-target" else (ssim < .995 and psnr < 40)
print(str(ok).lower())
PY
)"
  printf 'frame\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$frame" "$timestamp" "$before" "$after" "$equal" "$ssim" "$psnr" "$expected" "$pass"
  [[ "$pass" == true ]] || exit 1
done

before_audio="$(audio_hash "$baseline")"
after_audio="$(audio_hash "$modified")"
audio_equal=false
[[ "$before_audio" == "$after_audio" ]] && audio_equal=true
printf 'audio\tall\tfull\t%s\t%s\t%s\t-\t-\tnon-target\t%s\n' \
  "$before_audio" "$after_audio" "$audio_equal" "$audio_equal"
[[ "$audio_equal" == true ]]
