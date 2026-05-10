# =====================================================================
# D.Yohai Bridge - Updater
# =====================================================================
# Pulls the latest version from the repository, compares with installed
# version, stops the daemon, replaces files, restarts daemon.
#
# Manual steps required AFTER update:
#   1. Reload the Chrome Extension at chrome://extensions/
#   2. Re-paste any changed Base44 components into Base44 web app
# (the script will tell you which ones changed)
#
# Usage:
#   .\update.ps1                # interactive update
#   .\update.ps1 -Check         # only check for updates
#   .\update.ps1 -Force         # update even if same version
# =====================================================================

param(
    [switch]$Check,
    [switch]$Force,
    [string]$RepoRoot
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

$INSTALL_BASE = "$env:LOCALAPPDATA\DYohaiBridge"
$DAEMON_BASE  = "$env:LOCALAPPDATA\DYohaiBulkSender"

# Try to find the repo root
if (-not $RepoRoot) {
    $RepoRoot = $PSScriptRoot
    # If we were called from $INSTALL_BASE\update.ps1, find the original repo
    if ($RepoRoot -eq $INSTALL_BASE) {
        $meta = "$INSTALL_BASE\install.json"
        if (Test-Path $meta) {
            $m = Get-Content $meta -Raw | ConvertFrom-Json
            if (Test-Path $m.repo_root) {
                $RepoRoot = $m.repo_root
            }
        }
    }
}

function Write-Ok($msg)   { Write-Host "  ✅ $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  ⚠️  $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "  ❌ $msg" -ForegroundColor Red }
function Write-Info($msg) { Write-Host "  ℹ️  $msg" -ForegroundColor Gray }

function Show-Banner {
    Write-Host ''
    Write-Host '  ╔════════════════════════════════════════════════════════════╗' -ForegroundColor Cyan
    Write-Host '  ║          D.Yohai Bridge - Updater                           ║' -ForegroundColor Cyan
    Write-Host '  ╚════════════════════════════════════════════════════════════╝' -ForegroundColor Cyan
    Write-Host ''
}

# ─── Step 1: Pull from git ─────────────────────────────────────────
function Step-GitPull {
    Write-Host '  [1/5] משיכת גרסה אחרונה מ-GitHub...' -ForegroundColor Yellow

    if (-not (Test-Path "$RepoRoot\.git")) {
        Write-Warn "אין .git ב-$RepoRoot - דילוג על git pull (ייתכן שזה ZIP build)"
        return $false
    }
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        Write-Err 'git לא מותקן - לא ניתן למשוך עדכון'
        Write-Info 'התקן git: winget install Git.Git'
        exit 1
    }

    Push-Location $RepoRoot
    try {
        $output = & git pull --ff-only 2>&1
        $exitCode = $LASTEXITCODE
        Pop-Location

        if ($exitCode -ne 0) {
            Write-Err "git pull נכשל:"
            Write-Host $output -ForegroundColor DarkRed
            exit 1
        }

        if ($output -match 'Already up to date') {
            Write-Info 'הריפו כבר מעודכן לגרסה האחרונה'
            return $false  # no changes
        } else {
            Write-Ok 'משך עדכונים חדשים'
            return $true
        }
    } catch {
        Pop-Location
        Write-Err "git pull error: $_"
        exit 1
    }
}

# ─── Step 2: Compare versions ──────────────────────────────────────
function Step-CompareVersions {
    Write-Host ''
    Write-Host '  [2/5] השוואת גרסאות...' -ForegroundColor Yellow

    $newVersion = (Get-Content "$RepoRoot\VERSION" -ErrorAction SilentlyContinue | Select-Object -First 1)
    if (-not $newVersion) { $newVersion = '?' }

    $installedVersion = '?'
    $meta = "$INSTALL_BASE\install.json"
    if (Test-Path $meta) {
        try {
            $m = Get-Content $meta -Raw | ConvertFrom-Json
            $installedVersion = $m.version
        } catch { }
    }

    Write-Info "מותקן:  $installedVersion"
    Write-Info "חדש:    $newVersion"

    if ($installedVersion -eq $newVersion -and -not $Force) {
        Write-Ok 'אין שינוי גרסה. השתמש ב--Force לעדכון מאולץ.'
        return $false
    }
    return $true
}

# ─── Step 3: Stop daemon ───────────────────────────────────────────
function Step-StopDaemon {
    Write-Host ''
    Write-Host '  [3/5] עוצר את הדימון...' -ForegroundColor Yellow
    try {
        Invoke-RestMethod -Uri 'http://127.0.0.1:8765/shutdown' -Method POST -TimeoutSec 5 -UseBasicParsing | Out-Null
        Write-Ok 'הדימון נסגר באופן מסודר'
        Start-Sleep -Seconds 2
    } catch {
        Write-Info 'הדימון לא רץ (או לא הגיב) - ממשיך'
    }
    # Belt-and-suspenders: kill any leftover python running our daemon
    Get-Process -Name 'python', 'pythonw' -ErrorAction SilentlyContinue | Where-Object {
        try { $_.CommandLine -match 'wa_bulk_daemon' } catch { $false }
    } | ForEach-Object {
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    }
}

# ─── Step 4: Update files ──────────────────────────────────────────
function Step-UpdateFiles {
    Write-Host ''
    Write-Host '  [4/5] מעדכן קבצים...' -ForegroundColor Yellow

    # Update daemon
    $daemonSrc = "$RepoRoot\daemon\wa_bulk_daemon.py"
    if (Test-Path $daemonSrc) {
        Copy-Item $daemonSrc "$DAEMON_BASE\wa_bulk_daemon.py" -Force
        Write-Ok 'wa_bulk_daemon.py עודכן'
    }

    # Update Python packages (in case requirements changed)
    foreach ($cmd in @('python', 'python3', 'py')) {
        if (Get-Command $cmd -ErrorAction SilentlyContinue) {
            Write-Info 'מעדכן חבילות Python...'
            & $cmd -m pip install --user --upgrade --disable-pip-version-check `
                selenium flask flask-cors requests 2>&1 | Out-Null
            Write-Ok 'חבילות Python מעודכנות'
            break
        }
    }

    # Update install metadata
    $newVersion = (Get-Content "$RepoRoot\VERSION" -ErrorAction SilentlyContinue | Select-Object -First 1)
    if (Test-Path "$INSTALL_BASE\install.json") {
        $m = Get-Content "$INSTALL_BASE\install.json" -Raw | ConvertFrom-Json
        $m.version = $newVersion
        $m | Add-Member -NotePropertyName 'last_updated_at' -NotePropertyValue (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss') -Force
        $m | ConvertTo-Json | Set-Content "$INSTALL_BASE\install.json" -Encoding UTF8
    }

    # Update helper scripts in $INSTALL_BASE
    foreach ($script in @('update.ps1', 'doctor.ps1', 'uninstall.ps1')) {
        $src = "$RepoRoot\$script"
        if (Test-Path $src) {
            Copy-Item $src "$INSTALL_BASE\$script" -Force
        }
    }
    Write-Ok 'סקריפטים מעודכנים'
}

# ─── Step 5: Restart + manual reminders ────────────────────────────
function Step-Finalize {
    Write-Host ''
    Write-Host '  [5/5] מפעיל מחדש + תזכורת לפעולות ידניות...' -ForegroundColor Yellow

    $vbs = "$DAEMON_BASE\start_daemon_hidden.vbs"
    if (Test-Path $vbs) {
        Start-Process 'wscript.exe' -ArgumentList "`"$vbs`""
        Start-Sleep -Seconds 3
        Write-Ok 'הדימון הופעל מחדש ברקע'
    } else {
        $bat = "$DAEMON_BASE\start_daemon.bat"
        if (Test-Path $bat) {
            Start-Process $bat
            Write-Ok 'הדימון הופעל - חלון cmd נפתח'
        } else {
            Write-Warn 'לא מצאתי script להפעלת הדימון'
        }
    }

    Write-Host ''
    Write-Host '  ╔════════════════════════════════════════════════════════════╗' -ForegroundColor Yellow
    Write-Host '  ║          ⚠️  פעולות ידניות אחרי עדכון                       ║' -ForegroundColor Yellow
    Write-Host '  ╚════════════════════════════════════════════════════════════╝' -ForegroundColor Yellow
    Write-Host ''
    Write-Host '   1. טען מחדש את ה-Chrome Extension:' -ForegroundColor White
    Write-Host '      → לחץ על אייקון הריענון ליד "Base44 Bridge" בלשונית chrome://extensions/' -ForegroundColor Gray
    Write-Host '      → רענן את Base44 (F5) אחר כך' -ForegroundColor Gray
    Write-Host ''
    Write-Host '   2. בדוק קומפוננטות Base44 שהשתנו:' -ForegroundColor White
    Write-Host "      → התיקייה: $RepoRoot\base44-components\" -ForegroundColor Gray
    Write-Host '      → השווה לקוד ב-Base44 ועדכן אם יש הבדלים' -ForegroundColor Gray
    Write-Host ''

    # Open relevant locations
    Start-Process 'chrome://extensions/'
    Start-Process 'explorer.exe' -ArgumentList "$RepoRoot\base44-components"
}

# ─── Check-only mode ───────────────────────────────────────────────
function Check-Only {
    Show-Banner
    Write-Host '  בודק אם יש עדכון זמין...' -ForegroundColor White
    Write-Host ''

    if (-not (Test-Path "$RepoRoot\.git")) {
        Write-Err "אין .git ב-$RepoRoot"
        exit 1
    }
    Push-Location $RepoRoot
    & git fetch 2>&1 | Out-Null
    $local  = & git rev-parse '@'
    $remote = & git rev-parse '@{u}' 2>&1
    Pop-Location

    if ($LASTEXITCODE -ne 0) {
        Write-Warn 'לא יכול לבדוק (ייתכן שאין remote tracking branch)'
        exit 1
    }

    if ($local -eq $remote) {
        Write-Ok 'כבר מעודכן לגרסה האחרונה'
        exit 0
    } else {
        Write-Warn 'יש עדכון זמין!'
        Push-Location $RepoRoot
        Write-Host ''
        Write-Host '  שינויים זמינים:' -ForegroundColor White
        & git log "$local..$remote" --oneline --no-decorate | ForEach-Object {
            Write-Host "    $_" -ForegroundColor Gray
        }
        Pop-Location
        Write-Host ''
        Write-Host "  להתקנה: cd `"$RepoRoot`" ; .\update.ps1" -ForegroundColor Cyan
        exit 1
    }
}

# ─── Main ──────────────────────────────────────────────────────────
try {
    if ($Check) { Check-Only ; exit }

    Show-Banner

    if (-not (Test-Path $RepoRoot)) {
        Write-Err "Repo not found at: $RepoRoot"
        Write-Info 'ציין נתיב נכון: .\update.ps1 -RepoRoot "C:\path\to\dyohai-bridge"'
        exit 1
    }
    Write-Info "Repo: $RepoRoot"

    $hasChanges = Step-GitPull

    if (-not $hasChanges -and -not $Force) {
        Write-Host ''
        Write-Ok 'הכל מעודכן - אין צורך בפעולה.'
        exit 0
    }

    $shouldUpdate = Step-CompareVersions
    if (-not $shouldUpdate -and -not $Force) {
        exit 0
    }

    Step-StopDaemon
    Step-UpdateFiles
    Step-Finalize

    Write-Host ''
    Write-Host '  ╔════════════════════════════════════════════════════════════╗' -ForegroundColor Green
    Write-Host '  ║          ✅ העדכון הסתיים בהצלחה!                           ║' -ForegroundColor Green
    Write-Host '  ╚════════════════════════════════════════════════════════════╝' -ForegroundColor Green
    Write-Host ''
} catch {
    Write-Host ''
    Write-Err "שגיאה בעדכון: $_"
    Write-Host $_.ScriptStackTrace -ForegroundColor DarkRed
    exit 1
}
