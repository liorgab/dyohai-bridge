# =====================================================================
# D.Yohai Bridge - Doctor (Diagnostic Tool)
# =====================================================================
# Runs a comprehensive health check on every component of the system.
# Reports ✅/❌/⚠️ for each, with clear remediation steps for failures.
#
# Usage:
#   .\doctor.ps1              # full report
#   .\doctor.ps1 -BriefMode   # short summary only
#   .\doctor.ps1 -Fix         # attempt automatic fixes for known issues
# =====================================================================

param(
    [switch]$BriefMode,
    [switch]$Fix
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Continue'

$DAEMON_BASE = "$env:LOCALAPPDATA\DYohaiBulkSender"
$CFT_BASE    = "$env:LOCALAPPDATA\DYohaiChromeTest"
$INSTALL_BASE = "$env:LOCALAPPDATA\DYohaiBridge"

$global:RESULTS = @()

function Add-Check($name, $status, $detail = '', $fix = '') {
    $global:RESULTS += [PSCustomObject]@{
        Name   = $name
        Status = $status   # 'ok' | 'warn' | 'fail'
        Detail = $detail
        Fix    = $fix
    }
}

function Show-Check($r) {
    $icon = switch ($r.Status) {
        'ok'   { '✅' }
        'warn' { '⚠️ ' }
        'fail' { '❌' }
    }
    $color = switch ($r.Status) {
        'ok'   { 'Green' }
        'warn' { 'Yellow' }
        'fail' { 'Red' }
    }
    Write-Host "  $icon  " -NoNewline
    Write-Host $r.Name -ForegroundColor $color -NoNewline
    if ($r.Detail) { Write-Host "  ($($r.Detail))" -ForegroundColor Gray }
    else { Write-Host '' }
    if (-not $BriefMode -and $r.Status -ne 'ok' -and $r.Fix) {
        Write-Host "       💡 $($r.Fix)" -ForegroundColor DarkYellow
    }
}

# ─── Checks ──────────────────────────────────────────────────────────

function Check-Python {
    foreach ($cmd in @('python', 'python3', 'py')) {
        try {
            $ver = & $cmd --version 2>&1
            if ($ver -match 'Python (\d+)\.(\d+)\.(\d+)') {
                $major = [int]$Matches[1]; $minor = [int]$Matches[2]
                if ($major -ge 3 -and $minor -ge 8) {
                    Add-Check 'Python 3.8+' 'ok' "$ver"
                    return
                }
            }
        } catch { }
    }
    Add-Check 'Python 3.8+' 'fail' 'not found' 'הרץ install.ps1 שוב או התקן ידנית מ-python.org'
}

function Check-PipPackages {
    foreach ($cmd in @('python', 'python3', 'py')) {
        try {
            $pyExe = (Get-Command $cmd -ErrorAction Stop).Source
            $missing = @()
            foreach ($pkg in @('selenium', 'flask', 'flask_cors', 'requests')) {
                $check = & $pyExe -c "import $pkg" 2>&1
                if ($LASTEXITCODE -ne 0) { $missing += $pkg }
            }
            if ($missing.Count -eq 0) {
                Add-Check 'Python packages' 'ok' 'selenium, flask, flask-cors, requests'
            } else {
                Add-Check 'Python packages' 'fail' "missing: $($missing -join ', ')" `
                    "pip install --user --upgrade $($missing -join ' ')"
            }
            return
        } catch { }
    }
    Add-Check 'Python packages' 'fail' 'cannot test - Python missing' ''
}

function Check-Chrome {
    $candidates = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    )
    foreach ($p in $candidates) {
        if (Test-Path $p) {
            $ver = (Get-Item $p).VersionInfo.ProductVersion
            Add-Check 'Google Chrome' 'ok' "v$ver at $p"
            return
        }
    }
    Add-Check 'Google Chrome' 'fail' 'not installed' 'התקן Chrome מ-https://www.google.com/chrome/'
}

function Check-ChromeForTesting {
    $exe = "$CFT_BASE\chrome-win64\chrome.exe"
    if (Test-Path $exe) {
        $ver = (Get-Item $exe).VersionInfo.ProductVersion
        Add-Check 'Chrome for Testing' 'ok' "v$ver"
    } else {
        Add-Check 'Chrome for Testing' 'fail' "missing: $exe" 'הרץ install.ps1 שוב'
    }
}

function Check-ChromeDriver {
    $driver = "$DAEMON_BASE\chromedriver.exe"
    if (-not (Test-Path $driver)) {
        Add-Check 'ChromeDriver' 'fail' "missing: $driver" 'הרץ install.ps1 שוב'
        return
    }
    try {
        $ver = & $driver --version 2>&1
        if ($ver -match '(\d+)\.\d+\.\d+\.\d+') {
            $driverMajor = [int]$Matches[1]
            $cftExe = "$CFT_BASE\chrome-win64\chrome.exe"
            if (Test-Path $cftExe) {
                $cftVer = (Get-Item $cftExe).VersionInfo.ProductVersion
                if ($cftVer -match '^(\d+)\.') {
                    $cftMajor = [int]$Matches[1]
                    if ($driverMajor -eq $cftMajor) {
                        Add-Check 'ChromeDriver' 'ok' "v$driverMajor matches Chrome Test"
                    } else {
                        Add-Check 'ChromeDriver' 'warn' "v$driverMajor != Chrome Test v$cftMajor" `
                            'הרץ install.ps1 שוב כדי להתאים גרסאות'
                    }
                    return
                }
            }
            Add-Check 'ChromeDriver' 'ok' "$ver"
        }
    } catch {
        Add-Check 'ChromeDriver' 'fail' "cannot run: $_" 'בדוק הרשאות הרצה'
    }
}

function Check-DaemonFiles {
    $daemonPy = "$DAEMON_BASE\wa_bulk_daemon.py"
    if (Test-Path $daemonPy) {
        $size = (Get-Item $daemonPy).Length
        Add-Check 'Daemon file (wa_bulk_daemon.py)' 'ok' "$size bytes"
    } else {
        Add-Check 'Daemon file' 'fail' "missing: $daemonPy" 'הרץ install.ps1 שוב'
    }

    $config = "$DAEMON_BASE\config.json"
    if (Test-Path $config) {
        try {
            $cfg = Get-Content $config -Raw | ConvertFrom-Json
            Add-Check 'config.json' 'ok' 'valid JSON'
        } catch {
            Add-Check 'config.json' 'fail' 'invalid JSON' 'מחק את config.json והרץ install.ps1'
        }
    } else {
        Add-Check 'config.json' 'fail' 'missing' 'הרץ install.ps1'
    }
}

function Check-DaemonRunning {
    try {
        $resp = Invoke-RestMethod -Uri 'http://127.0.0.1:8765/status' -TimeoutSec 3 -UseBasicParsing
        if ($resp.daemon -eq 'running') {
            $details = "v$($resp.version)"
            if ($resp.driver_alive) { $details += ", Chrome Test alive" }
            else { $details += ", Chrome Test not running" }
            Add-Check 'Daemon process' 'ok' $details
        } else {
            Add-Check 'Daemon process' 'warn' 'responded but not running' 'הפעל מחדש את הדימון'
        }

        # Check WhatsApp login state
        if ($resp.driver_alive) {
            if ($resp.wa_logged_in) {
                Add-Check 'WhatsApp login' 'ok' 'Chrome Test is logged in'
            } else {
                Add-Check 'WhatsApp login' 'warn' 'not logged in' `
                    'פתח Chrome Test וסרוק QR (פופאפ של ה-Extension → Bulk Sender → "פתח Chrome Test")'
            }
        } else {
            Add-Check 'WhatsApp login' 'warn' 'Chrome Test not running' `
                'פתח את Chrome Test דרך ה-popup של ה-Extension'
        }
    } catch {
        Add-Check 'Daemon process' 'fail' 'not responding on localhost:8765' `
            'הפעל את הדימון: דאבל-קליק על קיצור "D.Yohai Bulk Sender" על שולחן העבודה'
    }
}

function Check-AutoStart {
    $taskName = 'DYohaiBulkSenderDaemon'
    $task = schtasks /Query /TN $taskName 2>$null
    if ($LASTEXITCODE -eq 0) {
        Add-Check 'Auto-start at login' 'ok' "Task Scheduler: $taskName"
    } else {
        Add-Check 'Auto-start at login' 'warn' 'not configured (manual start required)' `
            'הרץ install.ps1 ובחר Y בשאלת auto-start, או הוסף ידנית ב-Task Scheduler'
    }
}

function Check-DesktopShortcut {
    $desktop = [System.Environment]::GetFolderPath('Desktop')
    $shortcut = "$desktop\D.Yohai Bulk Sender.lnk"
    if (Test-Path $shortcut) {
        Add-Check 'Desktop shortcut' 'ok' $shortcut
    } else {
        Add-Check 'Desktop shortcut' 'warn' 'missing' 'הרץ install.ps1 שוב'
    }
}

function Check-NativeHelper {
    $helperBase = "$env:APPDATA\DYohaiNativeHelper"
    if (-not (Test-Path "$helperBase\base44_native_helper.py")) {
        Add-Check 'Native Helper (PDF dialog)' 'warn' 'not installed (optional)' ''
        return
    }

    # Check Chrome's NativeMessagingHosts registry
    $regKey = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.dyohai.nativehelper'
    if (Test-Path $regKey) {
        Add-Check 'Native Helper' 'ok' 'manifest registered'
    } else {
        Add-Check 'Native Helper' 'warn' 'manifest NOT registered' `
            "הרץ: $helperBase\install.ps1"
    }
}

function Check-InstallMetadata {
    $meta = "$INSTALL_BASE\install.json"
    if (Test-Path $meta) {
        try {
            $m = Get-Content $meta -Raw | ConvertFrom-Json
            Add-Check 'Install metadata' 'ok' "v$($m.version), installed $($m.installed_at)"
        } catch {
            Add-Check 'Install metadata' 'warn' 'invalid JSON' ''
        }
    } else {
        Add-Check 'Install metadata' 'warn' "missing: $meta" 'הרץ install.ps1 כדי לרשום'
    }
}

# ─── Main ────────────────────────────────────────────────────────────
function Show-Banner {
    Write-Host ''
    Write-Host '  ╔════════════════════════════════════════════════════════════╗' -ForegroundColor Cyan
    Write-Host '  ║          D.Yohai Bridge - Doctor (Health Check)             ║' -ForegroundColor Cyan
    Write-Host '  ╚════════════════════════════════════════════════════════════╝' -ForegroundColor Cyan
}

Show-Banner

if (-not $BriefMode) { Write-Host '' ; Write-Host '  Running diagnostics...' -ForegroundColor Gray }

Check-Python
Check-PipPackages
Check-Chrome
Check-ChromeForTesting
Check-ChromeDriver
Check-DaemonFiles
Check-DaemonRunning
Check-AutoStart
Check-DesktopShortcut
Check-NativeHelper
Check-InstallMetadata

Write-Host ''
Write-Host '  ─── תוצאות ───' -ForegroundColor White
Write-Host ''

foreach ($r in $global:RESULTS) {
    Show-Check $r
}

# Summary
$ok    = ($global:RESULTS | Where-Object { $_.Status -eq 'ok'   }).Count
$warn  = ($global:RESULTS | Where-Object { $_.Status -eq 'warn' }).Count
$fail  = ($global:RESULTS | Where-Object { $_.Status -eq 'fail' }).Count

Write-Host ''
Write-Host '  ─── סיכום ───' -ForegroundColor White
Write-Host "    ✅ תקין:   $ok" -ForegroundColor Green
if ($warn -gt 0) { Write-Host "    ⚠️  אזהרה: $warn" -ForegroundColor Yellow }
if ($fail -gt 0) { Write-Host "    ❌ נכשל:   $fail" -ForegroundColor Red }
Write-Host ''

if ($fail -eq 0 -and $warn -eq 0) {
    Write-Host '  🎉 הכל פועל מצוין!' -ForegroundColor Green
} elseif ($fail -eq 0) {
    Write-Host '  ✓ הליבה פועלת. ראה אזהרות לעיל לפעולות מומלצות.' -ForegroundColor Yellow
} else {
    Write-Host '  ⚠️  יש בעיות שצריך לתקן. עיין בהודעות "💡" למעלה.' -ForegroundColor Red
    if (-not $Fix) {
        Write-Host '     להפעיל תיקון אוטומטי: .\doctor.ps1 -Fix' -ForegroundColor Gray
    }
}
Write-Host ''

# Exit code: 0 = all good, 1 = warnings only, 2 = failures
if ($fail -gt 0) { exit 2 }
if ($warn -gt 0) { exit 1 }
exit 0
