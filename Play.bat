@echo off
rem Local/offline convenience only. Real users will visit the hosted URL instead.
rem Builds a single self-contained HTML file and opens it in your browser.
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

echo Building...
call npm run build:single || (pause & exit /b 1)

start "" "%~dp0dist-single\index.html"
