@echo off
echo Starting D.Yohai Bridge installer...
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
echo.
echo Press any key to close...
pause >nul