# install.ps1 - Base44 Bridge Native Helper Installer
# =======================================================
# Registers the Python helper with Chrome as a native messaging host.
#
# Usage (run in PowerShell, no admin needed - writes to HKCU):
#   cd "C:\Users\<you>\...\piba-bridge-extension\native-helper"
#   .\install.ps1 -ExtensionId "pgldaakahpcnofopcaglfppigpngpkol"
#
# To find your Extension ID:
#   chrome://extensions/ → find "Base44 Bridge" → copy the ID

param(
  [Parameter(Mandatory=$true)][string]$ExtensionId
)

$ErrorActionPreference = 'Stop'

Write-Host "`n=== Base44 Bridge Native Helper Installer ===" -ForegroundColor Cyan

# ─── 1. Verify Python is installed ─────────────────────────────────
Write-Host "`n[1/5] Checking Python..."
try {
  $pythonVersion = & python --version 2>&1
  Write-Host "  Found: $pythonVersion" -ForegroundColor Green
} catch {
  Write-Host "  ❌ Python not found in PATH" -ForegroundColor Red
  Write-Host "  Install from https://www.python.org/downloads/ (check 'Add to PATH')"
  exit 1
}

# ─── 2. Install required Python packages ──────────────────────────
Write-Host "`n[2/5] Installing Python dependencies (pywin32, pyautogui)..."
try {
  & python -m pip install --quiet --upgrade pywin32 pyautogui
  Write-Host "  ✓ Installed" -ForegroundColor Green
} catch {
  Write-Host "  ❌ pip install failed" -ForegroundColor Red
  Write-Host "  Try manually: python -m pip install pywin32 pyautogui"
  exit 1
}

# ─── 3. Determine paths ──────────────────────────────────────────
$helperDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$batPath     = Join-Path $helperDir 'base44_native_helper.bat'
$pyPath      = Join-Path $helperDir 'base44_native_helper.py'
$manifestSrc = Join-Path $helperDir 'com.base44.bridge.json'

# Native manifests go in AppData\Local (no admin required)
$manifestDir = "$env:LOCALAPPDATA\Base44Bridge"
$manifestDst = Join-Path $manifestDir 'com.base44.bridge.json'

Write-Host "`n[3/5] Paths:"
Write-Host "  Helper:   $batPath"
Write-Host "  Manifest: $manifestDst"

if (-not (Test-Path $batPath)) {
  Write-Host "  ❌ Helper not found at $batPath" -ForegroundColor Red
  exit 1
}
if (-not (Test-Path $pyPath)) {
  Write-Host "  ❌ Python script not found at $pyPath" -ForegroundColor Red
  exit 1
}

# ─── 4. Create manifest with real paths and extension ID ──────────
Write-Host "`n[4/5] Writing native messaging manifest..."

if (-not (Test-Path $manifestDir)) {
  New-Item -ItemType Directory -Path $manifestDir | Out-Null
}

$manifestTemplate = Get-Content $manifestSrc -Raw
$manifestFinal = $manifestTemplate `
  -replace 'BAT_PATH_PLACEHOLDER', $batPath.Replace('\', '\\') `
  -replace 'EXTENSION_ID_PLACEHOLDER', $ExtensionId

Set-Content -Path $manifestDst -Value $manifestFinal -Encoding UTF8
Write-Host "  ✓ Wrote $manifestDst" -ForegroundColor Green

# ─── 5. Register in Chrome's registry (HKCU for current user) ─────
Write-Host "`n[5/5] Registering with Chrome..."

$regPath = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.base44.bridge'
if (-not (Test-Path $regPath)) {
  New-Item -Path $regPath -Force | Out-Null
}
Set-ItemProperty -Path $regPath -Name '(Default)' -Value $manifestDst
Write-Host "  ✓ Registered at $regPath" -ForegroundColor Green

Write-Host "`n✅ Installation complete!" -ForegroundColor Green
Write-Host "`nNext steps:"
Write-Host "  1. Restart Chrome (fully close and reopen)"
Write-Host "  2. Reload the extension at chrome://extensions/"
Write-Host "  3. Test with the 'Send WhatsApp with PDF' button in Base44"
Write-Host ""
Write-Host "To uninstall later, run: .\uninstall.ps1"
