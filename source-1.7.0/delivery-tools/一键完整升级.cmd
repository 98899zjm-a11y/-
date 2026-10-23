@echo off
setlocal
"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0delivery-tools\Initial-Full-Upgrade.ps1"
exit /b %errorlevel%
