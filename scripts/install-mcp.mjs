#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";

export const SERVER_NAME = "cursor2api";
const JSON_SERVER = {
  command: "cursor2api-mcp",
  args: [],
};
export const CODEX_START = "# cursor2api-mcp:start";
export const CODEX_END = "# cursor2api-mcp:end";

function homePath(...parts) {
  return join(process.env.HOME || process.env.USERPROFILE || ".", ...parts);
}

function appDataPath(...parts) {
  return join(process.env.APPDATA || homePath("AppData", "Roaming"), ...parts);
}

function localAppDataPath(...parts) {
  return join(process.env.LOCALAPPDATA || homePath("AppData", "Local"), ...parts);
}

function firstPath(paths, exists = existsSync, roots = []) {
  return paths.find((path) => exists(path) || (exists(dirname(path)) && !roots.includes(dirname(path)))) || paths[0];
}

export function discoverTargets({
  home = process.env.HOME || process.env.USERPROFILE || ".",
  appData = process.env.APPDATA || join(home, "AppData", "Roaming"),
  localAppData = process.env.LOCALAPPDATA || join(home, "AppData", "Local"),
  platform = process.platform,
  existsSync: exists = existsSync,
} = {}) {
  const isWindows = platform === "win32";
  const candidates = [
    {
      id: "codex",
      name: "Codex",
      kind: "codex-toml",
      paths: [join(home, ".codex", "config.toml")],
    },
    {
      id: "cursor",
      name: "Cursor",
      kind: "mcp-json",
      paths: isWindows
        ? [join(appData, "Cursor", "User", "mcp.json"), join(home, ".cursor", "mcp.json")]
        : [join(home, ".cursor", "mcp.json"), join(home, "Library", "Application Support", "Cursor", "User", "mcp.json")],
    },
    {
      id: "clash",
      name: "Clash",
      kind: "mcp-json",
      paths: isWindows
        ? [join(appData, "clash", "mcp.json"), join(appData, "Clash Verge", "mcp.json")]
        : [join(home, ".config", "clash", "mcp.json"), join(home, ".config", "clash-verge", "mcp.json")],
    },
    {
      id: "opencode",
      name: "OpenCode",
      kind: "opencode-json",
      paths: isWindows
        ? [join(appData, "opencode", "opencode.json"), join(home, ".opencode.json")]
        : [join(home, ".config", "opencode", "opencode.json"), join(home, ".opencode.json")],
    },
    {
      id: "gemini",
      name: "Gemini CLI",
      kind: "mcp-json",
      paths: [join(home, ".gemini", "settings.json")],
    },
  ];

  const roots = [home, appData, localAppData];
  return candidates.map((target, index) => {
    const configPath = firstPath(target.paths, exists, roots);
    return {
      ...target,
      index: index + 1,
      configPath,
      found: target.paths.some((path) => exists(path) || (exists(dirname(path)) && !roots.includes(dirname(path)))),
    };
  });
}

export function selectTargets(input, targets) {
  const value = String(input || "").trim().toLowerCase();
  if (!value) return [];
  if (value === "all" || value === "*") return targets;

  const parts = value.split(/[\s,]+/).filter(Boolean);
  const selected = [];
  for (const part of parts) {
    const target = /^\d+$/.test(part)
      ? targets[Number(part) - 1]
      : targets.find((item) => item.id === part || item.name.toLowerCase() === part);
    if (target && !selected.includes(target)) selected.push(target);
  }
  return selected;
}

export function mergeMcpServersJson(config, apiKey) {
  return {
    ...config,
    mcpServers: {
      ...(config?.mcpServers || {}),
      [SERVER_NAME]: {
        ...JSON_SERVER,
        env: { CURSOR_API_KEY: apiKey },
      },
    },
  };
}

export function mergeOpenCodeJson(config, apiKey) {
  return {
    ...config,
    mcp: {
      ...(config?.mcp || {}),
      [SERVER_NAME]: {
        type: "local",
        command: ["cursor2api-mcp"],
        enabled: true,
        environment: { CURSOR_API_KEY: apiKey },
      },
    },
  };
}

function tomlString(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function mergeCodexToml(content, apiKey) {
  const block = [
    CODEX_START,
    `[mcp_servers.${SERVER_NAME}]`,
    'command = "cursor2api-mcp"',
    "",
    `[mcp_servers.${SERVER_NAME}.env]`,
    `CURSOR_API_KEY = ${tomlString(apiKey)}`,
    CODEX_END,
    "",
  ].join("\n");
  const pattern = new RegExp(`${CODEX_START}[\\s\\S]*?${CODEX_END}\\n?`, "m");
  const base = String(content || "").replace(pattern, "").trimEnd();
  return `${base}${base ? "\n\n" : ""}${block}`;
}

function readJson(path) {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8") || "{}");
}

function backup(path) {
  if (existsSync(path)) {
    writeFileSync(`${path}.bak`, readFileSync(path));
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  backup(path);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function installTarget(target, apiKey) {
  if (target.kind === "codex-toml") {
    mkdirSync(dirname(target.configPath), { recursive: true });
    const current = existsSync(target.configPath) ? readFileSync(target.configPath, "utf8") : "";
    backup(target.configPath);
    writeFileSync(target.configPath, mergeCodexToml(current, apiKey));
    return;
  }

  const current = readJson(target.configPath);
  writeJson(
    target.configPath,
    target.kind === "opencode-json" ? mergeOpenCodeJson(current, apiKey) : mergeMcpServersJson(current, apiKey),
  );
}

async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

export async function main() {
  const apiKey = (process.env.CURSOR_API_KEY || (await ask("Cursor API key: "))).trim();
  if (!apiKey) throw new Error("Cursor API key is required");

  const targets = discoverTargets();
  console.log("\nDetected MCP targets:");
  for (const target of targets) {
    const marker = target.found ? "found" : "default";
    console.log(`  ${target.index}. ${target.name} (${target.id}) [${marker}] -> ${target.configPath}`);
  }

  const input = await ask("\nInstall to which tools? Enter numbers/names separated by commas, or all: ");
  const selected = selectTargets(input, targets);
  if (!selected.length) throw new Error("No targets selected");

  for (const target of selected) {
    installTarget(target, apiKey);
    console.log(`Installed ${SERVER_NAME} for ${target.name}: ${target.configPath}`);
  }
}

export function isMainEntry(argvPath, moduleUrl, realpath = realpathSync) {
  if (!argvPath) return false;

  try {
    return moduleUrl === pathToFileURL(realpath(argvPath)).href;
  } catch {
    return moduleUrl === pathToFileURL(argvPath).href;
  }
}

if (isMainEntry(process.argv[1], import.meta.url)) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
