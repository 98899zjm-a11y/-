@echo off
setlocal DisableDelayedExpansion
set NODE=D:/Codex/xjy-agent-sales-media/openclaw-isolated/runtime/node-v24.22.1-win-x64/node.exe
set ENTRY=D:/Codex/xjy-main-staff-session-20261023/candidate/start-profile-candidate.mjs
if not exist "%NODE%" goto missing_node
if not exist "%ENTRY%" goto missing_entry
"%NODE%" "%ENTRY%" --launch --open
set "CODE=%ERRORLEVEL%"
if not "%CODE%"=="0" goto failed
endlocal & exit /b 0
:missing_node
echo Fixed Node runtime is missing:
echo   D:/Codex/xjy-agent-sales-media/openclaw-isolated/runtime/node-v24.22.1-win-x64/node.exe
echo No candidate was started; ports 21965/21966 were not opened.
pause
endlocal & exit /b 1
:missing_entry
echo Fixed entry is missing:
echo   D:/Codex/xjy-main-staff-session-20261023/candidate/start-profile-candidate.mjs
echo No candidate was started; ports 21965/21966 were not opened.
pause
endlocal & exit /b 1
:failed
echo Candidate startup or page open failed. Exit code %CODE%.
echo Likely cause: local port 21965 or 21966 is already in use, or startup is incomplete.
echo Check D:/Codex/xjy-main-staff-session-20261023/candidate/runtime/logs and retry.
echo This launcher never adopts, stops or kills another process.
pause
endlocal & exit /b 1
