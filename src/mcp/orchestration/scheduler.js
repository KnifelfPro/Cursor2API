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
