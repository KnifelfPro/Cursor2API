/** HTTP response helpers: CORS, JSON/SSE envelopes, OpenAI vs Anthropic error shapes. */
import { anthropicError, anthropicStreamEvent } from "../providers/anthropic.js";
import { openAiError } from "../providers/openai.js";

export function addBaseHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "authorization, content-type, x-api-key, anthropic-version, anthropic-beta",
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

export function sendJson(res, statusCode, body) {
  addBaseHeaders(res);
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

export function sendError(res, error) {
  if (res.headersSent) {
    if (!res.writableEnded) res.end();
    return;
  }

  const statusCode = error.statusCode || 500;
  const type = error.type || "server_error";
  sendJson(res, statusCode, openAiError(error.message || "Internal server error", type));
}

/** Mid-stream failures emit an Anthropic `error` SSE event instead of a JSON body. */
export function sendAnthropicError(res, error) {
  const statusCode = error.statusCode || 500;
  const type = error.type || (statusCode === 401 ? "authentication_error" : "api_error");
  const body = anthropicError(error.message || "Internal server error", type);

  if (res.headersSent) {
    if (!res.writableEnded) {
      if (typeof res.write === "function") res.write(anthropicStreamEvent("error", body));
      res.end();
    }
    return;
  }

  sendJson(res, statusCode, body);
}

export function sendSseHeaders(res) {
  addBaseHeaders(res);
  res.writeHead(200, {
    "cache-control": "no-cache",
    connection: "keep-alive",
    "content-type": "text/event-stream; charset=utf-8",
  });
}

export function writeSse(res, body, event) {
  if (event) res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(body)}\n\n`);
}
