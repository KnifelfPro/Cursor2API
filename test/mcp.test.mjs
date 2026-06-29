import assert from "node:assert/strict";
import test from "node:test";

import { createMcpProtocol, MCP_PROTOCOL_VERSION, MCP_TOOL } from "../src/mcp.js";
import { parseJsonObject, routingDecision } from "../src/mcp/routing.js";

test("routing helpers parse fenced JSON and fall back to known models", () => {
  assert.deepEqual(parseJsonObject('```json\n{"mode":"delegate","model":"missing","task":"do it"}\n```'), {
    mode: "delegate",
    model: "missing",
    task: "do it",
  });
  assert.deepEqual(
    routingDecision('{"mode":"delegate","model":"missing","task":"do it"}', "composer-2", "original", [
      { id: "composer-2" },
    ]),
    { mode: "delegate", model: "composer-2", task: "do it" },
  );
});

test("MCP protocol handles initialize, ping, tools/list, and injected tool calls", async () => {
  const calls = [];
  const protocol = createMcpProtocol({
    apiKey: "key",
    model: "composer-2",
    cwd: () => "E:/Project/Cursor2API",
    listModels: async () => [{ id: "composer-2" }],
    run: async (prompt, model, apiKey, workspace) => {
      calls.push({ prompt, model, apiKey, workspace });
      return calls.length === 1 ? '{"mode":"self","task":"answer"}' : "final answer";
    },
  });

  assert.deepEqual(await protocol.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }), {
    jsonrpc: "2.0",
    id: 1,
    result: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "cursor-openai-proxy", title: "Cursor OpenAI Proxy", version: "0.1.0" },
      instructions: "Configure CURSOR_API_KEY in the MCP client. Tool calls use MCP roots, falling back to the server process cwd.",
    },
  });
  assert.deepEqual(await protocol.handle({ jsonrpc: "2.0", id: 2, method: "ping" }), {
    jsonrpc: "2.0",
    id: 2,
    result: {},
  });
  assert.deepEqual(await protocol.handle({ jsonrpc: "2.0", id: 3, method: "tools/list" }), {
    jsonrpc: "2.0",
    id: 3,
    result: { tools: [MCP_TOOL] },
  });

  const reply = await protocol.handle({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "cursor_agent", arguments: { prompt: "work" } },
  });
  assert.equal(reply.result.isError, false);
  assert.equal(reply.result.content[0].text, "final answer");
  assert.equal(calls.length, 2);
});
