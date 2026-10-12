param(
  [Parameter(Mandatory = $true)][string]$TextPath,
  [Parameter(Mandatory = $true)][string]$OutputPath
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech

$text = [System.IO.File]::ReadAllText($TextPath, [System.Text.Encoding]::UTF8).Trim()
if ([string]::IsNullOrWhiteSpace($text)) {
  throw "Narration text is empty."
}

$outputDirectory = [System.IO.Path]::GetDirectoryName($OutputPath)
[System.IO.Directory]::CreateDirectory($outputDirectory) | Out-Null

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $voice = $synth.GetInstalledVoices() |
    Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq "zh-CN" } |
    Select-Object -First 1
  if ($null -eq $voice) {
    throw "No enabled zh-CN System.Speech voice is installed."
  }
  $synth.SelectVoice($voice.VoiceInfo.Name)
  $synth.Rate = -1
  $synth.Volume = 100
  $synth.SetOutputToWaveFile($OutputPath)
  $synth.Speak($text)
}
finally {
  $synth.Dispose()
}
