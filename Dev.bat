@echo off
rem Double-click to start the dev server (live reload while editing code).
rem Close this window to stop the server.
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get it from https://nodejs.org and try again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies ^(first run only^)...
  call npm install || (pause & exit /b 1)
)

call npm run dev
pause
