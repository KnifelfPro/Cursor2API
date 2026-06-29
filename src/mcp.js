#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

export const MCP_PROTOCOL_VERSION = "2025-06-18";
export const MCP_TOOL_NAME = "cursor_agent";

const DEFAULT_MODEL = process.env.CURSOR_MODEL || "composer-2";
const MAX_PARALLEL_AGENTS = 3;
const DEFAULT_CURSOR_STORE_DIR = fileURLToPath(new URL("../.cursor-sdk-store", import.meta.url));
if (!process.env.CURSOR_STORE_DIR) process.env.CURSOR_STORE_DIR = DEFAULT_CURSOR_STORE_DIR;

export const MCP_TOOL = {
  name: MCP_TOOL_NAME,
  title: "Cursor Agent",
  description: "Run the Cursor agent in the client's current workspace.",
  inputSchema: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "Task for the Cursor agent.",
      },
      model: {
        type: "string",
        description: "Optional Cursor model id.",
      },
    },
    required: ["prompt"],
    additionalProperties: false,
  },
};

const SUPERPOWERS_FLOW = [
  "Explore project context before changing behavior.",
  "Write or update the smallest useful test before non-trivial implementation.",
  "Implement in small verifiable steps.",
  "Verify before claiming completion.",
].join(" ");

const PONYTAIL_RULES = [
  "Use the laziest solution that actually works.",
  "Reuse existing code and standard library before adding abstractions.",
  "Keep the diff small, avoid speculative scaffolding, and cap fanout.",
].join(" ");

function response(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function errorResponse(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function toolError(message) {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

function toolText(text) {
  return {
    content: [{ type: "text", text }],
    isError: false,
  };
}

function firstRootPath(result) {
  const uri = result?.roots?.find((root) => typeof root?.uri === "string" && root.uri.startsWith("file://"))?.uri;
  if (!uri) return "";

  try {
    return fileURLToPath(uri);
  } catch {
    return "";
  }
}

async function defaultRunCursorText(...args) {
  const { runCursorText } = await import("./server.js");
  return runCursorText(...args);
}

async function defaultListModels(apiKey) {
  const { Cursor } = await import("@cursor/sdk");
  const models = await Cursor.models.list({ apiKey });
  return models.length ? models : [{ id: DEFAULT_MODEL }];
}

export function createRoutingPrompt({ task, workspace, tools, models }) {
  return [
    "You are the default model for a local MCP Cursor agent router.",
    "Choose whether to handle the task yourself, delegate to one listed model, or fan out to multiple listed models.",
    "Return valid JSON only.",
    'Schema: {"mode":"self|delegate|parallel","model":"model-id","task":"worker task","agents":[{"model":"model-id","task":"worker task"}]}',
    `Superpowers workflow: ${SUPERPOWERS_FLOW}`,
    `Ponytail rules: ${PONYTAIL_RULES}`,
    `Context: ${JSON.stringify({ workspace, models, tools, task })}`,
  ].join("\n");
}

function workerPrompt(task) {
  return [`Superpowers workflow: ${SUPERPOWERS_FLOW}`, `Ponytail rules: ${PONYTAIL_RULES}`, `Task:\n${task}`].join("\n\n");
}

function synthesisPrompt(task, results) {
  return workerPrompt(
    [
      "Synthesize the final answer for the original task.",
      `Original task: ${task}`,
      `Agent results: ${JSON.stringify(results)}`,
    ].join("\n"),
  );
}

function parseJsonObject(text) {
  const raw = String(text || "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  const candidates = [raw, fenced?.[1]].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {}
  }

  return null;
}

function modelId(model) {
  return typeof model === "string" ? model : model?.id;
}

function knownModel(model, modelIds, fallback) {
  return modelIds.has(model) ? model : fallback;
}

function routingDecision(text, defaultModel, task, models) {
  const parsed = parseJsonObject(text);
  const modelIds = new Set(models.map(modelId).filter(Boolean));
  const fallback = knownModel(defaultModel, modelIds, defaultModel);

  if (parsed?.mode === "delegate") {
    return {
      mode: "delegate",
      model: knownModel(parsed.model, modelIds, fallback),
      task: typeof parsed.task === "string" && parsed.task.trim() ? parsed.task.trim() : task,
    };
  }

  if (parsed?.mode === "parallel" && Array.isArray(parsed.agents) && parsed.agents.length) {
    const agents = parsed.agents.slice(0, MAX_PARALLEL_AGENTS).map((agent) => ({
      model: knownModel(agent?.model, modelIds, fallback),
      task: typeof agent?.task === "string" && agent.task.trim() ? agent.task.trim() : task,
    }));
    return { mode: "parallel", agents };
  }

  return { mode: "self", model: fallback, task };
}

export function createMcpProtocol({
  apiKey = process.env.CURSOR_API_KEY || process.env.OPENAI_API_KEY || "",
  model = DEFAULT_MODEL,
  cwd = () => process.cwd(),
  run = defaultRunCursorText,
  listModels = defaultListModels,
  requestClient,
} = {}) {
  let clientHasRoots = false;

  async function currentWorkspace() {
    if (clientHasRoots && requestClient) {
      try {
        const root = firstRootPath(await requestClient("roots/list"));
        if (root) return root;
      } catch {}
    }
    return cwd();
  }

  async function callTool(params = {}) {
    if (params.name !== MCP_TOOL_NAME) return toolError(`Unknown tool: ${params.name || ""}`);
    if (!apiKey) return toolError("Missing CURSOR_API_KEY in MCP server environment");

    const args = params.arguments || {};
    const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
    if (!prompt) return toolError("prompt is required");

    try {
      const defaultModel = typeof args.model === "string" && args.model ? args.model : model;
      const workspace = await currentWorkspace();
      const models = await listModels(apiKey);
      const tools = [MCP_TOOL];
      const decisionText = await run(createRoutingPrompt({ task: prompt, workspace, tools, models }), defaultModel, apiKey, workspace);
      const decision = routingDecision(decisionText, defaultModel, prompt, models);

      if (decision.mode === "parallel") {
        const results = await Promise.all(
          decision.agents.map(async (agent) => ({
            model: agent.model,
            task: agent.task,
            result: await run(workerPrompt(agent.task), agent.model, apiKey, workspace),
          })),
        );
        return toolText(await run(synthesisPrompt(prompt, results), defaultModel, apiKey, workspace));
      }

      const selectedModel = decision.mode === "delegate" ? decision.model : defaultModel;
      return toolText(await run(workerPrompt(decision.task), selectedModel, apiKey, workspace));
    } catch (error) {
      return toolError(error.message || "Cursor agent failed");
    }
  }

  return {
    async handle(message) {
      if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
        return errorResponse(message?.id ?? null, -32600, "Invalid Request");
      }

      if (message.id == null) return undefined;

      if (message.method === "initialize") {
        clientHasRoots = Boolean(message.params?.capabilities?.roots);
        return response(message.id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {
            tools: { listChanged: false },
          },
          serverInfo: {
            name: "cursor-openai-proxy",
            title: "Cursor OpenAI Proxy",
            version: "0.1.0",
          },
          instructions: "Configure CURSOR_API_KEY in the MCP client. Tool calls use MCP roots, falling back to the server process cwd.",
        });
      }

      if (message.method === "ping") return response(message.id, {});
      if (message.method === "tools/list") return response(message.id, { tools: [MCP_TOOL] });
      if (message.method === "tools/call") return response(message.id, await callTool(message.params));

      return errorResponse(message.id, -32601, `Method not found: ${message.method}`);
    },
  };
}

export function startMcpStdio() {
  const pending = new Map();
  let nextRequestId = 1;

  function send(message) {
    process.stdout.write(`${JSON.stringify(message)}\n`);
  }

  function requestClient(method, params) {
    const id = `server-${nextRequestId++}`;
    send({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, 1000);
      pending.set(id, { resolve, reject, timer });
    });
  }

  const protocol = createMcpProtocol({ requestClient });
  const lines = createInterface({ input: process.stdin });

  lines.on("line", async (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      send(errorResponse(null, -32700, "Parse error"));
      return;
    }

    if (!message.method && message.id != null) {
      const pendingRequest = pending.get(String(message.id));
      if (pendingRequest) {
        pending.delete(String(message.id));
        clearTimeout(pendingRequest.timer);
        if (message.error) pendingRequest.reject(new Error(message.error.message || "Client request failed"));
        else pendingRequest.resolve(message.result);
      }
      return;
    }

    try {
      const reply = await protocol.handle(message);
      if (reply) send(reply);
    } catch (error) {
      process.stderr.write(`${error.stack || error.message}\n`);
      send(errorResponse(message.id ?? null, -32603, "Internal error"));
    }
  });
}

export function isMainEntry(argvPath, moduleUrl, realpath = realpathSync) {
  if (!argvPath) return false;

  try {
    return moduleUrl === pathToFileURL(realpath(argvPath)).href;
  } catch {
    return moduleUrl === pathToFileURL(argvPath).href;
  }
}

if (isMainEntry(process.argv[1], import.meta.url)) {
  startMcpStdio();
}
