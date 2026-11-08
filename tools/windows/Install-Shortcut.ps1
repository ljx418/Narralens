$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$iconPath = Join-Path $PSScriptRoot 'Narralens.ico'
Add-Type -AssemblyName System.Drawing
$bitmap = New-Object Drawing.Bitmap 64,64
$graphics = [Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = 'AntiAlias'
$graphics.Clear([Drawing.Color]::FromArgb(32,59,73))
$pen = New-Object Drawing.Pen ([Drawing.Color]::FromArgb(110,225,204)),4
$graphics.DrawEllipse($pen,10,10,44,44)
$brush = New-Object Drawing.SolidBrush ([Drawing.Color]::White)
$points = [Drawing.Point[]]@((New-Object Drawing.Point 26,20),(New-Object Drawing.Point 26,44),(New-Object Drawing.Point 45,32))
$graphics.FillPolygon($brush,$points)
$handle = $bitmap.GetHicon()
$icon = [Drawing.Icon]::FromHandle($handle)
$stream = [IO.File]::Create($iconPath)
try { $icon.Save($stream) } finally { $stream.Dispose(); $icon.Dispose(); $graphics.Dispose(); $pen.Dispose(); $brush.Dispose(); $bitmap.Dispose() }
$shell = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'Narralens.lnk'
if (Test-Path $shortcutPath) { throw "Shortcut already exists; preserved: $shortcutPath" }
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $repo 'Narralens.cmd'
$shortcut.WorkingDirectory = $repo
$shortcut.IconLocation = "$iconPath,0"
$shortcut.Description = 'Narralens - Start M5 local experience and warm services'
$shortcut.Save()
Write-Host "Created: $shortcutPath"
