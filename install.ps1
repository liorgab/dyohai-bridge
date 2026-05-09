# =====================================================================
# D.Yohai Bridge - Smart Installer
# =====================================================================
# Installs everything needed to run the Base44 Bridge ecosystem on Windows:
#   1. Python 3.12 (auto-install via winget → python.org fallback, USER-LEVEL)
#   2. Python packages (selenium, flask, flask-cors, requests)
#   3. Google Chrome (auto-install if missing)
#   4. Chrome for Testing (downloaded fresh, isolated for daemon use)
#   5. ChromeDriver (matching version)
#   6. Bulk Sender Daemon (Python + Flask + Selenium)
#   7. Desktop shortcut + optional auto-start at login
#   8. Native Messaging Helper (for PDF dialog automation)
#   9. Guides user through Extension load + Base44 components copy
#
# Designed to run WITHOUT admin elevation (user-level install everywhere).
# =====================================================================

param(
    [switch]$Quiet,
    [switch]$SkipPython,
    [switch]$SkipChrome,
    [switch]$SkipChromeForTesting,
    [switch]$SkipExtensionPrompt,
    [switch]$AutoStart,         # If set, skips the prompt and enables auto-start
    [switch]$NoAutoStart        # If set, skips the prompt and disables auto-start
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'  # speeds up Invoke-WebRequest

# Force UTF-8 for proper Hebrew rendering
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding           = [System.Text.Encoding]::UTF8

# ─── Constants ───────────────────────────────────────────────────────
$REPO_ROOT     = $PSScriptRoot
$INSTALL_BASE  = "$env:LOCALAPPDATA\DYohaiBridge"        # repo + scripts
$DAEMON_BASE   = "$env:LOCALAPPDATA\DYohaiBulkSender"    # daemon + chromedriver + profile
$CFT_BASE      = "$env:LOCALAPPDATA\DYohaiChromeTest"    # Chrome for Testing
$NATIVE_BASE   = "$env:APPDATA\DYohaiNativeHelper"       # Native Messaging Helper
$LOG_FILE      = "$env:TEMP\dyohai_install.log"

$PYTHON_VERSION_TARGET = '3.12.6'
$DAILY_CAP             = 150
$VERSION               = (Get-Content "$REPO_ROOT\VERSION" -ErrorAction SilentlyContinue | Select-Object -First 1)
if (-not $VERSION) { $VERSION = '1.0.0' }

# ─── Helpers ────────────────────────────────────────────────────────
function Write-Section($title) {
    Write-Host ''
    Write-Host ('═' * 64) -ForegroundColor DarkCyan
    Write-Host "  $title" -ForegroundColor Cyan
    Write-Host ('═' * 64) -ForegroundColor DarkCyan
}

function Write-Step($idx, $total, $msg) {
    Write-Host ''
    Write-Host "[$idx/$total] $msg" -ForegroundColor Yellow
}

function Write-Ok($msg)    { Write-Host "      ✅ $msg" -ForegroundColor Green }
function Write-Warn($msg)  { Write-Host "      ⚠️  $msg" -ForegroundColor Yellow }
function Write-Err($msg)   { Write-Host "      ❌ $msg" -ForegroundColor Red }
function Write-Info($msg)  { Write-Host "      ℹ️  $msg" -ForegroundColor Gray }

function Log($msg) {
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
    Add-Content -Path $LOG_FILE -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue
}

function Test-Command($name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

function Refresh-Path {
    # Re-read PATH from registry so newly installed binaries are findable in this session
    $machinePath = [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath    = [System.Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path    = "$machinePath;$userPath"
}

function Confirm-YesNo($question, $default = 'Y') {
    if ($Quiet) { return ($default -eq 'Y') }
    $opts = if ($default -eq 'Y') { '[Y/n]' } else { '[y/N]' }
    $ans = Read-Host "$question $opts"
    if ([string]::IsNullOrWhiteSpace($ans)) { $ans = $default }
    return ($ans -match '^[yY]')
}

# ─── Pre-flight ─────────────────────────────────────────────────────
function Show-Banner {
    Clear-Host
    Write-Host ''
    Write-Host '  ╔════════════════════════════════════════════════════════════╗' -ForegroundColor Cyan
    Write-Host '  ║                                                            ║' -ForegroundColor Cyan
    Write-Host '  ║          D.Yohai Bridge - Smart Installer                   ║' -ForegroundColor Cyan
    Write-Host "  ║                  Version $VERSION                            ║" -ForegroundColor Cyan
    Write-Host '  ║                                                            ║' -ForegroundColor Cyan
    Write-Host '  ║   PIBA · HopOn · WhatsApp · Bulk Sender Daemon             ║' -ForegroundColor Cyan
    Write-Host '  ║                                                            ║' -ForegroundColor Cyan
    Write-Host '  ╚════════════════════════════════════════════════════════════╝' -ForegroundColor Cyan
    Write-Host ''
    Write-Host '  Log file: ' -NoNewline -ForegroundColor Gray
    Write-Host $LOG_FILE -ForegroundColor White
    Write-Host '  Repo:     ' -NoNewline -ForegroundColor Gray
    Write-Host $REPO_ROOT -ForegroundColor White
    Write-Host ''
}

function Test-WindowsVersion {
    $osv = [System.Environment]::OSVersion.Version
    if ($osv.Major -lt 10) {
        Write-Err "Windows 10 or 11 required. Detected: $($osv.Major).$($osv.Minor)"
        exit 1
    }
    Write-Ok "Windows $($osv.Major) detected"
}

# ─── Step: Python ────────────────────────────────────────────────────
function Install-PythonViaWinget {
    if (-not (Test-Command 'winget')) {
        return $false
    }
    Write-Info 'Trying winget install Python.Python.3.12...'
    try {
        $proc = Start-Process -FilePath 'winget' `
            -ArgumentList @('install', '-e', '--id', 'Python.Python.3.12',
                            '--accept-package-agreements', '--accept-source-agreements',
                            '--scope', 'user', '--silent') `
            -Wait -PassThru -NoNewWindow
        if ($proc.ExitCode -eq 0) {
            Refresh-Path
            return $true
        }
    } catch {
        Log "winget install failed: $_"
    }
    return $false
}

function Install-PythonDirect {
    Write-Info "Downloading Python $PYTHON_VERSION_TARGET from python.org..."
    $url     = "https://www.python.org/ftp/python/$PYTHON_VERSION_TARGET/python-$PYTHON_VERSION_TARGET-amd64.exe"
    $exePath = "$env:TEMP\python-installer.exe"
    try {
        Invoke-WebRequest -Uri $url -OutFile $exePath -UseBasicParsing
    } catch {
        Write-Err "Download failed: $_"
        return $false
    }

    Write-Info 'Running silent user-level install (no admin needed)...'
    # User-level install, prepend to PATH, include pip, no documentation
    $args = @(
        '/quiet',
        'InstallAllUsers=0',
        'PrependPath=1',
        'Include_pip=1',
        'Include_test=0',
        'Include_doc=0',
        'Include_launcher=0',
        'SimpleInstall=1'
    )
    $proc = Start-Process -FilePath $exePath -ArgumentList $args -Wait -PassThru
    Remove-Item $exePath -ErrorAction SilentlyContinue

    if ($proc.ExitCode -ne 0) {
        Write-Err "Python installer exited with code $($proc.ExitCode)"
        return $false
    }
    Refresh-Path
    return $true
}

function Find-Python {
    foreach ($cmd in @('python', 'python3', 'py')) {
        try {
            $ver = & $cmd --version 2>&1
            if ($ver -match 'Python (\d+)\.(\d+)\.(\d+)') {
                $major = [int]$Matches[1]
                $minor = [int]$Matches[2]
                if ($major -ge 3 -and $minor -ge 8) {
                    $exe = (Get-Command $cmd).Source
                    return @{ Exe = $exe; Version = "$major.$minor.$($Matches[3])" }
                }
            }
        } catch { }
    }
    return $null
}

function Step-Python($idx, $total) {
    Write-Step $idx $total 'בודק Python 3.8+...'

    if ($SkipPython) {
        Write-Warn 'דילוג על Python (פרמטר -SkipPython)'
        return Find-Python
    }

    $py = Find-Python
    if ($py) {
        Write-Ok "Python $($py.Version) found at $($py.Exe)"
        return $py
    }

    Write-Warn 'Python לא נמצא במערכת. מנסה התקנה אוטומטית...'

    $installed = $false
    if (Install-PythonViaWinget) {
        Refresh-Path
        $py = Find-Python
        if ($py) {
            Write-Ok "Python $($py.Version) installed via winget"
            return $py
        }
        Write-Warn 'winget סיים אבל Python לא נמצא ב-PATH - מנסה התקנה ישירה'
    }

    if (Install-PythonDirect) {
        Refresh-Path
        $py = Find-Python
        if ($py) {
            Write-Ok "Python $($py.Version) installed from python.org"
            return $py
        }
    }

    Write-Err 'התקנה אוטומטית נכשלה'
    Write-Host ''
    Write-Host '   הורד והתקן ידנית מ:' -ForegroundColor Yellow
    Write-Host '   https://www.python.org/downloads/' -ForegroundColor Cyan
    Write-Host '   חשוב: סמן "Add Python to PATH" בהתקנה' -ForegroundColor Yellow
    Start-Process 'https://www.python.org/downloads/'
    exit 1
}

# ─── Step: Python packages ───────────────────────────────────────────
function Step-PythonPackages($idx, $total, $py) {
    Write-Step $idx $total 'מתקין חבילות Python (selenium, flask, ...)...'

    $pkgs = @('selenium', 'flask', 'flask-cors', 'requests')
    $args = @('-m', 'pip', 'install', '--user', '--upgrade', '--disable-pip-version-check') + $pkgs

    $proc = Start-Process -FilePath $py.Exe -ArgumentList $args -Wait -PassThru -NoNewWindow `
        -RedirectStandardOutput "$env:TEMP\pip_stdout.txt" `
        -RedirectStandardError  "$env:TEMP\pip_stderr.txt"

    if ($proc.ExitCode -ne 0) {
        $errOut = Get-Content "$env:TEMP\pip_stderr.txt" -Raw -ErrorAction SilentlyContinue
        Write-Err "pip install נכשל"
        Write-Host $errOut -ForegroundColor DarkRed
        exit 1
    }
    Write-Ok 'חבילות הותקנו: selenium, flask, flask-cors, requests'
}

# ─── Step: Regular Chrome ────────────────────────────────────────────
function Find-Chrome {
    $candidates = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    )
    foreach ($p in $candidates) {
        if (Test-Path $p) { return $p }
    }
    return $null
}

function Get-ChromeVersion($exePath) {
    try {
        return (Get-Item $exePath).VersionInfo.ProductVersion
    } catch { return $null }
}

function Install-ChromeViaWinget {
    if (-not (Test-Command 'winget')) { return $false }
    Write-Info 'Trying winget install Google.Chrome...'
    try {
        $proc = Start-Process -FilePath 'winget' `
            -ArgumentList @('install', '-e', '--id', 'Google.Chrome',
                            '--accept-package-agreements', '--accept-source-agreements',
                            '--silent') `
            -Wait -PassThru -NoNewWindow
        return ($proc.ExitCode -eq 0)
    } catch {
        Log "winget Chrome install failed: $_"
        return $false
    }
}

function Step-Chrome($idx, $total) {
    Write-Step $idx $total 'בודק Google Chrome...'
    if ($SkipChrome) { Write-Warn 'דילוג על Chrome'; return $null }

    $chrome = Find-Chrome
    if ($chrome) {
        $ver = Get-ChromeVersion $chrome
        Write-Ok "Chrome $ver found at $chrome"
        return $chrome
    }

    Write-Warn 'Chrome לא מותקן. מנסה התקנה אוטומטית...'
    if (Install-ChromeViaWinget) {
        Start-Sleep -Seconds 2
        $chrome = Find-Chrome
        if ($chrome) {
            Write-Ok "Chrome installed via winget"
            return $chrome
        }
    }

    Write-Warn 'התקנה אוטומטית של Chrome נכשלה'
    Write-Host '   הורד והתקן ידנית: https://www.google.com/chrome/' -ForegroundColor Cyan
    Start-Process 'https://www.google.com/chrome/'
    if (Confirm-YesNo 'התקנת Chrome ידנית? להמשיך?' 'Y') {
        $chrome = Find-Chrome
        if ($chrome) { return $chrome }
    }
    Write-Warn 'ממשיך בלי Chrome - תצטרך להתקין לפני טעינת ה-Extension'
    return $null
}

# ─── Step: Chrome for Testing + ChromeDriver ─────────────────────────
function Get-LatestStableCfTVersion {
    try {
        $resp = Invoke-RestMethod -Uri 'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json' -UseBasicParsing
        return $resp.channels.Stable
    } catch {
        Log "failed to fetch CfT versions: $_"
        return $null
    }
}

function Step-ChromeForTesting($idx, $total) {
    Write-Step $idx $total 'מתקין Chrome for Testing + ChromeDriver...'
    if ($SkipChromeForTesting) { Write-Warn 'דילוג'; return $null }

    $existing = "$CFT_BASE\chrome-win64\chrome.exe"
    if (Test-Path $existing) {
        $ver = Get-ChromeVersion $existing
        Write-Ok "Chrome for Testing $ver כבר מותקן"
        # Still need to ensure chromedriver matches; continue to driver step
    } else {
        $stable = Get-LatestStableCfTVersion
        if (-not $stable) {
            Write-Err 'לא הצלחתי להתחבר ל-googlechromelabs - בדוק חיבור אינטרנט'
            exit 1
        }
        $cftVer = $stable.version
        $cftUrl = ($stable.downloads.'chrome' | Where-Object { $_.platform -eq 'win64' }).url
        if (-not $cftUrl) {
            Write-Err 'CfT URL not found'
            exit 1
        }
        Write-Info "Downloading Chrome for Testing $cftVer (~150MB)..."

        New-Item -Path $CFT_BASE -ItemType Directory -Force | Out-Null
        $zipPath = "$env:TEMP\chrome-for-testing.zip"
        Invoke-WebRequest -Uri $cftUrl -OutFile $zipPath -UseBasicParsing
        Write-Info 'מחלץ...'
        Expand-Archive -Path $zipPath -DestinationPath $CFT_BASE -Force
        Remove-Item $zipPath -ErrorAction SilentlyContinue
        Write-Ok "Chrome for Testing $cftVer extracted to $CFT_BASE\chrome-win64\"
    }

    # ChromeDriver
    New-Item -Path $DAEMON_BASE -ItemType Directory -Force | Out-Null
    $chromedriverPath = "$DAEMON_BASE\chromedriver.exe"

    $cftExe = "$CFT_BASE\chrome-win64\chrome.exe"
    $cftVer = Get-ChromeVersion $cftExe

    $needDriver = $true
    if (Test-Path $chromedriverPath) {
        try {
            $driverVer = & $chromedriverPath --version
            if ($driverVer -match '\b(\d+)\.') {
                $driverMajor = [int]$Matches[1]
                if ($cftVer -match '^(\d+)\.') {
                    $cftMajor = [int]$Matches[1]
                    if ($driverMajor -eq $cftMajor) { $needDriver = $false }
                }
            }
        } catch { }
    }

    if ($needDriver) {
        Write-Info "Downloading matching ChromeDriver for Chrome $cftVer..."
        $stable = Get-LatestStableCfTVersion
        $driverUrl = ($stable.downloads.'chromedriver' | Where-Object { $_.platform -eq 'win64' }).url
        if (-not $driverUrl) { Write-Err 'ChromeDriver URL not found'; exit 1 }
        $zipPath = "$env:TEMP\chromedriver.zip"
        Invoke-WebRequest -Uri $driverUrl -OutFile $zipPath -UseBasicParsing
        $extractDir = "$env:TEMP\chromedriver_extract"
        if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }
        Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force
        $foundDriver = Get-ChildItem -Path $extractDir -Recurse -Filter 'chromedriver.exe' | Select-Object -First 1
        if (-not $foundDriver) { Write-Err 'chromedriver.exe not found in archive'; exit 1 }
        Copy-Item $foundDriver.FullName $chromedriverPath -Force
        Remove-Item $zipPath -ErrorAction SilentlyContinue
        Remove-Item $extractDir -Recurse -Force -ErrorAction SilentlyContinue
        Write-Ok "ChromeDriver installed"
    } else {
        Write-Ok 'ChromeDriver תואם כבר קיים'
    }

    return @{ ChromePath = $cftExe; ChromedriverPath = $chromedriverPath }
}

# ─── Step: Daemon ────────────────────────────────────────────────────
function Step-Daemon($idx, $total, $cft) {
    Write-Step $idx $total 'מתקין את Bulk Sender Daemon...'

    New-Item -Path $DAEMON_BASE -ItemType Directory -Force | Out-Null
    $profileDir = "$DAEMON_BASE\profile"
    New-Item -Path $profileDir -ItemType Directory -Force | Out-Null

    $daemonSrc  = "$REPO_ROOT\daemon\wa_bulk_daemon.py"
    $daemonDest = "$DAEMON_BASE\wa_bulk_daemon.py"

    if (-not (Test-Path $daemonSrc)) {
        Write-Err "daemon source missing: $daemonSrc"
        exit 1
    }

    Copy-Item $daemonSrc $daemonDest -Force
    Write-Ok "wa_bulk_daemon.py copied to $DAEMON_BASE"

    # config.json - paths must NOT contain Hebrew characters (PowerShell encoding bug)
    $config = @{
        chrome_path        = $cft.ChromePath
        chromedriver_path  = $cft.ChromedriverPath
        profile_dir        = $profileDir
    } | ConvertTo-Json
    $configPath = "$DAEMON_BASE\config.json"
    [System.IO.File]::WriteAllText($configPath, $config, [System.Text.UTF8Encoding]::new($false))
    Write-Ok "config.json saved"

    # start_daemon.bat
    $py = Find-Python
    $batContent = @"
@echo off
title D.Yohai Bulk Sender Daemon
echo Starting D.Yohai Bulk Sender Daemon...
echo.
echo Leave this window OPEN while using bulk sending.
echo To stop: close this window or press Ctrl+C.
echo.
"$($py.Exe)" "$daemonDest"
pause
"@
    $batPath = "$DAEMON_BASE\start_daemon.bat"
    [System.IO.File]::WriteAllText($batPath, $batContent, [System.Text.UTF8Encoding]::new($false))
    Write-Ok "start_daemon.bat created"

    # Hidden start variant (for Task Scheduler auto-start - no cmd window)
    $hiddenVbs = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "$batPath", 0, False
"@
    $vbsPath = "$DAEMON_BASE\start_daemon_hidden.vbs"
    [System.IO.File]::WriteAllText($vbsPath, $hiddenVbs, [System.Text.UTF8Encoding]::new($false))

    # Desktop shortcut
    $desktop = [System.Environment]::GetFolderPath('Desktop')
    $shortcutPath = "$desktop\D.Yohai Bulk Sender.lnk"
    $shell = New-Object -ComObject WScript.Shell
    $sc = $shell.CreateShortcut($shortcutPath)
    $sc.TargetPath  = $batPath
    $sc.WorkingDirectory = $DAEMON_BASE
    $sc.IconLocation = "$cft.ChromePath, 0"
    $sc.Description = 'Base44 Bulk WhatsApp Sender Daemon'
    $sc.Save()
    Write-Ok "Desktop shortcut created"

    return @{ BatPath = $batPath; VbsPath = $vbsPath; DaemonPath = $daemonDest }
}

# ─── Step: Auto-start (Task Scheduler) ──────────────────────────────
function Step-AutoStart($idx, $total, $daemon) {
    Write-Step $idx $total 'הפעלה אוטומטית של הדימון בכניסה ל-Windows...'

    $taskName = 'DYohaiBulkSenderDaemon'

    # Determine choice
    $enable = $null
    if ($AutoStart)        { $enable = $true }
    elseif ($NoAutoStart)  { $enable = $false }
    else {
        Write-Host ''
        Write-Host '   האם להפעיל את הדימון אוטומטית בכל פעם שתיכנס למחשב?' -ForegroundColor White
        Write-Host '   יתרון: הדימון תמיד מוכן - לא צריך לזכור להפעיל ידנית' -ForegroundColor Gray
        Write-Host '   חיסרון: ~50MB RAM נצרכים תמיד ברקע' -ForegroundColor Gray
        Write-Host ''
        $enable = Confirm-YesNo '   הפעלה אוטומטית?' 'Y'
    }

    # Always remove old task first (idempotent)
    schtasks /Delete /TN $taskName /F 2>$null | Out-Null

    if (-not $enable) {
        Write-Info 'אוטו-סטארט בוטל - תצטרך להפעיל ידנית מהקיצור על שולחן העבודה'
        return $false
    }

    # Create new task: at logon, hidden, no admin
    $action  = "/Create /TN `"$taskName`" /TR `"wscript.exe \`"$($daemon.VbsPath)\`"`" /SC ONLOGON /RL LIMITED /F"
    $proc = Start-Process -FilePath 'schtasks' -ArgumentList $action -Wait -PassThru -NoNewWindow `
        -RedirectStandardOutput "$env:TEMP\schtasks_out.txt" `
        -RedirectStandardError  "$env:TEMP\schtasks_err.txt"

    if ($proc.ExitCode -ne 0) {
        $err = Get-Content "$env:TEMP\schtasks_err.txt" -Raw -ErrorAction SilentlyContinue
        Write-Warn "schtasks הכשלה: $err"
        Write-Info 'ניתן להמשיך - אבל תצטרך להפעיל את הדימון ידנית'
        return $false
    }
    Write-Ok "Task Scheduler entry '$taskName' נוצר - יעלה בכל login"
    return $true
}

# ─── Step: Native Messaging Helper ──────────────────────────────────
function Step-NativeHelper($idx, $total) {
    Write-Step $idx $total 'מתקין Native Messaging Helper (PDF dialog)...'

    $helperSrc = "$REPO_ROOT\extension\native-helper"
    if (-not (Test-Path $helperSrc)) {
        Write-Warn 'native-helper folder לא קיים - דילוג'
        return
    }

    New-Item -Path $NATIVE_BASE -ItemType Directory -Force | Out-Null
    Copy-Item "$helperSrc\*" $NATIVE_BASE -Recurse -Force
    Write-Ok "Native Helper copied to $NATIVE_BASE"

    # Run the helper's installer if exists
    $helperInstall = "$NATIVE_BASE\install.ps1"
    if (Test-Path $helperInstall) {
        try {
            & $helperInstall
            Write-Ok 'Native Manifest רשום ב-Chrome'
        } catch {
            Write-Warn "native helper install failed: $_"
        }
    }
}

# ─── Step: Save install metadata ────────────────────────────────────
function Step-SaveMetadata($idx, $total) {
    Write-Step $idx $total 'שומר metadata של ההתקנה...'

    New-Item -Path $INSTALL_BASE -ItemType Directory -Force | Out-Null
    $meta = @{
        version       = $VERSION
        installed_at  = (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss')
        repo_root     = $REPO_ROOT
        install_base  = $INSTALL_BASE
        daemon_base   = $DAEMON_BASE
        cft_base      = $CFT_BASE
        native_base   = $NATIVE_BASE
    } | ConvertTo-Json
    [System.IO.File]::WriteAllText("$INSTALL_BASE\install.json", $meta, [System.Text.UTF8Encoding]::new($false))

    # Copy update.ps1, doctor.ps1, uninstall.ps1 for later use without needing the repo
    foreach ($script in @('update.ps1', 'doctor.ps1', 'uninstall.ps1')) {
        $src = "$REPO_ROOT\$script"
        if (Test-Path $src) {
            Copy-Item $src "$INSTALL_BASE\$script" -Force
        }
    }
    Write-Ok "metadata saved at $INSTALL_BASE"
}

# ─── Step: Final manual instructions ────────────────────────────────
function Step-ManualInstructions($idx, $total) {
    Write-Step $idx $total 'הוראות סיום (פעולות ידניות נדרשות)'

    $extPath  = "$REPO_ROOT\extension"
    $compPath = "$REPO_ROOT\base44-components"

    Write-Host ''
    Write-Host '   ┌─────────────────────────────────────────────────────────────┐' -ForegroundColor Yellow
    Write-Host '   │  שלב ידני 1 - טעינת Chrome Extension                        │' -ForegroundColor Yellow
    Write-Host '   ├─────────────────────────────────────────────────────────────┤' -ForegroundColor Yellow
    Write-Host '   │  1. נפתחה לך לשונית chrome://extensions/                    │' -ForegroundColor White
    Write-Host '   │  2. הפעל "Developer mode" בפינה הימנית-עליונה               │' -ForegroundColor White
    Write-Host '   │  3. לחץ "Load unpacked"                                      │' -ForegroundColor White
    Write-Host '   │  4. בחר את התיקייה:                                          │' -ForegroundColor White
    Write-Host "   │     $extPath" -ForegroundColor Cyan
    Write-Host '   └─────────────────────────────────────────────────────────────┘' -ForegroundColor Yellow

    if (-not $SkipExtensionPrompt) {
        Start-Process 'chrome://extensions/'
    }

    Write-Host ''
    Write-Host '   ┌─────────────────────────────────────────────────────────────┐' -ForegroundColor Yellow
    Write-Host '   │  שלב ידני 2 - חיבור WhatsApp Web ב-Chrome Test              │' -ForegroundColor Yellow
    Write-Host '   ├─────────────────────────────────────────────────────────────┤' -ForegroundColor Yellow
    Write-Host '   │  1. פתח את Base44 בכרום הרגיל                                │' -ForegroundColor White
    Write-Host '   │  2. לחץ על אייקון ה-Extension למעלה                          │' -ForegroundColor White
    Write-Host '   │  3. בקלף "Bulk Sender" - לחץ "פתח Chrome Test לסריקת QR"     │' -ForegroundColor White
    Write-Host '   │  4. סרוק QR בטלפון - הסשן יישמר לתמיד                        │' -ForegroundColor White
    Write-Host '   └─────────────────────────────────────────────────────────────┘' -ForegroundColor Yellow

    Write-Host ''
    Write-Host '   ┌─────────────────────────────────────────────────────────────┐' -ForegroundColor Yellow
    Write-Host '   │  שלב ידני 3 - העתקת קומפוננטות ל-Base44                     │' -ForegroundColor Yellow
    Write-Host '   ├─────────────────────────────────────────────────────────────┤' -ForegroundColor Yellow
    Write-Host '   │  פתח את התיקייה הבאה וקרא את ה-README שלה:                  │' -ForegroundColor White
    Write-Host "   │  $compPath" -ForegroundColor Cyan
    Write-Host '   │  היא מכילה את כל קבצי .jsx להעתקה ידנית ל-Base44.            │' -ForegroundColor White
    Write-Host '   └─────────────────────────────────────────────────────────────┘' -ForegroundColor Yellow

    if (-not $SkipExtensionPrompt) {
        Start-Process 'explorer.exe' -ArgumentList $compPath
    }
}

# ─── Step: Health check ─────────────────────────────────────────────
function Step-HealthCheck($idx, $total) {
    Write-Step $idx $total 'מריץ בדיקת תקינות...'
    $doctorPath = "$REPO_ROOT\doctor.ps1"
    if (Test-Path $doctorPath) {
        Write-Info 'מריץ doctor.ps1...'
        & $doctorPath -BriefMode
    } else {
        Write-Warn 'doctor.ps1 not found - דילוג'
    }
}

# ─── Final banner ───────────────────────────────────────────────────
function Show-FinalBanner($daemon) {
    Write-Host ''
    Write-Host '  ╔════════════════════════════════════════════════════════════╗' -ForegroundColor Green
    Write-Host '  ║                                                            ║' -ForegroundColor Green
    Write-Host '  ║          ✅ ההתקנה הסתיימה בהצלחה!                          ║' -ForegroundColor Green
    Write-Host '  ║                                                            ║' -ForegroundColor Green
    Write-Host '  ╚════════════════════════════════════════════════════════════╝' -ForegroundColor Green
    Write-Host ''
    Write-Host '  פקודות לעתיד:' -ForegroundColor White
    Write-Host "    עדכון:        $INSTALL_BASE\update.ps1" -ForegroundColor Gray
    Write-Host "    אבחון:        $INSTALL_BASE\doctor.ps1" -ForegroundColor Gray
    Write-Host "    הסרה:         $INSTALL_BASE\uninstall.ps1" -ForegroundColor Gray
    Write-Host ''
    Write-Host '  לוג מלא של ההתקנה:' -ForegroundColor White
    Write-Host "    $LOG_FILE" -ForegroundColor Gray
    Write-Host ''
}

# ═════════════════════════════════════════════════════════════════════
# Main
# ═════════════════════════════════════════════════════════════════════
try {
    Show-Banner
    Log "=== Install started: v$VERSION ==="
    Test-WindowsVersion

    $TOTAL = 9
    $py        = Step-Python              1 $TOTAL
    Step-PythonPackages                   2 $TOTAL $py
    $chrome    = Step-Chrome              3 $TOTAL
    $cft       = Step-ChromeForTesting    4 $TOTAL
    $daemon    = Step-Daemon              5 $TOTAL $cft
    $autoStart = Step-AutoStart           6 $TOTAL $daemon
    Step-NativeHelper                     7 $TOTAL
    Step-SaveMetadata                     8 $TOTAL
    Step-ManualInstructions               9 $TOTAL

    # If auto-start was enabled, kick off the daemon now (without waiting for reboot)
    if ($autoStart) {
        Write-Host ''
        Write-Info 'מפעיל את הדימון עכשיו...'
        Start-Process 'wscript.exe' -ArgumentList "`"$($daemon.VbsPath)`""
        Start-Sleep -Seconds 3
    }

    Show-FinalBanner $daemon
    Log "=== Install completed ==="
} catch {
    Write-Host ''
    Write-Err "שגיאה בהתקנה: $_"
    Log "FATAL: $_"
    Log $_.ScriptStackTrace
    Write-Host '   לוג מלא:' -ForegroundColor Yellow
    Write-Host "   $LOG_FILE" -ForegroundColor Cyan
    exit 1
}
