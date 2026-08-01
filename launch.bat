@echo off
title Subway Surfers - Auto Update + Launch
color 0A

echo ==========================================
echo   Subway Surfers - Webcam Edition
echo   Auto-updating from GitHub...
echo ==========================================
echo.

:: Check if git is installed
where git >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Git is not installed!
    echo Download it from: https://git-scm.com/download/win
    pause
    exit /b 1
)

:: Pull latest changes from the webcam branch
git pull origin webcam-motion-controls

if %errorlevel% neq 0 (
    echo.
    echo [WARNING] Could not pull updates. Playing with current version.
)

echo.
echo ==========================================
echo   Launching game in your browser...
echo ==========================================
echo.

:: Try to find Python for a local server (needed for WebGL textures)
where python >nul 2>&1
if %errorlevel% equ 0 (
    echo Starting local server on http://localhost:8000 ...
    start "" http://localhost:8000/index.html
    python -m http.server 8000
    goto :end
)

where python3 >nul 2>&1
if %errorlevel% equ 0 (
    echo Starting local server on http://localhost:8000 ...
    start "" http://localhost:8000/index.html
    python3 -m http.server 8000
    goto :end
)

:: Fallback: open file directly (textures may not load without server)
echo [WARNING] Python not found - opening file directly.
echo [NOTE] Textures may not load. Install Python for best experience.
echo        https://www.python.org/downloads/
echo.
start index.html

:end
pause
