import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createMcpProtocol, createRoutingPrompt, isMainEntry, MCP_PROTOCOL_VERSION, MCP_TOOL_NAME } from "./mcp.js";

test("MCP initialize advertises tools capability", async () => {
  const mcp = createMcpProtocol();
  const reply = await mcp.handle({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: { roots: {} } },
  });

  assert.equal(reply.result.protocolVersion, MCP_PROTOCOL_VERSION);
  assert.deepEqual(reply.result.capabilities, { tools: { listChanged: false } });
});

test("MCP lists the Cursor agent tool", async () => {
  const mcp = createMcpProtocol();
  const reply = await mcp.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" });

  assert.equal(reply.result.tools[0].name, MCP_TOOL_NAME);
  assert.deepEqual(reply.result.tools[0].inputSchema.required, ["prompt"]);
});

test("MCP tool calls use client roots as workspace", async () => {
  const calls = [];
  const mcp = createMcpProtocol({
    apiKey: "crsr_test",
    cwd: () => "/fallback",
    listModels: async () => [{ id: "composer-2" }],
    requestClient: async (method) => {
      assert.equal(method, "roots/list");
      return { roots: [{ uri: "file:///tmp/current-project", name: "current-project" }] };
    },
    run: async (prompt, model, apiKey, workspace) => {
      calls.push({ prompt, model, apiKey, workspace });
      return calls.length === 1 ? JSON.stringify({ mode: "self" }) : "done";
    },
  });

  await mcp.handle({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { capabilities: { roots: {} } },
  });
  const reply = await mcp.handle({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: MCP_TOOL_NAME, arguments: { prompt: "ship it", model: "composer-2" } },
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].workspace, "/tmp/current-project");
  assert.equal(calls[1].workspace, "/tmp/current-project");
  assert.deepEqual(reply.result, {
    content: [{ type: "text", text: "done" }],
    isError: false,
  });
});

test("MCP asks default model to choose using models, tools, task, and workspace", async () => {
  const calls = [];
  const mcp = createMcpProtocol({
    apiKey: "crsr_test",
    cwd: () => "/project",
    listModels: async () => [{ id: "default" }, { id: "specialist" }],
    run: async (prompt, model, apiKey, workspace) => {
      calls.push({ prompt, model, apiKey, workspace });
      return calls.length === 1
        ? JSON.stringify({ mode: "delegate", model: "specialist", task: "handle it" })
        : "delegated result";
    },
  });

  const reply = await mcp.handle({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: MCP_TOOL_NAME, arguments: { prompt: "handle it", model: "default" } },
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].model, "default");
  assert.equal(calls[0].workspace, "/project");
  assert.match(calls[0].prompt, /"id":"specialist"/);
  assert.match(calls[0].prompt, /cursor_agent/);
  assert.match(calls[0].prompt, /handle it/);
  assert.match(calls[0].prompt, /Superpowers workflow/);
  assert.equal(calls[1].model, "specialist");
  assert.match(calls[1].prompt, /Task:\nhandle it/);
  assert.match(calls[1].prompt, /Ponytail rules/);
  assert.deepEqual(reply.result, {
    content: [{ type: "text", text: "delegated result" }],
    isError: false,
  });
});

test("MCP falls back to self when default model returns non-JSON", async () => {
  const calls = [];
  const mcp = createMcpProtocol({
    apiKey: "crsr_test",
    cwd: () => "/project",
    listModels: async () => [{ id: "default" }],
    run: async (prompt, model) => {
      calls.push({ prompt, model });
      return calls.length === 1 ? "not json" : "self result";
    },
  });

  const reply = await mcp.handle({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: MCP_TOOL_NAME, arguments: { prompt: "do it", model: "default" } },
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[1].model, "default");
  assert.match(calls[1].prompt, /Task:\ndo it/);
  assert.equal(reply.result.content[0].text, "self result");
});

test("MCP lets default model fan out to multiple agents and synthesize", async () => {
  const calls = [];
  const mcp = createMcpProtocol({
    apiKey: "crsr_test",
    cwd: () => "/project",
    listModels: async () => [{ id: "default" }, { id: "a" }, { id: "b" }],
    run: async (prompt, model) => {
      calls.push({ prompt, model });
      if (calls.length === 1) {
        return JSON.stringify({
          mode: "parallel",
          agents: [
            { model: "a", task: "part a" },
            { model: "b", task: "part b" },
          ],
        });
      }
      if (model === "a") return "result a";
      if (model === "b") return "result b";
      return "final result";
    },
  });

  const reply = await mcp.handle({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: MCP_TOOL_NAME, arguments: { prompt: "split it", model: "default" } },
  });

  assert.deepEqual(calls.map((call) => call.model), ["default", "a", "b", "default"]);
  assert.match(calls[3].prompt, /result a/);
  assert.match(calls[3].prompt, /result b/);
  assert.equal(reply.result.content[0].text, "final result");
});

test("MCP falls back to the default model when an agent model is unavailable", async () => {
  const calls = [];
  const mcp = createMcpProtocol({
    apiKey: "crsr_test",
    cwd: () => "/project",
    listModels: async () => [{ id: "default" }, { id: "specialist" }],
    run: async (prompt, model) => {
      calls.push({ prompt, model });
      if (calls.length === 1) return JSON.stringify({ mode: "delegate", model: "specialist", task: "handle it" });
      if (model === "specialist") throw new Error("model specialist is unavailable");
      return "fallback result";
    },
  });

  const reply = await mcp.handle({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: MCP_TOOL_NAME, arguments: { prompt: "handle it", model: "default" } },
  });

  assert.deepEqual(calls.map((call) => call.model), ["default", "specialist", "default"]);
  assert.match(calls[2].prompt, /Task:\nhandle it/);
  assert.equal(reply.result.content[0].text, "fallback result");
  assert.equal(reply.result.isError, false);
});

test("MCP does not retry when the default model itself is unavailable", async () => {
  const calls = [];
  const mcp = createMcpProtocol({
    apiKey: "crsr_test",
    cwd: () => "/project",
    listModels: async () => [{ id: "default" }],
    run: async (prompt, model) => {
      calls.push({ prompt, model });
      if (calls.length === 1) return JSON.stringify({ mode: "self" });
      throw new Error("model default is unavailable");
    },
  });

  const reply = await mcp.handle({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: MCP_TOOL_NAME, arguments: { prompt: "do it", model: "default" } },
  });

  assert.equal(calls.length, 2);
  assert.equal(reply.result.isError, true);
  assert.match(reply.result.content[0].text, /model default is unavailable/);
});

test("createRoutingPrompt includes workflow guidance", () => {
  const prompt = createRoutingPrompt({
    task: "fix tests",
    workspace: "/tmp/project",
    tools: [{ name: MCP_TOOL_NAME }],
    models: [{ id: "composer-2" }],
  });

  assert.match(prompt, /Superpowers workflow/);
  assert.match(prompt, /Ponytail rules/);
  assert.match(prompt, /"workspace":"\/tmp\/project"/);
});

test("isMainEntry accepts npm bin symlinks", () => {
  const realPath = "/package/src/mcp.js";
  const binPath = "/prefix/bin/cursor2api-mcp";
  const moduleUrl = new URL(`file://${realPath}`).href;
  const realpath = (value) => (value === binPath ? realPath : value);

  assert.equal(isMainEntry(binPath, moduleUrl, realpath), true);
});

test("MCP tool calls require a configured key", async () => {
  const mcp = createMcpProtocol({ apiKey: "" });
  const reply = await mcp.handle({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: MCP_TOOL_NAME, arguments: { prompt: "hello" } },
  });

  assert.equal(reply.result.isError, true);
  assert.match(reply.result.content[0].text, /CURSOR_API_KEY/);
});

test("package exposes a local npm MCP bin", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.name, "cursor2api-mcp");
  assert.equal(pkg.private, undefined);
  assert.deepEqual(pkg.publishConfig, { access: "public" });
  assert.equal(pkg.bin["cursor2api-mcp"], "src/mcp.js");
  assert.equal(pkg.bin["cursor2api-mcp-install"], "scripts/install-mcp.mjs");
  assert.equal(pkg.bin["cursor2api-mcp-uninstall"], "scripts/uninstall-mcp.mjs");
  assert.deepEqual(pkg.files, [
    "scripts/install-mcp.cmd",
    "scripts/install-mcp.mjs",
    "scripts/install-mcp.sh",
    "scripts/uninstall-mcp.cmd",
    "scripts/uninstall-mcp.mjs",
    "scripts/uninstall-mcp.sh",
    "src/anthropic.js",
    "src/mcp.js",
    "src/openai.js",
    "src/server.js",
    "README.md",
    "README.zh-CN.md",
    "LICENSE",
    "Dockerfile",
    "docker-compose.yml",
    ".dockerignore",
    ".env.example",
  ]);
});
