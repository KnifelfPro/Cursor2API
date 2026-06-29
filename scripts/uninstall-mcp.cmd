@echo off
setlocal

where npm >nul 2>nul
if errorlevel 1 (
  echo npm is required
  exit /b 1
)

rem Remove cursor2api from MCP client configs while the bin is still installed.
where cursor2api-mcp-uninstall >nul 2>nul
if not errorlevel 1 (
  call cursor2api-mcp-uninstall
) else (
  echo cursor2api-mcp-uninstall not found on PATH; skipping config cleanup
)

call npm uninstall -g cursor2api-mcp
if errorlevel 1 exit /b 1
