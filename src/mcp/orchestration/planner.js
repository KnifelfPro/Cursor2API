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
