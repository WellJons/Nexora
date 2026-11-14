@echo off
cd /d "%~dp0"
where npm >nul 2>&1 || (echo Install Node.js 24 LTS first. & pause & exit /b 1)
call npm install --no-audit --no-fund
if errorlevel 1 (pause & exit /b 1)
call npm start
if errorlevel 1 pause
