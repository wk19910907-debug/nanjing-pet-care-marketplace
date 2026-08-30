@echo off
setlocal
set "PET_NODE=C:\Users\Administrator\AppData\Local\Programs\node-v22.22.2-win-x64"
if not exist "%PET_NODE%\node.exe" set "PET_NODE=C:\Users\Administrator\AppData\Local\Microsoft\WinGet\Packages\OpenJS.NodeJS.22_Microsoft.Winget.Source_8wekyb3d8bbwe\node-v22.22.2-win-x64"
if not exist "%PET_NODE%\node.exe" (
  echo Node.js 22 was not found. Install Node.js 22 LTS first.
  pause
  exit /b 1
)
set "PATH=%PET_NODE%;%APPDATA%\npm;%PATH%"
cd /d "%~dp0"
where pwsh >nul 2>nul
if errorlevel 1 (
  echo PowerShell 7 was not found. Install PowerShell 7 first.
  pause
  exit /b 1
)
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-local-preview.ps1"
set "PET_EXIT=%ERRORLEVEL%"
if not "%PET_EXIT%"=="0" pause
exit /b %PET_EXIT%
