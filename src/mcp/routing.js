/** Prompt fragments and JSON parsing for /cursor model routing (self | delegate | parallel | orchestrate). */

import { normalizeOrchestration } from "./orchestration/decision.js";

export const SUPERPOWERS_FLOW = [
  "Explore project context before changing behavior.",
  "Write or update the smallest useful test before non-trivial implementation.",
  "Implement in small verifiable steps.",
  "Verify before claiming completion.",
].join(" ");

export const PONYTAIL_RULES = [
  "Use the laziest solution that actually works.",
  "Reuse existing code and standard library before adding abstractions.",
  "Keep the diff small, avoid speculative scaffolding, and cap fanout.",
].join(" ");

const MAX_PARALLEL_AGENTS = 3; // cap fanout from routingDecision

export function createRoutingPrompt({ task, workspace, tools, models }) {
  return [
    "You are the default model for a local MCP Cursor agent router.",
    "Choose whether to handle the task yourself, delegate to one listed model, fan out to multiple listed models, or orchestrate a complex local implementation inside the MCP server.",
    "Choose models by task difficulty and model capability: use self on the default model for low or medium difficulty tasks; do not delegate or parallelize unless the task is hard enough for a stronger listed model or broad enough for independent parallel work.",
    "Use orchestrate only for complex tasks that need 1 to 10 subagents, git worktrees, dependency ordering, local merges, and final local verification.",
    "The MCP client only invokes this tool and displays the final result; it does not run subagents, create worktrees, merge branches, or run tests.",
    "Return valid JSON only.",
    'Schema: {"mode":"self|delegate|parallel|orchestrate","model":"model-id","task":"worker task","agents":[{"model":"model-id","task":"worker task"}],"orchestration":{"summary":"reason","agents":[{"id":"agent-1","model":"model-id","task":"worker task","phase":"implement","dependsOn":[],"worktree":"chain-a"}],"mergeOrder":["chain-a"],"verify":["npm test"]}}',
    `Superpowers workflow: ${SUPERPOWERS_FLOW}`,
    `Ponytail rules: ${PONYTAIL_RULES}`,
    `Context: ${JSON.stringify({ workspace, models, tools, task })}`,
  ].join("\n");
}

export function workerPrompt(task) {
  return [`Superpowers workflow: ${SUPERPOWERS_FLOW}`, `Ponytail rules: ${PONYTAIL_RULES}`, `Task:\n${task}`].join("\n\n");
}

export function synthesisPrompt(task, results) {
  return workerPrompt(
    [
      "Synthesize the final answer for the original task.",
      `Original task: ${task}`,
      `Agent results: ${JSON.stringify(results)}`,
    ].join("\n"),
  );
}

/** Best-effort JSON object parse; accepts raw text or ```json fences from model output. */
export function parseJsonObject(text) {
  const raw = String(text || "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  const candidates = [raw, fenced?.[1]].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {}
  }

  return null;
}

export function modelId(model) {
  return typeof model === "string" ? model : model?.id;
}

export function knownModel(model, modelIds, fallback) {
  return modelIds.has(model) ? model : fallback;
}

/** Normalize router JSON into a safe decision; unknown models map to defaultModel. */
export function routingDecision(text, defaultModel, task, models) {
  const parsed = parseJsonObject(text);
  const modelIds = new Set(models.map(modelId).filter(Boolean));
  const fallback = knownModel(defaultModel, modelIds, defaultModel);

  if (parsed?.mode === "delegate") {
    return {
      mode: "delegate",
      model: knownModel(parsed.model, modelIds, fallback),
      task: typeof parsed.task === "string" && parsed.task.trim() ? parsed.task.trim() : task,
    };
  }

  if (parsed?.mode === "parallel" && Array.isArray(parsed.agents) && parsed.agents.length) {
    const agents = parsed.agents.slice(0, MAX_PARALLEL_AGENTS).map((agent) => ({
      model: knownModel(agent?.model, modelIds, fallback),
      task: typeof agent?.task === "string" && agent.task.trim() ? agent.task.trim() : task,
    }));
    return { mode: "parallel", agents };
  }

  if (parsed?.mode === "orchestrate") {
    return {
      mode: "orchestrate",
      orchestration: normalizeOrchestration(parsed.orchestration || parsed, { defaultModel, task, models }),
    };
  }

  return { mode: "self", model: fallback, task };
}
