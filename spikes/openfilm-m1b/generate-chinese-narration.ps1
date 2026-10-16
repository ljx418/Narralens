$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech
$output = Join-Path $PSScriptRoot "project\assets\narration-voice-raw.wav"
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $synth.SelectVoice("Microsoft Huihui Desktop")
  $synth.Rate = -1
  $synth.SetOutputToWaveFile($output)
  $lines = @(
    "56ys5LiA5bmV77yM5oiR5Lus5YWI5piO56Gu6L+Z5q616KeG6aKR55yf5q2j6ZyA6KaB5Zue562U55qE6Zeu6aKY44CC",
    "56ys5LqM5bmV77yM5oiR5Lus5q+U6L6D5LiJ56eN6KGo6L6+77yM6YCJ5oup57uT5p6E5pu05riF5pmw44CB6K+B5o2u5pu05YWF5YiG55qE5LiA56eN44CC",
    "56ys5LiJ5bmV77yM5oiR5Lus56Gu6K6k6ZWc5aS05LuN54S25Y+v5Lul57yW6L6R77yM5YaN5a6M5oiQ5Lqk5LuY44CC"
  )
  foreach ($line in $lines) {
    $synth.Speak([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($line)))
  }
} finally {
  $synth.Dispose()
}
Write-Output $output
