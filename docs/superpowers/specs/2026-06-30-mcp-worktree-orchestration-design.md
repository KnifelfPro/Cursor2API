# MCP Worktree Orchestration Design

**Date:** 2026-06-30
**Scope:** MCP `cursor_agent` complex-task orchestration inside the `cursor2api-mcp` server process only. The MCP client only invokes the tool and displays the final result. No cross-repository work, remote branches, PR automation, or changes to HTTP proxy behavior.
**Author:** Codex

---

## 1. Problem Statement

`cursor_agent` currently supports a lightweight routing flow: the default model can handle a task itself, delegate to one model, or fan out to up to three parallel workers in the same workspace. That is useful for analysis and simple parallel answers, but it does not provide a safe implementation workflow for complex MCP tasks that need staged execution, isolated file changes, dependency ordering, final merge, and verification.

The requested behavior is a stronger local orchestration path inspired by the Superpowers workflow: inside the MCP server, the default model acts as the coordinator, decomposes complex work into 1 to 10 subagents, selects suitable models from the currently supported Cursor model list, executes independent work in separate git worktrees, reuses one worktree for dependent subagent chains, merges completed worktrees back into the original workspace, and runs final local validation before returning the result.

No MCP client performs planning, task splitting, model selection, subagent execution, worktree management, merge work, or test validation. Client participation is limited to the MCP protocol call, optional existing permission UI exposed by the MCP protocol, and final result display.

---

## 2. Goals

1. Preserve existing `cursor_agent` self, delegate, and simple parallel behavior for tasks that do not need strong orchestration.
2. Add an explicit orchestration decision mode for complex tasks.
3. Let the default model create a bounded execution plan with 1 to 10 subagents, dependency groups, model selections, and final verification commands.
4. Create local git worktrees for implementation agents.
5. Run independent subagents in parallel when their dependency graph allows it.
6. Reuse the same worktree for subagents that depend on previous subagent output.
7. Merge completed worktree results into the original workspace in dependency order.
8. Run final local tests before claiming completion.
9. Stop with a clear MCP tool error on planning failure, agent failure, merge conflict, dirty unexpected state, or verification failure.
10. Keep the implementation testable without invoking the real Cursor SDK or real destructive git operations.

---

## 3. Non-Goals

The project will not support these in this feature:

1. Cross-repository orchestration.
2. Remote branch creation or pushes.
3. Pull request creation or PR automation.
4. Cloud agent execution.
5. Long-lived worktree management UI.
6. Automatic conflict resolution that rewrites user work.
7. Changes to `cursor_agent_direct`.
8. Changes to OpenAI-compatible or Anthropic-compatible HTTP endpoints.

All orchestration is local to the MCP root workspace selected by the existing roots/cwd behavior.

The client may provide roots through the MCP protocol, but root discovery is only workspace selection. It is not task computation.

---

## 4. User-Facing Behavior

`cursor_agent` keeps its current input:

```json
{ "prompt": "implement the feature", "model": "default" }
```

For simple tasks, behavior remains unchanged. For complex tasks, the default model may return an orchestration decision. The MCP server then performs the orchestration directly:

1. Resolve the workspace from MCP roots or server cwd.
2. Use the existing MCP elicitation approval only as a permission gate when the client supports it.
3. Ask the default model, from inside the MCP server, for a local execution plan.
4. Create required worktrees under a project-local ignored directory.
5. Run each subagent from inside the MCP server with its assigned model and worktree cwd.
6. Merge each completed worktree result into the original workspace.
7. Run final verification commands from inside the MCP server.
8. Ask the default model to synthesize the final result from subagent outputs, merge results, and verification output.
9. Return one MCP tool result to the client for display.

`cursor_agent_direct` remains a single direct Cursor run and does not route, orchestrate, create worktrees, or merge.

---

## 5. Routing Decision

`src/mcp/routing.js` extends the router schema with a new mode:

```json
{
  "mode": "self|delegate|parallel|orchestrate",
  "model": "model-id",
  "task": "worker task",
  "agents": [
    { "model": "model-id", "task": "worker task" }
  ],
  "orchestration": {
    "summary": "short reason this needs local worktree orchestration",
    "agents": [
      {
        "id": "agent-1",
        "model": "model-id",
        "task": "specific implementation task",
        "phase": "plan|implement|review|verify",
        "dependsOn": [],
        "worktree": "chain-a"
      }
    ],
    "parallel": [
      ["agent-1", "agent-2"],
      ["agent-3"]
    ],
    "mergeOrder": ["chain-a", "chain-b"],
    "verify": ["npm test"]
  }
}
```

Normalization rules:

1. Unknown modes fall back to `self`.
2. Unknown models fall back to the requested default model.
3. Agent count is clamped to 1 through 10 for orchestration.
4. `dependsOn` references unknown agent ids are rejected.
5. Cyclic dependencies are rejected.
6. Empty `verify` uses the project default `["npm test"]`.
7. Empty or duplicate `worktree` names are normalized to stable generated ids.
8. If one agent depends on another agent and does not specify a different worktree, it remains in the same worktree chain.

The old simple `parallel` mode remains capped separately by its existing small fanout rule. Strong orchestration is the only path that can use up to 10 subagents.

---

## 6. Module Structure

New files:

```text
src/mcp/orchestration/
  decision.js       # orchestration schema normalization and validation
  planner.js        # prompt builders for default-model orchestration planning and final synthesis
  scheduler.js      # dependency-level batching and execution ordering
  worktrees.js      # local git worktree create, status, commit discovery, merge, cleanup helpers
  runner.js         # high-level orchestration execution using injected run/gitintegration functions
```

Existing files:

```text
src/mcp/routing.js    # add orchestrate mode to routing prompt and routingDecision()
src/mcp/protocol.js   # call orchestration runner when decision.mode === "orchestrate"
test/mcp.test.mjs     # routing and protocol regression coverage
```

The orchestration runner accepts injected dependencies so tests can fake agent runs and git operations:

```js
runOrchestration({
  task,
  defaultModel,
  apiKey,
  workspace,
  models,
  runWithFallback,
  emitProgress,
  git,
})
```

Production uses real local git helpers. Tests inject a fake `git` object.

All production orchestration entry points are called from `src/mcp/protocol.js` after the `cursor_agent` router chooses `mode: "orchestrate"`. There is no client-side planner API and no requirement for the MCP client to support subagents.

---

## 7. Worktree Design

Worktrees live under a project-local ignored directory:

```text
.cursor2api-worktrees/<run-id>/<worktree-id>
```

Before creation, the server verifies that `.cursor2api-worktrees/` is ignored by git. If it is not ignored, the server does not modify `.gitignore` automatically during a tool call. It stops with an actionable error telling the user to ignore the directory. This avoids silently changing repository policy before subagents run.

This package repository should add `.cursor2api-worktrees/` to its own `.gitignore` during implementation so local development and smoke checks do not pollute `git status`. That repository-local change is not applied to arbitrary user workspaces at runtime.

For each worktree chain:

1. Create a branch from the original workspace `HEAD`.
2. Create one git worktree for that branch.
3. Execute all agents assigned to that worktree in dependency order.
4. After each agent, inspect status. If the agent produced changes, create a commit with a generated message.
5. If an agent in the same worktree depends on a previous agent, it runs after the previous commit in that same worktree.

Independent worktree chains may execute in parallel when the scheduler says their dependencies are satisfied.

The original workspace is the merge target. It must be clean before orchestration starts unless the only changes are inside ignored orchestration directories. If it is dirty, the server stops before creating worktrees.

---

## 8. Merge Strategy

Merges happen after all subagents complete their own tasks:

1. Confirm the original workspace is still clean.
2. Merge worktree branches into the original branch in normalized `mergeOrder`.
3. Use non-interactive git merge.
4. Stop immediately on merge conflict.
5. Do not run automatic conflict resolution.
6. Do not push branches.
7. Do not delete worktrees on failure; the error response includes their paths for inspection.
8. On successful final verification, remove created worktrees and branches when safe.

If a merge fails, the MCP tool returns an error containing the failed worktree id, branch name, path, and git output summary.

---

## 9. Scheduler

The scheduler converts the plan into dependency levels:

```text
Level 1: agents with no unmet dependencies
Level 2: agents whose dependencies completed in previous levels
...
```

Agents in the same level can run in parallel only when they target different worktree ids. Agents that share a worktree are executed sequentially inside that chain even if their dependency data would otherwise allow parallel execution. This enforces the requirement that dependent work stays in one worktree.

The scheduler returns:

```js
[
  [{ id: "agent-1", worktree: "chain-a" }, { id: "agent-2", worktree: "chain-b" }],
  [{ id: "agent-3", worktree: "chain-a" }]
]
```

The runner executes each level with `Promise.all` across independent worktree chains and sequential loops inside each worktree chain.

---

## 10. Subagent Prompting

Each subagent receives a strict task prompt:

```text
You are a Cursor subagent executing one assigned local task.

Workspace: <worktree path>
Original task: <user task>
Agent id: <id>
Phase: <phase>
Assigned model: <model>
Dependencies already completed: <ids>

Rules:
- Work only in this workspace.
- Do not create remote branches, push, or open PRs.
- Follow the local Superpowers workflow: inspect context, write or update tests first for behavior changes, implement narrowly, run the specified verification for this task.
- Commit-ready changes are expected. The MCP coordinator will commit and merge.
- Return a concise status with files changed, tests run, and blockers.

Task:
<agent task>
```

The server does not rely on the subagent to merge or manage worktrees. That remains coordinator-owned.

The MCP client never receives intermediate subagent prompts as work to perform. Intermediate progress may be emitted through normal MCP progress notifications, but those notifications are display-only.

---

## 11. Model Selection

The default model chooses subagent models from `listModels(apiKey)`. The server validates every selected id against that list.

Guidance in the planning prompt:

1. Use fast or lower-cost models for mechanical tasks with narrow file scope.
2. Use standard models for multi-file implementation or debugging.
3. Use the default model or strongest available model for architecture, review, final synthesis, and merge-failure analysis.
4. Do not invent model ids.
5. Prefer fewer agents unless parallelism clearly reduces risk or time.

If the model list cannot be fetched, existing fallback behavior returns the default model only, so orchestration still works with every subagent using the default model.

---

## 12. Error Handling

The orchestration path returns MCP tool errors for:

1. Missing API key.
2. User declines the existing approval prompt.
3. Workspace is not a git repository.
4. Workspace has uncommitted changes before orchestration.
5. Worktree directory is not git-ignored.
6. Planning output is invalid.
7. Agent dependency graph has cycles or unknown references.
8. Agent run fails.
9. Agent leaves a worktree in an unmergeable or invalid state.
10. Git commit fails.
11. Git merge fails or conflicts.
12. Final verification command fails.

Errors include enough context to inspect local state, but they do not include full logs when those logs may be very large.

---

## 13. Testing Strategy

Unit tests:

1. `routingDecision()` recognizes `orchestrate` and clamps unknown models to default.
2. Orchestration decision normalization clamps agent count to 10.
3. Invalid dependencies and cycles are rejected.
4. Scheduler groups independent agents in parallel levels.
5. Scheduler keeps same-worktree dependent agents sequential.
6. Worktree path generation stays inside `.cursor2api-worktrees/<run-id>/`.
7. Protocol calls the orchestration runner only for `mode: "orchestrate"`.

Integration-style tests with fakes:

1. A two-agent independent plan creates two fake worktrees, runs both agents, merges both, verifies once, and returns synthesized output.
2. A dependent two-agent plan creates one fake worktree and runs both tasks sequentially in that same worktree.
3. A merge failure returns an MCP tool error and does not run final verification.
4. A verification failure returns an MCP tool error after successful fake merges.

No test invokes the real Cursor SDK or mutates real git history.

Manual verification after implementation:

```bash
npm test
```

Optional local smoke verification can be run in a disposable repository, but it is not required for the automated suite.

---

## 14. Compatibility

Existing behavior remains unchanged for:

1. `cursor_agent_direct`.
2. `cursor_agent` decisions with `mode: "self"`.
3. `cursor_agent` decisions with `mode: "delegate"`.
4. `cursor_agent` decisions with simple `mode: "parallel"`.
5. MCP initialization, prompts, progress notifications, roots, and approval.
6. HTTP server endpoints.
7. Package installation scripts.

The new behavior activates only when the default model returns `mode: "orchestrate"` and the validated orchestration plan passes local safety checks.

The activation still happens entirely within one `cursor_agent` MCP tool call. External agent clients do not need native subagent support, worktree support, or plan execution support.
