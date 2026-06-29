import assert from "node:assert/strict";
import test from "node:test";

import { mergeCodexToml } from "./install-mcp.mjs";
import { removeCodexToml, removeMcpServersJson, removeOpenCodeJson } from "./uninstall-mcp.mjs";

test("removeMcpServersJson removes the managed server and preserves others", () => {
  assert.deepEqual(
    removeMcpServersJson({
      mcpServers: {
        other: { command: "x" },
        cursor2api: { command: "cursor2api-mcp", args: [], env: { CURSOR_API_KEY: "crsr_test" } },
      },
    }),
    { mcpServers: { other: { command: "x" } } },
  );
});

test("removeMcpServersJson leaves configs without the managed server unchanged", () => {
  assert.deepEqual(removeMcpServersJson({ mcpServers: { other: { command: "x" } } }), {
    mcpServers: { other: { command: "x" } },
  });
  assert.deepEqual(removeMcpServersJson({}), {});
});

test("removeOpenCodeJson removes the managed server and preserves others", () => {
  assert.deepEqual(
    removeOpenCodeJson({
      mcp: {
        other: { type: "local" },
        cursor2api: { type: "local", command: ["cursor2api-mcp"], enabled: true, environment: { CURSOR_API_KEY: "crsr_test" } },
      },
    }),
    { mcp: { other: { type: "local" } } },
  );
});

test("removeCodexToml strips the managed block and preserves other content", () => {
  const installed = mergeCodexToml('model = "gpt-5"\n', "crsr_test");
  const result = removeCodexToml(installed);

  assert.equal(result, 'model = "gpt-5"\n');
  assert.doesNotMatch(result, /CURSOR_API_KEY/);
  assert.doesNotMatch(result, /cursor2api/);
});

test("removeCodexToml returns empty string when only the managed block existed", () => {
  const installed = mergeCodexToml("", "crsr_test");
  assert.equal(removeCodexToml(installed), "");
});
