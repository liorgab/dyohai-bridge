# =====================================================================
# D.Yohai Bridge - Uninstaller
# =====================================================================
# Removes everything that install.ps1 created:
#   - Stops + removes Bulk Sender Daemon
#   - Removes Task Scheduler entry
#   - Removes Chrome for Testing files
#   - Removes Native Helper + Chrome registry entries
#   - Removes Desktop shortcut
#   - Optionally: removes Chrome Test profile (keeps QR session)
#
# Does NOT remove:
#   - Python (might be used by other things)
#   - Regular Chrome
#   - The Chrome Extension (must be removed manually from chrome://extensions/)
#   - Base44 components (live in Base44 web app, not local)
#
# Usage:
#   .\uninstall.ps1                  # interactive
#   .\uninstall.ps1 -PurgeProfile    # also remove WhatsApp session
#   .\uninstall.ps1 -Yes             # skip confirmations
# =====================================================================

param(
    [switch]$PurgeProfile,
    [switch]$Yes
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Continue'

$INSTALL_BASE = "$env:LOCALAPPDATA\DYohaiBridge"
$DAEMON_BASE  = "$env:LOCALAPPDATA\DYohaiBulkSender"
$CFT_BASE     = "$env:LOCALAPPDATA\DYohaiChromeTest"
$NATIVE_BASE  = "$env:APPDATA\DYohaiNativeHelper"

function Write-Ok($msg)   { Write-Host "  ✅ $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  ⚠️  $msg" -ForegroundColor Yellow }
function Write-Info($msg) { Write-Host "  ℹ️  $msg" -ForegroundColor Gray }

function Confirm-Action($msg) {
    if ($Yes) { return $true }
    $ans = Read-Host "$msg [y/N]"
    return ($ans -match '^[yY]')
}

Write-Host ''
Write-Host '  ╔════════════════════════════════════════════════════════════╗' -ForegroundColor Red
Write-Host '  ║          D.Yohai Bridge - Uninstaller                       ║' -ForegroundColor Red
Write-Host '  ╚════════════════════════════════════════════════════════════╝' -ForegroundColor Red
Write-Host ''
Write-Host '  הפעולה תסיר:' -ForegroundColor White
Write-Host '    • את הדימון (Bulk Sender)' -ForegroundColor Gray
Write-Host '    • את Chrome for Testing' -ForegroundColor Gray
Write-Host '    • את ChromeDriver' -ForegroundColor Gray
Write-Host '    • את Task Scheduler entry (אם קיים)' -ForegroundColor Gray
Write-Host '    • את הקיצור על שולחן העבודה' -ForegroundColor Gray
Write-Host '    • את Native Messaging Helper' -ForegroundColor Gray
Write-Host ''
Write-Host '  לא יוסר:' -ForegroundColor White
Write-Host '    • Python (יכול להיות בשימוש על ידי דברים אחרים)' -ForegroundColor Gray
Write-Host '    • Chrome רגיל' -ForegroundColor Gray
Write-Host '    • ה-Extension (תסיר ידנית מ-chrome://extensions/)' -ForegroundColor Gray
Write-Host '    • קומפוננטות Base44 (חיים ב-Base44 SaaS)' -ForegroundColor Gray
Write-Host ''

if ($PurgeProfile) {
    Write-Host '  ⚠️  PurgeProfile - גם ה-WhatsApp session יימחק (תצטרך לסרוק QR שוב)' -ForegroundColor Yellow
}
Write-Host ''

if (-not (Confirm-Action 'בטוח שברצונך להמשיך?')) {
    Write-Host '  הופסק.' -ForegroundColor Gray
    exit 0
}

# ─── Stop daemon ────────────────────────────────────────────────────
Write-Host ''
Write-Host '  עוצר את הדימון...' -ForegroundColor Yellow
try {
    Invoke-RestMethod -Uri 'http://127.0.0.1:8765/shutdown' -Method POST -TimeoutSec 5 -UseBasicParsing | Out-Null
    Write-Ok 'הדימון נסגר'
    Start-Sleep -Seconds 2
} catch {
    Write-Info 'הדימון לא רץ'
}

Get-Process -Name 'python', 'pythonw' -ErrorAction SilentlyContinue | Where-Object {
    try { $_.CommandLine -match 'wa_bulk_daemon' } catch { $false }
} | ForEach-Object {
    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
}

# Kill any Chrome for Testing instances
Get-Process -Name 'chrome' -ErrorAction SilentlyContinue | Where-Object {
    try { $_.Path -like "*DYohaiChromeTest*" -or $_.Path -like "*SeleniumBasic*" } catch { $false }
} | ForEach-Object {
    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
}

# ─── Remove Task Scheduler entry ────────────────────────────────────
Write-Host ''
Write-Host '  מסיר Task Scheduler entry...' -ForegroundColor Yellow
$result = schtasks /Delete /TN 'DYohaiBulkSenderDaemon' /F 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Ok 'הוסר'
} else {
    Write-Info 'לא היה רשום (או כבר הוסר)'
}

# ─── Remove desktop shortcut ───────────────────────────────────────
$desktop = [System.Environment]::GetFolderPath('Desktop')
$shortcut = "$desktop\D.Yohai Bulk Sender.lnk"
if (Test-Path $shortcut) {
    Remove-Item $shortcut -Force
    Write-Ok 'קיצור שולחן העבודה הוסר'
}

# ─── Remove daemon files ───────────────────────────────────────────
Write-Host ''
Write-Host '  מוחק קבצי דימון...' -ForegroundColor Yellow
if (Test-Path $DAEMON_BASE) {
    if ($PurgeProfile) {
        Remove-Item $DAEMON_BASE -Recurse -Force -ErrorAction SilentlyContinue
        Write-Ok "$DAEMON_BASE הוסר (כולל profile)"
    } else {
        # Keep the profile dir so user doesn't need to re-scan QR if reinstalls
        Get-ChildItem $DAEMON_BASE -Exclude 'profile' | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
        Write-Ok "$DAEMON_BASE - קבצים הוסרו (profile נשמר)"
    }
} else {
    Write-Info 'לא קיים'
}

# ─── Remove Chrome for Testing ─────────────────────────────────────
Write-Host ''
Write-Host '  מוחק Chrome for Testing...' -ForegroundColor Yellow
if (Test-Path $CFT_BASE) {
    Remove-Item $CFT_BASE -Recurse -Force -ErrorAction SilentlyContinue
    Write-Ok "$CFT_BASE הוסר"
} else {
    Write-Info 'לא קיים'
}

# Also try the legacy SeleniumBasic location
$legacy = "$env:LOCALAPPDATA\SeleniumBasic\chrome-win64"
if (Test-Path $legacy) {
    if (Confirm-Action "    מצאתי גם $legacy - להסיר?") {
        Remove-Item $legacy -Recurse -Force -ErrorAction SilentlyContinue
        Write-Ok "$legacy הוסר"
    }
}

# ─── Remove Native Helper ──────────────────────────────────────────
Write-Host ''
Write-Host '  מסיר Native Messaging Helper...' -ForegroundColor Yellow
if (Test-Path $NATIVE_BASE) {
    Remove-Item $NATIVE_BASE -Recurse -Force -ErrorAction SilentlyContinue
    Write-Ok "$NATIVE_BASE הוסר"
}
$regKey = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.dyohai.nativehelper'
if (Test-Path $regKey) {
    Remove-Item $regKey -Recurse -Force -ErrorAction SilentlyContinue
    Write-Ok 'רישום ב-Chrome registry הוסר'
}

# ─── Remove install metadata ───────────────────────────────────────
Write-Host ''
Write-Host '  מוחק metadata...' -ForegroundColor Yellow
if (Test-Path $INSTALL_BASE) {
    Remove-Item $INSTALL_BASE -Recurse -Force -ErrorAction SilentlyContinue
    Write-Ok "$INSTALL_BASE הוסר"
}

# ─── Done ──────────────────────────────────────────────────────────
Write-Host ''
Write-Host '  ╔════════════════════════════════════════════════════════════╗' -ForegroundColor Green
Write-Host '  ║          ✅ הסרה הושלמה                                     ║' -ForegroundColor Green
Write-Host '  ╚════════════════════════════════════════════════════════════╝' -ForegroundColor Green
Write-Host ''
Write-Host '  הצעדים הידניים שנשארו לך:' -ForegroundColor White
Write-Host '    1. הסר את ה-Extension מ-chrome://extensions/' -ForegroundColor Gray
Write-Host '    2. הסר/החזר את הקומפוננטות ב-Base44 לקדמותן' -ForegroundColor Gray
Write-Host ''
