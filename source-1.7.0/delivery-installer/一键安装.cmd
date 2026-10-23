@echo off
setlocal
chcp 65001 >nul
"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0安装组件\Start-Install.ps1"
if errorlevel 1 pause
exit /b %errorlevel%
