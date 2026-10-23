@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Win10-Win11兼容检查.ps1"
set "XJY_CHECK_EXIT=%ERRORLEVEL%"
pause
exit /b %XJY_CHECK_EXIT%
