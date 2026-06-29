import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

import { workspaceDir } from "../config.js";
import { addBaseHeaders, sendJson } from "../http/responses.js";
import { openAiError } from "../providers/openai.js";

export function listWorkspaceFiles(dir = workspaceDir(), base = workspaceDir()) {
  const files = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) files.push(...listWorkspaceFiles(full, base));
      else files.push(relative(base, full));
    }
  } catch {}
  return files;
}

function isInsideWorkspace(root, target) {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function handleWorkspaceList({ res }) {
  sendJson(res, 200, { workspace: workspaceDir(), files: listWorkspaceFiles() });
}

export function handleWorkspaceFile({ res, pathname }) {
  const root = workspaceDir();
  const rel = decodeURIComponent(pathname.slice("/workspace/".length));
  const target = resolve(root, rel);
  if (!isInsideWorkspace(root, target)) {
    sendJson(res, 403, openAiError("Forbidden", "invalid_request_error"));
    return;
  }
  if (!existsSync(target) || !statSync(target).isFile()) {
    sendJson(res, 404, openAiError("File not found", "invalid_request_error", "not_found"));
    return;
  }
  addBaseHeaders(res);
  res.writeHead(200, { "content-type": "application/octet-stream" });
  createReadStream(target).pipe(res);
}
