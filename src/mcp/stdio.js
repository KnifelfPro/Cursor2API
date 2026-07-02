/** MCP stdio transport: one JSON-RPC message per line on stdin/stdout. */
import { realpathSync } from "node:fs";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

import { requestTimeoutMs } from "../config.js";
import { createMcpProtocol } from "./protocol.js";

export function clientRequestTimeoutMs(method) {
  return method === "elicitation/create" ? requestTimeoutMs() : 1000;
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
      }, clientRequestTimeoutMs(method));
      pending.set(id, { resolve, reject, timer });
    });
  }

  const protocol = createMcpProtocol({
    requestClient,
    notify: (method, params) => send({ jsonrpc: "2.0", method, params }),
  });
  const lines = createInterface({ input: process.stdin });

  // MCP stdio shutdown: client closes stdin and expects the server to exit.
  lines.on("close", () => process.exit(0));

  lines.on("line", async (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }

    // Responses to server-initiated roots/list requests (no method field).
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
      send({ jsonrpc: "2.0", id: message.id ?? null, error: { code: -32603, message: "Internal error" } });
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
