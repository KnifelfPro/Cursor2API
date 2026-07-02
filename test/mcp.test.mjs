import assert from "node:assert/strict";
import test from "node:test";

import {
  clientRequestTimeoutMs,
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

test("MCP stdio gives human elicitation requests enough time", () => {
  assert.equal(clientRequestTimeoutMs("roots/list"), 1000);
  assert.equal(clientRequestTimeoutMs("elicitation/create"), 300000);
});

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

test("routing prompt offers server-internal orchestration without client-side subagents", () => {
  const prompt = createRoutingPrompt({
    task: "implement a complex local feature",
    workspace: "/tmp/work",
    tools: [MCP_TOOL, MCP_DIRECT_TOOL],
    models: [{ id: "default" }, { id: "composer-2" }],
  });

  assert.match(prompt, /orchestrate/i);
  assert.match(prompt, /1 to 10 subagents/i);
  assert.match(prompt, /inside the MCP server/i);
  assert.match(prompt, /client only invokes/i);
  assert.match(prompt, /worktree/i);
});

test("routing decision accepts orchestrate plans and falls back unknown models", () => {
  const decision = routingDecision(
    JSON.stringify({
      mode: "orchestrate",
      orchestration: {
        summary: "complex local implementation",
        agents: [
          {
            id: "agent-1",
            model: "missing-model",
            task: "change one module",
            phase: "implement",
            dependsOn: [],
            worktree: "chain-a",
          },
        ],
        mergeOrder: ["chain-a"],
        verify: [],
      },
    }),
    "default",
    "original task",
    [{ id: "default" }, { id: "composer-2" }],
  );

  assert.equal(decision.mode, "orchestrate");
  assert.equal(decision.orchestration.agents.length, 1);
  assert.equal(decision.orchestration.agents[0].model, "default");
  assert.equal(decision.orchestration.agents[0].task, "change one module");
  assert.deepEqual(decision.orchestration.verify, ["npm test"]);
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
      capabilities: { tools: { listChanged: false }, prompts: { listChanged: false }, resources: {}, completions: {}, logging: {} },
      serverInfo: { name: "cursor-openai-proxy", title: "Cursor OpenAI Proxy", version: "0.1.0" },
      instructions: "Configure CURSOR_API_KEY in the MCP client. Tool calls use MCP roots, falling back to the server process cwd.",
    },
  });
  // Version negotiation: echo a supported requested version, otherwise answer with the latest.
  const older = await protocol.handle({
    jsonrpc: "2.0",
    id: 10,
    method: "initialize",
    params: { protocolVersion: "2025-03-26" },
  });
  assert.equal(older.result.protocolVersion, "2025-03-26");
  const unknown = await protocol.handle({
    jsonrpc: "2.0",
    id: 11,
    method: "initialize",
    params: { protocolVersion: "1999-01-01" },
  });
  assert.equal(unknown.result.protocolVersion, MCP_PROTOCOL_VERSION);
  assert.deepEqual(await protocol.handle({ jsonrpc: "2.0", id: 2, method: "ping" }), {
    jsonrpc: "2.0",
    id: 2,
    result: {},
  });
  assert.deepEqual(await protocol.handle({ jsonrpc: "2.0", id: 20, method: "logging/setLevel", params: { level: "debug" } }), {
    jsonrpc: "2.0",
    id: 20,
    result: {},
  });
  assert.equal(
    (await protocol.handle({ jsonrpc: "2.0", id: 21, method: "logging/setLevel", params: { level: "verbose" } })).error.code,
    -32602,
  );
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

test("cursor_agent executes orchestrate decisions inside the MCP server", async () => {
  const calls = [];
  const orchestrationCalls = [];
  const notifications = [];
  const protocol = createMcpProtocol({
    apiKey: "key",
    model: "default",
    cwd: () => "/tmp/work",
    notify: (method, params) => {
      notifications.push({ method, params });
    },
    listModels: async () => [{ id: "default" }],
    run: async (prompt, model, apiKey, workspace) => {
      calls.push({ prompt, model, apiKey, workspace });
      return JSON.stringify({
        mode: "orchestrate",
        orchestration: {
          summary: "complex local work",
          agents: [{ id: "agent-1", model: "default", task: "edit locally", dependsOn: [], worktree: "chain-a" }],
          verify: ["npm test"],
        },
      });
    },
    orchestrate: async (input) => {
      orchestrationCalls.push(input);
      return "orchestrated answer";
    },
  });

  const reply = await protocol.handle({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "cursor_agent", arguments: { prompt: "complex work" } },
  });

  assert.equal(reply.result.isError, false);
  assert.equal(reply.result.content[0].text, "orchestrated answer");
  assert.equal(calls.length, 1);
  assert.equal(orchestrationCalls.length, 1);
  assert.equal(orchestrationCalls[0].task, "complex work");
  assert.equal(orchestrationCalls[0].workspace, "/tmp/work");
  assert.equal(orchestrationCalls[0].orchestration.agents[0].task, "edit locally");
  assert.ok(
    notifications.some(
      (message) =>
        message.method === "notifications/message" &&
        message.params.data.phase === "subagent_created" &&
        message.params.data.model === "default" &&
        message.params.data.task === "edit locally",
    ),
  );
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

  assert.ok(
    notifications.some(
      (message) =>
        message.method === "notifications/progress" &&
        message.params.progressToken === "run-1" &&
        message.params.message === "Starting cursor_agent_direct",
    ),
  );
  assert.ok(
    notifications.some(
      (message) =>
        message.method === "notifications/progress" &&
        message.params.progressToken === "run-1" &&
        message.params.message === "partial",
    ),
  );

  allowFinish();
  const reply = await pendingReply;

  assert.equal(reply.result.isError, false);
  assert.equal(reply.result.content[0].text, "partial answer");
  assert.ok(
    notifications.some(
      (message) =>
        message.method === "notifications/progress" &&
        message.params.progressToken === "run-1" &&
        message.params.message === "answer",
    ),
  );
});

test("MCP tool emits client-visible logs and progress while routed calls run", async () => {
  const notifications = [];
  let runCount = 0;
  const protocol = createMcpProtocol({
    apiKey: "key",
    model: "default",
    cwd: () => "/tmp/work",
    notify: (method, params) => notifications.push({ method, params }),
    listModels: async () => [{ id: "default" }],
    run: async (...args) => {
      const options = args[4];
      if (++runCount === 1) return '{"mode":"delegate","model":"default","task":"build"}';
      options.onEvent({ type: "task", status: "running", text: "building files" });
      return "done";
    },
  });

  const initialized = await protocol.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  assert.deepEqual(initialized.result.capabilities.logging, {});

  const reply = await protocol.handle({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "cursor_agent",
      arguments: { prompt: "work" },
      _meta: { progressToken: "progress-1" },
    },
  });

  assert.equal(reply.result.isError, false);
  assert.equal(reply.result.content[0].text, "done");
  assert.ok(notifications.some((message) => message.method === "notifications/message" && message.params.data.phase === "routing"));
  assert.ok(notifications.some((message) => message.method === "notifications/message" && message.params.data.eventType === "task"));
  assert.ok(notifications.some((message) => message.method === "notifications/message" && message.params.data.phase === "worker_completed"));
  assert.ok(
    notifications.some(
      (message) => message.method === "notifications/progress" && message.params.progressToken === "progress-1" && message.params.message,
    ),
  );
});

test("parallel routing reports each sub-agent model and task", async () => {
  const notifications = [];
  let runCount = 0;
  const protocol = createMcpProtocol({
    apiKey: "key",
    model: "default",
    cwd: () => "/tmp/work",
    notify: (method, params) => notifications.push({ method, params }),
    listModels: async () => [{ id: "default" }, { id: "composer-2" }],
    run: async () => {
      runCount++;
      if (runCount === 1) {
        return JSON.stringify({
          mode: "parallel",
          agents: [
            { model: "default", task: "build snake" },
            { model: "composer-2", task: "build 2048" },
          ],
        });
      }
      return runCount === 4 ? "final" : `worker-${runCount}`;
    },
  });

  const reply = await protocol.handle({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "cursor_agent", arguments: { prompt: "build games" } },
  });

  assert.equal(reply.result.isError, false);
  assert.equal(reply.result.content[0].text, "final");
  assert.ok(
    notifications.some(
      (message) =>
        message.method === "notifications/message" &&
        message.params.data.phase === "worker_started" &&
        message.params.data.model === "default" &&
        message.params.data.task === "build snake",
    ),
  );
  assert.ok(
    notifications.some(
      (message) =>
        message.method === "notifications/message" &&
        message.params.data.phase === "worker_started" &&
        message.params.data.model === "composer-2" &&
        message.params.data.task === "build 2048",
    ),
  );
});

test("MCP protocol exposes resources and completions", async () => {
  const protocol = createMcpProtocol({
    apiKey: "key",
    listModels: async () => [{ id: "default" }, { id: "composer-2" }],
  });

  const initialized = await protocol.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  assert.deepEqual(initialized.result.capabilities.resources, {});
  assert.deepEqual(initialized.result.capabilities.completions, {});

  const listed = await protocol.handle({ jsonrpc: "2.0", id: 2, method: "resources/list" });
  assert.ok(listed.result.resources.some((resource) => resource.uri === "cursor2api://tools"));

  const read = await protocol.handle({
    jsonrpc: "2.0",
    id: 3,
    method: "resources/read",
    params: { uri: "cursor2api://tools" },
  });
  assert.match(read.result.contents[0].text, /cursor_agent/);

  assert.deepEqual(await protocol.handle({ jsonrpc: "2.0", id: 4, method: "resources/templates/list" }), {
    jsonrpc: "2.0",
    id: 4,
    result: { resourceTemplates: [] },
  });

  const completed = await protocol.handle({
    jsonrpc: "2.0",
    id: 5,
    method: "completion/complete",
    params: {
      ref: { type: "ref/prompt", name: "cursor" },
      argument: { name: "input", value: "com" },
    },
  });
  assert.deepEqual(completed.result.completion, { values: ["composer-2"], total: 1, hasMore: false });
});

test("MCP cancellation aborts an active tool request without sending a response", async () => {
  let signal;
  const protocol = createMcpProtocol({
    apiKey: "key",
    model: "default",
    listModels: async () => [{ id: "default" }],
    run: async (...args) => {
      const options = args[4];
      signal = options.signal;
      if (args[0].includes("local MCP Cursor agent router")) return '{"mode":"self","task":"work"}';
      return new Promise((resolve) => {
        options.signal.addEventListener("abort", () => resolve("cancelled"), { once: true });
      });
    },
  });

  const pending = protocol.handle({
    jsonrpc: "2.0",
    id: "call-1",
    method: "tools/call",
    params: { name: "cursor_agent", arguments: { prompt: "work" } },
  });

  while (!signal) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(
    await protocol.handle({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: "call-1", reason: "user stopped" },
    }),
    undefined,
  );

  assert.equal(signal.aborted, true);
  assert.equal(await pending, undefined);
});

test("MCP protocol asks the client for approval before starting a supported tool run", async () => {
  const clientRequests = [];
  const protocol = createMcpProtocol({
    apiKey: "key",
    model: "default",
    cwd: () => "/tmp/work",
    run: async () => {
      throw new Error("should not run when approval is declined");
    },
    requestClient: async (method, params) => {
      clientRequests.push({ method, params });
      return { action: "decline" };
    },
  });

  await protocol.handle({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { capabilities: { elicitation: {} } },
  });

  const reply = await protocol.handle({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "cursor_agent_direct", arguments: { prompt: "hello" } },
  });

  assert.equal(reply.result.isError, true);
  assert.match(reply.result.content[0].text, /declined/i);
  assert.equal(clientRequests.length, 1);
  assert.equal(clientRequests[0].method, "elicitation/create");
  assert.match(clientRequests[0].params.message, /Cursor agent/i);
  assert.equal(clientRequests[0].params.requestedSchema.properties.allow.type, "boolean");
});

test("MCP protocol starts a supported tool run after client approval", async () => {
  const clientRequests = [];
  const calls = [];
  const protocol = createMcpProtocol({
    apiKey: "key",
    model: "default",
    cwd: () => "/tmp/work",
    run: async (prompt, model, apiKey, workspace) => {
      calls.push({ prompt, model, apiKey, workspace });
      return "approved answer";
    },
    requestClient: async (method, params) => {
      clientRequests.push({ method, params });
      return { action: "accept", content: { allow: true } };
    },
  });

  await protocol.handle({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { capabilities: { elicitation: {} } },
  });

  const reply = await protocol.handle({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "cursor_agent_direct", arguments: { prompt: "hello" } },
  });

  assert.equal(reply.result.isError, false);
  assert.equal(reply.result.content[0].text, "approved answer");
  assert.equal(clientRequests.length, 1);
  assert.deepEqual(calls, [{ prompt: "hello", model: "default", apiKey: "key", workspace: "/tmp/work" }]);
});
