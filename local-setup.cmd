@echo off
REM Pembungkus scripts/local-setup.sh untuk CMD dan PowerShell.
REM
REM Di Windows, "bash" di PATH biasanya menunjuk ke bash milik WSL di
REM system32 - lingkungan Linux terpisah yang tidak melihat Docker Desktop
REM maupun drive proyek dengan cara yang sama. Script SDL harus berjalan di
REM Git Bash, dan pembungkus ini memastikan itu.
REM
REM Pemakaian: local-setup.cmd [up^|bootstrap^|seed^|harness^|status^|down]

setlocal

set "GITBASH=%ProgramFiles%\Git\bin\bash.exe"
if exist "%GITBASH%" goto run

set "GITBASH=%ProgramW6432%\Git\bin\bash.exe"
if exist "%GITBASH%" goto run

set "GITBASH=%LOCALAPPDATA%\Programs\Git\bin\bash.exe"
if exist "%GITBASH%" goto run

echo GAGAL: Git Bash tidak ditemukan.
echo Pasang Git for Windows, atau buka Git Bash lalu jalankan:
echo     bash scripts/local-setup.sh %*
exit /b 1

:run
"%GITBASH%" "%~dp0scripts/local-setup.sh" %*
exit /b %ERRORLEVEL%
