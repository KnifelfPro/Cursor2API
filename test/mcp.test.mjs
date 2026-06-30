import assert from "node:assert/strict";
import test from "node:test";

import {
  createCursorPromptText,
  createMcpProtocol,
  MCP_DIRECT_PROMPT,
  MCP_DIRECT_TOOL,
  MCP_PROMPT,
  MCP_PROTOCOL_VERSION,
  MCP_TOOL,
  splitCursorCommandInput,
} from "../src/mcp.js";
import { createRoutingPrompt, parseJsonObject, routingDecision } from "../src/mcp/routing.js";

test("routing helpers parse fenced JSON and fall back to known models", () => {
  assert.deepEqual(parseJsonObject('```json\n{"mode":"delegate","model":"missing","task":"do it"}\n```'), {
    mode: "delegate",
    model: "missing",
    task: "do it",
  });
  assert.deepEqual(
    routingDecision('{"mode":"delegate","model":"missing","task":"do it"}', "default", "original", [
      { id: "default" },
    ]),
    { mode: "delegate", model: "default", task: "do it" },
  );
});

test("routing prompt tells the router to choose models by task difficulty", () => {
  const prompt = createRoutingPrompt({
    task: "work",
    workspace: "/tmp/work",
    tools: [MCP_TOOL],
    models: [{ id: "default" }, { id: "composer-2" }],
  });

  assert.match(prompt, /task difficulty/i);
  assert.match(prompt, /model capability/i);
  assert.match(prompt, /low or medium difficulty/i);
  assert.match(prompt, /do not delegate or parallelize/i);
});

test("cursor prompt parses an optional trailing model", () => {
  assert.deepEqual(splitCursorCommandInput("你好 gpt-5.5"), { prompt: "你好", model: "gpt-5.5" });
  assert.deepEqual(splitCursorCommandInput("你好"), { prompt: "你好", model: "default" });
  assert.match(createCursorPromptText({ input: "修复测试 composer-2" }), /"model": "composer-2"/);
});

test("MCP protocol handles initialize, ping, tools/list, and injected tool calls", async () => {
  const calls = [];
  const protocol = createMcpProtocol({
    apiKey: "key",
    model: "default",
    cwd: () => "E:/Project/Cursor2API",
    listModels: async () => [{ id: "default" }],
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
      capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
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
    result: { tools: [MCP_TOOL, MCP_DIRECT_TOOL] },
  });
  assert.deepEqual(await protocol.handle({ jsonrpc: "2.0", id: 30, method: "prompts/list" }), {
    jsonrpc: "2.0",
    id: 30,
    result: { prompts: [MCP_PROMPT, MCP_DIRECT_PROMPT] },
  });
  const promptReply = await protocol.handle({
    jsonrpc: "2.0",
    id: 31,
    method: "prompts/get",
    params: { name: "cursor", arguments: { input: "hello gpt-5.5" } },
  });
  assert.match(promptReply.result.messages[0].content.text, /"prompt": "hello"/);
  assert.match(promptReply.result.messages[0].content.text, /"model": "gpt-5.5"/);

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

test("cursorx direct tool skips routing, model listing, and workflow wrapping", async () => {
  const calls = [];
  const protocol = createMcpProtocol({
    apiKey: "key",
    model: "default",
    cwd: () => "/tmp/work",
    listModels: async () => {
      throw new Error("should not list models");
    },
    run: async (prompt, model, apiKey, workspace) => {
      calls.push({ prompt, model, apiKey, workspace });
      return "direct answer";
    },
  });

  const promptReply = await protocol.handle({
    jsonrpc: "2.0",
    id: 1,
    method: "prompts/get",
    params: { name: "cursorx", arguments: { input: "hello gpt-5.5" } },
  });
  assert.match(promptReply.result.messages[0].content.text, /cursor_agent_direct/);
  assert.match(promptReply.result.messages[0].content.text, /"prompt": "hello"/);
  assert.match(promptReply.result.messages[0].content.text, /"model": "gpt-5.5"/);

  const reply = await protocol.handle({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "cursor_agent_direct", arguments: { prompt: "hello", model: "gpt-5.5" } },
  });

  assert.equal(reply.result.isError, false);
  assert.equal(reply.result.content[0].text, "direct answer");
  assert.deepEqual(calls, [{ prompt: "hello", model: "gpt-5.5", apiKey: "key", workspace: "/tmp/work" }]);
});

test("cursorx direct tool emits progress notifications while the run is still active", async () => {
  const notifications = [];
  let resolveStreamStarted;
  let allowFinish;
  const streamStarted = new Promise((resolve) => {
    resolveStreamStarted = resolve;
  });
  const finishRun = new Promise((resolve) => {
    allowFinish = resolve;
  });

  const protocol = createMcpProtocol({
    apiKey: "key",
    model: "default",
    cwd: () => "/tmp/work",
    run: async () => "non-streaming answer",
    stream: async (prompt, model, apiKey, onDelta, workspace) => {
      assert.equal(prompt, "hello");
      assert.equal(model, "default");
      assert.equal(apiKey, "key");
      assert.equal(workspace, "/tmp/work");
      onDelta("partial");
      resolveStreamStarted();
      await finishRun;
      onDelta(" answer");
    },
    notify: (method, params) => {
      notifications.push({ method, params });
    },
  });

  const pendingReply = protocol.handle({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "cursor_agent_direct",
      arguments: { prompt: "hello" },
      _meta: { progressToken: "run-1" },
    },
  });

  await Promise.race([
    streamStarted,
    pendingReply.then(() => assert.fail("tool call returned before streaming started")),
  ]);

  assert.deepEqual(notifications, [
    {
      method: "notifications/progress",
      params: { progressToken: "run-1", progress: 1, message: "partial" },
    },
  ]);

  allowFinish();
  const reply = await pendingReply;

  assert.equal(reply.result.isError, false);
  assert.equal(reply.result.content[0].text, "partial answer");
  assert.deepEqual(notifications.at(-1), {
    method: "notifications/progress",
    params: { progressToken: "run-1", progress: 2, message: " answer" },
  });
});
