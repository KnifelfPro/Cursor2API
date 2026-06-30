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
