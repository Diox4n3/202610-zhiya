@echo off
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo Python was not found. Install Python or open index.html directly.
  pause
  exit /b 1
)

echo Starting Zhiya preview at http://127.0.0.1:8080/
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 1; Start-Process 'http://127.0.0.1:8080/'"
python -m http.server 8080 --bind 127.0.0.1

echo.
echo Preview server stopped. Close this window, or run this file again.
pause
