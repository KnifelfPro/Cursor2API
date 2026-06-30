#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";

import {
  CODEX_END,
  CODEX_START,
  discoverTargets,
  isMainEntry,
  removeHermesYaml as removeHermesYamlBlock,
  selectTargets,
  SERVER_NAME,
} from "./install-mcp.mjs";

export function removeMcpServersJson(config) {
  if (!config?.mcpServers || !(SERVER_NAME in config.mcpServers)) return config;
  const { [SERVER_NAME]: _removed, ...rest } = config.mcpServers;
  return { ...config, mcpServers: rest };
}

export function removeOpenCodeJson(config) {
  if (!config?.mcp || !(SERVER_NAME in config.mcp)) return config;
  const { [SERVER_NAME]: _removed, ...rest } = config.mcp;
  return { ...config, mcp: rest };
}

export function removeCodexToml(content) {
  const pattern = new RegExp(`${CODEX_START}[\\s\\S]*?${CODEX_END}\\n?`, "m");
  const base = String(content || "").replace(pattern, "").trimEnd();
  return base ? `${base}\n` : "";
}

export function removeHermesYaml(content) {
  return removeHermesYamlBlock(content);
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

function hasJsonServer(config, kind) {
  const bag = kind === "opencode-json" ? config?.mcp : config?.mcpServers;
  return Boolean(bag && SERVER_NAME in bag);
}

function uninstallTarget(target) {
  if (!existsSync(target.configPath)) return false;

  if (target.kind === "codex-toml") {
    const current = readFileSync(target.configPath, "utf8");
    const next = removeCodexToml(current);
    if (next === current) return false;
    backup(target.configPath);
    writeFileSync(target.configPath, next);
    return true;
  }

  if (target.kind === "hermes-yaml") {
    const current = readFileSync(target.configPath, "utf8");
    const next = removeHermesYaml(current);
    if (next === current) return false;
    backup(target.configPath);
    writeFileSync(target.configPath, next);
    return true;
  }

  const current = readJson(target.configPath);
  if (!hasJsonServer(current, target.kind)) return false;
  const next = target.kind === "opencode-json" ? removeOpenCodeJson(current) : removeMcpServersJson(current);
  backup(target.configPath);
  writeFileSync(target.configPath, `${JSON.stringify(next, null, 2)}\n`);
  return true;
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
  const targets = discoverTargets();
  console.log("\nDetected MCP targets:");
  for (const target of targets) {
    const marker = target.found ? "found" : "default";
    console.log(`  ${target.index}. ${target.name} (${target.id}) [${marker}] -> ${target.configPath}`);
  }

  const input = await ask("\nRemove cursor2api from which tools? Enter numbers/names separated by commas, or all: ");
  const selected = selectTargets(input, targets);
  if (!selected.length) throw new Error("No targets selected");

  for (const target of selected) {
    const removed = uninstallTarget(target);
    console.log(`${removed ? "Removed" : "Not configured"} ${SERVER_NAME} for ${target.name}: ${target.configPath}`);
  }
}

if (isMainEntry(process.argv[1], import.meta.url)) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
