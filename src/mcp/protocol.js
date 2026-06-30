/**
 * MCP JSON-RPC handler: cursor_agent (routed) vs cursor_agent_direct (single-shot).
 * Routed calls ask the default model how to fan out, then run worker/synthesis prompts.
 */
import { fileURLToPath } from "node:url";

import { createRoutingPrompt, routingDecision, synthesisPrompt, workerPrompt } from "./routing.js";

export const MCP_PROTOCOL_VERSION = "2025-06-18";
export const MCP_TOOL_NAME = "cursor_agent";
export const MCP_DIRECT_TOOL_NAME = "cursor_agent_direct";
export const MCP_PROMPT_NAME = "cursor";
export const MCP_DIRECT_PROMPT_NAME = "cursorx";

const DEFAULT_MODEL = process.env.CURSOR_MODEL || "default";
const FALLBACK_MODEL = "default";

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
  requestClient,
  notify,
} = {}) {
  let clientHasRoots = false;
  let clientCanElicit = false;

  function createProgressEmitter(params) {
    const progressToken = requestProgressToken(params);
    if (progressToken === undefined || typeof notify !== "function") return undefined;

    let progress = 0;
    return (message) => {
      if (!message) return;
      notify("notifications/progress", {
        progressToken,
        progress: ++progress,
        message: String(message),
      });
    };
  }

  async function runStreamingText(prompt, requestedModel, apiKey, workspace, onDelta) {
    let text = "";
    await stream(
      prompt,
      requestedModel,
      apiKey,
      (delta) => {
        text += delta;
        onDelta(delta);
      },
      workspace,
    );
    return text;
  }

  // ponytail: starting an agent on an unavailable model fails the run; retry once
  // on the literal "default" model so a bad selection does not lose the task.
  async function runWithFallback(prompt, requestedModel, apiKey, workspace, onDelta) {
    const runner = onDelta ? runStreamingText : run;
    try {
      return await runner(prompt, requestedModel, apiKey, workspace, onDelta);
    } catch (error) {
      if (requestedModel === FALLBACK_MODEL) throw error;
      process.stderr.write(`cursor_agent: model ${requestedModel} unavailable, falling back to ${FALLBACK_MODEL}\n`);
      return await runner(prompt, FALLBACK_MODEL, apiKey, workspace, onDelta);
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

  async function callTool(params = {}) {
    const direct = params.name === MCP_DIRECT_TOOL_NAME;
    if (params.name !== MCP_TOOL_NAME && !direct) return toolError(`Unknown tool: ${params.name || ""}`);
    if (!apiKey) return toolError("Cursor API key not configured. Get your key at: https://cursor.com/dashboard/api?section=user-keys#user-api-keys — then set CURSOR_API_KEY in the MCP server environment or env_vars config.");

    const args = params.arguments || {};
    const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
    if (!prompt) return toolError("prompt is required");

    try {
      const defaultModel = typeof args.model === "string" && args.model ? args.model : model;
      const workspace = await currentWorkspace();
      if (!(await approveRun(prompt, workspace))) return toolError("Cursor agent run declined by user");
      const emitProgress = createProgressEmitter(params);
      // /cursorx: skip routing and workflow prompt wrapping.
      if (direct) return toolText(await runWithFallback(prompt, defaultModel, apiKey, workspace, emitProgress));

      // /cursor: default model picks self, delegate, or up to MAX_PARALLEL_AGENTS workers.
      const models = await listModels(apiKey);
      const tools = [MCP_TOOL, MCP_DIRECT_TOOL];
      const decisionText = await runWithFallback(createRoutingPrompt({ task: prompt, workspace, tools, models }), defaultModel, apiKey, workspace);
      const decision = routingDecision(decisionText, defaultModel, prompt, models);

      if (decision.mode === "parallel") {
        const results = await Promise.all(
          decision.agents.map(async (agent) => ({
            model: agent.model,
            task: agent.task,
            result: await runWithFallback(workerPrompt(agent.task), agent.model, apiKey, workspace),
          })),
        );
        return toolText(await runWithFallback(synthesisPrompt(prompt, results), defaultModel, apiKey, workspace, emitProgress));
      }

      const selectedModel = decision.mode === "delegate" ? decision.model : defaultModel;
      return toolText(await runWithFallback(workerPrompt(decision.task), selectedModel, apiKey, workspace, emitProgress));
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
        clientCanElicit = Boolean(message.params?.capabilities?.elicitation);
        return response(message.id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {
            tools: { listChanged: false },
            prompts: { listChanged: false },
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
      if (message.method === "tools/list") return response(message.id, { tools: [MCP_TOOL, MCP_DIRECT_TOOL] });
      if (message.method === "tools/call") return response(message.id, await callTool(message.params));
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

      return errorResponse(message.id, -32601, `Method not found: ${message.method}`);
    },
  };
}
