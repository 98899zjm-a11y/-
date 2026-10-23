@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Update-Jewelry.ps1" -Action Rollback
set "xjy_exit=%ERRORLEVEL%"
pause
exit /b %xjy_exit%
