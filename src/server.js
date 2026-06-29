import { randomUUID } from "node:crypto";
import { createReadStream, existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { Agent, Cursor, JsonlLocalAgentStore } from "@cursor/sdk";

import {
  anthropicError,
  anthropicMessageDelta,
  anthropicMessageResponse,
  anthropicMessageStart,
  anthropicMessageStop,
  anthropicModelResponse,
  anthropicModelsResponse,
  anthropicPrompt,
  anthropicStreamEvent,
  anthropicTextBlockStart,
  anthropicTextBlockStop,
  anthropicTextDelta,
  anthropicTokenCount,
} from "./anthropic.js";
import {
  assistantDelta,
  bearerToken,
  chatCompletionChunk,
  chatCompletionResponse,
  chatPrompt,
  completionChunk,
  completionPrompt,
  completionResponse,
  cursorModelsToOpenAi,
  embeddingsResponse,
  extractToolCalls,
  openAiModel,
  openAiError,
  responseInputToPrompt,
  responseObject,
} from "./openai.js";

const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const DEFAULT_MODEL = process.env.CURSOR_MODEL || "composer-2";
const DEFAULT_EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small";
const DEFAULT_EMBEDDING_DIMENSIONS = Number.parseInt(process.env.EMBEDDING_DIMENSIONS || "1536", 10);
const BODY_LIMIT = Number.parseInt(process.env.MAX_BODY_BYTES || "1048576", 10);
const CURSOR_STORE_DIR = resolve(process.env.CURSOR_STORE_DIR || ".cursor-sdk-store");
const WORKSPACE_DIR = resolve(process.env.CURSOR_WORKDIR || process.cwd());
const CURSOR_HOME_DIR = process.env.CURSOR_HOME_DIR
  ? resolve(process.env.CURSOR_HOME_DIR)
  : process.env.CODEX_SANDBOX
    ? resolve(".cursor-home")
    : "";
const MAX_CONCURRENT = Number.parseInt(process.env.MAX_CONCURRENT || "10", 10);
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.REQUEST_TIMEOUT_MS || "300000", 10);
let activeRequests = 0;

function httpError(statusCode, message, type = "invalid_request_error") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.type = type;
  return error;
}

function addBaseHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "authorization, content-type, x-api-key, anthropic-version, anthropic-beta",
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

function sendJson(res, statusCode, body) {
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

function sendSseHeaders(res) {
  addBaseHeaders(res);
  res.writeHead(200, {
    "cache-control": "no-cache",
    connection: "keep-alive",
    "content-type": "text/event-stream; charset=utf-8",
  });
}

function writeSse(res, body, event) {
  if (event) res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(body)}\n\n`);
}

function requestApiKey(req) {
  return bearerToken(req.headers.authorization);
}

function requestAnthropicApiKey(req) {
  const value = req.headers["x-api-key"];
  const apiKey = Array.isArray(value) ? value[0] : value;
  return String(apiKey || "").trim() || requestApiKey(req);
}

function requireApiKey(req) {
  const apiKey = requestApiKey(req);
  if (!apiKey) throw httpError(401, "Missing Authorization bearer token", "invalid_request_error");
  return apiKey;
}

function requireAnthropicApiKey(req) {
  const apiKey = requestAnthropicApiKey(req);
  if (!apiKey) throw httpError(401, "Missing x-api-key or Authorization bearer token", "authentication_error");
  return apiKey;
}

function isAnthropicRequest(req, pathname) {
  return (
    pathname === "/v1/messages" ||
    pathname === "/v1/messages/count_tokens" ||
    Boolean(req.headers["x-api-key"] || req.headers["anthropic-version"])
  );
}

async function readJson(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw httpError(413, "Request body too large");
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

async function createCursorAgent(model, apiKey, store) {
  if (CURSOR_HOME_DIR) process.env.HOME = CURSOR_HOME_DIR;
  // ponytail: local-only agent runtime; add cloud options when PR automation is needed.
  return Agent.create({
    apiKey,
    model: { id: model },
    local: {
      cwd: WORKSPACE_DIR,
      store,
    },
  });
}

function listWorkspaceFiles(dir = WORKSPACE_DIR, base = WORKSPACE_DIR) {
  const files = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) files.push(...listWorkspaceFiles(full, base));
      else files.push(relative(base, full));
    }
  } catch {}
  return files;
}

async function runCursorText(prompt, model, apiKey) {
  if (activeRequests >= MAX_CONCURRENT) throw httpError(503, "Too many concurrent requests", "server_error");
  activeRequests++;
  const storeDir = join(CURSOR_STORE_DIR, randomUUID());
  let agent;
  const timer = setTimeout(() => agent?.close(), REQUEST_TIMEOUT_MS);
  try {
    agent = await createCursorAgent(model, apiKey, new JsonlLocalAgentStore(storeDir));
    const run = await agent.send(prompt);
    const result = await run.wait();
    if (result.status !== "finished") throw httpError(502, `Cursor run ended with status ${result.status}`, "server_error");
    return result.result || "";
  } finally {
    clearTimeout(timer);
    agent?.close();
    activeRequests--;
    rmSync(storeDir, { recursive: true, force: true });
  }
}

async function streamCursorText(prompt, model, apiKey, onDelta) {
  if (activeRequests >= MAX_CONCURRENT) throw httpError(503, "Too many concurrent requests", "server_error");
  activeRequests++;
  const storeDir = join(CURSOR_STORE_DIR, randomUUID());
  let agent;
  const timer = setTimeout(() => agent?.close(), REQUEST_TIMEOUT_MS);
  try {
    agent = await createCursorAgent(model, apiKey, new JsonlLocalAgentStore(storeDir));
    const run = await agent.send(prompt);
    let emittedText = "";
    for await (const event of run.stream()) {
      const next = assistantDelta(event, emittedText);
      if (!next.delta) continue;
      emittedText = next.text;
      onDelta(next.delta);
    }
  } finally {
    clearTimeout(timer);
    agent?.close();
    activeRequests--;
    rmSync(storeDir, { recursive: true, force: true });
  }
}

async function cursorModels(apiKey) {
  const models = await Cursor.models.list({ apiKey });
  return models.length ? models : [{ id: DEFAULT_MODEL }];
}

async function listModels(apiKey) {
  const models = await cursorModels(apiKey);
  const response = cursorModelsToOpenAi(models);
  if (!response.data.some((model) => model.id === DEFAULT_EMBEDDING_MODEL)) {
    response.data.push(openAiModel(DEFAULT_EMBEDDING_MODEL, "cursor-local"));
  }
  return response;
}

async function retrieveModel(id, apiKey) {
  const models = await listModels(apiKey);
  const model = models.data.find((item) => item.id === id);
  if (!model) throw httpError(404, `Model ${id} was not found`, "invalid_request_error");
  return model;
}

async function listAnthropicModels(apiKey) {
  return anthropicModelsResponse(await cursorModels(apiKey));
}

async function retrieveAnthropicModel(id, apiKey) {
  const models = await cursorModels(apiKey);
  const model = models.find((item) => item.id === id);
  if (!model) throw httpError(404, `Model ${id} was not found`, "not_found_error");
  return anthropicModelResponse(model);
}

async function handleChatCompletions(req, res, apiKey) {
  const body = await readJson(req);
  if (!Array.isArray(body.messages)) throw httpError(400, "messages must be an array");

  const prompt = chatPrompt(body);
  if (!prompt) throw httpError(400, "messages must contain text");

  const model = typeof body.model === "string" && body.model ? body.model : DEFAULT_MODEL;
  const id = `chatcmpl-${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const hasTools = (Array.isArray(body.tools) && body.tools.length > 0) ||
                   (Array.isArray(body.functions) && body.functions.length > 0);

  if (body.stream) {
    sendSseHeaders(res);

    if (hasTools) {
      // Buffer the full response so we can detect and emit tool_calls in proper streaming format.
      let fullContent = "";
      writeSse(res, chatCompletionChunk({ id, created, model, delta: { role: "assistant", content: null } }));
      await streamCursorText(prompt, model, apiKey, (delta) => { fullContent += delta; });

      const parsed = extractToolCalls(fullContent);
      if (parsed?.tool_calls) {
        const calls = parsed.tool_calls.map((tc, i) => ({
          index: i,
          id: `call_${id}_${i}`,
          type: "function",
          function: { name: tc.name, arguments: "" },
        }));
        writeSse(res, chatCompletionChunk({ id, created, model, delta: { tool_calls: calls } }));
        for (const [i, tc] of parsed.tool_calls.entries()) {
          const args = typeof tc.arguments === "string" ? tc.arguments : JSON.stringify(tc.arguments ?? {});
          writeSse(res, chatCompletionChunk({ id, created, model, delta: { tool_calls: [{ index: i, function: { arguments: args } }] } }));
        }
        writeSse(res, chatCompletionChunk({ id, created, model, delta: {}, finishReason: "tool_calls" }));
      } else {
        writeSse(res, chatCompletionChunk({ id, created, model, delta: { content: fullContent } }));
        writeSse(res, chatCompletionChunk({ id, created, model, delta: {}, finishReason: "stop" }));
      }
    } else {
      writeSse(res, chatCompletionChunk({ id, created, model, delta: { role: "assistant" } }));
      await streamCursorText(prompt, model, apiKey, (delta) => {
        writeSse(res, chatCompletionChunk({ id, created, model, delta: { content: delta } }));
      });
      writeSse(res, chatCompletionChunk({ id, created, model, delta: {}, finishReason: "stop" }));
    }

    res.end("data: [DONE]\n\n");
    return;
  }

  sendJson(
    res,
    200,
    chatCompletionResponse({
      id,
      created,
      model,
      content: await runCursorText(prompt, model, apiKey),
      prompt,
      hasTools,
    }),
  );
}

async function handleAnthropicMessages(req, res, apiKey) {
  const body = await readJson(req);
  if (!Array.isArray(body.messages)) throw httpError(400, "messages must be an array");

  const prompt = anthropicPrompt(body);
  if (!prompt) throw httpError(400, "messages must contain text");

  const model = typeof body.model === "string" && body.model ? body.model : DEFAULT_MODEL;
  const id = `msg_${randomUUID()}`;

  if (body.stream) {
    sendSseHeaders(res);
    res.write(anthropicStreamEvent("message_start", anthropicMessageStart({ id, model, prompt })));
    res.write(anthropicStreamEvent("content_block_start", anthropicTextBlockStart()));

    let content = "";
      await streamCursorText(prompt, model, apiKey, (delta) => {
        content += delta;
        res.write(anthropicStreamEvent("content_block_delta", anthropicTextDelta(delta)));
      });

    res.write(anthropicStreamEvent("content_block_stop", anthropicTextBlockStop()));
    res.write(anthropicStreamEvent("message_delta", anthropicMessageDelta(content)));
    res.write(anthropicStreamEvent("message_stop", anthropicMessageStop()));
    res.end();
    return;
  }

  sendJson(
    res,
    200,
    anthropicMessageResponse({
      id,
      model,
      content: await runCursorText(prompt, model, apiKey),
      prompt,
    }),
  );
}

async function handleAnthropicTokenCount(req, res) {
  sendJson(res, 200, anthropicTokenCount(await readJson(req)));
}

async function handleCompletions(req, res, apiKey) {
  const body = await readJson(req);
  const prompt = completionPrompt(body.prompt);
  if (!prompt) throw httpError(400, "prompt must contain text");

  const model = typeof body.model === "string" && body.model ? body.model : DEFAULT_MODEL;
  const id = `cmpl-${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);

  if (body.stream) {
    sendSseHeaders(res);
    await streamCursorText(prompt, model, apiKey, (text) => {
      writeSse(res, completionChunk({ id, created, model, text }));
    });
    writeSse(res, completionChunk({ id, created, model, text: "", finishReason: "stop" }));
    res.end("data: [DONE]\n\n");
    return;
  }

  sendJson(
    res,
    200,
    completionResponse({
      id,
      created,
      model,
      content: await runCursorText(prompt, model, apiKey),
      prompt,
    }),
  );
}

async function handleResponses(req, res, apiKey) {
  const body = await readJson(req);
  const prompt = responseInputToPrompt(body.input);
  if (!prompt) throw httpError(400, "input must contain text");

  const model = typeof body.model === "string" && body.model ? body.model : DEFAULT_MODEL;
  const id = `resp_${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);

  if (body.stream) {
    sendSseHeaders(res);
    writeSse(res, { type: "response.created", response: responseObject({ id, created, model, content: "" }) }, "response.created");

    await streamCursorText(prompt, model, apiKey, (delta) => {
      writeSse(res, { type: "response.output_text.delta", item_id: `msg_${id}`, output_index: 0, content_index: 0, delta }, "response.output_text.delta");
    });

    writeSse(res, { type: "response.completed", response: responseObject({ id, created, model, content: "" }) }, "response.completed");
    res.end("data: [DONE]\n\n");
    return;
  }

  sendJson(
    res,
    200,
    responseObject({
      id,
      created,
      model,
      content: await runCursorText(prompt, model, apiKey),
      prompt,
    }),
  );
}

async function handleEmbeddings(req, res) {
  const body = await readJson(req);
  if (body.input == null) throw httpError(400, "input is required");

  const model = typeof body.model === "string" && body.model ? body.model : DEFAULT_EMBEDDING_MODEL;
  const dimensions = Number.isInteger(body.dimensions) ? body.dimensions : DEFAULT_EMBEDDING_DIMENSIONS;
  if (dimensions < 1 || dimensions > 4096) throw httpError(400, "dimensions must be between 1 and 4096");

  sendJson(res, 200, embeddingsResponse({ model, input: body.input, dimensions }));
}

function unsupportedEndpoint(pathname) {
  return openAiError(
    `Endpoint ${pathname} is part of the OpenAI API surface, but Cursor SDK cannot provide an equivalent implementation here.`,
    "invalid_request_error",
    "not_supported",
  );
}

export function createProxyServer() {
  return createServer(async (req, res) => {
    let anthropicRequest = false;
    try {
      if (req.method === "OPTIONS") {
        addBaseHeaders(res);
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url || "/", "http://localhost");
      anthropicRequest = isAnthropicRequest(req, url.pathname);

      if (req.method === "GET" && url.pathname === "/health") {
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "GET" && url.pathname === "/workspace") {
        requireApiKey(req);
        sendJson(res, 200, { workspace: WORKSPACE_DIR, files: listWorkspaceFiles() });
        return;
      }

      if (req.method === "GET" && url.pathname.startsWith("/workspace/")) {
        requireApiKey(req);
        const rel = decodeURIComponent(url.pathname.slice("/workspace/".length));
        const target = resolve(WORKSPACE_DIR, rel);
        if (target !== WORKSPACE_DIR && !target.startsWith(WORKSPACE_DIR + "/")) {
          sendJson(res, 403, openAiError("Forbidden", "invalid_request_error"));
          return;
        }
        if (!existsSync(target) || !statSync(target).isFile()) {
          sendJson(res, 404, openAiError("File not found", "invalid_request_error", "not_found"));
          return;
        }
        addBaseHeaders(res);
        res.writeHead(200, { "content-type": "application/octet-stream" });
        createReadStream(target).pipe(res);
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/messages") {
        await handleAnthropicMessages(req, res, requireAnthropicApiKey(req));
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/messages/count_tokens") {
        requireAnthropicApiKey(req);
        await handleAnthropicTokenCount(req, res);
        return;
      }

      if (req.method === "GET" && url.pathname === "/v1/models" && anthropicRequest) {
        sendJson(res, 200, await listAnthropicModels(requireAnthropicApiKey(req)));
        return;
      }

      if (req.method === "GET" && url.pathname.startsWith("/v1/models/") && anthropicRequest) {
        sendJson(
          res,
          200,
          await retrieveAnthropicModel(
            decodeURIComponent(url.pathname.slice("/v1/models/".length)),
            requireAnthropicApiKey(req),
          ),
        );
        return;
      }

      const apiKey = url.pathname.startsWith("/v1/") ? requireApiKey(req) : "";

      if (req.method === "GET" && url.pathname === "/v1/models") {
        sendJson(res, 200, await listModels(apiKey));
        return;
      }

      if (req.method === "GET" && url.pathname.startsWith("/v1/models/")) {
        sendJson(
          res,
          200,
          await retrieveModel(decodeURIComponent(url.pathname.slice("/v1/models/".length)), apiKey),
        );
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
        await handleChatCompletions(req, res, apiKey);
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/completions") {
        await handleCompletions(req, res, apiKey);
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/responses") {
        await handleResponses(req, res, apiKey);
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/embeddings") {
        await handleEmbeddings(req, res);
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
      if (anthropicRequest) sendAnthropicError(res, error);
      else sendError(res, error);
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createProxyServer().listen(PORT, "0.0.0.0", () => {
    console.log(`cursor-openai-proxy listening on :${PORT}`);
  });
}
