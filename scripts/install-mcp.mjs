#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SERVER_NAME = "cursor2api";
const JSON_SERVER = {
  command: "cursor2api-mcp",
  args: [],
};
const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const COMMAND_SOURCES = {
  claude: [
    join(PACKAGE_ROOT, "plugin", "claude", ".claude", "commands", "cursor.md"),
    join(PACKAGE_ROOT, "plugin", "claude", ".claude", "commands", "cursorx.md"),
  ],
  opencode: [
    join(PACKAGE_ROOT, "plugin", "opencode", "command", "cursor.md"),
    join(PACKAGE_ROOT, "plugin", "opencode", "command", "cursorx.md"),
  ],
};
export const CODEX_START = "# cursor2api-mcp:start";
export const CODEX_END = "# cursor2api-mcp:end";
export const HERMES_START = CODEX_START;
export const HERMES_END = CODEX_END;

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
      commandDirs: isWindows
        ? [join(appData, "opencode", "commands")]
        : [join(home, ".config", "opencode", "commands")],
    },
    {
      id: "gemini",
      name: "Gemini CLI",
      kind: "mcp-json",
      paths: [join(home, ".gemini", "settings.json")],
    },
    {
      id: "hermes",
      name: "Hermes",
      kind: "hermes-yaml",
      paths: [join(home, ".hermes", "config.yaml")],
    },
    {
      id: "claude",
      name: "Claude Code commands",
      kind: "commands-only",
      paths: [join(home, ".claude", "commands")],
    },
  ];

  const roots = [home, appData, localAppData];
  return candidates.map((target, index) => {
    const configPath = firstPath(target.paths, exists, roots);
    return {
      ...target,
      index: index + 1,
      configPath,
      commandDir: target.commandDirs ? firstPath(target.commandDirs, exists, roots) : target.kind === "commands-only" ? configPath : undefined,
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

function regexEscape(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hermesManagedPattern() {
  return new RegExp(`^\\s*${regexEscape(HERMES_START)}\\n[\\s\\S]*?^\\s*${regexEscape(HERMES_END)}\\n?`, "m");
}

function yamlString(value) {
  return JSON.stringify(String(value));
}

function hermesYamlBlock(apiKey) {
  return [
    `  ${HERMES_START}`,
    `  ${SERVER_NAME}:`,
    '    command: "cursor2api-mcp"',
    "    args: []",
    "    env:",
    `      CURSOR_API_KEY: ${yamlString(apiKey)}`,
    `  ${HERMES_END}`,
  ].join("\n");
}

export function mergeHermesYaml(content, apiKey) {
  const base = String(content || "").replace(hermesManagedPattern(), "").trimEnd();
  const block = hermesYamlBlock(apiKey);
  if (!base) return `mcp_servers:\n${block}\n`;

  const lines = base.split(/\r?\n/);
  const inlineIndex = lines.findIndex((line) => /^mcp_servers:\s*(?:\{\}|null)\s*(?:#.*)?$/.test(line));
  if (inlineIndex >= 0) {
    lines.splice(inlineIndex, 1, "mcp_servers:", block);
    return `${lines.join("\n").trimEnd()}\n`;
  }

  const index = lines.findIndex((line) => /^mcp_servers:\s*(?:#.*)?$/.test(line));
  if (index >= 0) {
    lines.splice(index + 1, 0, block);
    return `${lines.join("\n").trimEnd()}\n`;
  }

  return `${base}\n\nmcp_servers:\n${block}\n`;
}

export function removeHermesYaml(content) {
  const base = String(content || "").replace(hermesManagedPattern(), "").trimEnd();
  return base ? `${base}\n` : "";
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

function installCommandFiles(target) {
  const sources = COMMAND_SOURCES[target.id];
  if (!sources) return false;

  mkdirSync(target.commandDir, { recursive: true });
  for (const source of sources) {
    const destination = join(target.commandDir, basename(source));
    backup(destination);
    copyFileSync(source, destination);
  }
  return true;
}

export function installTarget(target, apiKey) {
  if (target.kind === "commands-only") {
    installCommandFiles(target);
    return;
  }

  if (target.kind === "codex-toml") {
    mkdirSync(dirname(target.configPath), { recursive: true });
    const current = existsSync(target.configPath) ? readFileSync(target.configPath, "utf8") : "";
    backup(target.configPath);
    writeFileSync(target.configPath, mergeCodexToml(current, apiKey));
    return;
  }

  if (target.kind === "hermes-yaml") {
    mkdirSync(dirname(target.configPath), { recursive: true });
    const current = existsSync(target.configPath) ? readFileSync(target.configPath, "utf8") : "";
    backup(target.configPath);
    writeFileSync(target.configPath, mergeHermesYaml(current, apiKey));
    return;
  }

  const current = readJson(target.configPath);
  writeJson(
    target.configPath,
    target.kind === "opencode-json" ? mergeOpenCodeJson(current, apiKey) : mergeMcpServersJson(current, apiKey),
  );
  installCommandFiles(target);
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
  console.log("\nDetected install targets:");
  for (const target of targets) {
    const marker = target.found ? "found" : "default";
    console.log(`  ${target.index}. ${target.name} (${target.id}) [${marker}] -> ${target.configPath}`);
  }

  const input = await ask("\nInstall to which tools? Enter numbers/names separated by commas, or all: ");
  const selected = selectTargets(input, targets);
  if (!selected.length) throw new Error("No targets selected");

  for (const target of selected) {
    installTarget(target, apiKey);
    const label = target.kind === "commands-only" ? "/cursor commands" : SERVER_NAME;
    console.log(`Installed ${label} for ${target.name}: ${target.configPath}`);
    if (target.commandDir && target.kind !== "commands-only") {
      console.log(`Installed /cursor commands for ${target.name}: ${target.commandDir}`);
    }
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
