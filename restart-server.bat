@echo off
setlocal enabledelayedexpansion

echo Stopping any process listening on port 5000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :5000 ^| findstr LISTENING') do (
    echo Killing PID %%a
    taskkill /F /PID %%a >nul 2>&1
)

echo.
echo Starting server (npm run dev)...
cd /d "%~dp0"
npm run dev
