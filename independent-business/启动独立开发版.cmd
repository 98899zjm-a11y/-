@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
if not exist "E:\珠宝销售软件\desktop\node_modules\electron\dist\electron.exe" (
  echo Existing development Electron runtime was not found. No software was installed.
  pause
  exit /b 1
)
"E:\珠宝销售软件\desktop\node_modules\electron\dist\electron.exe" "%~dp0desktop"
