/**
 * MCP JSON-RPC handler: cursor_agent (routed) vs cursor_agent_direct (single-shot).
 * Routed calls ask the default model how to fan out, then run worker/synthesis prompts.
 */
import { fileURLToPath } from "node:url";

import { runOrchestration } from "./orchestration/runner.js";
import { createRoutingPrompt, routingDecision, synthesisPrompt, workerPrompt } from "./routing.js";

export const MCP_PROTOCOL_VERSION = "2025-06-18";
// Older revisions work too: newer notification fields are ignored by old clients,
// and elicitation/roots are only used when the client advertises the capability.
const SUPPORTED_PROTOCOL_VERSIONS = new Set([MCP_PROTOCOL_VERSION, "2025-03-26", "2024-11-05"]);
export const MCP_TOOL_NAME = "cursor_agent";
export const MCP_DIRECT_TOOL_NAME = "cursor_agent_direct";
export const MCP_PROMPT_NAME = "cursor";
export const MCP_DIRECT_PROMPT_NAME = "cursorx";

const DEFAULT_MODEL = process.env.CURSOR_MODEL || "default";
const FALLBACK_MODEL = "default";
const LOG_LEVELS = ["debug", "info", "notice", "warning", "error", "critical", "alert", "emergency"];
const CANCELLED = Symbol("cancelled");

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

export const MCP_DIRECT_TOOL = {
  name: MCP_DIRECT_TOOL_NAME,
  title: "Cursor Agent Direct",
  description: "Run the Cursor agent directly, without model routing or local workflow prompt wrapping.",
  inputSchema: MCP_TOOL.inputSchema,
};

export const MCP_PROMPT = {
  name: MCP_PROMPT_NAME,
  title: "Cursor Agent",
  description: "Run /cursor <task> [model] through the cursor_agent MCP tool.",
  arguments: [
    {
      name: "input",
      description: 'Task followed by an optional model id, for example: "你好 gpt-5.5".',
      required: true,
    },
  ],
};

export const MCP_DIRECT_PROMPT = {
  ...MCP_PROMPT,
  name: MCP_DIRECT_PROMPT_NAME,
  title: "Cursor Agent Direct",
  description: "Run /cursorx <task> [model] directly through the cursor_agent_direct MCP tool.",
};

const MCP_RESOURCES = [
  {
    uri: "cursor2api://server",
    name: "cursor2api server",
    title: "Cursor2Api Server",
    description: "Runtime information for the local cursor2api MCP server.",
    mimeType: "application/json",
  },
  {
    uri: "cursor2api://tools",
    name: "cursor2api tools",
    title: "Cursor2Api Tools",
    description: "Available cursor2api MCP tools.",
    mimeType: "application/json",
  },
  {
    uri: "cursor2api://prompts",
    name: "cursor2api prompts",
    title: "Cursor2Api Prompts",
    description: "Available cursor2api MCP prompts.",
    mimeType: "application/json",
  },
];

// Trailing token in /cursor input is treated as model id when it matches Cursor model naming.
export function looksLikeModelToken(value) {
  return /^(?:default|[a-z][a-z0-9._:-]*\d[a-z0-9._:-]*)$/i.test(String(value || ""));
}

export function splitCursorCommandInput(input) {
  const raw = String(input || "").trim();
  if (!raw) return { prompt: "", model: FALLBACK_MODEL };

  const tokens = raw.split(/\s+/);
  const last = tokens.at(-1);
  if (tokens.length > 1 && looksLikeModelToken(last)) {
    return {
      prompt: raw.slice(0, raw.length - last.length).trim(),
      model: last,
    };
  }

  return { prompt: raw, model: FALLBACK_MODEL };
}

export function createCursorPromptText(args = {}, { direct = false } = {}) {
  const explicitPrompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
  const rawInput = typeof args.input === "string" ? args.input : typeof args.task === "string" ? args.task : "";
  const parsed = splitCursorCommandInput(explicitPrompt || rawInput);
  const explicitModel = typeof args.model === "string" && args.model.trim() ? args.model.trim() : "";
  const prompt = parsed.prompt;
  const model = explicitModel || parsed.model;

  return [
    `Use the MCP tool \`${direct ? MCP_DIRECT_TOOL_NAME : MCP_TOOL_NAME}\` for this request.`,
    "Call it exactly once with this JSON input:",
    "```json",
    JSON.stringify({ prompt, model }, null, 2),
    "```",
    "Return only the tool result. If `prompt` is empty, ask the user for a task.",
  ].join("\n");
}

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

function resourceText(uri, text, mimeType = "application/json") {
  return { contents: [{ uri, mimeType, text }] };
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

function clipped(value, max = 240) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function cursorEventSummary(event) {
  if (!event?.type) return null;

  if (event.type === "status") {
    return {
      message: event.message || `Cursor run ${String(event.status || "").toLowerCase()}`,
      data: { eventType: event.type, status: event.status },
      level: event.status === "ERROR" ? "error" : "info",
    };
  }
  if (event.type === "task") {
    return {
      message: clipped([event.status, event.text].filter(Boolean).join(": ") || "Cursor task updated"),
      data: { eventType: event.type, status: event.status },
    };
  }
  if (event.type === "tool_call") {
    return {
      message: clipped(`Tool ${event.name || "call"} ${event.status || "updated"}`),
      data: { eventType: event.type, name: event.name, status: event.status },
      level: event.status === "error" ? "error" : "info",
    };
  }
  if (event.type === "system") {
    return {
      message: event.subtype === "init" ? "Cursor run initialized" : "Cursor system event",
      data: { eventType: event.type, subtype: event.subtype, model: event.model },
    };
  }
  if (event.type === "request") {
    return { message: "Cursor request started", data: { eventType: event.type, requestId: event.request_id } };
  }

  return null;
}

async function defaultRunCursorText(...args) {
  const { runCursorText } = await import("../server.js");
  return runCursorText(...args);
}

async function defaultStreamCursorText(...args) {
  const { streamCursorText } = await import("../core/cursor-runtime.js");
  return streamCursorText(...args);
}

async function defaultListModels(apiKey) {
  const { Cursor } = await import("@cursor/sdk");
  const models = await Cursor.models.list({ apiKey });
  return models.length ? models : [{ id: DEFAULT_MODEL }];
}

async function defaultRunOrchestration(options) {
  return runOrchestration(options);
}

function requestProgressToken(params) {
  const token = params?._meta?.progressToken;
  if (typeof token === "string" || Number.isInteger(token)) return token;
  return undefined;
}

export function createMcpProtocol({
  apiKey = process.env.CURSOR_API_KEY || "",
  model = DEFAULT_MODEL,
  cwd = () => process.cwd(),
  run = defaultRunCursorText,
  stream = defaultStreamCursorText,
  listModels = defaultListModels,
  orchestrate = defaultRunOrchestration,
  requestClient,
  notify,
} = {}) {
  let clientHasRoots = false;
  let clientCanElicit = false;
  let logLevel = "info";
  const pendingRequests = new Map();

  function sendNotification(method, params) {
    try {
      notify?.(method, params);
    } catch {}
  }

  function shouldLog(level) {
    return LOG_LEVELS.indexOf(level) >= LOG_LEVELS.indexOf(logLevel);
  }

  function createReporter(params = {}) {
    const progressToken = requestProgressToken(params);
    let progress = 0;

    return (phase, message, data = {}, level = "info") => {
      const text = clipped(message);
      if (shouldLog(level)) {
        sendNotification("notifications/message", {
          level,
          logger: "cursor2api.mcp",
          data: { phase, message: text, ...data },
        });
      }
      if (progressToken !== undefined) {
        sendNotification("notifications/progress", {
          progressToken,
          progress: ++progress,
          message: text,
        });
      }
    };
  }

  function reportCursorEvent(report, event) {
    const summary = cursorEventSummary(event);
    if (!summary) return;
    report("cursor_event", summary.message, summary.data, summary.level || "info");
  }

  async function runStreamingText(prompt, requestedModel, apiKey, workspace, onDelta, signal) {
    let text = "";
    if (signal?.aborted) return CANCELLED;
    await stream(
      prompt,
      requestedModel,
      apiKey,
      (delta) => {
        if (signal?.aborted) return;
        text += delta;
        onDelta(delta);
      },
      workspace,
      { signal },
    );
    if (signal?.aborted) return CANCELLED;
    return text;
  }

  // ponytail: starting an agent on an unavailable model fails the run; retry once
  // on the literal "default" model so a bad selection does not lose the task.
  async function runWithFallback(prompt, requestedModel, apiKey, workspace, { report, signal, onDelta } = {}) {
    try {
      if (signal?.aborted) return CANCELLED;
      if (onDelta) return await runStreamingText(prompt, requestedModel, apiKey, workspace, onDelta, signal);
      return await run(prompt, requestedModel, apiKey, workspace, {
        signal,
        onEvent: report ? (event) => reportCursorEvent(report, event) : undefined,
      });
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") return CANCELLED;
      if (requestedModel === FALLBACK_MODEL) throw error;
      process.stderr.write(`cursor_agent: model ${requestedModel} unavailable, falling back to ${FALLBACK_MODEL}\n`);
      report?.("fallback", `Model ${requestedModel} unavailable, falling back to ${FALLBACK_MODEL}`, { requestedModel }, "warning");
      if (onDelta) return await runStreamingText(prompt, FALLBACK_MODEL, apiKey, workspace, onDelta, signal);
      return await run(prompt, FALLBACK_MODEL, apiKey, workspace, {
        signal,
        onEvent: report ? (event) => reportCursorEvent(report, event) : undefined,
      });
    }
  }

  async function currentWorkspace() {
    if (clientHasRoots && requestClient) {
      try {
        const root = firstRootPath(await requestClient("roots/list"));
        if (root) return root;
      } catch {}
    }
    return cwd();
  }

  async function approveRun(prompt, workspace) {
    if (!clientCanElicit || typeof requestClient !== "function") return true;

    const result = await requestClient("elicitation/create", {
      message: [
        "Cursor agent wants to run in this workspace.",
        `Workspace: ${workspace}`,
        "It may read or modify files and run commands while completing the task.",
        `Task: ${prompt}`,
      ].join("\n"),
      requestedSchema: {
        type: "object",
        properties: {
          allow: {
            type: "boolean",
            title: "Allow Cursor agent run",
            description: "Approve this Cursor agent run.",
          },
        },
        required: ["allow"],
        additionalProperties: false,
      },
    });

    return result?.action === "accept" && result?.content?.allow === true;
  }

  function readResource(uri) {
    if (uri === "cursor2api://server") {
      return resourceText(uri, JSON.stringify({ name: "cursor-openai-proxy", protocolVersion: MCP_PROTOCOL_VERSION }, null, 2));
    }
    if (uri === "cursor2api://tools") return resourceText(uri, JSON.stringify({ tools: [MCP_TOOL, MCP_DIRECT_TOOL] }, null, 2));
    if (uri === "cursor2api://prompts") return resourceText(uri, JSON.stringify({ prompts: [MCP_PROMPT, MCP_DIRECT_PROMPT] }, null, 2));
    return null;
  }

  async function completeArgument(params = {}) {
    const name = params.ref?.name;
    if (params.ref?.type !== "ref/prompt" || (name !== MCP_PROMPT_NAME && name !== MCP_DIRECT_PROMPT_NAME)) {
      return { values: [], total: 0, hasMore: false };
    }

    const value = String(params.argument?.value || "").toLowerCase();
    let models = [{ id: model }, { id: FALLBACK_MODEL }];
    if (apiKey) {
      try {
        models = await listModels(apiKey);
      } catch {}
    }
    const values = [...new Set(models.map((item) => item?.id).filter(Boolean))]
      .filter((id) => String(id).toLowerCase().startsWith(value))
      .slice(0, 100);
    return { values, total: values.length, hasMore: false };
  }

  function runOptions(params, report, signal) {
    const options = { report, signal };
    if (requestProgressToken(params) !== undefined) {
      options.onDelta = (delta) => report("cursor_delta", delta, { eventType: "assistant_delta" });
    }
    return options;
  }

  async function callTool(params = {}, { signal } = {}) {
    const direct = params.name === MCP_DIRECT_TOOL_NAME;
    if (params.name !== MCP_TOOL_NAME && !direct) return toolError(`Unknown tool: ${params.name || ""}`);
    if (!apiKey) return toolError("Cursor API key not configured. Get your key at: https://cursor.com/dashboard/api?section=user-keys#user-api-keys — then set CURSOR_API_KEY in the MCP server environment or env_vars config.");

    const args = params.arguments || {};
    const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
    if (!prompt) return toolError("prompt is required");
    const report = createReporter(params);

    try {
      const defaultModel = typeof args.model === "string" && args.model ? args.model : model;
      const workspace = await currentWorkspace();
      if (!(await approveRun(prompt, workspace))) return toolError("Cursor agent run declined by user");
      if (signal?.aborted) return CANCELLED;
      report("started", `Starting ${params.name}`, { tool: params.name, model: defaultModel, workspace });
      // /cursorx: skip routing and workflow prompt wrapping.
      if (direct) {
        const result = await runWithFallback(prompt, defaultModel, apiKey, workspace, runOptions(params, report, signal));
        if (result === CANCELLED) return CANCELLED;
        if (signal?.aborted) return CANCELLED;
        report("completed", `${params.name} completed`, { tool: params.name, model: defaultModel });
        return toolText(result);
      }

      // /cursor: default model picks self, delegate, or up to MAX_PARALLEL_AGENTS workers.
      report("models", "Listing Cursor models", { model: defaultModel });
      const models = await listModels(apiKey);
      if (signal?.aborted) return CANCELLED;
      report("models", `Listed ${models.length} Cursor model${models.length === 1 ? "" : "s"}`, { count: models.length });
      const tools = [MCP_TOOL, MCP_DIRECT_TOOL];
      report("routing", "Choosing execution plan", { model: defaultModel });
      const decisionText = await runWithFallback(createRoutingPrompt({ task: prompt, workspace, tools, models }), defaultModel, apiKey, workspace, { report, signal });
      if (decisionText === CANCELLED || signal?.aborted) return CANCELLED;
      const decision = routingDecision(decisionText, defaultModel, prompt, models);
      report("routing", `Routing decision: ${decision.mode}`, {
        mode: decision.mode,
        model: decision.model,
        agents: decision.agents?.length,
      });

      if (decision.mode === "orchestrate") {
        decision.orchestration.agents.forEach((agent, index) => {
          report("subagent_created", `Created ${agent.id}`, {
            index,
            id: agent.id,
            model: agent.model,
            task: agent.task,
            agentPhase: agent.phase,
            worktree: agent.worktree,
          });
        });
        const result = await orchestrate({
          task: prompt,
          defaultModel,
          apiKey,
          workspace,
          models,
          orchestration: decision.orchestration,
          runWithFallback: async (nextPrompt, nextModel, nextApiKey, nextWorkspace, onDelta) => {
            const runResult = await runWithFallback(nextPrompt, nextModel, nextApiKey, nextWorkspace, { report, signal, onDelta });
            // Abort the whole git/verify pipeline on cancel instead of feeding CANCELLED downstream.
            if (runResult === CANCELLED) {
              const cancelledError = new Error("Cursor run cancelled");
              cancelledError.name = "AbortError";
              throw cancelledError;
            }
            return runResult;
          },
          emitProgress: (message) => report("orchestration", message),
        });
        if (result === CANCELLED || signal?.aborted) return CANCELLED;
        report("completed", `${params.name} completed`, { tool: params.name, model: defaultModel });
        return toolText(result);
      }

      if (decision.mode === "parallel") {
        const results = await Promise.all(
          decision.agents.map(async (agent, index) => {
            report("worker_started", `Starting worker ${index + 1}`, { index, model: agent.model, task: agent.task });
            const result = await runWithFallback(workerPrompt(agent.task), agent.model, apiKey, workspace, { report, signal });
            if (result === CANCELLED) return CANCELLED;
            report("worker_completed", `Worker ${index + 1} completed`, { index, model: agent.model, task: agent.task });
            return { model: agent.model, task: agent.task, result };
          }),
        );
        if (signal?.aborted || results.includes(CANCELLED)) return CANCELLED;
        report("synthesis", "Synthesizing worker results", { count: results.length });
        const result = await runWithFallback(synthesisPrompt(prompt, results), defaultModel, apiKey, workspace, { report, signal });
        if (result === CANCELLED || signal?.aborted) return CANCELLED;
        report("completed", `${params.name} completed`, { tool: params.name, model: defaultModel });
        return toolText(result);
      }

      const selectedModel = decision.mode === "delegate" ? decision.model : defaultModel;
      report("worker_started", "Starting Cursor worker", { mode: decision.mode, model: selectedModel, task: decision.task });
      const result = await runWithFallback(workerPrompt(decision.task), selectedModel, apiKey, workspace, { report, signal });
      if (result === CANCELLED || signal?.aborted) return CANCELLED;
      report("worker_completed", "Cursor worker completed", { mode: decision.mode, model: selectedModel, task: decision.task });
      report("completed", `${params.name} completed`, { tool: params.name, model: selectedModel });
      return toolText(result);
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") return CANCELLED;
      report("error", error.message || "Cursor agent failed", {}, "error");
      return toolError(error.message || "Cursor agent failed");
    }
  }

  return {
    async handle(message) {
      if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
        return errorResponse(message?.id ?? null, -32600, "Invalid Request");
      }

      if (message.method === "notifications/cancelled") {
        const request = pendingRequests.get(String(message.params?.requestId || ""));
        request?.abort(message.params?.reason || "cancelled");
        if (request) {
          sendNotification("notifications/message", {
            level: "notice",
            logger: "cursor2api.mcp",
            data: { phase: "cancelled", requestId: message.params?.requestId, reason: message.params?.reason || "" },
          });
        }
        return undefined;
      }

      if (message.id == null) return undefined;

      if (message.method === "initialize") {
        clientHasRoots = Boolean(message.params?.capabilities?.roots);
        clientCanElicit = Boolean(message.params?.capabilities?.elicitation);
        const requestedVersion = message.params?.protocolVersion;
        return response(message.id, {
          protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.has(requestedVersion) ? requestedVersion : MCP_PROTOCOL_VERSION,
          capabilities: {
            tools: { listChanged: false },
            prompts: { listChanged: false },
            resources: {},
            completions: {},
            logging: {},
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
      if (message.method === "logging/setLevel") {
        const level = message.params?.level;
        if (!LOG_LEVELS.includes(level)) return errorResponse(message.id, -32602, `Invalid log level: ${level || ""}`);
        logLevel = level;
        return response(message.id, {});
      }
      if (message.method === "tools/list") return response(message.id, { tools: [MCP_TOOL, MCP_DIRECT_TOOL] });
      if (message.method === "tools/call") {
        const controller = new AbortController();
        pendingRequests.set(String(message.id), controller);
        try {
          const result = await callTool(message.params, { signal: controller.signal });
          if (result === CANCELLED) return undefined;
          return response(message.id, result);
        } finally {
          pendingRequests.delete(String(message.id));
        }
      }
      if (message.method === "prompts/list") return response(message.id, { prompts: [MCP_PROMPT, MCP_DIRECT_PROMPT] });
      if (message.method === "prompts/get") {
        const direct = message.params?.name === MCP_DIRECT_PROMPT_NAME;
        if (message.params?.name !== MCP_PROMPT_NAME && !direct) {
          return errorResponse(message.id, -32602, `Unknown prompt: ${message.params?.name || ""}`);
        }
        const prompt = direct ? MCP_DIRECT_PROMPT : MCP_PROMPT;
        return response(message.id, {
          description: prompt.description,
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: createCursorPromptText(message.params?.arguments || {}, { direct }),
              },
            },
          ],
        });
      }
      if (message.method === "resources/list") return response(message.id, { resources: MCP_RESOURCES });
      if (message.method === "resources/templates/list") return response(message.id, { resourceTemplates: [] });
      if (message.method === "resources/read") {
        const resource = readResource(message.params?.uri);
        if (!resource) return errorResponse(message.id, -32602, `Unknown resource: ${message.params?.uri || ""}`);
        return response(message.id, resource);
      }
      if (message.method === "completion/complete") return response(message.id, { completion: await completeArgument(message.params) });

      return errorResponse(message.id, -32601, `Method not found: ${message.method}`);
    },
  };
}
