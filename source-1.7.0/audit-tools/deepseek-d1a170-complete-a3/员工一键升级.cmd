@echo off
setlocal
"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -File "%~dp0delivery-tools\Employee-Update-170.ps1"
exit /b %errorlevel%