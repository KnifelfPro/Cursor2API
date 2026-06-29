import { realpathSync } from "node:fs";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

import { createMcpProtocol } from "./protocol.js";

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
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
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
