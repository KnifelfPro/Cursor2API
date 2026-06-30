import { fileURLToPath } from "node:url";

import { createRoutingPrompt, routingDecision, synthesisPrompt, workerPrompt } from "./routing.js";

export const MCP_PROTOCOL_VERSION = "2025-06-18";
export const MCP_TOOL_NAME = "cursor_agent";

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

async function defaultListModels(apiKey) {
  const { Cursor } = await import("@cursor/sdk");
  const models = await Cursor.models.list({ apiKey });
  return models.length ? models : [{ id: DEFAULT_MODEL }];
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

  // ponytail: starting an agent on an unavailable model fails the run; retry once
  // on the literal "default" model so a bad selection does not lose the task.
  async function runWithFallback(prompt, requestedModel, apiKey, workspace) {
    try {
      return await run(prompt, requestedModel, apiKey, workspace);
    } catch (error) {
      if (requestedModel === FALLBACK_MODEL) throw error;
      process.stderr.write(`cursor_agent: model ${requestedModel} unavailable, falling back to ${FALLBACK_MODEL}\n`);
      return await run(prompt, FALLBACK_MODEL, apiKey, workspace);
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
        return toolText(await runWithFallback(synthesisPrompt(prompt, results), defaultModel, apiKey, workspace));
      }

      const selectedModel = decision.mode === "delegate" ? decision.model : defaultModel;
      return toolText(await runWithFallback(workerPrompt(decision.task), selectedModel, apiKey, workspace));
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
