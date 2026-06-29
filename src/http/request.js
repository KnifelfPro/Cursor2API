import { bodyLimit } from "../config.js";
import { httpError } from "../errors.js";
import { bearerToken } from "../providers/common.js";

export function requestApiKey(req) {
  return bearerToken(req.headers.authorization);
}

export function requestAnthropicApiKey(req) {
  const value = req.headers["x-api-key"];
  const apiKey = Array.isArray(value) ? value[0] : value;
  return String(apiKey || "").trim() || requestApiKey(req);
}

export function requireApiKey(req) {
  const apiKey = requestApiKey(req);
  if (!apiKey) throw httpError(401, "Missing Authorization bearer token", "invalid_request_error");
  return apiKey;
}

export function requireAnthropicApiKey(req) {
  const apiKey = requestAnthropicApiKey(req);
  if (!apiKey) throw httpError(401, "Missing x-api-key or Authorization bearer token", "authentication_error");
  return apiKey;
}

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
