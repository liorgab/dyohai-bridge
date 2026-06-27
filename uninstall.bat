@echo off
title D.Yohai Bridge Uninstaller
echo Starting D.Yohai Bridge uninstaller...
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1" %*
echo.
echo Press any key to close...
pause >nul
