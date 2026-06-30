import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { discoverTargets, installTarget, mergeHermesYaml } from "../scripts/install-mcp.mjs";
import { removeHermesYaml } from "../scripts/uninstall-mcp.mjs";

test("installer discovers Hermes config target", () => {
  const home = "/tmp/home";
  const existing = new Set([join(home, ".hermes")]);
  const targets = discoverTargets({
    home,
    appData: join(home, "AppData", "Roaming"),
    localAppData: join(home, "AppData", "Local"),
    platform: "darwin",
    existsSync: (path) => existing.has(path),
  });
  const hermes = targets.find((target) => target.id === "hermes");

  assert.equal(hermes.name, "Hermes");
  assert.equal(hermes.kind, "hermes-yaml");
  assert.equal(hermes.configPath, join(home, ".hermes", "config.yaml"));
  assert.equal(hermes.found, true);
});

test("installer discovers Claude command target without renumbering existing targets", () => {
  const home = "/tmp/home";
  const existing = new Set([join(home, ".claude")]);
  const targets = discoverTargets({
    home,
    appData: join(home, "AppData", "Roaming"),
    localAppData: join(home, "AppData", "Local"),
    platform: "darwin",
    existsSync: (path) => existing.has(path),
  });
  const claude = targets.find((target) => target.id === "claude");

  assert.equal(targets[0].id, "codex");
  assert.equal(claude.kind, "commands-only");
  assert.equal(claude.commandDir, join(home, ".claude", "commands"));
  assert.equal(claude.found, true);
});

test("installer writes OpenCode MCP config and slash command files", () => {
  const home = mkdtempSync(join(tmpdir(), "cursor2api-install-"));
  try {
    const target = discoverTargets({
      home,
      appData: join(home, "AppData", "Roaming"),
      localAppData: join(home, "AppData", "Local"),
      platform: "darwin",
      existsSync,
    }).find((item) => item.id === "opencode");

    installTarget(target, "crsr_test");

    assert.match(readFileSync(target.configPath, "utf8"), /cursor2api-mcp/);
    assert.match(readFileSync(join(target.commandDir, "cursor.md"), "utf8"), /cursor_agent/);
    assert.match(readFileSync(join(target.commandDir, "cursorx.md"), "utf8"), /cursor_agent_direct/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("installer merges cursor2api into Hermes mcp_servers", () => {
  const merged = mergeHermesYaml('model:\n  default: "x"\n', "crsr_test");

  assert.match(merged, /^mcp_servers:\n  # cursor2api-mcp:start\n  cursor2api:/m);
  assert.match(merged, /command: "cursor2api-mcp"/);
  assert.match(merged, /CURSOR_API_KEY: "crsr_test"/);
});

test("Hermes merge replaces the managed block and preserves other servers", () => {
  const current = [
    "mcp_servers:",
    "  other:",
    '    command: "uvx"',
    "",
  ].join("\n");

  const merged = mergeHermesYaml(current, "old");
  const updated = mergeHermesYaml(merged, "new");

  assert.equal((updated.match(/cursor2api-mcp:start/g) || []).length, 1);
  assert.match(updated, /CURSOR_API_KEY: "new"/);
  assert.doesNotMatch(updated, /CURSOR_API_KEY: "old"/);
  assert.match(updated, /  other:\n    command: "uvx"/);
});

test("uninstaller removes the managed Hermes block", () => {
  const merged = mergeHermesYaml("mcp_servers:\n", "crsr_test");
  const removed = removeHermesYaml(merged);

  assert.doesNotMatch(removed, /cursor2api/);
  assert.match(removed, /^mcp_servers:\n$/);
});
