import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_ORCHESTRATION_AGENTS,
  normalizeOrchestration,
  ORCHESTRATION_DEFAULT_VERIFY,
} from "../src/mcp/orchestration/decision.js";
import { finalSynthesisPrompt, subagentPrompt } from "../src/mcp/orchestration/planner.js";
import { runOrchestration } from "../src/mcp/orchestration/runner.js";
import { scheduleAgents } from "../src/mcp/orchestration/scheduler.js";
import { createGit, parseVerificationCommand, worktreePath } from "../src/mcp/orchestration/worktrees.js";

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
  assert.match(runCalls[0].cwd.replace(/\\/g, "/"), /\/repo\/\.cursor2api-worktrees\/run-1\/chain-a$/);
  assert.match(runCalls[1].cwd.replace(/\\/g, "/"), /\/repo\/\.cursor2api-worktrees\/run-1\/chain-b$/);
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

  assert.match(runCalls[0].cwd.replace(/\\/g, "/"), /\/repo\/\.cursor2api-worktrees\/run-1\/shared$/);
  assert.match(runCalls[1].cwd.replace(/\\/g, "/"), /\/repo\/\.cursor2api-worktrees\/run-1\/shared$/);
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
