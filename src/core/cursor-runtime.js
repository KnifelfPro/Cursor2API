/**
 * Cursor SDK agent lifecycle shared by HTTP handlers and MCP tools.
 * Each request gets an ephemeral JsonlLocalAgentStore; slots and timeouts are global.
 */
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";

import { cursorHomeDir, cursorStoreDir, maxConcurrent, requestTimeoutMs, workspaceDir } from "../config.js";
import { httpError } from "../errors.js";
import { assistantDelta } from "../providers/openai.js";

let activeRequests = 0;

export async function createCursorAgent(model, apiKey, store, cwd = workspaceDir()) {
  const { Agent } = await import("@cursor/sdk");
  const homeDir = cursorHomeDir();
  if (homeDir) process.env.HOME = homeDir;
  // ponytail: local-only agent runtime; add cloud options when PR automation is needed.
  return Agent.create({
    apiKey,
    model: { id: model },
    local: {
      cwd,
      store,
    },
  });
}

async function createLocalAgentStore(storeDir) {
  const { JsonlLocalAgentStore } = await import("@cursor/sdk");
  return new JsonlLocalAgentStore(storeDir);
}

// Global cap so parallel HTTP/MCP callers cannot exhaust local Cursor agents.
function acquireRequestSlot() {
  if (activeRequests >= maxConcurrent()) throw httpError(503, "Too many concurrent requests", "server_error");
  activeRequests++;
}

function releaseRequestSlot() {
  activeRequests--;
}

/** Run a prompt to completion and return assistant text; always tears down agent + store. */
export async function runCursorText(prompt, model, apiKey, cwd = workspaceDir()) {
  acquireRequestSlot();
  // One UUID-scoped JsonlLocalAgentStore per call; removed in finally so disk does not grow.
  const storeDir = join(cursorStoreDir(), randomUUID());
  let agent;
  const timer = setTimeout(() => agent?.close(), requestTimeoutMs());
  try {
    agent = await createCursorAgent(model, apiKey, await createLocalAgentStore(storeDir), cwd);
    const run = await agent.send(prompt);
    const result = await run.wait();
    if (result.status !== "finished") throw httpError(502, `Cursor run ended with status ${result.status}`, "server_error");
    return result.result || "";
  } finally {
    clearTimeout(timer);
    agent?.close();
    releaseRequestSlot();
    rmSync(storeDir, { recursive: true, force: true });
  }
}

/** Stream assistant deltas via onDelta; emits only new text since the last event. */
export async function streamCursorText(prompt, model, apiKey, onDelta, cwd = workspaceDir()) {
  acquireRequestSlot();
  const storeDir = join(cursorStoreDir(), randomUUID());
  let agent;
  const timer = setTimeout(() => agent?.close(), requestTimeoutMs());
  try {
    agent = await createCursorAgent(model, apiKey, await createLocalAgentStore(storeDir), cwd);
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
    releaseRequestSlot();
    rmSync(storeDir, { recursive: true, force: true });
  }
}
