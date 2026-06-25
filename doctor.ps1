# ════════════════════════════════════════════════════════════════════
#  D.Yohai Bridge - Doctor (portable, auto-detects location)
#  Run anytime - especially after Windows updates.
# ════════════════════════════════════════════════════════════════════

$ErrorActionPreference = "Continue"

# ─── Auto-detect source location (works in dev workspace OR deployed repo) ────
$REPO_ROOT = $PSScriptRoot

# Try common daemon source paths in order:
$daemonCandidates = @(
    "$REPO_ROOT\daemon\wa_bulk_daemon.py",        # deployed (dyohai-bridge/daemon/)
    "$REPO_ROOT\bulk-sender\wa_bulk_daemon.py",   # dev workspace (visa-bridge/bulk-sender/)
    "$REPO_ROOT\..\bulk-sender\wa_bulk_daemon.py" # if doctor is in subfolder
)
$SOURCE_DAEMON = $null
foreach ($c in $daemonCandidates) {
    if (Test-Path $c) { $SOURCE_DAEMON = (Resolve-Path $c).Path; break }
}

# Try extension paths in order:
$extCandidates = @(
    "$REPO_ROOT\extension\manifest.json",                  # deployed
    "$REPO_ROOT\piba-bridge-extension\manifest.json",      # dev workspace
    "$REPO_ROOT\..\piba-bridge-extension\manifest.json"
)
$EXT_FOLDER = $null
foreach ($c in $extCandidates) {
    if (Test-Path $c) { $EXT_FOLDER = (Split-Path $c -Parent | Resolve-Path).Path; break }
}

$SOURCE_REQ       = if ($SOURCE_DAEMON) { Join-Path (Split-Path $SOURCE_DAEMON -Parent) "requirements.txt" } else { $null }
$DOCTOR_SELF      = $MyInvocation.MyCommand.Path

$DAEMON_DIR       = "$env:LOCALAPPDATA\Base44BulkSender"
$DAEMON_TARGET    = "$DAEMON_DIR\wa_bulk_daemon.py"
$DESKTOP          = [Environment]::GetFolderPath('Desktop')
$DESKTOP_LINK     = Join-Path $DESKTOP "D.Yohai Bulk Daemon.lnk"
$DOCTOR_LINK      = Join-Path $DESKTOP "D.Yohai Doctor.lnk"
$STARTMENU_LINK   = Join-Path "$env:APPDATA\Microsoft\Windows\Start Menu\Programs" "D.Yohai Bulk Daemon.lnk"
$TASK_NAME        = "DYohaiBridge_Daemon_AutoStart"
$REQUIRED_PACKAGES = @("selenium","flask","flask-cors","requests","pyperclip")
$script:fixed = 0; $script:unfixed = 0

function Hdr($t){Write-Host "";Write-Host ("="*55) -ForegroundColor Cyan;Write-Host "  $t" -ForegroundColor Cyan;Write-Host ("="*55) -ForegroundColor Cyan}
function Chk($n,$ok,$d=""){if($ok){Write-Host "  [OK]  $n" -ForegroundColor Green;if($d){Write-Host "        $d" -ForegroundColor Gray}}else{Write-Host "  [X]   $n" -ForegroundColor Red;if($d){Write-Host "        $d" -ForegroundColor Yellow}}}
function Fxd($d){Write-Host "        -> [FIXED] $d" -ForegroundColor Green;$script:fixed++}
function Mnl($d){Write-Host "        -> [MANUAL] $d" -ForegroundColor Magenta;$script:unfixed++}
function FindPy([switch]$W){$exe=if($W){"pythonw.exe"}else{"python.exe"};foreach($c in @("$env:LOCALAPPDATA\Programs\Python\Python313\$exe","$env:LOCALAPPDATA\Programs\Python\Python312\$exe","$env:LOCALAPPDATA\Programs\Python\Python311\$exe","C:\Python313\$exe","C:\Python312\$exe","C:\Program Files\Python313\$exe","C:\Program Files\Python312\$exe")){if(Test-Path $c){return $c}};try{return (Get-Command $exe -EA Stop).Source}catch{return $null}}

Write-Host "";Write-Host "=========================================================" -ForegroundColor Magenta
Write-Host "  D.Yohai Bridge - Doctor" -ForegroundColor Magenta
Write-Host "  Repo location: $REPO_ROOT" -ForegroundColor Gray
Write-Host "=========================================================" -ForegroundColor Magenta

Hdr "1. Source Code"
Chk "Daemon source detected" ($null -ne $SOURCE_DAEMON) $SOURCE_DAEMON
if(-not $SOURCE_DAEMON){Mnl "wa_bulk_daemon.py not found near doctor.ps1. Run from inside the repo.";Read-Host "Press Enter";exit 1}
Chk "Extension folder detected" ($null -ne $EXT_FOLDER) $EXT_FOLDER

Hdr "2. Python"
$python = FindPy
$pythonw = FindPy -W
Chk "python.exe" ($null -ne $python) $python
Chk "pythonw.exe" ($null -ne $pythonw) $pythonw
if(-not $python){Mnl "Install Python from python.org first, then re-run.";Read-Host;exit 1}

Hdr "3. Python Packages"
$missing=@()
foreach($pkg in $REQUIRED_PACKAGES){
    $m=$pkg.Replace("-","_")
    & $python -c "import importlib.util,sys; sys.exit(0 if importlib.util.find_spec('$m') else 1)" 2>$null
    if($LASTEXITCODE -eq 0){Chk $pkg $true}else{Chk $pkg $false "Missing";$missing+=$pkg}
}
if($missing.Count -gt 0){
    Write-Host "  Installing missing packages..." -ForegroundColor Yellow
    & $python -m pip install --upgrade $missing 2>&1 | Out-Null
    if($LASTEXITCODE -eq 0){Fxd "Installed: $($missing -join ', ')"}else{Mnl "Install failed"}
}

Hdr "4. Daemon Code"
if(-not (Test-Path $DAEMON_DIR)){New-Item -ItemType Directory -Path $DAEMON_DIR -Force | Out-Null;Fxd "Created $DAEMON_DIR"}else{Chk "Daemon directory" $true $DAEMON_DIR}
$needCopy=$false
if(-not (Test-Path $DAEMON_TARGET)){Chk "Daemon installed" $false;$needCopy=$true}
else{
    if((Get-Item $SOURCE_DAEMON).LastWriteTime -gt (Get-Item $DAEMON_TARGET).LastWriteTime){Chk "Up-to-date" $false "Source newer";$needCopy=$true}
    else{Chk "Up-to-date" $true ((Get-Item $DAEMON_TARGET).LastWriteTime)}
}
if($needCopy){
    Copy-Item $SOURCE_DAEMON $DAEMON_TARGET -Force
    if($SOURCE_REQ -and (Test-Path $SOURCE_REQ)){Copy-Item $SOURCE_REQ "$DAEMON_DIR\requirements.txt" -Force -EA SilentlyContinue}
    Fxd "Daemon copied"
}
$patches=@{"OVERRIDE"="PER-EMPLOYEE MESSAGE OVERRIDE";"Paste"="_paste_with_newlines";"PYPERCLIP"="HAS_PYPERCLIP";"NoPlus"="search_term = digits"}
foreach($k in $patches.Keys){Chk "Patch: $k" (Select-String -Path $DAEMON_TARGET -Pattern $patches[$k] -Quiet)}

Hdr "5. Shortcuts"
$Wsh = New-Object -ComObject WScript.Shell
if(-not (Test-Path $DESKTOP_LINK) -and $pythonw){
    $sc=$Wsh.CreateShortcut($DESKTOP_LINK);$sc.TargetPath=$pythonw;$sc.Arguments="`"$DAEMON_TARGET`"";$sc.WorkingDirectory=$DAEMON_DIR;$sc.WindowStyle=7;$sc.Description="D.Yohai Daemon";$sc.Save()
    Fxd "Desktop daemon shortcut"
}else{Chk "Desktop daemon shortcut" $true}
if(-not (Test-Path $STARTMENU_LINK) -and $pythonw){
    $sc=$Wsh.CreateShortcut($STARTMENU_LINK);$sc.TargetPath=$pythonw;$sc.Arguments="`"$DAEMON_TARGET`"";$sc.WorkingDirectory=$DAEMON_DIR;$sc.Description="D.Yohai Daemon";$sc.Save()
    Fxd "Start Menu shortcut"
}else{Chk "Start Menu shortcut" $true}
if(-not (Test-Path $DOCTOR_LINK) -and (Test-Path $DOCTOR_SELF)){
    $sc=$Wsh.CreateShortcut($DOCTOR_LINK);$sc.TargetPath="powershell.exe";$sc.Arguments="-ExecutionPolicy Bypass -File `"$DOCTOR_SELF`"";$sc.WorkingDirectory=$REPO_ROOT;$sc.Description="Run D.Yohai Doctor";$sc.Save()
    Fxd "Doctor desktop shortcut"
}else{Chk "Doctor desktop shortcut" $true}

Hdr "6. Auto-Start at Login"
$task=Get-ScheduledTask -TaskName $TASK_NAME -ErrorAction SilentlyContinue
if($null -eq $task -and $pythonw){
    try{
        $action=New-ScheduledTaskAction -Execute $pythonw -Argument "`"$DAEMON_TARGET`"" -WorkingDirectory $DAEMON_DIR
        $trigger=New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
        $trigger.Delay="PT30S"
        $settings=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 0) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
        $principal=New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
        Register-ScheduledTask -TaskName $TASK_NAME -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Auto-start D.Yohai Daemon at user logon" -Force | Out-Null
        Fxd "Auto-start configured (30s delay after login)"
    }catch{Mnl "Task registration failed: $($_.Exception.Message). Run as Administrator."}
}else{Chk "Auto-start scheduled task" ($null -ne $task)}

Hdr "7. Daemon Status (Now)"
$port=Get-NetTCPConnection -LocalPort 8765 -EA SilentlyContinue | Where-Object {$_.State -eq "Listen"}
if($port){
    Chk "Daemon on :8765" $true "PID: $($port.OwningProcess)"
    try{$st=Invoke-RestMethod http://127.0.0.1:8765/status -TimeoutSec 3;Write-Host "        WhatsApp: $(if($st.wa_logged_in){'logged in'}else{'NOT logged in'})" -ForegroundColor $(if($st.wa_logged_in){'Green'}else{'Yellow'})}catch{}
}else{Chk "Daemon on :8765" $false "Not running. Click 'D.Yohai Bulk Daemon' on Desktop to start now."}

Hdr "Summary"
Write-Host "  Auto-fixed:  $script:fixed item(s)" -ForegroundColor $(if($script:fixed -gt 0){'Green'}else{'Gray'})
Write-Host "  Need manual: $script:unfixed item(s)" -ForegroundColor $(if($script:unfixed -gt 0){'Yellow'}else{'Gray'})
Write-Host "";Write-Host "=========================================================" -ForegroundColor Magenta
Write-Host "  Doctor finished. Re-run via 'D.Yohai Doctor' on Desktop." -ForegroundColor Magenta
Write-Host "=========================================================" -ForegroundColor Magenta
Read-Host "Press Enter to close"
