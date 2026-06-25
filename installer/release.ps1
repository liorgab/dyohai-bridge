param([string]$Version = "")
$ErrorActionPreference = "Continue"

$repoRoot = Split-Path -Parent $PSScriptRoot
$extDir   = Join-Path $repoRoot "extension"
$buildDir = Join-Path $repoRoot "build"
$manifest = Join-Path $extDir "manifest.json"

if (-not $Version) {
    $m = Get-Content $manifest -Raw | ConvertFrom-Json
    $Version = $m.version
}
$tag = "v$Version"

Write-Host "Building release $tag..." -ForegroundColor Cyan
if (-not (Test-Path $buildDir)) { New-Item -ItemType Directory -Path $buildDir -Force | Out-Null }

# Staging folder with extension/ + install.ps1 + README
$stage = Join-Path $buildDir "stage-$tag"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage -Force | Out-Null
Copy-Item -Path "$extDir" -Destination "$stage\extension" -Recurse -Force
$daemonDir = Join-Path $repoRoot "daemon"
if (Test-Path $daemonDir) {
    Copy-Item -Path $daemonDir -Destination "$stage\daemon" -Recurse -Force
}
$bulkSenderDir = Join-Path $repoRoot "bulk-sender"
if (Test-Path $bulkSenderDir) {
    Copy-Item -Path $bulkSenderDir -Destination "$stage\bulk-sender" -Recurse -Force
}
foreach ($f in @("install.ps1","install.bat","update.ps1","doctor.ps1","README.md")) {
    $srcF = Join-Path $repoRoot $f
    if (Test-Path $srcF) { Copy-Item $srcF "$stage\$f" -Force }
}
$installerDir = Join-Path $repoRoot "installer"
if (Test-Path $installerDir) {
    Copy-Item -Path "$installerDir\*.ps1" -Destination $stage -Force -ErrorAction SilentlyContinue
}

$zipPath = Join-Path $buildDir "dyohai-bridge-$tag.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Write-Host "Creating ZIP..." -ForegroundColor Yellow
Compress-Archive -Path "$stage\*" -DestinationPath $zipPath -Force
$sizeKB = [math]::Round((Get-Item $zipPath).Length / 1024, 1)
Write-Host "  [OK] ZIP: $zipPath ($sizeKB KB)" -ForegroundColor Green
Remove-Item $stage -Recurse -Force

Push-Location $repoRoot
git push origin HEAD 2>$null | Out-Null
gh release delete $tag --yes 2>$null | Out-Null
gh release create $tag $zipPath --title $tag --notes "Release $tag - D.Yohai Bridge (with install.ps1)"
Pop-Location

Write-Host ""
Write-Host "DONE! Visit:" -ForegroundColor Green
Write-Host "  https://github.com/liorgab/dyohai-bridge/releases/tag/$tag" -ForegroundColor Cyan