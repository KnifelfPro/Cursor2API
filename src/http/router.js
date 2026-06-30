/**
 * HTTP proxy: maps OpenAI / Anthropic API routes to the Cursor SDK runtime.
 * Pass `services.runtime` to inject mocks in tests.
 */
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

import { cursorModels } from "../core/models.js";
import { runCursorText, streamCursorText } from "../core/cursor-runtime.js";
import { handleAnthropicMessages, handleAnthropicTokenCount } from "../handlers/anthropic.js";
import { handleChatCompletions } from "../handlers/chat.js";
import { handleCompletions } from "../handlers/completions.js";
import { handleEmbeddings } from "../handlers/embeddings.js";
import { listAnthropicModels, listModels, retrieveAnthropicModel, retrieveModel } from "../handlers/models.js";
import { handleResponses } from "../handlers/responses-api.js";
import { handleWorkspaceFile, handleWorkspaceList } from "../handlers/workspace.js";
import { isAnthropicRequest, requireAnthropicApiKey, requireApiKey } from "./request.js";
import { addBaseHeaders, sendAnthropicError, sendError, sendJson } from "./responses.js";
import { log } from "../logger.js";
import { anthropicError } from "../providers/anthropic.js";
import { openAiError } from "../providers/openai.js";

// Handlers call runtime.* only — tests swap these without touching Cursor SDK.
const defaultRuntime = {
  runText: runCursorText,
  streamText: streamCursorText,
  models: cursorModels,
};

function runtimeFromServices(services) {
  return { ...defaultRuntime, ...(services.runtime || {}) };
}

function unsupportedEndpoint(pathname) {
  return openAiError(
    `Endpoint ${pathname} is part of the OpenAI API surface, but Cursor SDK cannot provide an equivalent implementation here.`,
    "invalid_request_error",
    "not_supported",
  );
}

export function createProxyServer(services = {}) {
  const runtime = runtimeFromServices(services);

  return createServer(async (req, res) => {
    let anthropicRequest = false;
    const reqId = randomUUID();
    const t0 = Date.now();
    res.on("finish", () => log(reqId, "done", { method: req.method, path: req.url, status: res.statusCode, ms: Date.now() - t0 }));
    try {
      if (req.method === "OPTIONS") {
        addBaseHeaders(res);
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url || "/", "http://localhost");
      // Anthropic clients use x-api-key / anthropic-version; same /v1/models path differs by shape.
      anthropicRequest = isAnthropicRequest(req, url.pathname);

      if (req.method === "GET" && url.pathname === "/health") {
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "GET" && url.pathname === "/workspace") {
        requireApiKey(req);
        handleWorkspaceList({ res });
        return;
      }

      if (req.method === "GET" && url.pathname.startsWith("/workspace/")) {
        requireApiKey(req);
        handleWorkspaceFile({ res, pathname: url.pathname });
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/messages") {
        await handleAnthropicMessages({ req, res, apiKey: requireAnthropicApiKey(req), reqId, runtime });
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/messages/count_tokens") {
        requireAnthropicApiKey(req);
        await handleAnthropicTokenCount({ req, res });
        return;
      }

      if (req.method === "GET" && url.pathname === "/v1/models" && anthropicRequest) {
        sendJson(res, 200, await listAnthropicModels(runtime, requireAnthropicApiKey(req)));
        return;
      }

      if (req.method === "GET" && url.pathname.startsWith("/v1/models/") && anthropicRequest) {
        sendJson(
          res,
          200,
          await retrieveAnthropicModel(
            decodeURIComponent(url.pathname.slice("/v1/models/".length)),
            runtime,
            requireAnthropicApiKey(req),
          ),
        );
        return;
      }

      const apiKey = url.pathname.startsWith("/v1/") ? requireApiKey(req) : "";

      if (req.method === "GET" && url.pathname === "/v1/models") {
        sendJson(res, 200, await listModels(runtime, apiKey));
        return;
      }

      if (req.method === "GET" && url.pathname.startsWith("/v1/models/")) {
        sendJson(res, 200, await retrieveModel(decodeURIComponent(url.pathname.slice("/v1/models/".length)), runtime, apiKey));
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
        await handleChatCompletions({ req, res, apiKey, reqId, runtime });
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/completions") {
        await handleCompletions({ req, res, apiKey, reqId, runtime });
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/responses") {
        await handleResponses({ req, res, apiKey, reqId, runtime });
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/embeddings") {
        await handleEmbeddings({ req, res });
        return;
      }

      if (url.pathname.startsWith("/v1/")) {
        sendJson(
          res,
          501,
          anthropicRequest
            ? anthropicError(`Endpoint ${url.pathname} is not supported by this Cursor Anthropic proxy.`, "invalid_request_error")
            : unsupportedEndpoint(url.pathname),
        );
        return;
      }

      sendJson(res, 404, openAiError("Not found", "invalid_request_error", "not_found"));
    } catch (error) {
      log(reqId, "error", { message: error.message, status: error.statusCode || 500 });
      if (anthropicRequest) sendAnthropicError(res, error);
      else sendError(res, error);
    }
  });
}
