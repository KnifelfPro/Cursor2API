import assert from "node:assert/strict";
import test from "node:test";

import {
  discoverTargets,
  mergeCodexToml,
  mergeMcpServersJson,
  mergeOpenCodeJson,
  isMainEntry,
  selectTargets,
} from "./install-mcp.mjs";

test("selectTargets accepts all, numbers, and names", () => {
  const targets = [
    { id: "codex", name: "Codex" },
    { id: "cursor", name: "Cursor" },
    { id: "gemini", name: "Gemini" },
  ];

  assert.deepEqual(selectTargets("all", targets).map((target) => target.id), ["codex", "cursor", "gemini"]);
  assert.deepEqual(selectTargets("1,3", targets).map((target) => target.id), ["codex", "gemini"]);
  assert.deepEqual(selectTargets("cursor gemini", targets).map((target) => target.id), ["cursor", "gemini"]);
});

test("mergeMcpServersJson preserves existing servers", () => {
  assert.deepEqual(mergeMcpServersJson({ mcpServers: { other: { command: "x" } } }, "crsr_test"), {
    mcpServers: {
      other: { command: "x" },
      cursor2api: {
        command: "cursor2api-mcp",
        args: [],
        env: { CURSOR_API_KEY: "crsr_test" },
      },
    },
  });
});

test("mergeOpenCodeJson writes local mcp shape", () => {
  assert.deepEqual(mergeOpenCodeJson({ mcp: { other: { type: "local" } } }, "crsr_test"), {
    mcp: {
      other: { type: "local" },
      cursor2api: {
        type: "local",
        command: ["cursor2api-mcp"],
        enabled: true,
        environment: { CURSOR_API_KEY: "crsr_test" },
      },
    },
  });
});

test("mergeCodexToml replaces the managed block", () => {
  const first = mergeCodexToml('model = "gpt-5"\n', "one");
  const second = mergeCodexToml(first, "two");

  assert.match(second, /model = "gpt-5"/);
  assert.match(second, /CURSOR_API_KEY = "two"/);
  assert.doesNotMatch(second, /CURSOR_API_KEY = "one"/);
});

test("discoverTargets returns selectable tools", () => {
  const targets = discoverTargets({
    home: "/home/me",
    appData: "/appdata",
    platform: "linux",
    existsSync: (path) => path === "/home/me/.cursor",
  });

  assert.deepEqual(targets.map((target) => target.id), ["codex", "cursor", "clash", "opencode", "gemini"]);
  assert.equal(targets.find((target) => target.id === "cursor").found, true);
  assert.equal(targets.find((target) => target.id === "opencode").found, false);
});

test("installer main entry accepts npm bin symlinks", () => {
  const realPath = "/package/scripts/install-mcp.mjs";
  const binPath = "/prefix/bin/cursor2api-mcp-install";
  const moduleUrl = new URL(`file://${realPath}`).href;
  const realpath = (value) => (value === binPath ? realPath : value);

  assert.equal(isMainEntry(binPath, moduleUrl, realpath), true);
});
