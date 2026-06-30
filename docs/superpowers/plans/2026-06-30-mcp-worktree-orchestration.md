# MCP Worktree Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-internal MCP orchestration so `cursor_agent` can decompose complex tasks into 1-10 Cursor subagents, run them in local git worktrees, merge results, and verify locally before returning one MCP result to the client.

**Architecture:** Extend the existing `cursor_agent` router with `mode: "orchestrate"` while preserving `self`, `delegate`, `parallel`, and `cursor_agent_direct`. Put orchestration logic under `src/mcp/orchestration/`, split pure decision validation, scheduler, prompts, git/worktree helpers, and the high-level runner. The MCP client never executes subagents; it only calls the MCP tool, optionally shows the existing permission prompt/progress notifications, and displays the final tool result.

**Tech Stack:** Node.js ESM, built-in `node:test`, built-in `node:assert/strict`, built-in `child_process`, local git CLI, existing Cursor SDK runtime injection through `runWithFallback`.

---

## File Structure

- Modify: `.gitignore` to ignore `.cursor2api-worktrees/` in this repository.
- Modify: `package.json` to publish new orchestration files.
- Modify: `src/mcp/routing.js` to advertise and normalize `mode: "orchestrate"`.
- Modify: `src/mcp/protocol.js` to call the orchestration runner only for `cursor_agent` orchestrate decisions.
- Create: `src/mcp/orchestration/decision.js` for schema normalization, model validation, dependency validation, and default verification command handling.
- Create: `src/mcp/orchestration/scheduler.js` for dependency-level batching and same-worktree serialization.
- Create: `src/mcp/orchestration/planner.js` for subagent and final synthesis prompts.
- Create: `src/mcp/orchestration/worktrees.js` for local git command wrappers, safe run paths, worktree creation, commits, merges, cleanup, and verification commands.
- Create: `src/mcp/orchestration/runner.js` for the end-to-end server-internal orchestration flow.
- Modify: `test/mcp.test.mjs` for routing and protocol integration coverage.
- Create: `test/mcp-orchestration.test.mjs` for pure orchestration modules and runner tests with fake git/fake Cursor runs.

---

### Task 1: RED Tests For Server-Internal Orchestrate Routing

**Files:**
- Modify: `test/mcp.test.mjs`

- [ ] **Step 1: Add routing tests for orchestrate mode**

Append these tests after the existing routing prompt test in `test/mcp.test.mjs`:

```js
test("routing prompt offers server-internal orchestration without client-side subagents", () => {
  const prompt = createRoutingPrompt({
    task: "implement a complex local feature",
    workspace: "/tmp/work",
    tools: [MCP_TOOL, MCP_DIRECT_TOOL],
    models: [{ id: "default" }, { id: "composer-2" }],
  });

  assert.match(prompt, /orchestrate/i);
  assert.match(prompt, /1 to 10 subagents/i);
  assert.match(prompt, /inside the MCP server/i);
  assert.match(prompt, /client only invokes/i);
  assert.match(prompt, /worktree/i);
});

test("routing decision accepts orchestrate plans and falls back unknown models", () => {
  const decision = routingDecision(
    JSON.stringify({
      mode: "orchestrate",
      orchestration: {
        summary: "complex local implementation",
        agents: [
          {
            id: "agent-1",
            model: "missing-model",
            task: "change one module",
            phase: "implement",
            dependsOn: [],
            worktree: "chain-a",
          },
        ],
        mergeOrder: ["chain-a"],
        verify: [],
      },
    }),
    "default",
    "original task",
    [{ id: "default" }, { id: "composer-2" }],
  );

  assert.equal(decision.mode, "orchestrate");
  assert.equal(decision.orchestration.agents.length, 1);
  assert.equal(decision.orchestration.agents[0].model, "default");
  assert.equal(decision.orchestration.agents[0].task, "change one module");
  assert.deepEqual(decision.orchestration.verify, ["npm test"]);
});
```

- [ ] **Step 2: Run the RED test**

Run: `node --test test/mcp.test.mjs`

Expected: FAIL. The first test fails because the routing prompt does not mention `orchestrate`, server-internal subagents, or worktrees. The second test fails because `routingDecision()` falls back to `self`.

- [ ] **Step 3: Commit the RED tests**

```bash
git add test/mcp.test.mjs
git commit -m "test: cover mcp orchestrate routing"
```

---

### Task 2: Orchestration Decision Normalization

**Files:**
- Create: `src/mcp/orchestration/decision.js`
- Modify: `src/mcp/routing.js`
- Create: `test/mcp-orchestration.test.mjs`
- Test: `test/mcp.test.mjs`

- [ ] **Step 1: Write decision module tests**

Create `test/mcp-orchestration.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_ORCHESTRATION_AGENTS,
  normalizeOrchestration,
  ORCHESTRATION_DEFAULT_VERIFY,
} from "../src/mcp/orchestration/decision.js";

test("normalizeOrchestration clamps agents to ten and defaults verification", () => {
  const rawAgents = Array.from({ length: 12 }, (_, index) => ({
    id: `agent-${index + 1}`,
    model: index === 0 ? "composer-2" : "missing",
    task: `task ${index + 1}`,
    phase: "implement",
    dependsOn: [],
    worktree: `chain-${index + 1}`,
  }));

  const orchestration = normalizeOrchestration(
    { summary: "many agents", agents: rawAgents, verify: [] },
    {
      defaultModel: "default",
      task: "original",
      models: [{ id: "default" }, { id: "composer-2" }],
    },
  );

  assert.equal(MAX_ORCHESTRATION_AGENTS, 10);
  assert.equal(orchestration.agents.length, 10);
  assert.equal(orchestration.agents[0].model, "composer-2");
  assert.equal(orchestration.agents[1].model, "default");
  assert.deepEqual(orchestration.verify, ORCHESTRATION_DEFAULT_VERIFY);
});

test("normalizeOrchestration keeps dependent agents in the same worktree when unspecified", () => {
  const orchestration = normalizeOrchestration(
    {
      summary: "dependent chain",
      agents: [
        { id: "base", model: "default", task: "base change", dependsOn: [], worktree: "shared" },
        { id: "followup", model: "default", task: "follow-up change", dependsOn: ["base"] },
      ],
      verify: ["npm test"],
    },
    { defaultModel: "default", task: "original", models: [{ id: "default" }] },
  );

  assert.equal(orchestration.agents[0].worktree, "shared");
  assert.equal(orchestration.agents[1].worktree, "shared");
  assert.deepEqual(orchestration.mergeOrder, ["shared"]);
});

test("normalizeOrchestration rejects unknown dependencies", () => {
  assert.throws(
    () =>
      normalizeOrchestration(
        {
          summary: "bad dependency",
          agents: [{ id: "agent-1", model: "default", task: "work", dependsOn: ["missing"] }],
        },
        { defaultModel: "default", task: "original", models: [{ id: "default" }] },
      ),
    /unknown dependency/i,
  );
});

test("normalizeOrchestration rejects cyclic dependencies", () => {
  assert.throws(
    () =>
      normalizeOrchestration(
        {
          summary: "cycle",
          agents: [
            { id: "a", model: "default", task: "a", dependsOn: ["b"] },
            { id: "b", model: "default", task: "b", dependsOn: ["a"] },
          ],
        },
        { defaultModel: "default", task: "original", models: [{ id: "default" }] },
      ),
    /cycle/i,
  );
});
```

- [ ] **Step 2: Run the RED test**

Run: `node --test test/mcp-orchestration.test.mjs`

Expected: FAIL with module-not-found for `src/mcp/orchestration/decision.js`.

- [ ] **Step 3: Implement decision normalization**

Create `src/mcp/orchestration/decision.js`:

```js
/** Normalize and validate server-internal MCP orchestration plans. */

export const MAX_ORCHESTRATION_AGENTS = 10;
export const ORCHESTRATION_DEFAULT_VERIFY = ["npm test"];

function modelId(model) {
  return typeof model === "string" ? model : model?.id;
}

function knownModel(model, modelIds, fallback) {
  return modelIds.has(model) ? model : fallback;
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function safeId(value, fallback) {
  const raw = stringValue(value);
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return cleaned || fallback;
}

function uniqueId(base, used) {
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix++;
  }
  used.add(candidate);
  return candidate;
}

function normalizeDependsOn(value) {
  if (!Array.isArray(value)) return [];
  return value.map(stringValue).filter(Boolean);
}

function normalizeVerify(value) {
  if (!Array.isArray(value)) return ORCHESTRATION_DEFAULT_VERIFY;
  const commands = value.map(stringValue).filter(Boolean);
  return commands.length ? commands : ORCHESTRATION_DEFAULT_VERIFY;
}

function assertAcyclic(agents) {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const visiting = new Set();
  const visited = new Set();

  function visit(agent) {
    if (visited.has(agent.id)) return;
    if (visiting.has(agent.id)) throw new Error(`Orchestration dependency cycle at ${agent.id}`);
    visiting.add(agent.id);
    for (const dependency of agent.dependsOn) visit(byId.get(dependency));
    visiting.delete(agent.id);
    visited.add(agent.id);
  }

  for (const agent of agents) visit(agent);
}

export function normalizeOrchestration(input, { defaultModel, task, models } = {}) {
  const raw = input?.orchestration && typeof input.orchestration === "object" ? input.orchestration : input;
  const rawAgents = Array.isArray(raw?.agents) ? raw.agents : [];
  if (!rawAgents.length) throw new Error("Orchestration requires at least one agent");

  const modelIds = new Set((models || []).map(modelId).filter(Boolean));
  const fallbackModel = knownModel(defaultModel, modelIds, defaultModel);
  const usedAgentIds = new Set();
  const agents = rawAgents.slice(0, MAX_ORCHESTRATION_AGENTS).map((agent, index) => {
    const id = uniqueId(safeId(agent?.id, `agent-${index + 1}`), usedAgentIds);
    return {
      id,
      model: knownModel(agent?.model, modelIds, fallbackModel),
      task: stringValue(agent?.task) || task || "",
      phase: safeId(agent?.phase, "implement"),
      dependsOn: normalizeDependsOn(agent?.dependsOn),
      worktree: safeId(agent?.worktree, ""),
    };
  });

  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  for (const agent of agents) {
    for (const dependency of agent.dependsOn) {
      if (!byId.has(dependency)) throw new Error(`Orchestration agent ${agent.id} has unknown dependency ${dependency}`);
    }
  }

  for (const agent of agents) {
    if (agent.worktree) continue;
    const firstDependency = agent.dependsOn.map((id) => byId.get(id)).find(Boolean);
    agent.worktree = firstDependency?.worktree || `chain-${agent.id}`;
  }

  assertAcyclic(agents);

  const worktrees = [...new Set(agents.map((agent) => agent.worktree))];
  const requestedMergeOrder = Array.isArray(raw?.mergeOrder) ? raw.mergeOrder.map((item) => safeId(item, "")).filter(Boolean) : [];
  const mergeOrder = [...new Set([...requestedMergeOrder.filter((id) => worktrees.includes(id)), ...worktrees])];

  return {
    summary: stringValue(raw?.summary) || "MCP server-internal worktree orchestration",
    agents,
    mergeOrder,
    verify: normalizeVerify(raw?.verify),
  };
}
```

- [ ] **Step 4: Wire routing to the decision normalizer**

Modify `src/mcp/routing.js`:

```js
import { normalizeOrchestration } from "./orchestration/decision.js";
```

Update the routing prompt strings in `createRoutingPrompt()`:

```js
"Choose whether to handle the task yourself, delegate to one listed model, fan out to multiple listed models, or orchestrate a complex local implementation inside this MCP server.",
"Use orchestrate only for complex tasks that need 1 to 10 subagents, git worktrees, dependency ordering, local merges, and final local verification.",
"The MCP client only invokes this tool and displays the final result; it does not run subagents, create worktrees, merge branches, or run tests.",
'Schema: {"mode":"self|delegate|parallel|orchestrate","model":"model-id","task":"worker task","agents":[{"model":"model-id","task":"worker task"}],"orchestration":{"summary":"reason","agents":[{"id":"agent-1","model":"model-id","task":"worker task","phase":"implement","dependsOn":[],"worktree":"chain-a"}],"mergeOrder":["chain-a"],"verify":["npm test"]}}',
```

Add this branch before the final self fallback return in `routingDecision()`:

```js
  if (parsed?.mode === "orchestrate") {
    return {
      mode: "orchestrate",
      orchestration: normalizeOrchestration(parsed.orchestration || parsed, { defaultModel, task, models }),
    };
  }
```

- [ ] **Step 5: Run routing and decision tests**

Run:

```bash
node --test test/mcp-orchestration.test.mjs
node --test test/mcp.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit the decision implementation**

```bash
git add src/mcp/routing.js src/mcp/orchestration/decision.js test/mcp-orchestration.test.mjs test/mcp.test.mjs
git commit -m "feat: normalize mcp orchestration decisions"
```

---

### Task 3: Dependency Scheduler

**Files:**
- Create: `src/mcp/orchestration/scheduler.js`
- Modify: `test/mcp-orchestration.test.mjs`

- [ ] **Step 1: Add scheduler tests**

Add this import to `test/mcp-orchestration.test.mjs`:

```js
import { scheduleAgents } from "../src/mcp/orchestration/scheduler.js";
```

Append these tests:

```js
test("scheduleAgents runs independent worktrees in the same level", () => {
  const agents = [
    { id: "a", dependsOn: [], worktree: "chain-a" },
    { id: "b", dependsOn: [], worktree: "chain-b" },
  ];

  assert.deepEqual(
    scheduleAgents(agents).map((level) => level.map((agent) => agent.id)),
    [["a", "b"]],
  );
});

test("scheduleAgents serializes agents that share one worktree", () => {
  const agents = [
    { id: "a", dependsOn: [], worktree: "shared" },
    { id: "b", dependsOn: ["a"], worktree: "shared" },
  ];

  assert.deepEqual(
    scheduleAgents(agents).map((level) => level.map((agent) => agent.id)),
    [["a"], ["b"]],
  );
});

test("scheduleAgents rejects dependency deadlocks", () => {
  assert.throws(
    () =>
      scheduleAgents([
        { id: "a", dependsOn: ["b"], worktree: "one" },
        { id: "b", dependsOn: ["a"], worktree: "two" },
      ]),
    /deadlock|cycle/i,
  );
});
```

- [ ] **Step 2: Run the RED test**

Run: `node --test test/mcp-orchestration.test.mjs`

Expected: FAIL with module-not-found for `src/mcp/orchestration/scheduler.js`.

- [ ] **Step 3: Implement scheduler**

Create `src/mcp/orchestration/scheduler.js`:

```js
/** Dependency-level scheduler for server-internal MCP subagents. */

export function scheduleAgents(agents) {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const remaining = new Set(agents.map((agent) => agent.id));
  const completed = new Set();
  const levels = [];

  while (remaining.size) {
    const level = [];
    const usedWorktrees = new Set();

    for (const id of remaining) {
      const agent = byId.get(id);
      const ready = agent.dependsOn.every((dependency) => completed.has(dependency));
      if (!ready || usedWorktrees.has(agent.worktree)) continue;
      level.push(agent);
      usedWorktrees.add(agent.worktree);
    }

    if (!level.length) throw new Error("Orchestration scheduler deadlock or dependency cycle");

    for (const agent of level) {
      remaining.delete(agent.id);
      completed.add(agent.id);
    }
    levels.push(level);
  }

  return levels;
}
```

- [ ] **Step 4: Run orchestration tests**

Run: `node --test test/mcp-orchestration.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit scheduler**

```bash
git add src/mcp/orchestration/scheduler.js test/mcp-orchestration.test.mjs
git commit -m "feat: schedule mcp orchestration agents"
```

---

### Task 4: Planner And Prompt Builders

**Files:**
- Create: `src/mcp/orchestration/planner.js`
- Modify: `test/mcp-orchestration.test.mjs`

- [ ] **Step 1: Add planner tests**

Add this import to `test/mcp-orchestration.test.mjs`:

```js
import { finalSynthesisPrompt, subagentPrompt } from "../src/mcp/orchestration/planner.js";
```

Append these tests:

```js
test("subagentPrompt keeps execution inside the assigned worktree and server", () => {
  const prompt = subagentPrompt({
    task: "original task",
    agent: {
      id: "agent-1",
      model: "default",
      task: "edit the module",
      phase: "implement",
      dependsOn: ["agent-0"],
      worktree: "chain-a",
    },
    workspace: "/tmp/work/.cursor2api-worktrees/run/chain-a",
    completedDependencies: ["agent-0"],
  });

  assert.match(prompt, /Workspace: \/tmp\/work\/\.cursor2api-worktrees\/run\/chain-a/);
  assert.match(prompt, /Work only in this workspace/);
  assert.match(prompt, /Do not create remote branches, push, or open PRs/);
  assert.match(prompt, /MCP coordinator will commit and merge/);
  assert.match(prompt, /edit the module/);
});

test("finalSynthesisPrompt summarizes server-side orchestration results for display", () => {
  const prompt = finalSynthesisPrompt({
    task: "original task",
    orchestration: { summary: "summary", verify: ["npm test"] },
    agentResults: [{ id: "agent-1", result: "changed files" }],
    mergeResults: [{ worktree: "chain-a", branch: "cursor2api/run/chain-a" }],
    verificationResults: [{ command: "npm test", output: "pass" }],
  });

  assert.match(prompt, /Synthesize the final MCP tool result/);
  assert.match(prompt, /client only displays this final answer/);
  assert.match(prompt, /changed files/);
  assert.match(prompt, /npm test/);
});
```

- [ ] **Step 2: Run the RED test**

Run: `node --test test/mcp-orchestration.test.mjs`

Expected: FAIL with module-not-found for `src/mcp/orchestration/planner.js`.

- [ ] **Step 3: Implement planner prompts**

Create `src/mcp/orchestration/planner.js`:

```js
/** Prompt builders for server-internal MCP orchestration agents and final synthesis. */

export function subagentPrompt({ task, agent, workspace, completedDependencies = [] }) {
  return [
    "You are a Cursor subagent executing one assigned local task inside the MCP server.",
    "",
    `Workspace: ${workspace}`,
    `Original task: ${task}`,
    `Agent id: ${agent.id}`,
    `Phase: ${agent.phase}`,
    `Assigned model: ${agent.model}`,
    `Dependencies already completed: ${completedDependencies.join(", ") || "none"}`,
    "",
    "Rules:",
    "- Work only in this workspace.",
    "- Do not create remote branches, push, or open PRs.",
    "- Do not ask the MCP client to perform any computation or task execution.",
    "- Inspect local context before changing behavior.",
    "- Write or update tests first for behavior changes.",
    "- Implement narrowly and run the relevant local verification for this task.",
    "- Commit-ready changes are expected. The MCP coordinator will commit and merge.",
    "- Return a concise status with files changed, tests run, and blockers.",
    "",
    "Task:",
    agent.task,
  ].join("\n");
}

export function finalSynthesisPrompt({ task, orchestration, agentResults, mergeResults, verificationResults }) {
  return [
    "Synthesize the final MCP tool result for the original task.",
    "The MCP client only displays this final answer and did not execute subagents.",
    "",
    `Original task: ${task}`,
    `Orchestration summary: ${orchestration.summary}`,
    `Verification commands: ${JSON.stringify(orchestration.verify)}`,
    `Agent results: ${JSON.stringify(agentResults)}`,
    `Merge results: ${JSON.stringify(mergeResults)}`,
    `Verification results: ${JSON.stringify(verificationResults)}`,
    "",
    "Return a concise final answer that states what changed, what verification ran, and any remaining risk.",
  ].join("\n");
}
```

- [ ] **Step 4: Run orchestration tests**

Run: `node --test test/mcp-orchestration.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit planner**

```bash
git add src/mcp/orchestration/planner.js test/mcp-orchestration.test.mjs
git commit -m "feat: add mcp orchestration prompts"
```

---

### Task 5: Worktree And Git Helpers

**Files:**
- Create: `src/mcp/orchestration/worktrees.js`
- Modify: `test/mcp-orchestration.test.mjs`
- Modify: `.gitignore`

- [ ] **Step 1: Add `.cursor2api-worktrees/` to this repository ignore file**

Append this line to `.gitignore`:

```gitignore
.cursor2api-worktrees/
```

- [ ] **Step 2: Add worktree helper tests**

Add this import to `test/mcp-orchestration.test.mjs`:

```js
import { createGit, parseVerificationCommand, worktreePath } from "../src/mcp/orchestration/worktrees.js";
```

Append these tests:

```js
test("worktreePath stays inside the run directory", () => {
  const path = worktreePath("/repo", "run-1", "chain-a");
  assert.match(path.replace(/\\/g, "/"), /\/repo\/\.cursor2api-worktrees\/run-1\/chain-a$/);
});

test("parseVerificationCommand supports simple local commands", () => {
  assert.deepEqual(parseVerificationCommand("npm test"), { command: "npm", args: ["test"] });
  assert.deepEqual(parseVerificationCommand("node --test test/mcp.test.mjs"), {
    command: "node",
    args: ["--test", "test/mcp.test.mjs"],
  });
});

test("createGit uses local git commands through the injected executor", async () => {
  const calls = [];
  const git = createGit({
    execFile: async (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd });
      if (command === "git" && args.join(" ") === "diff --cached --quiet") {
        throw new Error("has staged changes");
      }
      return { stdout: "", stderr: "" };
    },
  });

  await git.ensureRepository("/repo");
  await git.ensureClean("/repo");
  await git.ensureWorktreeRootIgnored("/repo");
  await git.addWorktree({ workspace: "/repo", path: "/repo/.cursor2api-worktrees/run/chain-a", branch: "cursor2api/run/chain-a" });
  await git.commitAll("/repo/.cursor2api-worktrees/run/chain-a", "cursor2api: agent-1");
  await git.mergeBranch({ workspace: "/repo", branch: "cursor2api/run/chain-a" });
  await git.runVerification("npm test", "/repo");

  assert.deepEqual(calls.map((call) => [call.command, call.args]), [
    ["git", ["rev-parse", "--show-toplevel"]],
    ["git", ["status", "--porcelain"]],
    ["git", ["check-ignore", "-q", ".cursor2api-worktrees/"]],
    ["git", ["worktree", "add", "-b", "cursor2api/run/chain-a", "/repo/.cursor2api-worktrees/run/chain-a", "HEAD"]],
    ["git", ["add", "-A"]],
    ["git", ["diff", "--cached", "--quiet"]],
    ["git", ["commit", "-m", "cursor2api: agent-1"]],
    ["git", ["merge", "--no-edit", "cursor2api/run/chain-a"]],
    ["npm", ["test"]],
  ]);
});
```

- [ ] **Step 3: Run the RED test**

Run: `node --test test/mcp-orchestration.test.mjs`

Expected: FAIL with module-not-found for `src/mcp/orchestration/worktrees.js`.

- [ ] **Step 4: Implement worktree helpers**

Create `src/mcp/orchestration/worktrees.js`:

```js
/** Local git/worktree helpers for MCP server-internal orchestration. */
import { execFile as execFileCallback } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

const execFilePromise = promisify(execFileCallback);
export const WORKTREE_ROOT = ".cursor2api-worktrees";

export function createRunId() {
  return `run-${randomUUID()}`;
}

function safePathId(value) {
  return String(value || "worktree").replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "worktree";
}

export function worktreePath(workspace, runId, worktreeId) {
  const root = resolve(workspace, WORKTREE_ROOT, safePathId(runId));
  const target = resolve(root, safePathId(worktreeId));
  const rel = relative(root, target);
  if (rel.startsWith("..") || rel === "" || resolve(root, rel) !== target) {
    throw new Error(`Refusing unsafe worktree path: ${target}`);
  }
  return target;
}

export function branchName(runId, worktreeId) {
  return `cursor2api/${safePathId(runId)}/${safePathId(worktreeId)}`;
}

export function parseVerificationCommand(commandText) {
  const parts = String(commandText || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) throw new Error("Verification command is empty");
  return { command: parts[0], args: parts.slice(1) };
}

export function createGit({ execFile = execFilePromise } = {}) {
  async function exec(command, args, cwd) {
    try {
      return await execFile(command, args, { cwd, windowsHide: true, maxBuffer: 1024 * 1024 * 10 });
    } catch (error) {
      const message = [error.message, error.stdout, error.stderr].filter(Boolean).join("\n");
      throw new Error(message);
    }
  }

  return {
    async ensureRepository(workspace) {
      await exec("git", ["rev-parse", "--show-toplevel"], workspace);
    },

    async ensureClean(workspace) {
      const result = await exec("git", ["status", "--porcelain"], workspace);
      if (String(result.stdout || "").trim()) throw new Error("Workspace must be clean before MCP worktree orchestration");
    },

    async ensureWorktreeRootIgnored(workspace) {
      await exec("git", ["check-ignore", "-q", `${WORKTREE_ROOT}/`], workspace);
    },

    async addWorktree({ workspace, path, branch }) {
      await exec("git", ["worktree", "add", "-b", branch, path, "HEAD"], workspace);
    },

    async statusPorcelain(path) {
      const result = await exec("git", ["status", "--porcelain"], path);
      return String(result.stdout || "");
    },

    async commitAll(path, message) {
      await exec("git", ["add", "-A"], path);
      try {
        await exec("git", ["diff", "--cached", "--quiet"], path);
        return false;
      } catch {
        await exec("git", ["commit", "-m", message], path);
        return true;
      }
    },

    async mergeBranch({ workspace, branch }) {
      await exec("git", ["merge", "--no-edit", branch], workspace);
    },

    async removeWorktree(path) {
      await exec("git", ["worktree", "remove", "--force", path], dirname(dirname(path)));
    },

    async deleteBranch(workspace, branch) {
      await exec("git", ["branch", "-D", branch], workspace);
    },

    async runVerification(commandText, workspace) {
      const { command, args } = parseVerificationCommand(commandText);
      const result = await exec(command, args, workspace);
      return { command: commandText, output: String(result.stdout || result.stderr || "").trim() };
    },

    async cleanup({ workspace, worktrees }) {
      for (const worktree of worktrees) {
        await this.removeWorktree(worktree.path);
        await this.deleteBranch(workspace, worktree.branch);
      }
    },
  };
}
```

- [ ] **Step 5: Run orchestration tests**

Run: `node --test test/mcp-orchestration.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit worktree helpers**

```bash
git add .gitignore src/mcp/orchestration/worktrees.js test/mcp-orchestration.test.mjs
git commit -m "feat: add local mcp worktree helpers"
```

---

### Task 6: Orchestration Runner With Fake Git

**Files:**
- Create: `src/mcp/orchestration/runner.js`
- Modify: `test/mcp-orchestration.test.mjs`

- [ ] **Step 1: Add runner tests**

Add this import to `test/mcp-orchestration.test.mjs`:

```js
import { runOrchestration } from "../src/mcp/orchestration/runner.js";
```

Append these tests:

```js
function fakeGitRecorder() {
  const calls = [];
  return {
    calls,
    git: {
      ensureRepository: async (workspace) => calls.push(["ensureRepository", workspace]),
      ensureClean: async (workspace) => calls.push(["ensureClean", workspace]),
      ensureWorktreeRootIgnored: async (workspace) => calls.push(["ensureIgnored", workspace]),
      addWorktree: async (input) => calls.push(["addWorktree", input.branch, input.path]),
      statusPorcelain: async (path) => {
        calls.push(["status", path]);
        return " M file.js";
      },
      commitAll: async (path, message) => {
        calls.push(["commitAll", path, message]);
        return true;
      },
      mergeBranch: async (input) => calls.push(["mergeBranch", input.branch]),
      runVerification: async (command, workspace) => {
        calls.push(["verify", command, workspace]);
        return { command, output: "pass" };
      },
      cleanup: async (input) => calls.push(["cleanup", input.worktrees.map((worktree) => worktree.id)]),
    },
  };
}

test("runOrchestration runs independent worktrees, merges, verifies, and synthesizes", async () => {
  const recorder = fakeGitRecorder();
  const runCalls = [];
  const result = await runOrchestration({
    task: "original",
    defaultModel: "default",
    apiKey: "key",
    workspace: "/repo",
    orchestration: normalizeOrchestration(
      {
        summary: "parallel",
        agents: [
          { id: "a", model: "default", task: "task a", dependsOn: [], worktree: "chain-a" },
          { id: "b", model: "default", task: "task b", dependsOn: [], worktree: "chain-b" },
        ],
        mergeOrder: ["chain-a", "chain-b"],
        verify: ["npm test"],
      },
      { defaultModel: "default", task: "original", models: [{ id: "default" }] },
    ),
    git: recorder.git,
    runId: "run-1",
    runWithFallback: async (prompt, model, apiKey, cwd) => {
      runCalls.push({ prompt, model, apiKey, cwd });
      return runCalls.length === 3 ? "final summary" : `result ${runCalls.length}`;
    },
  });

  assert.equal(result, "final summary");
  assert.deepEqual(recorder.calls.filter((call) => call[0] === "mergeBranch").map((call) => call[1]), [
    "cursor2api/run-1/chain-a",
    "cursor2api/run-1/chain-b",
  ]);
  assert.equal(runCalls[0].cwd.replace(/\\/g, "/"), "/repo/.cursor2api-worktrees/run-1/chain-a");
  assert.equal(runCalls[1].cwd.replace(/\\/g, "/"), "/repo/.cursor2api-worktrees/run-1/chain-b");
  assert.equal(runCalls[2].cwd, "/repo");
});

test("runOrchestration keeps dependent agents in one worktree", async () => {
  const recorder = fakeGitRecorder();
  const runCalls = [];
  await runOrchestration({
    task: "original",
    defaultModel: "default",
    apiKey: "key",
    workspace: "/repo",
    orchestration: normalizeOrchestration(
      {
        summary: "chain",
        agents: [
          { id: "base", model: "default", task: "base", dependsOn: [], worktree: "shared" },
          { id: "followup", model: "default", task: "follow", dependsOn: ["base"] },
        ],
        verify: ["npm test"],
      },
      { defaultModel: "default", task: "original", models: [{ id: "default" }] },
    ),
    git: recorder.git,
    runId: "run-1",
    runWithFallback: async (prompt, model, apiKey, cwd) => {
      runCalls.push({ prompt, cwd });
      return runCalls.length === 3 ? "final summary" : "agent result";
    },
  });

  assert.equal(runCalls[0].cwd.replace(/\\/g, "/"), "/repo/.cursor2api-worktrees/run-1/shared");
  assert.equal(runCalls[1].cwd.replace(/\\/g, "/"), "/repo/.cursor2api-worktrees/run-1/shared");
  assert.match(runCalls[1].prompt, /Dependencies already completed: base/);
});

test("runOrchestration stops before verification when merge fails", async () => {
  const recorder = fakeGitRecorder();
  recorder.git.mergeBranch = async () => {
    throw new Error("merge conflict");
  };

  await assert.rejects(
    () =>
      runOrchestration({
        task: "original",
        defaultModel: "default",
        apiKey: "key",
        workspace: "/repo",
        orchestration: normalizeOrchestration(
          {
            summary: "merge failure",
            agents: [{ id: "a", model: "default", task: "task a", dependsOn: [], worktree: "chain-a" }],
            verify: ["npm test"],
          },
          { defaultModel: "default", task: "original", models: [{ id: "default" }] },
        ),
        git: recorder.git,
        runId: "run-1",
        runWithFallback: async () => "agent result",
      }),
    /merge conflict/i,
  );

  assert.equal(recorder.calls.some((call) => call[0] === "verify"), false);
});
```

- [ ] **Step 2: Run the RED test**

Run: `node --test test/mcp-orchestration.test.mjs`

Expected: FAIL with module-not-found for `src/mcp/orchestration/runner.js`.

- [ ] **Step 3: Implement runner**

Create `src/mcp/orchestration/runner.js`:

```js
/** End-to-end server-internal MCP orchestration runner. */
import { finalSynthesisPrompt, subagentPrompt } from "./planner.js";
import { scheduleAgents } from "./scheduler.js";
import { branchName, createGit, createRunId, worktreePath } from "./worktrees.js";

function emit(emitProgress, message) {
  if (typeof emitProgress === "function") emitProgress(message);
}

function worktreeRecords({ workspace, runId, orchestration }) {
  return orchestration.mergeOrder.map((id) => ({
    id,
    branch: branchName(runId, id),
    path: worktreePath(workspace, runId, id),
  }));
}

export async function runOrchestration({
  task,
  defaultModel,
  apiKey,
  workspace,
  orchestration,
  runWithFallback,
  emitProgress,
  git = createGit(),
  runId = createRunId(),
}) {
  await git.ensureRepository(workspace);
  await git.ensureClean(workspace);
  await git.ensureWorktreeRootIgnored(workspace);

  const worktrees = worktreeRecords({ workspace, runId, orchestration });
  const worktreeById = new Map(worktrees.map((worktree) => [worktree.id, worktree]));
  for (const worktree of worktrees) {
    emit(emitProgress, `Creating worktree ${worktree.id}`);
    await git.addWorktree({ workspace, path: worktree.path, branch: worktree.branch });
  }

  const completed = new Set();
  const agentResults = [];
  const levels = scheduleAgents(orchestration.agents);

  for (const level of levels) {
    await Promise.all(
      level.map(async (agent) => {
        const worktree = worktreeById.get(agent.worktree);
        if (!worktree) throw new Error(`Missing worktree ${agent.worktree} for agent ${agent.id}`);
        emit(emitProgress, `Running ${agent.id} in ${worktree.id}`);
        const completedDependencies = agent.dependsOn.filter((id) => completed.has(id));
        const result = await runWithFallback(
          subagentPrompt({ task, agent, workspace: worktree.path, completedDependencies }),
          agent.model,
          apiKey,
          worktree.path,
        );
        const status = await git.statusPorcelain(worktree.path);
        const committed = status.trim() ? await git.commitAll(worktree.path, `cursor2api: ${agent.id}`) : false;
        completed.add(agent.id);
        agentResults.push({ id: agent.id, model: agent.model, worktree: agent.worktree, committed, result });
      }),
    );
  }

  await git.ensureClean(workspace);
  const mergeResults = [];
  for (const worktree of worktrees) {
    emit(emitProgress, `Merging ${worktree.id}`);
    await git.mergeBranch({ workspace, branch: worktree.branch });
    mergeResults.push({ worktree: worktree.id, branch: worktree.branch });
  }

  const verificationResults = [];
  for (const command of orchestration.verify) {
    emit(emitProgress, `Verifying: ${command}`);
    verificationResults.push(await git.runVerification(command, workspace));
  }

  const finalText = await runWithFallback(
    finalSynthesisPrompt({ task, orchestration, agentResults, mergeResults, verificationResults }),
    defaultModel,
    apiKey,
    workspace,
  );

  await git.cleanup({ workspace, worktrees });
  return finalText;
}
```

- [ ] **Step 4: Run orchestration tests**

Run: `node --test test/mcp-orchestration.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit runner**

```bash
git add src/mcp/orchestration/runner.js test/mcp-orchestration.test.mjs
git commit -m "feat: run mcp worktree orchestration"
```

---

### Task 7: MCP Protocol Integration

**Files:**
- Modify: `src/mcp/protocol.js`
- Modify: `test/mcp.test.mjs`

- [ ] **Step 1: Add protocol integration test**

Append this test to `test/mcp.test.mjs`:

```js
test("cursor_agent executes orchestrate decisions inside the MCP server", async () => {
  const calls = [];
  const orchestrationCalls = [];
  const protocol = createMcpProtocol({
    apiKey: "key",
    model: "default",
    cwd: () => "/tmp/work",
    listModels: async () => [{ id: "default" }],
    run: async (prompt, model, apiKey, workspace) => {
      calls.push({ prompt, model, apiKey, workspace });
      return JSON.stringify({
        mode: "orchestrate",
        orchestration: {
          summary: "complex local work",
          agents: [{ id: "agent-1", model: "default", task: "edit locally", dependsOn: [], worktree: "chain-a" }],
          verify: ["npm test"],
        },
      });
    },
    orchestrate: async (input) => {
      orchestrationCalls.push(input);
      return "orchestrated answer";
    },
  });

  const reply = await protocol.handle({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "cursor_agent", arguments: { prompt: "complex work" } },
  });

  assert.equal(reply.result.isError, false);
  assert.equal(reply.result.content[0].text, "orchestrated answer");
  assert.equal(calls.length, 1);
  assert.equal(orchestrationCalls.length, 1);
  assert.equal(orchestrationCalls[0].task, "complex work");
  assert.equal(orchestrationCalls[0].workspace, "/tmp/work");
  assert.equal(orchestrationCalls[0].orchestration.agents[0].task, "edit locally");
});
```

- [ ] **Step 2: Run the RED test**

Run: `node --test test/mcp.test.mjs`

Expected: FAIL because `createMcpProtocol()` does not accept `orchestrate` and `callTool()` treats the decision as a normal self/delegate run.

- [ ] **Step 3: Wire protocol to the runner**

Add this import to `src/mcp/protocol.js`:

```js
import { runOrchestration } from "./orchestration/runner.js";
```

Add this default function after `defaultListModels()`:

```js
async function defaultRunOrchestration(options) {
  return runOrchestration(options);
}
```

Add this parameter to `createMcpProtocol()`:

```js
  orchestrate = defaultRunOrchestration,
```

Add this branch after the `const decision = routingDecision(decisionText, defaultModel, prompt, models);` line and before the existing `parallel` branch:

```js
      if (decision.mode === "orchestrate") {
        return toolText(
          await orchestrate({
            task: prompt,
            defaultModel,
            apiKey,
            workspace,
            models,
            orchestration: decision.orchestration,
            runWithFallback,
            emitProgress,
          }),
        );
      }
```

- [ ] **Step 4: Run MCP tests**

Run: `node --test test/mcp.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit protocol integration**

```bash
git add src/mcp/protocol.js test/mcp.test.mjs
git commit -m "feat: connect cursor_agent orchestration"
```

---

### Task 8: Publication List And Focused Failure Tests

**Files:**
- Modify: `package.json`
- Modify: `test/mcp-orchestration.test.mjs`

- [ ] **Step 1: Add package files**

Add these entries to the `files` array in `package.json` next to the existing MCP files:

```json
"src/mcp/orchestration/decision.js",
"src/mcp/orchestration/planner.js",
"src/mcp/orchestration/runner.js",
"src/mcp/orchestration/scheduler.js",
"src/mcp/orchestration/worktrees.js",
```

- [ ] **Step 2: Add verification failure test**

Append this test to `test/mcp-orchestration.test.mjs`:

```js
test("runOrchestration returns verification failures from the server-side verifier", async () => {
  const recorder = fakeGitRecorder();
  recorder.git.runVerification = async () => {
    throw new Error("tests failed");
  };

  await assert.rejects(
    () =>
      runOrchestration({
        task: "original",
        defaultModel: "default",
        apiKey: "key",
        workspace: "/repo",
        orchestration: normalizeOrchestration(
          {
            summary: "verify failure",
            agents: [{ id: "a", model: "default", task: "task a", dependsOn: [], worktree: "chain-a" }],
            verify: ["npm test"],
          },
          { defaultModel: "default", task: "original", models: [{ id: "default" }] },
        ),
        git: recorder.git,
        runId: "run-1",
        runWithFallback: async () => "agent result",
      }),
    /tests failed/i,
  );
});
```

- [ ] **Step 3: Run orchestration tests**

Run: `node --test test/mcp-orchestration.test.mjs`

Expected: PASS.

- [ ] **Step 4: Commit publication and failure tests**

```bash
git add package.json test/mcp-orchestration.test.mjs
git commit -m "test: cover mcp orchestration failure paths"
```

---

### Task 9: Full Verification

**Files:**
- Test: all test files

- [ ] **Step 1: Run full tests**

Run: `npm test`

Expected: PASS for all existing tests plus `test/mcp-orchestration.test.mjs`.

- [ ] **Step 2: Run entry import smoke checks**

Run:

```bash
node -e "import('./src/mcp.js').then(m=>console.log(typeof m.createMcpProtocol==='function' && typeof m.MCP_TOOL==='object'))"
node -e "import('./src/mcp/orchestration/runner.js').then(m=>console.log(typeof m.runOrchestration==='function'))"
```

Expected: both commands print `true`.

- [ ] **Step 3: Confirm no client-side execution hooks were added**

Run:

```bash
rg "client-side|native subagent|external agent client|Claude|Codex|Gemini" src test
```

Expected: no output showing production code depending on client-side subagents or external client compute features.

- [ ] **Step 4: Commit verification-only fixes if needed**

If verification found a bug and code was changed, commit the fix:

```bash
git add src test package.json .gitignore
git commit -m "fix: stabilize mcp orchestration verification"
```

If no files changed, do not create a commit.
