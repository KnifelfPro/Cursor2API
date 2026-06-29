@echo off
setlocal

set /p "CURSOR_API_KEY=Cursor API key: "
set "CURSOR_API_KEY=%CURSOR_API_KEY%"

where npm >nul 2>nul
if errorlevel 1 (
  echo npm is required
  exit /b 1
)

call npm install -g cursor2api-mcp@latest
if errorlevel 1 exit /b 1

cursor2api-mcp-install
