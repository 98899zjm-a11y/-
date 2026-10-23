@echo off
powershell.exe -NoLogo -NoProfile -File "%~dp0Start-Candidate.ps1" -Open
if errorlevel 1 pause
