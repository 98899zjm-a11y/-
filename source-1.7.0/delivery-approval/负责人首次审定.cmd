@echo off
setlocal
"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Prepare-Initial-Approval.ps1"
exit /b %errorlevel%
