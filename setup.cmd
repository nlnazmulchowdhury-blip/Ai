@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" %*
set "code=%ERRORLEVEL%"
echo.
if not "%code%"=="0" (
  echo Setup failed. See the messages above.
) else (
  echo Setup finished.
)
pause
exit /b %code%
