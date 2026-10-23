@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Update-Jewelry.ps1" -Action EmployeeUpdate -Role Employee
set "xjy_exit=%ERRORLEVEL%"
if not "%xjy_exit%"=="0" pause
exit /b %xjy_exit%
