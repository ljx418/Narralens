param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$Host.UI.RawUI.WindowTitle = 'Narralens - Startup'
try {
    Write-Host 'Narralens | M5 isolated experience' -ForegroundColor Cyan
    Write-Host 'Checking prerequisites, building UI, warming media and starting services...'
    Write-Host 'Keep this window open. Close the Chrome experience window to stop services.'
    $portableRepo = $repo.Replace('\', '/')
    $linuxRepo = (& wsl.exe -d Ubuntu-24.04 -u administrator -- wslpath -u $portableRepo | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or !$linuxRepo.StartsWith('/')) { throw 'Cannot resolve repository in Ubuntu-24.04.' }
    $arguments = @('-d', 'Ubuntu-24.04', '-u', 'administrator', '--cd', $linuxRepo, '--', 'bash', '-lc', 'bash tools/launch-experience.sh')
    if ($CheckOnly) { $arguments[-1] += ' --check' }
    & wsl.exe @arguments
    if ($LASTEXITCODE -ne 0) { throw "Startup stopped (exit $LASTEXITCODE). See the message above." }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    if (!$CheckOnly) { Read-Host 'Press Enter to close' | Out-Null }
    exit 1
}
