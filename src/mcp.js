#!/usr/bin/env node
/** MCP stdio entry: sets default store dir, re-exports protocol, starts on direct execution. */

import { fileURLToPath } from "node:url";

import { isMainEntry, startMcpStdio } from "./mcp/stdio.js";

const DEFAULT_CURSOR_STORE_DIR = fileURLToPath(new URL("../.cursor-sdk-store", import.meta.url));
if (!process.env.CURSOR_STORE_DIR) process.env.CURSOR_STORE_DIR = DEFAULT_CURSOR_STORE_DIR;

export * from "./mcp/protocol.js";
export * from "./mcp/stdio.js";

if (isMainEntry(process.argv[1], import.meta.url)) {
  startMcpStdio();
}
