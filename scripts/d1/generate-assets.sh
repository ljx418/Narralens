#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fixture_root="$project_root/fixtures/d1-30s"
generated="$fixture_root/assets/generated"
mkdir -p "$generated"

for tool in wslpath powershell.exe ffmpeg ffprobe; do
  command -v "$tool" >/dev/null || {
    echo "D1 Chinese narration generation requires WSL, Windows PowerShell, System.Speech, ffmpeg and ffprobe; missing: $tool" >&2
    exit 2
  }
done

echo "note: Windows System.Speech output is real but not bit-stable across voices/OS versions; record the generated WAV hash per run" >&2

text_windows="$(wslpath -w "$fixture_root/narration.txt")"
speech_windows="$(wslpath -w "$generated/narration-raw.wav")"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(wslpath -w "$project_root/scripts/d1/generate-narration.ps1")" \
  -TextPath "$text_windows" -OutputPath "$speech_windows"

ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "testsrc2=size=1280x720:rate=30:duration=10" \
  -vf "drawbox=x=0:y=0:w=iw:h=110:color=0x07111f@0.90:t=fill,drawtext=text='Narralens D1 / real Hypit input':fontcolor=white:fontsize=36:x=42:y=34" \
  -an -c:v libx264 -preset veryfast -pix_fmt yuv420p -r 30 "$generated/visual-10s.mp4"

ffmpeg -hide_banner -loglevel error -y -i "$generated/narration-raw.wav" \
  -af "apad=pad_dur=30" -t 30 -ar 48000 -ac 2 -c:a pcm_s16le "$generated/narration-30s.wav"

ffprobe -v error -show_entries format=duration:stream=index,codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels \
  -of json "$generated/visual-10s.mp4"
ffprobe -v error -show_entries format=duration:stream=index,codec_type,codec_name,sample_rate,channels \
  -of json "$generated/narration-30s.wav"
