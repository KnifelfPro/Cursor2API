#!/usr/bin/env sh
set -eu

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required" >&2
  exit 1
fi

# Remove cursor2api from MCP client configs while the bin is still installed.
if command -v cursor2api-mcp-uninstall >/dev/null 2>&1; then
  cursor2api-mcp-uninstall
else
  echo "cursor2api-mcp-uninstall not found on PATH; skipping config cleanup" >&2
fi

npm uninstall -g cursor2api-mcp
