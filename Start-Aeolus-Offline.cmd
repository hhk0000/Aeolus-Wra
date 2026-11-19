@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
    echo Local Python environment is missing. See README.md.
    pause
    exit /b 1
)
".venv\Scripts\python.exe" "scripts\offline.py"
if errorlevel 1 (
    pause
    exit /b 1
)
