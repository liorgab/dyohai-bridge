# uninstall.ps1 - removes D.Yohai Bridge native helper from Chrome's registry
$ErrorActionPreference = 'Continue'
Write-Host "=== D.Yohai Bridge Native Helper Uninstaller ===" -ForegroundColor Cyan

$regPath = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.dyohai.bridge'
if (Test-Path $regPath) {
  Remove-Item -Path $regPath -Force
  Write-Host "✓ Removed registry key $regPath" -ForegroundColor Green
} else {
  Write-Host "  (registry key not found)" -ForegroundColor Yellow
}

$manifestDir = "$env:LOCALAPPDATA\DYohaiBridge"
if (Test-Path $manifestDir) {
  Remove-Item -Path $manifestDir -Recurse -Force
  Write-Host "✓ Removed manifest dir $manifestDir" -ForegroundColor Green
}

# Clean temp files
$tmpDir = Join-Path $env:TEMP 'base44_bridge'
if (Test-Path $tmpDir) {
  Remove-Item -Path $tmpDir -Recurse -Force
  Write-Host "✓ Cleaned temp files $tmpDir" -ForegroundColor Green
}

Write-Host "`n✅ Uninstalled. The Python script and helper files in this folder are untouched." -ForegroundColor Green
