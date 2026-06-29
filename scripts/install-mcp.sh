#!/usr/bin/env sh
set -eu

printf "Cursor API key: "
if command -v stty >/dev/null 2>&1; then
  stty -echo
  IFS= read -r CURSOR_API_KEY
  stty echo
  printf "\n"
else
  IFS= read -r CURSOR_API_KEY
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required" >&2
  exit 1
fi

npm install -g cursor2api-mcp@latest

export CURSOR_API_KEY
cursor2api-mcp-install
