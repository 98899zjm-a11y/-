@echo off
rem ============================================================================
rem  02-freshhost.cmd - run the packaged FRESH first-install entry script inside
rem  the Windows Sandbox and capture its exit code.
rem
rem  PRE:  01-bootstrap.ps1 already succeeded (F: mounted, C:\XjyLocal filled and
rem        hardened, C:\XjyResults\bootstrap.json has ok=true).
rem  POST: C:\XjyResults\fresh-host-local.log   - full stdout+stderr of the entry
rem        C:\XjyResults\fresh-host-exit.txt    - the exit code, one line
rem        C:\XjyResults\fresh-host-command.txt - which script was executed
rem
rem  Why the entry path is resolved with PowerShell instead of being written here:
rem  this file must stay 7-bit ASCII (cmd.exe would otherwise mangle the name
rem  under a non-UTF8 code page). The packaged entry script is named with CJK
rem  characters, so we rebuild the exact file name from its code points at run
rem  time, then verify it with "if exist" before touching it.
rem
rem  Idempotent: the log is truncated by ">" on every run, the exit file is
rem  rewritten, nothing is deleted.
rem ============================================================================
setlocal EnableExtensions
chcp 65001 >nul 2>&1

set "RES=C:\XjyResults"
if not exist "%RES%" mkdir "%RES%"

rem ---- resolve C:\XjyLocal\<CJK entry>.cmd from its code points -------------
rem  0x9996 0x6B21 0x5B89 0x88C5 0x4E3B 0x673A  + ".cmd"
set "ENTRY="
for /f "usebackq delims=" %%P in (`powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$n = -join ([char]0x9996,[char]0x6B21,[char]0x5B89,[char]0x88C5,[char]0x4E3B,[char]0x673A); $p = Join-Path 'C:\XjyLocal' ($n + '.cmd'); if (Test-Path -LiteralPath $p) { [Console]::OutputEncoding = [Text.Encoding]::UTF8; [Console]::WriteLine($p) }"`) do (
  if not defined ENTRY set "ENTRY=%%P"
)

if not defined ENTRY goto :noentry
if not exist "%ENTRY%" goto :noentry

echo [%DATE% %TIME%] target=%ENTRY% > "%RES%\fresh-host-command.txt"

rem ---- run it. Do NOT read errorlevel on the same line as the command. ------
cmd /c ""%ENTRY%" > "%RES%\fresh-host-local.log" 2>&1"
set "RC=%ERRORLEVEL%"
> "%RES%\fresh-host-exit.txt" echo %RC%

echo FRESH-HOST-EXIT=%RC%
echo   log  : %RES%\fresh-host-local.log
echo   exit : %RES%\fresh-host-exit.txt

if not "%RC%"=="0" goto :failed
endlocal & exit /b 0

:failed
echo FRESH-HOST-FAILED exit=%RC%
endlocal & exit /b %RC%

:noentry
> "%RES%\fresh-host-exit.txt" echo 9009
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$out = 'C:\XjyResults\entry-resolve-fail.txt'; $lines = @('entry script could not be resolved under C:\XjyLocal', '', 'candidate *.cmd:'); $lines += @(Get-ChildItem -LiteralPath 'C:\XjyLocal' -Filter '*.cmd' -ErrorAction SilentlyContinue | ForEach-Object { '  ' + $_.Name }); if (-not (Test-Path -LiteralPath 'C:\XjyLocal')) { $lines += '  (C:\XjyLocal does not exist - run 01-bootstrap.ps1 first)' }; [System.IO.File]::WriteAllLines($out, $lines, (New-Object System.Text.UTF8Encoding($false)))"
echo ENTRY-MISSING - see %RES%\entry-resolve-fail.txt (run 01-bootstrap.ps1 first?)
endlocal & exit /b 9009
