import { resolve } from "node:path";

// ponytail: module-level global — set via setCursorApiKey() before server starts, overrides env
let _cursorApiKey = "";

export function setCursorApiKey(key) {
  _cursorApiKey = String(key || "").trim();
}

export function cursorApiKey() {
  return _cursorApiKey || process.env.CURSOR_API_KEY || "";
}

export function port() {
  return Number.parseInt(process.env.PORT || "3000", 10);
}

export function defaultModel() {
  return process.env.CURSOR_MODEL || "default";
}

export function defaultEmbeddingModel() {
  return process.env.EMBEDDING_MODEL || "text-embedding-3-small";
}

export function defaultEmbeddingDimensions() {
  return Number.parseInt(process.env.EMBEDDING_DIMENSIONS || "1536", 10);
}

export function bodyLimit() {
  return Number.parseInt(process.env.MAX_BODY_BYTES || "1048576", 10);
}

export function cursorStoreDir() {
  return resolve(process.env.CURSOR_STORE_DIR || ".cursor-sdk-store");
}

export function workspaceDir() {
  return resolve(process.env.CURSOR_WORKDIR || process.cwd());
}

export function cursorHomeDir() {
  return process.env.CURSOR_HOME_DIR
    ? resolve(process.env.CURSOR_HOME_DIR)
    : process.env.CODEX_SANDBOX
      ? resolve(".cursor-home")
      : "";
}

export function maxConcurrent() {
  return Number.parseInt(process.env.MAX_CONCURRENT || "10", 10);
}

export function requestTimeoutMs() {
  return Number.parseInt(process.env.REQUEST_TIMEOUT_MS || "300000", 10);
}
