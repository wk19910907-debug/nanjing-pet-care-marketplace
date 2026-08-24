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
if not exist "node_modules" call pnpm install --frozen-lockfile
if errorlevel 1 pause & exit /b 1
echo.
echo Nanjing Pet Care is starting at http://127.0.0.1:43123
echo Keep this window open while using the product.
echo.
call pnpm dev
if errorlevel 1 pause
