/** Request auth resolution and bounded JSON body reads. */
import { bodyLimit, cursorApiKey } from "../config.js";
import { httpError } from "../errors.js";
import { bearerToken } from "../providers/common.js";

const CURSOR_KEY_URL = "https://cursor.com/dashboard/api?section=user-keys#user-api-keys";

export function requestApiKey(req) {
  return bearerToken(req.headers.authorization) || cursorApiKey();
}

export function requestAnthropicApiKey(req) {
  const value = req.headers["x-api-key"];
  const apiKey = Array.isArray(value) ? value[0] : value;
  return String(apiKey || "").trim() || requestApiKey(req);
}

export function requireApiKey(req) {
  const apiKey = requestApiKey(req);
  if (!apiKey) throw httpError(401, `Cursor API key not configured. Get your key at: ${CURSOR_KEY_URL} — then set CURSOR_API_KEY env var or pass as Authorization: Bearer <key>`, "invalid_request_error");
  return apiKey;
}

export function requireAnthropicApiKey(req) {
  const apiKey = requestAnthropicApiKey(req);
  if (!apiKey) throw httpError(401, `Cursor API key not configured. Get your key at: ${CURSOR_KEY_URL} — then set CURSOR_API_KEY env var or pass as x-api-key / Authorization: Bearer <key>`, "authentication_error");
  return apiKey;
}

/** Same path (/v1/models) serves OpenAI or Anthropic shapes; headers disambiguate. */
export function isAnthropicRequest(req, pathname) {
  return (
    pathname === "/v1/messages" ||
    pathname === "/v1/messages/count_tokens" ||
    Boolean(req.headers["x-api-key"] || req.headers["anthropic-version"])
  );
}

export async function readJson(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > bodyLimit()) throw httpError(413, "Request body too large");
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    throw httpError(400, "Invalid JSON body");
  }
}
